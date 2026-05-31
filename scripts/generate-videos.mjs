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

function looksLikeLivestream(video) {
  return /\blive\b|livestream|live stream/i.test(video.title);
}

function looksUpcoming(video) {
  return /\bupcoming\b|\bscheduled\b|\bpreview\b|\bstarts\b|\btonight\b|\btomorrow\b/i.test(`${video.title} ${video.description || ""}`);
}

function videoFromEntry(entry) {
  const id = tag(entry, "yt:videoId");
  const title = tag(entry, "title");
  const published = tag(entry, "published");
  const updated = tag(entry, "updated");
  const description = tag(entry, "media:description");
  const url = attr(entry, "link", "href") || `https://www.youtube.com/watch?v=${id}`;
  const livestream = looksLikeLivestream({ title, description });
  const upcoming = livestream && (Date.parse(published) > Date.now() || looksUpcoming({ title, description }));
  return {
    id,
    title,
    published,
    updated,
    url,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
    thumbnail: attr(entry, "media:thumbnail", "url"),
    kind: livestream ? "livestream" : "upload",
    status: upcoming ? "upcoming" : livestream ? "replay" : "upload"
  };
}

async function livestreamStatusFromWatchPage(video) {
  try {
    const response = await fetch(video.url, {
      headers: { "User-Agent": "Mozilla/5.0 Federal Elections Analysis video updater" }
    });
    if (!response.ok) return video.status;
    const html = await response.text();
    if (/"isUpcoming"\s*:\s*true/.test(html) || /LIVE_STREAM_OFFLINE/.test(html)) return "upcoming";
    if (/"isLiveNow"\s*:\s*true/.test(html) || /LIVE_NOW/.test(html)) return "live";
    const timestamp = html.match(/"startTimestamp"\s*:\s*"([^"]+)"/)?.[1];
    if (timestamp && Date.parse(timestamp) > Date.now()) return "upcoming";
  } catch {
    return video.status;
  }
  return video.status;
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

  const livestreams = entries.filter((video) => video.kind === "livestream");
  const uploads = entries.filter((video) => video.kind === "upload").slice(0, 4);
  for (const video of livestreams) {
    video.status = await livestreamStatusFromWatchPage(video);
  }

  const upcomingLivestream = livestreams.find((video) => video.status === "upcoming") || null;
  const latestLivestream = livestreams.find((video) => video.status === "replay" || video.status === "live") || null;

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
