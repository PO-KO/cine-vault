import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { NextRequest } from 'next/server';
import {
  ConfiguredMediaFolder,
  ExternalMetadataMatch,
  LanNetworkInfo,
  MediaCategory,
  MediaItem,
  WatchingStatus,
} from '../types/media';
import { autoResolveMetadataForTitle } from './metadataProviders';
import {
  clearWatchHistory,
  createLanSessionToken,
  getAllEpisodeProgressFromDb,
  getClientCatalogSnapshotFromDb,
  getDb,
  getLanSecurityConfig,
  getUserPreferences,
  getWatchHistory,
  hashPin,
  migrateLegacyJsonStateIfNeeded,
  saveClientCatalogSnapshotToDb as saveClientCatalogSnapshotInSqlite,
  saveLanSecurityConfig,
  saveUserPreferences,
  SQLITE_DB_PATH,
  upsertEpisodeProgressInDb as upsertEpisodeProgressInSqlite,
} from './sqliteDb';

export {
  clearWatchHistory,
  getUserPreferences,
  getWatchHistory,
  saveUserPreferences,
};

const WORKSPACE_ROOT = process.cwd();
export const DEFAULT_SAMPLE_ROOT = path.resolve(WORKSPACE_ROOT, 'local-media');
export const STATE_FILE_PATH = path.resolve(WORKSPACE_ROOT, 'media-library-state.json');

export const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.mkv',
  '.avi',
  '.mov',
  '.m4v',
  '.ts',
  '.m2ts',
  '.mts',
  '.flv',
  '.wmv',
  '.mpg',
  '.mpeg',
  '.ogm',
  '.ogv',
  '.rmvb',
  '.3gp',
  '.divx',
  '.vob',
]);
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa']);
const IMAGE_NAMES = [
  'poster.svg',
  'poster.jpg',
  'poster.jpeg',
  'poster.png',
  'cover.svg',
  'cover.jpg',
  'cover.png',
  'folder.jpg',
];

export interface PersistedState {
  rootPath: string;
  additionalFolders?: string[];
  favorites: Record<string, boolean>;
  manualCategories: Record<string, MediaCategory>;
  customTitles: Record<string, string>;
  customSynopses: Record<string, string>;
  customPosters: Record<string, string>;
  externalMetadataCache: Record<string, ExternalMetadataMatch>;
  episodeProgress: Record<
    string,
    {
      status?: WatchingStatus;
      currentTime: number;
      duration: number;
      completed: boolean;
      updatedAt: string;
    }
  >;
}

export interface IndexedEpisodeLookup {
  fullPath: string;
  relativePath: string;
  containerFormat: string;
  isSampleSynthetic: boolean;
  subtitles: {
    id: string;
    label: string;
    language: string;
    format: 'srt' | 'vtt' | 'embedded';
    fullPath?: string;
    streamIndex?: number;
  }[];
}

export function hashId(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 12);
}

let initialized = false;
let ffmpegAvailable = false;
let ffmpegVersion = '';
let lastScanTimestamp = new Date().toISOString();
const episodePathRegistry = new Map<string, IndexedEpisodeLookup>();
const artworkPathRegistry = new Map<string, string>();

function checkFfmpeg(): Promise<void> {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], { timeout: 3000 }, (err, stdout) => {
      if (!err && stdout) {
        ffmpegAvailable = true;
        ffmpegVersion = stdout.split('\n')[0]?.trim() || 'ffmpeg detected';
      } else {
        ffmpegAvailable = false;
        ffmpegVersion = '';
      }
      resolve();
    });
  });
}

export function bootstrapSampleMediaDirectory(): void {
  if (!fs.existsSync(DEFAULT_SAMPLE_ROOT)) {
    fs.mkdirSync(DEFAULT_SAMPLE_ROOT, { recursive: true });
  }

  const samplePlaceholderHeader = Buffer.from('CINEVAULT_SYNTHETIC_MEDIA_V1');

  const writeSampleFile = (relPath: string, content: Buffer | string) => {
    const full = path.join(DEFAULT_SAMPLE_ROOT, relPath);
    const dir = path.dirname(full);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(full)) {
      fs.writeFileSync(full, content);
    }
  };

  // 1. Anime Series (AniList): Sousou no Frieren [Anime]
  writeSampleFile(
    'Sousou no Frieren [Anime]/Season 1/Sousou no Frieren - S01E01 - The Journey Begins [1080p].mp4',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Sousou no Frieren [Anime]/Season 1/Sousou no Frieren - S01E01 - The Journey Begins [1080p].en.srt',
    `1
00:00:00,500 --> 00:00:05,000
The Demon King has been defeated, and the victorious hero party returns home.

2
00:00:05,400 --> 00:00:10,500
Fifty years pass in the blink of an eye for an elven mage.

3
00:00:11,000 --> 00:00:16,500
I want to understand the humans I traveled alongside before their memories fade.`
  );
  writeSampleFile(
    'Sousou no Frieren [Anime]/Season 1/Sousou no Frieren - S01E01 - The Journey Begins [1080p].ja.srt',
    `1
00:00:00,500 --> 00:00:05,000
魔王を倒した勇者一行が王都へと凱旋した。

2
00:00:05,400 --> 00:00:10,500
エルフであるフリーレンにとって、50年の歳月はほんの一瞬だった。`
  );
  writeSampleFile(
    'Sousou no Frieren [Anime]/Season 1/Sousou no Frieren - S01E02 - It Did Not Have to Be Magic [1080p].mp4',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Sousou no Frieren [Anime]/Season 1/Sousou no Frieren - S01E03 - Killing Magic [1080p].mkv',
    samplePlaceholderHeader
  );
  const emptySeasonDir = path.join(DEFAULT_SAMPLE_ROOT, 'Sousou no Frieren [Anime]', 'Season 2');
  if (!fs.existsSync(emptySeasonDir)) {
    fs.mkdirSync(emptySeasonDir, { recursive: true });
  }

  // 2. Anime Series (AniList): Cowboy Bebop [Anime]
  writeSampleFile(
    'Cowboy Bebop [Anime]/Season 1/Cowboy Bebop - S01E01 - Asteroid Blues [1080p].mkv',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Cowboy Bebop [Anime]/Season 1/Cowboy Bebop - S01E01 - Asteroid Blues [1080p].en.srt',
    `1
00:00:00,500 --> 00:00:05,000
[Bebop Deck — 2071 AD]
Three, two, one... let's jam.

2
00:00:05,500 --> 00:00:11,000
Jet, the bounty on Tijuana asteroid just doubled.`
  );
  writeSampleFile(
    'Cowboy Bebop [Anime]/Season 1/Cowboy Bebop - S01E02 - Stray Dog Strut [1080p].mp4',
    samplePlaceholderHeader
  );

  // 3. Anime Film (AniList): Spirited Away (2001) [Anime]
  writeSampleFile(
    'Spirited Away (2001) [Anime]/Spirited Away (2001) [1080p BluRay].mp4',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Spirited Away (2001) [Anime]/Spirited Away (2001) [1080p BluRay].en.vtt',
    `WEBVTT

00:00:00.500 --> 00:00:05.500
Look, Chihiro—there's an old red tunnel at the end of the forest path.

00:00:06.000 --> 00:00:12.000
Once the lanterns light up across the river, the bathhouse spirits awaken.`
  );

  // 4. TV Show (TMDB): Severance
  writeSampleFile(
    'Severance/Season 1/Severance - S01E01 - Good News About Hell [1080p].mp4',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Severance/Season 1/Severance - S01E01 - Good News About Hell [1080p].en.srt',
    `1
00:00:00,500 --> 00:00:05,200
[Lumon Industries — Macrodata Refinement Floor]
Who are you? Please state your first name and home town.

2
00:00:05,600 --> 00:00:11,000
Your work memories have been surgically separated from your personal life.`
  );
  writeSampleFile(
    'Severance/Season 1/Severance - S01E02 - Half Loop [1080p].mp4',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Severance/Season 2/Severance - S02E01 - Hello Ms Cobel [1080p].mkv',
    samplePlaceholderHeader
  );

  // 5. Movie (TMDB): Interstellar (2014)
  writeSampleFile(
    'Interstellar (2014)/Interstellar (2014) [4K Remux].mkv',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Interstellar (2014)/Interstellar (2014) [4K Remux].en.srt',
    `1
00:00:00,500 --> 00:00:05,000
[Endurance Orbital Dock — Saturn Approach]
We used to look up at the sky and wonder at our place in the stars.

2
00:00:05,500 --> 00:00:11,000
Do not go gentle into that good night.`
  );

  // 6. Movie (TMDB): Dune Part Two (2024)
  writeSampleFile(
    'Dune Part Two (2024)/Dune Part Two (2024) [1080p].mp4',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Dune Part Two (2024)/Dune Part Two (2024) [1080p].en.srt',
    `1
00:00:00,500 --> 00:00:05,500
[Arrakis Deep Desert — Sietch Tabr]
Walk without rhythm and we won't attract the worm.`
  );
}

export function loadState(): PersistedState {
  migrateLegacyJsonStateIfNeeded(DEFAULT_SAMPLE_ROOT);
  const db = getDb();

  const folderRows = db
    .prepare(
      `SELECT id, path, label, source_type, is_active, last_scanned_at FROM media_folders WHERE is_active = 1 ORDER BY CASE WHEN id = 'primary' THEN 0 ELSE 1 END, rowid ASC`
    )
    .all() as {
    id: string;
    path: string;
    label: string;
    source_type: string;
    is_active: number;
    last_scanned_at: string;
  }[];

  const primaryPath = folderRows[0]?.path || DEFAULT_SAMPLE_ROOT;
  const additionalFolders = folderRows.slice(1).map((f) => f.path);

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

  const favorites: Record<string, boolean> = {};
  const manualCategories: Record<string, MediaCategory> = {};
  const customTitles: Record<string, string> = {};
  const customSynopses: Record<string, string> = {};
  const customPosters: Record<string, string> = {};
  const externalMetadataCache: Record<string, ExternalMetadataMatch> = {};

  for (const r of overrideRows) {
    if (r.is_favorite) favorites[r.media_id] = true;
    if (r.manual_category) manualCategories[r.media_id] = r.manual_category;
    if (r.custom_title) customTitles[r.media_id] = r.custom_title;
    if (r.custom_synopsis) customSynopses[r.media_id] = r.custom_synopsis;
    if (r.custom_poster) customPosters[r.media_id] = r.custom_poster;
    if (r.external_metadata_json) {
      try {
        externalMetadataCache[r.media_id] = JSON.parse(r.external_metadata_json);
      } catch {}
    }
  }

  const episodeProgress = getAllEpisodeProgressFromDb();

  return {
    rootPath: primaryPath,
    additionalFolders,
    favorites,
    manualCategories,
    customTitles,
    customSynopses,
    customPosters,
    externalMetadataCache,
    episodeProgress,
  };
}

export function saveState(state: PersistedState): void {
  const db = getDb();
  const now = new Date().toISOString();

  // Update primary folder in SQLite
  db.prepare(
    `INSERT INTO media_folders (id, path, label, source_type, is_active, last_scanned_at)
     VALUES ('primary', ?, ?, 'server', 1, ?)
     ON CONFLICT(id) DO UPDATE SET
       path = excluded.path,
       label = excluded.label,
       last_scanned_at = excluded.last_scanned_at`
  ).run(state.rootPath, path.basename(state.rootPath) || state.rootPath, now);

  // Sync media_overrides
  const allMediaIds = new Set<string>([
    ...Object.keys(state.favorites || {}),
    ...Object.keys(state.manualCategories || {}),
    ...Object.keys(state.customTitles || {}),
    ...Object.keys(state.customSynopses || {}),
    ...Object.keys(state.customPosters || {}),
    ...Object.keys(state.externalMetadataCache || {}),
  ]);

  for (const mediaId of allMediaIds) {
    const isFav = state.favorites?.[mediaId] ? 1 : 0;
    const manCat = state.manualCategories?.[mediaId] || null;
    const cTitle = state.customTitles?.[mediaId] || null;
    const cSyn = state.customSynopses?.[mediaId] || null;
    const cPoster = state.customPosters?.[mediaId] || null;
    const extMeta = state.externalMetadataCache?.[mediaId]
      ? JSON.stringify(state.externalMetadataCache[mediaId])
      : null;

    db.prepare(
      `INSERT INTO media_overrides (
        media_id, is_favorite, manual_category, custom_title, custom_synopsis, custom_poster, external_metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(media_id) DO UPDATE SET
        is_favorite = excluded.is_favorite,
        manual_category = excluded.manual_category,
        custom_title = excluded.custom_title,
        custom_synopsis = excluded.custom_synopsis,
        custom_poster = excluded.custom_poster,
        external_metadata_json = excluded.external_metadata_json`
    ).run(mediaId, isFav, manCat, cTitle, cSyn, cPoster, extMeta);
  }

  // Sync episode_progress
  for (const [epId, prog] of Object.entries(state.episodeProgress || {})) {
    const completed = Boolean(prog.completed);
    const currentTime = Number(prog.currentTime) || 0;
    const duration = Number(prog.duration) || 1440;
    const status: WatchingStatus =
      prog.status || (completed ? 'completed' : currentTime > 0 ? 'watching' : 'unwatched');
    db.prepare(
      `INSERT INTO episode_progress (episode_id, status, current_time, duration, completed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(episode_id) DO UPDATE SET
         status = excluded.status,
         current_time = excluded.current_time,
         duration = excluded.duration,
         completed = excluded.completed,
         updated_at = excluded.updated_at`
    ).run(epId, status, currentTime, duration, completed ? 1 : 0, prog.updatedAt || now);
  }

  // Also mirror to JSON backup file
  try {
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch {}
}

export function addConfiguredServerFolder(folderPath: string): void {
  const db = getDb();
  const resolved = path.resolve(folderPath.trim());
  const id = `folder-${hashId(resolved)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO media_folders (id, path, label, source_type, is_active, last_scanned_at)
     VALUES (?, ?, ?, 'server', 1, ?)
     ON CONFLICT(path) DO UPDATE SET is_active = 1, last_scanned_at = excluded.last_scanned_at`
  ).run(id, resolved, path.basename(resolved) || resolved, now);
}

export function removeConfiguredServerFolder(folderIdOrPath: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM media_folders WHERE (id = ? OR path = ?) AND id != 'primary'`).run(
    folderIdOrPath,
    folderIdOrPath
  );
}

export function isPathAllowedInLibrary(targetFilePath: string, state: PersistedState): boolean {
  const resolvedFile = path.resolve(targetFilePath);
  const roots = [state.rootPath, ...(state.additionalFolders || []), DEFAULT_SAMPLE_ROOT];
  for (const r of roots) {
    if (!r) continue;
    const resolvedRoot = path.resolve(r);
    if (
      resolvedFile === resolvedRoot ||
      resolvedFile.startsWith(resolvedRoot + path.sep) ||
      resolvedFile.startsWith(resolvedRoot + '/')
    ) {
      return true;
    }
  }
  return false;
}

export function isRequestFromLocalhost(request: NextRequest): boolean {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const host = request.headers.get('host') || '';
  if (
    host.startsWith('localhost') ||
    host.startsWith('127.0.0.1') ||
    host.startsWith('[::1]')
  ) {
    if (!forwarded || forwarded.includes('127.0.0.1') || forwarded.includes('::1')) {
      return true;
    }
  }
  return false;
}

export function verifyRequestLanAccess(request: NextRequest): {
  allowed: boolean;
  isLocalhost: boolean;
  pinEnabled: boolean;
} {
  const sec = getLanSecurityConfig();
  const isLocal = isRequestFromLocalhost(request);
  if (!sec.pinEnabled || !sec.pinHash) {
    return { allowed: true, isLocalhost: isLocal, pinEnabled: false };
  }
  if (isLocal) {
    return { allowed: true, isLocalhost: true, pinEnabled: true };
  }
  const expectedToken = createLanSessionToken(sec.pinHash);
  const cookieToken = (request.cookies.get('cinevault_lan_auth')?.value || '').trim();
  const headerToken = (request.headers.get('x-cinevault-pin-token') || '').trim();
  const queryToken = (request.nextUrl.searchParams.get('lanToken') || '').trim();

  const matchesToken = (val: string) =>
    Boolean(val) &&
    (val === expectedToken || val === sec.pinHash || hashPin(val) === sec.pinHash);

  const allowed =
    matchesToken(cookieToken) || matchesToken(headerToken) || matchesToken(queryToken);

  return { allowed, isLocalhost: false, pinEnabled: true };
}

export function configureLanPinInDb(enabled: boolean, pin?: string): void {
  if (!enabled) {
    saveLanSecurityConfig({ pinEnabled: false, pinHash: '' });
    return;
  }
  const cleanPin = (pin || '').trim();
  if (!cleanPin) return;
  saveLanSecurityConfig({
    pinEnabled: true,
    pinHash: hashPin(cleanPin),
  });
}

export function verifyLanPinInDb(pin: string): boolean {
  const sec = getLanSecurityConfig();
  if (!sec.pinEnabled || !sec.pinHash) return true;
  const cleanPin = (pin || '').trim();
  if (!cleanPin) return false;
  return hashPin(cleanPin) === sec.pinHash || cleanPin === sec.pinHash;
}

export function getHydratedClientCatalogSnapshot(_state?: PersistedState) {
  return getClientCatalogSnapshotFromDb();
}

export function saveClientCatalogSnapshotToDb(
  params: {
    rootFolderName: string;
    items: MediaItem[];
    totalVideoFiles: number;
  },
  _state?: PersistedState
) {
  saveClientCatalogSnapshotInSqlite(params);
  return getClientCatalogSnapshotFromDb();
}

export function upsertEpisodeProgressInDb(
  episodeId: string,
  payload: {
    currentTime?: number;
    duration?: number;
    completed?: boolean;
    mediaId?: string;
    mediaTitle?: string;
    episodeTitle?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    posterUrl?: string;
  },
  state?: PersistedState
) {
  const existing = state?.episodeProgress?.[episodeId];
  const progress = upsertEpisodeProgressInSqlite({
    episodeId,
    mediaId: payload.mediaId,
    currentTime:
      typeof payload.currentTime === 'number'
        ? payload.currentTime
        : existing?.currentTime || 0,
    duration:
      typeof payload.duration === 'number' && payload.duration > 0
        ? payload.duration
        : existing?.duration || 1440,
    completed: payload.completed,
    mediaTitle: payload.mediaTitle,
    episodeTitle: payload.episodeTitle,
    seasonNumber: payload.seasonNumber,
    episodeNumber: payload.episodeNumber,
  });

  if (state) {
    state.episodeProgress[episodeId] = progress;
  }

  return progress;
}

export function getLanNetworkInfo(request?: NextRequest): LanNetworkInfo {
  const nets = os.networkInterfaces();
  const lanUrls: string[] = [];
  const port = Number(process.env.PORT) || 3000;

  for (const name of Object.keys(nets)) {
    const netList = nets[name];
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal) {
        lanUrls.push(`http://${net.address}:${port}`);
      }
    }
  }

  if (lanUrls.length === 0) {
    lanUrls.push(`http://localhost:${port}`);
  }

  const access = request
    ? verifyRequestLanAccess(request)
    : { allowed: true, isLocalhost: true, pinEnabled: getLanSecurityConfig().pinEnabled };

  return {
    hostname: os.hostname(),
    port,
    lanUrls,
    isLocalhostClient: access.isLocalhost,
    pinProtectionEnabled: access.pinEnabled,
    isAuthorizedClient: access.allowed,
    firewallCommandWindows: `New-NetFirewallRule -DisplayName "CineVault Local Media Server (TCP ${port})" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -Profile Private`,
  };
}

export async function ensureInitialized(): Promise<PersistedState> {
  if (!initialized) {
    bootstrapSampleMediaDirectory();
    await checkFfmpeg();
    initialized = true;
  }
  return loadState();
}

function cleanDisplayTitle(rawName: string): {
  title: string;
  year: string;
  autoCategoryHint: MediaCategory | null;
} {
  const withoutExt = rawName.replace(
    /\.(mp4|webm|mkv|avi|mov|m4v|ts|m2ts|mts|flv|wmv|mpg|mpeg|ogm|ogv|rmvb|3gp|divx|vob)$/i,
    ''
  );
  let autoCategoryHint: MediaCategory | null = null;
  if (
    /\[anime\]|\banime\b|subsplease|erai-raws|horriblesubs|judas|ember|nyaa|dual[\s._-]*audio|10bit|bdrip/i.test(
      withoutExt
    )
  ) {
    autoCategoryHint = 'anime';
  }
  const leadingBracket = withoutExt.match(/^\[([^\]]+)\]/);
  if (
    leadingBracket &&
    !/^(1080p|720p|2160p|4k|480p|bluray|web-dl|webrip)$/i.test(leadingBracket[1].trim())
  ) {
    autoCategoryHint = 'anime';
  }

  const yearMatch =
    withoutExt.match(/\((\d{4})\)/) || withoutExt.match(/\b(19\d{2}|20[0-2]\d)\b/);
  const year = yearMatch ? yearMatch[1] : '2024';

  let cleaned = withoutExt
    .replace(/\[.*?\]/g, ' ')
    .replace(/\{.*?\}/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const seSplit = cleaned.match(
    /^(.*?)\s*(?:\bS\d{1,2}\s*E\d{1,3}\b|\bS\d{1,2}\b|\bSeason\s*\d+\b|\bEpisode\s*\d+\b|\bEp\.?\s*\d+\b|[-–~]\s*\d{1,4}\b)/i
  );
  if (seSplit && seSplit[1].trim().length >= 2) {
    cleaned = seSplit[1].trim();
  }

  const qualitySplit = cleaned.match(
    /^(.*?)\s*\b(1080p|720p|2160p|4k|bluray|bdrip|web-dl|webrip|x264|x265|hevc|10bit|aac|flac|dual\s*audio|complete|batch)\b/i
  );
  if (qualitySplit && qualitySplit[1].trim().length >= 2) {
    cleaned = qualitySplit[1].trim();
  }

  cleaned = cleaned.replace(/[-–:~\s]+$/, '').replace(/\s+/g, ' ').trim();
  return { title: cleaned || rawName, year, autoCategoryHint };
}

function parseSeasonEpisode(
  fileName: string,
  parentDirName: string,
  folderTitle: string,
  fallbackIndex: number
): { season: number; episode: number; cleanEpTitle: string } {
  const seMatch = fileName.match(/S(\d{1,2})E(\d{1,3})/i) || fileName.match(/(\d{1,2})x(\d{1,3})/i);
  let season = 1;
  let episode = fallbackIndex;

  const parentSeasonMatch = parentDirName.match(/Season\s*(\d{1,2})/i);
  if (parentSeasonMatch) {
    season = parseInt(parentSeasonMatch[1], 10);
  }

  if (seMatch) {
    season = parseInt(seMatch[1], 10);
    episode = parseInt(seMatch[2], 10);
  } else {
    const epOnly = fileName.match(/Episode\s*(\d{1,3})/i) || fileName.match(/\bEp?\s*(\d{1,3})\b/i);
    if (epOnly) {
      episode = parseInt(epOnly[1], 10);
    }
  }

  return {
    season,
    episode,
    cleanEpTitle: `${folderTitle} — Episode ${episode}`,
  };
}

function pickVisualTheme(
  title: string
): 'cyber_anime' | 'fantasy_anime' | 'nordic_mystery' | 'scifi_cosmos' | 'kyoto_doc' | 'studio_reel' {
  const lower = title.toLowerCase();
  if (lower.includes('cowboy') || lower.includes('bebop') || lower.includes('chrono')) return 'cyber_anime';
  if (lower.includes('frieren') || lower.includes('spirited') || lower.includes('aethelgard')) return 'fantasy_anime';
  if (lower.includes('severance') || lower.includes('harbor')) return 'nordic_mystery';
  if (lower.includes('interstellar') || lower.includes('dune') || lower.includes('solaris')) return 'scifi_cosmos';
  if (lower.includes('kyoto')) return 'kyoto_doc';
  return 'studio_reel';
}

function collectVideoFilesRecursive(dirPath: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectVideoFilesRecursive(full));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (VIDEO_EXTENSIONS.has(ext)) {
        results.push(full);
      }
    }
  }
  return results;
}

function findMatchingSubtitlesForVideo(videoFullPath: string, rootPath: string, containerFormat: string) {
  const dir = path.dirname(videoFullPath);
  const baseName = path.basename(videoFullPath, path.extname(videoFullPath));
  const subs: IndexedEpisodeLookup['subtitles'] = [];

  try {
    const siblings = fs.readdirSync(dir, { withFileTypes: true });
    for (const sib of siblings) {
      if (!sib.isFile()) continue;
      const ext = path.extname(sib.name).toLowerCase();
      if (!SUBTITLE_EXTENSIONS.has(ext)) continue;

      const sibWithoutExt = path.basename(sib.name, ext);
      if (sibWithoutExt === baseName || sibWithoutExt.startsWith(baseName + '.')) {
        const langSuffix = sibWithoutExt.slice(baseName.length).replace(/^\./, '').toLowerCase();
        const langMap: Record<string, { label: string; code: string }> = {
          en: { label: 'English (External)', code: 'en' },
          eng: { label: 'English (External)', code: 'en' },
          ja: { label: 'Japanese (External)', code: 'ja' },
          jpn: { label: 'Japanese (External)', code: 'ja' },
          fr: { label: 'French (External)', code: 'fr' },
          es: { label: 'Spanish (External)', code: 'es' },
        };
        const langInfo = langMap[langSuffix] || {
          label: langSuffix
            ? `${langSuffix.toUpperCase()} (${ext.slice(1).toUpperCase()})`
            : `External (${ext.slice(1).toUpperCase()})`,
          code: langSuffix || 'en',
        };
        const subFullPath = path.join(dir, sib.name);
        const subId = hashId(path.relative(rootPath, subFullPath));
        subs.push({
          id: subId,
          label: `${langInfo.label} · ${ext.slice(1).toUpperCase()}`,
          language: langInfo.code,
          format: ext === '.srt' ? 'srt' : 'vtt',
          fullPath: subFullPath,
        });
      }
    }
  } catch {
    // ignore
  }

  if (containerFormat === 'mkv' && subs.length === 0) {
    const embId = hashId(path.relative(rootPath, videoFullPath) + ':embedded:0');
    subs.push({
      id: embId,
      label: 'English (Embedded ASS/SRT Track)',
      language: 'en',
      format: 'embedded',
      fullPath: videoFullPath,
      streamIndex: 0,
    });
  }

  return subs;
}

function checkIsSyntheticFile(fullPath: string): boolean {
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size <= 128) {
      const buf = fs.readFileSync(fullPath);
      return buf.toString('utf-8').startsWith('CINEVAULT_SYNTHETIC_MEDIA_V1');
    }
  } catch {
    return false;
  }
  return false;
}

function collectSeasonNumbersRecursive(dirPath: string): number[] {
  const seasons = new Set<number>();
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || !entry.isDirectory()) continue;
    const match =
      entry.name.match(/^(?:season|series|part|cour)\s*(\d{1,2})\b/i) ||
      entry.name.match(/^s(\d{1,2})\b/i);
    if (match) {
      seasons.add(parseInt(match[1], 10));
    }
    const subSeasons = collectSeasonNumbersRecursive(path.join(dirPath, entry.name));
    for (const s of subSeasons) {
      seasons.add(s);
    }
  }

  return Array.from(seasons).sort((a, b) => a - b);
}

export function scanLibrary(state: PersistedState): {
  items: MediaItem[];
  totalFilesScanned: number;
  folderSummaries: ConfiguredMediaFolder[];
} {
  episodePathRegistry.clear();
  artworkPathRegistry.clear();
  lastScanTimestamp = new Date().toISOString();

  const allRootPaths = Array.from(
    new Set([state.rootPath, ...(state.additionalFolders || [])].filter(Boolean))
  );

  const items: MediaItem[] = [];
  let totalFilesScanned = 0;
  const folderSummaries: ConfiguredMediaFolder[] = [];

  for (let rootIdx = 0; rootIdx < allRootPaths.length; rootIdx++) {
    const rootPath = allRootPaths[rootIdx];
    const folderId = rootIdx === 0 ? 'primary' : `folder-${hashId(rootPath)}`;
    const exists = fs.existsSync(rootPath);

    if (!exists) {
      folderSummaries.push({
        id: folderId,
        path: rootPath,
        label: path.basename(rootPath) || rootPath,
        sourceType: 'server',
        available: false,
        videoCount: 0,
        lastScannedAt: lastScanTimestamp,
      });
      continue;
    }

    let topEntries: fs.Dirent[] = [];
    try {
      topEntries = fs.readdirSync(rootPath, { withFileTypes: true });
    } catch {
      folderSummaries.push({
        id: folderId,
        path: rootPath,
        label: path.basename(rootPath) || rootPath,
        sourceType: 'server',
        available: false,
        videoCount: 0,
        lastScannedAt: lastScanTimestamp,
      });
      continue;
    }

    let rootVideoCount = 0;

    for (const entry of topEntries) {
      if (entry.name.startsWith('.') || !entry.isDirectory()) continue;
      const fullEntryPath = path.join(rootPath, entry.name);
      const relEntryPath = path.relative(rootPath, fullEntryPath);
      const mediaId =
        rootIdx === 0 ? hashId(relEntryPath) : hashId(`${rootPath}:${relEntryPath}`);

      const videoFiles = collectVideoFilesRecursive(fullEntryPath);
      const discoveredSeasons = collectSeasonNumbersRecursive(fullEntryPath);

      videoFiles.sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      );
      totalFilesScanned += videoFiles.length;
      rootVideoCount += videoFiles.length;

      const { title: parsedTitle, year, autoCategoryHint } = cleanDisplayTitle(entry.name);
      const cachedMeta = state.externalMetadataCache?.[mediaId];
      const displayTitle = state.customTitles[mediaId] || cachedMeta?.title || parsedTitle;
      const visualTheme = pickVisualTheme(parsedTitle);

      const hasSeasonFolder =
        discoveredSeasons.length > 0 ||
        videoFiles.some((vf) =>
          /season\s*\d+/i.test(path.dirname(path.relative(fullEntryPath, vf)))
        );
      const autoType: 'movie' | 'series' =
        videoFiles.length !== 1 || hasSeasonFolder || autoCategoryHint === 'anime'
          ? 'series'
          : 'movie';

      let defaultCategory: MediaCategory = autoType === 'series' ? 'tv' : 'movies';
      if (
        autoCategoryHint === 'anime' ||
        cachedMeta?.provider === 'anilist' ||
        cachedMeta?.mediaType === 'ANIME' ||
        cachedMeta?.isAnimeCandidate
      ) {
        defaultCategory = 'anime';
      } else if (autoCategoryHint) {
        defaultCategory = autoCategoryHint;
      }
      const isManualCategory = Boolean(state.manualCategories[mediaId]);
      const category: MediaCategory = state.manualCategories[mediaId] || defaultCategory;

      let posterUrl = '';
      for (const imgName of IMAGE_NAMES) {
        const candidate = path.join(/*turbopackIgnore: true*/ fullEntryPath, imgName);
        if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
          artworkPathRegistry.set(mediaId, candidate);
          posterUrl = `/api/artwork/${mediaId}`;
          break;
        }
      }
      if (cachedMeta?.posterUrl) {
        posterUrl = cachedMeta.posterUrl;
      }
      if (state.customPosters[mediaId]) {
        posterUrl = state.customPosters[mediaId];
      }

      const episodes = videoFiles.map((vf, idx) => {
        const relEpPath = path.relative(rootPath, vf);
        const epId = rootIdx === 0 ? hashId(relEpPath) : hashId(`${rootPath}:${relEpPath}`);
        const ext = path.extname(vf).toLowerCase().slice(1) as
          | 'mp4'
          | 'webm'
          | 'mkv'
          | 'avi'
          | 'mov';
        const parentDirName = path.basename(path.dirname(vf));
        const { season, episode, cleanEpTitle } =
          autoType === 'series'
            ? parseSeasonEpisode(path.basename(vf), parentDirName, displayTitle, idx + 1)
            : { season: 1, episode: 1, cleanEpTitle: displayTitle };

        const isSynthetic = checkIsSyntheticFile(vf);
        let statSize = 0;
        try {
          statSize = fs.statSync(vf).size;
        } catch {
          statSize = 0;
        }

        const estimatedDurationSec = autoType === 'movie' ? 9840 : 1440;
        const rawSaved = state.episodeProgress[epId];
        const savedProgress = rawSaved
          ? {
              status:
                rawSaved.status ||
                (rawSaved.completed
                  ? ('completed' as WatchingStatus)
                  : rawSaved.currentTime > 0
                  ? ('watching' as WatchingStatus)
                  : ('unwatched' as WatchingStatus)),
              currentTime: rawSaved.currentTime,
              duration: rawSaved.duration,
              completed: rawSaved.completed,
              updatedAt: rawSaved.updatedAt,
            }
          : {
              status: 'unwatched' as WatchingStatus,
              currentTime: 0,
              duration: estimatedDurationSec,
              completed: false,
              updatedAt: '',
            };

        const matchedSubs = findMatchingSubtitlesForVideo(vf, rootPath, ext);
        episodePathRegistry.set(epId, {
          fullPath: vf,
          relativePath: relEpPath,
          containerFormat: ext,
          isSampleSynthetic: isSynthetic,
          subtitles: matchedSubs,
        });

        const audioTracks =
          category === 'anime' || ext === 'mkv'
            ? [
                {
                  id: 'audio-0',
                  index: 0,
                  label: 'Japanese (Original 2.0 AAC)',
                  language: 'ja',
                  codec: 'AAC',
                  channels: '2.0 Stereo',
                },
                {
                  id: 'audio-1',
                  index: 1,
                  label: 'English (Dubbed 5.1 EAC3)',
                  language: 'en',
                  codec: 'EAC3',
                  channels: '5.1 Surround',
                },
              ]
            : [
                {
                  id: 'audio-0',
                  index: 0,
                  label: 'Original Audio (Stereo AAC)',
                  language: 'en',
                  codec: 'AAC',
                  channels: '2.0 Stereo',
                },
              ];

        const resolutionLabel = /4k|2160p/i.test(vf) ? '4K UHD' : '1080p FHD';

        return {
          id: epId,
          mediaId,
          title: cleanEpTitle,
          seasonNumber: season,
          episodeNumber: episode,
          fileName: path.basename(vf),
          relativePath: relEpPath,
          containerFormat: ext,
          fileSizeBytes: isSynthetic
            ? autoType === 'movie'
              ? 4_280_000_000
              : 840_000_000
            : statSize,
          estimatedDurationSec,
          resolutionLabel,
          requiresRemux: ext === 'mkv' || ext === 'avi',
          isSampleSynthetic: isSynthetic,
          visualTheme,
          subtitles: matchedSubs.map(({ id, label, language, format, streamIndex }) => ({
            id,
            label,
            language,
            format,
            streamIndex,
          })),
          audioTracks,
          progress: savedProgress,
        };
      });

      const allSeasonNumbers = Array.from(
        new Set([...discoveredSeasons, ...episodes.map((e) => e.seasonNumber)])
      ).sort((a, b) => a - b);

      const watchedEpisodes = episodes.filter((e) => e.progress.completed).length;
      const inProgressCandidates = episodes
        .filter((e) => e.progress.currentTime > 0 && !e.progress.completed)
        .sort((a, b) => (b.progress.updatedAt || '').localeCompare(a.progress.updatedAt || ''));

      const inProgressEpisode = inProgressCandidates[0];
      const lastWatchedAt =
        inProgressEpisode?.progress.updatedAt ||
        episodes
          .filter((e) => e.progress.updatedAt)
          .sort((a, b) => (b.progress.updatedAt || '').localeCompare(a.progress.updatedAt || ''))[0]
          ?.progress.updatedAt;

      const defaultSynopsis =
        cachedMeta?.synopsis ||
        (episodes.length === 0
          ? `Empty media folder "${relEntryPath}" (0 video files).`
          : `Local ${autoType === 'series' ? 'multi-episode series' : 'video file'} located in "${relEntryPath}" (${
              episodes.length
            } ${episodes.length === 1 ? 'file' : 'episodes'}).`);

      items.push({
        id: mediaId,
        folderName: entry.name,
        relativePath: relEntryPath,
        title: displayTitle,
        originalTitle: parsedTitle,
        synopsis: state.customSynopses[mediaId] || defaultSynopsis,
        releaseYear: cachedMeta?.releaseYear || year,
        autoType,
        category,
        isManualCategory,
        posterUrl,
        bannerUrl: cachedMeta?.bannerUrl || posterUrl,
        customPosterUrl: state.customPosters[mediaId] || '',
        genres:
          cachedMeta?.genres || [
            category === 'anime' ? 'Anime' : category === 'tv' ? 'TV Series' : 'Movie',
          ],
        ratingScore: cachedMeta?.ratingScore,
        studioOrNetwork: cachedMeta?.studioOrNetwork,
        metadataProvider: cachedMeta?.provider || 'local',
        externalId: cachedMeta?.externalId,
        isFavorite: Boolean(state.favorites[mediaId]),
        episodes,
        seasons: allSeasonNumbers,
        totalEpisodes: episodes.length,
        watchedEpisodes,
        inProgressEpisode,
        lastWatchedAt,
        sourceFolderPath: rootPath,
      });
    }

    folderSummaries.push({
      id: folderId,
      path: rootPath,
      label: path.basename(rootPath) || rootPath,
      sourceType: 'server',
      available: true,
      videoCount: rootVideoCount,
      itemCount: rootVideoCount,
      lastScannedAt: lastScanTimestamp,
    });
  }

  return { items, totalFilesScanned, folderSummaries };
}

export async function scanLibraryWithMetadata(state: PersistedState) {
  const initialScan = scanLibrary(state);
  let stateUpdated = false;

  await Promise.all(
    initialScan.items.map(async (item) => {
      if (item.category === 'other') return;
      const existingCache = state.externalMetadataCache?.[item.id];
      if (existingCache && existingCache.posterUrl) return;

      const resolved = await autoResolveMetadataForTitle(item.originalTitle, item.category);
      if (resolved) {
        if (!state.externalMetadataCache) state.externalMetadataCache = {};
        state.externalMetadataCache[item.id] = resolved;
        stateUpdated = true;
      }
    })
  );

  if (stateUpdated) {
    saveState(state);
    return scanLibrary(state);
  }

  return initialScan;
}

export function buildCapabilities(
  state: PersistedState,
  totalFilesScanned: number,
  folderSummaries?: ConfiguredMediaFolder[]
) {
  const tmdbKey = (process.env.TMDB_API_KEY || '').trim();
  return {
    rootPath: state.rootPath,
    configuredFolders:
      folderSummaries || [
        {
          id: 'primary',
          path: state.rootPath,
          label: path.basename(state.rootPath) || state.rootPath,
          sourceType: 'server',
          available: fs.existsSync(state.rootPath),
          videoCount: totalFilesScanned,
          lastScannedAt: lastScanTimestamp,
        },
      ],
    defaultSamplePath: DEFAULT_SAMPLE_ROOT,
    ffmpegAvailable,
    ffmpegVersion,
    tmdbConfigured: Boolean(tmdbKey && tmdbKey !== 'MY_TMDB_API_KEY'),
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    hostname: os.hostname(),
    supportedContainers: ['mp4', 'webm', 'mkv', 'avi', 'mov'],
    lastScannedAt: lastScanTimestamp,
    totalFilesScanned,
    sqlitePath: SQLITE_DB_PATH,
  };
}

export function getEpisodeEntry(
  episodeId: string,
  state: PersistedState
): IndexedEpisodeLookup | undefined {
  if (!episodePathRegistry.has(episodeId)) {
    scanLibrary(state);
  }
  return episodePathRegistry.get(episodeId);
}

export function getArtworkFilePath(mediaId: string, state: PersistedState): string | undefined {
  if (!artworkPathRegistry.has(mediaId)) {
    scanLibrary(state);
  }
  return artworkPathRegistry.get(mediaId);
}

export function isFfmpegAvailable(): boolean {
  return ffmpegAvailable;
}

export function convertSrtToVtt(srtContent: string): string {
  const normalized = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const vttBody = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${vttBody}\n`;
}
