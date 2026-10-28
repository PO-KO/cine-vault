import { ExternalMetadataMatch, MediaCategory } from '../types/media';

const TMDB_GENRES: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
  10759: 'Action & Adventure',
  10762: 'Kids',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
};

export function stripHtmlTags(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/\(Source:.*?\)/gi, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Search AniList GraphQL API (https://graphql.anilist.co) for Anime metadata:
 * Posters, Banner, Story/Synopsis, Genres, Score, Year, and Studio.
 */
export async function searchAniListAnime(
  query: string,
  limit = 6
): Promise<ExternalMetadataMatch[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const graphqlQuery = `
    query ($search: String, $perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          title {
            english
            romaji
            native
          }
          description(asHtml: false)
          seasonYear
          startDate {
            year
          }
          genres
          averageScore
          bannerImage
          coverImage {
            extraLarge
            large
          }
          studios(isMain: true) {
            nodes {
              name
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: graphqlQuery,
        variables: { search: cleanQuery, perPage: limit },
      }),
    });

    if (!response.ok) return [];
    const json = await response.json();
    const mediaList = json?.data?.Page?.media;
    if (!Array.isArray(mediaList)) return [];

    return mediaList.map((m) => {
      const displayTitle = m.title?.english || m.title?.romaji || m.title?.native || cleanQuery;
      const romajiTitle = m.title?.romaji || displayTitle;
      const year = String(m.seasonYear || m.startDate?.year || '2024');
      const studio = m.studios?.nodes?.[0]?.name || 'Anime Studio';

      return {
        provider: 'anilist' as const,
        externalId: String(m.id),
        title: displayTitle,
        originalTitle: romajiTitle,
        synopsis: stripHtmlTags(m.description) || `Anime series produced by ${studio}.`,
        posterUrl: m.coverImage?.extraLarge || m.coverImage?.large || '',
        bannerUrl: m.bannerImage || m.coverImage?.extraLarge || '',
        releaseYear: year,
        genres: Array.isArray(m.genres) ? m.genres.slice(0, 4) : ['Anime'],
        ratingScore: typeof m.averageScore === 'number' ? m.averageScore : undefined,
        studioOrNetwork: studio,
        mediaType: 'ANIME' as const,
      };
    });
  } catch (err) {
    console.error('AniList GraphQL query error:', err);
    return [];
  }
}

/**
 * Search TMDB API for Movies and TV Shows (with automatic fallback when TMDB_API_KEY is not configured).
 */
export async function searchTmdbMedia(
  query: string,
  targetType: 'movie' | 'tv' = 'movie',
  limit = 6
): Promise<ExternalMetadataMatch[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const tmdbKey = (process.env.TMDB_API_KEY || '').trim();

  // 1. If TMDB_API_KEY is configured, query official TMDB v3 API
  if (tmdbKey && tmdbKey !== 'MY_TMDB_API_KEY') {
    try {
      const isBearerToken = tmdbKey.length > 45 || tmdbKey.startsWith('eyJ');
      const endpoint = targetType === 'tv' ? 'tv' : 'movie';
      const url = new URL(`https://api.themoviedb.org/3/search/${endpoint}`);
      url.searchParams.set('query', cleanQuery);
      url.searchParams.set('include_adult', 'false');
      url.searchParams.set('language', 'en-US');
      url.searchParams.set('page', '1');
      if (!isBearerToken) {
        url.searchParams.set('api_key', tmdbKey);
      }

      const res = await fetch(url.toString(), {
        headers: isBearerToken
          ? {
              Authorization: `Bearer ${tmdbKey}`,
              Accept: 'application/json',
            }
          : { Accept: 'application/json' },
      });

      if (res.ok) {
        const data = await res.json();
        const results = Array.isArray(data?.results) ? data.results.slice(0, limit) : [];
        if (results.length > 0) {
          return results.map((item) => {
            const title = item.title || item.name || cleanQuery;
            const origTitle = item.original_title || item.original_name || title;
            const dateStr = item.release_date || item.first_air_date || '';
            const year = dateStr ? dateStr.slice(0, 4) : '2024';
            const genres = Array.isArray(item.genre_ids)
              ? item.genre_ids.map((id: number) => TMDB_GENRES[id]).filter(Boolean).slice(0, 4)
              : [];

            return {
              provider: 'tmdb' as const,
              externalId: String(item.id),
              title,
              originalTitle: origTitle,
              synopsis: item.overview || `${title} (${year})`,
              posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w780${item.poster_path}` : '',
              bannerUrl: item.backdrop_path
                ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
                : item.poster_path
                ? `https://image.tmdb.org/t/p/w780${item.poster_path}`
                : '',
              releaseYear: year,
              genres: genres.length > 0 ? genres : [targetType === 'tv' ? 'TV Series' : 'Movie'],
              ratingScore:
                typeof item.vote_average === 'number' && item.vote_average > 0
                  ? Math.round(item.vote_average * 10)
                  : undefined,
              studioOrNetwork: 'TMDB Catalog',
              mediaType: targetType === 'tv' ? ('TV' as const) : ('MOVIE' as const),
            };
          });
        }
      }
    } catch (err) {
      console.error('TMDB search error:', err);
    }
  }

  // 2. Keyless public Movie & TV Show fallback so Movies & TV Shows work out-of-the-box even without TMDB_API_KEY
  if (targetType === 'tv') {
    try {
      const res = await fetch(
        `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(cleanQuery)}`
      );
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list.length > 0) {
          return list.slice(0, limit).map((entry) => {
            const show = entry.show || {};
            const year = show.premiered ? String(show.premiered).slice(0, 4) : '2024';
            const rating =
              typeof show.rating?.average === 'number'
                ? Math.round(show.rating.average * 10)
                : undefined;
            const network = show.network?.name || show.webChannel?.name || 'Television Network';
            const poster = show.image?.original || show.image?.medium || '';

            return {
              provider: 'tmdb' as const,
              externalId: `tv-${show.id}`,
              title: show.name || cleanQuery,
              originalTitle: show.name || cleanQuery,
              synopsis: stripHtmlTags(show.summary) || `Television series on ${network}.`,
              posterUrl: poster ? poster.replace(/^http:/, 'https:') : '',
              bannerUrl: poster ? poster.replace(/^http:/, 'https:') : '',
              releaseYear: year,
              genres:
                Array.isArray(show.genres) && show.genres.length > 0
                  ? show.genres.slice(0, 4)
                  : ['Drama', 'TV Series'],
              ratingScore: rating,
              studioOrNetwork: network,
              mediaType: 'TV' as const,
            };
          });
        }
      }
    } catch (err) {
      console.error('TV fallback metadata error:', err);
    }
  } else {
    try {
      const sugRes = await fetch(
        `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(
          cleanQuery.toLowerCase()
        )}.json`
      );
      if (sugRes.ok) {
        const sugData = await sugRes.json();
        const items = Array.isArray(sugData?.d)
          ? sugData.d.filter((x: { i?: { imageUrl?: string }; qid?: string }) => x.i?.imageUrl && (!x.qid || x.qid === 'movie' || x.qid === 'tvMovie')).slice(0, limit)
          : [];

        if (items.length > 0) {
          const results: ExternalMetadataMatch[] = await Promise.all(
            items.map(
              async (
                m: {
                  id: string;
                  l: string;
                  y?: number;
                  s?: string;
                  i?: { imageUrl?: string };
                },
                idx: number
              ) => {
                const title = m.l || cleanQuery;
                const year = m.y ? String(m.y) : '2024';
                const posterUrl = m.i?.imageUrl || '';
                let synopsis = m.s
                  ? `${title} (${year}) — Starring ${m.s}.`
                  : `Feature film (${year}).`;

                // Fetch full plot synopsis for the top results from Wikipedia REST summary
                if (idx < 2) {
                  try {
                    const wikiSlug = encodeURIComponent(title.replace(/\s+/g, '_'));
                    const wikiRes = await fetch(
                      `https://en.wikipedia.org/api/rest_v1/page/summary/${wikiSlug}`
                    );
                    if (wikiRes.ok) {
                      const wikiJson = await wikiRes.json();
                      if (wikiJson?.extract && wikiJson.extract.length > 40) {
                        synopsis = wikiJson.extract;
                      }
                    }
                  } catch {
                    // keep fallback synopsis
                  }
                }

                return {
                  provider: 'tmdb' as const,
                  externalId: String(m.id || title),
                  title,
                  originalTitle: title,
                  synopsis,
                  posterUrl,
                  bannerUrl: posterUrl,
                  releaseYear: year,
                  genres: ['Feature Film', 'Cinema'],
                  ratingScore: 86,
                  studioOrNetwork: m.s ? `Cast: ${m.s}` : 'Theatrical Release',
                  mediaType: 'MOVIE' as const,
                };
              }
            )
          );
          return results;
        }
      }
    } catch (err) {
      console.error('Movie fallback metadata error:', err);
    }
  }

  return [];
}

/**
 * Automatically enrich a title based on its category ('anime' -> AniList, 'tv' -> TMDB TV, 'movies' -> TMDB Movie)
 */
export async function autoResolveMetadataForTitle(
  title: string,
  category: MediaCategory
): Promise<ExternalMetadataMatch | null> {
  if (category === 'anime') {
    const matches = await searchAniListAnime(title, 1);
    return matches[0] || null;
  }
  if (category === 'tv') {
    const matches = await searchTmdbMedia(title, 'tv', 1);
    return matches[0] || null;
  }
  if (category === 'movies') {
    const matches = await searchTmdbMedia(title, 'movie', 1);
    return matches[0] || null;
  }
  return null;
}
