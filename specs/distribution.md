# Distribution

Build, sign, and ship for macOS and Windows.

## 1. Code signing

### macOS
- Apple Developer certificate required for distribution outside App Store
- Set `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` env vars
- Notarize with `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
- Without signing: users get "unidentified developer" warning (Gatekeeper)
- Tauri 2 supports notarization natively via `tauri.conf.json` bundle config

### Windows
- Code signing certificate (EV cert recommended to avoid SmartScreen warnings)
- Without signing: Windows SmartScreen blocks the installer until enough users override

### Decision needed
Do you have Apple Developer / Windows code signing certificates? If not, initial distribution will require users to bypass OS warnings.

## 2. Auto-updater

After security hardening (removing herear.cn/Gitee endpoints):

1. Generate new minisign keypair: `minisign -G`
2. Put public key in `tauri.conf.json` plugins.updater.pubkey
3. Store private key securely (CI secret)
4. Set endpoint to your GitHub releases:
   ```json
   "endpoints": [
     "https://github.com/Juicyscoop88/stavebak-desktop/releases/latest/download/latest.json"
   ]
   ```
5. Set up GitHub Actions to build + sign + upload release artifacts on tag push

## 3. GitHub Actions CI/CD

Create `.github/workflows/release.yml`:

```
on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        platform: [macos-latest, windows-latest]
    steps:
      - Checkout
      - Setup Rust
      - Setup Node + pnpm
      - pnpm install
      - tauri build
      - Sign with minisign
      - Upload to GitHub Release
```

Tauri has an official GitHub Action (`tauri-apps/tauri-action`) that handles most of this.

## 4. Version management

- Update `version` in `src-tauri/tauri.conf.json` (this is the source of truth)
- `package.json` version should match
- Tag releases as `v0.1.0`, `v0.2.0`, etc.
- Start fresh from `v0.1.0` (TOKENICODE was at v0.11.0)

## 5. Build targets

Keep both macOS and Windows. Remove Linux if not needed (reduces CI cost).

In `tauri.conf.json`, `"targets": "all"` builds everything. Can be narrowed to `["dmg", "nsis"]` for just macOS + Windows.
