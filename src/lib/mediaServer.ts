import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { ExternalMetadataMatch, MediaCategory, MediaItem } from '../types/media';
import { autoResolveMetadataForTitle } from './metadataProviders';

const WORKSPACE_ROOT = process.cwd();
export const DEFAULT_SAMPLE_ROOT = path.resolve(WORKSPACE_ROOT, 'local-media');
export const STATE_FILE_PATH = path.resolve(WORKSPACE_ROOT, 'media-library-state.json');

export const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.avi', '.mov']);
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt']);
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
  favorites: Record<string, boolean>;
  manualCategories: Record<string, MediaCategory>;
  customTitles: Record<string, string>;
  customSynopses: Record<string, string>;
  customPosters: Record<string, string>;
  externalMetadataCache: Record<string, ExternalMetadataMatch>;
  episodeProgress: Record<
    string,
    {
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

  // Clean up old synthetic demo names if present so real AniList/TMDB sample titles appear cleanly
  const legacyFolders = [
    'Chrono Vanguard - Neon Eclipse [Anime]',
    'Aethelgard - Spirit of the Wind',
    'Northern Harbor - Cold Case',
    'Solaris Drift (2025)',
    'Echoes of Kyoto (2024)',
  ];
  for (const oldName of legacyFolders) {
    const oldPath = path.join(DEFAULT_SAMPLE_ROOT, oldName);
    if (fs.existsSync(oldPath)) {
      try {
        fs.rmSync(oldPath, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

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
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const raw = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        rootPath: parsed.rootPath && fs.existsSync(parsed.rootPath) ? parsed.rootPath : DEFAULT_SAMPLE_ROOT,
        favorites: parsed.favorites || {},
        manualCategories: parsed.manualCategories || {},
        customTitles: parsed.customTitles || {},
        customSynopses: parsed.customSynopses || {},
        customPosters: parsed.customPosters || {},
        externalMetadataCache: parsed.externalMetadataCache || {},
        episodeProgress: parsed.episodeProgress || {},
      };
    }
  } catch (err) {
    console.error('Failed to read media-library-state.json:', err);
  }

  const frierenId = hashId('Sousou no Frieren [Anime]');
  const frierenEp1Id = hashId(
    path.join(
      'Sousou no Frieren [Anime]',
      'Season 1',
      'Sousou no Frieren - S01E01 - The Journey Begins [1080p].mp4'
    )
  );
  const interstellarEpId = hashId(
    path.join('Interstellar (2014)', 'Interstellar (2014) [4K Remux].mkv')
  );
  const studioReelId = hashId('Studio Reel - Cinematography & Lighting Breakdown.mp4');

  const initial: PersistedState = {
    rootPath: DEFAULT_SAMPLE_ROOT,
    favorites: {
      [frierenId]: true,
    },
    manualCategories: {
      [studioReelId]: 'other',
    },
    customTitles: {},
    customSynopses: {},
    customPosters: {},
    externalMetadataCache: {},
    episodeProgress: {
      [frierenEp1Id]: {
        currentTime: 402,
        duration: 1440,
        completed: false,
        updatedAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
      },
      [interstellarEpId]: {
        currentTime: 2535,
        duration: 9840,
        completed: false,
        updatedAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
      },
    },
  };

  saveState(initial);
  return initial;
}

export function saveState(state: PersistedState): void {
  try {
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save media-library-state.json:', err);
  }
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
  const withoutExt = rawName.replace(/\.(mp4|webm|mkv|avi|mov)$/i, '');
  let autoCategoryHint: MediaCategory | null = null;
  if (/\[anime\]|anime/i.test(withoutExt)) {
    autoCategoryHint = 'anime';
  }
  const yearMatch = withoutExt.match(/\((\d{4})\)/);
  const year = yearMatch ? yearMatch[1] : '2024';
  const cleaned = withoutExt
    .replace(/\[.*?\]/g, '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { title: cleaned || rawName, year, autoCategoryHint };
}

function parseSeasonEpisode(
  fileName: string,
  parentDirName: string,
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

  let cleanEpTitle = fileName
    .replace(/\.(mp4|webm|mkv|avi|mov)$/i, '')
    .replace(/\[.*?\]/g, '')
    .replace(/.*?S\d{1,2}E\d{1,3}\s*[-–:]?\s*/i, '')
    .trim();

  if (!cleanEpTitle) {
    cleanEpTitle = `Episode ${episode}`;
  }

  return { season, episode, cleanEpTitle };
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

export function scanLibrary(state: PersistedState): {
  items: MediaItem[];
  totalFilesScanned: number;
} {
  const rootPath = state.rootPath;
  episodePathRegistry.clear();
  artworkPathRegistry.clear();
  lastScanTimestamp = new Date().toISOString();

  if (!fs.existsSync(rootPath)) {
    return { items: [], totalFilesScanned: 0 };
  }

  let topEntries: fs.Dirent[] = [];
  try {
    topEntries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch (err) {
    console.error('Error reading rootPath:', err);
    return { items: [], totalFilesScanned: 0 };
  }

  const items: MediaItem[] = [];
  let totalFilesScanned = 0;

  for (const entry of topEntries) {
    if (entry.name.startsWith('.')) continue;
    const fullEntryPath = path.join(rootPath, entry.name);
    const relEntryPath = path.relative(rootPath, fullEntryPath);
    const mediaId = hashId(relEntryPath);

    let videoFiles: string[] = [];
    if (entry.isDirectory()) {
      videoFiles = collectVideoFilesRecursive(fullEntryPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (VIDEO_EXTENSIONS.has(ext)) {
        videoFiles = [fullEntryPath];
      }
    }

    if (videoFiles.length === 0) continue;
    videoFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    totalFilesScanned += videoFiles.length;

    const { title: parsedTitle, year, autoCategoryHint } = cleanDisplayTitle(entry.name);
    const cachedMeta = state.externalMetadataCache?.[mediaId];
    const displayTitle = state.customTitles[mediaId] || cachedMeta?.title || parsedTitle;
    const visualTheme = pickVisualTheme(parsedTitle);

    const hasSeasonFolder = videoFiles.some((vf) =>
      /season\s*\d+|s\d{1,2}e\d{1,3}/i.test(path.relative(fullEntryPath, vf))
    );
    const autoType: 'movie' | 'series' = videoFiles.length > 1 || hasSeasonFolder ? 'series' : 'movie';

    let defaultCategory: MediaCategory = autoType === 'series' ? 'tv' : 'movies';
    if (autoCategoryHint) {
      defaultCategory = autoCategoryHint;
    }
    const isManualCategory = Boolean(state.manualCategories[mediaId]);
    const category: MediaCategory = state.manualCategories[mediaId] || defaultCategory;

    let posterUrl = '';
    if (entry.isDirectory()) {
      for (const imgName of IMAGE_NAMES) {
        const candidate = path.join(/*turbopackIgnore: true*/ fullEntryPath, imgName);
        if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
          artworkPathRegistry.set(mediaId, candidate);
          posterUrl = `/api/artwork/${mediaId}`;
          break;
        }
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
      const epId = hashId(relEpPath);
      const ext = path.extname(vf).toLowerCase().slice(1) as 'mp4' | 'webm' | 'mkv' | 'avi' | 'mov';
      const parentDirName = path.basename(path.dirname(vf));
      const { season, episode, cleanEpTitle } =
        autoType === 'series'
          ? parseSeasonEpisode(path.basename(vf), parentDirName, idx + 1)
          : { season: 1, episode: 1, cleanEpTitle: displayTitle };

      const isSynthetic = checkIsSyntheticFile(vf);
      let statSize = 0;
      try {
        statSize = fs.statSync(vf).size;
      } catch {
        statSize = 0;
      }

      const estimatedDurationSec = autoType === 'movie' ? 9840 : 1440;
      const savedProgress = state.episodeProgress[epId] || {
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
        fileSizeBytes: isSynthetic ? (autoType === 'movie' ? 4_280_000_000 : 840_000_000) : statSize,
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

    const watchedEpisodes = episodes.filter((e) => e.progress.completed).length;
    const inProgressCandidates = episodes
      .filter((e) => e.progress.currentTime > 0 && !e.progress.completed)
      .sort((a, b) => (b.progress.updatedAt || '').localeCompare(a.progress.updatedAt || ''));

    const inProgressEpisode = inProgressCandidates[0];
    const lastWatchedAt =
      inProgressEpisode?.progress.updatedAt || episodes.find((e) => e.progress.updatedAt)?.progress.updatedAt;

    const defaultSynopsis =
      cachedMeta?.synopsis ||
      `Local ${autoType === 'series' ? 'multi-episode series' : 'video file'} located in "${relEntryPath}" (${
        episodes.length
      } ${episodes.length === 1 ? 'file' : 'episodes'}).`;

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
      genres: cachedMeta?.genres || [category === 'anime' ? 'Anime' : category === 'tv' ? 'TV Series' : 'Movie'],
      ratingScore: cachedMeta?.ratingScore,
      studioOrNetwork: cachedMeta?.studioOrNetwork,
      metadataProvider: cachedMeta?.provider || 'local',
      externalId: cachedMeta?.externalId,
      isFavorite: Boolean(state.favorites[mediaId]),
      episodes,
      totalEpisodes: episodes.length,
      watchedEpisodes,
      inProgressEpisode,
      lastWatchedAt,
    });
  }

  return { items, totalFilesScanned };
}

/**
 * Scans the library and automatically fetches AniList (for Anime) and TMDB (for Movies & TV Shows)
 * metadata for any uncached items, saving the enriched posters, stories, genres, and scores to disk.
 */
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

export function buildCapabilities(state: PersistedState, totalFilesScanned: number) {
  const tmdbKey = (process.env.TMDB_API_KEY || '').trim();
  return {
    rootPath: state.rootPath,
    defaultSamplePath: DEFAULT_SAMPLE_ROOT,
    ffmpegAvailable,
    ffmpegVersion,
    tmdbConfigured: Boolean(tmdbKey && tmdbKey !== 'MY_TMDB_API_KEY'),
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    hostname: os.hostname(),
    supportedContainers: ['mp4', 'webm', 'mkv', 'avi', 'mov'],
    lastScannedAt: lastScanTimestamp,
    totalFilesScanned,
  };
}

export function getEpisodeEntry(episodeId: string, state: PersistedState): IndexedEpisodeLookup | undefined {
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
