export type MediaCategory = 'anime' | 'tv' | 'movies' | 'other';

export type AutoDetectedType = 'movie' | 'series';

export type WatchedFilter = 'all' | 'continue' | 'unwatched' | 'completed';

export type WatchingStatus =
  | 'unwatched'
  | 'watching'
  | 'completed'
  | 'Unwatched'
  | 'Watching'
  | 'Completed';

export type SortOption = 'lastWatched' | 'title' | 'year' | 'rating';

export type ViewLayout = 'grid' | 'compact';

export type MetadataProvider = 'anilist' | 'tmdb' | 'local';

export interface SubtitleTrack {
  id: string;
  label: string;
  language: string;
  format: 'srt' | 'vtt' | 'embedded';
  sourcePath?: string;
  streamIndex?: number;
  rawContent?: string;
}

export interface AudioTrack {
  id: string;
  index: number;
  label: string;
  language: string;
  codec: string;
  channels: string;
}

export interface EpisodeProgress {
  status?: WatchingStatus;
  currentTime: number;
  duration: number;
  completed: boolean;
  updatedAt: string;
  lastWatched?: string;
}

export interface MediaEpisode {
  id: string;
  mediaId: string;
  title: string;
  seasonNumber: number;
  episodeNumber: number;
  fileName: string;
  relativePath: string;
  containerFormat: 'mp4' | 'webm' | 'mkv' | 'avi' | 'mov';
  fileSizeBytes: number;
  estimatedDurationSec: number;
  resolutionLabel: string;
  requiresRemux: boolean;
  isSampleSynthetic: boolean;
  visualTheme: 'cyber_anime' | 'fantasy_anime' | 'nordic_mystery' | 'scifi_cosmos' | 'kyoto_doc' | 'studio_reel';
  subtitles: SubtitleTrack[];
  audioTracks: AudioTrack[];
  progress: EpisodeProgress;
  // When picked via the native browser OS folder picker:
  clientBlobUrl?: string;
  clientFile?: File;
}

export interface ExternalMetadataMatch {
  provider: 'anilist' | 'tmdb';
  externalId: string;
  title: string;
  originalTitle?: string;
  synonyms?: string[];
  synopsis: string;
  posterUrl: string;
  bannerUrl?: string;
  releaseYear: string;
  genres: string[];
  ratingScore?: number; // 0-100 scale or 0-10 normalized to percentage/score
  studioOrNetwork?: string;
  mediaType?: 'ANIME' | 'MOVIE' | 'TV';
  isAnimeCandidate?: boolean;
}

export interface MediaItem {
  id: string;
  folderName: string;
  relativePath: string;
  title: string;
  originalTitle: string;
  synopsis: string;
  releaseYear: string;
  autoType: AutoDetectedType;
  category: MediaCategory;
  isManualCategory: boolean;
  posterUrl: string;
  bannerUrl?: string;
  customPosterUrl?: string;
  genres: string[];
  ratingScore?: number;
  studioOrNetwork?: string;
  metadataProvider?: MetadataProvider;
  externalId?: string;
  isFavorite: boolean;
  episodes: MediaEpisode[];
  seasons?: number[];
  totalEpisodes: number;
  watchedEpisodes: number;
  inProgressEpisode?: MediaEpisode;
  lastWatchedAt?: string;
  watchingStatus?: WatchingStatus;
  isClientPickedFolder?: boolean;
  sourceFolderPath?: string;
}

export interface ConfiguredMediaFolder {
  id: string;
  path: string;
  label: string;
  sourceType: 'server' | 'client_handle';
  available: boolean;
  videoCount: number;
  itemCount?: number;
  lastScannedAt: string;
}

export interface WatchHistoryEntry {
  id: number;
  episodeId: string;
  mediaId: string;
  mediaTitle: string;
  episodeTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  currentTime: number;
  duration: number;
  status: WatchingStatus;
  watchedAt: string;
  lastWatched?: string;
}

export interface UserPreferences {
  activeSourceMode: 'server' | 'client';
  activeClientFolderName: string;
  activeTab: 'all' | MediaCategory | 'watchlist';
  watchedFilter: WatchedFilter;
  sortBy: SortOption;
  viewLayout: ViewLayout;
  darkMode: boolean;
  tvMode: boolean;
  completionThreshold: number; // default 0.90 (90%)
  playbackVolume: number;
  playbackMuted: boolean;
  playbackRate: number;
}

export interface LanNetworkInfo {
  hostname: string;
  port: number;
  lanUrls: string[];
  isLocalhostClient: boolean;
  pinProtectionEnabled: boolean;
  isAuthorizedClient: boolean;
  firewallCommandWindows: string;
}

export interface SystemCapabilities {
  rootPath: string;
  configuredFolders: ConfiguredMediaFolder[];
  defaultSamplePath: string;
  ffmpegAvailable: boolean;
  ffmpegVersion?: string;
  tmdbConfigured: boolean;
  platform: string;
  hostname: string;
  supportedContainers: string[];
  lastScannedAt: string;
  totalFilesScanned: number;
  sqlitePath?: string;
}

export interface LibraryResponse {
  items: MediaItem[];
  clientSnapshot?: {
    rootFolderName: string;
    items: MediaItem[];
    totalVideoFiles: number;
    updatedAt: string;
  } | null;
  capabilities: SystemCapabilities;
  preferences?: UserPreferences;
  watchHistory?: WatchHistoryEntry[];
  networkInfo?: LanNetworkInfo;
}

export interface DirectoryBrowseResponse {
  currentPath: string;
  parentPath: string | null;
  directories: {
    name: string;
    fullPath: string;
    videoCountHint: number;
  }[];
}
