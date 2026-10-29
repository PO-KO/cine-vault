import {
  ExternalMetadataMatch,
  MediaCategory,
  MediaEpisode,
  MediaItem,
  SubtitleTrack,
} from '../types/media';

const VIDEO_EXT_REGEX =
  /\.(mp4|webm|mkv|avi|mov|m4v|ts|m2ts|mts|flv|wmv|mpg|mpeg|ogm|ogv|rmvb|3gp|divx|vob)$/i;
const SUB_EXT_REGEX = /\.(srt|vtt|ass|ssa|sub)$/i;
const IMAGE_NAME_REGEX = /^(poster|cover|folder|banner|thumb|fanart)\.(jpg|jpeg|png|webp|svg)$/i;

const SUB_GROUPING_DIR_REGEX =
  /^(season\s*\d+|s\d{1,2}|series\s*\d+|part\s*\d+|cour\s*\d+|specials?|ovas?|oads?|onas?|extras?|bonus|featurettes?|ncop|nced|op|ed|bd|bdrip|bluray|dvd|disc\s*\d+|cd\s*\d+|1080p|720p|2160p|4k|subs?|subtitles?)$/i;

function getCategoryBucket(dirName: string): MediaCategory | null {
  const clean = dirName.trim().toLowerCase();
  if (/^(anime|animes|donghua|japanese animation|cartoons?)$/i.test(clean)) return 'anime';
  if (/^(tv|tv\s*shows?|tv\s*series|series|shows|television)$/i.test(clean)) return 'tv';
  if (/^(movies?|films?|cinema|feature\s*films?)$/i.test(clean)) return 'movies';
  return null;
}

function simpleHash(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'local-' + (h >>> 0).toString(16);
}

function detectAnimeHintFromFolderName(folderName: string): boolean {
  if (/\[anime\]|\banime\b|donghua/i.test(folderName)) {
    return true;
  }
  const leadingBracket = folderName.match(/^\[([^\]]+)\]/);
  if (
    leadingBracket &&
    !/^(1080p|720p|2160p|4k|480p|bluray|web-dl|webrip|bd|dvd)$/i.test(leadingBracket[1].trim())
  ) {
    return true;
  }
  return false;
}

/**
 * Extracts the clean media title, year, and category hint strictly from the FOLDER name.
 */
export function cleanFolderTitle(rawFolderName: string): {
  title: string;
  year: string;
  autoCategoryHint: MediaCategory | null;
} {
  const withoutExt = rawFolderName.replace(VIDEO_EXT_REGEX, '');
  let autoCategoryHint: MediaCategory | null = null;
  if (detectAnimeHintFromFolderName(withoutExt)) {
    autoCategoryHint = 'anime';
  }

  const yearMatch =
    withoutExt.match(/\((\d{4})\)/) ||
    withoutExt.match(/\[(\d{4})\]/) ||
    withoutExt.match(/\b(19\d{2}|20[0-2]\d)\b/);
  const year = yearMatch ? yearMatch[1] : '2024';

  let cleaned = withoutExt
    .replace(/\[.*?\]/g, ' ')
    .replace(/\{.*?\}/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip trailing Season / S01 / quality tags from the folder name if present
  const seSplit = cleaned.match(
    /^(.*?)\s*(?:\bS\d{1,2}\s*E\d{1,3}\b|\bS\d{1,2}\b|\bSeason\s*\d+\b|\bPart\s*\d+\b|\bCour\s*\d+\b)/i
  );
  if (seSplit && seSplit[1].trim().length >= 2) {
    cleaned = seSplit[1].trim();
  }

  const qualitySplit = cleaned.match(
    /^(.*?)\s*\b(1080p|720p|2160p|480p|4k|uhd|fhd|bluray|blu-ray|bdrip|brrip|web-dl|webrip|hdrip|dvdrip|remux|x264|x265|h264|h265|hevc|av1|10bit|10-bit|8bit|aac|flac|eac3|dual\s*audio|multi\s*audio|complete|batch)\b/i
  );
  if (qualitySplit && qualitySplit[1].trim().length >= 2) {
    cleaned = qualitySplit[1].trim();
  }

  const yearSuffix = cleaned.match(/^(.*?)\s+\b(19\d{2}|20[0-2]\d)\b$/);
  if (yearSuffix && yearSuffix[1].trim().length >= 2) {
    cleaned = yearSuffix[1].trim();
  }

  cleaned = cleaned.replace(/[-–:~\s]+$/, '').replace(/^[-–:~\s]+/, '').replace(/\s+/g, ' ').trim();

  return {
    title: cleaned || withoutExt.trim() || rawFolderName,
    year,
    autoCategoryHint,
  };
}

function parseEpisodeFromFilename(
  fileName: string,
  parentFolder: string,
  folderTitle: string,
  fallbackIndex: number
): { season: number; episode: number; cleanEpTitle: string } {
  const withoutExt = fileName.replace(VIDEO_EXT_REGEX, '');
  const seMatch =
    withoutExt.match(/S(\d{1,2})\s*E(\d{1,3})/i) || withoutExt.match(/(\d{1,2})x(\d{1,3})/i);
  let season = 1;
  let episode = fallbackIndex;

  const parentSeason =
    parentFolder.match(/Season\s*(\d{1,2})/i) || parentFolder.match(/^S(\d{1,2})$/i);
  if (parentSeason) {
    season = parseInt(parentSeason[1], 10);
  }

  if (seMatch) {
    season = parseInt(seMatch[1], 10);
    episode = parseInt(seMatch[2], 10);
  } else {
    const dashEp =
      withoutExt.replace(/\[.*?\]/g, '').match(/[-–~]\s*(\d{1,4})\b/) ||
      withoutExt.match(/\b(?:Episode|Ep\.?|E)\s*(\d{1,4})\b/i);
    if (dashEp) {
      episode = parseInt(dashEp[1], 10);
    }
  }

  return {
    season,
    episode,
    cleanEpTitle: `${folderTitle} — Episode ${episode}`,
  };
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsText(file);
  });
}

function convertAssToVtt(assContent: string): string {
  const lines = assContent.replace(/\r\n/g, '\n').split('\n');
  const cues: string[] = [];
  for (const line of lines) {
    if (!line.startsWith('Dialogue:')) continue;
    const rest = line.slice('Dialogue:'.length).trim();
    const parts = rest.split(',');
    if (parts.length < 10) continue;
    const startRaw = parts[1].trim();
    const endRaw = parts[2].trim();
    const textRaw = parts
      .slice(9)
      .join(',')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/g, '\n')
      .replace(/\\n/g, '\n')
      .trim();
    if (!textRaw) continue;
    const fmtTime = (t: string) => {
      const m = t.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
      if (!m) return '00:00:00.000';
      return `${m[1].padStart(2, '0')}:${m[2]}:${m[3]}.${m[4]}0`;
    };
    cues.push(`${fmtTime(startRaw)} --> ${fmtTime(endRaw)}\n${textRaw}`);
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

export interface ScannedEntryInput {
  files: { file: File; relPath: string }[];
  directories: string[]; // Relative directory paths e.g. "media/Kingdom [Anime]", "media/Yellowjackets/Season 2"
  rootFolderName: string;
}

function parseSeasonFromDirName(dirName: string): number | null {
  const m =
    dirName.match(/^(?:season|series|part|cour)\s*(\d{1,2})\b/i) ||
    dirName.match(/^s(\d{1,2})\b/i);
  if (m) {
    return parseInt(m[1], 10);
  }
  return null;
}

/**
 * Core builder that converts discovered relative directories and files into MediaItem[]
 * depending strictly on the FOLDER NAME (not the video file name), preserving empty media
 * folders and empty season folders, and enriching Anime via AniList and Movies/TV via TMDB.
 */
export async function buildLibraryFromScannedEntries(
  input: ScannedEntryInput
): Promise<{ rootFolderName: string; items: MediaItem[]; totalVideoFiles: number }> {
  const { files, directories, rootFolderName } = input;

  const groups = new Map<
    string,
    {
      displayFolderName: string;
      relativePath: string;
      ancestorCategoryHint: MediaCategory | null;
      seasons: Set<number>;
      videos: { file: File; relPath: string }[];
      subtitles: { file: File; relPath: string }[];
      artworkFile?: File;
    }
  >();

  const ensureGroup = (
    groupKey: string,
    folderName: string,
    groupRelPath: string,
    ancestorCategoryHint: MediaCategory | null
  ) => {
    let effectiveHint = ancestorCategoryHint;
    if (detectAnimeHintFromFolderName(folderName)) {
      effectiveHint = 'anime';
    }
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        displayFolderName: folderName,
        relativePath: groupRelPath,
        ancestorCategoryHint: effectiveHint,
        seasons: new Set<number>(),
        videos: [],
        subtitles: [],
      });
    } else {
      const existing = groups.get(groupKey)!;
      if (effectiveHint === 'anime') {
        existing.ancestorCategoryHint = 'anime';
      } else if (effectiveHint && !existing.ancestorCategoryHint) {
        existing.ancestorCategoryHint = effectiveHint;
      }
    }
    return groups.get(groupKey)!;
  };

  // Register a directory path (relative to the scan root, starting with rootFolderName)
  const registerDirectoryPath = (rawDirPath: string) => {
    const cleanRel = rawDirPath.replace(/\\/g, '/').replace(/\/+$/, '');
    const parts = cleanRel.split('/').filter(Boolean);
    if (parts.length === 0) return null;

    // parts[0] is rootFolderName; subParts are subfolder segments inside rootFolderName
    const subParts = parts.slice(1);
    if (subParts.length === 0) {
      return null;
    }

    // Ignore hidden system directories
    if (subParts.some((p) => p.startsWith('.'))) {
      return null;
    }

    if (SUB_GROUPING_DIR_REGEX.test(subParts[0])) {
      // e.g. PickedShowFolder/Season 1 -> the show is rootFolderName, and subParts[0] is a season folder
      const g = ensureGroup(
        `folder:${rootFolderName.toLowerCase()}`,
        rootFolderName,
        rootFolderName,
        null
      );
      const seasonNum = parseSeasonFromDirName(subParts[0]);
      if (seasonNum !== null) {
        g.seasons.add(seasonNum);
      }
      return g;
    }

    const catBucket = getCategoryBucket(subParts[0]);
    if (catBucket !== null) {
      // e.g. media/Anime/Kingdom [Anime]/Season 1
      if (subParts.length >= 2) {
        const showFolderName = subParts[1];
        const subPath = `${subParts[0]}/${showFolderName}`;
        const g = ensureGroup(
          `folder:${subPath.toLowerCase()}`,
          showFolderName,
          `${rootFolderName}/${subPath}`,
          catBucket
        );
        for (const extraSeg of subParts.slice(2)) {
          const sNum = parseSeasonFromDirName(extraSeg);
          if (sNum !== null) g.seasons.add(sNum);
        }
        return g;
      }
      return null;
    }

    // Standard structure: e.g. media/Kingdom [Anime] or media/Yellowjackets/Season 1
    const showFolderName = subParts[0];
    const g = ensureGroup(
      `folder:${showFolderName.toLowerCase()}`,
      showFolderName,
      `${rootFolderName}/${showFolderName}`,
      null
    );
    for (const extraSeg of subParts.slice(1)) {
      const sNum = parseSeasonFromDirName(extraSeg);
      if (sNum !== null) g.seasons.add(sNum);
    }
    return g;
  };

  // Pass 1: Register all discovered directories (including completely empty media folders and empty season folders!)
  for (const dir of directories) {
    registerDirectoryPath(dir);
  }

  const allSubtitles: { file: File; relPath: string; dirPath: string }[] = [];
  const allArtworks: { file: File; relPath: string; dirPath: string }[] = [];
  let totalVideoFiles = 0;

  // Pass 2: Process all files and register their parent directories
  for (const entry of files) {
    const { file } = entry;
    const rel = (entry.relPath || file.webkitRelativePath || file.name).replace(/\\/g, '/');
    const parts = rel.split('/').filter(Boolean);
    const dirPath = parts.slice(0, -1).join('/');

    if (dirPath) {
      registerDirectoryPath(dirPath);
    }

    if (SUB_EXT_REGEX.test(file.name)) {
      allSubtitles.push({ file, relPath: rel, dirPath });
      continue;
    }
    if (IMAGE_NAME_REGEX.test(file.name)) {
      allArtworks.push({ file, relPath: rel, dirPath });
      continue;
    }
    if (!VIDEO_EXT_REGEX.test(file.name)) {
      continue;
    }

    totalVideoFiles++;

    const dirParts = parts.slice(1, -1);
    let g = dirPath ? registerDirectoryPath(dirPath) : null;
    if (!g && dirParts.length === 0) {
      g = ensureGroup(
        `folder:${rootFolderName.toLowerCase()}`,
        rootFolderName,
        rootFolderName,
        null
      );
    }
    if (g) {
      g.videos.push({ file, relPath: rel });
    }
  }

  // If the user picked a single empty folder directly (0 subdirectories and 0 files),
  // register the root folder itself as an empty media item so it still appears!
  if (groups.size === 0 && rootFolderName) {
    ensureGroup(
      `folder:${rootFolderName.toLowerCase()}`,
      rootFolderName,
      rootFolderName,
      null
    );
  }

  // Pass 3: Attach subtitles and artwork inside each folder group
  for (const group of groups.values()) {
    for (const sub of allSubtitles) {
      if (sub.relPath === group.relativePath || sub.relPath.startsWith(group.relativePath + '/')) {
        group.subtitles.push({ file: sub.file, relPath: sub.relPath });
      }
    }
    for (const art of allArtworks) {
      if (
        !group.artworkFile &&
        (art.relPath === group.relativePath || art.relPath.startsWith(group.relativePath + '/'))
      ) {
        group.artworkFile = art.file;
      }
    }
  }

  const rawItems: MediaItem[] = [];

  for (const [groupKey, group] of groups.entries()) {
    group.videos.sort((a, b) =>
      a.relPath.localeCompare(b.relPath, undefined, { numeric: true, sensitivity: 'base' })
    );

    const mediaId = simpleHash(`${rootFolderName}:${groupKey}`);
    const {
      title: parsedFolderTitle,
      year,
      autoCategoryHint: folderCategoryHint,
    } = cleanFolderTitle(group.displayFolderName);

    const effectiveAnimeHint =
      group.ancestorCategoryHint === 'anime' || folderCategoryHint === 'anime';

    const hasSeasonSubfolder =
      group.seasons.size > 0 ||
      group.videos.some((v) => /\/season\s*\d+\//i.test(v.relPath));

    // Empty folders or multi-video folders or folders with seasons default to 'series' so their seasons/empty status can be inspected
    const autoType: 'movie' | 'series' =
      group.videos.length !== 1 || hasSeasonSubfolder || effectiveAnimeHint ? 'series' : 'movie';

    const category: MediaCategory = effectiveAnimeHint
      ? 'anime'
      : group.ancestorCategoryHint || folderCategoryHint || (autoType === 'series' ? 'tv' : 'movies');

    const localPosterUrl = group.artworkFile ? URL.createObjectURL(group.artworkFile) : '';

    const episodes: MediaEpisode[] = [];
    for (let idx = 0; idx < group.videos.length; idx++) {
      const vEntry = group.videos[idx];
      const epId = simpleHash(vEntry.relPath);
      const extMatch = vEntry.file.name.match(/\.([a-z0-9]+)$/i);
      const rawExt = extMatch ? extMatch[1].toLowerCase() : 'mp4';
      const ext = (
        ['mp4', 'webm', 'mkv', 'avi', 'mov'].includes(rawExt) ? rawExt : 'mkv'
      ) as 'mp4' | 'webm' | 'mkv' | 'avi' | 'mov';

      const pathSegments = vEntry.relPath.split('/');
      const parentFolder =
        pathSegments.length >= 2 ? pathSegments[pathSegments.length - 2] : group.displayFolderName;

      const { season, episode, cleanEpTitle } =
        autoType === 'series'
          ? parseEpisodeFromFilename(vEntry.file.name, parentFolder, parsedFolderTitle, idx + 1)
          : { season: 1, episode: 1, cleanEpTitle: parsedFolderTitle };

      group.seasons.add(season);

      const videoBase = vEntry.file.name.replace(VIDEO_EXT_REGEX, '');
      const matchedSubs: SubtitleTrack[] = [];

      for (const subEntry of group.subtitles) {
        const lowerSubName = subEntry.file.name.toLowerCase();
        const isVtt = lowerSubName.endsWith('.vtt');
        const isAss = lowerSubName.endsWith('.ass') || lowerSubName.endsWith('.ssa');
        const subBase = subEntry.file.name.replace(SUB_EXT_REGEX, '');

        if (
          subBase === videoBase ||
          subBase.startsWith(videoBase + '.') ||
          group.videos.length === 1
        ) {
          let textContent = await readTextFile(subEntry.file);
          let format: 'srt' | 'vtt' = isVtt ? 'vtt' : 'srt';
          if (isAss && textContent) {
            textContent = convertAssToVtt(textContent);
            format = 'vtt';
          }
          matchedSubs.push({
            id: simpleHash(subEntry.relPath),
            label: `${subEntry.file.name}`,
            language: 'en',
            format,
            rawContent: textContent,
          });
        }
      }

      episodes.push({
        id: epId,
        mediaId,
        title: cleanEpTitle,
        seasonNumber: season,
        episodeNumber: episode,
        fileName: vEntry.file.name,
        relativePath: vEntry.relPath,
        containerFormat: ext,
        fileSizeBytes: vEntry.file.size,
        estimatedDurationSec: autoType === 'movie' ? 7200 : 1440,
        resolutionLabel: /4k|2160p/i.test(group.displayFolderName) ? '4K UHD' : '1080p FHD',
        requiresRemux: ext === 'mkv' || ext === 'avi',
        isSampleSynthetic: false,
        visualTheme: category === 'anime' ? 'fantasy_anime' : 'scifi_cosmos',
        subtitles: matchedSubs,
        audioTracks: [
          {
            id: 'audio-0',
            index: 0,
            label:
              category === 'anime'
                ? 'Original Audio Track (Japanese / Dual Audio)'
                : 'Primary Audio Track (Local File)',
            language: category === 'anime' ? 'ja' : 'en',
            codec: ext === 'mkv' ? 'EAC3 / AAC Stereo' : 'AAC',
            channels: '2.0 Stereo',
          },
        ],
        progress: {
          currentTime: 0,
          duration: autoType === 'movie' ? 7200 : 1440,
          completed: false,
          updatedAt: '',
        },
        clientBlobUrl: URL.createObjectURL(vEntry.file),
        clientFile: vEntry.file,
      });
    }

    const sortedSeasons = Array.from(group.seasons).sort((a, b) => a - b);

    rawItems.push({
      id: mediaId,
      folderName: group.displayFolderName,
      relativePath: group.relativePath,
      title: parsedFolderTitle,
      originalTitle: parsedFolderTitle,
      synopsis:
        episodes.length === 0
          ? `Empty media folder "${group.displayFolderName}" (0 video files).`
          : `Local ${autoType} loaded from folder "${group.displayFolderName}" (${episodes.length} ${
              episodes.length === 1 ? 'video file' : 'episodes'
            }).`,
      releaseYear: year,
      autoType,
      category,
      isManualCategory: false,
      posterUrl: localPosterUrl,
      bannerUrl: localPosterUrl,
      genres: [category === 'anime' ? 'Anime' : category === 'tv' ? 'TV Series' : 'Movie'],
      metadataProvider: 'local',
      isFavorite: false,
      episodes,
      seasons: sortedSeasons,
      totalEpisodes: episodes.length,
      watchedEpisodes: 0,
      isClientPickedFolder: true,
    });
  }

  // Batch-enrich all folder items (including empty folders!) with AniList (for Anime) and TMDB (for Movies & TV)
  if (rawItems.length > 0) {
    try {
      const res = await fetch('/api/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: rawItems.map((item) => ({
            id: item.id,
            title: item.originalTitle,
            category: item.category,
          })),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const enrichedMap: Record<string, ExternalMetadataMatch> = data?.enriched || {};
        for (const item of rawItems) {
          const match = enrichedMap[item.id];
          if (match) {
            item.title = match.title || item.title;
            item.synopsis = match.synopsis || item.synopsis;
            item.posterUrl = item.posterUrl || match.posterUrl;
            item.bannerUrl = match.bannerUrl || match.posterUrl || item.posterUrl;
            item.releaseYear = match.releaseYear || item.releaseYear;
            item.genres = match.genres?.length ? match.genres : item.genres;
            item.ratingScore = match.ratingScore;
            item.studioOrNetwork = match.studioOrNetwork;
            item.metadataProvider = match.provider;
            item.externalId = match.externalId;

            if (
              match.provider === 'anilist' ||
              match.mediaType === 'ANIME' ||
              match.isAnimeCandidate
            ) {
              item.category = 'anime';
            }
          }
        }
      }
    } catch {
      // Continue with local folder info if offline
    }
  }

  return { rootFolderName, items: rawItems, totalVideoFiles };
}

/**
 * Parses a FileList from <input type="file" webkitdirectory multiple /> into MediaItem[]
 */
export async function buildLibraryFromPickedFiles(
  fileList: FileList | File[]
): Promise<{ rootFolderName: string; items: MediaItem[]; totalVideoFiles: number }> {
  const rawFiles = Array.from(fileList);
  if (rawFiles.length === 0) {
    return { rootFolderName: 'Selected Folder', items: [], totalVideoFiles: 0 };
  }

  const firstRel = (rawFiles[0].webkitRelativePath || rawFiles[0].name).replace(/\\/g, '/');
  const rootFolderName = firstRel.includes('/') ? firstRel.split('/')[0] : 'Selected Local Folder';

  const directoriesSet = new Set<string>();
  const files: { file: File; relPath: string }[] = [];

  for (const file of rawFiles) {
    const rel = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
    files.push({ file, relPath: rel });
    const parts = rel.split('/').filter(Boolean);
    for (let i = 2; i < parts.length; i++) {
      directoriesSet.add(parts.slice(0, i).join('/'));
    }
  }

  return buildLibraryFromScannedEntries({
    files,
    directories: Array.from(directoriesSet),
    rootFolderName,
  });
}

/**
 * Uses the native File System Access API (window.showDirectoryPicker) to read a directory handle,
 * discovering ALL subdirectories (including completely empty media folders and empty Season folders!).
 */
export async function buildLibraryFromDirectoryHandle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dirHandle: any
): Promise<{ rootFolderName: string; items: MediaItem[]; totalVideoFiles: number }> {
  const rootFolderName: string = dirHandle.name || 'Selected Folder';
  const directories: string[] = [];
  const files: { file: File; relPath: string }[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walkHandle = async (handle: any, currentPath: string) => {
    for await (const entry of handle.values()) {
      if (entry.name.startsWith('.')) continue;
      const entryPath = `${currentPath}/${entry.name}`;
      if (entry.kind === 'directory') {
        directories.push(entryPath);
        await walkHandle(entry, entryPath);
      } else if (entry.kind === 'file') {
        try {
          const file: File = await entry.getFile();
          files.push({ file, relPath: entryPath });
        } catch {
          // ignore unreadable system files
        }
      }
    }
  };

  await walkHandle(dirHandle, rootFolderName);

  return buildLibraryFromScannedEntries({
    files,
    directories,
    rootFolderName,
  });
}

/**
 * Reads dropped folders/files from a Drag-and-Drop event using DataTransferItem.webkitGetAsEntry(),
 * which works inside cross-origin iframes AND discovers completely empty media folders and empty Season folders!
 */
export async function buildLibraryFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<{ rootFolderName: string; items: MediaItem[]; totalVideoFiles: number } | null> {
  const items = dataTransfer.items;
  if (!items || items.length === 0) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rootEntries: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry = (item as any).webkitGetAsEntry?.();
      if (entry) {
        rootEntries.push(entry);
      }
    }
  }

  if (rootEntries.length === 0) return null;

  const directories: string[] = [];
  const files: { file: File; relPath: string }[] = [];

  // Helper to read all entries from a DirectoryReader (looping until empty array per spec)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readAllDirectoryEntries = async (dirReader: any): Promise<any[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const batch: any[] = await new Promise((resolve) => {
        dirReader.readEntries(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (entries: any[]) => resolve(entries || []),
          () => resolve([])
        );
      });
      if (batch.length === 0) break;
      all.push(...batch);
    }
    return all;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walkEntry = async (entry: any, currentPath: string) => {
    if (!entry || entry.name.startsWith('.')) return;
    if (entry.isDirectory) {
      directories.push(currentPath);
      const reader = entry.createReader();
      const children = await readAllDirectoryEntries(reader);
      for (const child of children) {
        await walkEntry(child, `${currentPath}/${child.name}`);
      }
    } else if (entry.isFile) {
      await new Promise<void>((resolve) => {
        entry.file(
          (file: File) => {
            files.push({ file, relPath: currentPath });
            resolve();
          },
          () => resolve()
        );
      });
    }
  };

  let rootFolderName = 'Dropped Media';
  if (rootEntries.length === 1 && rootEntries[0].isDirectory) {
    // User dropped a single parent folder (e.g., "media" or "Kingdom [Anime]")
    rootFolderName = rootEntries[0].name;
    const reader = rootEntries[0].createReader();
    const children = await readAllDirectoryEntries(reader);
    if (children.length === 0) {
      // The dropped root folder itself is completely empty!
      directories.push(`${rootFolderName}/${rootFolderName}`);
    } else {
      for (const child of children) {
        await walkEntry(child, `${rootFolderName}/${child.name}`);
      }
    }
  } else {
    // User dropped multiple show folders at once (e.g., selected both "Kingdom [Anime]" and "Yellowjackets")
    rootFolderName = 'Local Media';
    for (const entry of rootEntries) {
      await walkEntry(entry, `${rootFolderName}/${entry.name}`);
    }
  }

  return buildLibraryFromScannedEntries({
    files,
    directories,
    rootFolderName,
  });
}
