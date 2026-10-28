import { NextRequest, NextResponse } from 'next/server';
import {
  autoResolveMetadataForTitle,
  searchAniListAnime,
  searchTmdbMedia,
} from '@/src/lib/metadataProviders';
import { MediaCategory } from '@/src/types/media';

export const dynamic = 'force-dynamic';

/**
 * GET /api/metadata?q=Frieren&provider=anilist|tmdb_movie|tmdb_tv
 * Interactive search endpoint for matching Anime via AniList or Movies/TV via TMDB.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = (searchParams.get('q') || '').trim();
  const provider = searchParams.get('provider') || 'anilist';

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  if (provider === 'anilist') {
    const results = await searchAniListAnime(query, 6);
    return NextResponse.json({ results });
  }

  if (provider === 'tmdb_tv') {
    const results = await searchTmdbMedia(query, 'tv', 6);
    return NextResponse.json({ results });
  }

  const results = await searchTmdbMedia(query, 'movie', 6);
  return NextResponse.json({ results });
}

/**
 * POST /api/metadata
 * Batch auto-enrichment endpoint for client-picked local folders or server folders.
 * Body: { items: [{ id, title, category }] }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const items: { id: string; title: string; category: MediaCategory }[] = Array.isArray(body?.items)
    ? body.items
    : [];

  const enriched: Record<string, Awaited<ReturnType<typeof autoResolveMetadataForTitle>>> = {};

  await Promise.all(
    items.slice(0, 24).map(async (entry) => {
      const match = await autoResolveMetadataForTitle(entry.title, entry.category);
      if (match) {
        enriched[entry.id] = match;
      }
    })
  );

  return NextResponse.json({ enriched });
}
