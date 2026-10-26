import { useRef } from 'react';
import { ReportProblem } from '../components/ReportProblem';
import { UpdateSection } from '../components/Updates';
import { Mark } from '../components/Mark';
import { usePrefs } from '../prefs';
import { useStore } from '../store';
import { shownChanges } from '../lib/changes';

declare const __APP_VERSION__: string;
/** This page's version (package.json at build time), e.g. "0.8.0". */
export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

/**
 * What changed in each version, newest first. Shown in About and published as the release notes.
 * Written for anyone using Nightjar: one change per line, what it means for them, in plain words.
 * No usernames, album or folder examples, test stories, internal workings or file formats beyond what a user sees.
 * The same names as the app: Library, Downloads, Uploads, Tidy library, Put in library, Check quality, Use less data.
 */
const CHANGES: { version: string; date: string; title: string; items: string[] }[] = [
  {
    version: '0.8.6',
    date: '2 Nov 2026',
    title: 'Lighter on the network',
    items: [
      'Your wishlist and saved people are checked from one device only, not every open one',
      'Saved people’s online status is checked every few minutes instead of every few seconds',
      'Opening an album’s tracks again doesn’t ask its owner a second time',
      'When someone sharing an album can’t be reached, their tracks go to the others sharing it',
      'Tracks left waiting on someone unreachable move to another copy by themselves',
      'Settings can check every hour whether others can reach your computer, and note it in Nightjar’s log',
      'Fixed settings changed on your computer sometimes not reaching your phone',
      'When an album can’t be moved because a track is playing or open elsewhere, Nightjar says which file',
      'Uploads explain in plain words why a file didn’t go through, and whose side it was',
      'Clearer waiting lines and buttons in Uploads',
    ],
  },
  {
    version: '0.8.5',
    date: '26 Oct 2026',
    title: 'Faster searches on phones',
    items: [
      'Search results show much sooner, especially on a phone',
      'Searches for popular names end once the answers slow down, instead of running for a minute',
      'Nightjar on your phone uses far less mobile data',
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
      'After an update, Nightjar reloads only once it’s ready, instead of showing a blank page',
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
      'A page left open while Nightjar was updated offers to reload',
      'About shows the correct version number',
      'The bottom bar credits slskd, the engine Nightjar runs on',
    ],
  },
  {
    version: '0.8',
    date: '25 Oct 2026',
    title: 'Nightjar on your phone',
    items: [
      'Remote access: use Nightjar from your phone or another computer, anywhere, through Tailscale. Settings → Remote access walks you through it',
      'Everything works from your phone: search, downloads, your library, Tidy library and Check quality',
      'Sign a phone in with a QR code or a remote password, and remove signed-in devices in Settings',
      'Add Nightjar to your iPhone’s Home Screen to open it like an app',
      'Play your music, with lock-screen controls; “Use less data” plays smaller copies on mobile data',
      'A full-screen player with shuffle, repeat and a queue',
      'Tap an album cover to see its tracks and play, shuffle or queue them',
      'Playlists, shared by all your devices and backed up automatically',
      'Swipe between tabs on phones and trackpads',
      'Fake albums: a folder holding a different album is flagged before you download it, and paused if found while downloading. Whoever shared it is ranked last in searches',
      'Updates are signed, and Nightjar installs only genuine ones',
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
      'Nightjar updates itself in one click, keeping your settings',
      'Report a problem from About (reports never include passwords)',
      'Check quality reads WAV files and albums on several discs',
    ],
  },
  {
    version: '0.6',
    date: '21 Oct 2026',
    title: 'SSK-Lite is now Nightjar',
    items: [
      'A new name and logo',
      'A proper Windows app, with its own window and an icon next to the clock',
      'The first start guides you through your Soulseek account and folders',
      'If something goes wrong at start, Nightjar says what and offers a fix',
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
      'Nightjar opens its port on your router so others can reach you',
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
            <h1 className="page-title" onClick={tap}>
              Nightjar {VERSION}
            </h1>
            <p className="page-sub">A modern client for the Soulseek network.</p>
          </div>
        </header>

        <p className="hint-text">
          Nightjar is a new interface on top of <a href="https://github.com/slskd/slskd" target="_blank" rel="noreferrer">slskd</a>, an
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
        <p className="about-sig">coded by lunice</p>
      </div>
    </div>
  );
}
