#!/usr/bin/env bash
# Publishes the built installer as a GitHub release, which Nightjar's updater finds.
# Usage: installer/release.sh owner/repo   (after installer/build.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=${1:?owner/repo}
VERSION=$(node -p "require('./package.json').version")
EXE="installer/out/Nightjar-Setup-$VERSION.exe"
SUM="$EXE.sha256"
SIG="$EXE.sig"

# Sign the installer with Nightjar's release key (GitHub secret NIGHTJAR_SIGNING_KEY). Nightjar 0.8 and later
# refuse updates without a valid signature, so an unsigned release is never published.
if [ -z "${NIGHTJAR_SIGNING_KEY:-}" ]; then
  echo "NIGHTJAR_SIGNING_KEY is not set: add the release signing key as a repository secret." >&2
  exit 1
fi
KEY=$(mktemp)
trap 'rm -f "$KEY"' EXIT
printf '%s\n' "$NIGHTJAR_SIGNING_KEY" > "$KEY"
openssl dgst -sha256 -sign "$KEY" -out "$SIG" "$EXE"
rm -f "$KEY"
# The signature must check out against the public key built into Nightjar (catches a wrong secret).
openssl dgst -sha256 -verify installer/nightjar-update-key.pub.pem -signature "$SIG" "$EXE"
NOTES=$(node -e "
const s=require('fs').readFileSync('src/screens/AboutScreen.tsx','utf8');
const m=s.match(/version: '${VERSION%.0}'[\s\S]*?items: \[([\s\S]*?)\n    \],/);
console.log(m?m[1].split('\n').map(l=>l.trim().replace(/^'|',?$/g,'').replace(/\\\\\\\\/g,'\\\\')).filter(Boolean).map(l=>'- '+l).join('\n'):'');
")
gh release create "v$VERSION" "$EXE" "$SUM" "$SIG" --repo "$REPO" --title "Nightjar $VERSION" --notes "$NOTES"
