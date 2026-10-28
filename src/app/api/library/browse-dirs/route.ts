import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { ensureInitialized, VIDEO_EXTENSIONS } from '@/src/lib/mediaServer';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const state = await ensureInitialized();
  const body = await request.json().catch(() => ({}));
  const requestedPath = body?.path ? path.resolve(String(body.path)) : state.rootPath;
  const targetPath =
    fs.existsSync(requestedPath) && fs.statSync(requestedPath).isDirectory()
      ? requestedPath
      : state.rootPath;

  const parentPath = path.dirname(targetPath) !== targetPath ? path.dirname(targetPath) : null;

  const directories: { name: string; fullPath: string; videoCountHint: number }[] = [];
  try {
    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.next') continue;
      const fullDir = path.join(targetPath, entry.name);
      let videoCountHint = 0;
      try {
        const children = fs.readdirSync(fullDir);
        videoCountHint = children.filter((c) => VIDEO_EXTENSIONS.has(path.extname(c).toLowerCase())).length;
      } catch {
        videoCountHint = 0;
      }
      directories.push({
        name: entry.name,
        fullPath: fullDir,
        videoCountHint,
      });
    }
  } catch (err) {
    console.error('Failed browsing directory:', err);
  }

  return NextResponse.json({
    currentPath: targetPath,
    parentPath,
    directories: directories.sort((a, b) => a.name.localeCompare(b.name)),
  });
}
