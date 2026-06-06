const page = document.getElementById("result-page");
const raceId = new URLSearchParams(window.location.search).get("id");
const FAVORITE_RACES_KEY = "fea.favoriteResultRaces.v1";
let countyMapDataPromise = null;
let districtMapDataPromise = null;
const districtCountyMapDataPromises = new Map();
let usStateMapDataPromise = null;
let majorHighwayDataPromise = null;
let countryContextDataPromise = null;
let countyDescriptionsPromise = null;
let countyDescriptionData = { byFips: {}, byStateName: {}, byName: {} };
let governorForecastPromise = null;
let resultMapViewState = {
  zoom: 1,
  panX: 0,
  panY: 0
};
let resultPartyViewEnabled = false;
let resultLastCheckedAt = new Date().toISOString();
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
  "79938": ["Karen Bass"],
  "80203": ["Mariannette Miller-Meeks"],
  "80461": ["Larry Rhoden"],
  "80512": ["Mike Rounds"],
  "81014": ["Ben Lujan"],
  "81044": ["Frank Pallone Jr.."],
  "81048": ["Rob Menendez"],
  "81057": ["Cory Booker"]
};

const CANDIDATE_PHOTO_SETS = {
  "79778": {
    base: "assets/img/candidates/california-insurance-commissioner",
    photos: {
      "ben-allen": "ben-allen.webp",
      "steven-craig-bradford": "steven-craig-bradford.webp",
      "jane-kim": "jane-kim.webp",
      "stacy-a-korsgaden": "stacy-a-korsgaden.webp"
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
      "audrey-denney": "audrey-denney.webp",
      "mike-mcguire": "mike-mcguire.webp",
      "james-gallagher": "james-gallagher.webp"
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
      "josh-fryday": "josh-fryday.webp",
      "fiona-ma": "fiona-ma.webp",
      "michael-tubbs": "michael-tubbs.webp",
      "oliver-ma": "oliver-ma.webp",
      "david-fennell": "david-fennell.webp",
      "gloria-romero": "gloria-romero.webp"
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
      "saikat-chakrabarti": "saikat-chakrabarti.webp",
      "connie-chan": "connie-chan.webp",
      "scott-wiener": "scott-wiener.webp"
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
      "jasmeet-bains": "jasmeet-bains.webp",
      "randy-villegas": "randy-villegas.webp",
      "david-g-valadao": "david-g-valadao.webp"
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
      "jake-levine": "jake-levine.webp",
      "marena-lin": "marena-lin.webp",
      "brad-sherman": "brad-sherman.webp",
      "larry-thompson": "larry-thompson.webp"
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
      "doris-matsui": "doris-matsui.webp",
      "mai-vang": "mai-vang.webp"
    },
    colors: {
      "doris-matsui": "#0091ff",
      "mai-vang": "#25d6d6"
    }
  },
  "79916": {
    base: "assets/img/candidates/california-us-house-40",
    photos: {
      "joe-kerr": "joe-kerr.webp",
      "esther-kim-varet": "esther-kim-varet.webp",
      "ken-calvert": "ken-calvert.webp",
      "young-kim": "young-kim.webp"
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
      "antonio-villaraigosa": "villaraigosa.webp",
      "tony-k-thurmond": "thurmond.webp",
      "eric-swalwell": "swalwell.webp",
      "tom-steyer": "steyer.webp",
      "katie-porter": "porter.webp",
      "matt-mahan": "mahan.webp",
      "xavier-becerra": "becerra.webp",
      "steve-hilton": "hilton.webp",
      "chad-bianco": "bianco.webp"
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
      "richard-barrera": "richard-barrera.webp",
      "nichelle-m-henderson": "nichelle-henderson.webp",
      "al-muratsuchi": "al-muratsuchi.webp",
      "josh-newman": "josh-newman.webp",
      "anthony-rendon": "anthony-rendon.webp",
      "sonja-shaw": "sonja-shaw.webp"
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
  "abel-chavez": { file: "abel-chavez.webp", color: "#6263f5" },
  "adam-hamawy": { file: "adam-hamawy.webp", color: "#1493f6" },
  "adam-miller": { file: "adam-miller.webp", color: "#c5162e" },
  "adam-steen": { file: "adam-steen.webp", color: "#c5162e" },
  "adrian-o-mapp": { file: "adrian-o-mapp.webp", color: "#1493f6" },
  "ammar-campa-najjar": { file: "ammar-campa-najjar.webp", color: "#1493f6" },
  "angela-gonzales-torres": { file: "angela-gonzales-torres.webp", color: "#6263f5" },
  "ashley-hinson": { file: "ashley-hinson.webp", color: "#c5162e" },
  "ben-r-lujan": { file: "ben-r-lujan.webp", color: "#1493f6" },
  "brad-cohen": { file: "brad-cohen.webp", color: "#25d6d6" },
  "brad-sherman": { file: "brad-sherman-ia.webp", color: "#c5162e" },
  "brian-varela": { file: "brian-varela.webp", color: "#1493f6" },
  "cory-booker": { file: "cory-booker.webp", color: "#1493f6" },
  "deb-haaland": { file: "deb-haaland.webp", color: "#1493f6" },
  "duke-rodriguez": { file: "duke-rodriguez.webp", color: "#d97a18" },
  "dusty-johnson": { file: "dusty-johnson.webp", color: "#c5162e" },
  "greggory-d-hull": { file: "greggory-d-hull.webp", color: "#d97a18" },
  "jay-vaingankar": { file: "jay-vaingankar.webp", color: "#25d6d6" },
  "jim-carlin": { file: "jim-carlin.webp", color: "#c5162e" },
  "jim-desmond": { file: "jim-desmond.webp", color: "#d97a18" },
  "jimmy-gomez": { file: "jimmy-gomez.webp", color: "#6263f5" },
  "jon-hansen": { file: "jon-hansen.webp", color: "#c5162e" },
  "josh-turek": { file: "josh-turek.webp", color: "#1493f6" },
  "justin-murphy": { file: "justin-murphy.webp", color: "#c5162e" },
  "karen-bass": { file: "karen-ruth-bass.webp", color: "#1493f6" },
  "karen-ruth-bass": { file: "karen-ruth-bass.webp", color: "#1493f6" },
  "kurt-alme": { file: "kurt-alme.webp", color: "#c5162e" },
  "larry-rhoden": { file: "larry-rhoden.webp", color: "#c5162e" },
  "marni-von-wilpert": { file: "marni-von-wilpert.webp", color: "#25d6d6" },
  "matt-adams": { file: "matt-adams.webp", color: "#6263f5" },
  "matt-rains": { file: "matt-rains.webp", color: "#6263f5" },
  "michael-roth": { file: "michael-roth.webp", color: "#6263f5" },
  "mike-rounds": { file: "mike-rounds.webp", color: "#c5162e" },
  "mussab-ali": { file: "mussab-ali.webp", color: "#1493f6" },
  "nithya-raman": { file: "nithya-raman.webp", color: "#1493f6" },
  "rae-chen-huang": { file: "rae-chen-huang.webp", color: "#6263f5" },
  "randy-feenstra": { file: "randy-feenstra.webp", color: "#c5162e" },
  "rebecca-bennett": { file: "rebecca-bennett.webp", color: "#25d6d6" },
  "rob-menendez": { file: "rob-menendez.webp", color: "#6263f5" },
  "rob-sand": { file: "rob-sand.webp", color: "#1493f6" },
  "robert-s-lebovics": { file: "robert-s-lebovics.webp", color: "#c5162e" },
  "russell-cleveland": { file: "russell-cleveland.webp", color: "#1493f6" },
  "ryan-busse": { file: "ryan-busse.webp", color: "#25d6d6" },
  "sam-bregman": { file: "sam-bregman.webp", color: "#6263f5" },
  "sam-forstag": { file: "sam-forstag.webp", color: "#45cd47" },
  "sam-wang": { file: "sam-wang.webp", color: "#d97a18" },
  "spencer-pratt": { file: "spencer-pratt.webp", color: "#6263f5" },
  "sue-altman": { file: "sue-altman.webp", color: "#1493f6" },
  "tina-shah": { file: "tina-shah.webp", color: "#45cd47" },
  "toby-doeden": { file: "toby-doeden.webp", color: "#c5162e" },
  "verlina-reynolds-jackson": { file: "verlina-reynolds-jackson.webp", color: "#25d6d6" },
  "zach-lahn": { file: "zach-lahn.webp", color: "#d97a18" },
  "zach-wahls": { file: "zach-wahls.webp", color: "#1493f6" }
};

const ANALYST_PROFILES = {
  "fea-analysis-desk": {
    name: "FEA Analysis Desk",
    image: "assets/img/FEA_Icon.webp"
  },
  "federal-elections-analysis": {
    name: "Federal Elections Analysis",
    image: "assets/img/FEA_Icon.webp"
  },
  "nathan-wang": {
    name: "Nathan Wang",
    image: "assets/img/analysts/nathan-wang.webp"
  },
  "gamerdoglover": {
    name: "gamerdoglover",
    image: "assets/img/analysts/gamerdoglover.webp"
  }
};

const RESULT_MAP_VIEW_BOUNDS = {
  CA: { minLon: -125.2, minLat: 31.7, maxLon: -111.2, maxLat: 42.6 },
  IA: { minLon: -97.0, minLat: 39.0, maxLon: -87.2, maxLat: 45.4 },
  MT: { minLon: -117.4, minLat: 43.4, maxLon: -103.6, maxLat: 49.2 },
  NJ: { minLon: -76.0, minLat: 38.7, maxLon: -73.3, maxLat: 41.4 },
  NM: { minLon: -112.0, minLat: 31.1, maxLon: -101.4, maxLat: 37.8 },
  SD: { minLon: -104.5, minLat: 41.0, maxLon: -95.0, maxLat: 47.3 },
  NV: { minLon: -120.4, minLat: 34.7, maxLon: -113.4, maxLat: 42.4 },
  ND: { minLon: -105.0, minLat: 45.4, maxLon: -95.5, maxLat: 49.5 },
  ME: { minLon: -72.0, minLat: 42.7, maxLon: -66.6, maxLat: 47.7 },
  SC: { minLon: -83.8, minLat: 31.8, maxLon: -78.2, maxLat: 35.5 }
};

const RESULT_MAP_BACKGROUND_BOUNDS = {
  CA: { minLon: -126.5, minLat: 30.5, maxLon: -107.8, maxLat: 44.2 },
  IA: { minLon: -98.8, minLat: 38.0, maxLon: -86.4, maxLat: 46.0 },
  MT: { minLon: -122.2, minLat: 40.2, maxLon: -96.2, maxLat: 53.4 },
  NJ: { minLon: -77.4, minLat: 37.8, maxLon: -72.4, maxLat: 41.9 },
  NM: { minLon: -113.6, minLat: 30.5, maxLon: -99.8, maxLat: 38.9 },
  SD: { minLon: -106.0, minLat: 40.3, maxLon: -93.2, maxLat: 48.1 },
  NV: { minLon: -121.6, minLat: 33.6, maxLon: -110.8, maxLat: 43.4 },
  ND: { minLon: -106.8, minLat: 44.4, maxLon: -93.8, maxLat: 50.1 },
  ME: { minLon: -73.4, minLat: 41.8, maxLon: -65.5, maxLat: 48.4 },
  SC: { minLon: -85.2, minLat: 30.8, maxLon: -76.8, maxLat: 36.3 }
};

const STATE_NAME_BY_ABBR = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana",
  IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia"
};

const RESULT_MAP_CONTEXT = {
  CA: {
    cities: [
      { name: "Eureka", lon: -124.16, lat: 40.8 },
      { name: "Reno", lon: -119.81, lat: 39.53 },
      { name: "Sacramento", lon: -121.49, lat: 38.58 },
      { name: "San Francisco", lon: -122.42, lat: 37.77 },
      { name: "San Jose", lon: -121.89, lat: 37.34 },
      { name: "Fresno", lon: -119.79, lat: 36.74 },
      { name: "Santa Barbara", lon: -119.7, lat: 34.42 },
      { name: "Los Angeles", lon: -118.24, lat: 34.05 },
      { name: "San Diego", lon: -117.16, lat: 32.72 },
      { name: "Bakersfield", lon: -119.02, lat: 35.37 },
      { name: "Palm Springs", lon: -116.55, lat: 33.83 },
      { name: "Las Vegas", lon: -115.14, lat: 36.17 },
      { name: "Elko", lon: -115.76, lat: 40.83 },
      { name: "Phoenix", lon: -112.07, lat: 33.45 },
      { name: "Flagstaff", lon: -111.65, lat: 35.2 },
      { name: "Mexicali", lon: -115.47, lat: 32.66 },
      { name: "Salt Lake City", lon: -111.89, lat: 40.76 }
    ],
    roads: [
      { name: "I-5", points: [[-122.32, 41.98], [-121.49, 38.58], [-119.79, 36.74], [-118.24, 34.05], [-117.16, 32.72]] },
      { name: "US-101", points: [[-124.16, 40.8], [-122.42, 37.77], [-121.89, 37.34], [-119.7, 34.42], [-118.24, 34.05]] },
      { name: "I-80", points: [[-122.3, 37.9], [-121.49, 38.58], [-119.81, 39.53], [-111.89, 40.76]] },
      { name: "I-15", points: [[-117.16, 32.72], [-115.14, 36.17], [-111.89, 40.76]] },
      { name: "CA-99", points: [[-121.49, 38.58], [-120.95, 37.64], [-119.79, 36.74], [-119.02, 35.37], [-118.24, 34.05]] },
      { name: "I-10", points: [[-118.24, 34.05], [-116.55, 33.83], [-115.14, 36.17], [-112.07, 33.45]] },
      { name: "US-395", points: [[-119.81, 39.53], [-118.4, 37.36], [-117.86, 36.03], [-117.16, 32.72]] }
    ]
  },
  IA: {
    cities: [
      { name: "Sioux City", lon: -96.4, lat: 42.5 },
      { name: "Des Moines", lon: -93.62, lat: 41.59 },
      { name: "Cedar Rapids", lon: -91.67, lat: 41.98 },
      { name: "Davenport", lon: -90.58, lat: 41.52 },
      { name: "Omaha", lon: -95.94, lat: 41.26 },
      { name: "Minneapolis", lon: -93.27, lat: 44.98 },
      { name: "Kansas City", lon: -94.58, lat: 39.1 },
      { name: "Chicago", lon: -87.63, lat: 41.88 }
    ],
    roads: [
      { name: "I-80", points: [[-96.1, 41.25], [-93.62, 41.59], [-91.67, 41.98], [-90.58, 41.52], [-87.63, 41.88]] },
      { name: "I-35", points: [[-93.27, 44.98], [-93.62, 41.59], [-94.58, 39.1]] }
    ]
  },
  MT: {
    cities: [
      { name: "Missoula", lon: -113.99, lat: 46.87 },
      { name: "Helena", lon: -112.04, lat: 46.59 },
      { name: "Great Falls", lon: -111.3, lat: 47.51 },
      { name: "Billings", lon: -108.5, lat: 45.78 },
      { name: "Boise", lon: -116.2, lat: 43.62 },
      { name: "Spokane", lon: -117.43, lat: 47.66 },
      { name: "Butte", lon: -112.53, lat: 46.0 },
      { name: "Bozeman", lon: -111.04, lat: 45.68 },
      { name: "Bismarck", lon: -100.78, lat: 46.81 }
    ],
    roads: [
      { name: "I-90", points: [[-116.2, 43.62], [-113.99, 46.87], [-112.04, 46.59], [-108.5, 45.78], [-104.05, 44.37]] },
      { name: "I-15", points: [[-112.04, 46.59], [-111.3, 47.51], [-111.98, 49.0]] },
      { name: "US-93", points: [[-114.32, 48.2], [-113.99, 46.87], [-114.07, 45.68], [-116.2, 43.62]] },
      { name: "US-2", points: [[-117.43, 47.66], [-114.32, 48.2], [-111.3, 47.51], [-108.5, 45.78]] }
    ]
  },
  NJ: {
    cities: [
      { name: "Newark", lon: -74.17, lat: 40.74 },
      { name: "Jersey City", lon: -74.04, lat: 40.72 },
      { name: "Trenton", lon: -74.76, lat: 40.22 },
      { name: "Atlantic City", lon: -74.42, lat: 39.36 },
      { name: "New York", lon: -74.0, lat: 40.71 },
      { name: "Philadelphia", lon: -75.17, lat: 39.95 }
    ],
    roads: [
      { name: "I-95", points: [[-75.17, 39.95], [-74.76, 40.22], [-74.17, 40.74], [-74.0, 40.71]] },
      { name: "Garden State Pkwy", points: [[-74.17, 40.74], [-74.42, 39.36], [-74.93, 38.94]] }
    ]
  },
  NM: {
    cities: [
      { name: "Albuquerque", lon: -106.65, lat: 35.08 },
      { name: "Santa Fe", lon: -105.94, lat: 35.69 },
      { name: "Las Cruces", lon: -106.78, lat: 32.32 },
      { name: "El Paso", lon: -106.49, lat: 31.76 },
      { name: "Amarillo", lon: -101.83, lat: 35.22 },
      { name: "Phoenix", lon: -112.07, lat: 33.45 },
      { name: "Denver", lon: -104.99, lat: 39.74 }
    ],
    roads: [
      { name: "I-25", points: [[-106.78, 32.32], [-106.65, 35.08], [-105.94, 35.69], [-104.99, 39.74]] },
      { name: "I-40", points: [[-112.07, 33.45], [-106.65, 35.08], [-101.83, 35.22]] }
    ]
  },
  SD: {
    cities: [
      { name: "Rapid City", lon: -103.23, lat: 44.08 },
      { name: "Pierre", lon: -100.35, lat: 44.37 },
      { name: "Sioux Falls", lon: -96.73, lat: 43.55 },
      { name: "Bismarck", lon: -100.78, lat: 46.81 },
      { name: "Omaha", lon: -95.94, lat: 41.26 },
      { name: "Minneapolis", lon: -93.27, lat: 44.98 }
    ],
    roads: [
      { name: "I-90", points: [[-103.23, 44.08], [-100.35, 44.37], [-96.73, 43.55]] },
      { name: "I-29", points: [[-96.73, 43.55], [-96.78, 46.88]] }
    ]
  },
  NV: {
    cities: [
      { name: "Reno", lon: -119.81, lat: 39.53 },
      { name: "Carson City", lon: -119.77, lat: 39.16 },
      { name: "Las Vegas", lon: -115.14, lat: 36.17 },
      { name: "Elko", lon: -115.76, lat: 40.83 },
      { name: "Salt Lake City", lon: -111.89, lat: 40.76 },
      { name: "Fresno", lon: -119.79, lat: 36.74 }
    ],
    roads: [
      { name: "I-80", points: [[-119.81, 39.53], [-115.76, 40.83], [-111.89, 40.76]] },
      { name: "I-15", points: [[-115.14, 36.17], [-113.58, 37.1], [-111.89, 40.76]] }
    ]
  },
  ND: {
    cities: [
      { name: "Fargo", lon: -96.79, lat: 46.88 },
      { name: "Bismarck", lon: -100.78, lat: 46.81 },
      { name: "Grand Forks", lon: -97.03, lat: 47.93 },
      { name: "Minot", lon: -101.29, lat: 48.23 },
      { name: "Billings", lon: -108.5, lat: 45.78 },
      { name: "Minneapolis", lon: -93.27, lat: 44.98 }
    ],
    roads: [
      { name: "I-94", points: [[-104.05, 46.28], [-100.78, 46.81], [-96.79, 46.88], [-93.27, 44.98]] },
      { name: "I-29", points: [[-96.73, 43.55], [-96.79, 46.88], [-97.03, 47.93]] }
    ]
  },
  ME: {
    cities: [
      { name: "Portland", lon: -70.26, lat: 43.66 },
      { name: "Augusta", lon: -69.78, lat: 44.31 },
      { name: "Bangor", lon: -68.78, lat: 44.8 },
      { name: "Lewiston", lon: -70.21, lat: 44.1 },
      { name: "Boston", lon: -71.06, lat: 42.36 }
    ],
    roads: [
      { name: "I-95", points: [[-71.06, 42.36], [-70.26, 43.66], [-69.78, 44.31], [-68.78, 44.8], [-67.84, 46.12]] }
    ]
  },
  SC: {
    cities: [
      { name: "Columbia", lon: -81.03, lat: 34.0 },
      { name: "Charleston", lon: -79.93, lat: 32.78 },
      { name: "Greenville", lon: -82.4, lat: 34.85 },
      { name: "Myrtle Beach", lon: -78.89, lat: 33.69 },
      { name: "Charlotte", lon: -80.84, lat: 35.23 },
      { name: "Savannah", lon: -81.1, lat: 32.08 }
    ],
    roads: [
      { name: "I-26", points: [[-82.4, 34.85], [-81.03, 34.0], [-79.93, 32.78]] },
      { name: "I-95", points: [[-81.1, 32.08], [-80.2, 33.92], [-79.46, 34.2]] },
      { name: "I-85", points: [[-84.39, 33.75], [-82.4, 34.85], [-80.84, 35.23]] }
    ]
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

function readFavoriteRaces() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITE_RACES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((race) => race && race.id && !race.archived) : [];
  } catch {
    return [];
  }
}

function writeFavoriteRaces(races) {
  try {
    localStorage.setItem(FAVORITE_RACES_KEY, JSON.stringify(races.filter((race) => race && race.id && !race.archived)));
  } catch {
  }
}

function favoriteRaceSummary(race) {
  return {
    id: String(race.id),
    electionName: race.electionName || "Election results",
    state: race.state || "",
    stateName: race.stateName || "",
    electionDate: race.electionDate || "",
    archived: Boolean(race.archived)
  };
}

function isRaceFavorite(id) {
  return readFavoriteRaces().some((race) => String(race.id) === String(id));
}

function setRaceFavorite(race, favorite) {
  const id = String(race.id);
  const existing = readFavoriteRaces().filter((item) => String(item.id) !== id);
  writeFavoriteRaces(favorite ? [favoriteRaceSummary(race), ...existing].slice(0, 20) : existing);
}

function numberLabel(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("en-US") : "0";
}

function percentLabel(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0.0%";
  if (number >= 100) return ">99%";
  return `${number.toFixed(1)}%`;
}

function estimatedInLabel(value) {
  if (value === null || value === undefined || value === "") return "Estimate pending";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Estimate pending";
  if (number >= 95) return ">95%";
  return `${number.toFixed(1)}%`;
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

function preciseTimeLabel(value) {
  if (!value) return "Awaiting update";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Awaiting update";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function compactVoteLabel(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "0";
  if (number >= 1000000) return `${(number / 1000000).toFixed(number >= 10000000 ? 0 : 1)}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 100000 ? 0 : 1)}k`;
  return number.toLocaleString("en-US");
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
    voteFill: mixColor("#d6d9e2", baseColor, .28 + voteStrength * .72),
    rawFill: baseColor
  };
}

function candidateRaceCallLabel(race, candidate) {
  if (candidate?.callLabel) return candidate.callLabel;
  const candidateSlug = slugifyName(candidate?.name);
  const raceCandidate = (race?.candidates || []).find((item) => {
    const raceSlug = slugifyName(item.name);
    return raceSlug === candidateSlug
      || (candidateSlug && raceSlug.endsWith(candidateSlug))
      || (raceSlug && candidateSlug.endsWith(raceSlug));
  });
  return raceCandidate?.callLabel || "";
}

function isMultiWinnerRace(race) {
  const count = Number(race?.winners || race?.advancingCount || 1);
  const text = `${race?.type || ""} ${race?.electionScope || ""} ${race?.electionName || ""}`.toLowerCase();
  return count > 1 || text.includes("open primary") || text.includes("top-two");
}

function raceCallMarkSymbol(race, candidate) {
  const label = String(candidateRaceCallLabel(race, candidate) || "").toLowerCase();
  if (!label) return "";
  if (label.includes("advance") || isMultiWinnerRace(race)) return "&#8594;";
  return "&#10003;";
}

function candidateCallMark(race, candidate) {
  const label = candidateRaceCallLabel(race, candidate);
  if (!label) return "";
  return `<span class="result-candidate-check" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${raceCallMarkSymbol(race, candidate)}</span>`;
}

function callBadge(candidate, race) {
  if (!candidate.callLabel) return "";
  const compactLabel = String(candidate.callLabel)
    .replace(/^Projected winner$/i, "Projected")
    .replace(/^Advanced to general election$/i, "Advanced");
  return `<span class="result-call-badge"><i aria-hidden="true">${raceCallMarkSymbol(race, candidate)}</i>${escapeHtml(compactLabel)}</span>`;
}

function callVerb(label, race, count) {
  const text = String(label || "").toLowerCase();
  const raceText = `${race.electionScope || race.electionName || ""}`.toLowerCase();
  if (text.includes("advance") || raceText.includes("open primary") || count > 1) return count > 1 ? "advance" : "advances";
  if (text.includes("project")) {
    if (raceText.includes("primary") || raceText.includes("open primary")) return "is projected to advance";
    return "is projected to win";
  }
  return "wins";
}

function callDeckText(race, calledCandidates) {
  const names = calledCandidates.map((candidate) => candidate.name).filter(Boolean);
  if (!names.length) return "Race call posted.";
  const label = calledCandidates[0]?.callLabel || "Winner";
  const verb = callVerb(label, race, names.length);
  const raceName = race.electionName || "this race";
  if (names.length === 1) return `${names[0]} ${verb} in the ${raceName}.`;
  if (names.length === 2) return `${names[0]} and ${names[1]} ${verb} in the ${raceName}.`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)} ${verb} in the ${raceName}.`;
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
  const latestCallTime = Math.max(...calls.map((call) => Date.parse(call.calledAt || "") || 0), 0);
  const callTime = latestCallTime ? timeLabel(latestCallTime) : "";
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
        <span>${escapeHtml(callLabel)} <i aria-hidden="true">${primary ? raceCallMarkSymbol(race, primary) : "&#10003;"}</i></span>
        <strong>${escapeHtml(callDeckText(race, bannerCandidates))}</strong>
        <small>Race called by Federal Elections Analysis${callTime ? ` at ${escapeHtml(callTime)}` : ""}.</small>
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
  if (!pollsAreClosed(race)) return [];
  const realCandidates = (race.candidates || []).filter(isRealCandidate);
  if (realCandidates.length !== 1) return [];
  const calledAt = pollCloseIso(race) || "";
  return [{
    candidate: realCandidates[0].name,
    status: "winner",
    label: "Winner",
    automatic: true,
    calledAt
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
    <article class="result-full-candidate ${partyClass(code)}-glow ${candidate.callLabel ? "called" : ""}" style="--candidate-color:${escapeHtml(fill)}" data-candidate-name="${escapeHtml(candidate.name)}">
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
  const reporting = county.estimatedVoteReporting ?? county.percentIn ?? county.percent_in ?? null;
  const description = countyContextDescription(county, race);
  return `
    <strong>${escapeHtml(title)}</strong>
    ${description ? `<p class="result-county-description">${escapeHtml(description)}</p>` : ""}
    ${rows.length ? `
      <table>
        <thead><tr><th></th><th>Votes</th><th>Pct</th></tr></thead>
        <tbody>
          ${rows.map((candidate) => `
            <tr class="${candidateRaceCallLabel(race, candidate) ? "is-called" : ""}" style="--candidate-color:${escapeHtml(candidateFill(race, candidate))}">
              <td><span class="result-tooltip-candidate"><i aria-hidden="true"></i><span>${escapeHtml(candidate.name)} ${candidateCallMark(race, candidate)} (${escapeHtml(candidate.partyCode || partyCode(candidate.party) || "O")})</span></span></td>
              <td>${numberLabel(candidate.votes)}</td>
              <td>${percentLabel(candidate.percent)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    ` : ""}
    <small>${estimatedInLabel(reporting)} estimated in</small>
  `;
}

function countyContextDescription(county, race) {
  if (county?.isDistrict) return county.name || race?.electionName || "District";
  const name = String(county?.name || "").replace(/\s+County$/i, "");
  const state = String(race?.state || "").toUpperCase();
  const fips = String(county?.fips || county?.id || "").padStart(5, "0");
  if (/^\d{5}$/.test(fips) && countyDescriptionData.byFips?.[fips]) return countyDescriptionData.byFips[fips];
  const fullCountyName = `${name} County`.toLowerCase();
  if (countyDescriptionData.byStateName?.[`${state}:${fullCountyName}`]) return countyDescriptionData.byStateName[`${state}:${fullCountyName}`];
  if (countyDescriptionData.byStateName?.[`${state}:${String(county?.name || "").toLowerCase()}`]) return countyDescriptionData.byStateName[`${state}:${String(county.name).toLowerCase()}`];
  if (countyDescriptionData.byName?.[fullCountyName]) return countyDescriptionData.byName[fullCountyName];
  if (countyDescriptionData.byName?.[String(county?.name || "").toLowerCase()]) return countyDescriptionData.byName[String(county.name).toLowerCase()];
  const direct = {
    CA: {
      "Los Angeles": "A large Southern California county anchored by Los Angeles and its surrounding suburbs.",
      "San Diego": "A Southern California county covering San Diego and the border-area suburbs.",
      "Orange": "A dense Southern California county with coastal suburbs and inland cities.",
      "San Francisco": "A compact urban county covering the city of San Francisco.",
      "Santa Clara": "A Bay Area county anchored by San Jose and Silicon Valley suburbs.",
      "Sacramento": "An urban Central Valley county that includes the state capital.",
      "Alameda": "An East Bay county with Oakland, Berkeley, and inner Bay Area suburbs.",
      "Contra Costa": "An East Bay county with inner suburbs and more exurban communities.",
      "Fresno": "A Central Valley county anchored by Fresno and nearby agricultural communities.",
      "Kern": "A southern Central Valley county with Bakersfield and desert communities.",
      "Riverside": "An Inland Empire county with fast-growing suburbs and desert cities.",
      "San Bernardino": "A large Inland Empire county stretching from suburbs into desert communities."
    },
    IA: {
      "Polk": "A central Iowa county anchored by Des Moines.",
      "Linn": "An eastern Iowa county anchored by Cedar Rapids.",
      "Scott": "An eastern Iowa county in the Quad Cities region.",
      "Johnson": "An eastern Iowa county anchored by Iowa City."
    },
    NJ: {
      "Essex": "A North Jersey county anchored by Newark and dense inner suburbs.",
      "Hudson": "A dense county across from New York City with urban waterfront communities.",
      "Bergen": "A populous North Jersey county with suburban communities near New York City."
    }
  };
  if (direct[state]?.[name]) return direct[state][name];
  const type = county?.type || "County";
  if (state === "CA") return `A California ${type.toLowerCase()} included in this race's local returns.`;
  if (state === "IA") return `An Iowa ${type.toLowerCase()} included in this race's county returns.`;
  if (state === "MT") return `A Montana ${type.toLowerCase()} included in this race's county returns.`;
  if (state === "NJ") return `A New Jersey ${type.toLowerCase()} included in this race's county returns.`;
  if (state === "NM") return `A New Mexico ${type.toLowerCase()} included in this race's county returns.`;
  if (state === "SD") return `A South Dakota ${type.toLowerCase()} included in this race's county returns.`;
  return "";
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
      ? `${county.name}: ${leader.name} ${percentLabel(leader.percent)}, ${estimatedInLabel(county.estimatedVoteReporting)} estimated in`
      : `${county.name}: waiting for reported votes`;
    const percentFill = margin?.percentFill || "#566274";
    const voteFill = margin?.voteFill || "#566274";
    const rawFill = margin?.rawFill || "#566274";
    const style = ` style="--tile-color:${escapeHtml(percentFill)}" data-fill-percent="${escapeHtml(percentFill)}" data-fill-votes="${escapeHtml(voteFill)}" data-fill-raw="${escapeHtml(rawFill)}"`;
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
    AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10",
    DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19",
    KS: "20", KY: "21", LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27",
    MS: "28", MO: "29", MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35",
    NY: "36", NC: "37", ND: "38", OH: "39", OK: "40", OR: "41", PA: "42", RI: "44",
    SC: "45", SD: "46", TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53",
    WV: "54", WI: "55", WY: "56"
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

function activeCongressCycle(race) {
  const raw = race?.geometryCycle || race?.congress || race?.mapGeometryCycle || 119;
  const parsed = Number(String(raw).replace(/\D/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 119;
}

function districtMapId(state, districtNumber) {
  const stateKey = String(state || "").toUpperCase();
  if (!stateKey || !districtNumber && districtNumber !== 0) return "";
  const district = Number(districtNumber);
  if (!Number.isFinite(district)) return "";
  return `${stateKey}-${district === 0 ? "AL" : String(district).padStart(2, "0")}`;
}

async function loadDistrictCountyMapData(race) {
  const districtNumber = raceDistrictNumber(race);
  const id = districtMapId(race?.state, districtNumber);
  const cycle = activeCongressCycle(race);
  if (!id) return null;
  const cacheKey = `${cycle}:${id}`;
  if (!districtCountyMapDataPromises.has(cacheKey)) {
    districtCountyMapDataPromises.set(cacheKey, fetch(`data/maps/congress/${cycle}/${id}.json`, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .catch(() => null));
  }
  const data = await districtCountyMapDataPromises.get(cacheKey);
  if (!data?.features?.length) return null;
  return data;
}

async function loadUsStateMapData() {
  if (!usStateMapDataPromise) {
    usStateMapDataPromise = fetch("data/result-us-states.geojson", { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error(`US state map returned ${response.status}`);
      return response.json();
    });
  }
  return usStateMapDataPromise;
}

async function loadMajorHighwayData() {
  if (!majorHighwayDataPromise) {
    majorHighwayDataPromise = fetch("data/result-major-highways.geojson", { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error(`Major highway map returned ${response.status}`);
      return response.json();
    });
  }
  return majorHighwayDataPromise;
}

async function loadCountryContextData() {
  if (!countryContextDataPromise) {
    countryContextDataPromise = fetch("data/result-country-context.geojson", { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error(`Country context map returned ${response.status}`);
      return response.json();
    });
  }
  return countryContextDataPromise;
}

async function loadCountyDescriptions() {
  if (!countyDescriptionsPromise) {
    countyDescriptionsPromise = fetch("data/result-county-descriptions.json", { cache: "force-cache" })
      .then((response) => response.ok ? response.json() : { byFips: {}, byName: {} })
      .then((data) => {
        countyDescriptionData = {
          byFips: data.byFips || {},
          byStateName: data.byStateName || {},
          byName: data.byName || {}
        };
        return countyDescriptionData;
      })
      .catch(() => {
        countyDescriptionData = { byFips: {}, byStateName: {}, byName: {} };
        return countyDescriptionData;
      });
  }
  return countyDescriptionsPromise;
}

function regionLookupKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
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
    lookup.set(regionLookupKey(county.name), county);
  }
  return lookup;
}

function cleanCountyName(value) {
  return String(value || "")
    .replace(/\s+(County|Parish|Borough|Census Area|Municipality)$/i, "")
    .trim();
}

function districtCountyFeatureLookup(lookup, feature) {
  const props = feature.properties || {};
  const countyFips = props.countyFips || `${props.STATEFP || ""}${props.COUNTYFP || ""}`;
  const countyName = props.countyName || props.NAME || "";
  const cleanName = cleanCountyName(countyName);
  return lookup.get(String(countyFips).padStart(5, "0"))
    || lookup.get(String(countyName).toLowerCase())
    || lookup.get(String(cleanName).toLowerCase())
    || lookup.get(regionLookupKey(countyName))
    || lookup.get(regionLookupKey(cleanName))
    || null;
}

function featureCountyName(feature) {
  const props = feature?.properties || {};
  return cleanCountyName(props.countyName || props.NAME || "");
}

function districtGeometryMatchesResults(features, race) {
  const resultNames = (race?.counties || [])
    .map((county) => regionLookupKey(cleanCountyName(county?.name || "")))
    .filter(Boolean);
  if (!resultNames.length || !features?.length) return true;
  const geometryNames = new Set(features
    .map((feature) => regionLookupKey(featureCountyName(feature)))
    .filter(Boolean));
  const matched = resultNames.filter((name) => geometryNames.has(name)).length;
  return matched === resultNames.length && geometryNames.size === new Set(resultNames).size;
}

function resultCountyFeaturesForRace(stateCountyFeatures, lookup) {
  return stateCountyFeatures.filter((feature) => {
    const props = feature.properties || {};
    const fips = String(feature.id || props.GEOID || `${props.STATE || ""}${props.COUNTY || ""}`).padStart(5, "0");
    const name = cleanCountyName(props.NAME || "");
    return lookup.has(fips)
      || lookup.has(String(props.NAME || "").toLowerCase())
      || lookup.has(String(name || "").toLowerCase())
      || lookup.has(regionLookupKey(props.NAME))
      || lookup.has(regionLookupKey(name));
  });
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
  const matchedCounties = features.filter((feature) => lookup.has(feature.id) || lookup.has(String(feature.properties?.NAME || "").toLowerCase()) || lookup.has(regionLookupKey(feature.properties?.NAME))).length;
  return matchedCounties > 0 && matchedCounties < features.length;
}

function coordinateRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

function coordinateLines(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates || []];
  if (geometry.type === "MultiLineString") return geometry.coordinates || [];
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

function geometryBounds(geometry) {
  const bounds = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  const points = [
    ...coordinateRings(geometry).flat(),
    ...coordinateLines(geometry).flat()
  ];
  for (const [lon, lat] of points) {
    bounds.minLon = Math.min(bounds.minLon, lon);
    bounds.maxLon = Math.max(bounds.maxLon, lon);
    bounds.minLat = Math.min(bounds.minLat, lat);
    bounds.maxLat = Math.max(bounds.maxLat, lat);
  }
  return Number.isFinite(bounds.minLon) ? bounds : null;
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

function mergeBounds(items) {
  const bounds = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  for (const item of items) {
    if (!item) continue;
    bounds.minLon = Math.min(bounds.minLon, item.minLon);
    bounds.minLat = Math.min(bounds.minLat, item.minLat);
    bounds.maxLon = Math.max(bounds.maxLon, item.maxLon);
    bounds.maxLat = Math.max(bounds.maxLat, item.maxLat);
  }
  return Number.isFinite(bounds.minLon) ? bounds : items.find(Boolean);
}

function boundsOverlap(a, b) {
  return a.minLon <= b.maxLon && a.maxLon >= b.minLon && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

function contextFeatures(features, activeFeatures, activeBounds, factor = .35) {
  const expanded = expandedBounds(activeBounds, factor);
  const activeSet = new Set(activeFeatures);
  return features.filter((feature) => !activeSet.has(feature) && boundsOverlap(stateBounds([feature]), expanded));
}

function contextPointBounds(state, activeBounds) {
  const config = RESULT_MAP_CONTEXT[String(state || "").toUpperCase()];
  if (!config) return null;
  const visible = activeBounds ? expandedBounds(activeBounds, .18) : null;
  const points = [
    ...(config.roads || []).flatMap((road) => road.points || [])
  ].filter((point) => point.length === 2)
    .filter(([lon, lat]) => !visible || (
      lon >= visible.minLon && lon <= visible.maxLon && lat >= visible.minLat && lat <= visible.maxLat
    ));
  if (!points.length) return null;
  return points.reduce((bounds, [lon, lat]) => ({
    minLon: Math.min(bounds.minLon, lon),
    minLat: Math.min(bounds.minLat, lat),
    maxLon: Math.max(bounds.maxLon, lon),
    maxLat: Math.max(bounds.maxLat, lat)
  }), { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity });
}

function resultMapBackgroundBounds(state, activeBounds) {
  const stateKey = String(state || "").toUpperCase();
  return RESULT_MAP_BACKGROUND_BOUNDS[stateKey]
    || RESULT_MAP_VIEW_BOUNDS[stateKey]
    || (activeBounds ? expandedBounds(activeBounds, .5) : null);
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

function lineGeometryPath(geometry, bounds, width, height, lonScale = 1) {
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
  return coordinateLines(geometry).map((line) => {
    const points = line.map(project);
    if (points.length < 2) return "";
    return points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("");
  }).filter(Boolean).join("");
}

async function districtShapeMap(race) {
  const districtNumber = raceDistrictNumber(race);
  if (!districtNumber) return "";
  const districtCountyMarkup = await districtCountyBreakdownMap(race, districtNumber);
  if (districtCountyMarkup) return districtCountyMarkup;
  if (activeCongressCycle(race) !== 119) {
    return `
      <div class="result-map-empty">District county-breakdown geometry is not available for this congressional cycle yet.</div>
      <p class="result-map-caption">This race is marked for ${escapeHtml(activeCongressCycle(race))}th Congress geometry, but the site currently has 119th Congress district-county files.</p>
    `;
  }
  if (REDISTRICTED_RESULT_STATES.has(String(race.state || "").toUpperCase())) {
    return `
      <div class="result-map-empty">District map unavailable while updated post-redistricting boundaries are being added.</div>
      <p class="result-map-caption">This district has changed or may change through the 2025-26 redistricting cycle, so the older GeoJSON shape is not shown.</p>
    `;
  }
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
    const activeBounds = stateBounds([feature]);
    const allCountyFeatures = await loadCountyMapData()
      .then((geojson) => (geojson.features || []))
      .catch(() => []);
    const allStateFeatures = await loadUsStateMapData()
      .then((geojson) => (geojson.features || []))
      .catch(() => []);
    const countryFeatures = await loadCountryContextData()
      .then((geojson) => (geojson.features || []))
      .catch(() => []);
    const highwayFeatures = await loadMajorHighwayData()
      .then((geojson) => (geojson.features || []))
      .catch(() => []);
    await loadCountyDescriptions();
    const stateCountyFeatures = allCountyFeatures.filter((item) => item.properties?.STATE === stateFips(race.state));
    const stateBoundsForContext = stateCountyFeatures.length ? stateBounds(stateCountyFeatures) : null;
    const fixedBounds = RESULT_MAP_VIEW_BOUNDS[String(race.state || "").toUpperCase()];
    const backgroundBounds = resultMapBackgroundBounds(race.state, activeBounds);
    const bounds = mergeBounds([
      backgroundBounds,
      expandedBounds(activeBounds, .72),
      contextPointBounds(race.state, activeBounds),
      fixedBounds ? expandedBounds(activeBounds, .28) : stateBoundsForContext
    ]) || activeBounds;
    const { width, height, lonScale } = mapDimensions(bounds, 760, 540);
    const activeCenter = [
      (activeBounds.minLon + activeBounds.maxLon) / 2,
      (activeBounds.minLat + activeBounds.maxLat) / 2
    ];
    const [activeX, activeY] = projectPoint(activeCenter, bounds, width, height, lonScale);
    const initialZoom = 2.05;
    const initialPanX = (width / 2 - activeX) * initialZoom;
    const initialPanY = (height / 2 - activeY) * initialZoom;
    const districtTitle = `${race.state || ""}-${districtNumber} District`;
    const districtTooltip = countyTooltipMarkup({
      name: districtTitle,
      isDistrict: true,
      candidates: race.candidates || [],
      percentReporting: race.percentReporting,
      estimatedVoteReporting: race.estimatedVoteReporting
    }, race, districtTitle);
    return `
      <svg class="result-county-map result-district-map" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(race.electionName || "House district")} map" data-initial-zoom="${initialZoom}" data-initial-pan-x="${initialPanX.toFixed(1)}" data-initial-pan-y="${initialPanY.toFixed(1)}">
        ${resultForeignContextLayer({ state: race.state, countryFeatures, bounds, width, height, lonScale })}
        ${resultStateContextLayer({ state: race.state, allFeatures: allStateFeatures, bounds, width, height, lonScale })}
        ${resultMapContextLayer({ state: race.state, allFeatures: stateCountyFeatures.length ? stateCountyFeatures : allCountyFeatures, activeFeatures: [feature], bounds, width, height, lonScale, labels: false })}
        <path d="${geometryPath(feature.geometry, bounds, width, height, lonScale)}" fill="${escapeHtml(fill)}" data-fill-percent="${escapeHtml(fill)}" data-fill-votes="${escapeHtml(voteFill)}" data-fill-raw="${escapeHtml(margin?.rawFill || fill)}" data-county-tooltip="${escapeHtml(districtTooltip)}"></path>
        ${resultMapRoadLayer({ state: race.state, bounds, width, height, lonScale, highwayFeatures })}
        ${resultMapLabelLayer({ state: race.state, bounds, width, height, lonScale })}
      </svg>
    `;
  } catch (error) {
    console.warn(error);
    return "";
  }
}

async function districtCountyBreakdownMap(race, districtNumber = raceDistrictNumber(race)) {
  try {
    const collection = await loadDistrictCountyMapData(race);
    const features = collection?.features || [];
    if (!features.length) return "";
    const lookup = countyLookup(race);
    const allCountyFeatures = await loadCountyMapData()
      .then((geojson) => (geojson.features || []))
      .catch(() => []);
    const allStateFeatures = await loadUsStateMapData()
      .then((geojson) => (geojson.features || []))
      .catch(() => []);
    const countryFeatures = await loadCountryContextData()
      .then((geojson) => (geojson.features || []))
      .catch(() => []);
    const highwayFeatures = await loadMajorHighwayData()
      .then((geojson) => (geojson.features || []))
      .catch(() => []);
    await loadCountyDescriptions();
    const stateCountyFeatures = allCountyFeatures.filter((item) => item.properties?.STATE === stateFips(race.state));
    // Prefer the Census county-within-district file when it agrees with the
    // result feed. If NBC/DDHQ reports a different county set for a covered
    // special/open primary, fall back to the feed's county set so stale
    // district geometry does not draw old counties into the live results map.
    const resultCountyFeatures = resultCountyFeaturesForRace(stateCountyFeatures, lookup);
    const activeFeatures = districtGeometryMatchesResults(features, race) || !resultCountyFeatures.length
      ? features
      : resultCountyFeatures;
    const activeBounds = stateBounds(activeFeatures);
    const backgroundBounds = resultMapBackgroundBounds(race.state, activeBounds);
    const bounds = mergeBounds([
      expandedBounds(activeBounds, .48),
      contextPointBounds(race.state, activeBounds),
      backgroundBounds ? expandedBounds(activeBounds, .18) : null
    ]) || activeBounds;
    const { width, height, lonScale } = mapDimensions(bounds, 760, 540);
    const renderCountyPiece = (feature, options = {}) => {
      const props = feature.properties || {};
      const countyFips = String(props.countyFips || props.id || feature.id || `${props.STATEFP || ""}${props.COUNTYFP || ""}`).padStart(5, "0");
      const countyName = cleanCountyName(props.countyName || props.NAME || countyFips);
      const county = districtCountyFeatureLookup(lookup, feature);
      if (!county && !options.allowMissingTooltip) {
        return `
          <path d="${geometryPath(feature.geometry, bounds, width, height, lonScale)}" fill="#566274" class="is-waiting map-context" data-fill-percent="#566274" data-fill-votes="#566274" data-fill-raw="#566274">
          </path>
        `;
      }
      const tooltipCounty = county ? {
        ...county,
        fips: county.fips || countyFips,
        id: county.id || countyFips,
        name: county.name || countyName,
        type: county.type || "County"
      } : {
        id: countyFips,
        fips: countyFips,
        name: countyName,
        type: "County",
        candidates: [],
        estimatedVoteReporting: race.estimatedVoteReporting
      };
      const leader = county ? regionLeader(county) : null;
      const margin = county ? resultMarginInfo(race, county) : null;
      const fill = margin?.percentFill || "#566274";
      const voteFill = margin?.voteFill || "#566274";
      const rawFill = margin?.rawFill || "#566274";
      const title = countyName;
      const tooltip = countyTooltipMarkup(tooltipCounty, race, countyName);
      return `
        <path d="${geometryPath(feature.geometry, bounds, width, height, lonScale)}" fill="${escapeHtml(fill)}" class="${leader ? "" : "is-waiting"}" data-fill-percent="${escapeHtml(fill)}" data-fill-votes="${escapeHtml(voteFill)}" data-fill-raw="${escapeHtml(rawFill)}" data-county-title="${escapeHtml(title)}" data-county-tooltip="${escapeHtml(tooltip)}">
        </path>
      `;
    };
    const paths = activeFeatures.map((feature) => renderCountyPiece(feature)).join("");
    const districtId = districtMapId(race.state, districtNumber);
    const cycle = activeCongressCycle(race);
    return `
      <svg class="result-county-map result-district-map result-district-county-map" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(race.electionName || districtId || "House district")} county-breakdown map" data-geometry-cycle="${cycle}" data-district-id="${escapeHtml(districtId)}">
        ${resultForeignContextLayer({ state: race.state, countryFeatures, bounds, width, height, lonScale })}
        ${resultStateContextLayer({ state: race.state, allFeatures: allStateFeatures, bounds, width, height, lonScale })}
        ${resultMapContextLayer({ state: race.state, allFeatures: stateCountyFeatures.length ? stateCountyFeatures : allCountyFeatures, activeFeatures, bounds, width, height, lonScale, labels: false })}
        ${paths}
        ${resultMapRoadLayer({ state: race.state, bounds, width, height, lonScale, highwayFeatures })}
        ${resultMapLabelLayer({ state: race.state, bounds, width, height, lonScale })}
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
    const stateGeojson = await loadUsStateMapData().catch(() => ({ features: [] }));
    const highwayGeojson = await loadMajorHighwayData().catch(() => ({ features: [] }));
    const countryGeojson = await loadCountryContextData().catch(() => ({ features: [] }));
    await loadCountyDescriptions();
    const allFeatures = geojson.features || [];
    const allStateFeatures = stateGeojson.features || [];
    const highwayFeatures = highwayGeojson.features || [];
    const countryFeatures = countryGeojson.features || [];
    const features = allFeatures.filter((feature) => feature.properties?.STATE === fips);
    if (!features.length) return regionMap(race);
    const lookup = countyLookup(race);
    const visibleFeatures = shouldFilterToJurisdiction(race, features, lookup)
      ? features.filter((feature) => lookup.has(feature.id) || lookup.has(String(feature.properties?.NAME || "").toLowerCase()) || lookup.has(regionLookupKey(feature.properties?.NAME)))
      : features;
    if (!visibleFeatures.length) return regionMap(race);
    const activeBounds = stateBounds(visibleFeatures);
    const filterToJurisdiction = shouldFilterToJurisdiction(race, features, lookup);
    const outsideFeatures = filterToJurisdiction
      ? allFeatures
      : allFeatures.filter((feature) => feature.properties?.STATE !== fips);
    const stateOutlineBounds = filterToJurisdiction ? stateBounds(features) : null;
    const fixedBounds = RESULT_MAP_VIEW_BOUNDS[String(race.state || "").toUpperCase()];
    const backgroundBounds = resultMapBackgroundBounds(race.state, activeBounds);
    const bounds = mergeBounds([
      backgroundBounds || fixedBounds,
      stateOutlineBounds,
      expandedBounds(activeBounds, filterToJurisdiction ? .28 : .08),
      contextPointBounds(race.state, activeBounds)
    ]) || activeBounds;
    const { width, height, lonScale } = mapDimensions(bounds);
    const contextLayer = filterToJurisdiction ? resultMapContextLayer({
      state: race.state,
      allFeatures: outsideFeatures,
      activeFeatures: visibleFeatures,
      bounds,
      width,
      height,
      lonScale,
      labels: false
    }) : "";
    const paths = visibleFeatures.map((feature) => {
      const county = lookup.get(feature.id) || lookup.get(String(feature.properties?.NAME || "").toLowerCase()) || lookup.get(regionLookupKey(feature.properties?.NAME));
      const leader = county ? regionLeader(county) : null;
      const margin = county ? resultMarginInfo(race, county) : null;
      const fill = margin?.percentFill || "#566274";
      const voteFill = margin?.voteFill || "#566274";
      const rawFill = margin?.rawFill || "#566274";
      const title = county && leader
        ? `${county.name} County: ${leader.name} ${percentLabel(leader.percent)}, ${estimatedInLabel(county.estimatedVoteReporting)} estimated in`
        : "";
      const tooltipCounty = county ? {
        ...county,
        fips: county.fips || feature.id,
        id: county.id || feature.id,
        type: county.type || feature.properties?.LSAD || "County"
      } : null;
      const tooltip = tooltipCounty ? countyTooltipMarkup(tooltipCounty, race, `${feature.properties?.NAME || county.name} County`) : "";
      return `
        <path d="${geometryPath(feature.geometry, bounds, width, height, lonScale)}" fill="${escapeHtml(fill)}" class="${leader ? "" : "is-waiting"}" data-fill-percent="${escapeHtml(fill)}" data-fill-votes="${escapeHtml(voteFill)}" data-fill-raw="${escapeHtml(rawFill)}" data-county-title="${escapeHtml(title)}" data-county-tooltip="${escapeHtml(tooltip)}">
        </path>
      `;
    }).join("");
    return `
      <svg class="result-county-map" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(race.stateName || race.state || "State")} county results map">
        ${resultForeignContextLayer({ state: race.state, countryFeatures, bounds, width, height, lonScale })}
        ${resultStateContextLayer({ state: race.state, allFeatures: allStateFeatures, bounds, width, height, lonScale })}
        ${contextLayer}
        ${paths}
        ${resultMapRoadLayer({ state: race.state, bounds, width, height, lonScale, highwayFeatures })}
        ${resultMapLabelLayer({ state: race.state, bounds, width, height, lonScale })}
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
  const showPath = (path, event) => {
    if (caption) {
      caption.textContent = path.dataset.countyTitle || defaultText;
      caption.classList.add("is-live");
    }
    if (tooltip && path.dataset.countyTooltip) {
      tooltip.innerHTML = path.dataset.countyTooltip;
      tooltip.classList.add("visible");
      tooltip.setAttribute("aria-hidden", "false");
      canvas.classList.add("is-county-active");
      moveTooltip(event, canvas, tooltip);
    }
  };
  const hidePath = () => {
    if (caption) {
      caption.textContent = defaultText;
      caption.classList.remove("is-live");
    }
    tooltip?.classList.remove("visible");
    tooltip?.setAttribute("aria-hidden", "true");
    canvas.classList.remove("is-county-active");
  };
  canvas.querySelectorAll(".result-county-map path:not(.map-context)").forEach((path) => {
    const show = (event) => {
      showPath(path, event);
    };
    path.addEventListener("mouseenter", show);
    path.addEventListener("mousemove", (event) => moveTooltip(event, canvas, tooltip));
    path.addEventListener("mouseleave", hidePath);
    path.addEventListener("pointerup", (event) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      event.preventDefault();
      showPath(path, event);
    });
    path.addEventListener("resultmaptap", (event) => {
      showPath(path, event.detail || event);
    });
    path.addEventListener("click", (event) => {
      event.preventDefault();
      showPath(path, event);
    });
    path.addEventListener("focus", show);
    path.addEventListener("blur", hidePath);
  });
  canvas.addEventListener("click", (event) => {
    if (event.target.closest?.(".result-county-map path:not(.map-context)")) return;
    hidePath();
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
    <span class="${candidateRaceCallLabel(race, candidate) ? "is-called" : ""}" style="--candidate-color:${escapeHtml(candidateFill(race, candidate))}">
      <strong>${escapeHtml(candidate.name)} ${candidateCallMark(race, candidate)}</strong>
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
            <small>${escapeHtml(county.type || "County")} | ${estimatedInLabel(county.estimatedVoteReporting)} estimated in</small>
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

async function refreshAnalysisNotes(race) {
  const panel = page.querySelector(".analysis-note-panel");
  if (!panel || !race?.id) return;
  const notesData = await loadAnalysisNotes();
  const analystNotes = notesData.races?.[String(race.id)] || [];
  const replacement = document.createElement("div");
  replacement.innerHTML = (await analysisNoteMarkup(analystNotes)).trim();
  const nextPanel = replacement.firstElementChild;
  if (nextPanel) panel.replaceWith(nextPanel);
}

function voteHistoryChart(race) {
  race = voteHistoryRaceForDisplay(race);
  let points = Array.isArray(race.voteHistory) ? race.voteHistory : [];
  if (!points.length && (race.candidates || []).some((candidate) => Number(candidate.votes || 0) > 0)) {
    points = [{
      at: race.lastUpdated || new Date().toISOString(),
      reporting: Number(race.estimatedVoteReporting ?? race.percentReporting ?? 0),
      candidates: (race.candidates || []).map((candidate) => ({
        name: candidate.name,
        party: candidate.party,
        partyCode: candidate.partyCode,
        votes: Number(candidate.votes || 0),
        percent: Number(candidate.percent || 0),
        color: candidate.color || ""
      }))
    }];
  }
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
  const historyCandidateFor = (point, candidate) => {
    const slug = slugifyName(candidate.name);
    return (point.candidates || []).find((entry) => entry.name === candidate.name)
      || (point.candidates || []).find((entry) => slugifyName(entry.name) === slug);
  };
  const orderedPoints = [...points].sort((a, b) => new Date(a.at || a.updatedAt || 0) - new Date(b.at || b.updatedAt || 0));
  if (orderedPoints.length === 1) {
    const original = orderedPoints[0];
    const startAt = new Date(original.at || original.updatedAt || race.lastUpdated || Date.now());
    orderedPoints.unshift({
      ...original,
      at: new Date(startAt.getTime() - 5 * 60 * 1000).toISOString()
    });
  }
  const latestPoint = orderedPoints.at(-1) || {};
  const latestTopSlugs = new Set([...(latestPoint.candidates || [])]
    .sort((a, b) => Number(b.percent || 0) - Number(a.percent || 0) || Number(b.votes || 0) - Number(a.votes || 0))
    .slice(0, 5)
    .map((candidate) => slugifyName(candidate.name)));
  const latestCandidates = [...(latestPoint.candidates || [])]
    .sort((a, b) => Number(b.percent || 0) - Number(a.percent || 0) || Number(b.votes || 0) - Number(a.votes || 0))
    .slice(0, 5);
  const candidates = sortedCandidates(race)
    .filter((candidate) => latestTopSlugs.has(slugifyName(candidate.name)))
    .slice(0, 5);
  const displayCandidates = candidates.length ? candidates : latestCandidates;
  const visibleCandidateSlugsByPoint = orderedPoints.map((point) => new Set([...(point.candidates || [])]
    .sort((a, b) => Number(b.percent || 0) - Number(a.percent || 0) || Number(b.votes || 0) - Number(a.votes || 0))
    .slice(0, 5)
    .map((candidate) => slugifyName(candidate.name))));
  const width = 760;
  const height = 250;
  const pad = { left: 58, right: 20, top: 18, bottom: 48 };
  const maxPercent = Math.max(1, Math.min(100, Math.ceil(Math.max(
    ...orderedPoints.flatMap((point) => displayCandidates.map((candidate) => Number(historyCandidateFor(point, candidate)?.percent || 0)))
  ) / 5) * 5));
  const xFor = (index) => orderedPoints.length === 1 ? pad.left : pad.left + (index / (orderedPoints.length - 1)) * (width - pad.left - pad.right);
  const yFor = (percent, visible = true) => {
    if (!visible) return height - pad.bottom + 12;
    return height - pad.bottom - (Number(percent || 0) / maxPercent) * (height - pad.top - pad.bottom);
  };
  const defs = displayCandidates.map((candidate, index) => {
    if (!candidateRaceCallLabel(race, candidate)) return "";
    const color = candidateFill(race, candidate);
    return `
      <linearGradient id="vote-history-winner-${index}" x1="0%" x2="100%" y1="0%" y2="0%">
        <stop offset="0%" stop-color="${escapeHtml(mixColor("#ffffff", color, .35))}"></stop>
        <stop offset="100%" stop-color="${escapeHtml(color)}"></stop>
      </linearGradient>
    `;
  }).join("");
  const paths = displayCandidates.map((candidate, index) => {
    const color = candidateFill(race, candidate);
    const called = Boolean(candidateRaceCallLabel(race, candidate));
    const candidateSlug = slugifyName(candidate.name);
    const d = orderedPoints.map((point, index) => {
      const item = historyCandidateFor(point, candidate);
      const visible = visibleCandidateSlugsByPoint[index]?.has(candidateSlug);
      return `${index ? "L" : "M"}${xFor(index).toFixed(1)},${yFor(item?.percent || 0, visible).toFixed(1)}`;
    }).join(" ");
    return `<path class="vote-history-line" d="${d}" fill="none" stroke="${called ? `url(#vote-history-winner-${index})` : escapeHtml(color)}" stroke-width="${called ? 3.4 : 2.8}" stroke-linecap="round" stroke-linejoin="round"></path>`;
  }).join("");
  const hits = orderedPoints.map((point, index) => {
    const x = xFor(index);
    const xPrev = index === 0 ? pad.left : xFor(index - 1);
    const xNext = index === orderedPoints.length - 1 ? width - pad.right : xFor(index + 1);
    const hitX = index === 0 ? pad.left : (xPrev + x) / 2;
    const hitWidth = index === orderedPoints.length - 1 ? (width - pad.right) - hitX : (xNext + x) / 2 - hitX;
    const label = `
      <strong>${escapeHtml(preciseTimeLabel(point.at || point.updatedAt || point.timestamp || point.time || race.lastUpdated))}</strong>
      <div class="vote-history-tooltip-rows">
        ${displayCandidates.map((candidate) => {
        const item = historyCandidateFor(point, candidate);
        const candidateParty = item?.partyCode || item?.party || candidate.partyCode || candidate.party || "";
        const code = partyCode(candidateParty) || candidateParty || "O";
        const color = candidateFill(race, candidate);
        return `
          <span class="vote-history-tooltip-row" style="--candidate-color:${escapeHtml(color)}">
            <b>${escapeHtml(code)}</b>
            <em>${escapeHtml(candidate.name)} ${candidateCallMark(race, candidate)}</em>
            <strong>${percentLabel(item?.percent || 0)}</strong>
            <small>${compactVoteLabel(item?.votes || 0)}</small>
          </span>
        `;
      }).join("")}
      </div>
    `;
    const expanded = `
      <div class="vote-history-expanded-head">
        <span>
          <small>Vote snapshot</small>
          <strong>${escapeHtml(preciseTimeLabel(point.at || point.updatedAt || point.timestamp || point.time || race.lastUpdated))}</strong>
        </span>
        <button type="button" data-history-expanded-close aria-label="Close vote snapshot">Close</button>
      </div>
      <div class="vote-history-expanded-rows">
        ${[...(point.candidates || [])]
        .sort((a, b) => Number(b.percent || 0) - Number(a.percent || 0) || Number(b.votes || 0) - Number(a.votes || 0))
        .map((candidate) => {
          const code = partyCode(candidate.partyCode || candidate.party) || candidate.partyCode || "O";
          const color = candidateFill(race, candidate);
          return `
            <span class="vote-history-expanded-row" style="--candidate-color:${escapeHtml(color)}">
              <b>${escapeHtml(code)}</b>
              <em>${escapeHtml(candidate.name)} ${candidateCallMark(race, candidate)}</em>
              <strong>${percentLabel(candidate.percent || 0)}</strong>
              <small>${numberLabel(candidate.votes || 0)} votes</small>
            </span>
          `;
        }).join("")}
      </div>
    `;
    return `<rect class="vote-history-hit" x="${hitX.toFixed(1)}" y="${pad.top}" width="${Math.max(6, hitWidth).toFixed(1)}" height="${height - pad.top - pad.bottom}" data-history-x="${x.toFixed(1)}" data-history-tooltip="${escapeHtml(label)}" data-history-expanded="${escapeHtml(expanded)}"></rect>`;
  }).join("");
  const ticks = [0, maxPercent / 2, maxPercent];
  const timeTicks = orderedPoints
    .map((point, index) => ({ point, index }))
    .filter((_, index, list) => list.length <= 4 || index === 0 || index === list.length - 1 || index === Math.floor((list.length - 1) / 2));
  return `
    <section class="result-vote-history-panel">
      <div class="section-head">
        <div>
          <h2>Votes reported over time.</h2>
        </div>
      </div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Vote history chart">
        <defs>${defs}</defs>
        ${ticks.map((tick) => `
          <line class="vote-history-grid" x1="${pad.left}" y1="${yFor(tick).toFixed(1)}" x2="${width - pad.right}" y2="${yFor(tick).toFixed(1)}"></line>
          <text class="vote-history-tick" x="${pad.left - 10}" y="${(yFor(tick) + 4).toFixed(1)}">${tick.toFixed(0)}%</text>
        `).join("")}
        ${timeTicks.map(({ point, index }) => `
          <line class="vote-history-time-grid" x1="${xFor(index).toFixed(1)}" y1="${pad.top}" x2="${xFor(index).toFixed(1)}" y2="${height - pad.bottom}"></line>
          <text class="vote-history-time-tick" x="${xFor(index).toFixed(1)}" y="${height - 28}">${escapeHtml(new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(point.at || point.updatedAt || point.timestamp || point.time || race.lastUpdated)))}</text>
        `).join("")}
        <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"></line>
        <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"></line>
        <text class="vote-history-axis-label vote-history-y-label" x="18" y="${pad.top + 4}" transform="rotate(-90 18 ${pad.top + 4})">Vote share</text>
        <text class="vote-history-axis-label" x="${(width + pad.left - pad.right) / 2}" y="${height - 8}">Time</text>
        ${paths}
        <line class="vote-history-hover-line" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"></line>
        ${hits}
      </svg>
      <div class="vote-history-tooltip" aria-hidden="true"></div>
      <div class="vote-history-expanded" aria-live="polite" aria-hidden="true"></div>
    </section>
  `;
}

function projectPoint([lon, lat], bounds, width, height, lonScale = 1) {
  const lonRange = Math.max(.1, (bounds.maxLon - bounds.minLon) * lonScale);
  const latRange = Math.max(.1, bounds.maxLat - bounds.minLat);
  const pad = 16;
  const usableWidth = width - pad * 2;
  const usableHeight = height - pad * 2;
  const scale = Math.min(usableWidth / lonRange, usableHeight / latRange);
  const offsetX = (width - lonRange * scale) / 2;
  const offsetY = (height - latRange * scale) / 2;
  return [
    offsetX + ((lon - bounds.minLon) * lonScale) * scale,
    offsetY + (bounds.maxLat - lat) * scale
  ];
}

function resultMapContextLayer({ state, allFeatures = [], activeFeatures = [], bounds, width, height, lonScale, labels = false }) {
  const nearby = contextFeatures(allFeatures, activeFeatures, bounds, .2).slice(0, 520);
  const nearbyPaths = nearby.map((feature) => `
    <path class="map-context map-context-county" d="${geometryPath(feature.geometry, bounds, width, height, lonScale)}"></path>
  `).join("");
  const config = RESULT_MAP_CONTEXT[String(state || "").toUpperCase()] || {};
  const visibleBounds = expandedBounds(bounds, .28);
  const roads = (config.roads || []).map((road) => {
    const points = road.points || [];
    if (points.length < 2) return "";
    const roadBounds = points.reduce((roadBounds, [lon, lat]) => ({
      minLon: Math.min(roadBounds.minLon, lon),
      minLat: Math.min(roadBounds.minLat, lat),
      maxLon: Math.max(roadBounds.maxLon, lon),
      maxLat: Math.max(roadBounds.maxLat, lat)
    }), { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity });
    if (!boundsOverlap(roadBounds, visibleBounds)) return "";
    const d = points.map((point, index) => {
      const [x, y] = projectPoint(point, bounds, width, height, lonScale);
      return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join("");
    return `<path class="map-context map-context-road" d="${d}"><title>${escapeHtml(road.name || "Major route")}</title></path>`;
  }).join("");
  const cities = !labels ? "" : (config.cities || []).filter((city) => (
    city.lon >= visibleBounds.minLon && city.lon <= visibleBounds.maxLon && city.lat >= visibleBounds.minLat && city.lat <= visibleBounds.maxLat
  )).map((city) => {
    const [x, y] = projectPoint([city.lon, city.lat], bounds, width, height, lonScale);
    return `<text class="map-context-label" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${escapeHtml(city.name)}</text>`;
  }).join("");
  return `
    <g class="result-map-context" aria-hidden="true">
      ${nearbyPaths}
      ${roads}
      ${cities}
    </g>
  `;
}

function resultStateContextLayer({ state, allFeatures = [], bounds, width, height, lonScale }) {
  const stateName = STATE_NAME_BY_ABBR[String(state || "").toUpperCase()] || "";
  const visibleBounds = expandedBounds(bounds, .28);
  const paths = (allFeatures || [])
    .filter((feature) => boundsOverlap(stateBounds([feature]), visibleBounds))
    .map((feature) => {
      const name = String(feature.properties?.name || "");
      const isActive = stateName && name === stateName;
      return `<path class="map-context map-context-state ${isActive ? "is-active-state" : ""}" d="${geometryPath(feature.geometry, bounds, width, height, lonScale)}"><title>${escapeHtml(name)}</title></path>`;
    }).join("");
  return paths ? `<g class="result-map-state-context" aria-hidden="true">${paths}</g>` : "";
}

function resultForeignContextLayer({ state, countryFeatures = [], bounds, width, height, lonScale }) {
  const stateKey = String(state || "").toUpperCase();
  const allowed = new Set();
  if (["CA", "NM", "AZ", "TX"].includes(stateKey)) allowed.add("MEX");
  if (["MT", "ND", "ME", "WA", "ID", "MN", "NY", "VT", "NH"].includes(stateKey)) allowed.add("CAN");
  if (!allowed.size) return "";
  const visibleBounds = expandedBounds(bounds, .28);
  const paths = (countryFeatures || []).filter((feature) => {
    const iso = feature.properties?.iso3 || feature.properties?.["ISO3166-1-Alpha-3"];
    return allowed.has(iso) && boundsOverlap(stateBounds([feature]), visibleBounds);
  }).map((feature) => {
    const name = feature.properties?.name || feature.properties?.iso3 || "Country";
    return `<path class="map-context map-context-foreign" d="${geometryPath(feature.geometry, bounds, width, height, lonScale)}"><title>${escapeHtml(name)}</title></path>`;
  }).join("");
  return paths ? `<g class="result-map-foreign-context" aria-hidden="true">${paths}</g>` : "";
}

function fallbackRoadLayer({ state, bounds, width, height, lonScale }) {
  const config = RESULT_MAP_CONTEXT[String(state || "").toUpperCase()] || {};
  const visibleBounds = expandedBounds(bounds, .18);
  const roads = (config.roads || []).map((road) => {
    const points = road.points || [];
    if (points.length < 2) return "";
    const roadBounds = points.reduce((roadBounds, [lon, lat]) => ({
      minLon: Math.min(roadBounds.minLon, lon),
      minLat: Math.min(roadBounds.minLat, lat),
      maxLon: Math.max(roadBounds.maxLon, lon),
      maxLat: Math.max(roadBounds.maxLat, lat)
    }), { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity });
    if (!boundsOverlap(roadBounds, visibleBounds)) return "";
    const d = points.map((point, index) => {
      const [x, y] = projectPoint(point, bounds, width, height, lonScale);
      return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join("");
    return `<path class="map-context map-context-road map-context-road-top" d="${d}"><title>${escapeHtml(road.name || "Major route")}</title></path>`;
  }).join("");
  return roads ? `<g class="result-map-roads" aria-hidden="true">${roads}</g>` : "";
}

function resultMapRoadLayer({ state, bounds, width, height, lonScale, highwayFeatures = [] }) {
  const visibleBounds = expandedBounds(bounds, .28);
  const roads = (highwayFeatures || [])
    .filter((feature) => {
      const featureBounds = geometryBounds(feature.geometry);
      return featureBounds && boundsOverlap(featureBounds, visibleBounds);
    })
    .slice(0, 320)
    .map((feature) => {
      const d = lineGeometryPath(feature.geometry, bounds, width, height, lonScale);
      if (!d) return "";
      const route = feature.properties?.ROUTE_NUM || feature.properties?.NUMBER || "Highway";
      return `<path class="map-context map-context-road map-context-road-top" d="${d}"><title>${escapeHtml(route)}</title></path>`;
    })
    .join("");
  return roads ? `<g class="result-map-roads" aria-hidden="true">${roads}</g>` : fallbackRoadLayer({ state, bounds, width, height, lonScale });
}

function resultMapLabelLayer({ state, bounds, width, height, lonScale }) {
  const config = RESULT_MAP_CONTEXT[String(state || "").toUpperCase()] || {};
  const visibleBounds = expandedBounds(bounds, .3);
  const labels = (config.cities || []).filter((city) => (
    city.lon >= visibleBounds.minLon && city.lon <= visibleBounds.maxLon && city.lat >= visibleBounds.minLat && city.lat <= visibleBounds.maxLat
  )).map((city) => {
    const [x, y] = projectPoint([city.lon, city.lat], bounds, width, height, lonScale);
    return `<text class="map-context-label map-context-label-top" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${escapeHtml(city.name)}</text>`;
  }).join("");
  return labels ? `<g class="result-map-labels" aria-hidden="true">${labels}</g>` : "";
}

function bindVoteHistoryHover() {
  const panel = page.querySelector(".result-vote-history-panel");
  const tooltip = panel?.querySelector(".vote-history-tooltip");
  const expanded = panel?.querySelector(".vote-history-expanded");
  const line = panel?.querySelector(".vote-history-hover-line");
  if (!panel || !tooltip || !line) return;
  panel.querySelectorAll(".vote-history-hit").forEach((hit) => {
    const show = (event) => {
      line.setAttribute("x1", hit.dataset.historyX || "0");
      line.setAttribute("x2", hit.dataset.historyX || "0");
      line.classList.add("visible");
      tooltip.innerHTML = hit.dataset.historyTooltip || "";
      tooltip.classList.add("visible");
      const rect = panel.getBoundingClientRect();
      tooltip.style.left = `${Math.min(rect.width - tooltip.offsetWidth - 8, Math.max(8, event.clientX - rect.left + 12))}px`;
      tooltip.style.top = `${Math.max(8, event.clientY - rect.top - tooltip.offsetHeight - 10)}px`;
    };
    const hide = () => {
      line.classList.remove("visible");
      tooltip.classList.remove("visible");
    };
    hit.addEventListener("mousemove", show);
    hit.addEventListener("mouseenter", show);
    hit.addEventListener("mouseleave", hide);
    hit.addEventListener("click", (event) => {
      event.preventDefault();
      if (!expanded) return;
      line.setAttribute("x1", hit.dataset.historyX || "0");
      line.setAttribute("x2", hit.dataset.historyX || "0");
      line.classList.add("visible");
      expanded.innerHTML = hit.dataset.historyExpanded || "";
      expanded.classList.add("visible");
      expanded.setAttribute("aria-hidden", "false");
      expanded.querySelector("[data-history-expanded-close]")?.addEventListener("click", () => {
        expanded.classList.remove("visible");
        expanded.setAttribute("aria-hidden", "true");
        line.classList.remove("visible");
      }, { once: true });
    });
  });
}

function bindMapZoom() {
  const frame = page.querySelector(".result-map-frame");
  if (!frame) return;
  const map = frame.querySelector(".result-county-map");
  const controls = page.querySelectorAll("[data-map-zoom]");
  const maxZoom = 8;
  let { zoom, panX, panY } = resultMapViewState;
  if (map?.dataset.initialZoom && zoom === 1 && panX === 0 && panY === 0) {
    const internalWidth = Number(map.getAttribute("width")) || map.viewBox?.baseVal?.width || map.clientWidth || 1;
    const renderedWidth = map.getBoundingClientRect().width || frame.clientWidth || internalWidth;
    const renderedScale = Math.max(.25, Math.min(1.25, renderedWidth / internalWidth));
    const isCompactDistrict = map.classList.contains("result-district-map") && frame.clientWidth < 560;
    zoom = Number(map.dataset.initialZoom) || zoom;
    if (isCompactDistrict) zoom = Math.min(zoom, 1.42);
    panX = (Number(map.dataset.initialPanX) || 0) * renderedScale;
    panY = (Number(map.dataset.initialPanY) || 0) * renderedScale;
  }
  const activePointers = new Map();
  let dragStart = null;
  let pinchStart = null;
  const clampPan = () => {
    if (zoom <= 1.01) {
      panX = 0;
      panY = 0;
      return;
    }
    const maxX = Math.max(0, frame.clientWidth * .56);
    const maxY = Math.max(0, frame.clientHeight * .56);
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  };
  const apply = () => {
    clampPan();
    resultMapViewState = { zoom, panX, panY };
    applyMapViewportState();
    controls.forEach((control) => {
      const mode = control.dataset.mapZoom;
      control.disabled = (mode === "in" && zoom >= maxZoom) || (mode === "out" && zoom <= .92);
    });
  };
  controls.forEach((control) => {
    control.addEventListener("click", () => {
      const mode = control.dataset.mapZoom;
      if (mode === "in") zoom = Math.min(maxZoom, zoom + .4);
      if (mode === "out") zoom = Math.max(.92, zoom - .12);
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
    zoom = event.deltaY < 0 ? Math.min(maxZoom, zoom + .28) : Math.max(.92, zoom - .16);
    apply();
  }, { passive: false });
  const pointerDistance = () => {
    const points = [...activePointers.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  };
  const pointerCenter = () => {
    const points = [...activePointers.values()];
    if (points.length < 2) return null;
    return {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2
    };
  };
  frame.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const targetPath = event.target?.closest?.(".result-county-map path:not(.map-context)") || null;
    if (activePointers.size >= 2) {
      const center = pointerCenter();
      pinchStart = {
        distance: pointerDistance() || 1,
        zoom,
        panX,
        panY,
        centerX: center?.x || event.clientX,
        centerY: center?.y || event.clientY
      };
      dragStart = null;
    } else {
      dragStart = { x: event.clientX, y: event.clientY, panX, panY, targetPath };
      pinchStart = null;
    }
    frame.setPointerCapture?.(event.pointerId);
    frame.classList.add("is-panning");
  });
  frame.addEventListener("pointermove", (event) => {
    if (!activePointers.has(event.pointerId)) return;
    event.preventDefault();
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size >= 2 && pinchStart) {
      const distance = pointerDistance() || pinchStart.distance;
      const center = pointerCenter();
      zoom = Math.max(.92, Math.min(maxZoom, pinchStart.zoom * (distance / pinchStart.distance)));
      panX = pinchStart.panX + ((center?.x || pinchStart.centerX) - pinchStart.centerX);
      panY = pinchStart.panY + ((center?.y || pinchStart.centerY) - pinchStart.centerY);
    } else if (dragStart) {
      panX = dragStart.panX + event.clientX - dragStart.x;
      panY = dragStart.panY + event.clientY - dragStart.y;
    }
    apply();
  });
  const endPan = (event) => {
    const start = dragStart;
    const hadPointer = activePointers.has(event.pointerId);
    activePointers.delete(event.pointerId);
    if (start?.targetPath && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 9) {
      start.targetPath.dispatchEvent(new CustomEvent("resultmaptap", {
        bubbles: false,
        detail: event
      }));
    }
    if (activePointers.size === 1) {
      const point = [...activePointers.values()][0];
      dragStart = { x: point.x, y: point.y, panX, panY, targetPath: null };
      pinchStart = null;
    } else {
      dragStart = null;
      pinchStart = null;
    }
    frame.releasePointerCapture?.(event.pointerId);
    if (!activePointers.size || !hadPointer) frame.classList.remove("is-panning");
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
    applyMapMarginColors();
    controls.forEach((control) => {
      control.classList.toggle("active", control.dataset.mapColor === mode);
      control.setAttribute("aria-pressed", String(control.dataset.mapColor === mode));
    });
  };
  controls.forEach((control) => {
    control.addEventListener("click", () => {
      mode = ["votes", "raw"].includes(control.dataset.mapColor) ? control.dataset.mapColor : "percent";
      apply();
    });
  });
  apply();
}

function raceDetailUpdateKey(race) {
  return JSON.stringify({
    reporting: race.estimatedVoteReporting,
    candidates: (race.candidates || []).map((candidate) => [
      candidate.name,
      candidate.votes,
      candidate.percent,
      candidate.callLabel || ""
    ]),
    calls: (race.calls || []).map((call) => [call.candidate, call.status, call.label || "", call.calledAt || ""]),
    counties: (race.counties || []).map((county) => [
      county.name,
      county.estimatedVoteReporting,
      (county.candidates || []).map((candidate) => [candidate.name, candidate.votes, candidate.percent])
    ]),
    voteHistory: (race.voteHistory || []).length
  });
}

function applyMapViewportState() {
  const frame = page.querySelector(".result-map-frame");
  if (!frame) return;
  const { zoom, panX, panY } = resultMapViewState;
  frame.style.setProperty("--result-map-zoom", zoom.toFixed(2));
  frame.style.setProperty("--result-map-pan-x", `${panX.toFixed(1)}px`);
  frame.style.setProperty("--result-map-pan-y", `${panY.toFixed(1)}px`);
  frame.style.setProperty("--result-map-label-size", `${Math.max(.34, .8 / Math.pow(Math.max(.92, zoom), 1.5)).toFixed(3)}rem`);
}

function applyMapMarginColors() {
  const frame = page.querySelector(".result-map-frame");
  if (!frame) return;
  const mode = ["votes", "raw"].includes(frame.dataset.marginMode) ? frame.dataset.marginMode : "percent";
  frame.querySelectorAll("[data-fill-percent]").forEach((node) => {
    const fill = mode === "raw" ? node.dataset.fillRaw : mode === "votes" ? node.dataset.fillVotes : node.dataset.fillPercent;
    if (node.tagName.toLowerCase() === "path") node.setAttribute("fill", fill || "#566274");
    else node.style.setProperty("--tile-color", fill || "#566274");
  });
}

function updateLastCheckedStamp(value = new Date().toISOString()) {
  resultLastCheckedAt = value;
  const lastCheckedNode = page.querySelector("[data-result-last-checked]");
  if (lastCheckedNode) lastCheckedNode.textContent = `Last checked ${timeLabel(resultLastCheckedAt)}`;
}

async function patchRaceDetail(race) {
  updateLastCheckedStamp();
  const reporting = Math.max(0, Math.min(100, Number(race.estimatedVoteReporting ?? 0)));
  const reportingStat = page.querySelector(".result-reporting-stat");
  if (reportingStat) reportingStat.textContent = `${estimatedInLabel(race.estimatedVoteReporting)} estimated in`;
  const reportingBar = page.querySelector(".result-reporting-bar i");
  if (reportingBar) reportingBar.style.width = `${reporting}%`;

  const lastUpdatedNode = page.querySelector("[data-result-last-updated]");
  if (lastUpdatedNode) lastUpdatedNode.textContent = `Last updated ${timeLabel(race.lastUpdated)}`;
  updateLastCheckedStamp(resultLastCheckedAt);
  const countyCountNode = page.querySelector("[data-result-county-count]");
  if (countyCountNode) countyCountNode.textContent = `${numberLabel((race.counties || []).length)} counties`;

  const countyPanelReporting = page.querySelector(".result-county-panel .section-head p");
  if (countyPanelReporting) countyPanelReporting.textContent = `${estimatedInLabel(race.estimatedVoteReporting)} estimated in.`;

  const candidatesNode = page.querySelector(".result-full-candidates");
  const displayRace = resultPartyViewEnabled && isOpenPrimary(race) ? { ...race, candidates: combineCandidatesByParty(race) } : race;
  
  const previousCandidatePercents = new Map();
  candidatesNode?.querySelectorAll("article[data-candidate-name]").forEach(article => {
    const name = article.dataset.candidateName;
    const percentText = article.querySelector(".result-full-numbers b")?.textContent || "";
    const match = percentText.match(/([\d.]+)/);
    if (match) {
      previousCandidatePercents.set(name.toLowerCase(), parseFloat(match[1]));
    }
  });
  
  if (candidatesNode) candidatesNode.innerHTML = candidateRows(displayRace);
  
  candidatesNode?.querySelectorAll("article[data-candidate-name]").forEach(article => {
    const name = article.dataset.candidateName;
    const percentText = article.querySelector(".result-full-numbers b")?.textContent || "";
    const match = percentText.match(/([\d.]+)/);
    if (match) {
      const newPercent = parseFloat(match[1]);
      const oldPercent = previousCandidatePercents.get(name.toLowerCase());
      if (oldPercent !== undefined && Math.abs(newPercent - oldPercent) > 0.1) {
        const change = newPercent - oldPercent;
        const changeEl = document.createElement("span");
        changeEl.className = `candidate-percent-change ${change < 0 ? "negative" : ""}`;
        changeEl.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
        article.style.position = "relative";
        article.appendChild(changeEl);
        setTimeout(() => changeEl.remove(), 2000);
      }
    }
  });

  const callSlot = page.querySelector("[data-result-call-slot]");
  if (callSlot) callSlot.innerHTML = raceCallBanner(race);

  const favoritePanel = page.querySelector("[data-favorite-race-panel]");
  if (favoritePanel) favoritePanel.outerHTML = favoriteRacePanelMarkup(race);

  await refreshAnalysisNotes(race);

  const mapFrame = page.querySelector(".result-map-frame");
  if (mapFrame) {
    const marginMode = mapFrame.dataset.marginMode || "percent";
    const mapRace = resultPartyViewEnabled && isOpenPrimary(race)
      ? { ...race, candidates: combineCandidatesByParty(race), counties: combineCountiesByParty(race) }
      : race;
    
    const previousCountyVotes = new Map();
    mapFrame.querySelectorAll("path[data-county-tooltip]").forEach(path => {
      const tooltip = path.dataset.countyTooltip;
      const match = tooltip.match(/(\d+(?:,\d+)*) votes/);
      if (match) {
        previousCountyVotes.set(tooltip, parseInt(match[1].replace(/,/g, "")));
      }
    });
    
    mapFrame.innerHTML = await countyShapeMap(mapRace);
    mapFrame.dataset.marginMode = marginMode;
    applyMapViewportState();
    applyMapMarginColors();
    
    mapFrame.querySelectorAll("path[data-county-tooltip]").forEach(path => {
      const tooltip = path.dataset.countyTooltip;
      const match = tooltip.match(/(\d+(?:,\d+)*) votes/);
      if (match) {
        const newVotes = parseInt(match[1].replace(/,/g, ""));
        const oldVotes = previousCountyVotes.get(tooltip);
        if (oldVotes !== undefined && newVotes > oldVotes) {
          path.classList.add("just-updated");
          setTimeout(() => path.classList.remove("just-updated"), 1500);
        }
      }
    });
    
    bindCountyHover();
  }

  const countyPanel = page.querySelector(".result-county-panel");
  const countyContent = countyPanel?.querySelector(".county-results-table, .meta");
  const countyRace = resultPartyViewEnabled && isOpenPrimary(race) ? { ...race, counties: combineCountiesByParty(race) } : race;
  if (countyContent) countyContent.outerHTML = countyRows(countyRace).trim();

  const historyPanel = page.querySelector(".result-vote-history-panel, .result-vote-history-empty");
  if (historyPanel) {
    const replacement = document.createElement("div");
    replacement.innerHTML = voteHistoryChart(race).trim();
    const nextPanel = replacement.firstElementChild;
    if (nextPanel) {
      historyPanel.replaceWith(nextPanel);
      bindVoteHistoryHover();
    }
  }

  bindPollCountdown();
  bindFavoriteRaceControls(race);
}

function favoriteRacePanelMarkup(race) {
  const favorite = isRaceFavorite(race.id);
  const saved = readFavoriteRaces().filter((item) => !item.archived);
  const savedLinks = saved.length ? saved.map((item) => `
    <a class="${String(item.id) === String(race.id) ? "active" : ""}" href="result.html?id=${encodeURIComponent(item.id)}">
      <span>${escapeHtml(item.state || "US")}</span>
      <strong>${escapeHtml(item.electionName || "Election results")}</strong>
    </a>
  `).join("") : `<p>No saved races yet.</p>`;
  return `
    <section class="result-favorite-panel" data-favorite-race-panel>
      <div>
        <p class="kicker">Saved races</p>
        <button type="button" class="result-favorite-toggle" data-current-race-favorite aria-pressed="${favorite}">
          <span>${favorite ? "★" : "☆"}</span>
          ${favorite ? "Saved" : "Save this race"}
        </button>
      </div>
      <nav aria-label="Saved result races">
        ${savedLinks}
      </nav>
    </section>
  `;
}

function bindFavoriteRaceControls(race) {
  page.querySelector("[data-current-race-favorite]")?.addEventListener("click", () => {
    setRaceFavorite(race, !isRaceFavorite(race.id));
    const panel = page.querySelector("[data-favorite-race-panel]");
    if (panel) {
      panel.outerHTML = favoriteRacePanelMarkup(race);
      bindFavoriteRaceControls(race);
    }
  });
}

function isOpenPrimary(race) {
  const scope = String(race.electionScope || "").toLowerCase();
  const name = String(race.electionName || "").toLowerCase();
  const type = String(race.type || "").toLowerCase();
  
  // Check if race is nonpartisan - if so, don't show party toggle
  if (scope.includes("nonpartisan") || name.includes("nonpartisan") || type.includes("nonpartisan")) {
    return false;
  }
  
  return scope.includes("open primary") || name.includes("open primary");
}

function combineCandidatesByParty(race) {
  const candidates = race.candidates || [];
  
  // Group candidates by party code
  const partyGroups = {};
  candidates.forEach(c => {
    const partyCode = c.partyCode || "Other";
    if (!partyGroups[partyCode]) {
      partyGroups[partyCode] = {
        partyCode,
        party: c.party || partyCode,
        candidates: [],
        totalVotes: 0
      };
    }
    partyGroups[partyCode].candidates.push(c);
    partyGroups[partyCode].totalVotes += Number(c.votes || 0);
  });
  
  // Define party colors
  const partyColors = {
    "D": "#1030b2",
    "R": "#e03a3e",
    "I": "#9b59b6",
    "L": "#f1c40f",
    "G": "#2a9d8f",
    "P": "#e74c3c",
    "Other": "#95a5a6"
  };
  
  // Get total votes for percentage calculation
  const totalVotes = Object.values(partyGroups).reduce((sum, group) => sum + group.totalVotes, 0);
  
  // Create combined candidates for each party
  const combined = Object.values(partyGroups).map(group => {
    let name = group.party;
    if (group.partyCode === "D") name = "Democrats";
    else if (group.partyCode === "R") name = "Republicans";
    else if (group.partyCode === "I") name = "Independents";
    else name = group.party;
    
    return {
      name,
      party: group.party,
      partyCode: group.partyCode,
      color: partyColors[group.partyCode] || partyColors["Other"],
      votes: group.totalVotes,
      percent: totalVotes > 0 ? (group.totalVotes / totalVotes) * 100 : 0,
      isCombined: true
    };
  });
  
  // Sort by votes descending
  return combined.sort((a, b) => b.votes - a.votes);
}

function combineVoteHistoryPointByParty(point) {
  const candidates = point?.candidates || [];
  const partyGroups = {};
  candidates.forEach((candidate) => {
    const code = candidate.partyCode || partyCode(candidate.party) || "Other";
    if (!partyGroups[code]) {
      partyGroups[code] = {
        partyCode: code,
        party: candidate.party || code,
        votes: 0
      };
    }
    partyGroups[code].votes += Number(candidate.votes || 0);
  });
  const totalVotes = Object.values(partyGroups).reduce((sum, group) => sum + group.votes, 0);
  const partyColors = {
    D: "#1030b2",
    R: "#e03a3e",
    I: "#9b59b6",
    L: "#f1c40f",
    G: "#2a9d8f",
    P: "#e74c3c",
    Other: "#95a5a6"
  };
  const candidatesByParty = Object.values(partyGroups).map((group) => {
    const name = group.partyCode === "D"
      ? "Democrats"
      : group.partyCode === "R"
        ? "Republicans"
        : group.partyCode === "I"
          ? "Independents"
          : group.party || group.partyCode;
    return {
      name,
      party: group.party,
      partyCode: group.partyCode,
      votes: group.votes,
      percent: totalVotes > 0 ? (group.votes / totalVotes) * 100 : 0,
      color: partyColors[group.partyCode] || partyColors.Other
    };
  }).sort((a, b) => Number(b.percent || 0) - Number(a.percent || 0) || Number(b.votes || 0) - Number(a.votes || 0));
  return {
    ...point,
    candidates: candidatesByParty
  };
}

function voteHistoryRaceForDisplay(race) {
  if (!resultPartyViewEnabled || !isOpenPrimary(race)) return race;
  return {
    ...race,
    candidates: combineCandidatesByParty(race),
    voteHistory: (race.voteHistory || []).map(combineVoteHistoryPointByParty)
  };
}

function combineCountiesByParty(race) {
  const counties = race.counties || [];
  
  // Define party colors
  const partyColors = {
    "D": "#1030b2",
    "R": "#e03a3e",
    "I": "#9b59b6",
    "L": "#f1c40f",
    "G": "#2a9d8f",
    "P": "#e74c3c",
    "Other": "#95a5a6"
  };
  
  return counties.map(county => {
    const countyCandidates = county.candidates || [];
    
    // Group county candidates by party code
    const partyGroups = {};
    countyCandidates.forEach(c => {
      const partyCode = c.partyCode || "Other";
      if (!partyGroups[partyCode]) {
        partyGroups[partyCode] = {
          partyCode,
          party: c.party || partyCode,
          totalVotes: 0
        };
      }
      partyGroups[partyCode].totalVotes += Number(c.votes || 0);
    });
    
    // Get total votes for percentage calculation
    const totalVotes = Object.values(partyGroups).reduce((sum, group) => sum + group.totalVotes, 0);
    
    // Create combined candidates for each party in this county
    const combinedCandidates = Object.values(partyGroups).map(group => {
      let name = group.party;
      if (group.partyCode === "D") name = "Democrats";
      else if (group.partyCode === "R") name = "Republicans";
      else if (group.partyCode === "I") name = "Independents";
      else name = group.party;
      
      return {
        name,
        party: group.party,
        partyCode: group.partyCode,
        color: partyColors[group.partyCode] || partyColors["Other"],
        votes: group.totalVotes,
        percent: totalVotes > 0 ? (group.totalVotes / totalVotes) * 100 : 0
      };
    });
    
    // Sort by votes descending
    combinedCandidates.sort((a, b) => b.votes - a.votes);
    
    return {
      ...county,
      candidates: combinedCandidates
    };
  });
}

function bindPartyCombineToggle(race) {
  const toggle = page.querySelector("[data-party-combine-toggle]");
  if (!toggle) return;

  const syncToggle = () => {
    toggle.textContent = resultPartyViewEnabled ? "Candidate View" : "Party View";
    toggle.classList.toggle("active", resultPartyViewEnabled);
    toggle.setAttribute("aria-pressed", String(resultPartyViewEnabled));
  };
  syncToggle();
  
  toggle.addEventListener("click", async () => {
    resultPartyViewEnabled = !resultPartyViewEnabled;
    syncToggle();
    
    const candidatesNode = page.querySelector(".result-full-candidates");
    const mapFrame = page.querySelector(".result-map-frame");
    const countyPanel = page.querySelector(".result-county-panel");
    const countyContent = countyPanel?.querySelector(".county-results-table, .meta");
    const historyPanel = page.querySelector(".result-vote-history-panel, .result-vote-history-empty");
    const displayRace = resultPartyViewEnabled ? { ...race, candidates: combineCandidatesByParty(race) } : race;
    const mapRace = resultPartyViewEnabled
      ? { ...race, candidates: combineCandidatesByParty(race), counties: combineCountiesByParty(race) }
      : race;
    
    if (candidatesNode) {
      candidatesNode.innerHTML = candidateRows(displayRace);
    }
    
    if (mapFrame) {
      const marginMode = mapFrame.dataset.marginMode || "percent";
      mapFrame.innerHTML = await countyShapeMap(mapRace);
      mapFrame.dataset.marginMode = marginMode;
      applyMapViewportState();
      applyMapMarginColors();
      bindCountyHover();
    }

    if (countyContent) {
      countyContent.outerHTML = countyRows(mapRace).trim();
    }

    if (historyPanel) {
      const replacement = document.createElement("div");
      replacement.innerHTML = voteHistoryChart(race).trim();
      const nextPanel = replacement.firstElementChild;
      if (nextPanel) {
        historyPanel.replaceWith(nextPanel);
        bindVoteHistoryHover();
      }
    }
  });
}

async function renderRace(race) {
  await primeCandidatePhotoBgColors(race);
  const leader = leadingCandidate(race);
  const mapMarkup = await countyShapeMap(race);
  const notesData = await loadAnalysisNotes();
  const analystNotes = notesData.races?.[String(race.id)] || [];
  const closeIso = pollCloseIso(race);
  const reporting = Math.max(0, Math.min(100, Number(race.estimatedVoteReporting ?? 0)));
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

        <div data-result-call-slot>${raceCallBanner(race)}</div>

        <div class="result-night-meta result-night-meta-top">
          <span class="live-indicator" aria-hidden="true">● LIVE</span>
          <span data-poll-close="${escapeHtml(closeIso)}" class="result-poll-close-stat">${escapeHtml(pollCloseLabel(closeIso))}</span>
          <span data-result-last-updated>Last updated ${escapeHtml(timeLabel(race.lastUpdated))}</span>
          <span data-result-last-checked>Last checked ${escapeHtml(timeLabel(resultLastCheckedAt))}</span>
          <span data-result-county-count>${numberLabel((race.counties || []).length)} counties</span>
        </div>
        <div class="result-reporting-label-row">
          <span class="result-reporting-stat">${estimatedInLabel(race.estimatedVoteReporting)} estimated in</span>
        </div>
        <div class="result-reporting-bar" aria-label="${escapeHtml(estimatedInLabel(race.estimatedVoteReporting))} estimated in">
          <i style="width:${reporting}%"></i>
        </div>

        <div class="result-full-candidates">
          ${candidateRows(race)}
        </div>
        ${isOpenPrimary(race) ? `<div class="result-party-toggle"><button type="button" data-party-combine-toggle>Party View</button></div>` : ""}
        ${favoriteRacePanelMarkup(race)}
      </div>

      <aside class="result-map-panel">
        <div class="result-map-tabs">
          <button type="button" data-map-color="percent">% Margin</button>
          <button type="button" data-map-color="votes">Vote Margin</button>
          <button type="button" data-map-color="raw">Raw</button>
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
        <p>${estimatedInLabel(race.estimatedVoteReporting)} statewide estimated in.</p>
      </div>
      ${countyRows(race)}
    </section>
  `;
  bindCountyHover();
  bindMapZoom();
  bindMapColorMode();
  bindVoteHistoryHover();
  bindPollCountdown();
  bindFavoriteRaceControls(race);
  bindPartyCombineToggle(race);
}

async function fetchRace() {
  if (!raceId) throw new Error("Missing race id.");
  const fetchStaticRace = async () => {
    const staticResponse = await fetch(`data/live-results-races/${encodeURIComponent(raceId)}.json`, { cache: "no-store" });
    if (!staticResponse.ok) throw new Error(`Race detail returned ${staticResponse.status}`);
    return staticResponse.json();
  };
  const mergeStoredHistory = async (race) => {
    try {
      const stored = await fetchStaticRace();
      const storedHistory = Array.isArray(stored.voteHistory) ? stored.voteHistory : [];
      const liveHistory = Array.isArray(race.voteHistory) ? race.voteHistory : [];
      if (storedHistory.length > liveHistory.length) return { ...race, voteHistory: storedHistory };
    } catch {
      // Static detail history is an optional fallback when the live API has no persisted snapshots yet.
    }
    return race;
  };
  try {
    const liveResponse = await fetch(`/api/live-results/race?id=${encodeURIComponent(raceId)}`, { cache: "no-store" });
    if (liveResponse.ok) return mergeStoredHistory(await liveResponse.json());
  } catch {
    // Static deployments do not have the live API; fall back to generated JSON.
  }
  return fetchStaticRace();
}

let raceDetailInitialized = false;
let raceDetailUpdateKeyCache = "";

async function loadRaceDetail() {
  try {
    const race = await applyLocalRaceCalls(await fetchRace());
    const updateKey = raceDetailUpdateKey(race);
    if (raceDetailInitialized && updateKey === raceDetailUpdateKeyCache) {
      const lastUpdatedNode = page.querySelector("[data-result-last-updated]");
      if (lastUpdatedNode) lastUpdatedNode.textContent = `Last updated ${timeLabel(race.lastUpdated)}`;
      updateLastCheckedStamp();
      await refreshAnalysisNotes(race);
      bindPollCountdown();
      return;
    }
    if (!raceDetailInitialized) {
      await renderRace(race);
      raceDetailInitialized = true;
    } else {
      await patchRaceDetail(race);
    }
    raceDetailUpdateKeyCache = updateKey;
  } catch (error) {
    raceDetailInitialized = false;
    raceDetailUpdateKeyCache = "";
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
