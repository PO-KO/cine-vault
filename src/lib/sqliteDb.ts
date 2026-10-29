import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  EpisodeProgress,
  ExternalMetadataMatch,
  MediaCategory,
  MediaItem,
  UserPreferences,
  WatchingStatus,
  WatchHistoryEntry,
} from '../types/media';

const WORKSPACE_ROOT = process.cwd();
export const SQLITE_DB_PATH = path.resolve(WORKSPACE_ROOT, 'cinevault.sqlite');
const LEGACY_JSON_STATE_PATH = path.resolve(WORKSPACE_ROOT, 'media-library-state.json');

export interface LanSecurityConfig {
  pinEnabled: boolean;
  pinHash: string;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  activeSourceMode: 'server',
  activeClientFolderName: '',
  activeTab: 'all',
  watchedFilter: 'all',
  sortBy: 'lastWatched',
  viewLayout: 'grid',
  darkMode: true,
  tvMode: false,
  completionThreshold: 0.9,
  playbackVolume: 0.8,
  playbackMuted: false,
  playbackRate: 1,
};

const globalForSqlite = globalThis as unknown as {
  __cinevaultSqliteDb?: DatabaseSync;
  __cinevaultSqliteInitialized?: boolean;
};

export function getDb(): DatabaseSync {
  if (!globalForSqlite.__cinevaultSqliteDb) {
    const db = new DatabaseSync(SQLITE_DB_PATH);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec(`
      CREATE TABLE IF NOT EXISTS media_folders (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'server',
        is_active INTEGER NOT NULL DEFAULT 1,
        last_scanned_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS catalog_snapshots (
        id TEXT PRIMARY KEY,
        root_folder_name TEXT NOT NULL,
        items_json TEXT NOT NULL,
        total_files INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS media_overrides (
        media_id TEXT PRIMARY KEY,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        manual_category TEXT,
        custom_title TEXT,
        custom_synopsis TEXT,
        custom_poster TEXT,
        external_metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS episode_progress (
        episode_id TEXT PRIMARY KEY,
        media_id TEXT,
        status TEXT NOT NULL DEFAULT 'unwatched',
        current_time REAL NOT NULL DEFAULT 0,
        duration REAL NOT NULL DEFAULT 1440,
        completed INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS watch_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        episode_id TEXT NOT NULL,
        media_id TEXT NOT NULL,
        media_title TEXT NOT NULL,
        episode_title TEXT NOT NULL,
        season_number INTEGER NOT NULL DEFAULT 1,
        episode_number INTEGER NOT NULL DEFAULT 1,
        current_time REAL NOT NULL DEFAULT 0,
        duration REAL NOT NULL DEFAULT 1440,
        status TEXT NOT NULL DEFAULT 'watching',
        watched_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_preferences (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
    `);
    globalForSqlite.__cinevaultSqliteDb = db;
  }
  return globalForSqlite.__cinevaultSqliteDb;
}

export function hashPin(pin: string): string {
  return crypto.createHash('sha256').update(`cinevault-pin:${pin.trim()}`).digest('hex');
}

export function createLanSessionToken(pinHash: string): string {
  return crypto.createHash('sha256').update(`cinevault-session:${pinHash}`).digest('hex');
}

export function getLanSecurityConfig(): LanSecurityConfig {
  const db = getDb();
  const row = db
    .prepare('SELECT value_json FROM user_preferences WHERE key = ?')
    .get('lan_security') as { value_json: string } | undefined;
  if (row?.value_json) {
    try {
      const parsed = JSON.parse(row.value_json);
      return {
        pinEnabled: Boolean(parsed.pinEnabled && parsed.pinHash),
        pinHash: String(parsed.pinHash || ''),
      };
    } catch {}
  }
  return { pinEnabled: false, pinHash: '' };
}

export function saveLanSecurityConfig(config: LanSecurityConfig): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO user_preferences (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
  ).run('lan_security', JSON.stringify(config));
}

export function getUserPreferences(): UserPreferences {
  const db = getDb();
  const row = db
    .prepare('SELECT value_json FROM user_preferences WHERE key = ?')
    .get('app_preferences') as { value_json: string } | undefined;
  if (row?.value_json) {
    try {
      const parsed = JSON.parse(row.value_json);
      return {
        ...DEFAULT_USER_PREFERENCES,
        ...parsed,
        completionThreshold:
          typeof parsed.completionThreshold === 'number' &&
          Number.isFinite(parsed.completionThreshold) &&
          parsed.completionThreshold >= 0.5 &&
          parsed.completionThreshold <= 1
            ? parsed.completionThreshold
            : 0.9,
        playbackVolume:
          typeof parsed.playbackVolume === 'number' &&
          Number.isFinite(parsed.playbackVolume) &&
          parsed.playbackVolume >= 0 &&
          parsed.playbackVolume <= 1
            ? parsed.playbackVolume
            : 0.8,
        playbackRate:
          typeof parsed.playbackRate === 'number' &&
          Number.isFinite(parsed.playbackRate) &&
          parsed.playbackRate > 0
            ? parsed.playbackRate
            : 1,
      };
    } catch {}
  }
  return { ...DEFAULT_USER_PREFERENCES };
}

export function saveUserPreferences(updates: Partial<UserPreferences>): UserPreferences {
  const db = getDb();
  const current = getUserPreferences();
  const merged: UserPreferences = {
    ...current,
    ...updates,
  };
  db.prepare(
    'INSERT INTO user_preferences (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
  ).run('app_preferences', JSON.stringify(merged));
  return merged;
}

export function getWatchHistory(limit = 50): WatchHistoryEntry[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, episode_id, media_id, media_title, episode_title, season_number, episode_number, current_time, duration, status, watched_at
       FROM watch_history
       ORDER BY watched_at DESC, id DESC
       LIMIT ?`
    )
    .all(limit) as {
    id: number;
    episode_id: string;
    media_id: string;
    media_title: string;
    episode_title: string;
    season_number: number;
    episode_number: number;
    current_time: number;
    duration: number;
    status: WatchingStatus;
    watched_at: string;
  }[];

  return rows.map((r) => ({
    id: r.id,
    episodeId: r.episode_id,
    mediaId: r.media_id,
    mediaTitle: r.media_title,
    episodeTitle: r.episode_title,
    seasonNumber: r.season_number,
    episodeNumber: r.episode_number,
    currentTime: r.current_time,
    duration: r.duration,
    status: r.status,
    watchedAt: r.watched_at,
  }));
}

export function recordWatchHistory(entry: {
  episodeId: string;
  mediaId: string;
  mediaTitle: string;
  episodeTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  currentTime: number;
  duration: number;
  status: WatchingStatus;
}): void {
  const db = getDb();
  const now = new Date().toISOString();

  // Deduplicate recent identical episode entry so the history list stays clean and up-to-date
  db.prepare('DELETE FROM watch_history WHERE episode_id = ?').run(entry.episodeId);

  db.prepare(
    `INSERT INTO watch_history (
      episode_id, media_id, media_title, episode_title, season_number, episode_number, current_time, duration, status, watched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.episodeId,
    entry.mediaId,
    entry.mediaTitle,
    entry.episodeTitle,
    entry.seasonNumber,
    entry.episodeNumber,
    Math.floor(entry.currentTime),
    Math.floor(entry.duration),
    entry.status,
    now
  );
}

export function clearWatchHistory(): void {
  const db = getDb();
  db.prepare('DELETE FROM watch_history').run();
}

export function upsertEpisodeProgressInDb(params: {
  episodeId: string;
  mediaId?: string;
  currentTime: number;
  duration: number;
  completed?: boolean;
  mediaTitle?: string;
  episodeTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}): EpisodeProgress {
  const db = getDb();
  const prefs = getUserPreferences();
  const threshold = prefs.completionThreshold || 0.9;

  const existing = db
    .prepare(
      'SELECT episode_id, media_id, status, current_time, duration, completed, updated_at FROM episode_progress WHERE episode_id = ?'
    )
    .get(params.episodeId) as
    | {
        episode_id: string;
        media_id: string | null;
        status: string;
        current_time: number;
        duration: number;
        completed: number;
        updated_at: string;
      }
    | undefined;

  const nextDuration =
    typeof params.duration === 'number' && params.duration > 0
      ? Math.floor(params.duration)
      : existing?.duration || 1440;
  const rawTime =
    typeof params.currentTime === 'number' && params.currentTime >= 0
      ? Math.floor(params.currentTime)
      : existing?.current_time || 0;

  const reachedThreshold = nextDuration > 0 && rawTime / nextDuration >= threshold;
  const isCompleted =
    typeof params.completed === 'boolean' ? params.completed : reachedThreshold;

  const finalCurrentTime = isCompleted ? 0 : rawTime;
  const status: WatchingStatus = isCompleted
    ? 'completed'
    : finalCurrentTime > 0
    ? 'watching'
    : 'unwatched';
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO episode_progress (episode_id, media_id, status, current_time, duration, completed, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(episode_id) DO UPDATE SET
       media_id = COALESCE(excluded.media_id, episode_progress.media_id),
       status = excluded.status,
       current_time = excluded.current_time,
       duration = excluded.duration,
       completed = excluded.completed,
       updated_at = excluded.updated_at`
  ).run(
    params.episodeId,
    params.mediaId || existing?.media_id || null,
    status,
    finalCurrentTime,
    nextDuration,
    isCompleted ? 1 : 0,
    now
  );

  if (status === 'watching' || status === 'completed') {
    recordWatchHistory({
      episodeId: params.episodeId,
      mediaId: params.mediaId || existing?.media_id || 'local-media',
      mediaTitle: params.mediaTitle || 'Media Item',
      episodeTitle: params.episodeTitle || 'Episode',
      seasonNumber: params.seasonNumber || 1,
      episodeNumber: params.episodeNumber || 1,
      currentTime: finalCurrentTime,
      duration: nextDuration,
      status,
    });
  }

  return {
    status,
    currentTime: finalCurrentTime,
    duration: nextDuration,
    completed: isCompleted,
    updatedAt: now,
  };
}

export function getAllEpisodeProgressFromDb(): Record<string, EpisodeProgress> {
  const db = getDb();
  const rows = db
    .prepare('SELECT episode_id, status, current_time, duration, completed, updated_at FROM episode_progress')
    .all() as {
    episode_id: string;
    status: WatchingStatus;
    current_time: number;
    duration: number;
    completed: number;
    updated_at: string;
  }[];

  const out: Record<string, EpisodeProgress> = {};
  for (const r of rows) {
    out[r.episode_id] = {
      status: r.status || (r.completed ? 'completed' : r.current_time > 0 ? 'watching' : 'unwatched'),
      currentTime: r.current_time,
      duration: r.duration,
      completed: Boolean(r.completed),
      updatedAt: r.updated_at,
    };
  }
  return out;
}

export function saveClientCatalogSnapshotToDb(params: {
  rootFolderName: string;
  items: MediaItem[];
  totalVideoFiles: number;
}): void {
  const db = getDb();
  const now = new Date().toISOString();

  // Strip ephemeral blob: URLs and non-serializable File objects before persisting to SQLite
  const sanitizedItems: MediaItem[] = params.items.map((item) => ({
    ...item,
    posterUrl: item.posterUrl?.startsWith('blob:') ? '' : item.posterUrl,
    bannerUrl: item.bannerUrl?.startsWith('blob:') ? '' : item.bannerUrl,
    isClientPickedFolder: true,
    episodes: item.episodes.map((ep) => ({
      ...ep,
      clientBlobUrl: undefined,
      clientFile: undefined,
    })),
  }));

  db.prepare(
    `INSERT INTO catalog_snapshots (id, root_folder_name, items_json, total_files, updated_at)
     VALUES ('active_client', ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       root_folder_name = excluded.root_folder_name,
       items_json = excluded.items_json,
       total_files = excluded.total_files,
       updated_at = excluded.updated_at`
  ).run(params.rootFolderName, JSON.stringify(sanitizedItems), params.totalVideoFiles, now);

  // Also persist any progress or external metadata contained in the client items
  for (const item of sanitizedItems) {
    if (item.metadataProvider && item.metadataProvider !== 'local' && item.posterUrl) {
      const extMatch: ExternalMetadataMatch = {
        provider: item.metadataProvider === 'anilist' ? 'anilist' : 'tmdb',
        externalId: item.externalId || item.id,
        title: item.title,
        originalTitle: item.originalTitle,
        synopsis: item.synopsis,
        posterUrl: item.posterUrl,
        bannerUrl: item.bannerUrl,
        releaseYear: item.releaseYear,
        genres: item.genres || [],
        ratingScore: item.ratingScore,
        studioOrNetwork: item.studioOrNetwork,
      };
      db.prepare(
        `INSERT INTO media_overrides (media_id, is_favorite, external_metadata_json)
         VALUES (?, ?, ?)
         ON CONFLICT(media_id) DO UPDATE SET
           external_metadata_json = COALESCE(media_overrides.external_metadata_json, excluded.external_metadata_json)`
      ).run(item.id, item.isFavorite ? 1 : 0, JSON.stringify(extMatch));
    }
  }

  saveUserPreferences({
    activeSourceMode: 'client',
    activeClientFolderName: params.rootFolderName,
  });
}

export function getClientCatalogSnapshotFromDb(): {
  rootFolderName: string;
  items: MediaItem[];
  totalVideoFiles: number;
  updatedAt: string;
} | null {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT root_folder_name, items_json, total_files, updated_at FROM catalog_snapshots WHERE id = ?'
    )
    .get('active_client') as
    | {
        root_folder_name: string;
        items_json: string;
        total_files: number;
        updated_at: string;
      }
    | undefined;

  if (!row) return null;

  try {
    const rawItems: MediaItem[] = JSON.parse(row.items_json);
    const mergedItems = applyOverridesAndProgressToItems(rawItems);
    return {
      rootFolderName: row.root_folder_name,
      items: mergedItems,
      totalVideoFiles: row.total_files,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export function applyOverridesAndProgressToItems(items: MediaItem[]): MediaItem[] {
  const db = getDb();
  const progressMap = getAllEpisodeProgressFromDb();
  const overrideRows = db
    .prepare(
      'SELECT media_id, is_favorite, manual_category, custom_title, custom_synopsis, custom_poster, external_metadata_json FROM media_overrides'
    )
    .all() as {
    media_id: string;
    is_favorite: number;
    manual_category: MediaCategory | null;
    custom_title: string | null;
    custom_synopsis: string | null;
    custom_poster: string | null;
    external_metadata_json: string | null;
  }[];

  const overrideMap = new Map<string, (typeof overrideRows)[number]>();
  for (const r of overrideRows) {
    overrideMap.set(r.media_id, r);
  }

  return items.map((item) => {
    const ov = overrideMap.get(item.id);
    let extMeta: ExternalMetadataMatch | null = null;
    if (ov?.external_metadata_json) {
      try {
        extMeta = JSON.parse(ov.external_metadata_json);
      } catch {}
    }

    const updatedEpisodes = item.episodes.map((ep) => {
      const savedProg = progressMap[ep.id];
      if (!savedProg) {
        return {
          ...ep,
          progress: {
            ...ep.progress,
            status: ep.progress.completed
              ? ('completed' as WatchingStatus)
              : ep.progress.currentTime > 0
              ? ('watching' as WatchingStatus)
              : ('unwatched' as WatchingStatus),
          },
        };
      }
      return {
        ...ep,
        progress: savedProg,
      };
    });

    const watchedEpisodes = updatedEpisodes.filter((e) => e.progress.completed).length;
    const inProgressEpisode = updatedEpisodes
      .filter((e) => e.progress.currentTime > 0 && !e.progress.completed)
      .sort((a, b) => (b.progress.updatedAt || '').localeCompare(a.progress.updatedAt || ''))[0];
    const lastWatchedAt =
      inProgressEpisode?.progress.updatedAt ||
      updatedEpisodes
        .filter((e) => e.progress.updatedAt)
        .sort((a, b) => (b.progress.updatedAt || '').localeCompare(a.progress.updatedAt || ''))[0]
        ?.progress.updatedAt;

    const nextPoster = ov?.custom_poster || extMeta?.posterUrl || item.posterUrl;
    const nextCategory = ov?.manual_category || item.category;

    return {
      ...item,
      title: ov?.custom_title || extMeta?.title || item.title,
      synopsis: ov?.custom_synopsis || extMeta?.synopsis || item.synopsis,
      category: nextCategory,
      isManualCategory: Boolean(ov?.manual_category) || item.isManualCategory,
      posterUrl: nextPoster,
      bannerUrl: extMeta?.bannerUrl || nextPoster || item.bannerUrl,
      customPosterUrl: ov?.custom_poster || item.customPosterUrl || '',
      releaseYear: extMeta?.releaseYear || item.releaseYear,
      genres: extMeta?.genres?.length ? extMeta.genres : item.genres,
      ratingScore: extMeta?.ratingScore ?? item.ratingScore,
      studioOrNetwork: extMeta?.studioOrNetwork || item.studioOrNetwork,
      metadataProvider: extMeta?.provider || item.metadataProvider,
      externalId: extMeta?.externalId || item.externalId,
      isFavorite: ov ? Boolean(ov.is_favorite) : item.isFavorite,
      episodes: updatedEpisodes,
      watchedEpisodes,
      inProgressEpisode,
      lastWatchedAt,
    };
  });
}

export function migrateLegacyJsonStateIfNeeded(defaultSampleRoot: string): void {
  if (globalForSqlite.__cinevaultSqliteInitialized) return;
  globalForSqlite.__cinevaultSqliteInitialized = true;

  const db = getDb();
  const folderCount = (
    db.prepare('SELECT COUNT(*) as c FROM media_folders').get() as { c: number }
  ).c;

  if (folderCount > 0) {
    return;
  }

  const now = new Date().toISOString();

  if (fs.existsSync(LEGACY_JSON_STATE_PATH)) {
    try {
      const raw = fs.readFileSync(LEGACY_JSON_STATE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      const rootPath =
        parsed.rootPath && typeof parsed.rootPath === 'string'
          ? parsed.rootPath
          : defaultSampleRoot;

      db.prepare(
        'INSERT OR IGNORE INTO media_folders (id, path, label, source_type, is_active, last_scanned_at) VALUES (?, ?, ?, ?, 1, ?)'
      ).run('primary', rootPath, path.basename(rootPath) || rootPath, 'server', now);

      // Migrate overrides
      const allMediaIds = new Set<string>([
        ...Object.keys(parsed.favorites || {}),
        ...Object.keys(parsed.manualCategories || {}),
        ...Object.keys(parsed.customTitles || {}),
        ...Object.keys(parsed.customSynopses || {}),
        ...Object.keys(parsed.customPosters || {}),
        ...Object.keys(parsed.externalMetadataCache || {}),
      ]);

      for (const mediaId of allMediaIds) {
        const isFav = parsed.favorites?.[mediaId] ? 1 : 0;
        const manCat = parsed.manualCategories?.[mediaId] || null;
        const cTitle = parsed.customTitles?.[mediaId] || null;
        const cSyn = parsed.customSynopses?.[mediaId] || null;
        const cPoster = parsed.customPosters?.[mediaId] || null;
        const extMeta = parsed.externalMetadataCache?.[mediaId]
          ? JSON.stringify(parsed.externalMetadataCache[mediaId])
          : null;

        db.prepare(
          `INSERT OR REPLACE INTO media_overrides (
            media_id, is_favorite, manual_category, custom_title, custom_synopsis, custom_poster, external_metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(mediaId, isFav, manCat, cTitle, cSyn, cPoster, extMeta);
      }

      // Migrate episode progress
      const epProg = parsed.episodeProgress || {};
      for (const [epId, prog] of Object.entries(epProg)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = prog as any;
        const completed = Boolean(p.completed);
        const currentTime = Number(p.currentTime) || 0;
        const duration = Number(p.duration) || 1440;
        const status: WatchingStatus = completed
          ? 'completed'
          : currentTime > 0
          ? 'watching'
          : 'unwatched';
        db.prepare(
          `INSERT OR REPLACE INTO episode_progress (
            episode_id, status, current_time, duration, completed, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(epId, status, currentTime, duration, completed ? 1 : 0, p.updatedAt || now);
      }
      return;
    } catch (err) {
      console.error('Error migrating legacy JSON state to SQLite:', err);
    }
  }

  // Seed default folder
  db.prepare(
    'INSERT OR IGNORE INTO media_folders (id, path, label, source_type, is_active, last_scanned_at) VALUES (?, ?, ?, ?, 1, ?)'
  ).run('primary', defaultSampleRoot, 'Sample Media Library', 'server', now);
}
