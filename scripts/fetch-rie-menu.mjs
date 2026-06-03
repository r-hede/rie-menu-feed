import fs from "node:fs/promises";

const SOURCE_URL =
  "https://www.lestroisparcs.com/restaurant-entreprises-eragny/parc-des-bellevues";

const OUT_DIR = "docs";
const FORCE_RUN = process.env.RIE_FORCE_RUN === "true";
const START_HOUR = Number(process.env.RIE_START_HOUR_PARIS ?? 9);
const END_HOUR = Number(process.env.RIE_END_HOUR_PARIS ?? 12);

function parisNow() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return {
    date: `${year}-${month}-${day}`,
    dateFr: `${day}/${month}/${year}`,
    hour: now.getHours(),
    minute: now.getMinutes()
  };
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function extractTodayBlock(html) {
  const start = /<div[^>]+id=["']menu_jour["'][^>]*>/i.exec(html);
  if (!start) return "";

  const rest = html.slice(start.index);
  const end = /<div[^>]+id=["']menu_demain["'][^>]*>/i.exec(rest);

  return end ? rest.slice(0, end.index) : rest.slice(0, 10000);
}

function htmlToText(html) {
  return decodeHtml(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" - ");
}

function parseDishes(block) {
  const texts = [...block.matchAll(/<p[^>]*class=["'][^"']*\bplats\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => htmlToText(match[1]))
    .join(" - ");

  const dishes = [];
  const pattern = /(.+?)[/\s]+(\d+[,.]\d{2})\s*€/g;
  let match;

  while ((match = pattern.exec(texts)) !== null) {
    const name = match[1]
      .replace(/^\s*[-–—]\s*/, "")
      .replace(/\s*[-–—]\s*$/, "")
      .trim();

    const price = Number(match[2].replace(",", "."));

    if (name && Number.isFinite(price)) {
      dishes.push({ name, price });
    }
  }

  return dishes;
}

async function readPreviousMenu() {
  try {
    return JSON.parse(await fs.readFile(`${OUT_DIR}/menu.json`, "utf8"));
  } catch {
    return null;
  }
}

await fs.mkdir(OUT_DIR, { recursive: true });

const now = parisNow();

console.log(
  `Paris time detected: ${now.dateFr} ${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")}.`
);
console.log(`Runtime timezone: ${process.env.TZ || "not set"}.`);

if (!FORCE_RUN && (now.hour < START_HOUR || now.hour > END_HOUR)) {
  console.log(`Outside Paris update window: ${now.hour}h.`);
  process.exit(0);
}

if (FORCE_RUN) {
  console.log("Manual force mode enabled: ignoring update window.");
}

const previous = await readPreviousMenu();

if (!FORCE_RUN && previous?.status === "ok" && previous?.date === now.date) {
  console.log(`Menu already published for ${now.dateFr}.`);
  process.exit(0);
}

let response;

try {
  response = await fetch(SOURCE_URL, {
    headers: {
      Accept: "text/html",
      "User-Agent": "Mozilla/5.0 rie-menu-feed"
    },
    signal: AbortSignal.timeout(60000)
  });
} catch (error) {
  console.log(`RIE fetch failed: ${error.message}`);
  process.exit(0);
}

if (!response.ok) {
  console.log(`RIE returned HTTP ${response.status}.`);
  process.exit(0);
}

const html = await response.text();

if (!html.includes(now.dateFr)) {
  console.log(`Today's date ${now.dateFr} is not visible yet.`);
  process.exit(0);
}

const dishes = parseDishes(extractTodayBlock(html));

if (dishes.length === 0) {
  console.log("No dish found yet.");
  process.exit(0);
}

const menu = {
  status: "ok",
  date: now.date,
  fetchedAt: new Date().toISOString(),
  dishes
};

await fs.writeFile(`${OUT_DIR}/menu.json`, `${JSON.stringify(menu, null, 2)}\n`, "utf8");

console.log(`Published ${dishes.length} dish(es) for ${now.dateFr}.`);
