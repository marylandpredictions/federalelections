import { writeFile } from "node:fs/promises";

const CHANNEL_ID = "UCNFTZPs_CNhoCRCr5u441YA";
const CHANNEL_URL = "https://www.youtube.com/@FedElections";
const RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function tag(entry, name) {
  const escaped = name.replace(":", "\\:");
  const match = entry.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function attr(entry, name, attribute) {
  const escaped = name.replace(":", "\\:");
  const match = entry.match(new RegExp(`<${escaped}[^>]*\\s${attribute}="([^"]+)"`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function isMembersOnly(video) {
  return /\bmembers?[- ]only\b|\bmember exclusive\b|\bpaid members\b/i.test(video.title);
}

function isLivestream(video) {
  return /\blive\b|livestream|live stream/i.test(video.title);
}

function videoFromEntry(entry) {
  const id = tag(entry, "yt:videoId");
  const title = tag(entry, "title");
  const published = tag(entry, "published");
  const updated = tag(entry, "updated");
  const url = attr(entry, "link", "href") || `https://www.youtube.com/watch?v=${id}`;
  return {
    id,
    title,
    published,
    updated,
    url,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
    thumbnail: attr(entry, "media:thumbnail", "url"),
    kind: isLivestream({ title }) ? "livestream" : "upload"
  };
}

async function main() {
  const response = await fetch(RSS_URL, {
    headers: { "User-Agent": "Federal Elections Analysis video updater" }
  });
  if (!response.ok) throw new Error(`YouTube RSS returned ${response.status}`);
  const xml = await response.text();
  const entries = [...xml.matchAll(/<entry[\s\S]*?<\/entry>/gi)]
    .map((match) => videoFromEntry(match[0]))
    .filter((video) => video.id && video.title && !isMembersOnly(video));

  const now = Date.now();
  const livestreams = entries.filter((video) => video.kind === "livestream");
  const uploads = entries.filter((video) => video.kind === "upload").slice(0, 4);
  
  // Check if livestream is upcoming (published in future) or latest (published in past)
  const upcomingLivestream = livestreams.find((video) => Date.parse(video.published) > now) || null;
  const latestLivestream = livestreams.find((video) => Date.parse(video.published) <= now) || null;

  const payload = {
    generatedAt: new Date().toISOString(),
    channelId: CHANNEL_ID,
    channelUrl: CHANNEL_URL,
    upcomingLivestream,
    latestLivestream,
    latestUploads: uploads
  };

  await writeFile("data/videos.json", `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote data/videos.json with ${uploads.length} public uploads`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
