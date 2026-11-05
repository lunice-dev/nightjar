import { useRef } from 'react';
import { ReportProblem } from '../components/ReportProblem';
import { UpdateSection } from '../components/Updates';
import { Mark } from '../components/Mark';
import { ClassicPlayerSwitch } from '../components/ClassicPlayerSwitch';
import { usePrefs } from '../prefs';
import { useStore } from '../store';
import { shownChanges } from '../lib/changes';
import { viewportInfo, wantsFullScreen } from '../lib/viewport';

/** One line about how the page sits on the screen, for reports of layout problems on a phone or tablet. */
const screenNote = () => {
  const v = viewportInfo();
  // What the page can measure about its own window, for working out why the page doesn't fill it.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:100lvh';
  document.body.appendChild(probe);
  const lvh = probe.offsetHeight;
  probe.style.height = '100dvh';
  const dvh = probe.offsetHeight;
  probe.style.height = '100%';
  const fixedPct = probe.offsetHeight;
  probe.remove();
  const vv = window.visualViewport;
  const root = document.documentElement;
  return [
    `Page ${v.innerWidth}×${v.innerHeight} · screen ${screen.width}×${screen.height} · outer ${window.outerWidth}×${window.outerHeight}`,
    `visual ${vv ? `${Math.round(vv.width)}×${Math.round(vv.height)} at ${Math.round(vv.offsetLeft)},${Math.round(vv.offsetTop)}` : 'n/a'} · lvh ${lvh} · dvh ${dvh} · fixed 100% ${fixedPct} · html ${root.clientWidth}×${root.clientHeight}`,
    `top ${v.top}, bottom ${v.bottom}${v.standalone ? ' · installed app' : ''}${wantsFullScreen(v) ? ' · full screen' : ''} · ${[...root.classList].join(' ') || 'no classes'}`,
  ].join('\n');
};

declare const __APP_VERSION__: string;
/** This page's version (package.json at build time), e.g. "0.8.0". */
export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
declare const __BUILD__: string;
/** When this copy of the page was built, e.g. "5 Nov, 01:52": tells which copy a phone is running. */
const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : '';

/**
 * What changed in each version, newest first. Shown in About and published as the release notes.
 * Written for anyone using Nightjar: one change per line, what it means for them, in plain words.
 * No usernames, album or folder examples, test stories, internal workings or file formats beyond what a user sees.
 * The same names as the app: Library, Downloads, Uploads, Tidy library, Put in library, Check quality, Use less data.
 */
const CHANGES: { version: string; date: string; title: string; items: string[] }[] = [
  {
    version: '0.11.0',
    date: '9 Nov 2026',
    title: 'Bit-perfect',
    items: [
      'Bit-perfect playback on a computer: FLAC and WAV files reach your sound device exactly as they are, at their own sample rate',
      'Turn bit-perfect on and pick the sound device right from the player',
      'A new Sound panel in the large player shows how each track reaches your device, and why when Windows has to convert it',
      'While bit-perfect plays, the volume is set on the device itself. After half a minute paused, other programs can use it again',
      'A device that can’t take a file as it is still plays it, converted by Windows',
      'A Statistics page: lifetime totals, a chart over time, people, file types, busiest hours and records. On a phone it is in More',
      'Asking for an album that is already downloading no longer starts a second copy, even from someone else’s copy or another device',
      'An album no longer shows as waiting in the short gap between two tracks',
      'More of an album goes into its folder, and tracks already there are left out',
      'An album split across folders can be gathered into one',
      'Albums with disc folders (CD 1, CD 2) go into your Library as one album, discs and all',
      'Downloads shows albums waiting for your Library by name, artist and where each will go. Put them in one at a time or all at once',
      'Fixed a two-disc album being called “in several folders” and its discs being mixed into one',
      'Albums you are downloading are kept by nightjar on the computer, so every device sees the same ones',
      'One slim scrollbar wherever there is a mouse',
      'The large player’s tracklist lines up with the cover and the controls',
      'Fixed the lyrics layout in the large player',
      'Fixed pop-up messages being hard to read in the Glass theme',
      'The Library and Home show an album as soon as it is put in the Library',
      'Messages shows the last message of each conversation',
      'Uploads that the other person stopped go to Finished instead of Needs attention',
      'Fixed some upload problems showing Windows’ own error text',
      'Search names an album kept in a folder like “24bit” or “FLAC” after its real folder',
      'nightjar checks for changes less often when nothing is moving or the window is hidden',
      'People shows how many can’t download from you, and the first few until you ask for all',
      'Signed-in devices show when each one was added, so phones with the same name can be told apart',
      'A search with more than a thousand answers says so',
      'Fixed Escape closing the whole large player when only its “…” menu was open',
      'Protection blocks a wave of new accounts with made-up names that each take a few files, and lists the wave as one entry you can allow again',
    ],
  },
  {
    version: '0.10.0',
    date: '2 Nov 2026',
    title: 'A new look',
    items: [
      'A new logo: a nightjar crossing a full moon, with new colours and a new typeface',
      'The name is written nightjar, in lowercase, everywhere',
      'nightjar opens with the bird flying in, dropping the letters of its name and landing on the moon (the finished logo, if Reduce Motion is on)',
      'The opening screen follows your theme, on the computer and on phones',
      'New icons for the app, the Home Screen, the browser tab and the installer',
      'One Now panel on a computer: what is playing and the whole tracklist, docked at the right of every screen. The player bar along the bottom is on every screen too',
      'The large player on a computer is calmer: one small type size, and Repeat, Shuffle, Use less data and the sleep timer behind a “…”',
      'A new Home on a computer: search, your library at a glance, rows of covers and the day’s activity. A cover plays the album in the Now panel',
      'A new Library, a wall of covers or a list, and the album you pick opens in the Now panel',
      'A “…” beside each cover’s name, or a right-click, to play an album next, queue it or add it to a playlist',
      'On a computer the window can be resized and made full screen, and remembers its size and place',
      'Settings are split into sections',
      'Protection: nightjar notices people downloading from you faster than a person could, and can block them. You can also limit how much one person may queue',
      'Downloads that fail in a way that usually passes are tried again by themselves, a little later each time',
      'A track already in an album’s folder is never fetched twice, and tracks that arrived twice are pointed out',
      'Messages and Rooms look the same in every theme',
      'On a phone, Home shows what is playing in a compact card',
      'On an iPad, rows of covers on Home swipe sideways',
      'Fixed the player on an iPad’s Home sliding over the activity below it',
    ],
  },
  {
    version: '0.9.0',
    date: '2 Nov 2026',
    title: 'A new player, lyrics and a lighter network',
    items: [
      'A new large player: a two-sided Console on iPads and computers, and Hush on phones',
      'On phones, tap the cover to play or pause and swipe it to skip',
      'A small mark beside the artist shows when a lossless or Hi-Res file is playing',
      'Lyrics for the song playing, found online when you open them',
      'The small player takes its colour from the cover',
      'Share what you’re playing as a picture, to post as a story',
      'Two new themes: Glass, and OLED with true black',
      'Quality labels look the same everywhere, and Variable and Compact are easy to tell apart',
      'The queue, and your place in it, are remembered after a restart',
      'Pull the queue up, drag tracks to reorder them, swipe a track to remove it',
      'A sleep timer and a volume slider in the large player',
      'On an iPad held upright, the tabs sit at the bottom and the small player floats above them',
      'Covers no longer have a play button; Play is in the cover’s menu',
      'Home shows playlists as a compact list, and albums with their quality on the cover',
      'Swiping and tapping feel more natural on touch screens',
      'Dialogs, menus and messages ease in and out',
      'About has a switch to go back to the earlier large-player layout',
      'Swipe down to close the “…” menu in the large player',
      'Fixed the iPad leaving a bar at the bottom of the screen',
      'Fixed the top of the app being faded by the status bar on iPhone and iPad',
      'Fixed buttons staying highlighted after a tap, and the page zooming into text fields',
      'Fixed counts such as “1 track” and long titles in the queue',
      'Fixed lyrics not loading on older iPhones and iPads',
      'Your wishlist and saved people are checked from one device only, not every open one',
      'Saved people’s online status is checked every few minutes instead of every few seconds',
      'Opening an album’s tracks again doesn’t ask its owner a second time',
      'When someone sharing an album can’t be reached, their tracks go to the others sharing it',
      'Tracks left waiting on someone unreachable move to another copy by themselves',
      'Settings can check every hour whether others can reach your computer, and note it in nightjar’s log',
      'Fixed settings changed on your computer sometimes not reaching your phone',
      'When an album can’t be moved because a track is playing or open elsewhere, nightjar says which file',
      'Uploads explain in plain words why a file didn’t go through, and whose side it was',
      'Clearer waiting lines and buttons in Uploads',
      'Fixed a file someone asks for again, after it didn’t go through, sometimes never starting',
    ],
  },
  {
    version: '0.8.5',
    date: '26 Oct 2026',
    title: 'Faster searches on phones',
    items: [
      'Search results show much sooner, especially on a phone',
      'Searches for popular names end once the answers slow down, instead of running for a minute',
      'nightjar on your phone uses far less mobile data',
    ],
  },
  {
    version: '0.8.4',
    date: '26 Oct 2026',
    title: 'Seeking, tracklists and download fixes',
    items: [
      'Hold the previous or next button to rewind or fast-forward',
      'Double-tap the album cover to go back or forward 10 seconds',
      'Drag along the time bar more finely by moving your finger away from it',
      'Long tracks get buttons to go back 15 or forward 30 seconds',
      'On a computer, the arrow keys move 5 seconds, or 30 with Shift',
      'Tap an album’s track count in Search to see its tracks before downloading',
      'Searches show their results as soon as answers stop coming in',
      'A new search no longer waits behind the previous one or shows “no results” early',
      'Albums downloading from several people show each person’s speed, and the total is steadier',
      'Albums started on your phone no longer show up several times in Downloads',
      'An album interrupted by a restart stays one entry in Downloads',
      'Quality checks made on your phone show on your computer too',
      'An album deleted from Downloads can be downloaded again straight away',
      'Downloads follow albums you put in your library, so they keep playing',
      'Clearer reason when someone’s copy changed since your search',
      'Check quality says “Probably hi-res” when the sound can’t confirm hi-res',
      'A “What do the labels mean?” button in Search, Downloads and Library explains the quality labels',
      'Fixed download speeds sometimes shown with long, odd numbers',
    ],
  },
  {
    version: '0.8.3',
    date: '25 Oct 2026',
    title: 'Use less data fixes',
    items: ['“Use less data” no longer skips tracks from hi-res (24-bit) albums', 'Fixed tracks skipping on some albums tagged by older software'],
  },
  {
    version: '0.8.2',
    date: '25 Oct 2026',
    title: 'Fake albums caught sooner',
    items: [
      'Fake albums are paused within seconds of starting to download',
      'A paused album waits in Needs attention until you choose to delete it or keep downloading',
      'Large searches no longer slow down phones',
      'Uploads explain when an album is waiting for the same person’s previous album to finish',
      'After an update, nightjar reloads only once it’s ready, instead of showing a blank page',
      'Fixed remote access setup failing on some computers',
      'Fixed occasional errors when loading profile pictures',
    ],
  },
  {
    version: '0.8.1',
    date: '25 Oct 2026',
    title: 'Updates from your phone',
    items: [
      'Updates started from your phone or another computer now finish on their own',
      'A page left open while nightjar was updated offers to reload',
      'About shows the correct version number',
      'The bottom bar credits slskd, the engine nightjar runs on',
    ],
  },
  {
    version: '0.8',
    date: '25 Oct 2026',
    title: 'nightjar on your phone',
    items: [
      'Remote access: use nightjar from your phone or another computer, anywhere, through Tailscale. Settings → Remote access walks you through it',
      'Everything works from your phone: search, downloads, your library, Tidy library and Check quality',
      'Sign a phone in with a QR code or a remote password, and remove signed-in devices in Settings',
      'Add nightjar to your iPhone’s Home Screen to open it like an app',
      'Play your music, with lock-screen controls; “Use less data” plays smaller copies on mobile data',
      'A full-screen player with shuffle, repeat and a queue',
      'Tap an album cover to see its tracks and play, shuffle or queue them',
      'Playlists, shared by all your devices and backed up automatically',
      'Swipe between tabs on phones and trackpads',
      'Fake albums: a folder holding a different album is flagged before you download it, and paused if found while downloading. Whoever shared it is ranked last in searches',
      'Updates are signed, and nightjar installs only genuine ones',
      'Phones on your home Wi-Fi can connect without Tailscale',
      'Uploads and Activity are grouped by day; block someone straight from Uploads',
      'Click any name to see their profile',
      'Report a problem from Settings or About, also from your phone',
    ],
  },
  {
    version: '0.7',
    date: '22 Oct 2026',
    title: 'Your library, checked and tidied',
    items: [
      'Library: every album you have, with Check quality for any of them',
      'Tidy library: organises your whole library into Format\\Artist\\Year - Album. You review every change first, and can undo it',
      'Albums on several discs, box sets and compilations stay together',
      'Folders you made to group artists are kept, and new downloads go into them',
      'Search shows albums you already have, and when a copy is better than yours',
      'nightjar updates itself in one click, keeping your settings',
      'Report a problem from About (reports never include passwords)',
      'Check quality reads WAV files and albums on several discs',
    ],
  },
  {
    version: '0.6',
    date: '21 Oct 2026',
    title: 'SSK-Lite is now nightjar',
    items: [
      'A new name and logo',
      'A proper Windows app, with its own window and an icon next to the clock',
      'The first start guides you through your Soulseek account and folders',
      'If something goes wrong at start, nightjar says what and offers a fix',
      'The bottom bar shows whether you’re connected to Soulseek',
      'Home shows your library, recent downloads, uploads and connection',
      'Faster downloads from several people: slow sources are replaced automatically',
      'Put in library: move a finished album into your library in one click, and undo it',
      'Check quality: spots fake lossless, fake hi-res and damaged files',
      'Uploads shows how much you share and how fast',
      'A new install shares nothing until you choose what to share',
    ],
  },
  {
    version: '0.1–0.5',
    date: '20–21 Oct 2026',
    title: 'Early versions',
    items: [
      'Search results grouped into albums, with quality you can see at a glance',
      'Download an album from up to three people at once, ranked by their real speed',
      'Failed or stuck tracks move to another copy by themselves',
      'Private messages, chat rooms, profiles and browsing other people’s files',
      'A wishlist that keeps searching for you',
      'Album art, and light and dark themes',
      'nightjar opens its port on your router so others can reach you',
    ],
  },
];


/**
 * Hidden, for trying the fake-album check on a real download: five quick taps on the title arm it (or disarm it).
 * The next album downloaded is then treated as the wrong album: paused, with the banner in Downloads.
 */
function useFakeAlbumTest() {
  const taps = useRef<number[]>([]);
  return () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now];
    if (taps.current.length < 5) return;
    taps.current = [];
    const on = !usePrefs.getState().testWrongAlbum;
    usePrefs.getState().setTestWrongAlbum(on);
    useStore.getState().toast(on ? 'Fake-album test on: the next album you download will be treated as the wrong album.' : 'Fake-album test off.');
  };
}

export function AboutScreen() {
  const tap = useFakeAlbumTest();
  return (
    <div className="page">
      <div className="page-inner narrow">
        <header className="about-head">
          <Mark size={44} />
          <div>
            <h1 className="page-title about-title" onClick={tap}>
              <span className="about-name">nightjar</span> <span className="about-version">{VERSION}</span>
              {BUILD && <span className="about-build" title="When this copy of the page was built"> · page of {BUILD}</span>}
            </h1>
            <p className="page-sub">A modern client for the Soulseek network.</p>
          </div>
        </header>

        <p className="hint-text">
          nightjar is a new interface on top of <a href="https://github.com/slskd/slskd" target="_blank" rel="noreferrer">slskd</a>, an
          open source Soulseek engine, used without changes. It is not the official Soulseek client and isn’t affiliated with Soulseek or
          with slskd. Both are free software under the GNU AGPL 3.0.
        </p>

        <UpdateSection />
        <ReportProblem />

        <section className="changelog" aria-labelledby="changes-h">
          <h2 id="changes-h">What’s new</h2>
          <ol>
            {shownChanges(VERSION, CHANGES).map((c) => (
              <li key={c.version}>
                <div className="cl-head">
                  <span className="cl-version">{c.version}</span>
                  <h3>{c.title}</h3>
                  <time>{c.date}</time>
                </div>
                <ul>
                  {c.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
        <ClassicPlayerSwitch />
        <p className="about-sig dim" style={{ whiteSpace: 'pre-line' }}>{screenNote()}</p>
        <p className="about-sig">coded by lunice</p>
      </div>
    </div>
  );
}
