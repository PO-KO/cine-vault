import { NextRequest, NextResponse } from 'next/server';
import {
  ensureInitialized,
  getHydratedClientCatalogSnapshot,
  saveState,
  scanLibraryWithMetadata,
} from '@/src/lib/mediaServer';
import { ExternalMetadataMatch, MediaCategory } from '@/src/types/media';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const state = await ensureInitialized();
  const body = await request.json().catch(() => ({}));
  const {
    title,
    category,
    synopsis,
    customPosterUrl,
    isFavorite,
    externalMatch,
  } = body as {
    title?: string;
    category?: MediaCategory;
    synopsis?: string;
    customPosterUrl?: string;
    isFavorite?: boolean;
    externalMatch?: ExternalMetadataMatch;
  };

  if (externalMatch) {
    if (!state.externalMetadataCache) state.externalMetadataCache = {};
    state.externalMetadataCache[id] = externalMatch;
  }

  if (typeof title === 'string') {
    if (title.trim()) {
      state.customTitles[id] = title.trim();
    } else {
      delete state.customTitles[id];
    }
  }

  if (category && ['anime', 'tv', 'movies', 'other'].includes(category)) {
    const previousCat = state.manualCategories[id];
    state.manualCategories[id] = category;
    if (!externalMatch && previousCat !== category && state.externalMetadataCache?.[id]) {
      delete state.externalMetadataCache[id];
    }
  }

  if (typeof synopsis === 'string') {
    if (synopsis.trim()) {
      state.customSynopses[id] = synopsis.trim();
    } else {
      delete state.customSynopses[id];
    }
  }

  if (typeof customPosterUrl === 'string') {
    if (customPosterUrl.trim()) {
      state.customPosters[id] = customPosterUrl.trim();
    } else {
      delete state.customPosters[id];
    }
  }

  if (typeof isFavorite === 'boolean') {
    if (isFavorite) {
      state.favorites[id] = true;
    } else {
      delete state.favorites[id];
    }
  }

  saveState(state);
  const { items } = await scanLibraryWithMetadata(state);
  const clientSnapshot = getHydratedClientCatalogSnapshot(state);
  const updatedItem =
    items.find((item) => item.id === id) ||
    clientSnapshot?.items.find((item) => item.id === id);

  return NextResponse.json({
    item: updatedItem,
    items,
    clientSnapshot,
  });
}
