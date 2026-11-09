import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const root = resolve(process.cwd());
const port = Number(process.env.PORT || 8000);
const apiOrigin = process.env.FEA_API_ORIGIN || "http://127.0.0.1:8010";

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

  // Proxy live results APIs to the main election server when available.
  if (url.pathname.startsWith("/api/")) {
    try {
      const upstream = await fetch(`${apiOrigin}${url.pathname}${url.search}`, {
        method: request.method,
        headers: {
          Accept: request.headers.accept || "application/json",
          "If-None-Match": request.headers["if-none-match"] || ""
        },
        signal: AbortSignal.timeout(120000)
      });
      const headers = {
        "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      };
      const etag = upstream.headers.get("etag");
      if (etag) headers.ETag = etag;
      response.writeHead(upstream.status, headers);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Live results API unavailable", origin: apiOrigin }));
    }
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
    // Precompressed JSON (.json.gz): always decompress for local preview.
    // Browsers often omit Content-Encoding handling for opaque/file fetches, and
    // response.json() then fails on raw gzip bytes — which left the County map blank.
    if (filePath.endsWith(".json.gz")) {
      body = gunzipSync(body);
      headers["Content-Type"] = "application/json; charset=utf-8";
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
