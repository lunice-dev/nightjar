# Nightjar

A modern Soulseek client for Windows. Nightjar finds music on Soulseek, a network of people sharing their own record collections, and downloads the best copy it can find.

Nightjar is a new interface on top of [slskd](https://github.com/slskd/slskd), an open source Soulseek engine, used without changes. It is not the official Soulseek client and isn't affiliated with Soulseek or with slskd.

**[Download the latest version](https://github.com/lunice-dev/nightjar/releases/latest)** — `Nightjar-Setup-x.y.z.exe`, for Windows 10 and 11. No admin rights, no Soulseek account needed beforehand: Nightjar walks you through the first start, and updates itself afterwards.

## What it does

- **Albums, not loose files.** Results are grouped by folder and shown as albums. Everyone's copies of the same album are stacked into one row and ranked: quality first, then a free slot, then speed.
- **Quality you can see.** Hi-res, lossless, 320, VBR and low bitrate each have their own colour and filter.
- **Several people at once.** When others have exactly the same files, Nightjar downloads from them together, and moves slow tracks to someone faster.
- **Wishlist.** Keeps looking for albums nobody shares yet and tells you when they turn up.
- **Check quality.** Tells a real lossless file from an MP3 in disguise, real hi-res from upsampled, real 24-bit from padded 16-bit, and finds damaged files (FLAC, WAV, MP3).
- **Your library, in order.** Puts downloads into `Format\Artist\Year - Album`, reviews a whole existing library before moving anything, and every move can be undone. Search shows what you already have.
- **A real Windows app.** Its own window, an icon next to the clock, sharing and downloading in the background.

## Building

Requirements: Node 20+, the .NET SDK (8 is fine; it builds a .NET Framework 4.8 app), and NSIS (`makensis`) for the installer.

```sh
npm install
npm run dev              # the interface against an slskd at http://127.0.0.1:5030
npm run build:demo       # a single-file demo with sample data (dist-demo/index.html)
bash installer/build.sh  # web build + Windows app + slskd + installer in installer/out
```

- `src/` — the interface (React, TypeScript, Vite).
- `desktop/Nightjar/` — the Windows app (WinForms + WebView2): starts and watches slskd, the window, the tray icon, the library organiser, the quality checker and the updater.
- `installer/` — the NSIS installer and the release script.

## Licence

GNU AGPL 3.0, like slskd. Nightjar bundles slskd ([source](https://github.com/slskd/slskd)) and the FLAC command-line tools from [xiph.org](https://github.com/xiph/flac); see `NOTICE.txt` in the installed folder.
