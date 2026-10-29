import { NextRequest, NextResponse } from 'next/server';
import {
  buildCapabilities,
  ensureInitialized,
  getHydratedClientCatalogSnapshot,
  getLanNetworkInfo,
  getUserPreferences,
  getWatchHistory,
  scanLibraryWithMetadata,
} from '@/src/lib/mediaServer';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const state = await ensureInitialized();
  const { items, totalFilesScanned, folderSummaries } = await scanLibraryWithMetadata(state);
  const clientSnapshot = getHydratedClientCatalogSnapshot(state);
  const preferences = getUserPreferences();
  const watchHistory = getWatchHistory(60);
  const networkInfo = getLanNetworkInfo(request);

  return NextResponse.json({
    items,
    clientSnapshot,
    capabilities: buildCapabilities(state, totalFilesScanned, folderSummaries),
    preferences,
    watchHistory,
    networkInfo,
  });
}
