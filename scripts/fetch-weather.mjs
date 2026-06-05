import fs from "node:fs/promises";

const OUT_DIR = "docs";
const WEATHER_PATH = `${OUT_DIR}/weather.json`;
const MENU_PATH = `${OUT_DIR}/menu.json`;
const FORCE_RUN = process.env.WEATHER_FORCE_RUN === "true" || process.env.RIE_FORCE_RUN === "true";

// RIE Les Trois Parcs / Éragny area.
const LOCATION = "Éragny";
const LATITUDE = 49.0167;
const LONGITUDE = 2.1;

function parisParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    dateFr: `${get("day")}/${get("month")}/${get("year")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute"))
  };
}

async function readJson(path) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function weatherCodeLabel(code) {
  const labels = new Map([
    [0, "ensoleillé"],
    [1, "plutôt ensoleillé"],
    [2, "partiellement nuageux"],
    [3, "couvert"],
    [45, "brumeux"],
    [48, "brumeux"],
    [51, "bruine légère"],
    [53, "bruine"],
    [55, "bruine marquée"],
    [61, "pluie légère"],
    [63, "pluvieux"],
    [65, "fortement pluvieux"],
    [71, "neige légère"],
    [73, "neigeux"],
    [75, "fortement neigeux"],
    [80, "averses légères"],
    [81, "averses"],
    [82, "fortes averses"],
    [95, "orageux"],
    [96, "orageux"],
    [99, "orageux"]
  ]);
  return labels.get(Number(code)) ?? "variable";
}

await fs.mkdir(OUT_DIR, { recursive: true });

const now = parisParts();
console.log(`Paris time detected: ${now.dateFr} ${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")}.`);

const menu = await readJson(MENU_PATH);
if (!FORCE_RUN && !(menu?.status === "ok" && menu?.date === now.date)) {
  console.log(`Menu for ${now.dateFr} is not published yet; skipping weather update.`);
  process.exit(0);
}

const previous = await readJson(WEATHER_PATH);
if (!FORCE_RUN && previous?.status === "ok" && previous?.date === now.date) {
  console.log(`Weather already published for ${now.dateFr}.`);
  process.exit(0);
}

const url = new URL("https://api.open-meteo.com/v1/forecast");
url.searchParams.set("latitude", String(LATITUDE));
url.searchParams.set("longitude", String(LONGITUDE));
url.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code,precipitation,rain,cloud_cover");
url.searchParams.set("daily", "sunshine_duration,precipitation_probability_max");
url.searchParams.set("timezone", "Europe/Paris");

let response;
try {
  response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "rie-menu-feed-weather"
    },
    signal: AbortSignal.timeout(60000)
  });
} catch (error) {
  console.log(`Weather fetch failed: ${error.message}`);
  process.exit(0);
}

if (!response.ok) {
  console.log(`Weather provider returned HTTP ${response.status}.`);
  process.exit(0);
}

const data = await response.json();
const current = data.current ?? {};
const daily = data.daily ?? {};

const weather = {
  status: "ok",
  source: "open-meteo.com",
  location: LOCATION,
  latitude: LATITUDE,
  longitude: LONGITUDE,
  date: now.date,
  fetchedAt: new Date().toISOString(),
  description: weatherCodeLabel(current.weather_code),
  weatherCode: current.weather_code ?? null,
  tempC: Number.isFinite(Number(current.temperature_2m)) ? Math.round(Number(current.temperature_2m)) : null,
  feelsLikeC: Number.isFinite(Number(current.apparent_temperature)) ? Math.round(Number(current.apparent_temperature)) : null,
  precipMM: Number.isFinite(Number(current.precipitation ?? current.rain)) ? Number(current.precipitation ?? current.rain) : 0,
  chanceRain: Array.isArray(daily.precipitation_probability_max) ? daily.precipitation_probability_max[0] ?? null : null,
  sunHours: Array.isArray(daily.sunshine_duration) && Number.isFinite(Number(daily.sunshine_duration[0]))
    ? Math.round((Number(daily.sunshine_duration[0]) / 3600) * 10) / 10
    : null,
  cloudCover: Number.isFinite(Number(current.cloud_cover)) ? Number(current.cloud_cover) : null
};

await fs.writeFile(WEATHER_PATH, `${JSON.stringify(weather, null, 2)}\n`, "utf8");
console.log(`Published weather for ${LOCATION}: ${weather.description}, ${weather.tempC ?? "?"} °C.`);
