import fs from "node:fs/promises";

const SOURCE_URL =
  "https://www.lestroisparcs.com/restaurant-entreprises-eragny/parc-des-bellevues";

const OUT_DIR = "docs";
const START_HOUR = Number(process.env.RIE_START_HOUR_PARIS ?? 9);
const END_HOUR = Number(process.env.RIE_END_HOUR_PARIS ?? 14);

function parisNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value])
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    dateFr: `${parts.day}/${parts.month}/${parts.year}`,
    hour: Number(parts.hour)
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
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractPlats(block) {
  const matches = [...block.matchAll(/<p[^>]*class=["'][^"']*\bplats\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)];

  return matches
    .map((match) => htmlToText(match[1]).join(" - "))
    .filter(Boolean);
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

if (now.hour < START_HOUR || now.hour > END_HOUR) {
  console.log(`Outside Paris update window: ${now.hour}h.`);
  process.exit(0);
}

const previous = await readPreviousMenu();

if (previous?.status === "ok" && previous?.date === now.date) {
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

const plats = extractPlats(extractTodayBlock(html));

if (plats.length === 0) {
  console.log("No dish found yet.");
  process.exit(0);
}

const text = [`Menu RIE Bellevues du ${now.dateFr}`, "", ...plats.map((plat) => `- ${plat}`)].join("\n");

const menu = {
  status: "ok",
  date: now.date,
  dateFr: now.dateFr,
  fetchedAt: new Date().toISOString(),
  sourceUrl: SOURCE_URL,
  plats,
  text
};

await fs.writeFile(`${OUT_DIR}/menu.json`, `${JSON.stringify(menu, null, 2)}\n`, "utf8");
await fs.writeFile(`${OUT_DIR}/menu.txt`, `${text}\n`, "utf8");
await fs.writeFile(
  `${OUT_DIR}/index.html`,
  `<pre>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</pre>\n`,
  "utf8"
);

console.log(`Published ${plats.length} dish(es) for ${now.dateFr}.`);
