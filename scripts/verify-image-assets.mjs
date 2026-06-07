import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const textExtensions = new Set([".html", ".js", ".css", ".json", ".txt", ".md", ".mjs"]);
const skipFiles = new Set(["data/article-template.txt"]);
const failures = [];
const refs = [];

function normalizedPath(filePath) {
  return filePath.replaceAll("\\", "/").replace(root.replaceAll("\\", "/"), "").replace(/^\/+/, "");
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(filePath);
      continue;
    }
    const relativePath = normalizedPath(filePath);
    if (skipFiles.has(relativePath)) continue;
    if (textExtensions.has(extname(entry.name).toLowerCase())) refsFromFile(filePath, relativePath);
  }
}

function addRef(filePath, relativePath, rawRef) {
  const ref = String(rawRef || "").trim().replace(/^["'`]+|["'`)]+$/g, "").replace(/[?#].*$/, "");
  if (!ref || ref.includes("${")) return;
  if (/^(https?:|data:|mailto:|#)/i.test(ref)) return;
  if (!/\.(png|jpe?g|webp|svg|ico)$/i.test(ref)) return;
  refs.push({ filePath, relativePath, ref });
}

function refsFromFile(filePath, relativePath) {
  const text = readFileSync(filePath, "utf8");
  const patterns = [
    /\b(?:src|href|content|poster)\s*=\s*["']([^"']+\.(?:png|jpe?g|webp|svg|ico)(?:[?#][^"']*)?)["']/gi,
    /url\(\s*["']?([^"')]+\.(?:png|jpe?g|webp|svg|ico)(?:[?#][^"')]+)?)["']?\s*\)/gi,
    /(?:image|thumbnail|imageUrl|thumbnailUrl|profileImage|photo|src)\s*:\s*["']([^"']+\.(?:png|jpe?g|webp|svg|ico)(?:[?#][^"']*)?)["']/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) addRef(filePath, relativePath, match[1]);
  }
}

walk(root);

for (const { filePath, relativePath, ref } of refs) {
  const candidates = [
    resolve(dirname(filePath), ref),
    resolve(root, ref)
  ];
  if (!candidates.some((candidate) => existsSync(candidate) && statSync(candidate).isFile())) {
    failures.push(`${relativePath}: missing ${ref}`);
  }
}

const uniqueFailures = [...new Set(failures)].sort();
if (uniqueFailures.length) {
  console.error("Image asset validation failed:");
  for (const failure of uniqueFailures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Image asset validation passed (${refs.length} local references checked).`);
