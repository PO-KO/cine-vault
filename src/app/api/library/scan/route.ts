import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  buildCapabilities,
  ensureInitialized,
  saveState,
  scanLibrary,
} from '@/src/lib/mediaServer';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const state = await ensureInitialized();
  const body = await request.json().catch(() => ({}));
  const { rootPath } = body as { rootPath?: string };

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
  }

  const { items, totalFilesScanned } = scanLibrary(state);
  return NextResponse.json({
    items,
    capabilities: buildCapabilities(state, totalFilesScanned),
  });
}
