import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import tls from "node:tls";
import { createGzip, createBrotliCompress } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { buildLiveResults, buildRaceResultDetailWithHistory, reloadManualResultConfig, writeLiveResultsSnapshot } from "./scripts/generate-live-results.mjs";

async function loadLocalEnv() {
  try {
    const envText = await readFile(resolve(process.cwd(), ".env"), "utf8");
    for (const line of envText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // Local env file is optional.
  }
}

await loadLocalEnv();

const root = resolve(process.cwd());
const port = Number(process.env.PORT || 8000);
const contactTo = process.env.CONTACT_TO || "federalelectionsanalysis@gmail.com";
const submissionsPath = resolve(root, "data", "contact-submissions.jsonl");
const callsPath = resolve(root, "data", "result-calls.json");
const analysisNotesPath = resolve(root, "data", "result-analysis-notes.json");
const overlayConfigPath = resolve(root, "data", "overlay-config.json");
const predictionsPath = resolve(root, "data", "predictions");
const predictionDraftsPath = resolve(predictionsPath, "drafts");
const predictionHistoryPath = resolve(predictionsPath, "history");
const adminPath = `/${String(process.env.ADMIN_PATH || "1234ab").replace(/^\/+/, "")}`;
const adminSecret = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || "";
const maxBodyBytes = 8 * 1024 * 1024;
const rateLimitMs = 60_000;
const rateLimit = new Map();
let liveResultsCache = null;
let liveResultsCacheAt = 0;
const liveResultsCacheMs = 15_000;

// Bandwidth monitoring
const bandwidthLog = new Map();
let totalBytesSent = 0;
let totalRequests = 0;

function logBandwidth(pathname, bytes) {
  totalBytesSent += bytes;
  totalRequests += 1;
  const key = pathname || "unknown";
  const existing = bandwidthLog.get(key) || { count: 0, bytes: 0 };
  bandwidthLog.set(key, { count: existing.count + 1, bytes: existing.bytes + bytes });
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".geojson": "application/json; charset=utf-8"
};

const compressibleTypes = [
  "text/html",
  "text/css",
  "text/javascript",
  "application/json",
  "application/javascript",
  "image/svg+xml"
];

const cacheableExtensions = [".js", ".css", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".woff", ".woff2", ".ttf", ".eot", ".geojson"];

function sendJson(response, status, payload, pathname = "") {
  const jsonString = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(jsonString);
}

function timingSafeEqualString(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (a.length !== b.length) return false;
  return cryptoSafeEqual(a, b);
}

function cryptoSafeEqual(a, b) {
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

function adminEnabled() {
  return Boolean(adminSecret);
}

function isAdminRequest(request, url) {
  if (!adminEnabled()) return false;
  const headerSecret = request.headers["x-admin-secret"];
  const querySecret = url.searchParams.get("secret");
  return timingSafeEqualString(headerSecret || querySecret, adminSecret);
}

function isValidRaceId(value) {
  return /^[A-Za-z0-9_-]{2,80}$/.test(String(value || ""));
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, payload) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function gitHubAdminConfig() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const repository = process.env.GITHUB_REPOSITORY || "";
  const branch = process.env.GITHUB_BRANCH || process.env.RENDER_GIT_BRANCH || process.env.BRANCH || "main";
  if (!token || !repository) return null;
  return { token, repository, branch };
}

async function commitJsonFileToGitHub(relativePath, payload, message) {
  const config = gitHubAdminConfig();
  if (!config) return { skipped: true, reason: "GitHub persistence env is not configured." };
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  const encodedPath = relativePath.split(/[\\/]+/).map(encodeURIComponent).join("/");
  const apiUrl = `https://api.github.com/repos/${config.repository}/contents/${encodedPath}`;
  const headers = {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${config.token}`,
    "Content-Type": "application/json",
    "User-Agent": "Federal-Elections-Analysis-admin"
  };
  let sha = "";
  const current = await fetch(`${apiUrl}?ref=${encodeURIComponent(config.branch)}`, { headers });
  if (current.ok) {
    const data = await current.json();
    sha = data.sha || "";
  } else if (current.status !== 404) {
    throw new Error(`GitHub read for ${relativePath} returned ${current.status}`);
  }
  const update = await fetch(apiUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch: config.branch,
      ...(sha ? { sha } : {})
    })
  });
  const data = await update.json().catch(() => ({}));
  if (!update.ok) {
    throw new Error(data.message || `GitHub write for ${relativePath} returned ${update.status}`);
  }
  return { committed: true, path: relativePath, branch: config.branch, sha: data.commit?.sha || "" };
}

async function persistAdminJsonFile(filePath, relativePath, payload, message) {
  await writeJsonFile(filePath, payload);
  try {
    return await commitJsonFileToGitHub(relativePath, payload, message);
  } catch (error) {
    console.warn(`Admin GitHub persistence failed for ${relativePath}: ${error.message}`);
    return { committed: false, path: relativePath, error: error.message };
  }
}

function escapeHeader(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function smtpLine(socket) {
  return new Promise((resolveLine, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (!lines.length) return;
      const last = lines[lines.length - 1];
      if (/^\d{3} /.test(last)) {
        socket.off("data", onData);
        resolveLine(buffer);
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

async function smtpCommand(socket, command, expectedCodes = ["250"]) {
  if (command) socket.write(`${command}\r\n`);
  const line = await smtpLine(socket);
  if (!expectedCodes.some((code) => line.startsWith(code))) {
    throw new Error(`SMTP command failed: ${line.trim()}`);
  }
  return line;
}

function smtpBody(message) {
  return message.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

async function sendContactEmail(submission) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.CONTACT_FROM || user;
  const smtpPort = Number(process.env.SMTP_PORT || 465);

  if (!host || !user || !pass || !from) {
    return { sent: false, reason: "SMTP is not configured." };
  }

  const socket = tls.connect({ host, port: smtpPort, servername: host });
  try {
    await smtpCommand(socket, null, ["220"]);
    await smtpCommand(socket, `EHLO ${host}`);
    await smtpCommand(socket, "AUTH LOGIN", ["334"]);
    await smtpCommand(socket, Buffer.from(user).toString("base64"), ["334"]);
    await smtpCommand(socket, Buffer.from(pass).toString("base64"), ["235"]);
    await smtpCommand(socket, `MAIL FROM:<${from}>`);
    await smtpCommand(socket, `RCPT TO:<${contactTo}>`, ["250", "251"]);
    await smtpCommand(socket, "DATA", ["354"]);

    const subject = escapeHeader(`Federal Elections Analysis contact: ${submission.subject}`);
    const replyTo = escapeHeader(submission.email);
    const text = [
      `Name: ${submission.name}`,
      `Email: ${submission.email}`,
      `Subject: ${submission.subject}`,
      "",
      submission.message
    ].join("\n");
    const message = [
      `From: Federal Elections Analysis <${from}>`,
      `To: ${contactTo}`,
      `Reply-To: ${replyTo}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      smtpBody(text),
      "."
    ].join("\r\n");

    socket.write(`${message}\r\n`);
    await smtpCommand(socket, null);
    await smtpCommand(socket, "QUIT", ["221"]);
    return { sent: true };
  } finally {
    socket.end();
  }
}

function validateContact(payload) {
  const name = String(payload.name || "").trim();
  const email = String(payload.email || "").trim();
  const subject = String(payload.subject || "").trim();
  const message = String(payload.message || "").trim();
  const website = String(payload.website || "").trim();

  if (website) return { ok: false, error: "Submission rejected." };
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Enter your name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return { ok: false, error: "Enter a valid email." };
  if (subject.length < 3 || subject.length > 120) return { ok: false, error: "Enter a subject." };
  if (message.length < 10 || message.length > 5000) return { ok: false, error: "Enter a message between 10 and 5000 characters." };

  return { ok: true, value: { name, email, subject, message } };
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function handleContact(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const ip = request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const lastRequest = rateLimit.get(ip) || 0;
  if (now - lastRequest < rateLimitMs) {
    sendJson(response, 429, { ok: false, error: "Please wait a minute before sending another message." });
    return;
  }
  rateLimit.set(ip, now);

  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { ok: false, error: "Invalid message payload." });
    return;
  }

  const validation = validateContact(payload);
  if (!validation.ok) {
    sendJson(response, 400, { ok: false, error: validation.error });
    return;
  }

  const submission = {
    ...validation.value,
    createdAt: new Date().toISOString(),
    userAgent: request.headers["user-agent"] || ""
  };

  await mkdir(resolve(root, "data"), { recursive: true });
  await new Promise((resolveWrite, reject) => {
    const stream = createWriteStream(submissionsPath, { flags: "a" });
    stream.on("error", reject);
    stream.end(`${JSON.stringify(submission)}\n`, resolveWrite);
  });

  try {
    const email = await sendContactEmail(submission);
    sendJson(response, 200, { ok: true, emailed: email.sent });
  } catch (error) {
    console.error(error);
    sendJson(response, 202, { ok: true, emailed: false, warning: "Message saved, but email delivery failed." });
  }
}

async function handleLiveResults(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { ok: false, error: "Method not allowed." }, "/api/live-results");
    return;
  }

  const now = Date.now();
  const ifNoneMatch = request.headers["if-none-match"];
  
  // Generate ETag from cache timestamp
  const currentETag = liveResultsCache ? `"${liveResultsCacheAt}"` : null;
  
  // Check if client has current version
  if (ifNoneMatch && currentETag && ifNoneMatch === currentETag) {
    response.writeHead(304, {
      "ETag": currentETag,
      "Cache-Control": "public, max-age=10"
    });
    response.end();
    return;
  }
  
  if (liveResultsCache && now - liveResultsCacheAt < liveResultsCacheMs) {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "ETag": currentETag,
      "Cache-Control": "public, max-age=10"
    });
    response.end(JSON.stringify(liveResultsCache));
    return;
  }

  try {
    liveResultsCache = await buildLiveResults();
    liveResultsCacheAt = now;
    await writeLiveResultsSnapshot(liveResultsCache, { details: false });
    
    const newETag = `"${liveResultsCacheAt}"`;
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "ETag": newETag,
      "Cache-Control": "public, max-age=10"
    });
    response.end(JSON.stringify(liveResultsCache));
  } catch (error) {
    console.error(error);
    sendJson(response, 502, { ok: false, error: "Live results source unavailable." }, "/api/live-results");
  }
}

async function handleLiveResultRace(request, response, url) {
  if (request.method !== "GET") {
    sendJson(response, 405, { ok: false, error: "Method not allowed." }, "/api/live-results/race");
    return;
  }
  const id = url.searchParams.get("id");
  if (!isValidRaceId(id)) {
    sendJson(response, 400, { ok: false, error: "Missing race id." }, "/api/live-results/race");
    return;
  }
  try {
    sendJson(response, 200, await buildRaceResultDetailWithHistory(id, { persist: true }), "/api/live-results/race");
  } catch (error) {
    console.error(error);
    sendJson(response, 502, { ok: false, error: "Live race detail source unavailable." }, "/api/live-results/race");
  }
}

async function refreshPersistedLiveResults(raceId = "") {
  try {
    const data = await buildLiveResults();
    liveResultsCache = data;
    liveResultsCacheAt = Date.now();
    await writeLiveResultsSnapshot(data, { details: false });
    if (isValidRaceId(raceId)) {
      await buildRaceResultDetailWithHistory(String(raceId), { persist: true });
    }
  } catch (error) {
    console.warn(`Could not refresh persisted live results after admin save: ${error.message}`);
    liveResultsCache = null;
  }
}

function raceListFromLiveResults(data) {
  return (data.groups || []).flatMap((group) => (group.races || []).map((race) => ({
    id: String(race.id),
    label: race.electionName || race.name || `Race ${race.id}`,
    state: race.state || group.state || "",
    candidates: (race.candidates || []).map((candidate) => ({
      name: candidate.name,
      party: candidate.party || "",
      partyCode: candidate.partyCode || ""
    }))
  }))).sort((a, b) => a.state.localeCompare(b.state) || a.label.localeCompare(b.label));
}

async function raceListFromDetailFiles(latestRaceIds = new Set()) {
  const detailDir = resolve(root, "data", "live-results-races");
  let files = [];
  try {
    files = await readdir(detailDir);
  } catch {
    return [];
  }
  const races = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const race = await readJsonFile(resolve(detailDir, file), null);
    if (!race?.id || latestRaceIds.has(String(race.id))) continue;
    races.push({
      id: String(race.id),
      label: race.electionName || race.name || `Race ${race.id}`,
      state: race.state || "",
      candidates: (race.candidates || []).map((candidate) => ({
        name: candidate.name,
        party: candidate.party || "",
        partyCode: candidate.partyCode || "",
        color: candidate.color || "",
        headshotUrl: candidate.headshotUrl || ""
      }))
    });
  }
  return races.sort((a, b) => a.state.localeCompare(b.state) || a.label.localeCompare(b.label));
}

function jsonHash(payload) {
  return createHash("sha256").update(`${JSON.stringify(payload) || ""}\n`).digest("hex");
}

function predictionFileInfo(value, mode = "publish") {
  const file = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (/^[0-9]{4}-[a-z0-9-]+-predictions\.json$/i.test(file)) {
    if (mode === "draft") {
      return {
        file,
        absolutePath: resolve(predictionDraftsPath, file),
        relativePath: `data/predictions/drafts/${file}`,
        publicPath: resolve(predictionsPath, file)
      };
    }
    return {
      file,
      absolutePath: resolve(predictionsPath, file),
      relativePath: `data/predictions/${file}`,
      publicPath: resolve(predictionsPath, file)
    };
  }
  if (/^county-predictions\/[A-Za-z0-9_.-]+\.json$/.test(file)) {
    const baseName = file.split("/").pop();
    if (mode === "draft") {
      return {
        file,
        absolutePath: resolve(predictionDraftsPath, "county-predictions", baseName),
        relativePath: `data/predictions/drafts/county-predictions/${baseName}`,
        publicPath: resolve(predictionsPath, file)
      };
    }
    return {
      file,
      absolutePath: resolve(predictionsPath, file),
      relativePath: `data/predictions/${file}`,
      publicPath: resolve(predictionsPath, file)
    };
  }
  return null;
}

async function listJsonFiles(dirPath, prefix = "") {
  let files = [];
  try {
    files = await readdir(dirPath);
  } catch {
    return [];
  }
  return files.filter((file) => file.endsWith(".json")).map((file) => `${prefix}${file}`).sort();
}

async function readPredictionPayload(file) {
  const info = predictionFileInfo(file, "publish");
  if (!info) return null;
  const published = await readJsonFile(info.publicPath, null);
  const draftInfo = predictionFileInfo(file, "draft");
  const draft = draftInfo ? await readJsonFile(draftInfo.absolutePath, null) : null;
  return {
    file,
    published,
    draft,
    publishedHash: published ? jsonHash(published) : "",
    draftHash: draft ? jsonHash(draft) : ""
  };
}

function validatePredictionPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "Prediction payload must be an object.";
  if (payload.races !== undefined && !Array.isArray(payload.races)) return "Prediction races must be an array.";
  if (Array.isArray(payload.races)) {
    for (const race of payload.races) {
      if (!race?.raceId) return "Every race needs a raceId.";
      const prediction = race.prediction || {};
      const margin = prediction.projectedMargin;
      if (margin !== null && margin !== undefined && margin !== "" && !Number.isFinite(Number(margin))) {
        return `Projected margin is not finite for ${race.raceId}.`;
      }
    }
  }
  return "";
}

async function handleAdmin(request, response, url) {
  if (!adminEnabled()) {
    sendJson(response, 503, { ok: false, error: "Admin is disabled. Set ADMIN_SECRET in the server environment." });
    return;
  }
  if (!isAdminRequest(request, url)) {
    sendJson(response, 401, { ok: false, error: "Admin secret required." });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/predictions/bootstrap") {
    const [publishedFiles, countyFiles] = await Promise.all([
      listJsonFiles(predictionsPath),
      listJsonFiles(resolve(predictionsPath, "county-predictions"), "county-predictions/")
    ]);
    const predictionFiles = publishedFiles.filter((file) => /-predictions\.json$/i.test(file));
    const files = await Promise.all(predictionFiles.map(readPredictionPayload));
    const counties = await Promise.all(countyFiles.map(readPredictionPayload));
    const modelAdapter = await readJsonFile(resolve(predictionsPath, "prediction-adapter.json"), null);
    sendJson(response, 200, {
      ok: true,
      files: files.filter(Boolean),
      countyFiles: counties.filter(Boolean),
      modelAdapter
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/predictions/save") {
    let payload;
    try {
      payload = await readJsonBody(request);
    } catch {
      sendJson(response, 400, { ok: false, error: "Invalid prediction payload." });
      return;
    }
    const mode = payload.mode === "publish" ? "publish" : "draft";
    const info = predictionFileInfo(payload.file, mode);
    if (!info) {
      sendJson(response, 400, { ok: false, error: "Prediction file is not allowed." });
      return;
    }
    const data = payload.data;
    const validationError = validatePredictionPayload(data);
    if (validationError) {
      sendJson(response, 400, { ok: false, error: validationError });
      return;
    }
    const now = new Date().toISOString();
    const editedBy = String(payload.editedBy || "FEA admin").trim().slice(0, 80) || "FEA admin";
    const changeSummary = String(payload.changeSummary || (mode === "publish" ? "Publish team prediction edits" : "Save prediction draft")).trim().slice(0, 500);
    data.lastEdited = now;
    data.lastEditedBy = editedBy;
    if (mode === "publish") data.lastPublishedAt = now;

    await mkdir(dirname(info.absolutePath), { recursive: true });
    const previous = await readJsonFile(info.publicPath, null);
    const previousHash = previous ? jsonHash(previous) : "";
    const newHash = jsonHash(data);
    let history = null;
    if (mode === "publish") {
      await mkdir(predictionHistoryPath, { recursive: true });
      const historyFile = `${info.file.replace(/[\/\\]/g, "__").replace(/\.json$/i, "")}-${now.replace(/[:.]/g, "-")}.json`;
      history = {
        versionId: historyFile.replace(/\.json$/i, ""),
        timestamp: now,
        editedBy,
        changeSummary,
        file: info.file,
        previousHash,
        newHash,
        snapshot: data
      };
      await persistAdminJsonFile(
        resolve(predictionHistoryPath, historyFile),
        `data/predictions/history/${historyFile}`,
        history,
        `Add prediction history for ${info.file}`
      );
    }
    const persistence = await persistAdminJsonFile(
      info.absolutePath,
      info.relativePath,
      data,
      mode === "publish" ? `Publish team predictions for ${info.file}` : `Save team prediction draft for ${info.file}`
    );
    sendJson(response, 200, {
      ok: true,
      mode,
      file: info.file,
      data,
      previousHash,
      newHash,
      history,
      persistence,
      persistedFiles: [info.relativePath, ...(history ? [`data/predictions/history/${history.versionId}.json`] : [])]
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/bootstrap") {
    const [liveResults, calls, notes, overlay] = await Promise.all([
      readJsonFile(resolve(root, "data", "live-results.json"), { groups: [] }),
      readJsonFile(callsPath, { races: {}, raceIdGuide: {} }),
      readJsonFile(analysisNotesPath, { races: {}, raceKey: {} }),
      readJsonFile(overlayConfigPath, { tickerItems: [], producerNote: "" })
    ]);
    const latestRaces = raceListFromLiveResults(liveResults);
    const latestRaceIds = new Set(latestRaces.map((race) => String(race.id)));
    // Broadcast admin should stay focused on the current live slate. Historical
    // detail files remain available to the public pages, but are intentionally
    // not offered as call targets here so old election-night options do not
    // clutter the producer workflow.
    const allRaces = latestRaces;
    sendJson(response, 200, {
      ok: true,
      races: latestRaces,
      latestRaces,
      allRaces,
      latestRaceIds: [...latestRaceIds],
      calls,
      notes,
      overlay
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/overlay") {
    let payload;
    try {
      payload = await readJsonBody(request);
    } catch {
      sendJson(response, 400, { ok: false, error: "Invalid overlay payload." });
      return;
    }
    const tickerItems = String(payload.tickerText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 30)
      .map((line) => {
        const match = line.match(/^([A-Za-z0-9][A-Za-z0-9 _-]{1,18}):\s+(.+)$/);
        if (!match) return { tag: "FEA", text: line };
        return {
          tag: match[1].trim().toUpperCase(),
          text: match[2].trim()
        };
      });
    const overlay = {
      updatedAt: new Date().toISOString(),
      producerNote: String(payload.producerNote || "").trim().slice(0, 500),
      tickerItems
    };
    const persistence = await persistAdminJsonFile(
      overlayConfigPath,
      "data/overlay-config.json",
      overlay,
      "Update OBS overlay ticker"
    );
    sendJson(response, 200, {
      ok: true,
      overlay,
      persistence,
      persistedFiles: ["data/overlay-config.json"]
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/calls") {
    let payload;
    try {
      payload = await readJsonBody(request);
    } catch {
      sendJson(response, 400, { ok: false, error: "Invalid call payload." });
      return;
    }
    const raceId = String(payload.raceId || "").trim();
    if (!isValidRaceId(raceId)) {
      sendJson(response, 400, { ok: false, error: "Choose a valid race." });
      return;
    }
    const calls = Array.isArray(payload.calls) ? payload.calls : [];
    const cleanedCalls = calls
      .map((call) => ({
        candidate: String(call.candidate || "").trim(),
        status: String(call.status || "projected").trim(),
        label: String(call.label || "").trim(),
        calledAt: String(call.calledAt || "").trim()
      }))
      .filter((call) => call.candidate)
      .map((call) => {
        const next = {
          candidate: call.candidate,
          status: ["winner", "projected", "advances", "advanced"].includes(call.status) ? call.status : "projected"
        };
        if (call.label) next.label = call.label;
        next.calledAt = call.calledAt || new Date().toISOString();
        return next;
      });

    const current = await readJsonFile(callsPath, { races: {}, raceIdGuide: {} });
    current.races = current.races || {};
    if (cleanedCalls.length) current.races[raceId] = { calls: cleanedCalls };
    else delete current.races[raceId];
    const persistence = await persistAdminJsonFile(
      callsPath,
      "data/result-calls.json",
      current,
      `Update live result calls for race ${raceId}`
    );
    reloadManualResultConfig();
    liveResultsCache = null;
    await refreshPersistedLiveResults(raceId);
    sendJson(response, 200, {
      ok: true,
      calls: current.races[raceId]?.calls || [],
      persistence,
      persistedFiles: [
        "data/result-calls.json",
        "data/live-results.json",
        `data/live-results-races/${raceId}.json`
      ]
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/notes") {
    let payload;
    try {
      payload = await readJsonBody(request);
    } catch {
      sendJson(response, 400, { ok: false, error: "Invalid note payload." });
      return;
    }
    const raceId = String(payload.raceId || "").trim();
    const text = String(payload.text || "").trim();
    if (!isValidRaceId(raceId)) {
      sendJson(response, 400, { ok: false, error: "Choose a valid race." });
      return;
    }
    if (text.length < 3 || text.length > 8000) {
      sendJson(response, 400, { ok: false, error: "Enter an analyst note between 3 and 8000 characters." });
      return;
    }
    const parseOptionalJson = (value) => {
      const trimmed = String(value || "").trim();
      if (!trimmed) return "";
      if (!/^[\[{]/.test(trimmed)) return trimmed;
      return JSON.parse(trimmed);
    };
    let image = "";
    let embed = "";
    try {
      image = parseOptionalJson(payload.image);
      embed = parseOptionalJson(payload.embed);
    } catch {
      sendJson(response, 400, { ok: false, error: "Image/embed JSON is malformed." });
      return;
    }
    const note = {
      date: String(payload.date || new Date().toISOString()).trim(),
      author: String(payload.author || "FEA Analysis Desk").trim(),
      role: String(payload.role || "Analysis desk").trim(),
      text,
      image,
      embed
    };
    const current = await readJsonFile(analysisNotesPath, { races: {}, raceKey: {} });
    current.races = current.races || {};
    const existingNotes = Array.isArray(current.races[raceId]) ? current.races[raceId] : [];
    const hasNoteIndex = payload.noteIndex !== null && payload.noteIndex !== undefined && payload.noteIndex !== "";
    const noteIndex = hasNoteIndex ? Number(payload.noteIndex) : -1;
    if (hasNoteIndex && Number.isInteger(noteIndex) && noteIndex >= 0 && noteIndex < existingNotes.length) {
      existingNotes[noteIndex] = note;
      current.races[raceId] = existingNotes;
    } else {
      current.races[raceId] = [note, ...existingNotes];
    }
    const persistence = await persistAdminJsonFile(
      analysisNotesPath,
      "data/result-analysis-notes.json",
      current,
      `Update analyst notes for race ${raceId}`
    );
    reloadManualResultConfig();
    liveResultsCache = null;
    await refreshPersistedLiveResults(raceId);
    sendJson(response, 200, {
      ok: true,
      note,
      notes: current.races[raceId],
      persistence,
      persistedFiles: [
        "data/result-analysis-notes.json",
        "data/live-results.json",
        `data/live-results-races/${raceId}.json`
      ]
    });
    return;
  }

  sendJson(response, 404, { ok: false, error: "Admin endpoint not found." });
}

async function serveStatic(request, response) {
  const url = new URL(request.url || "/", `http://localhost:${port}`);
  let requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const predictionRedirects = new Map([
    ["/senate", "/predictions/2026/senate"],
    ["/senate.html", "/predictions/2026/senate"],
    ["/house", "/predictions/2026/house"],
    ["/house.html", "/predictions/2026/house"],
    ["/governor", "/predictions/2026/governor"],
    ["/governor.html", "/predictions/2026/governor"],
    ["/president", "/predictions"],
    ["/president.html", "/predictions"],
    ["/predictions/2028/president", "/predictions"],
    ["/predictions/2028/president.html", "/predictions"],
    ["/methodology", "/predictions/methodology"],
    ["/methodology.html", "/predictions/methodology"]
  ]);
  if (predictionRedirects.has(url.pathname)) {
    response.writeHead(302, {
      "Location": predictionRedirects.get(url.pathname),
      "Cache-Control": "no-store"
    });
    response.end();
    return;
  }
  const hiddenResultPaths = new Set(["/result", "/result.html"]);
  if (hiddenResultPaths.has(url.pathname)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("Results pages are currently hidden.");
    return;
  }

  if (requestedPath === adminPath) {
    requestedPath = "/admin.html";
  } else if (requestedPath === "/fea-results-lab-26") {
    requestedPath = "/election-night.html";
  } else if (requestedPath === "/predictions/methodology") {
    requestedPath = "/predictions-methodology.html";
  } else if (requestedPath === "/admin.html") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  if (requestedPath.endsWith("/")) {
    requestedPath += "index.html";
  }
  
  // If the path doesn't have an extension, try adding .html
  if (!extname(requestedPath)) {
    requestedPath += ".html";
  }
  
  const filePath = resolve(join(root, requestedPath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    const fileExt = extname(filePath).toLowerCase();
    const contentType = contentTypes[fileExt] || "application/octet-stream";
    const isCacheable = cacheableExtensions.includes(fileExt);
    
    const headers = {
      "Content-Type": contentType
    };
    
    // Add cache headers for static assets
    if (isCacheable) {
      headers["Cache-Control"] = "public, max-age=31536000, immutable"; // 1 year
    } else if (fileExt === ".html") {
      headers["Cache-Control"] = "public, max-age=60"; // 1 minute for HTML
    } else if (fileExt === ".json") {
      // For JSON files in /data, use a shorter cache to allow updates
      headers["Cache-Control"] = "public, max-age=300"; // 5 minutes
    }
    
    response.writeHead(200, headers);
    response.end(body);
  } catch (error) {
    console.error(`Error serving ${requestedPath}:`, error);
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://localhost:${port}`);
  
  if (url.pathname === "/api/contact") {
    await handleContact(request, response);
    return;
  }
  if (url.pathname === "/api/live-results") {
    await handleLiveResults(request, response);
    return;
  }
  if (url.pathname === "/api/live-results/race") {
    await handleLiveResultRace(request, response, url);
    return;
  }
  if (url.pathname.startsWith("/api/admin/")) {
    await handleAdmin(request, response, url);
    return;
  }
  await serveStatic(request, response);
}).listen(port, () => {
  console.log(`Federal Elections Analysis server running on port ${port}`);
});
