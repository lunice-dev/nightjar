#!/usr/bin/env bash
# Publishes the built installer as a GitHub release, which Nightjar's updater finds.
# Usage: installer/release.sh owner/repo   (after installer/build.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=${1:?owner/repo}
VERSION=$(node -p "require('./package.json').version")
EXE="installer/out/Nightjar-Setup-$VERSION.exe"
SUM="$EXE.sha256"
NOTES=$(node -e "
const s=require('fs').readFileSync('src/screens/AboutScreen.tsx','utf8');
const m=s.match(/version: '${VERSION%.0}'[\s\S]*?items: \[([\s\S]*?)\n    \],/);
console.log(m?m[1].split('\n').map(l=>l.trim().replace(/^'|',?$/g,'').replace(/\\\\\\\\/g,'\\\\')).filter(Boolean).map(l=>'- '+l).join('\n'):'');
")
gh release create "v$VERSION" "$EXE" "$SUM" --repo "$REPO" --title "Nightjar $VERSION" --notes "$NOTES"
