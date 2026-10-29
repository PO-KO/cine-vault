import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import {
  ensureInitialized,
  getEpisodeEntry,
  isFfmpegAvailable,
  isPathAllowedInLibrary,
  verifyRequestLanAccess,
} from '@/src/lib/mediaServer';

export const dynamic = 'force-dynamic';

function nodeStreamToWebStream(
  nodeStream: Readable,
  signal?: AbortSignal,
  onCleanup?: () => void
): ReadableStream<Uint8Array> {
  let controllerClosed = false;

  const cleanup = () => {
    controllerClosed = true;
    try {
      nodeStream.destroy();
    } catch {}
    if (onCleanup) {
      try {
        onCleanup();
      } catch {}
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const safeClose = () => {
        if (controllerClosed) return;
        controllerClosed = true;
        try {
          controller.close();
        } catch {}
      };

      nodeStream.on('data', (chunk: Buffer | string) => {
        if (controllerClosed) return;
        try {
          const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
          controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        } catch {
          cleanup();
        }
      });

      nodeStream.on('end', () => {
        safeClose();
      });

      nodeStream.on('close', () => {
        safeClose();
      });

      nodeStream.on('error', () => {
        safeClose();
      });

      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            safeClose();
            cleanup();
          },
          { once: true }
        );
      }
    },
    cancel() {
      cleanup();
    },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ episodeId: string }> }
) {
  if (!verifyRequestLanAccess(request)) {
    return NextResponse.json({ error: 'LAN PIN authentication required' }, { status: 401 });
  }

  const { episodeId } = await context.params;
  const state = await ensureInitialized();
  const epEntry = getEpisodeEntry(episodeId, state);

  if (!epEntry || !fs.existsSync(epEntry.fullPath)) {
    return NextResponse.json({ error: 'Video file not found on disk' }, { status: 404 });
  }

  const resolvedFile = path.resolve(epEntry.fullPath);
  if (!isPathAllowedInLibrary(resolvedFile, state)) {
    return NextResponse.json(
      { error: 'Access denied outside configured media directories' },
      { status: 403 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const forceRemux =
    searchParams.get('remux') === '1' ||
    epEntry.containerFormat === 'mkv' ||
    epEntry.containerFormat === 'avi';
  const audioTrackIndex = parseInt(searchParams.get('audioTrack') || '0', 10) || 0;
  const startSec = parseFloat(searchParams.get('start') || '0') || 0;

  if (forceRemux && isFfmpegAvailable() && !epEntry.isSampleSynthetic) {
    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel',
      'error',
      ...(startSec > 0 ? ['-ss', String(startSec)] : []),
      '-i',
      resolvedFile,
      '-sn',
      '-dn',
      '-map',
      '0:v:0',
      '-map',
      `0:a:${audioTrackIndex}?`,
      '-c:v',
      epEntry.containerFormat === 'avi' ? 'libx264' : 'copy',
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-b:a',
      '192k',
      '-movflags',
      'frag_keyframe+empty_moov+default_base_moof',
      '-f',
      'mp4',
      'pipe:1',
    ];

    const ffProcess = spawn('ffmpeg', ffmpegArgs);
    const webStream = nodeStreamToWebStream(ffProcess.stdout, request.signal, () => {
      try {
        ffProcess.kill('SIGKILL');
      } catch {}
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
    const webStream = nodeStreamToWebStream(nodeStream, request.signal);

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
  const webStream = nodeStreamToWebStream(nodeStream, request.signal);

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Length': String(fileSize),
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    },
  });
}
