import { NextResponse } from 'next/server';
import {
  buildCapabilities,
  ensureInitialized,
  scanLibraryWithMetadata,
} from '@/src/lib/mediaServer';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await ensureInitialized();
  const { items, totalFilesScanned } = await scanLibraryWithMetadata(state);
  return NextResponse.json({
    items,
    capabilities: buildCapabilities(state, totalFilesScanned),
  });
}
