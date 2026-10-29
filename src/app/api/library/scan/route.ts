import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  buildCapabilities,
  ensureInitialized,
  getHydratedClientCatalogSnapshot,
  getLanNetworkInfo,
  getUserPreferences,
  getWatchHistory,
  saveState,
  saveUserPreferences,
  scanLibraryWithMetadata,
} from '@/src/lib/mediaServer';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const state = await ensureInitialized();
  const body = await request.json().catch(() => ({}));
  const {
    rootPath,
    addFolderPath,
    removeFolderPath,
    setActiveSourceMode,
  } = body as {
    rootPath?: string;
    addFolderPath?: string;
    removeFolderPath?: string;
    setActiveSourceMode?: 'server' | 'client';
  };

  if (rootPath && typeof rootPath === 'string') {
    const resolved = path.resolve(rootPath.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return NextResponse.json(
        {
          error: `The folder path "${resolved}" does not exist or is not a readable directory on this PC.`,
        },
        { status: 400 }
      );
    }
    state.rootPath = resolved;
    saveState(state);
    saveUserPreferences({ activeSourceMode: 'server' });
  }

  if (addFolderPath && typeof addFolderPath === 'string') {
    const resolved = path.resolve(addFolderPath.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return NextResponse.json(
        {
          error: `The folder path "${resolved}" does not exist or is not a readable directory on this PC.`,
        },
        { status: 400 }
      );
    }
    const existing = state.additionalFolders || [];
    if (resolved !== path.resolve(state.rootPath) && !existing.includes(resolved)) {
      state.additionalFolders = [...existing, resolved];
      saveState(state);
    }
    saveUserPreferences({ activeSourceMode: 'server' });
  }

  if (removeFolderPath && typeof removeFolderPath === 'string') {
    const resolved = path.resolve(removeFolderPath.trim());
    state.additionalFolders = (state.additionalFolders || []).filter(
      (f) => path.resolve(f) !== resolved
    );
    saveState(state);
  }

  if (setActiveSourceMode === 'server' || setActiveSourceMode === 'client') {
    saveUserPreferences({ activeSourceMode: setActiveSourceMode });
  }

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
