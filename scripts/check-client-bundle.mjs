// Fails if server secrets (their names, or their build-time values) appear in client assets.
// CI builds with sentinel TMDB_TOKEN / RYUUJI_PASSCODE values, then runs this.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = ".next/static";
const SENTINEL = "ryuuji-bundle-sentinel";
const needles = ["TMDB_TOKEN", "RYUUJI_PASSCODE", SENTINEL, process.env.TMDB_TOKEN, process.env.RYUUJI_PASSCODE].filter(
  (s) => s && s.length >= 8,
);

if (!existsSync(DIR)) {
  console.error(`${DIR} not found; run \`npm run build\` first.`);
  process.exit(1);
}

const hits = [];
for (const file of readdirSync(DIR, { recursive: true, withFileTypes: true })) {
  if (!file.isFile()) continue;
  const path = join(file.parentPath, file.name);
  const text = readFileSync(path, "latin1");
  // Report which secret matched by name only, never the value.
  needles.forEach((needle, i) => text.includes(needle) && hits.push(`${path}: secret #${i + 1}`));
}

if (hits.length) {
  console.error(`Server secrets found in the client bundle:\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`No server secrets in ${DIR} (${needles.length} needles checked).`);
