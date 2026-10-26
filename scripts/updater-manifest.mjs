// Složí latest.json pro updater ze sestavených balíčků všech platforem. Podpis čte z <balíček>.sig.
// Bez kterékoli platformy odmítne: neúplný manifest by aplikace na chybějící platformě neaktualizoval.
// Použití: node scripts/updater-manifest.mjs <tag> <výstup latest.json> <platforma>=<balíček> [...]
//   node scripts/updater-manifest.mjs v0.15.0 dist/latest.json \
//     darwin-aarch64=dist/Stavebak_universal.app.tar.gz darwin-x86_64=dist/Stavebak_universal.app.tar.gz \
//     windows-x86_64=dist/Stavebak_0.15.0_x64-setup.exe
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const REQUIRED = ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"];

const [tag, out, ...pairs] = process.argv.slice(2);
if (!tag || !out || pairs.length === 0) throw new Error("chybí argumenty");
const repo = process.env.GITHUB_REPOSITORY || "Juicyscoop88/stavebak-desktop";

const platforms = {};
for (const pair of pairs) {
  const [platform, file] = pair.split("=");
  if (!platform || !file) throw new Error(`neplatný argument: ${pair}`);
  platforms[platform] = {
    signature: readFileSync(`${file}.sig`, "utf8").trim(),
    url: `https://github.com/${repo}/releases/download/${tag}/${basename(file)}`,
  };
}
const missing = REQUIRED.filter((p) => !platforms[p]);
if (missing.length) throw new Error(`chybí platformy: ${missing.join(", ")}`);

const json = { version: tag.replace(/^v/, ""), notes: process.env.NOTES || "", pub_date: new Date().toISOString(), platforms };
writeFileSync(out, JSON.stringify(json, null, 2));
console.log("platformy:", Object.keys(platforms).join(", "));
