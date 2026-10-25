// Doplní Windows do latest.json v draftu releasu (macOS vzniká lokálně a nahrává svůj latest.json).
// Použití: node scripts/merge-updater-windows.mjs <tag> <setup.exe> <setup.exe.sig> <výstup latest.json>
// Existující latest.json z draftu (pokud je) se zachová, přidá se jen windows-x86_64.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

const [tag, setup, sigFile, out] = process.argv.slice(2);
if (!tag || !setup || !sigFile || !out) throw new Error("chybí argumenty");
const repo = process.env.GITHUB_REPOSITORY;
const version = tag.replace(/^v/, "");

let json = { version, notes: "", pub_date: new Date().toISOString(), platforms: {} };
try {
  execFileSync("gh", ["release", "download", tag, "--pattern", "latest.json", "--output", out, "--clobber"], { stdio: "pipe" });
  if (existsSync(out)) json = JSON.parse(readFileSync(out, "utf8"));
} catch {
  console.log("latest.json v draftu zatím není, vytvářím nový");
}
if (json.version !== version) throw new Error(`latest.json je pro verzi ${json.version}, tag je ${version}`);

json.platforms["windows-x86_64"] = {
  signature: readFileSync(sigFile, "utf8").trim(),
  url: `https://github.com/${repo}/releases/download/${tag}/${basename(setup)}`,
};
writeFileSync(out, JSON.stringify(json, null, 2));
console.log("platformy:", Object.keys(json.platforms).join(", "));
