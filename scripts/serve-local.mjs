import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const root = resolve(process.cwd());
const port = Number(process.env.PORT || 8000);

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
  ".gz": "application/json; charset=utf-8"
};

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://localhost:${port}`);
  if (url.pathname === "/results" || url.pathname === "/results.html") {
    response.writeHead(302, { Location: `/2026-results${url.search || ""}`, "Cache-Control": "no-store" });
    response.end();
    return;
  }

  let requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  if (requestedPath === "/2026-results" || requestedPath === "/2026-results.html") requestedPath = "/results.html";
  if (!extname(requestedPath)) requestedPath += ".html";

  const filePath = resolve(join(root, requestedPath));
  if (!filePath.startsWith(root)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    let body = await readFile(filePath);
    const headers = {
      "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    };
    // Precompressed JSON (.json.gz): either advertise gzip or decompress for clients
    // that treat the body as raw JSON (cache: no-store fetch + response.json()).
    if (filePath.endsWith(".json.gz")) {
      const accept = String(request.headers["accept-encoding"] || "");
      if (/\bgzip\b/.test(accept)) {
        headers["Content-Encoding"] = "gzip";
        headers["Content-Type"] = "application/json; charset=utf-8";
      } else {
        body = gunzipSync(body);
        headers["Content-Type"] = "application/json; charset=utf-8";
      }
    }
    response.writeHead(200, headers);
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Federal Elections local preview: http://127.0.0.1:${port}/`);
});
