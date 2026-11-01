/** Sample-data only: `?demo&data=worst` swaps in realistic worst-case names, so layouts can be checked against messy data. */
export const worstCase = (): boolean => {
  try {
    return new URLSearchParams(location.search).get('data') === 'worst';
  } catch {
    return false;
  }
};

export interface WorstAlbum {
  artist: string;
  title: string;
  year: number;
  tracks: string[];
}

/** Names as real shares have them: very long, one letter, no spaces, other scripts, emoji, accents stacked. */
export const WORST_ALBUMS: WorstAlbum[] = [
  {
    artist: 'Godspeed You! Black Emperor feat. The Montreal Symphonic Chamber Ensemble',
    title: 'Lift Your Skinny Fists Like Antennas to Heaven (Remastered Deluxe Anniversary Edition) [Live at the Royal Albert Hall]',
    year: 2000,
    tracks: ['Storm / Static / Hope! (Part 1 of 3: The Dead Flag Blues Reprise)', 'Sleep', 'Antennas to Heaven', 'Like Antennas to Heaven (Extended Studio Version, Previously Unreleased)'],
  },
  { artist: 'J', title: 'Q', year: 2020, tracks: ['A'] },
  { artist: '王菲', title: '寓言', year: 2000, tracks: ['人间', '清风徐来', '致青春', '你的名字'] },
  { artist: 'نور الهدى', title: 'ليالي القاهرة', year: 2015, tracks: ['يا ليل', 'وحشتني'] },
  { artist: 'Ólafur Arnalds & Nils Frahm', title: 'Đặng Thị Ngọc Hân: Sinh nhật', year: 2011, tracks: ['Ættir', 'Þrír', 'Với Hà Nội'] },
  { artist: '🦊 Fox & The Moons 🌙', title: '😀 Greatest Hits 🎶', year: 2019, tracks: ['🔥 Fire', 'Lovers & Fighters <3', '<b>Bold &amp; Brave', '**Loud**'] },
  { artist: 'Various Artists', title: 'Benachrichtigungseinstellungen Zusammenstellung Sommerhits Neunzehnhundertneunundneunzig', year: 1999, tracks: ['Donaudampfschifffahrtsgesellschaftskapitän', 'Untitled'] },
  { artist: 'dana', title: 'one-hit wonder', year: 1970, tracks: ['Track 01'] },
];

/** Used for the tracks of any album opened in the sample library. */
export const WORST_TRACKS = [
  'A Very Long Song Title That Keeps Going: Part II (Reprise) [Live at Madison Square Garden, 1998 — Remastered 2011 Bonus Track]',
  'I',
  '深夜のドライブ',
  'Seán O’Brien’s “Smoke & Mirrors” — 7” Mix',
  '  Spaces   everywhere ',
  'ÉÈÀÙ Ṭạ̈ṅ̈g̃ḷ̃ȩ̃d̃ Ẽx̃ṗ̃ẽc̃t̃ã̃t̃ĩõ̃ñ̃s̃',
  'Track name with a snowman ☃ and a flag 🇵🇹',
];
