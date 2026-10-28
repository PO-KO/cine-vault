import {
  ExternalMetadataMatch,
  MediaCategory,
  MediaEpisode,
  MediaItem,
  SubtitleTrack,
} from '../types/media';

const VIDEO_EXT_REGEX = /\.(mp4|webm|mkv|avi|mov)$/i;
const SUB_EXT_REGEX = /\.(srt|vtt)$/i;
const IMAGE_NAME_REGEX = /^(poster|cover|folder)\.(jpg|jpeg|png|webp|svg)$/i;

function simpleHash(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'local-' + (h >>> 0).toString(16);
}

function cleanFolderTitle(rawName: string): {
  title: string;
  year: string;
  autoCategoryHint: MediaCategory | null;
} {
  const withoutExt = rawName.replace(VIDEO_EXT_REGEX, '');
  let autoCategoryHint: MediaCategory | null = null;
  if (/\[anime\]|anime|subsplease|erai-raws|horriblesubs/i.test(withoutExt)) {
    autoCategoryHint = 'anime';
  }
  const yearMatch = withoutExt.match(/\((\d{4})\)/) || withoutExt.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : '2024';

  const cleaned = withoutExt
    .replace(/\[.*?\]/g, '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/\b(1080p|720p|2160p|4k|bluray|web-dl|webrip|x264|x265|hevc|aac|flac)\b.*/i, '')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { title: cleaned || rawName, year, autoCategoryHint };
}

function parseEpisodeFromFilename(
  fileName: string,
  parentFolder: string,
  fallbackIndex: number
): { season: number; episode: number; cleanEpTitle: string } {
  const seMatch =
    fileName.match(/S(\d{1,2})E(\d{1,3})/i) || fileName.match(/(\d{1,2})x(\d{1,3})/i);
  let season = 1;
  let episode = fallbackIndex;

  const parentSeason = parentFolder.match(/Season\s*(\d{1,2})/i);
  if (parentSeason) {
    season = parseInt(parentSeason[1], 10);
  }

  if (seMatch) {
    season = parseInt(seMatch[1], 10);
    episode = parseInt(seMatch[2], 10);
  } else {
    const dashEp = fileName.match(/[-–]\s*(\d{1,3})\b/) || fileName.match(/Episode\s*(\d{1,3})/i);
    if (dashEp) {
      episode = parseInt(dashEp[1], 10);
    }
  }

  let cleanEpTitle = fileName
    .replace(VIDEO_EXT_REGEX, '')
    .replace(/\[.*?\]/g, '')
    .replace(/.*?S\d{1,2}E\d{1,3}\s*[-–:]?\s*/i, '')
    .replace(/[._]/g, ' ')
    .trim();

  if (!cleanEpTitle) {
    cleanEpTitle = `Episode ${episode}`;
  }

  return { season, episode, cleanEpTitle };
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsText(file);
  });
}

/**
 * Parses a FileList from <input type="file" webkitdirectory multiple /> into MediaItem[]
 * and automatically enriches Anime via AniList and Movies/TV Shows via TMDB.
 */
export async function buildLibraryFromPickedFiles(
  fileList: FileList
): Promise<{ rootFolderName: string; items: MediaItem[]; totalVideoFiles: number }> {
  const files = Array.from(fileList);
  if (files.length === 0) {
    return { rootFolderName: 'Selected Folder', items: [], totalVideoFiles: 0 };
  }

  const firstRel = files[0].webkitRelativePath || files[0].name;
  const rootFolderName = firstRel.includes('/') ? firstRel.split('/')[0] : 'Selected Local Folder';

  // Group files by top-level entry inside the picked folder
  const groups = new Map<
    string,
    {
      videos: { file: File; relPath: string }[];
      subtitles: { file: File; relPath: string }[];
      artworkFile?: File;
    }
  >();

  let totalVideoFiles = 0;

  for (const file of files) {
    const rel = file.webkitRelativePath || file.name;
    const parts = rel.split('/').filter(Boolean);
    // parts[0] is rootFolderName; parts[1] is top-level subfolder or standalone file
    const topKey = parts.length >= 3 ? parts[1] : parts[parts.length - 1];

    if (!groups.has(topKey)) {
      groups.set(topKey, { videos: [], subtitles: [] });
    }
    const group = groups.get(topKey)!;

    if (VIDEO_EXT_REGEX.test(file.name)) {
      group.videos.push({ file, relPath: rel });
      totalVideoFiles++;
    } else if (SUB_EXT_REGEX.test(file.name)) {
      group.subtitles.push({ file, relPath: rel });
    } else if (IMAGE_NAME_REGEX.test(file.name) && !group.artworkFile) {
      group.artworkFile = file;
    }
  }

  const rawItems: MediaItem[] = [];

  for (const [entryKey, group] of groups.entries()) {
    if (group.videos.length === 0) continue;

    group.videos.sort((a, b) =>
      a.relPath.localeCompare(b.relPath, undefined, { numeric: true, sensitivity: 'base' })
    );

    const mediaId = simpleHash(`${rootFolderName}/${entryKey}`);
    const { title: parsedTitle, year, autoCategoryHint } = cleanFolderTitle(entryKey);

    const hasSeasonStructure = group.videos.some((v) =>
      /season\s*\d+|s\d{1,2}e\d{1,3}/i.test(v.relPath)
    );
    const autoType: 'movie' | 'series' =
      group.videos.length > 1 || hasSeasonStructure ? 'series' : 'movie';

    const category: MediaCategory =
      autoCategoryHint || (autoType === 'series' ? 'tv' : 'movies');

    const localPosterUrl = group.artworkFile ? URL.createObjectURL(group.artworkFile) : '';

    const episodes: MediaEpisode[] = [];
    for (let idx = 0; idx < group.videos.length; idx++) {
      const vEntry = group.videos[idx];
      const epId = simpleHash(vEntry.relPath);
      const extMatch = vEntry.file.name.match(/\.([a-z0-9]+)$/i);
      const ext = (extMatch ? extMatch[1].toLowerCase() : 'mp4') as
        | 'mp4'
        | 'webm'
        | 'mkv'
        | 'avi'
        | 'mov';
      const pathSegments = vEntry.relPath.split('/');
      const parentFolder =
        pathSegments.length >= 2 ? pathSegments[pathSegments.length - 2] : entryKey;

      const { season, episode, cleanEpTitle } =
        autoType === 'series'
          ? parseEpisodeFromFilename(vEntry.file.name, parentFolder, idx + 1)
          : { season: 1, episode: 1, cleanEpTitle: parsedTitle };

      // Match external .srt/.vtt subtitles in the same folder
      const videoBase = vEntry.file.name.replace(VIDEO_EXT_REGEX, '');
      const matchedSubs: SubtitleTrack[] = [];

      for (const subEntry of group.subtitles) {
        const subExt = subEntry.file.name.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt';
        const subBase = subEntry.file.name.replace(SUB_EXT_REGEX, '');
        if (
          subBase === videoBase ||
          subBase.startsWith(videoBase + '.') ||
          group.videos.length === 1
        ) {
          const textContent = await readTextFile(subEntry.file);
          matchedSubs.push({
            id: simpleHash(subEntry.relPath),
            label: `${subEntry.file.name} (${subExt.toUpperCase()})`,
            language: 'en',
            format: subExt,
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
        resolutionLabel: /4k|2160p/i.test(vEntry.file.name) ? '4K UHD' : '1080p FHD',
        requiresRemux: false,
        isSampleSynthetic: false,
        visualTheme: 'scifi_cosmos',
        subtitles: matchedSubs,
        audioTracks: [
          {
            id: 'audio-0',
            index: 0,
            label: 'Primary Audio Track (Local File)',
            language: 'en',
            codec: 'AAC',
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
      });
    }

    rawItems.push({
      id: mediaId,
      folderName: entryKey,
      relativePath: `${rootFolderName}/${entryKey}`,
      title: parsedTitle,
      originalTitle: parsedTitle,
      synopsis: `Local ${autoType} loaded from "${rootFolderName}/${entryKey}" (${episodes.length} ${
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
      totalEpisodes: episodes.length,
      watchedEpisodes: 0,
      isClientPickedFolder: true,
    });
  }

  // Automatically batch-enrich all picked items with AniList (for Anime) and TMDB (for Movies & TV)
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
          }
        }
      }
    } catch {
      // Continue with local folder info if offline
    }
  }

  return { rootFolderName, items: rawItems, totalVideoFiles };
}
