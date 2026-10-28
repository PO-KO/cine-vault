import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { MediaCategory } from '../types/media';

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

function createPosterSvg(
  title: string,
  subtitle: string,
  accentA: string,
  accentB: string,
  bgDark: string,
  motif: 'mecha' | 'sky' | 'lighthouse' | 'planet' | 'torii' | 'camera'
): string {
  let motifSvg = '';
  if (motif === 'mecha') {
    motifSvg = `
      <circle cx="300" cy="290" r="145" fill="url(#glow)" opacity="0.55" />
      <path d="M180 480 L250 240 L300 290 L350 240 L420 480 Z" fill="${accentA}" opacity="0.22" />
      <path d="M220 440 L300 190 L380 440 L300 370 Z" fill="none" stroke="${accentA}" stroke-width="3" />
      <line x1="120" y1="320" x2="480" y2="320" stroke="${accentB}" stroke-width="1.5" stroke-dasharray="8 6" opacity="0.6" />
      <rect x="275" y="255" width="50" height="14" rx="7" fill="${accentB}" />
    `;
  } else if (motif === 'sky') {
    motifSvg = `
      <circle cx="300" cy="250" r="130" fill="url(#glow)" opacity="0.5" />
      <path d="M110 380 Q300 260 490 380 L430 430 Q300 350 170 430 Z" fill="${accentA}" opacity="0.28" />
      <path d="M190 260 Q300 170 410 260" fill="none" stroke="${accentB}" stroke-width="3" />
      <circle cx="300" cy="220" r="36" fill="${accentB}" opacity="0.7" />
    `;
  } else if (motif === 'lighthouse') {
    motifSvg = `
      <polygon points="300,190 80,110 80,270" fill="url(#glow)" opacity="0.45" />
      <polygon points="300,190 520,110 520,270" fill="url(#glow)" opacity="0.45" />
      <path d="M275 470 L288 180 L312 180 L325 470 Z" fill="${accentA}" opacity="0.4" stroke="${accentB}" stroke-width="2" />
      <circle cx="300" cy="190" r="14" fill="${accentB}" />
    `;
  } else if (motif === 'planet') {
    motifSvg = `
      <circle cx="300" cy="285" r="115" fill="${accentA}" opacity="0.3" stroke="${accentB}" stroke-width="2" />
      <ellipse cx="300" cy="285" rx="195" ry="44" fill="none" stroke="${accentB}" stroke-width="3" transform="rotate(-18 300 285)" />
      <circle cx="410" cy="175" r="12" fill="${accentB}" />
    `;
  } else if (motif === 'torii') {
    motifSvg = `
      <circle cx="300" cy="295" r="125" fill="${accentA}" opacity="0.35" />
      <path d="M160 220 Q300 190 440 220" fill="none" stroke="${accentB}" stroke-width="8" stroke-linecap="round" />
      <line x1="190" y1="265" x2="410" y2="265" stroke="${accentB}" stroke-width="5" />
      <line x1="225" y1="220" x2="215" y2="450" stroke="${accentB}" stroke-width="7" />
      <line x1="375" y1="220" x2="385" y2="450" stroke="${accentB}" stroke-width="7" />
    `;
  } else {
    motifSvg = `
      <rect x="170" y="200" width="260" height="170" rx="16" fill="none" stroke="${accentB}" stroke-width="3" />
      <circle cx="300" cy="285" r="52" fill="${accentA}" opacity="0.35" stroke="${accentB}" stroke-width="3" />
      <circle cx="300" cy="285" r="18" fill="${accentB}" />
    `;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bgDark}" />
      <stop offset="55%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#020617" />
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${accentA}" stop-opacity="0.9" />
      <stop offset="100%" stop-color="${accentA}" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="600" height="800" fill="url(#bg)" />
  <g opacity="0.15">
    <line x1="0" y1="160" x2="600" y2="160" stroke="#94a3b8" stroke-width="1" />
    <line x1="0" y1="480" x2="600" y2="480" stroke="#94a3b8" stroke-width="1" />
    <line x1="150" y1="0" x2="150" y2="800" stroke="#94a3b8" stroke-width="1" />
    <line x1="450" y1="0" x2="450" y2="800" stroke="#94a3b8" stroke-width="1" />
  </g>
  ${motifSvg}
  <rect x="0" y="500" width="600" height="300" fill="url(#bg)" opacity="0.88" />
  <text x="48" y="625" fill="${accentB}" font-family="sans-serif" font-size="16" font-weight="600" letter-spacing="3">${subtitle.toUpperCase()}</text>
  <text x="48" y="675" fill="#f8fafc" font-family="sans-serif" font-size="36" font-weight="700">${title}</text>
</svg>`;
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

  writeSampleFile(
    'Chrono Vanguard - Neon Eclipse [Anime]/poster.svg',
    createPosterSvg('Chrono Vanguard', 'Anime Series · Sci-Fi Mecha', '#e11d48', '#fb7185', '#1e1b4b', 'mecha')
  );
  writeSampleFile(
    'Chrono Vanguard - Neon Eclipse [Anime]/Season 1/Chrono Vanguard - S01E01 - Awakening Protocol [1080p].mp4',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Chrono Vanguard - Neon Eclipse [Anime]/Season 1/Chrono Vanguard - S01E01 - Awakening Protocol [1080p].en.srt',
    `1
00:00:00,500 --> 00:00:04,500
[Sector 7 Orbital Elevator — 2149 AD]
All telemetry channels are locked onto the Eclipse core.

2
00:00:04,800 --> 00:00:09,200
Commander Ren, the neural synchronization rate just passed 98 percent!

3
00:00:09,500 --> 00:00:14,000
Release the electromagnetic clamps. Vanguard Unit-01 is cleared for launch.

4
00:00:14,500 --> 00:00:19,500
If the temporal rift expands any further, Neo-Tokyo won't survive the night.

5
00:00:20,000 --> 00:00:26,000
Initiating Awakening Protocol. Engage auxiliary thrusters on my mark!`
  );
  writeSampleFile(
    'Chrono Vanguard - Neon Eclipse [Anime]/Season 1/Chrono Vanguard - S01E01 - Awakening Protocol [1080p].ja.srt',
    `1
00:00:00,500 --> 00:00:04,500
[第7軌道エレベーター — 西暦2149年]
全テレメトリチャンネル、エクリプス・コアを捕捉。

2
00:00:04,800 --> 00:00:09,200
レン司令官、神経同調率が98%を超えました！

3
00:00:09,500 --> 00:00:14,000
電磁クランプ解除。ヴァンガード初号機、発進準備完了。`
  );
  writeSampleFile(
    'Chrono Vanguard - Neon Eclipse [Anime]/Season 1/Chrono Vanguard - S01E02 - Orbital Resonance [1080p].mp4',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Chrono Vanguard - Neon Eclipse [Anime]/Season 1/Chrono Vanguard - S01E02 - Orbital Resonance [1080p].en.srt',
    `1
00:00:00,500 --> 00:00:05,000
[Episode 02 — Orbital Resonance]
We've reached low-earth orbit, but the resonance wave is still echoing.`
  );
  writeSampleFile(
    'Chrono Vanguard - Neon Eclipse [Anime]/Season 1/Chrono Vanguard - S01E03 - Crimson Horizon [1080p].mkv',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Chrono Vanguard - Neon Eclipse [Anime]/Season 2/Chrono Vanguard - S02E01 - Zero Point Singularity [1080p].mkv',
    samplePlaceholderHeader
  );

  writeSampleFile(
    'Aethelgard - Spirit of the Wind/poster.svg',
    createPosterSvg('Aethelgard', 'Anime Fantasy · Adventure', '#059669', '#34d399', '#064e3b', 'sky')
  );
  writeSampleFile(
    'Aethelgard - Spirit of the Wind/Season 1/Aethelgard - S01E01 - The Floating Isles.mp4',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Aethelgard - Spirit of the Wind/Season 1/Aethelgard - S01E01 - The Floating Isles.en.vtt',
    `WEBVTT

00:00:00.500 --> 00:00:05.000
For centuries, the wind currents carried our archipelago above the cloud sea.

00:00:05.400 --> 00:00:10.500
Listen closely—the ancient wind bells are ringing across the eastern spire.`
  );
  writeSampleFile(
    'Aethelgard - Spirit of the Wind/Season 1/Aethelgard - S01E02 - Skyward Oath.mp4',
    samplePlaceholderHeader
  );

  writeSampleFile(
    'Northern Harbor - Cold Case/poster.svg',
    createPosterSvg('Northern Harbor', 'TV Series · Mystery Thriller', '#0284c7', '#38bdf8', '#0c4a6e', 'lighthouse')
  );
  writeSampleFile(
    'Northern Harbor - Cold Case/Season 1/Northern Harbor - S01E01 - The Lighthouse Keeper.mp4',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Northern Harbor - Cold Case/Season 1/Northern Harbor - S01E01 - The Lighthouse Keeper.en.srt',
    `1
00:00:00,500 --> 00:00:05,200
[Bergen Fjord Precinct — 05:40 AM]
The harbor fog rolled in three hours before the trawler ran aground.`
  );
  writeSampleFile(
    'Northern Harbor - Cold Case/Season 1/Northern Harbor - S01E02 - Beneath the Fog.mp4',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Northern Harbor - Cold Case/Season 1/Northern Harbor - S01E03 - Winter Tide.avi',
    samplePlaceholderHeader
  );

  writeSampleFile(
    'Solaris Drift (2025)/poster.svg',
    createPosterSvg('Solaris Drift', 'Feature Film · 2025 · 4K HDR', '#d97706', '#fbbf24', '#451a03', 'planet')
  );
  writeSampleFile(
    'Solaris Drift (2025)/Solaris Drift (2025) [4K Remux].mkv',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Solaris Drift (2025)/Solaris Drift (2025) [4K Remux].en.srt',
    `1
00:00:00,500 --> 00:00:05,000
[Deep Space Vessel Helios — Day 412]
Orbital insertion around Kepler-442b complete.`
  );
  writeSampleFile(
    'Solaris Drift (2025)/Solaris Drift (2025) [4K Remux].fr.srt',
    `1
00:00:00,500 --> 00:00:05,000
[Vaisseau Spatial Hélios — Jour 412]
Insertion orbitale autour de Kepler-442b terminée.`
  );

  writeSampleFile(
    'Echoes of Kyoto (2024)/poster.svg',
    createPosterSvg('Echoes of Kyoto', 'Documentary Film · 2024', '#dc2626', '#f87171', '#450a0a', 'torii')
  );
  writeSampleFile(
    'Echoes of Kyoto (2024)/Echoes of Kyoto (2024) [1080p].webm',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Echoes of Kyoto (2024)/Echoes of Kyoto (2024) [1080p].en.vtt',
    `WEBVTT

00:00:00.500 --> 00:00:05.500
At dawn in Higashiyama, the cedar temples awaken before the city below.`
  );

  writeSampleFile(
    'Studio Reel - Cinematography & Lighting Breakdown.mp4',
    samplePlaceholderHeader
  );
  writeSampleFile(
    'Studio Reel - Cinematography & Lighting Breakdown.en.srt',
    `1
00:00:00,500 --> 00:00:05,500
[Cinematography Breakdown — Anamorphic Lens Test]
Notice how the key light wraps softly across the shadow edge at T2.0.`
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
        episodeProgress: parsed.episodeProgress || {},
      };
    }
  } catch (err) {
    console.error('Failed to read media-library-state.json:', err);
  }

  const chronoMediaId = hashId('Chrono Vanguard - Neon Eclipse [Anime]');
  const chronoEp1Id = hashId(
    path.join(
      'Chrono Vanguard - Neon Eclipse [Anime]',
      'Season 1',
      'Chrono Vanguard - S01E01 - Awakening Protocol [1080p].mp4'
    )
  );
  const aethelgardId = hashId('Aethelgard - Spirit of the Wind');
  const solarisEpId = hashId(path.join('Solaris Drift (2025)', 'Solaris Drift (2025) [4K Remux].mkv'));
  const studioReelId = hashId('Studio Reel - Cinematography & Lighting Breakdown.mp4');

  const initial: PersistedState = {
    rootPath: DEFAULT_SAMPLE_ROOT,
    favorites: {
      [chronoMediaId]: true,
      [aethelgardId]: true,
    },
    manualCategories: {
      [aethelgardId]: 'anime',
      [studioReelId]: 'other',
    },
    customTitles: {},
    customSynopses: {},
    customPosters: {},
    episodeProgress: {
      [chronoEp1Id]: {
        currentTime: 402,
        duration: 1440,
        completed: false,
        updatedAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
      },
      [solarisEpId]: {
        currentTime: 2535,
        duration: 7080,
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

const SYNOPSES_BY_TITLE: Record<string, string> = {
  'Chrono Vanguard - Neon Eclipse':
    'In 2149 Neo-Tokyo, an orbital elevator test triggers a temporal anomaly. A squad of experimental mecha pilots must synchronize with ancient resonance cores to seal the rift.',
  'Aethelgard - Spirit of the Wind':
    'High above a boundless cloud sea, a young cartographer and a sky-ship mechanic embark on a perilous voyage to reconnect the drifting islands of Aethelgard.',
  'Northern Harbor - Cold Case':
    'When a century-old coastal beacon goes dark during a winter gale, two detectives uncover a decades-spanning mystery hidden beneath a quiet Norwegian fishing port.',
  'Solaris Drift':
    'A lone deep-space crew aboard the vessel Helios enters orbit around a frozen exoplanet, discovering an acoustic signal emanating miles beneath the glacial shelf.',
  'Echoes of Kyoto':
    'An intimate visual portrait of Kyoto’s traditional woodworkers, garden designers, and nocturnal lanterns across four changing seasons.',
  'Studio Reel - Cinematography & Lighting Breakdown':
    'Technical camera, color grading, and anamorphic lighting reference reel stored directly in the root media directory.',
};

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
  const year = yearMatch ? yearMatch[1] : '2025';
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
  if (lower.includes('chrono') || lower.includes('vanguard')) return 'cyber_anime';
  if (lower.includes('aethelgard') || lower.includes('wind')) return 'fantasy_anime';
  if (lower.includes('harbor') || lower.includes('cold')) return 'nordic_mystery';
  if (lower.includes('solaris') || lower.includes('drift')) return 'scifi_cosmos';
  if (lower.includes('kyoto') || lower.includes('echoes')) return 'kyoto_doc';
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

export function scanLibrary(state: PersistedState) {
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

  const items = [];
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
    const displayTitle = state.customTitles[mediaId] || parsedTitle;
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

      const estimatedDurationSec = autoType === 'movie' ? 7080 : 1440;
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
      SYNOPSES_BY_TITLE[parsedTitle] ||
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
      releaseYear: year,
      autoType,
      category,
      isManualCategory,
      posterUrl,
      customPosterUrl: state.customPosters[mediaId] || '',
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

export function buildCapabilities(state: PersistedState, totalFilesScanned: number) {
  return {
    rootPath: state.rootPath,
    defaultSamplePath: DEFAULT_SAMPLE_ROOT,
    ffmpegAvailable,
    ffmpegVersion,
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
