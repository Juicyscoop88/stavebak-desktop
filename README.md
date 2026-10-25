<div align="center">

<img src="public/app-icon.png" alt="Stavebák" width="120" />

# Stavebák Desktop

### Aplikace pro projektanty nad Claude Code a Stavebákem

[![Verze](https://img.shields.io/github/v/release/Juicyscoop88/stavebak-desktop?style=flat-square&color=blue)](https://github.com/Juicyscoop88/stavebak-desktop/releases)
[![Licence](https://img.shields.io/badge/licence-Apache%202.0-green?style=flat-square)](LICENSE)

</div>

Stavebák Desktop je desktopová aplikace pro autorizované projektanty. Spouští Claude Code nainstalovaný u uživatele a připojuje ho k MCP serveru [Stavebák](https://stavebak.cz), který vede projektovou dokumentaci staveb podle zákona 283/2021 Sb. a vyhlášky 131/2024 Sb. (zařazení stavby, podklady, kontroly, textové části, výkresy).

Aplikace sama žádnou AI neprovozuje. Rozhovor vede Claude Code uživatele, odborné nástroje dodává server Stavebák.

## Přihlášení

Jsou to dvě nezávislá přihlášení:

1. **Claude Code.** Přihlašuje se přímo Claude Code (`claude login`) vlastním účtem Claude, nebo používá vlastní API klíč uživatele. Aplikace jen spustí neupravený Claude Code a jeho přihlášení. Přihlašovací údaje Claude nikdy nečte, neukládá ani nikam neposílá a za využití Clauda neúčtuje. Pro kanceláře a firmy jsou určené tarify Claude Team a Enterprise.
2. **Stavebák.** Účet ke službě Stavebák (přihlášení přes Google). Týká se jen nástrojů serveru Stavebák, ne Clauda.

## Instalace

- **macOS:** stáhněte `Stavebak.dmg` z [Releases](https://github.com/Juicyscoop88/stavebak-desktop/releases) a přetáhněte aplikaci do složky Aplikace.
- **Windows:** stáhněte instalátor z [Releases](https://github.com/Juicyscoop88/stavebak-desktop/releases).

Pokud Claude Code chybí, průvodce při prvním spuštění ho nainstaluje z oficiálního zdroje Anthropicu a spustí jeho přihlášení.

## Co aplikace umí

- Rozhovor s Claude Code ve složce projektu, se schvalováním úprav souborů.
- Přehled projektu z dat serveru Stavebák (kroky, podklady, kontroly).
- Procházení a náhled souborů projektu, převod a náhled výkresů přes nástroje Stavebáku.
- Správa konverzací: připnutí, archiv, skupiny, automatický název.

## Vývoj

```bash
pnpm install
pnpm tauri dev          # debug build mluví s lokálním serverem http://localhost:3535/mcp
pnpm exec vitest run
cd src-tauri && cargo test
```

Release build míří na `https://stavebak.cz/mcp`, proměnná `STAVEBAK_MCP_URL` přepíše obojí. Postup vydání je v [docs/ops/release.md](docs/ops/release.md).

## Licence

[Apache License 2.0](LICENSE), viz také [NOTICE](NOTICE).

Claude a Claude Code jsou ochranné známky společnosti Anthropic. Stavebák s Anthropicem není spojen ani jím není podporován.
