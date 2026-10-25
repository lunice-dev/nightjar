# Security

Nightjar runs on your PC and can be reached from your own phones and computers (remote access, through Tailscale or optionally your home Wi-Fi). If you find a way around that, such as reaching Nightjar without signing in, reading files it shouldn't, or getting an update installed that Nightjar didn't sign, please tell us privately first.

## Reporting a problem

Use **[Report a vulnerability](https://github.com/lunice-dev/nightjar/security/advisories/new)** on GitHub (the Security tab). Only the maintainer sees it. Please include:

- the Nightjar version (About shows it),
- what you did, step by step, and what happened,
- whether it needs remote access turned on, the home Wi-Fi option, or neither.

Please don't open a public issue for it. You'll hear back within a week, and you'll be credited in the release that fixes it unless you'd rather not be.

## What's in scope

- Nightjar itself: the interface in `src/`, the Windows app in `desktop/`, the installer and the updater.
- slskd, the Soulseek engine Nightjar runs, is a separate project: report problems in it to [slskd](https://github.com/slskd/slskd/security). If you're not sure which one it is, report it here.
- Tailscale is not part of Nightjar.

## Supported versions

Only the latest release gets fixes. Nightjar updates itself in one click, so please update before reporting.
