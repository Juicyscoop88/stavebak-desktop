#!/usr/bin/env bash
# Lokální podepsaný a notarizovaný DMG (universal) pro ověření mimo CI. Nic nenahrává.
#
# Tajemství jsou jen v klíčence, nikdy v repu ani v .env:
#   - identita Developer ID Application (Xcode → Settings → Accounts → Manage Certificates)
#   - profil notarizace: xcrun notarytool store-credentials "$NOTARY_PROFILE" --apple-id … --team-id … --password <heslo pro aplikaci>
#   - klíč updateru jen pro UPDATER=1: ~/.tauri/stavebak-updater.key, heslo v klíčence („Stavebak updater key“)
#
# Použití: ./scripts/release-macos-local.sh
#          SKIP_NOTARIZE=1 ./scripts/release-macos-local.sh   (jen build a podpis)
#          UPDATER=1 ./scripts/release-macos-local.sh         (i podepsaný .app.tar.gz pro updater)
set -euo pipefail
cd "$(dirname "$0")/.."

NOTARY_PROFILE="${NOTARY_PROFILE:-f2p-notary}"
IDENTITY="${APPLE_SIGNING_IDENTITY:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)}"
[ -n "$IDENTITY" ] || { echo "Chybí identita Developer ID Application v klíčence." >&2; exit 1; }

TARGET=universal-apple-darwin
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null

EXTRA=()
if [ -n "${UPDATER:-}" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/stavebak-updater.key")"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -a stavebak-updater -s "Stavebak updater key" -w)"
else
  EXTRA=(--config '{"bundle":{"createUpdaterArtifacts":false}}')
fi

# Tauri podepíše identitou z klíčenky. Notarizaci dělá skript sám přes profil notarytool,
# proto se APPLE_ID ani APPLE_API_* nepředávají.
unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER
export APPLE_SIGNING_IDENTITY="$IDENTITY"

echo "==> Build $TARGET, podpis: $IDENTITY"
pnpm exec tauri build --target "$TARGET" --bundles app,dmg ${EXTRA[@]+"${EXTRA[@]}"}

BUNDLE="src-tauri/target/$TARGET/release/bundle"
APP=$(ls -d "$BUNDLE"/macos/*.app | head -1)
DMG=$(ls "$BUNDLE"/dmg/*.dmg | head -1)

notarize() {
  local out id
  out=$(xcrun notarytool submit "$1" --keychain-profile "$NOTARY_PROFILE" --wait 2>&1) || true
  echo "$out"
  if ! grep -q "status: Accepted" <<<"$out"; then
    id=$(awk '/^  id:/{print $2; exit}' <<<"$out")
    xcrun notarytool log "$id" --keychain-profile "$NOTARY_PROFILE" >&2 || true
    exit 1
  fi
}

echo "==> Ověření podpisu"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dvv "$APP" 2>&1 | grep -E "Authority=Developer ID|TeamIdentifier|flags"

if [ -z "${SKIP_NOTARIZE:-}" ]; then
  echo "==> Notarizace DMG (profil $NOTARY_PROFILE)"
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
  cp "$BUNDLE/macos/$(basename "$APP").tar.gz" "$OUT/Stavebak_universal.app.tar.gz"
  SIG=$(cat "$BUNDLE/macos/$(basename "$APP").tar.gz.sig")
  URL="https://github.com/Juicyscoop88/stavebak-desktop/releases/download/v$VERSION/Stavebak_universal.app.tar.gz"
  node -e '
    const [version, sig, url] = process.argv.slice(1);
    const p = { signature: sig, url };
    console.log(JSON.stringify({ version, notes: process.env.NOTES || "", pub_date: new Date().toISOString(),
      platforms: { "darwin-aarch64": p, "darwin-x86_64": p } }, null, 2));
  ' "$VERSION" "$SIG" "$URL" > "$OUT/latest.json"
  echo "==> Release soubory: $OUT (nahrát do draftu: gh release create v$VERSION --draft $OUT/*)"
fi

echo "==> Hotovo: $DMG"
