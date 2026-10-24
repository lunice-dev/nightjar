#!/usr/bin/env bash
# Builds the Nightjar Windows installer: the interface, an unmodified slskd
# release, the Nightjar app (desktop/Nightjar), and NSIS around them.
#   installer/build.sh [path/to/slskd-win-x64.zip]
# Without a zip, the slskd release below is downloaded from GitHub.
set -euo pipefail
cd "$(dirname "$0")/.."
SLSKD_VERSION=0.26.1
SLSKD_SHA256=14928215e6931f291dbc489cbeeccffba6d1aa0d5b94d4262705a596407d50d3
VERSION=$(node -p "require('./package.json').version")
STAGE=installer/stage
ZIP=${1:-installer/cache/slskd-$SLSKD_VERSION-win-x64.zip}
DOTNET=${DOTNET:-dotnet}

if [ ! -f "$ZIP" ]; then
  mkdir -p installer/cache
  curl -fsSL -o "$ZIP" "https://github.com/slskd/slskd/releases/download/$SLSKD_VERSION/slskd-$SLSKD_VERSION-win-x64.zip"
fi
echo "$SLSKD_SHA256  $ZIP" | sha256sum -c -

npm run build
"$DOTNET" build desktop/Nightjar/Nightjar.csproj -c Release -o installer/app-bin -p:Version="$VERSION" -nologo -v q

rm -rf "$STAGE" && mkdir -p "$STAGE/slskd"
unzip -q "$ZIP" -d "$STAGE/slskd"
cp -r dist "$STAGE/slskd/nightjar-web"
cp -r installer/app-bin/. "$STAGE/"
rm -f "$STAGE/Microsoft.Web.WebView2.Wpf.dll"
# WebView2 also looks for its loader next to the exe: put it there, so it is always found.
cp installer/app-bin/runtimes/win-x64/native/WebView2Loader.dll "$STAGE/"
cp desktop/nightjar.ico "$STAGE/"
# The official FLAC decoder (xiph.org), used by Check quality. Unmodified 64-bit build.
FLAC_ZIP=installer/cache/flac-1.4.3-win.zip
[ -f "$FLAC_ZIP" ] || curl -fsSL -o "$FLAC_ZIP" https://github.com/xiph/flac/releases/download/1.4.3/flac-1.4.3-win.zip
echo "c4558cf79fc1365d1822f7945a20bdbf55f99642cee95a823d44f3a61fb748c6  $FLAC_ZIP" | sha256sum -c -
mkdir -p "$STAGE/tools" && unzip -q -j -o "$FLAC_ZIP" 'flac-1.4.3-win/Win64/flac.exe' 'flac-1.4.3-win/Win64/libFLAC.dll' 'flac-1.4.3-win/COPYING.*' -d "$STAGE/tools"
sed 's/\r*$/\r/' LICENSE > "$STAGE/LICENSE.txt"
cat > "$STAGE/NOTICE.txt" <<NOTICE
Nightjar $VERSION
A Soulseek client. Not the official Soulseek client, and not affiliated with
Soulseek or with the slskd project.

Nightjar is free software under the GNU Affero General Public License v3.0
(LICENSE.txt).

This program includes slskd $SLSKD_VERSION, unmodified, from
https://github.com/slskd/slskd/releases/tag/$SLSKD_VERSION
slskd is free software under the GNU Affero General Public License v3.0; its
licence is in slskd\\LICENSE and its source code is at https://github.com/slskd/slskd

It also includes Microsoft's WebView2 SDK (Microsoft.Web.WebView2), under its
own licence (BSD-style), to show its window with Microsoft Edge WebView2;
TagLib# (LGPL 2.1, https://github.com/mono/taglib-sharp) to read tags;
NLayer (MIT, https://github.com/naudio/NLayer) to decode MP3; NAudio (MIT,
https://github.com/naudio/NAudio) to make AAC copies for playing on a phone with
the encoder built into Windows; qrcode-generator (MIT, Kazuhiko Arase) for QR
codes; and the FLAC
1.4.3 tools from xiph.org (flac.exe under the GPL, libFLAC under the Xiph BSD
licence; tools\COPYING.*; source at https://github.com/xiph/flac).

Remote access uses Tailscale (https://tailscale.com), which is not included:
when you ask, Nightjar downloads Tailscale's official installer from
pkgs.tailscale.com and runs it after checking it is signed by Tailscale.
NOTICE
sed -i 's/\r*$/\r/' "$STAGE/NOTICE.txt"

mkdir -p installer/out
(cd installer && makensis -V2 -DVERSION="$VERSION" nightjar.nsi)
# The checksum Nightjar's updater compares the download with (publish it next to the installer).
(cd installer/out && sha256sum "Nightjar-Setup-$VERSION.exe" > "Nightjar-Setup-$VERSION.exe.sha256")
ls -la installer/out
