import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, saveState, scanLibrary } from '@/src/lib/mediaServer';
import { MediaCategory } from '@/src/types/media';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const state = await ensureInitialized();
  const body = await request.json().catch(() => ({}));
  const { title, category, synopsis, customPosterUrl, isFavorite } = body as {
    title?: string;
    category?: MediaCategory;
    synopsis?: string;
    customPosterUrl?: string;
    isFavorite?: boolean;
  };

  if (typeof title === 'string') {
    if (title.trim()) {
      state.customTitles[id] = title.trim();
    } else {
      delete state.customTitles[id];
    }
  }

  if (category && ['anime', 'tv', 'movies', 'other'].includes(category)) {
    state.manualCategories[id] = category;
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
  const { items } = scanLibrary(state);
  const updatedItem = items.find((item) => item.id === id);
  return NextResponse.json({ item: updatedItem, items });
}
