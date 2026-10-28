export type MediaCategory = 'anime' | 'tv' | 'movies' | 'other';

export type AutoDetectedType = 'movie' | 'series';

export type WatchedFilter = 'all' | 'continue' | 'unwatched' | 'completed';

export interface SubtitleTrack {
  id: string;
  label: string;
  language: string;
  format: 'srt' | 'vtt' | 'embedded';
  sourcePath?: string;
  streamIndex?: number;
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
  currentTime: number;
  duration: number;
  completed: boolean;
  updatedAt: string;
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
  customPosterUrl?: string;
  isFavorite: boolean;
  episodes: MediaEpisode[];
  totalEpisodes: number;
  watchedEpisodes: number;
  inProgressEpisode?: MediaEpisode;
  lastWatchedAt?: string;
}

export interface SystemCapabilities {
  rootPath: string;
  defaultSamplePath: string;
  ffmpegAvailable: boolean;
  ffmpegVersion?: string;
  platform: string;
  hostname: string;
  supportedContainers: string[];
  lastScannedAt: string;
  totalFilesScanned: number;
}

export interface LibraryResponse {
  items: MediaItem[];
  capabilities: SystemCapabilities;
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
