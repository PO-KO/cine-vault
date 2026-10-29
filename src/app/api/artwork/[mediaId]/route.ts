import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  ensureInitialized,
  getArtworkFilePath,
  isPathAllowedInLibrary,
} from '@/src/lib/mediaServer';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ mediaId: string }> }
) {
  const { mediaId } = await context.params;
  const state = await ensureInitialized();
  const artPath = getArtworkFilePath(mediaId, state);

  if (!artPath || !fs.existsSync(artPath) || !isPathAllowedInLibrary(artPath, state)) {
    return new NextResponse('Artwork not found', { status: 404 });
  }

  const ext = path.extname(artPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
  };

  const fileBuffer = fs.readFileSync(artPath);
  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      'Content-Type': mimeMap[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
