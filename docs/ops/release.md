# Vývojový proces a release

Trunk-based, jedna hlavní větev `main`. Vzor je proces MCP serveru Stavebák, místo nasazení je výstupem release build aplikace.

## Tok změny

1. Větev z `main`: `feat/…`, `fix/…`, `docs/…`, `ci/…`.
2. Lokálně `pnpm build` (typecheck a build frontendu), `pnpm exec vitest run`, v `src-tauri` `cargo clippy --all-targets` a `cargo test`.
3. PR do `main`. Povinné kontroly (workflow `CI`, `.github/workflows/ci.yml`):
   - `validate`: `pnpm build`, `pnpm exec vitest run`, `cargo clippy --locked --all-targets`, `cargo test --locked`. Běží na macOS.
   - `secrets`: gitleaks nad celou historií. Známé nálezy z převzaté historie jsou v `.gitleaksignore`.
4. Squash merge. Ruleset `main` (`.github/rulesets/main.json`): jen přes PR, jen squash, bez přímého pushe, force pushe a mazání větve. Větev se po merge smaže sama.

Dependabot (`.github/dependabot.yml`) jednou týdně otevírá seskupené PR pro npm, cargo a GitHub Actions. Procházejí stejnými kontrolami.

## Release

Workflow `Release` (`.github/workflows/release.yml`) spouští push tagu `v*`. Sestaví aplikaci a založí **draft** release s artefakty. Nic se nepublikuje samo.

1. Na větvi `release/vX.Y.Z`: `./scripts/bump-version.sh X.Y.Z` (mění `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`), PR, squash merge.
2. Tag na `main`: `git tag vX.Y.Z origin/main && git push origin vX.Y.Z`.
3. Schválit job v environmentu `release`, počkat na workflow, stáhnout artefakty z draftu a vyzkoušet instalaci na čistém Macu a Windows.
4. Publikovat draft. Teprve tím se release stane `latest` a updater v aplikacích ho uvidí (`releases/latest/download/latest.json`).

Release se dělá jen na výslovný pokyn.

## Rollback

Updater instaluje jen vyšší verzi, než je nainstalovaná. Z toho plyne:

- **Zastavit šíření:** chybný release vrátit do draftu nebo smazat. `latest` pak ukazuje na předchozí publikovaný release a další aplikace se na chybnou verzi neaktualizují.
- **Vrátit uživatele, kteří už aktualizovali:** nový patch release (vyšší číslo verze) s opraveným nebo vráceným kódem. Návrat na nižší verzi updater neumí.
- Tag chybného releasu nemazat a nepřesouvat, číslo verze se znovu nepoužívá.

## Tajemství

Žádný klíč, certifikát ani heslo nesmí být v repu ani ve výpisu workflow. Tajemství podpisu jsou jen v GitHub environment `release` (ne na úrovni repa), záloha soukromých klíčů ve správci hesel.

| Secret / proměnná | K čemu | Stav |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | podpis aktualizací pro updater | klíč vygenerován 2026-10-23 (`~/.tauri/stavebak-updater.key`, heslo v klíčence „Stavebak updater key“), do environmentu zatím nenahrán |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` | podpis macOS (Developer ID Application, export .p12 v base64) | certifikát existuje v klíčence, export chybí |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | notarizace macOS (heslo pro aplikaci, ne heslo k účtu) | chybí |
| `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` + proměnné `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE` | podpis Windows (Azure Artifact Signing) | čeká na ověření organizace |

`GITHUB_TOKEN` dává GitHub sám, workflow má jen `contents: write` pro založení releasu.

## Rozhodnutí (2026-10-23, spec 097 v repu serveru)

1. **Klíč updateru je nový.** Veřejný klíč v `src-tauri/tauri.conf.json` je náš, původní z TOKENICODE je pryč. Instalace se starým klíčem (jen vývojové) aktualizaci nepřijmou, nainstalují se znovu. Ztráta soukromého klíče znamená, že stávající instalace už žádnou aktualizaci nepřijmou: záloha do správce hesel je povinná.
2. **macOS: jeden universal build**, podpis Developer ID, notarizace. Minimální verze macOS 13. Lokální ověření bez CI: `scripts/release-macos-local.sh` (identita a profil notarytool z klíčenky, nic nenahrává).
3. **Platformy: macOS a Windows od začátku**, Linux ne. Cílovka pracuje v BricsCADu a AutoCADu, převážně na Windows.
4. **Podpis Windows přes Azure Artifact Signing**, vydavatel Typico Games s.r.o. (pro jednotlivce v EU služba není). Dokud není nastavená proměnná `AZURE_SIGNING_ACCOUNT`, workflow sestaví installer nepodepsaný a SmartScreen varuje. Takový release nepublikovat mimo testery. Reputace SmartScreen se u nového vydavatele buduje s počtem stažení.
5. **Schvalovací brána:** job `release` běží v environmentu `release`. V nastavení repa mu přidat povinného schvalovatele, tajemství podpisu jen tam.
6. **Edice Alpha zrušena** (`editions/`, tagy `-alpha`). Kód `src/lib/edition.ts` zůstává, výchozí edice je stabilní.
7. **Název produktu `Stavebak`** (bez diakritiky kvůli názvům souborů installeru a updateru). Zobrazovaný název s diakritikou (`APP_NAME` v `vite.config.ts`, titulek okna) je samostatná změna.

## Známý dluh

- `cargo clippy` hlásí kolem 30 varování ze zděděného kódu. Kontrola padá jen na chybách. Po úklidu přidat `-D warnings`.
- `cargo fmt --check` hlásí rozdíly, proto zatím není v kontrolách.
- Frontend nemá linter (ESLint), kontrolou je `tsc` se `strict` a `noUnused*`.
