import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import tls from "node:tls";
import { buildLiveResults } from "./scripts/generate-live-results.mjs";

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
const maxBodyBytes = 24 * 1024;
const rateLimitMs = 60_000;
const rateLimit = new Map();
let liveResultsCache = null;
let liveResultsCacheAt = 0;
const liveResultsCacheMs = 90_000;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png"
};

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
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
    sendJson(response, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const now = Date.now();
  if (liveResultsCache && now - liveResultsCacheAt < liveResultsCacheMs) {
    sendJson(response, 200, liveResultsCache);
    return;
  }

  try {
    liveResultsCache = await buildLiveResults();
    liveResultsCacheAt = now;
    sendJson(response, 200, liveResultsCache);
  } catch (error) {
    console.error(error);
    sendJson(response, 502, { ok: false, error: "Live results source unavailable." });
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url || "/", `http://localhost:${port}`);
  let requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  
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
    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream" });
    response.end(body);
  } catch {
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
  await serveStatic(request, response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Federal Elections Analysis server: http://127.0.0.1:${port}/`);
});
