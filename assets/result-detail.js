const page = document.getElementById("result-page");
const raceId = new URLSearchParams(window.location.search).get("id");
let countyMapDataPromise = null;
let districtMapDataPromise = null;
let governorForecastPromise = null;
let resultMapViewState = {
  zoom: 1,
  panX: 0,
  panY: 0
};
const PROFILE_BG_COLOR_CACHE_VERSION = "ring-v2";
const PROFILE_BG_COLOR_CACHE = new Map();
const PROFILE_BG_COLOR_PROMISES = new Map();

function profileBgColorCacheKey(url) {
  return `${PROFILE_BG_COLOR_CACHE_VERSION}:${url}`;
}

const REDISTRICTED_RESULT_STATES = new Set(["AL", "LA", "NC", "OH", "TX", "UT"]);
const MANUAL_INCUMBENTS_BY_RACE = {
  "79881": ["Tony K. Thurmond"],
  "79883": ["Mark DeSaulnier"],
  "79886": ["Adam Gray"],
  "79896": ["David G. Valadao"],
  "79907": ["Brad Sherman"],
  "79909": ["Jimmy Gomez"],
  "79916": ["Ken Calvert", "Young Kim"],
  "79932": ["Doris Matsui"],
  "79938": ["Karen Ruth Bass"],
  "80203": ["Mariannette Miller-Meeks"],
  "80461": ["Larry Rhoden"],
  "80512": ["Mike Rounds"],
  "81014": ["Ben R Lujan"],
  "81044": ["Frank Pallone Jr.."],
  "81048": ["Rob Menendez"],
  "81057": ["Cory Booker"]
};

const CANDIDATE_PHOTO_SETS = {
  "79778": {
    base: "assets/img/candidates/california-insurance-commissioner",
    photos: {
      "ben-allen": "ben-allen.png",
      "steven-craig-bradford": "steven-craig-bradford.png",
      "jane-kim": "jane-kim.png",
      "stacy-a-korsgaden": "stacy-a-korsgaden.png"
    },
    colors: {
      "ben-allen": "#17a7e8",
      "steven-craig-bradford": "#565cf4",
      "jane-kim": "#55ca2d",
      "stacy-a-korsgaden": "#e27415"
    }
  },
  "79893": {
    base: "assets/img/candidates/california-us-house-1",
    photos: {
      "audrey-denney": "audrey-denney.png",
      "mike-mcguire": "mike-mcguire.png",
      "james-gallagher": "james-gallagher.png"
    },
    colors: {
      "audrey-denney": "#6c5cff",
      "mike-mcguire": "#23d5d8",
      "james-gallagher": "#c4162f"
    }
  },
  "79779": {
    base: "assets/img/candidates/california-lieutenant-governor",
    photos: {
      "josh-fryday": "josh-fryday.png",
      "fiona-ma": "fiona-ma.png",
      "michael-tubbs": "michael-tubbs.png",
      "oliver-ma": "oliver-ma.png",
      "david-fennell": "david-fennell.png",
      "gloria-romero": "gloria-romero.png"
    },
    colors: {
      "josh-fryday": "#0091ff",
      "fiona-ma": "#52ca2b",
      "michael-tubbs": "#6263f5",
      "oliver-ma": "#28d7db",
      "david-fennell": "#d97a18",
      "gloria-romero": "#e4d000"
    }
  },
  "79884": {
    base: "assets/img/candidates/california-us-house-11",
    photos: {
      "saikat-chakrabarti": "saikat-chakrabarti.png",
      "connie-chan": "connie-chan.png",
      "scott-wiener": "scott-wiener.png"
    },
    colors: {
      "saikat-chakrabarti": "#6b42d8",
      "connie-chan": "#0091ff",
      "scott-wiener": "#25d6d6"
    }
  },
  "79896": {
    base: "assets/img/candidates/california-us-house-22",
    photos: {
      "jasmeet-bains": "jasmeet-bains.png",
      "randy-villegas": "randy-villegas.png",
      "david-g-valadao": "david-g-valadao.png"
    },
    colors: {
      "jasmeet-bains": "#4361ff",
      "randy-villegas": "#26d6d6",
      "david-g-valadao": "#d86f19"
    }
  },
  "79907": {
    base: "assets/img/candidates/california-us-house-32",
    photos: {
      "jake-levine": "jake-levine.png",
      "marena-lin": "marena-lin.png",
      "brad-sherman": "brad-sherman.png",
      "larry-thompson": "larry-thompson.png"
    },
    colors: {
      "jake-levine": "#0091ff",
      "marena-lin": "#25d6d6",
      "brad-sherman": "#5360f6",
      "larry-thompson": "#8dde18"
    }
  },
  "79932": {
    base: "assets/img/candidates/california-us-house-7",
    photos: {
      "doris-matsui": "doris-matsui.png",
      "mai-vang": "mai-vang.png"
    },
    colors: {
      "doris-matsui": "#0091ff",
      "mai-vang": "#25d6d6"
    }
  },
  "79916": {
    base: "assets/img/candidates/california-us-house-40",
    photos: {
      "joe-kerr": "joe-kerr.png",
      "esther-kim-varet": "esther-kim-varet.png",
      "ken-calvert": "ken-calvert.png",
      "young-kim": "young-kim.png"
    },
    colors: {
      "joe-kerr": "#0091ff",
      "esther-kim-varet": "#5560f6",
      "ken-calvert": "#c56517",
      "young-kim": "#dec30f"
    }
  },
  "79777": {
    base: "assets/img/candidates/california-governor",
    photos: {
      "antonio-villaraigosa": "villaraigosa.png",
      "tony-k-thurmond": "thurmond.png",
      "eric-swalwell": "swalwell.png",
      "tom-steyer": "steyer.png",
      "katie-porter": "porter.png",
      "matt-mahan": "mahan.png",
      "xavier-becerra": "becerra.png",
      "steve-hilton": "hilton.png",
      "chad-bianco": "bianco.png"
    },
    colors: {
      "antonio-villaraigosa": "#24dcae",
      "tony-k-thurmond": "#1493f6",
      "eric-swalwell": "#99e600",
      "tom-steyer": "#4fc92a",
      "katie-porter": "#5765ff",
      "matt-mahan": "#2fdde0",
      "xavier-becerra": "#1493f6",
      "steve-hilton": "#bf0000",
      "chad-bianco": "#d97112"
    }
  },
  "79881": {
    base: "assets/img/candidates/california-superintendent",
    photos: {
      "richard-barrera": "richard-barrera.png",
      "nichelle-m-henderson": "nichelle-henderson.png",
      "al-muratsuchi": "al-muratsuchi.png",
      "josh-newman": "josh-newman.png",
      "anthony-rendon": "anthony-rendon.png",
      "sonja-shaw": "sonja-shaw.png"
    },
    colors: {
      "richard-barrera": "#0091ff",
      "nichelle-m-henderson": "#5560f6",
      "al-muratsuchi": "#25d6d6",
      "josh-newman": "#0091ff",
      "anthony-rendon": "#8dde18",
      "sonja-shaw": "#e6c900"
    }
  }
};

const GLOBAL_CANDIDATE_PHOTOS = {
  "abel-chavez": { file: "abel-chavez.png", color: "#6263f5" },
  "adam-hamawy": { file: "adam-hamawy.png", color: "#1493f6" },
  "adam-miller": { file: "adam-miller.png", color: "#c5162e" },
  "adam-steen": { file: "adam-steen.png", color: "#c5162e" },
  "adrian-o-mapp": { file: "adrian-o-mapp.png", color: "#1493f6" },
  "ammar-campa-najjar": { file: "ammar-campa-najjar.png", color: "#1493f6" },
  "angela-gonzales-torres": { file: "angela-gonzales-torres.png", color: "#6263f5" },
  "ashley-hinson": { file: "ashley-hinson.png", color: "#c5162e" },
  "ben-r-lujan": { file: "ben-r-lujan.png", color: "#1493f6" },
  "brad-cohen": { file: "brad-cohen.png", color: "#25d6d6" },
  "brad-sherman": { file: "brad-sherman-ia.png", color: "#c5162e" },
  "brian-varela": { file: "brian-varela.png", color: "#1493f6" },
  "cory-booker": { file: "cory-booker.png", color: "#1493f6" },
  "deb-haaland": { file: "deb-haaland.png", color: "#1493f6" },
  "duke-rodriguez": { file: "duke-rodriguez.png", color: "#d97a18" },
  "dusty-johnson": { file: "dusty-johnson.png", color: "#c5162e" },
  "greggory-d-hull": { file: "greggory-d-hull.png", color: "#d97a18" },
  "jay-vaingankar": { file: "jay-vaingankar.png", color: "#25d6d6" },
  "jim-carlin": { file: "jim-carlin.png", color: "#c5162e" },
  "jim-desmond": { file: "jim-desmond.png", color: "#d97a18" },
  "jimmy-gomez": { file: "jimmy-gomez.png", color: "#6263f5" },
  "jon-hansen": { file: "jon-hansen.png", color: "#c5162e" },
  "josh-turek": { file: "josh-turek.png", color: "#1493f6" },
  "justin-murphy": { file: "justin-murphy.png", color: "#c5162e" },
  "karen-ruth-bass": { file: "karen-ruth-bass.png", color: "#1493f6" },
  "kurt-alme": { file: "kurt-alme.png", color: "#c5162e" },
  "larry-rhoden": { file: "larry-rhoden.png", color: "#c5162e" },
  "marni-von-wilpert": { file: "marni-von-wilpert.png", color: "#25d6d6" },
  "matt-adams": { file: "matt-adams.png", color: "#6263f5" },
  "matt-rains": { file: "matt-rains.png", color: "#6263f5" },
  "michael-roth": { file: "michael-roth.png", color: "#6263f5" },
  "mike-rounds": { file: "mike-rounds.png", color: "#c5162e" },
  "mussab-ali": { file: "mussab-ali.png", color: "#1493f6" },
  "nithya-raman": { file: "nithya-raman.png", color: "#1493f6" },
  "rae-chen-huang": { file: "rae-chen-huang.png", color: "#6263f5" },
  "randy-feenstra": { file: "randy-feenstra.png", color: "#c5162e" },
  "rebecca-bennett": { file: "rebecca-bennett.png", color: "#25d6d6" },
  "rob-menendez": { file: "rob-menendez.png", color: "#6263f5" },
  "rob-sand": { file: "rob-sand.png", color: "#1493f6" },
  "robert-s-lebovics": { file: "robert-s-lebovics.png", color: "#c5162e" },
  "russell-cleveland": { file: "russell-cleveland.png", color: "#1493f6" },
  "ryan-busse": { file: "ryan-busse.png", color: "#25d6d6" },
  "sam-bregman": { file: "sam-bregman.png", color: "#6263f5" },
  "sam-forstag": { file: "sam-forstag.png", color: "#45cd47" },
  "sam-wang": { file: "sam-wang.png", color: "#d97a18" },
  "spencer-pratt": { file: "spencer-pratt.png", color: "#6263f5" },
  "sue-altman": { file: "sue-altman.png", color: "#1493f6" },
  "tina-shah": { file: "tina-shah.png", color: "#45cd47" },
  "toby-doeden": { file: "toby-doeden.png", color: "#c5162e" },
  "verlina-reynolds-jackson": { file: "verlina-reynolds-jackson.png", color: "#25d6d6" },
  "zach-lahn": { file: "zach-lahn.png", color: "#d97a18" },
  "zach-wahls": { file: "zach-wahls.png", color: "#1493f6" }
};

const ANALYST_PROFILES = {
  "fea-analysis-desk": {
    name: "FEA Analysis Desk",
    image: "assets/img/FEA_Icon.png"
  },
  "federal-elections-analysis": {
    name: "Federal Elections Analysis",
    image: "assets/img/FEA_Icon.png"
  },
  "nathan-wang": {
    name: "Nathan Wang",
    image: "assets/img/analysts/nathan-wang.png"
  },
  "gamerdoglover": {
    name: "gamerdoglover",
    image: "assets/img/analysts/gamerdoglover.png"
  }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function numberLabel(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("en-US") : "0";
}

function percentLabel(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? `${number.toFixed(1)}%` : "0.0%";
}

function signedPointMargin(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || Math.abs(number) < .05) return "Even";
  return `${number > 0 ? "D" : "R"}+${Math.abs(number).toFixed(1)} pts`;
}

function dateLabel(value) {
  if (!value) return "Date TBA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date TBA";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date);
}

function timeLabel(value) {
  if (!value) return "Awaiting update";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Awaiting update";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function partyCode(party) {
  const value = String(party || "").toLowerCase();
  if (value.includes("dem")) return "D";
  if (value.includes("rep") || value.includes("gop")) return "R";
  if (value.includes("libertarian")) return "L";
  if (value.includes("green")) return "G";
  if (value.includes("independent") || value.includes("no party")) return "I";
  return party ? party.slice(0, 1).toUpperCase() : "";
}

function displayParty(party) {
  const value = String(party || "").trim();
  return /no party preference/i.test(value) ? "Independent" : value;
}

function partyClass(partyCodeValue) {
  if (partyCodeValue === "D") return "party-dem";
  if (partyCodeValue === "R") return "party-rep";
  if (partyCodeValue === "I") return "party-ind";
  return "party-other";
}

function candidateNameParts(name) {
  return String(name || "")
    .replace(/"[^"]*"/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z-]/g, ""))
    .filter(Boolean);
}

function candidateInitials(name) {
  const parts = candidateNameParts(name);
  if (!parts.length) return "?";
  if (parts.length === 1) {
    const word = parts[0];
    return (word.length >= 2 ? word.slice(0, 2) : word.slice(0, 1)).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function isHexColor(value) {
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(value || "").trim());
}

function slugifyName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function candidatePhotoUrl(race, candidate) {
  const photoSet = CANDIDATE_PHOTO_SETS[String(race?.id)];
  const slug = slugifyName(candidate?.name);
  if (photoSet?.photos?.[slug]) return `${photoSet.base}/${photoSet.photos[slug]}`;
  const globalPhoto = GLOBAL_CANDIDATE_PHOTOS[slug];
  return globalPhoto ? `assets/img/candidates/live-results/${globalPhoto.file}` : "";
}

function candidatePhotoColor(race, candidate) {
  const slug = slugifyName(candidate?.name);
  return CANDIDATE_PHOTO_SETS[String(race?.id)]?.colors?.[slug] || GLOBAL_CANDIDATE_PHOTOS[slug]?.color || "";
}

function rgbToHex(r, g, b) {
  const channel = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function quantizeChannel(value, step = 32) {
  return Math.max(0, Math.min(255, Math.round(value / step) * step));
}

function colorSaturation(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max <= 0) return 0;
  return (max - min) / max;
}

function colorLuminance(r, g, b) {
  return .2126 * r + .7152 * g + .0722 * b;
}

function isHalftoneDotPixel(r, g, b) {
  return colorLuminance(r, g, b) > 232 && colorSaturation(r, g, b) < .12;
}

function isLetterboxPixel(r, g, b) {
  return colorLuminance(r, g, b) < 28 && colorSaturation(r, g, b) < .12;
}

function dominantProfileBgColorFromImage(image) {
  const width = Math.max(64, Math.min(192, image.naturalWidth || image.width || 96));
  const height = Math.max(64, Math.min(192, image.naturalHeight || image.height || 96));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "";
  context.drawImage(image, 0, 0, width, height);
  let data;
  try {
    data = context.getImageData(0, 0, width, height).data;
  } catch {
    return "";
  }
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2;
  const buckets = new Map();
  const addPixel = (r, g, b, weight) => {
    const key = `${quantizeChannel(r)}-${quantizeChannel(g)}-${quantizeChannel(b)}`;
    const bucket = buckets.get(key) || { score: 0, r: 0, g: 0, b: 0 };
    bucket.score += weight;
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
    buckets.set(key, bucket);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.hypot(dx, dy) / radius;
      if (dist > .94) continue;
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      if (alpha < 160) continue;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      if (isLetterboxPixel(r, g, b) || isHalftoneDotPixel(r, g, b)) continue;
      const inBackgroundRing = dist >= .42 && dist <= .9;
      const inCornerWedge = dist >= .55 && dist <= .92 && (Math.abs(dx) > radius * .22 || Math.abs(dy) > radius * .22);
      if (!inBackgroundRing && !inCornerWedge) continue;
      const saturation = colorSaturation(r, g, b);
      const weight = 1 + saturation * 2.5;
      addPixel(r, g, b, weight);
    }
  }
  let winner = null;
  for (const bucket of buckets.values()) {
    if (!winner || bucket.score > winner.score) winner = bucket;
  }
  if (!winner || winner.score < 18) return "";
  const totalWeight = winner.score;
  return rgbToHex(winner.r / totalWeight, winner.g / totalWeight, winner.b / totalWeight);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    image.src = url;
  });
}

async function candidatePhotoExtractedColor(race, candidate) {
  const photoUrl = candidatePhotoUrl(race, candidate);
  if (!photoUrl) return "";
  const cacheKey = profileBgColorCacheKey(photoUrl);
  if (PROFILE_BG_COLOR_CACHE.has(cacheKey)) return PROFILE_BG_COLOR_CACHE.get(cacheKey) || "";
  if (!PROFILE_BG_COLOR_PROMISES.has(cacheKey)) {
    const promise = loadImage(photoUrl)
      .then((image) => dominantProfileBgColorFromImage(image))
      .catch(() => "")
      .then((color) => {
        const safeColor = isHexColor(color) ? color : "";
        PROFILE_BG_COLOR_CACHE.set(cacheKey, safeColor);
        PROFILE_BG_COLOR_PROMISES.delete(cacheKey);
        return safeColor;
      });
    PROFILE_BG_COLOR_PROMISES.set(cacheKey, promise);
  }
  return PROFILE_BG_COLOR_PROMISES.get(cacheKey) || "";
}

function simplifiedSlug(value) {
  return slugifyName(value)
    .split("-")
    .filter((part) => part && part.length > 1 && !["jr", "sr", "ii", "iii", "iv", "v"].includes(part))
    .join("-");
}

function raceCandidateBySlug(race, candidate) {
  const slug = slugifyName(candidate?.name);
  const slimSlug = simplifiedSlug(candidate?.name);
  if (!slug && !slimSlug) return null;
  return (race?.candidates || []).find((raceCandidate) => {
    const raceSlug = slugifyName(raceCandidate?.name);
    if (slug && raceSlug === slug) return true;
    if (!slimSlug) return false;
    return simplifiedSlug(raceCandidate?.name) === slimSlug;
  }) || null;
}

function candidateCustomColor(race, candidate) {
  if (!candidate) return "";
  const photoUrl = candidatePhotoUrl(race, candidate);
  const extractedColor = photoUrl ? (PROFILE_BG_COLOR_CACHE.get(profileBgColorCacheKey(photoUrl)) || "") : "";
  if (isHexColor(extractedColor)) return extractedColor;
  const profileColor = candidatePhotoColor(race, candidate);
  if (isHexColor(profileColor)) return profileColor;
  const directColor = String(candidate?.color || "").trim();
  if (isHexColor(directColor)) return directColor;
  return "";
}

async function primeCandidatePhotoBgColors(race) {
  const seen = new Set();
  const candidates = [
    ...(race?.candidates || []),
    ...((race?.counties || []).flatMap((county) => county?.candidates || []))
  ].filter(Boolean);
  const tasks = [];
  for (const candidate of candidates) {
    const photoUrl = candidatePhotoUrl(race, candidate);
    if (!photoUrl || seen.has(photoUrl)) continue;
    seen.add(photoUrl);
    tasks.push(candidatePhotoExtractedColor(race, candidate));
  }
  await Promise.all(tasks);
}

function safeMediaUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^(https?:)?\/\//i.test(url) || /^assets\//i.test(url) || /^data\/article-images\//i.test(url)) return url;
  return "";
}

function normalizedExternalEmbedUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.href);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtube.com" || host === "m.youtube.com") {
      const videoId = url.searchParams.get("v");
      if (videoId && /^[a-zA-Z0-9_-]{6,}$/.test(videoId)) return `https://www.youtube.com/embed/${videoId}`;
      if (url.pathname.startsWith("/embed/")) return url.href;
    }
    if (host === "youtu.be") {
      const videoId = url.pathname.replace("/", "");
      if (videoId && /^[a-zA-Z0-9_-]{6,}$/.test(videoId)) return `https://www.youtube.com/embed/${videoId}`;
    }
    const allowedHosts = new Set([
      "youtube.com",
      "player.vimeo.com",
      "docs.google.com",
      "drive.google.com",
      "datawrapper.dwcdn.net",
      "flo.uri.sh",
      "public.flourish.studio",
      "observablehq.com"
    ]);
    if (!allowedHosts.has(host) || url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

const POLL_CLOSE_UTC_BY_STATE = {
  CA: "2026-06-03T03:00:00Z",
  IA: "2026-06-03T01:00:00Z",
  MT: "2026-06-03T02:00:00Z",
  NJ: "2026-06-03T00:00:00Z",
  NM: "2026-06-03T01:00:00Z",
  SD: "2026-06-03T01:00:00Z"
};

const POLL_OPEN_UTC_BY_STATE = {
  CA: "2026-06-02T14:00:00Z",
  IA: "2026-06-02T12:00:00Z",
  MT: "2026-06-02T13:00:00Z",
  NJ: "2026-06-02T10:00:00Z",
  NM: "2026-06-02T13:00:00Z",
  SD: "2026-06-02T12:00:00Z"
};

function validElectionIso(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2020) return "";
  return date.toISOString();
}

function pollCloseIso(race) {
  return validElectionIso(race?.pollsClose) || POLL_CLOSE_UTC_BY_STATE[String(race.state || "").toUpperCase()] || "";
}

function pollOpenIso(race) {
  return validElectionIso(race?.pollsOpen) || POLL_OPEN_UTC_BY_STATE[String(race.state || "").toUpperCase()] || "";
}

function pollCloseLabel(iso) {
  if (!iso) return "Poll closing time TBA";
  const closeDate = new Date(iso);
  const ms = closeDate.getTime() - Date.now();
  if (!Number.isFinite(ms)) return "Poll closing time TBA";
  if (ms <= 0) return "Polls closed";
  const totalMinutes = Math.ceil(ms / 60000);
  if (totalMinutes > 180) {
    const time = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York"
    }).format(closeDate);
    return `Polls close at ${time} EST`;
  }
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `Polls close in ${hours}h ${minutes}m`;
  return `Polls close in ${minutes}m`;
}

function bindPollCountdown() {
  const nodes = page.querySelectorAll("[data-poll-close]");
  const update = () => nodes.forEach((node) => {
    node.textContent = pollCloseLabel(node.dataset.pollClose);
  });
  update();
}

function noteImageMarkup(value) {
  const block = typeof value === "string" ? { url: value } : (value || {});
  const url = safeMediaUrl(block.url || block.src);
  if (!url) return "";
  const size = ["small", "medium", "large", "full"].includes(block.size) ? block.size : "medium";
  const caption = block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : "";
  return `
    <figure class="analysis-note-media analysis-note-media-${escapeHtml(size)}">
      <img src="${escapeHtml(url)}" alt="${escapeHtml(block.alt || block.caption || "")}" loading="lazy">
      ${caption}
    </figure>
  `;
}

function noteExternalEmbedMarkup(value) {
  const block = typeof value === "string" ? { url: value } : (value?.embed || value || {});
  const url = normalizedExternalEmbedUrl(block.url || block.src);
  if (!url) return "";
  const size = ["small", "medium", "large", "full"].includes(block.size) ? block.size : "large";
  const height = Math.min(900, Math.max(180, Number(block.height) || 320));
  const caption = block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : "";
  return `
    <figure class="analysis-note-embed analysis-note-embed-${escapeHtml(size)}">
      <iframe
        src="${escapeHtml(url)}"
        title="${escapeHtml(block.title || block.alt || "Analyst note embed")}"
        height="${height}"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        allow="fullscreen; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen></iframe>
      ${caption}
    </figure>
  `;
}

async function loadGovernorForecast() {
  if (!governorForecastPromise) {
    governorForecastPromise = fetch("data/governor-forecast.json", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .catch(() => null);
  }
  return governorForecastPromise;
}

function governorPreviewMarkup(race, title = "") {
  if (!race) return `<p class="meta">Governor forecast preview is not available.</p>`;
  const leader = race.demProbability >= .5 ? "Democrat" : "Republican";
  const leaderProb = Math.max(race.demProbability || 0, race.repProbability || 0);
  const ratingClass = race.demProbability >= .5 ? "leads-dem" : "leads-rep";
  return `
    <section class="analysis-note-forecast ${ratingClass}">
      <span class="chart-label">${escapeHtml(title || `${race.displayName} forecast preview`)}</span>
      <div class="map-card-title">
        <div class="state-code">${escapeHtml(race.state)}</div>
        <span class="rating-pill">${escapeHtml(race.rating || "Rating")}</span>
      </div>
      <h3>${leader} ${percentLabel(leaderProb * 100)} chance</h3>
      <div class="candidate-table" aria-label="${escapeHtml(race.displayName)} forecast preview">
        <div class="candidate-table-head"><span>Party</span><span>Chance</span></div>
        <div class="candidate-row dem-row"><span>Democrat <i class="party-badge dem-badge">D</i></span><strong>${percentLabel((race.demProbability || 0) * 100)}</strong></div>
        <div class="candidate-row rep-row"><span>Republican <i class="party-badge rep-badge">R</i></span><strong>${percentLabel((race.repProbability || 0) * 100)}</strong></div>
        <div class="candidate-margin"><span>Projected margin</span><strong>${signedPointMargin(race.margin)}</strong></div>
      </div>
      <p>${escapeHtml(race.status || "Governor race")}. Incumbent party: ${escapeHtml(race.incumbentParty || "Unknown")}.</p>
    </section>
  `;
}

async function noteEmbedMarkup(value) {
  const block = typeof value === "string" ? { url: value } : (value?.embed || value || {});
  if (["governor-race-preview", "governor-state-preview"].includes(block.type)) {
    const forecast = await loadGovernorForecast();
    const state = String(block.state || "").toUpperCase();
    const race = forecast?.races?.find((item) => item.state === state);
    return governorPreviewMarkup(race, block.title);
  }
  return noteExternalEmbedMarkup(block);
}

function isIncumbentCandidate(race, candidate) {
  const manualNames = MANUAL_INCUMBENTS_BY_RACE[String(race?.id)] || [];
  const candidateName = String(candidate?.name || "").toLowerCase();
  return Boolean(candidate?.incumbent || candidate?.isIncumbent || candidate?.is_incumbent)
    || manualNames.some((name) => name.toLowerCase() === candidateName);
}

function incumbentMark(race, candidate) {
  return isIncumbentCandidate(race, candidate)
    ? `<span class="result-incumbent-mark" title="Incumbent" aria-label="Incumbent">*</span>`
    : "";
}

function markerClass(marker) {
  return `marker-${marker?.kind || "general"}`;
}

function leadingCandidate(race) {
  return sortedCandidates(race)[0] || null;
}

function hasReportedVotes(candidates) {
  return candidates.some((candidate) => Number(candidate.votes || 0) > 0 || Number(candidate.percent || 0) > 0);
}

function sortedCandidates(race) {
  const candidates = [...(race?.candidates || [])];
  const hasCalls = candidates.some((candidate) => candidate.callLabel);
  if (hasReportedVotes(candidates)) {
    return candidates.sort((a, b) => (
      Number(Boolean(b.callLabel)) - Number(Boolean(a.callLabel))
      || Number(b.percent || 0) - Number(a.percent || 0)
      || Number(b.votes || 0) - Number(a.votes || 0)
      || String(a.name || "").localeCompare(String(b.name || ""))
    ));
  }
  if (hasCalls) {
    return candidates.sort((a, b) => (
      Number(Boolean(b.callLabel)) - Number(Boolean(a.callLabel))
      || String(a.name || "").localeCompare(String(b.name || ""))
    ));
  }
  const featuredNames = (race?.featuredCandidateNames || []).map((name) => String(name).toLowerCase());
  if (!featuredNames.length) return candidates;
  return candidates.sort((a, b) => {
    const aRank = featuredNames.indexOf(String(a.name || "").toLowerCase());
    const bRank = featuredNames.indexOf(String(b.name || "").toLowerCase());
    const aValue = aRank === -1 ? Number.POSITIVE_INFINITY : aRank;
    const bValue = bRank === -1 ? Number.POSITIVE_INFINITY : bRank;
    return aValue - bValue;
  });
}

function sortedCandidatesForCounty(race) {
  const candidates = [...(race?.candidates || [])];
  if (hasReportedVotes(candidates)) {
    return candidates.sort((a, b) => (
      Number(b.percent || 0) - Number(a.percent || 0)
      || Number(b.votes || 0) - Number(a.votes || 0)
      || String(a.name || "").localeCompare(String(b.name || ""))
    ));
  }
  const featuredNames = (race?.featuredCandidateNames || []).map((name) => String(name).toLowerCase());
  if (!featuredNames.length) return candidates;
  return candidates.sort((a, b) => {
    const aRank = featuredNames.indexOf(String(a.name || "").toLowerCase());
    const bRank = featuredNames.indexOf(String(b.name || "").toLowerCase());
    const aValue = aRank === -1 ? Number.POSITIVE_INFINITY : aRank;
    const bValue = bRank === -1 ? Number.POSITIVE_INFINITY : bRank;
    return aValue - bValue;
  });
}

function candidateFill(race, candidate) {
  const customColor = candidateCustomColor(race, candidate);
  if (isHexColor(customColor)) return customColor;
  const matchedRaceCandidate = raceCandidateBySlug(race, candidate);
  const matchedColor = candidateCustomColor(race, matchedRaceCandidate);
  if (isHexColor(matchedColor)) return matchedColor;
  const code = candidate?.partyCode || partyCode(candidate?.party);
  if (code === "D") return "#1030b2";
  if (code === "R") return "#e03a3e";
  if (code === "I") return "#2f9f83";
  return "#7a6fe8";
}

function hexToRgb(hex) {
  const clean = String(hex || "").replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((char) => char + char).join("") : clean;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return { r: 122, g: 111, b: 232 };
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
}

function mixColor(from, to, amount) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const t = Math.max(0, Math.min(1, amount));
  const channel = (start, end) => Math.round(start + (end - start) * t).toString(16).padStart(2, "0");
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
}

function marginCandidates(region) {
  const candidates = [...(region?.candidates || [])];
  const hasVotes = candidates.some((candidate) => Number(candidate.votes || 0) > 0);
  return candidates.sort((a, b) => {
    if (hasVotes) return Number(b.votes || 0) - Number(a.votes || 0) || Number(b.percent || 0) - Number(a.percent || 0);
    return Number(b.percent || 0) - Number(a.percent || 0);
  });
}

function resultMarginInfo(race, region) {
  const [leader, runnerUp] = marginCandidates(region);
  const totalVotes = (region?.candidates || []).reduce((sum, candidate) => sum + Number(candidate.votes || 0), 0);
  if (!leader || (!totalVotes && !Number(leader.percent || 0))) return null;
  const voteMargin = Math.max(0, Number(leader.votes || 0) - Number(runnerUp?.votes || 0));
  const percentMargin = Math.max(0, Number(leader.percent || 0) - Number(runnerUp?.percent || 0));
  const baseColor = candidateFill(race, leader);
  const percentStrength = Math.min(1, percentMargin / 20);
  const voteStrength = Math.min(1, Math.log10(voteMargin + 1) / 4);
  return {
    leader,
    percentMargin,
    voteMargin,
    percentFill: mixColor("#d6d9e2", baseColor, .28 + percentStrength * .72),
    voteFill: mixColor("#d6d9e2", baseColor, .28 + voteStrength * .72)
  };
}

function callBadge(candidate, race) {
  if (!candidate.callLabel) return "";
  const compactLabel = String(candidate.callLabel)
    .replace(/^Projected winner$/i, "Projected")
    .replace(/^Advanced to general election$/i, "Advanced");
  return `<span class="result-call-badge"><i aria-hidden="true">&#8594;</i>${escapeHtml(compactLabel)}</span>`;
}

function callVerb(label, race, count) {
  const text = String(label || "").toLowerCase();
  const raceText = `${race.electionScope || race.electionName || ""}`.toLowerCase();
  if (text.includes("advance") || raceText.includes("open primary") || count > 1) return count > 1 ? "advance" : "advances";
  if (text.includes("project")) return "is projected to win";
  return "wins";
}

function callDeckText(race, calledCandidates) {
  const names = calledCandidates.map((candidate) => candidate.name).filter(Boolean);
  if (!names.length) return "Race call posted.";
  const label = calledCandidates[0]?.callLabel || "Winner";
  const verb = callVerb(label, race, names.length);
  const raceName = race.electionName || "this race";
  if (names.length === 1) return `${names[0]} ${verb} ${raceName}.`;
  if (names.length === 2) return `${names[0]} and ${names[1]} ${verb} in ${raceName}.`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)} ${verb} in ${raceName}.`;
}

function raceCallBanner(race) {
  const calls = race.calls || [];
  if (!calls.length) return "";
  const calledCandidates = sortedCandidates(race).filter((candidate) => candidate.callLabel);
  const fallbackCandidates = calls.map((call) => ({
    name: call.candidate || "Candidate",
    party: "",
    partyCode: "",
    callLabel: callLabelForDisplay(call, race)
  }));
  const bannerCandidates = calledCandidates.length ? calledCandidates : fallbackCandidates;
  const primary = bannerCandidates[0] || null;
  const photo = primary ? candidatePhotoUrl(race, primary) : "";
  const fill = primary ? candidateFill(race, primary) : "#49d38a";
  const callLabel = primary?.callLabel || "Race call";
  const avatars = bannerCandidates.slice(0, 3).map((candidate) => {
    const avatarPhoto = candidatePhotoUrl(race, candidate);
    return `
      <span class="result-call-avatar" style="--candidate-color:${escapeHtml(candidateFill(race, candidate))}">
        ${avatarPhoto ? `<img src="${escapeHtml(avatarPhoto)}" alt="">` : escapeHtml(candidateInitials(candidate.name))}
      </span>
    `;
  }).join("");
  return `
    <div class="result-call-alert" style="--candidate-color:${escapeHtml(fill)}" role="status">
      <div class="result-call-copy">
        <span>${escapeHtml(callLabel)} <i aria-hidden="true">&#8594;</i></span>
        <strong>${escapeHtml(callDeckText(race, bannerCandidates))}</strong>
        <small>Race called by Federal Elections Analysis.</small>
      </div>
      <div class="result-call-avatars" aria-hidden="true">
        ${avatars || (photo ? `<span class="result-call-avatar"><img src="${escapeHtml(photo)}" alt=""></span>` : "")}
      </div>
    </div>
  `;
}

function callLabelForDisplay(call, race) {
  if (call.label) return call.label;
  const scope = `${race.electionScope || race.electionName || ""}`.toLowerCase();
  if (call.status === "projected") return "Projected winner";
  if (call.status === "advanced") return "Advanced to general election";
  if (call.status === "advances" || scope.includes("primary")) return "Advances";
  return "Winner";
}

function isRealCandidate(candidate) {
  const name = String(candidate?.name || "").trim();
  return Boolean(name) && !/^write-?in$/i.test(name);
}

function pollsAreClosed(race) {
  const iso = pollCloseIso(race);
  if (!iso) return false;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && Date.now() >= date.getTime();
}

function pollsAreOpen(race) {
  const iso = pollOpenIso(race);
  if (!iso) return pollsAreClosed(race);
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && Date.now() >= date.getTime();
}

function automaticUncontestedCalls(race) {
  if (!pollsAreOpen(race)) return [];
  const realCandidates = (race.candidates || []).filter(isRealCandidate);
  if (realCandidates.length !== 1) return [];
  return [{
    candidate: realCandidates[0].name,
    status: "winner",
    label: "Winner",
    automatic: true
  }];
}

async function loadResultCalls() {
  const cacheBust = Date.now();
  return fetch(`data/result-calls.json?v=${cacheBust}`, { cache: "no-store" })
    .then((response) => response.ok ? response.json() : { races: {} })
    .catch(() => ({ races: {} }));
}

async function applyLocalRaceCalls(race) {
  const callsData = await loadResultCalls();
  const manualCalls = callsData.races?.[String(race.id)]?.calls || [];
  const calls = manualCalls.length ? manualCalls : automaticUncontestedCalls(race);
  const updatedCandidates = (race.candidates || []).map((candidate) => {
    const call = calls.find((item) => String(item.candidate || "").toLowerCase() === String(candidate.name || "").toLowerCase());
    return call ? { ...candidate, callStatus: call.status || "", callLabel: callLabelForDisplay(call, race), winner: false } : { ...candidate, callStatus: "", callLabel: "" };
  });
  return {
    ...race,
    calls,
    candidates: updatedCandidates
  };
}

function candidateRow(candidate, race, maxPercent) {
  const code = candidate.partyCode || partyCode(candidate.party);
  const width = Math.max(2, (Number(candidate.percent || 0) / maxPercent) * 100);
  const fill = candidateFill(race, candidate);
  const photo = candidatePhotoUrl(race, candidate);
  return `
    <article class="result-full-candidate ${partyClass(code)}-glow ${candidate.callLabel ? "called" : ""}" style="--candidate-color:${escapeHtml(fill)}">
      <div class="result-full-candidate-name">
        <span class="result-candidate-avatar ${partyClass(code)}">${photo ? `<img src="${escapeHtml(photo)}" alt="">` : escapeHtml(candidateInitials(candidate.name))}</span>
        <div>
          <strong>${escapeHtml(candidate.name)}${incumbentMark(race, candidate)}</strong>
        </div>
        ${callBadge(candidate, race)}
      </div>
      <span class="result-party-label">${escapeHtml(displayParty(candidate.party) || "Other")}</span>
      <span class="result-vote-label">${numberLabel(candidate.votes)}</span>
      <div class="result-full-numbers">
        <b>${percentLabel(candidate.percent)}</b>
      </div>
      <div class="result-full-bar" aria-hidden="true"><i style="width:${width}%"></i></div>
    </article>
  `;
}

function candidateRows(race) {
  const candidates = sortedCandidates(race);
  const maxPercent = Math.max(1, ...candidates.map((candidate) => Number(candidate.percent || 0)));
  const topList = candidates.slice(0, 5);
  const topNames = new Set(topList.map((candidate) => String(candidate.name || "").toLowerCase()));
  const otherCandidates = candidates.filter((candidate) => !topNames.has(String(candidate.name || "").toLowerCase()));
  const topCandidates = topList.map((candidate) => candidateRow(candidate, race, maxPercent)).join("");
  const head = `
    <div class="result-candidate-table-head">
      <span>Candidate</span>
      <span>Party</span>
      <span>Votes</span>
      <span>Pct</span>
    </div>
  `;
  if (!otherCandidates.length) return `${head}${topCandidates}`;
  return `
    ${head}
    ${topCandidates}
    <details class="result-other-candidates">
      <summary>Show ${numberLabel(otherCandidates.length)} other candidates</summary>
      <div class="result-full-candidates result-full-candidates-secondary">
        ${otherCandidates.map((candidate) => candidateRow(candidate, race, maxPercent)).join("")}
      </div>
    </details>
  `;
}

function regionLeader(county) {
  const candidates = county.candidates || [];
  const totalVotes = candidates.reduce((sum, candidate) => sum + Number(candidate.votes || 0), 0);
  if (!totalVotes) return null;
  return candidates.reduce((leader, candidate) => {
    if (!leader) return candidate;
    return Number(candidate.votes || 0) > Number(leader.votes || 0) ? candidate : leader;
  }, null);
}

function countyTopCandidates(county, race, limit = 3) {
  const candidates = [...(county.candidates || [])];
  const hasVotes = hasReportedVotes(candidates);
  const featuredNames = !hasVotes
    ? (race?.featuredCandidateNames || []).map((name) => String(name).toLowerCase())
    : [];
  return candidates
    .sort((a, b) => Number(b.percent || 0) - Number(a.percent || 0) || Number(b.votes || 0) - Number(a.votes || 0))
    .sort((a, b) => {
      if (hasVotes || !featuredNames.length) return 0;
      const aRank = featuredNames.indexOf(String(a.name || "").toLowerCase());
      const bRank = featuredNames.indexOf(String(b.name || "").toLowerCase());
      const aValue = aRank === -1 ? Number.POSITIVE_INFINITY : aRank;
      const bValue = bRank === -1 ? Number.POSITIVE_INFINITY : bRank;
      return aValue - bValue;
    })
    .slice(0, limit);
}

function countyTooltipMarkup(county, race, titlePrefix = "") {
  const rows = countyTopCandidates(county, race, 3);
  const title = titlePrefix || `${county.name} County`;
  return `
    <strong>${escapeHtml(title)}</strong>
    <table>
      <thead><tr><th></th><th>Votes</th><th>Pct</th></tr></thead>
      <tbody>
        ${rows.map((candidate) => `
          <tr>
            <td>${escapeHtml(candidate.name)} (${escapeHtml(candidate.partyCode || partyCode(candidate.party) || "O")})</td>
            <td>${numberLabel(candidate.votes)}</td>
            <td>${percentLabel(candidate.percent)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <small>${percentLabel(county.percentReporting)} reporting</small>
  `;
}

function regionAbbreviation(name) {
  const cleaned = String(name || "").replace(/[^a-z0-9\s]/gi, " ").trim();
  if (!cleaned) return "--";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.map((word) => word[0]).join("").slice(0, 3).toUpperCase();
  return cleaned.slice(0, 3).toUpperCase();
}

function regionMap(race) {
  const counties = race.counties || [];
  if (!counties.length) {
    return `<div class="result-map-empty">County-level map data is not available for this race yet.</div>`;
  }
  const regions = counties.map((county) => {
    const leader = regionLeader(county);
    const margin = resultMarginInfo(race, county);
    const label = leader
      ? `${county.name}: ${leader.name} ${percentLabel(leader.percent)}, ${percentLabel(county.percentReporting)} reporting`
      : `${county.name}: waiting for reported votes`;
    const percentFill = margin?.percentFill || "#566274";
    const voteFill = margin?.voteFill || "#566274";
    const style = ` style="--tile-color:${escapeHtml(percentFill)}" data-fill-percent="${escapeHtml(percentFill)}" data-fill-votes="${escapeHtml(voteFill)}"`;
    return `
      <span class="result-region-tile ${leader ? "" : "is-waiting"}"${style} title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
        ${escapeHtml(regionAbbreviation(county.name))}
      </span>
    `;
  }).join("");
  return `
    <div class="result-region-map" aria-label="${escapeHtml(race.stateName || race.state || "Race")} county result map">
      ${regions}
    </div>
  `;
}

function stateFips(state) {
  const codes = {
    CA: "06",
    IA: "19",
    MT: "30",
    NJ: "34",
    NM: "35",
    SD: "46"
  };
  return codes[String(state || "").toUpperCase()] || "";
}

async function loadCountyMapData() {
  if (!countyMapDataPromise) {
    countyMapDataPromise = fetch("data/result-counties.geojson", { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error(`County map returned ${response.status}`);
      return response.json();
    });
  }
  return countyMapDataPromise;
}

async function loadDistrictMapData() {
  if (!districtMapDataPromise) {
    districtMapDataPromise = fetch("data/house-districts-119.geojson", { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error(`District map returned ${response.status}`);
      return response.json();
    });
  }
  return districtMapDataPromise;
}

function countyLookup(race) {
  const lookup = new Map();
  for (const county of race.counties || []) {
    if (county.fips) lookup.set(String(county.fips).padStart(5, "0"), county);
    if (String(race.state || "").toUpperCase() === "SD" && /oglala lakota/i.test(county.name || "")) {
      lookup.set("46113", { ...county, fips: "46113" });
      lookup.set("shannon", county);
    }
    lookup.set(String(county.name || "").toLowerCase(), county);
  }
  return lookup;
}

function raceDistrictNumber(race) {
  if (race.district) {
    const parsed = Number(String(race.district).replace(/\D/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const match = String(race.electionName || "").match(/\bDistrict\s+(\d+)\b/i) || String(race.electionName || "").match(/\bHouse\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function isHouseRace(race) {
  return /house/i.test(`${race.type || ""} ${race.electionName || ""}`) && raceDistrictNumber(race);
}

function shouldFilterToJurisdiction(race, features, lookup) {
  if (race.district || race.municipality) return true;
  const matchedCounties = features.filter((feature) => lookup.has(feature.id) || lookup.has(String(feature.properties?.NAME || "").toLowerCase())).length;
  return matchedCounties > 0 && matchedCounties < features.length;
}

function coordinateRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

function stateBounds(features) {
  const bounds = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  for (const feature of features) {
    for (const ring of coordinateRings(feature.geometry)) {
      for (const [lon, lat] of ring) {
        bounds.minLon = Math.min(bounds.minLon, lon);
        bounds.maxLon = Math.max(bounds.maxLon, lon);
        bounds.minLat = Math.min(bounds.minLat, lat);
        bounds.maxLat = Math.max(bounds.maxLat, lat);
      }
    }
  }
  return bounds;
}

function expandedBounds(bounds, factor = .35) {
  const lonPad = (bounds.maxLon - bounds.minLon) * factor;
  const latPad = (bounds.maxLat - bounds.minLat) * factor;
  return {
    minLon: bounds.minLon - lonPad,
    minLat: bounds.minLat - latPad,
    maxLon: bounds.maxLon + lonPad,
    maxLat: bounds.maxLat + latPad
  };
}

function boundsOverlap(a, b) {
  return a.minLon <= b.maxLon && a.maxLon >= b.minLon && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

function contextFeatures(features, activeFeatures, activeBounds, factor = .35) {
  const expanded = expandedBounds(activeBounds, factor);
  const activeSet = new Set(activeFeatures);
  return features.filter((feature) => !activeSet.has(feature) && boundsOverlap(stateBounds([feature]), expanded));
}

function mapDimensions(bounds, maxWidth = 700, maxHeight = 520) {
  const lonRange = Math.max(.1, bounds.maxLon - bounds.minLon);
  const latRange = Math.max(.1, bounds.maxLat - bounds.minLat);
  const midLat = ((bounds.minLat + bounds.maxLat) / 2) * Math.PI / 180;
  const correctedLonRange = Math.max(.1, lonRange * Math.max(.35, Math.cos(midLat)));
  const aspect = correctedLonRange / latRange;
  let width = maxWidth;
  let height = Math.round(width / aspect);
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * aspect);
  }
  return {
    width: Math.max(260, width),
    height: Math.max(240, height),
    lonScale: Math.max(.35, Math.cos(midLat))
  };
}

function geometryPath(geometry, bounds, width, height, lonScale = 1) {
  const lonRange = Math.max(.1, (bounds.maxLon - bounds.minLon) * lonScale);
  const latRange = Math.max(.1, bounds.maxLat - bounds.minLat);
  const pad = 16;
  const usableWidth = width - pad * 2;
  const usableHeight = height - pad * 2;
  const scale = Math.min(usableWidth / lonRange, usableHeight / latRange);
  const offsetX = (width - lonRange * scale) / 2;
  const offsetY = (height - latRange * scale) / 2;
  const project = ([lon, lat]) => [
    offsetX + ((lon - bounds.minLon) * lonScale) * scale,
    offsetY + (bounds.maxLat - lat) * scale
  ];
  return coordinateRings(geometry).map((ring) => {
    const points = ring.map(project);
    if (!points.length) return "";
    return `M${points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("L")}Z`;
  }).join("");
}

async function districtShapeMap(race) {
  if (REDISTRICTED_RESULT_STATES.has(String(race.state || "").toUpperCase())) {
    return `
      <div class="result-map-empty">District map unavailable while updated post-redistricting boundaries are being added.</div>
      <p class="result-map-caption">This district has changed or may change through the 2025-26 redistricting cycle, so the older GeoJSON shape is not shown.</p>
    `;
  }
  const districtNumber = raceDistrictNumber(race);
  if (!districtNumber) return "";
  try {
    const geojson = await loadDistrictMapData();
    const feature = (geojson.features || []).find((item) => (
      String(item.properties?.state || "").toUpperCase() === String(race.state || "").toUpperCase()
      && Number(item.properties?.district) === districtNumber
    ));
    if (!feature) return "";
    const leader = leadingCandidate(race);
    const margin = resultMarginInfo(race, race);
    const fill = margin?.percentFill || (leader && Number(leader.votes || 0) ? candidateFill(race, leader) : "#566274");
    const voteFill = margin?.voteFill || fill;
    const bounds = stateBounds([feature]);
    const { width, height, lonScale } = mapDimensions(bounds, 700, 500);
    const districtTitle = `${race.state || ""}-${districtNumber} District`;
    const districtTooltip = countyTooltipMarkup({
      name: districtTitle,
      candidates: race.candidates || [],
      percentReporting: race.percentReporting
    }, race, districtTitle);
    return `
      <svg class="result-county-map result-district-map" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(race.electionName || "House district")} map">
        <path d="${geometryPath(feature.geometry, bounds, width, height, lonScale)}" fill="${escapeHtml(fill)}" data-fill-percent="${escapeHtml(fill)}" data-fill-votes="${escapeHtml(voteFill)}" data-county-tooltip="${escapeHtml(districtTooltip)}"></path>
      </svg>
    `;
  } catch (error) {
    console.warn(error);
    return "";
  }
}

async function countyShapeMap(race) {
  if (isHouseRace(race)) {
    const districtMarkup = await districtShapeMap(race);
    if (districtMarkup) return districtMarkup;
  }
  const fips = stateFips(race.state);
  if (!fips) return regionMap(race);
  try {
    const geojson = await loadCountyMapData();
    const allFeatures = geojson.features || [];
    const features = allFeatures.filter((feature) => feature.properties?.STATE === fips);
    if (!features.length) return regionMap(race);
    const lookup = countyLookup(race);
    const visibleFeatures = shouldFilterToJurisdiction(race, features, lookup)
      ? features.filter((feature) => lookup.has(feature.id) || lookup.has(String(feature.properties?.NAME || "").toLowerCase()))
      : features;
    if (!visibleFeatures.length) return regionMap(race);
    const bounds = stateBounds(visibleFeatures);
    const { width, height, lonScale } = mapDimensions(bounds);
    const paths = visibleFeatures.map((feature) => {
      const county = lookup.get(feature.id) || lookup.get(String(feature.properties?.NAME || "").toLowerCase());
      const leader = county ? regionLeader(county) : null;
      const margin = county ? resultMarginInfo(race, county) : null;
      const fill = margin?.percentFill || "#566274";
      const voteFill = margin?.voteFill || "#566274";
      const title = county && leader
        ? `${county.name} County: ${leader.name} ${percentLabel(leader.percent)}, ${percentLabel(county.percentReporting)} reporting`
        : `${feature.properties?.NAME || "County"} County: waiting for reported votes`;
      const tooltip = county ? countyTooltipMarkup(county, race, `${feature.properties?.NAME || county.name} County`) : "";
      return `
        <path d="${geometryPath(feature.geometry, bounds, width, height, lonScale)}" fill="${escapeHtml(fill)}" class="${leader ? "" : "is-waiting"}" data-fill-percent="${escapeHtml(fill)}" data-fill-votes="${escapeHtml(voteFill)}" data-county-title="${escapeHtml(title)}" data-county-tooltip="${escapeHtml(tooltip)}">
        </path>
      `;
    }).join("");
    return `
      <svg class="result-county-map" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(race.stateName || race.state || "State")} county results map">
        ${paths}
      </svg>
    `;
  } catch (error) {
    console.warn(error);
    return regionMap(race);
  }
}

function bindCountyHover() {
  const canvas = page.querySelector(".result-map-canvas");
  const caption = canvas?.querySelector(".result-map-caption");
  if (!canvas) return;
  const tooltip = canvas.querySelector(".result-county-tooltip");
  const defaultText = caption?.dataset.defaultMapCaption || caption?.textContent || "";
  canvas.querySelectorAll(".result-county-map path:not(.map-context)").forEach((path) => {
    const show = (event) => {
      if (caption) {
        caption.textContent = path.dataset.countyTitle || defaultText;
        caption.classList.add("is-live");
      }
      if (tooltip && path.dataset.countyTooltip) {
        tooltip.innerHTML = path.dataset.countyTooltip;
        tooltip.classList.add("visible");
        moveTooltip(event, canvas, tooltip);
      }
    };
    const hide = () => {
      if (caption) {
        caption.textContent = defaultText;
        caption.classList.remove("is-live");
      }
      tooltip?.classList.remove("visible");
    };
    path.addEventListener("mouseenter", show);
    path.addEventListener("mousemove", (event) => moveTooltip(event, canvas, tooltip));
    path.addEventListener("mouseleave", hide);
    path.addEventListener("focus", show);
    path.addEventListener("blur", hide);
  });
}

function moveTooltip(event, canvas, tooltip) {
  if (!event || !canvas || !tooltip) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.min(rect.width - tooltip.offsetWidth - 8, Math.max(8, event.clientX - rect.left + 14));
  const y = Math.min(rect.height - tooltip.offsetHeight - 8, Math.max(8, event.clientY - rect.top + 14));
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

function countyCandidateCells(county, race) {
  const candidates = countyTopCandidates(county, race, 3);
  return candidates.map((candidate) => `
    <span>
      <strong>${escapeHtml(candidate.name)}</strong>
      <small>${numberLabel(candidate.votes)} / ${percentLabel(candidate.percent)}</small>
    </span>
  `).join("");
}

function countyRows(race) {
  const counties = race.counties || [];
  if (!counties.length) return `<p class="meta">County-by-county results are not available for this race yet.</p>`;
  return `
    <div class="county-results-table">
      ${counties.map((county) => `
        <article class="county-result-row">
          <div>
            <strong>${escapeHtml(county.name)}</strong>
            <small>${escapeHtml(county.type || "County")} | ${percentLabel(county.percentReporting)} reporting</small>
          </div>
          <div class="county-candidate-cells">
            ${countyCandidateCells(county, race)}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

async function loadAnalysisNotes() {
  const cacheBust = Date.now();
  return fetch(`data/result-analysis-notes.json?v=${cacheBust}`, { cache: "no-store" })
    .then((response) => response.ok ? response.json() : { races: {} })
    .catch(() => ({ races: {} }));
}

async function analysisNoteMarkup(notes) {
  if (!Array.isArray(notes) || !notes.length) {
    notes = [{
      date: "",
      author: "Federal Elections Analysis",
      role: "Analysis desk",
      text: "No analyst comment has been posted for this race yet.",
      image: "",
      embed: "",
      isPlaceholder: true
    }];
  }
  const [latest, ...history] = notes;
  const analystByline = (note) => {
    const author = note.author || "Federal Elections Analysis";
    const authorSlug = slugifyName(author);
    const profileKey = Object.keys(ANALYST_PROFILES).find((key) => authorSlug.includes(key));
    const profile = profileKey ? ANALYST_PROFILES[profileKey] : null;
    const avatar = profile
      ? `<img src="${escapeHtml(profile.image)}" alt="">`
      : escapeHtml(candidateInitials(author));
    const placeholderClass = note.isPlaceholder ? " is-placeholder" : "";
    return `
      <div class="analysis-note-byline">
        <span class="analysis-note-avatar ${profile ? "has-image" : ""}${placeholderClass}">${avatar}</span>
        <span>
          ${note.date ? `<strong>${escapeHtml(note.date)}</strong>` : ""}
          <small>${escapeHtml(author)}${note.role ? `, ${escapeHtml(note.role)}` : ""}</small>
        </span>
      </div>
    `;
  };
  const media = latest.image ? noteImageMarkup(latest.image) : latest.embed ? await noteEmbedMarkup(latest.embed) : "";
  return `
    <section class="analysis-note-panel">
      <div class="analysis-note-copy">
        <p class="kicker">Latest analyst comment</p>
        ${analystByline(latest)}
        <p>${escapeHtml(latest.text || "No note text entered.")}</p>
      </div>
      ${media}
      ${history.length ? `
        <details class="analysis-note-history">
          <summary>Previous analyst comments</summary>
          ${history.map((note) => `
            <article>
              <p>${escapeHtml(note.text || "")}</p>
              ${analystByline(note)}
            </article>
          `).join("")}
        </details>
      ` : ""}
    </section>
  `;
}

function voteHistoryChart(race) {
  const points = Array.isArray(race.voteHistory) ? race.voteHistory : [];
  if (!points.length || !points.some((point) => (point.candidates || []).some((candidate) => Number(candidate.votes || 0) > 0))) {
    return `
      <section class="result-vote-history-panel result-vote-history-empty">
        <div class="section-head">
          <div>
            <h2>Votes reported over time.</h2>
          </div>
        </div>
        <p>Vote history will appear once results begin updating.</p>
      </section>
    `;
  }
  const candidates = sortedCandidates(race).slice(0, 5);
  const width = 760;
  const height = 220;
  const pad = { left: 42, right: 18, top: 18, bottom: 32 };
  const maxVotes = Math.max(1, ...points.flatMap((point) => (point.candidates || []).map((candidate) => Number(candidate.votes || 0))));
  const xFor = (index) => points.length === 1 ? pad.left : pad.left + (index / (points.length - 1)) * (width - pad.left - pad.right);
  const yFor = (votes) => height - pad.bottom - (Number(votes || 0) / maxVotes) * (height - pad.top - pad.bottom);
  const paths = candidates.map((candidate) => {
    const color = candidateFill(race, candidate);
    const d = points.map((point, index) => {
      const item = (point.candidates || []).find((entry) => entry.name === candidate.name);
      return `${index ? "L" : "M"}${xFor(index).toFixed(1)},${yFor(item?.votes || 0).toFixed(1)}`;
    }).join(" ");
    return `<path d="${d}" fill="none" stroke="${escapeHtml(color)}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>`;
  }).join("");
  const legend = candidates.map((candidate) => `
    <span style="--candidate-color:${escapeHtml(candidateFill(race, candidate))}">
      <i></i>${escapeHtml(candidate.name)}
    </span>
  `).join("");
  return `
    <section class="result-vote-history-panel">
      <div class="section-head">
        <div>
          <h2>Votes reported over time.</h2>
        </div>
      </div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Vote history chart">
        <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"></line>
        <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"></line>
        ${paths}
      </svg>
      <div class="vote-history-legend">${legend}</div>
    </section>
  `;
}

function bindMapZoom() {
  const frame = page.querySelector(".result-map-frame");
  if (!frame) return;
  const controls = page.querySelectorAll("[data-map-zoom]");
  let { zoom, panX, panY } = resultMapViewState;
  let pointerStart = null;
  const apply = () => {
    resultMapViewState = { zoom, panX, panY };
    frame.style.setProperty("--result-map-zoom", zoom.toFixed(2));
    frame.style.setProperty("--result-map-pan-x", `${panX.toFixed(1)}px`);
    frame.style.setProperty("--result-map-pan-y", `${panY.toFixed(1)}px`);
    controls.forEach((control) => {
      const mode = control.dataset.mapZoom;
      control.disabled = (mode === "in" && zoom >= 2.5) || (mode === "out" && zoom <= 1);
    });
  };
  controls.forEach((control) => {
    control.addEventListener("click", () => {
      const mode = control.dataset.mapZoom;
      if (mode === "in") zoom = Math.min(2.5, zoom + .25);
      if (mode === "out") zoom = Math.max(1, zoom - .25);
      if (mode === "reset") {
        zoom = 1;
        panX = 0;
        panY = 0;
      }
      apply();
    });
  });
  frame.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoom = event.deltaY < 0 ? Math.min(2.75, zoom + .18) : Math.max(.8, zoom - .18);
    apply();
  }, { passive: false });
  frame.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    pointerStart = { x: event.clientX, y: event.clientY, panX, panY };
    frame.setPointerCapture?.(event.pointerId);
    frame.classList.add("is-panning");
  });
  frame.addEventListener("pointermove", (event) => {
    if (!pointerStart) return;
    event.preventDefault();
    panX = pointerStart.panX + event.clientX - pointerStart.x;
    panY = pointerStart.panY + event.clientY - pointerStart.y;
    apply();
  });
  const endPan = (event) => {
    pointerStart = null;
    frame.releasePointerCapture?.(event.pointerId);
    frame.classList.remove("is-panning");
  };
  frame.addEventListener("pointerup", endPan);
  frame.addEventListener("pointercancel", endPan);
  apply();
}

function bindMapColorMode() {
  const frame = page.querySelector(".result-map-frame");
  const controls = page.querySelectorAll("[data-map-color]");
  if (!frame) return;
  let mode = "percent";
  const apply = () => {
    frame.dataset.marginMode = mode;
    frame.querySelectorAll("[data-fill-percent]").forEach((node) => {
      const fill = mode === "votes" ? node.dataset.fillVotes : node.dataset.fillPercent;
      if (node.tagName.toLowerCase() === "path") node.setAttribute("fill", fill || "#566274");
      else node.style.setProperty("--tile-color", fill || "#566274");
    });
    controls.forEach((control) => {
      control.classList.toggle("active", control.dataset.mapColor === mode);
      control.setAttribute("aria-pressed", String(control.dataset.mapColor === mode));
    });
  };
  controls.forEach((control) => {
    control.addEventListener("click", () => {
      mode = control.dataset.mapColor === "votes" ? "votes" : "percent";
      apply();
    });
  });
  apply();
}

async function renderRace(race) {
  await primeCandidatePhotoBgColors(race);
  const leader = leadingCandidate(race);
  const mapMarkup = await countyShapeMap(race);
  const notesData = await loadAnalysisNotes();
  const analystNotes = notesData.races?.[String(race.id)] || [];
  const closeIso = pollCloseIso(race);
  const reporting = Math.max(0, Math.min(100, Number(race.percentReporting || 0)));
  document.title = `${race.electionName} | Federal Elections Analysis`;
  page.innerHTML = `
    <section class="result-night-shell">
      <div class="result-night-left">
        <a class="result-back-link result-back-link-top" href="/results.html">&lt;- Back to all races</a>
        <div class="result-title-lockup">
          <span class="result-election-marker result-election-marker-large ${markerClass(race.marker)}">
            <i>${escapeHtml(race.marker?.short || "G")}</i>
          </span>
          <div>
            <p class="kicker">${escapeHtml(race.marker?.label || "Election results")}</p>
            <h1>${escapeHtml(race.electionName)}</h1>
            <p>${escapeHtml(race.stateName || race.state || "United States")} | ${escapeHtml(dateLabel(race.electionDate))}</p>
          </div>
        </div>

        ${raceCallBanner(race)}

        <div class="result-night-meta result-night-meta-top">
          <span data-poll-close="${escapeHtml(closeIso)}" class="result-poll-close-stat">${escapeHtml(pollCloseLabel(closeIso))}</span>
          <span>Last updated ${escapeHtml(timeLabel(race.lastUpdated))}</span>
          <span>${numberLabel((race.counties || []).length)} counties</span>
        </div>
        <div class="result-reporting-label-row">
          <span class="result-reporting-stat">${percentLabel(race.percentReporting)} reporting</span>
        </div>
        <div class="result-reporting-bar" aria-label="${escapeHtml(percentLabel(race.percentReporting))} reporting">
          <i style="width:${reporting}%"></i>
        </div>

        <div class="result-full-candidates">
          ${candidateRows(race)}
        </div>
      </div>

      <aside class="result-map-panel">
        <div class="result-map-tabs">
          <button type="button" data-map-color="percent">% Margin</button>
          <button type="button" data-map-color="votes">Vote Margin</button>
          <button type="button" data-map-zoom="out">-</button>
          <button type="button" data-map-zoom="in">+</button>
          <button type="button" data-map-zoom="reset">Reset</button>
        </div>
        <div class="result-map-canvas">
          <div class="result-map-frame">
            ${mapMarkup}
          </div>
          <div class="result-county-tooltip" aria-hidden="true"></div>
        </div>
        ${await analysisNoteMarkup(analystNotes)}
      </aside>
    </section>

    <p class="forecast-disclaimer result-call-note">Race calls appear only when Federal Elections Analysis has made a call or projection. Races without that label remain uncalled. This page checks for updates automatically.</p>

    ${voteHistoryChart(race)}

    <section class="result-county-panel">
      <div class="section-head">
        <div>
          <h2>County-by-county returns.</h2>
        </div>
        <p>${percentLabel(race.percentReporting)} statewide reporting.</p>
      </div>
      ${countyRows(race)}
    </section>
  `;
  bindCountyHover();
  bindMapZoom();
  bindMapColorMode();
  bindPollCountdown();
}

async function fetchRace() {
  if (!raceId) throw new Error("Missing race id.");
  try {
    const liveResponse = await fetch(`/api/live-results/race?id=${encodeURIComponent(raceId)}`, { cache: "no-store" });
    if (liveResponse.ok) return liveResponse.json();
  } catch {
    // Static deployments do not have the live API; fall back to generated JSON.
  }
  const staticResponse = await fetch(`data/live-results-races/${encodeURIComponent(raceId)}.json`, { cache: "no-store" });
  if (!staticResponse.ok) throw new Error(`Race detail returned ${staticResponse.status}`);
  return staticResponse.json();
}

async function loadRaceDetail() {
  try {
    const race = await applyLocalRaceCalls(await fetchRace());
    await renderRace(race);
  } catch (error) {
    page.innerHTML = `
      <section class="text-panel">
        <p class="kicker">Race results</p>
        <h1>Race detail unavailable.</h1>
        <p class="lede">The race detail feed could not be loaded.</p>
        <p><a class="button-link" href="/results">Back to results</a></p>
      </section>
    `;
    console.error(error);
  }
}

loadRaceDetail();
setInterval(loadRaceDetail, 30000);
