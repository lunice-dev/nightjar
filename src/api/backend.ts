import type { StreamAs } from '../lib/player';
import type { LibraryAccess } from './library';
import type {
  BrowseResult,
  ChatMessage,
  Conversation,
  EnqueueFile,
  LocalFiles,
  LogLine,
  Room,
  RoomInfo,
  Search,
  SearchResponse,
  ServerState,
  Settings,
  SettingsPatch,
  ShareStatus,
  TransferUser,
  UserInfo,
  UserStatus,
  EnqueueOptions,
} from './types';

export type Direction = 'download' | 'upload';

export type Unsubscribe = () => void;

export interface SearchWatch {
  onUpdate(search: Search): void;
  /** New answers, several at a time: one update for the screen instead of one per person. */
  onResponses(responses: SearchResponse[]): void;
}

/**
 * Everything the UI needs from a Soulseek engine. The real implementation talks
 * to slskd; the demo implementation runs entirely in the browser.
 */
export interface Backend {
  readonly kind: 'slskd' | 'demo';

  /** True when the engine asks for a login before the API can be used. */
  needsLogin(): Promise<boolean>;
  login(username: string, password: string, remember: boolean): Promise<void>;
  logout(): void;
  /** Stops the engine; the app around it (tray icon, launcher) closes with it. */
  quit(): Promise<void>;

  server(): Promise<ServerState>;

  startSearch(text: string): Promise<Search>;
  stopSearch(id: string): Promise<void>;
  removeSearch(id: string): Promise<void>;
  /** Streams responses as they arrive. Responses already received are replayed first. */
  watchSearch(id: string, watch: SearchWatch): Unsubscribe;

  transfers(direction: Direction): Promise<TransferUser[]>;
  enqueue(username: string, files: EnqueueFile[], options?: EnqueueOptions): Promise<void>;
  /** Average speed each person actually sent you at, from slskd's own history (bytes/s). */
  measuredSpeeds(): Promise<Map<string, number>>;
  /** Answers from earlier searches for the same words (slskd keeps searches for a week). */
  pastResponses(text: string, exceptId: string): Promise<SearchResponse[]>;
  cancel(direction: Direction, username: string, id: string, remove: boolean): Promise<void>;
  clearCompleted(direction: Direction): Promise<void>;

  browse(username: string): Promise<BrowseResult>;
  /**
   * Every file in one of someone's folders and its sub-folders (full remote paths), asked of them directly.
   * Null when they don't answer in time; search results list only some of a folder's files.
   */
  folderContents(username: string, folder: string): Promise<{ filename: string; size: number }[] | null>;
  userInfo(username: string): Promise<UserInfo>;
  userStatus(username: string): Promise<UserStatus>;

  settings(): Promise<Settings>;
  saveSettings(patch: SettingsPatch): Promise<void>;
  shareStatus(): Promise<ShareStatus>;
  rescan(): Promise<void>;

  conversations(): Promise<Conversation[]>;
  messages(username: string): Promise<ChatMessage[]>;
  sendMessage(username: string, text: string): Promise<void>;
  markRead(username: string): Promise<void>;
  closeConversation(username: string): Promise<void>;

  availableRooms(): Promise<RoomInfo[]>;
  joinedRooms(): Promise<string[]>;
  room(name: string): Promise<Room>;
  joinRoom(name: string): Promise<void>;
  leaveRoom(name: string): Promise<void>;
  sendRoomMessage(name: string, text: string): Promise<void>;

  /** True when saved settings only take effect after the engine restarts. */
  restartNeeded(): Promise<boolean>;
  /** Restarts the engine; false when that can't be done from here. */
  restart(): Promise<boolean>;

  /** Whether other people can connect to you directly; null when it can't be checked. */
  checkPort(): Promise<PortCheck | null>;
  /** How the Soulseek server sees you: the upload speed people see in their search results, and your share. */
  myStats(): Promise<{ averageSpeed: number; uploads: number; files: number; folders: number } | null>;
  /** Your Soulseek account as written in the config. */
  account(): Promise<{ username: string; hasPassword: boolean }>;
  /** Saves the Soulseek account and signs in with it. */
  signIn(username: string, password: string): Promise<SignInResult>;
  /** Why the engine isn't signed in, read from its log. */
  linkProblem(since?: number): Promise<LinkProblem>;
  /** Asks the router to forward the listening port to this computer (UPnP). Null when the helper isn't reachable. */
  openPort(): Promise<{ ok: boolean; ip?: string; port?: number; error?: string } | null>;
  /** Adds a Windows Firewall rule for the engine; Windows asks the user first. */
  allowFirewall(): Promise<{ ok: boolean; error?: string } | null>;

  /** Recent engine log lines: who browsed you, upload requests and refusals. */
  activity(): Promise<LogLine[]>;
  /** Local paths of finished downloads, by transfer id. */
  localFiles(): Promise<LocalFiles>;

  /** The computer's own folder dialog, when the engine runs on this computer. */
  folders: FolderAccess;
  /** Acting on files on this computer: show in Explorer, move to the Recycle Bin. */
  files: FileAccess;
  /** The music library (organizing downloads into it) and quality checks, done by the Nightjar app. */
  library: LibraryAccess;
}

export interface FileAccess {
  available(): Promise<boolean>;
  /** Opens Explorer with the file selected (or the folder open). */
  reveal(path: string): Promise<boolean>;
  /** Moves a downloaded file to the Recycle Bin. Only works inside the download folders. */
  trash(path: string): Promise<boolean>;
  /**
   * Moves an album you no longer want to the Recycle Bin: its folders, its files, and the unfinished parts of
   * cancelled or failed tracks. Resolves to how many items went, or null when the helper isn't reachable.
   */
  trashDownload(what: { folders: string[]; files: string[]; partials: { user: string; file: string }[] }): Promise<number | null>;
  /** Lets the person choose a picture; resolves to its path, or null. */
  pickImage(): Promise<string | null>;
  /** A data: URL preview of a local picture, or null. */
  imagePreview(path: string): Promise<string | null>;
  /**
   * An <img> address for the album art in a folder on this computer (cover.jpg,
   * folder.png…), or null when the helper isn't reachable (a phone).
   */
  coverUrl(dir: string): Promise<string | null>;
  /** An <img> address for a picture file on the computer (a playlist's cover). */
  pictureUrl(path: string): Promise<string | null>;
  /**
   * An <audio> address for a track on the computer: the file itself, or an AAC copy at the
   * given bitrate (128 or 256 kbit/s) made by the computer. Null without the Nightjar app.
   */
  streamUrl(path: string, as?: StreamAs): Promise<string | null>;
  /**
   * The same address, right away, when it can be built without asking the computer (null otherwise).
   * Lock-screen buttons must start the next track inside the button press, or iPhones keep it silent.
   */
  streamUrlNow(path: string, as?: StreamAs): string | null;
  /** Where each shared folder lives on this computer, by the name others see. */
  shareRoots(): Promise<{ remote: string; local: string }[]>;
  /**
   * Only one window may run the download manager (Nightjar's own window, the
   * luniceOS tab and a phone can be open at once). True while this one holds it.
   */
  lease(id: string): Promise<boolean>;
}

export interface FolderAccess {
  available(): Promise<boolean>;
  /** Resolves to the chosen full path, or null if the dialog was cancelled. */
  pick(start?: string): Promise<string | null>;
  /** null when it can't be checked. */
  exists(path: string): Promise<boolean | null>;
  /** This computer's Music folder, and whether it lives in OneDrive. */
  known(): Promise<{ music: string | null; musicInOneDrive: boolean }>;
}

export type SignInResult = 'ok' | 'rejected' | 'kicked' | 'timeout';
export type LinkProblem = 'rejected' | 'kicked' | 'no-account' | null;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface PortCheck {
  port: number;
  /** null when the test itself failed. */
  open: boolean | null;
  ip?: string;
}
