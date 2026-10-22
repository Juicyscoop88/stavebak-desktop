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
2. Tag na `main`: `git tag vX.Y.Z origin/main && git push origin vX.Y.Z`. Tag s `-alpha` sestaví edici Alpha (`editions/alpha`) jako prerelease.
3. Počkat na workflow, stáhnout artefakty z draftu a vyzkoušet instalaci.
4. Publikovat draft. Teprve tím se release stane `latest` a updater v aplikacích ho uvidí (`releases/latest/download/latest.json`).

Release se dělá jen na výslovný pokyn.

## Rollback

Updater instaluje jen vyšší verzi, než je nainstalovaná. Z toho plyne:

- **Zastavit šíření:** chybný release vrátit do draftu nebo smazat. `latest` pak ukazuje na předchozí publikovaný release a další aplikace se na chybnou verzi neaktualizují.
- **Vrátit uživatele, kteří už aktualizovali:** nový patch release (vyšší číslo verze) s opraveným nebo vráceným kódem. Návrat na nižší verzi updater neumí.
- Tag chybného releasu nemazat a nepřesouvat, číslo verze se znovu nepoužívá.

## Tajemství

Žádný klíč, certifikát ani heslo nesmí být v repu ani ve výpisu workflow. Patří do GitHub Secrets, záloha soukromých klíčů do správce hesel.

| Secret | K čemu | Stav |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | podpis aktualizací pro updater | chybí, viz rozhodnutí 1 |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` | podpis macOS (Developer ID Application) | chybí, viz rozhodnutí 2 |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | notarizace macOS (heslo pro aplikaci, ne heslo k účtu) | chybí, viz rozhodnutí 2 |

`GITHUB_TOKEN` dává GitHub sám, workflow má jen `contents: write` pro založení releasu.

## Otevřená rozhodnutí (stav 2026-10-22)

Release v současném stavu neprojde: konfigurace má `createUpdaterArtifacts: true` a veřejný klíč updateru, ale v repu není secret se soukromým klíčem, takže podpis aktualizací selže.

1. **Klíč updateru.** Veřejný klíč v `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) pochází z původního projektu, soukromý klíč k němu nemáme. Návrh: vygenerovat nový pár (`pnpm tauri signer generate`), veřejný klíč do konfigurace, soukromý do secrets a správce hesel. Bez toho updater nefunguje. Ztráta soukromého klíče znamená, že stávající instalace už žádnou aktualizaci nepřijmou.
2. **Podpis a notarizace macOS.** Vyžaduje Apple Developer Program a certifikát Developer ID Application. Bez nich macOS stažené aplikaci nedůvěřuje a uživatel ji musí povolit ručně. Pro pilot s projektanty to je bariéra.
3. **Platformy.** Workflow staví macOS (arm64 a x64), Linux a Windows. Produkt je nejdřív pro macOS. Návrh: dočasně jen macOS, nebo Windows ponechat bez podpisu (SmartScreen varování). Linux nikdo nepoužívá.
4. **Schvalovací brána.** Návrh: GitHub environment `release` s povinným schvalovatelem, secrets podpisu jen v něm (ne na úrovni repa). Release job pak čeká na ruční schválení a k secrets se nedostane jiný workflow.
5. **Edice Alpha.** Updater Alpha čte `latest-alpha.json` z větve `dev` (`editions/alpha/tauri.alpha.conf.json`), který workflow nevytváří. Buď zrušit, nebo dodělat.

## Známý dluh

- `cargo clippy` hlásí kolem 30 varování ze zděděného kódu. Kontrola padá jen na chybách. Po úklidu přidat `-D warnings`.
- `cargo fmt --check` hlásí rozdíly, proto zatím není v kontrolách.
- Frontend nemá linter (ESLint), kontrolou je `tsc` se `strict` a `noUnused*`.
