#!/usr/bin/env bash
# Podepsaný a notarizovaný DMG (universal) a balíček pro updater. Stejný skript běží v CI (release.yml)
# i lokálně (ověřovací build, nouzový release). Nic nenahrává.
#
# Podpis: identita Developer ID Application z klíčenky (lokálně login, v CI dočasná klíčenka z tajemství).
# Notarizace, jedno z:
#   - App Store Connect API klíč: NOTARY_KEY_PATH (.p8), NOTARY_KEY_ID, NOTARY_ISSUER (CI)
#   - profil notarytool v klíčence: NOTARY_PROFILE (výchozí f2p-notary, lokálně)
# Klíč updateru jen pro UPDATER=1: TAURI_SIGNING_PRIVATE_KEY a TAURI_SIGNING_PRIVATE_KEY_PASSWORD z prostředí (CI),
#   jinak ~/.tauri/stavebak-updater.key a heslo v klíčence („Stavebak updater key“).
#
# Použití: ./scripts/release-macos.sh
#          SKIP_NOTARIZE=1 ./scripts/release-macos.sh   (jen build a podpis)
#          UPDATER=1 ./scripts/release-macos.sh         (release soubory v dist-release/vX.Y.Z, latest.json složí CI)
set -euo pipefail
cd "$(dirname "$0")/.."

# Lokální release (UPDATER=1) se staví jen z čistého origin/main s verzí, která ještě nemá tag.
# V CI tag už existuje a shodu tagu s verzí ověřuje workflow. Ověřovací build bez UPDATER smí stavět cokoli.
if [ -n "${UPDATER:-}" ] && [ -z "${CI:-}" ] && [ -z "${SKIP_RELEASE_CHECKS:-}" ]; then
  fail() { echo "Release: $1 (nouzově přeskočit: SKIP_RELEASE_CHECKS=1)" >&2; exit 1; }
  [ -z "$(git status --porcelain)" ] || fail "pracovní složka není čistá"
  git fetch -q origin main
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "HEAD není origin/main"
  node scripts/check-version.mjs >/dev/null || fail "verze v package.json, tauri.conf.json a Cargo.toml nesedí"
  VERSION=$(node -p "require('./package.json').version")
  [ -z "$(git ls-remote --tags origin "v$VERSION")" ] || fail "tag v$VERSION už existuje, zvyš verzi"
fi

if [ -n "${NOTARY_KEY_PATH:-}" ]; then
  NOTARY_AUTH=(--key "$NOTARY_KEY_PATH" --key-id "${NOTARY_KEY_ID:?}" --issuer "${NOTARY_ISSUER:?}")
else
  NOTARY_AUTH=(--keychain-profile "${NOTARY_PROFILE:-f2p-notary}")
fi
IDENTITY="${APPLE_SIGNING_IDENTITY:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)}"
[ -n "$IDENTITY" ] || { echo "Chybí identita Developer ID Application v klíčence." >&2; exit 1; }

TARGET=universal-apple-darwin
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null

EXTRA=()
if [ -n "${UPDATER:-}" ]; then
  if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
    export TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/stavebak-updater.key")"
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -a stavebak-updater -s "Stavebak updater key" -w)"
  fi
else
  EXTRA=(--config '{"bundle":{"createUpdaterArtifacts":false}}')
fi

# Tauri podepíše identitou z klíčenky. Notarizaci dělá skript sám (notarytool), proto se Tauri
# nepředávají APPLE_ID ani APPLE_API_*, jinak by notarizoval podruhé.
unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH
export APPLE_SIGNING_IDENTITY="$IDENTITY"

echo "==> Build $TARGET, podpis: $IDENTITY"
pnpm exec tauri build --target "$TARGET" --bundles app,dmg ${EXTRA[@]+"${EXTRA[@]}"}

BUNDLE="src-tauri/target/$TARGET/release/bundle"
APP=$(ls -d "$BUNDLE"/macos/*.app | head -1)
DMG=$(ls "$BUNDLE"/dmg/*.dmg | head -1)

notarize() {
  local out id
  out=$(xcrun notarytool submit "$1" "${NOTARY_AUTH[@]}" --wait 2>&1) || true
  echo "$out"
  if ! grep -q "status: Accepted" <<<"$out"; then
    id=$(awk '/^  id:/{print $2; exit}' <<<"$out")
    xcrun notarytool log "$id" "${NOTARY_AUTH[@]}" >&2 || true
    exit 1
  fi
}

echo "==> Ověření podpisu"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dvv "$APP" 2>&1 | grep -E "Authority=Developer ID|TeamIdentifier|flags"

if [ -z "${SKIP_NOTARIZE:-}" ]; then
  echo "==> Notarizace DMG"
  notarize "$DMG"
  xcrun stapler staple "$DMG"
  xcrun stapler validate "$DMG"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"
fi

if [ -n "${UPDATER:-}" ]; then
  # Balíček pro updater obsahuje aplikaci: notarizovat a sešít ji, pak znovu zabalit a podepsat.
  if [ -z "${SKIP_NOTARIZE:-}" ]; then
    echo "==> Notarizace aplikace pro updater"
    ZIP="$BUNDLE/macos/notarize.zip"
    ditto -c -k --keepParent "$APP" "$ZIP"
    notarize "$ZIP"
    rm "$ZIP"
    xcrun stapler staple "$APP"
    (cd "$BUNDLE/macos" && rm -f *.app.tar.gz* && COPYFILE_DISABLE=1 tar -czf "$(basename "$APP").tar.gz" "$(basename "$APP")")
    pnpm exec tauri signer sign "$BUNDLE/macos/$(basename "$APP").tar.gz" >/dev/null
  fi

  VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
  OUT="dist-release/v$VERSION"
  rm -rf "$OUT" && mkdir -p "$OUT"
  cp "$DMG" "$OUT/Stavebak_${VERSION}_universal.dmg"
  # Stálé jméno: web odkazuje na releases/latest/download/Stavebak.dmg (bez GitHub API)
  cp "$DMG" "$OUT/Stavebak.dmg"
  cp "$BUNDLE/macos/$(basename "$APP").tar.gz" "$OUT/Stavebak_universal.app.tar.gz"
  cp "$BUNDLE/macos/$(basename "$APP").tar.gz.sig" "$OUT/Stavebak_universal.app.tar.gz.sig"
  echo "==> Release soubory: $OUT (latest.json: scripts/updater-manifest.mjs, v CI job draft)"
fi

echo "==> Hotovo: $DMG"
