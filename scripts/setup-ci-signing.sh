#!/usr/bin/env bash
# Jednorázově uloží tajemství pro macOS release v CI do GitHub environmentu release. Spouští se na Macu.
# Než cokoli uloží, ověří certifikát stejně jako CI (dočasná klíčenka) a notarizační klíč dotazem na Apple.
# Hodnoty tajemství nevypisuje a nic nenechá na disku.
#
# Předem (podrobně v docs/ops/release.md, část Tajemství):
#   1. Klíčenka → Moje certifikáty → „Developer ID Application: …“ (se soukromým klíčem) → Exportovat → .p12 s heslem
#   2. App Store Connect → Uživatelé a přístup → Integrace → Klíče App Store Connect → nový klíč (role Developer),
#      stáhnout AuthKey_<KEY_ID>.p8 (jde jen jednou), opsat Issuer ID
#   3. gh auth login účtem s právy admin k repozitáři
#
# Použití: ./scripts/setup-ci-signing.sh <identita.p12> <AuthKey_KEYID.p8> <Issuer ID>
set -euo pipefail

REPO=Juicyscoop88/stavebak-desktop
ENV=release
fail() { echo "Chyba: $1" >&2; exit 1; }

[ $# -eq 3 ] || fail "použití: $0 <identita.p12> <AuthKey_KEYID.p8> <Issuer ID>"
P12=$1 P8=$2 ISSUER=$3
[ -f "$P12" ] || fail "soubor $P12 neexistuje"
[ -f "$P8" ] || fail "soubor $P8 neexistuje"
KEY_ID=$(basename "$P8" | sed -n 's/^AuthKey_\([A-Z0-9]*\)\.p8$/\1/p')
[ -n "$KEY_ID" ] || fail "název .p8 má tvar AuthKey_<KEY_ID>.p8, jak ho stáhne App Store Connect"

gh auth status >/dev/null 2>&1 || fail "gh není přihlášený (gh auth login)"
gh api "repos/$REPO/environments/$ENV" >/dev/null 2>&1 || fail "environment $ENV v $REPO neexistuje nebo k němu nemáš práva"

read -rsp "Heslo k $P12: " P12_PASS; echo

echo "==> Certifikát: import do dočasné klíčenky (stejně jako CI)"
TMP=$(mktemp -d)
KC="$TMP/check.keychain-db"
KC_PASS=$(openssl rand -hex 16)
trap 'security delete-keychain "$KC" 2>/dev/null || true; rm -rf "$TMP"' EXIT
security create-keychain -p "$KC_PASS" "$KC"
security unlock-keychain -p "$KC_PASS" "$KC"
security import "$P12" -k "$KC" -P "$P12_PASS" -T /usr/bin/codesign >/dev/null || fail "import .p12 selhal (heslo?)"
IDENTITIES=$(security find-identity -v -p codesigning "$KC" | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p')
[ -n "$IDENTITIES" ] || fail ".p12 neobsahuje platnou identitu Developer ID Application se soukromým klíčem"
[ "$(grep -c . <<<"$IDENTITIES")" -eq 1 ] || fail ".p12 obsahuje víc identit, exportuj jen jednu: $IDENTITIES"
IDENTITY=$IDENTITIES
echo "    $IDENTITY"

echo "==> Notarizační klíč: dotaz na Apple (Key ID $KEY_ID)"
xcrun notarytool history --key "$P8" --key-id "$KEY_ID" --issuer "$ISSUER" >/dev/null || fail "Apple klíč odmítl (Key ID, Issuer ID, role klíče?)"
echo "    OK"

echo "==> Ukládám tajemství do $REPO, environment $ENV"
set_secret() { gh secret set "$1" --repo "$REPO" --env "$ENV" >/dev/null && echo "    $1"; }
base64 -i "$P12" | set_secret APPLE_CERTIFICATE
printf '%s' "$P12_PASS" | set_secret APPLE_CERTIFICATE_PASSWORD
printf '%s' "$IDENTITY" | set_secret APPLE_SIGNING_IDENTITY
set_secret APPLE_NOTARY_KEY < "$P8"
printf '%s' "$KEY_ID" | set_secret APPLE_NOTARY_KEY_ID
printf '%s' "$ISSUER" | set_secret APPLE_NOTARY_ISSUER

cat <<EOF
==> Hotovo. Další kroky:
    - $P12 a $P8 ulož do správce hesel (spolu s heslem k .p12) a smaž z disku.
    - Ověř release bez publikace: docs/ops/release.md, část Release.
EOF
