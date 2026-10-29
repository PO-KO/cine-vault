import { NextRequest, NextResponse } from 'next/server';
import {
  ensureInitialized,
  getUserPreferences,
  getWatchHistory,
  saveClientCatalogSnapshotToDb,
} from '@/src/lib/mediaServer';
import { MediaItem } from '@/src/types/media';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const state = await ensureInitialized();
  const body = await request.json().catch(() => ({}));
  const { rootFolderName, items, totalVideoFiles } = body as {
    rootFolderName?: string;
    items?: MediaItem[];
    totalVideoFiles?: number;
  };

  if (!rootFolderName || !Array.isArray(items)) {
    return NextResponse.json(
      { error: 'Invalid client library snapshot payload' },
      { status: 400 }
    );
  }

  const snapshot = saveClientCatalogSnapshotToDb(
    {
      rootFolderName,
      items,
      totalVideoFiles: typeof totalVideoFiles === 'number' ? totalVideoFiles : items.length,
    },
    state
  );

  return NextResponse.json({
    clientSnapshot: snapshot,
    preferences: getUserPreferences(),
    watchHistory: getWatchHistory(60),
  });
}
