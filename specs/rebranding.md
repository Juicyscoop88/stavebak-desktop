# Rebranding: TOKENICODE -> Stavebak

Rename the app, change identity, localize to Czech, strip Chinese UI.

## 1. App identity

**Files to change:**

| File | Field | From | To |
|------|-------|------|----|
| `src-tauri/tauri.conf.json` | `productName` | `TOKENICODE` | `Stavebak` |
| `src-tauri/tauri.conf.json` | `identifier` | `com.tinyzhuang.tokenicode` | `cz.stavebak.desktop` |
| `src-tauri/tauri.conf.json` | `windows[0].title` | `TOKENICODE` | `Stavebak` |
| `package.json` | `name` | `tokenicode` | `stavebak-desktop` |
| `index.html` | `<title>` | `TOKENICODE` | `Stavebak` |

## 2. App icon

Replace all icons in `src-tauri/icons/` with Stavebak branding:
- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.icns` (macOS)
- `icon.ico` (Windows)
- `public/app-icon.png` (used in README and UI)

Use `cargo tauri icon <source-1024x1024.png>` to generate all sizes from a single source.

## 3. Remove Chinese locale, add Czech

1. Delete `resources/zh-Hans.lproj` directory
2. Remove `zh-Hans.lproj` from `tauri.conf.json` bundle.resources
3. Rename `resources/en.lproj` to `resources/cs.lproj` (or keep en.lproj and add cs.lproj)
4. Add Czech locale strings

## 4. Replace provider presets

**File:** `src/lib/provider-presets.ts`

Remove all Chinese providers:
- `智谱 GLM` (line 33)
- `Kimi` (line 47)
- `Kimi Code` (line 61)
- `MiniMax` (line 73)
- `通义千问` (Qwen, line 90)
- `小米 MiMo` (line 118)
- `小米 MiMo Token Plan` (line 132)

Keep:
- `Anthropic` (rename from `Anthropic (官方)` to just `Anthropic`)
- `OpenRouter`

Optionally add:
- `OpenAI` (for GPT models)

## 5. UI text localization

**File:** `src/lib/i18n.ts` (and any other i18n files)

This is the largest task. Two approaches:

**Option A (recommended for v1):** English-only UI with Czech product name. Most technical users in CZ are fine with English UI. Removes the zh/en bilingual complexity entirely.

**Option B (full Czech):** Translate all UI strings to Czech. This requires going through every component that uses i18n keys.

For either option:
1. Remove all Chinese (`zh`) translations from `i18n.ts`
2. Remove Chinese entries from `src/lib/changelog.ts` (this file is massive with bilingual changelog -- simplify to English only or replace entirely with your own changelog)
3. Grep for any remaining Chinese characters: `grep -rn '[一-鿿]' src/`

## 6. Remove Chinese README

1. Delete `README_zh.md`
2. Rewrite `README.md` for Stavebak (Czech building permit AI assistant)
3. Update `ARCHITECTURE.md`, `CONTEXT.md`, `CHANGELOG.md` as needed

## 7. Internal references

Grep and replace remaining TOKENICODE references:

```bash
grep -rn "TOKENICODE\|tokenicode\|tinyzhuang\|yiliqi" src/ src-tauri/ public/ --include="*.ts" --include="*.tsx" --include="*.rs" --include="*.json" --include="*.html" --include="*.toml"
```

Replace all with Stavebak equivalents. Pay special attention to:
- `~/.tokenicode/` data directory path (in Rust code) -> `~/.stavebak/`
- Any user-facing strings
- Log messages
