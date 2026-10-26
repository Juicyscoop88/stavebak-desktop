# Vývojový proces a release

Trunk-based, jedna hlavní větev `main`. Vzor je proces MCP serveru Stavebák, místo nasazení je výstupem release build aplikace.

## Tok změny

1. Větev z `main`: `feat/…`, `fix/…`, `docs/…`, `ci/…`.
2. Lokálně `pnpm build` (typecheck a build frontendu), `pnpm exec vitest run`, v `src-tauri` `cargo clippy --all-targets` a `cargo test`.
3. PR do `main`. Povinné kontroly (workflow `CI`, `.github/workflows/ci.yml`):
   - `validate`: `pnpm build`, `pnpm exec vitest run`, `cargo clippy --locked --all-targets`, `cargo test --locked`. Běží na macOS.
   - `secrets`: gitleaks nad celou historií.
4. Squash merge. Ruleset `main` (`.github/rulesets/main.json`): jen přes PR, jen squash, bez přímého pushe, force pushe a mazání větve. Větev se po merge smaže sama.

Dependabot (`.github/dependabot.yml`) jednou týdně otevírá seskupené PR pro npm, cargo a GitHub Actions. Procházejí stejnými kontrolami.

## Release

Workflow `Release` (`.github/workflows/release.yml`) spouští push tagu `v*`. Celý release vzniká v CI, jde ho spustit odkudkoli (i z Windows) a Mac k němu není potřeba. Nic se nepublikuje samo.

Joby:
- `macos` (`macos-latest`): `scripts/release-macos.sh` s `UPDATER=1`, tedy universal build, podpis Developer ID z dočasné klíčenky, notarizace a staple DMG i aplikace pro updater, kontrola `spctl`.
- `windows` (`windows-latest`): NSIS installer, podpis přes Azure (pokud je nastavený), `.sig` pro updater.
- `draft` (needs oba): `scripts/updater-manifest.mjs` složí `latest.json` a založí **draft** se všemi soubory. Bez kterékoli platformy manifest odmítne, takže **neúplný draft nevznikne**. Opakovaný běh doplní existující draft, publikovaný release nepřepíše.

Soubory v releasu: `Stavebak.dmg` a `Stavebak_X.Y.Z_universal.dmg`, `Stavebak_universal.app.tar.gz(.sig)`, `Stavebak-setup.exe` a `Stavebak_X.Y.Z_x64-setup.exe(.sig)`, `latest.json`.

1. Na větvi `release/vX.Y.Z`: `./scripts/bump-version.sh X.Y.Z` (mění `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`), PR, squash merge. Shodu verzí hlídá `scripts/check-version.mjs` v kontrole `validate` a workflow `Release` na začátku ověří, že tag odpovídá verzi.
2. Tag na `main`: `git tag vX.Y.Z origin/main && git push origin vX.Y.Z`.
3. Schválit environment `release` (jedno schválení pustí `macos` i `windows`), počkat na workflow, stáhnout artefakty z draftu a vyzkoušet instalaci na čistém Macu a Windows.
4. Publikovat draft. Teprve tím se release stane `latest` a updater v aplikacích ho uvidí (`releases/latest/download/latest.json`).

**Lokálně** (ověřovací build na Macu): `scripts/release-macos.sh` (identita a profil notarytool z klíčenky), `SKIP_NOTARIZE=1` jen build a podpis. Nouzový release z Macu (`UPDATER=1`, CI nefunguje) odmítne stavět, pokud pracovní složka není čistá, `HEAD` není `origin/main`, verze nesedí nebo tag verze už existuje. `latest.json` pak složit `scripts/updater-manifest.mjs` se soubory všech platforem.

Release se dělá jen na výslovný pokyn.

**Číslo verze musí být vyšší než 0.13.0.** Repo začíná čistou historií (2026-10-25), release v0.13.0 do něj byl přenesen i s artefakty, aby fungovaly aktualizace a odkazy ke stažení. Jeho tag ukazuje na výchozí commit, ne na zdroj buildu 0.13.0. Před bumpem ověřit `git ls-remote --tags origin vX.Y.Z`.

## Rollback

Updater instaluje jen vyšší verzi, než je nainstalovaná. Z toho plyne:

- **Zastavit šíření:** chybný release vrátit do draftu nebo smazat. `latest` pak ukazuje na předchozí publikovaný release a další aplikace se na chybnou verzi neaktualizují.
- **Vrátit uživatele, kteří už aktualizovali:** nový patch release (vyšší číslo verze) s opraveným nebo vráceným kódem. Návrat na nižší verzi updater neumí.
- Tag chybného releasu nemazat a nepřesouvat, číslo verze se znovu nepoužívá.

## Tajemství

Žádný klíč, certifikát ani heslo nesmí být v repu ani ve výpisu workflow. Tajemství podpisu jsou jen v GitHub environment `release` (ne na úrovni repa), záloha soukromých klíčů ve správci hesel.

| Secret / proměnná | K čemu | Stav |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | podpis aktualizací pro updater | v environmentu `release` od 2026-10-25 (repo s čistou historií, nastaveno znovu z lokálního klíče). Lokálně `~/.tauri/stavebak-updater.key`, heslo v klíčence „Stavebak updater key“, záloha v iCloud Drive a v aplikaci Hesla |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` | podpis macOS (Developer ID Application, export .p12 v base64) | v environmentu `release` od 2026-10-26 (`scripts/setup-ci-signing.sh`, viz níže). Lokálně identita v klíčence, záloha `.p12` v iCloud Drive `Stavebak/ci-signing`, heslo v klíčence „Stavebak CI p12“ |
| `APPLE_NOTARY_KEY`, `APPLE_NOTARY_KEY_ID`, `APPLE_NOTARY_ISSUER` | notarizace macOS přes App Store Connect API klíč (.p8) | v environmentu `release` od 2026-10-26, klíč `stavebak-ci-notary` (role Developer), záloha `.p8` s Key ID a Issuer ID v iCloud Drive `Stavebak/ci-signing`. Lokálně dál profil notarytool v klíčence |
| `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` + proměnné `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE` | podpis Windows (Azure Artifact Signing) | čeká na ověření organizace |

`GITHUB_TOKEN` dává GitHub sám, `contents: write` má jen job `draft`.

### Nastavení macOS tajemství (jednou, na Macu)

Proč API klíč a ne Apple ID s heslem pro aplikaci: není svázaný s osobním účtem ani 2FA, má omezenou roli a jde kdykoli zneplatnit bez dopadu na cokoli jiného.

1. **Certifikát:** Klíčenka → Moje certifikáty → „Developer ID Application: …“ (s rozbaleným soukromým klíčem) → Exportovat → `.p12` se silným heslem. Exportovat jen tuto jednu položku.
2. **Notarizační klíč:** App Store Connect → Uživatelé a přístup → Integrace → Klíče App Store Connect → nový klíč s rolí Developer. Stáhnout `AuthKey_<KEY_ID>.p8` (jde jen jednou) a opsat Issuer ID z hlavičky stránky.
3. `gh auth login` účtem s právy admin k repozitáři.
4. `./scripts/setup-ci-signing.sh <identita.p12> <AuthKey_KEY_ID.p8> <Issuer ID>`. Skript ověří certifikát v dočasné klíčence (stejně jako CI), klíč dotazem na Apple a teprve pak uloží šest tajemství do environmentu `release`. Hodnoty nevypisuje.
5. `.p12` (s heslem) a `.p8` uložit do správce hesel a smazat z disku.

Ověření bez publikace: tag dalšího patche, schválit, zkontrolovat draft (oba DMG, `.app.tar.gz`, installer, `latest.json` se třemi platformami) a na Macu `spctl --assess --type open --context context:primary-signature -v Stavebak.dmg`. Výměna certifikátu nebo klíče: stejný skript znovu.

## Rozhodnutí (2026-10-23, spec 097 v repu serveru)

1. **Klíč updateru je nový.** Veřejný klíč v `src-tauri/tauri.conf.json` je náš. Instalace se starým klíčem (jen vývojové) aktualizaci nepřijmou, nainstalují se znovu. Ztráta soukromého klíče znamená, že stávající instalace už žádnou aktualizaci nepřijmou: záloha do správce hesel je povinná.
2. **macOS: jeden universal build**, podpis Developer ID, notarizace. Minimální verze macOS 13. DMG je i pod stálým jménem `Stavebak.dmg`, na které odkazuje stavebak.cz/download/macos. Od 2026-10-26 (#15) se macOS staví v CI stejným skriptem jako lokálně (`scripts/release-macos.sh`), dřív jen lokálně z klíčenky jednoho Macu. První release celý z CI: v0.14.2 (9,5 min, notarizace a `spctl` v pořádku).
   **Windows:** CI nahraje do draftu instalátor i pod stálým jménem `Stavebak-setup.exe` (pro budoucí `stavebak.cz/download/windows`) a při zapnutém podpisu ověří `Get-AuthenticodeSignature`, jinak job selže. Odkaz na webu (`server/downloads.ts`) se zapne až po prvním podepsaném releasu, do té doby `/download/windows` vede na `/stahnout`.
3. **Platformy: macOS, hned po prvním e2e Windows**, Linux ne. Cílovka pracuje v BricsCADu a AutoCADu, převážně na Windows.
4. **Podpis Windows přes Azure Artifact Signing**, vydavatel Typico Games s.r.o. (pro jednotlivce v EU služba není). Dokud není nastavená proměnná `AZURE_SIGNING_ACCOUNT`, workflow sestaví installer nepodepsaný a SmartScreen varuje. Takový release nepublikovat mimo testery. Reputace SmartScreen se u nového vydavatele buduje s počtem stažení.
5. **Schvalovací brána:** job `release` běží v environmentu `release` (povinný schvalovatel vlastník repa, spustí ho jen tag `v*`). Tajemství podpisu jsou jen tam.
6. **Edice Alpha zrušena** (`editions/`, tagy `-alpha`). Kód `src/lib/edition.ts` zůstává, výchozí edice je stabilní.
7. **Název produktu `Stavebak`** (bez diakritiky kvůli názvům souborů installeru a updateru). Zobrazovaný název s diakritikou (`APP_NAME` v `vite.config.ts`, titulek okna) je samostatná změna.

## Známý dluh

- `cargo clippy` hlásí kolem 30 varování ze zděděného kódu. Kontrola padá jen na chybách. Po úklidu přidat `-D warnings`.
- `cargo fmt --check` hlásí rozdíly, proto zatím není v kontrolách.
- Frontend nemá linter (ESLint), kontrolou je `tsc` se `strict` a `noUnused*`.
