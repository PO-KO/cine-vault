import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import {
  ensureInitialized,
  getEpisodeEntry,
  isFfmpegAvailable,
} from '@/src/lib/mediaServer';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ episodeId: string }> }
) {
  const { episodeId } = await context.params;
  const state = await ensureInitialized();
  const epEntry = getEpisodeEntry(episodeId, state);

  if (!epEntry || !fs.existsSync(epEntry.fullPath)) {
    return NextResponse.json({ error: 'Video file not found on disk' }, { status: 404 });
  }

  const resolvedFile = path.resolve(epEntry.fullPath);
  const resolvedRoot = path.resolve(state.rootPath);
  if (!resolvedFile.startsWith(resolvedRoot)) {
    return NextResponse.json(
      { error: 'Access denied outside configured root directory' },
      { status: 403 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const forceRemux =
    searchParams.get('remux') === '1' ||
    epEntry.containerFormat === 'mkv' ||
    epEntry.containerFormat === 'avi';
  const audioTrackIndex = parseInt(searchParams.get('audioTrack') || '0', 10) || 0;

  if (forceRemux && isFfmpegAvailable() && !epEntry.isSampleSynthetic) {
    const ffmpegArgs = [
      '-i',
      resolvedFile,
      '-map',
      '0:v:0',
      '-map',
      `0:a:${audioTrackIndex}?`,
      '-c:v',
      epEntry.containerFormat === 'avi' ? 'libx264' : 'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      'frag_keyframe+empty_moov+default_base_moof',
      '-f',
      'mp4',
      'pipe:1',
    ];

    const ffProcess = spawn('ffmpeg', ffmpegArgs);
    const webStream = Readable.toWeb(ffProcess.stdout) as ReadableStream;
    request.signal.addEventListener('abort', () => {
      ffProcess.kill('SIGKILL');
    });

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-cache',
      },
    });
  }

  const stat = fs.statSync(resolvedFile);
  const fileSize = stat.size;
  const range = request.headers.get('range');

  const mimeTypes: Record<string, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
  };
  const contentType = mimeTypes[epEntry.containerFormat] || 'video/mp4';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${fileSize}`,
        },
      });
    }

    const chunkSize = end - start + 1;
    const nodeStream = fs.createReadStream(resolvedFile, { start, end });
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new NextResponse(webStream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': contentType,
      },
    });
  }

  const nodeStream = fs.createReadStream(resolvedFile);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Length': String(fileSize),
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    },
  });
}
