import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
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
const adminPath = `/${String(process.env.ADMIN_PATH || "1234ab").replace(/^\/+/, "")}`;
const adminSecret = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || "";
const maxBodyBytes = 24 * 1024;
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

const cacheableExtensions = [".js", ".css", ".svg", ".png", ".jpg", ".jpeg", ".woff", ".woff2", ".ttf", ".eot", ".geojson"];

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
  if (!/^\d+$/.test(id || "")) {
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
    if (/^\d+$/.test(String(raceId))) {
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

async function handleAdmin(request, response, url) {
  if (!adminEnabled()) {
    sendJson(response, 503, { ok: false, error: "Admin is disabled. Set ADMIN_SECRET in the server environment." });
    return;
  }
  if (!isAdminRequest(request, url)) {
    sendJson(response, 401, { ok: false, error: "Admin secret required." });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/bootstrap") {
    const [liveResults, calls, notes] = await Promise.all([
      readJsonFile(resolve(root, "data", "live-results.json"), { groups: [] }),
      readJsonFile(callsPath, { races: {}, raceIdGuide: {} }),
      readJsonFile(analysisNotesPath, { races: {}, raceKey: {} })
    ]);
    sendJson(response, 200, {
      ok: true,
      races: raceListFromLiveResults(liveResults),
      calls,
      notes
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
    if (!/^\d+$/.test(raceId)) {
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
    await writeJsonFile(callsPath, current);
    reloadManualResultConfig();
    liveResultsCache = null;
    await refreshPersistedLiveResults(raceId);
    sendJson(response, 200, { ok: true, calls: current.races[raceId]?.calls || [] });
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
    if (!/^\d+$/.test(raceId)) {
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
    await writeJsonFile(analysisNotesPath, current);
    reloadManualResultConfig();
    liveResultsCache = null;
    await refreshPersistedLiveResults(raceId);
    sendJson(response, 200, { ok: true, note, notes: current.races[raceId] });
    return;
  }

  sendJson(response, 404, { ok: false, error: "Admin endpoint not found." });
}

async function serveStatic(request, response) {
  const url = new URL(request.url || "/", `http://localhost:${port}`);
  let requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);

  if (requestedPath === adminPath) {
    requestedPath = "/admin.html";
  } else if (requestedPath === "/admin.html") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
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
