// Shapes returned by the slskd HTTP API (v0). Field names mirror slskd's JSON.

export interface SearchFile {
  filename: string;
  size: number;
  extension?: string;
  bitRate?: number | null;
  bitDepth?: number | null;
  sampleRate?: number | null;
  length?: number | null;
  isVariableBitRate?: boolean | null;
  isLocked?: boolean;
}

export interface SearchResponse {
  username: string;
  fileCount: number;
  lockedFileCount: number;
  files: SearchFile[];
  lockedFiles: SearchFile[];
  hasFreeUploadSlot: boolean;
  queueLength: number;
  uploadSpeed: number; // bytes per second
  token?: number;
  /** From an earlier search for the same words; this person didn't answer this time. */
  earlier?: boolean;
}

export type SearchState = string; // e.g. "InProgress", "Completed, TimedOut"

export interface Search {
  id: string;
  searchText: string;
  state: SearchState;
  isComplete?: boolean;
  fileCount: number;
  lockedFileCount: number;
  responseCount: number;
  startedAt: string;
  endedAt?: string | null;
}

export type TransferState =
  | 'Requested'
  | 'Queued, Remotely'
  | 'Queued, Locally'
  | 'Initializing'
  | 'InProgress'
  | 'Completed, Succeeded'
  | 'Completed, Cancelled'
  | 'Completed, TimedOut'
  | 'Completed, Errored'
  | 'Completed, Rejected'
  | string;

export interface Transfer {
  id: string;
  /** Why it failed or was refused, in the remote client's words. */
  exception?: string | null;
  stateDescription?: string | null;
  username: string;
  direction: 'Download' | 'Upload';
  filename: string;
  size: number;
  state: TransferState;
  bytesTransferred: number;
  averageSpeed: number;
  percentComplete: number;
  placeInQueue?: number | null;
  requestedAt: string;
  enqueuedAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  /** The batch this download was queued in; Nightjar uses one batch per source of an album. */
  batchId?: string | null;
}

export interface EnqueueOptions {
  /** A new batch id (UUID) for these files. */
  batchId?: string;
  /** Folder under the downloads folder; all sources of one album share it. */
  destination?: string;
}

export interface TransferDirectory {
  directory: string;
  fileCount: number;
  files: Transfer[];
}

export interface TransferUser {
  username: string;
  directories: TransferDirectory[];
}

export interface BrowseDirectory {
  name: string;
  fileCount: number;
  files: SearchFile[];
}

export interface BrowseResult {
  directoryCount?: number;
  directories: BrowseDirectory[];
  lockedDirectories?: BrowseDirectory[];
}

export interface ServerState {
  isConnected: boolean;
  isLoggedIn: boolean;
  isConnecting?: boolean;
  isLoggingIn?: boolean;
  username?: string;
}

export interface EnqueueFile {
  filename: string;
  size: number;
}

// ---------------------------------------------------------------------------
// Sharing and limits

/** A line from the engine's recent log, used for the activity feed. */
export interface LogLine {
  timestamp: string;
  level: string;
  message: string;
}

/** Where finished downloads ended up on disk, by transfer id. */
export type LocalFiles = Map<string, string>;

export interface ShareStatus {
  scanning: boolean;
  progress: number; // 0..1
  directories: number;
  files: number;
  faulted: boolean;
}

export interface Settings {
  downloadDir: string;
  sharedFolders: string[];
  /** KiB/s; null means unlimited. */
  uploadLimit: number | null;
  downloadLimit: number | null;
  uploadSlots: number;
  /** People who may not download from you. */
  blocked: string[];
  /** Your profile as others see it. */
  description: string;
  /** Full path of the profile picture on this computer, or '' for none. */
  picture: string;
  /** False when the engine refuses config changes from the UI. */
  editable: boolean;
}

export type SettingsPatch = Partial<Omit<Settings, 'editable'>>;

// ---------------------------------------------------------------------------
// People and chat

export interface UserInfo {
  description?: string | null;
  hasPicture?: boolean;
  picture?: string | null; // base64
  uploadSlots?: number;
  queueLength?: number;
  hasFreeUploadSlot?: boolean;
}

export type Presence = 'Online' | 'Away' | 'Offline';

export interface UserStatus {
  presence: Presence;
  isPrivileged?: boolean;
}

export interface ChatMessage {
  id?: number;
  timestamp: string;
  username: string;
  message: string;
  direction: 'In' | 'Out';
  isAcknowledged?: boolean;
}

export interface Conversation {
  username: string;
  isActive: boolean;
  unAcknowledgedMessageCount: number;
  messages?: ChatMessage[];
}

export interface RoomInfo {
  name: string;
  userCount: number;
}

export interface RoomUser {
  username: string;
  status?: Presence | string;
  averageSpeed?: number;
  fileCount?: number;
  countryCode?: string | null;
}

export interface RoomMessage {
  timestamp: string;
  username: string;
  message: string;
  roomName: string;
  direction?: 'In' | 'Out';
}

export interface Room {
  name: string;
  users: RoomUser[];
  messages: RoomMessage[];
}
