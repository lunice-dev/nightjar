import { ReportProblem } from '../components/ReportProblem';
import { UpdateSection } from '../components/Updates';
import { Mark } from '../components/Mark';

export const VERSION = '0.7';

/** What changed in each version, newest first. Keep entries short and in the user's words. */
const CHANGES: { version: string; date: string; title: string; items: string[] }[] = [
  {
    version: '0.8',
    date: '24 Oct 2026',
    title: 'Nightjar on your phone, anywhere',
    items: [
      'Remote access: use Nightjar on your phone or another computer away from home, through Tailscale (free, private, nothing open to the internet). Settings → Remote access walks you through it and installs Tailscale for you',
      'Everything works from your phone: search, downloads, your library, Tidy, Check quality and Put in library; folders are chosen in the page',
      'Sign a phone in by scanning a QR code and typing a short code, or with a remote password; see and remove signed-in devices',
      'On an iPhone, Nightjar goes on the Home Screen and opens like an app',
      'Play your music: Play on any album in Library, Downloads and From your share, with lock-screen controls. “Use less data” sends smaller AAC copies made by your computer',
      'A large player: big album art over colours taken from it, shuffle, repeat, Play next and Add to queue; on the computer and an iPad held sideways, the art sits beside the controls and the queue',
      'Tap any album cover to open it: its tracks, Play, Shuffle, and Play next / Add to queue / Add to playlist for a track or the whole album',
      'Playlists, kept on your computer for all your devices: on the search page, with rename, drag to reorder, remove, and a cover (a mosaic, one of its albums, or your own picture). Tracks Tidy moved are found again',
      'Your home Wi-Fi can stay open to phones without Tailscale (search, downloads, chat), with the remote password',
      'Uploads and Activity show when things happened, grouped by day; block someone straight from Uploads',
      'Click any name for a profile card; people who sent you fake copies are remembered and ranked down',
      'Leech rules and friends first decide who gets your uploads; smart downloads fetch the whole album and warn when a copy is incomplete',
    ],
  },
  {
    version: '0.7',
    date: '22 Oct 2026',
    title: 'Your library, checked and tidied',
    items: [
      'Library: every album in your library, with Check quality for any of them, or Check all in the background',
      'Tidy library: reviews the whole library into Format\\Artist\\Year - Album and shows every move first; you untick, rename, give missing years, choose between copies, then Apply, and can undo it',
      'Albums split into CD1/CD2 folders and box sets stay together; compilations go to Various Artists; your own artist folders win over odd tags',
      'Group folders you make, like FLAC\\JP City Pop\\Anri, are kept: albums are tidied inside them, and new downloads by those artists go there too',
      'Search shows what you already have (“In your library: FLAC 16/44.1”), and when a copy is better than yours',
      'Nightjar updates itself: it says when a new version is out and installs it with one click, keeping your settings',
      'Something not working? About makes a report with the recent logs (never passwords) to send',
      'Check quality reads WAV albums too, and says why when an album can’t be checked',
      'The opening screen is a night sky; the mouse’s back button moves between screens',
      'Check quality reads disc folders too, and no longer calls a file damaged because of an old tag left after the music',
    ],
  },
  {
    version: '0.6',
    date: '21 Oct 2026',
    title: 'SSK-Lite is now Nightjar',
    items: [
      'A new name and a bird for a logo, a nod to Soulseek’s own',
      'A real Windows app: its own window with its own title bar, a proper icon, one compact size, and the icon next to the clock',
      'Nightjar alone starts and stops the engine: closing luniceOS, the window or a browser tab never cuts your downloads',
      'If something goes wrong at start, Nightjar says what and offers the fix (close SoulseekQt, end an old engine, try again, open the logs)',
      'First start walks you through it: a Soulseek name and password, then your download and shared folders',
      'The bottom bar shows whether you are really signed in to Soulseek, and why not when you aren’t',
      'Change your Soulseek name and password in Settings',
      'Home shows your library, this week’s downloads, who downloads from you and how the connection is doing',
      'Your shares no longer waits forever when the engine has only just started',
      'A profile picture Windows can’t open no longer breaks Settings; Nightjar keeps its own copy of the picture you choose',
      'Only one window runs the download manager, even with the app, luniceOS and a phone open together',
      'Download starts from the group of identical copies that can send fastest together, not just the single fastest copy',
      'Helpers come only from copies with exactly the same files, chosen among all copies found, and join while the album downloads',
      'Several searches at once stay smooth: answers are fetched only when there are new ones, and grouped in one go',
      'Closing SoulseekQt from the start screen waits until it has really closed',
      'Restart now in Settings no longer closes Nightjar; an engine that restarts itself is picked up again',
      'A new install shares nothing until you choose (Share my Music folder is one click), and doesn’t download into OneDrive',
      'Downloads keep their speed: a track coming in far slower than the album’s other sources moves to a faster one with the same file, and that slow source gets no more of the album',
      'Helpers join only with a free slot and enough speed to finish their share with everyone else, so one slow person no longer holds up the last track',
      'Delete in Downloads also removes cancelled and unfinished albums: their folder and the parts left in the incomplete folder',
      'Uploads shows your sharing in numbers: speed right now, this week, average speed, and the speed others see next to your name',
      'Home shows upload speed too, and keeps its history when you clear the Downloads list',
      'Album covers on the home page appear straight away and stay once found',
      'Put in library: moves an album to Library\\FLAC, Hi-Res or MP3\\Artist\\Year - Album, finds the artist’s folder even when spelled differently, asks before creating a new one, and can be undone',
      'Check quality, when you ask: real lossless or made from an MP3, real hi-res, real 24-bit, honest MP3 bitrate, damaged files; one verdict per album',
      'Downloads lists everything else in your downloads folder that isn’t in your library yet',
      'If a screen ever breaks, Nightjar says so and offers Reload instead of showing an empty window',
      'Search shows what Download will do: “2 at once” or “3 at once” when several people have exactly the same files, “One source” when only one has',
    ],
  },
  {
    version: '0.5.1',
    date: '21 Oct 2026',
    title: 'Reaching people again',
    items: [
      'Nightjar asks your router to open its port each time it starts, like SoulseekQt did',
      'Settings can open the port on the router and allow Nightjar through Windows Firewall, when people can’t reach you',
    ],
  },
  {
    version: '0.5',
    date: '21 Oct 2026',
    title: 'Albums from several people at once',
    items: [
      'An album shared identically by several people downloads different tracks from up to three of them at the same time',
      'A person who finishes early takes over tracks still waiting with someone slower',
      'Sources are ranked by how fast each person really sent you files before, not what their client claims',
      'Downloads are split into Downloading, Waiting, Needs attention and Finished, newest first, one row per album',
      'Searches wait longer and accept up to ten times more answers; searching the same words again keeps what the last search found',
      'Results stay in place while you read them; new ones wait behind a button',
      'Results that match the artist or album name come first',
      'Your share and its folder tree come straight from this computer, always up to date, without connecting to yourself',
      'Light, Dark and Auto themes, with Auto showing what it follows',
      'Phone access on your home network',
      'New look: a top bar, stone colours, big rounded panels, and a home page with what you are downloading',
      'Album art everywhere: the cover from the album folder on your computer, or from the Cover Art Archive',
      'Your share as a shelf of covers',
      'Scan again looks through your shared folders, and runs by itself after deletes and finished downloads',
      'Quit closes Nightjar completely, including the icon next to the clock',
    ],
  },
  {
    version: '0.4',
    date: '20 Oct 2026',
    title: 'Faster downloads, a real app, a new look',
    items: [
      'Download picks the fastest copy, and moves refused, failed or stuck tracks to the next copy of the same album',
      'Plain reasons when someone refuses a download',
      'Show finished or failed downloads in Explorer, or move them to the Recycle Bin',
      'Uploads shows everything people do with your share: browsing, opening folders, asking for files, downloading',
      'Speed limits and upload slots up front in Settings and the sidebar',
      'Search history, and your own share sorted by quality on the Search page',
      'Edit your profile: description and picture',
      'Wishlist, history and activity are the same in every window, the luniceOS tab and the installed app',
      'Soulseek tab in luniceOS',
      'Installable Windows app with its own window and an icon next to the clock',
      'New look: quality as a level meter, Instrument Sans, calmer panels',
    ],
  },
  {
    version: '0.3',
    date: '20 Oct 2026',
    title: 'Running on the real network',
    items: [
      'Wishlist that searches again by itself, people list with online alerts, ignore list',
      'Notifications for messages, finished downloads and wishlist finds',
      'Tab bar on phones',
      'Launcher for Windows, folder picker, and a check that others can reach you',
      'Settings that need a restart say so and restart for you',
      'Searches that nobody answers explain why (some names are blocked by the Soulseek server)',
    ],
  },
  {
    version: '0.2',
    date: '20 Oct 2026',
    title: 'Everything SoulseekQt does',
    items: ['Uploads and shared folders', 'Private messages and chat rooms', 'User profiles and browsing someone’s files', 'Limits and who can’t download from you'],
  },
  {
    version: '0.1',
    date: '20 Oct 2026',
    title: 'A new Soulseek interface',
    items: [
      'Search results grouped into albums, with copies from different people stacked together',
      'Quality you can see: hi-res, lossless, 320, VBR/256, under 192',
      'Downloads grouped by album, retry only what failed',
      'Sample data to try it without an account',
    ],
  },
];

export function AboutScreen() {
  return (
    <div className="page">
      <div className="page-inner narrow">
        <header className="about-head">
          <Mark size={44} />
          <div>
            <h1 className="page-title">Nightjar {VERSION}</h1>
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
            {CHANGES.map((c) => (
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
