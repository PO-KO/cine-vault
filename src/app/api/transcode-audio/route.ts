import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { AudioTrack } from '@/src/types/media';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get('mode') || 'transcode';
  const audioTrackIndex = Math.max(0, parseInt(searchParams.get('audioTrack') || '0', 10) || 0);

  if (!request.body) {
    return NextResponse.json({ error: 'Missing binary media payload' }, { status: 400 });
  }

  // Optional ffprobe inspection for non-MKV containers (e.g. AVI)
  if (mode === 'probe') {
    try {
      const arrayBuffer = await request.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const probeOutput = await new Promise<string>((resolve, reject) => {
        const proc = spawn('ffprobe', [
          '-v',
          'quiet',
          '-print_format',
          'json',
          '-show_streams',
          'pipe:0',
        ]);

        let stdout = '';
        proc.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        proc.on('error', reject);
        proc.on('close', () => resolve(stdout));
        proc.stdin.on('error', () => {});
        proc.stdin.end(buffer);
      });

      const parsed = JSON.parse(probeOutput || '{}');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const streams: any[] = Array.isArray(parsed.streams) ? parsed.streams : [];
      const audioStreams = streams.filter((s) => s.codec_type === 'audio');

      const audioTracks: AudioTrack[] = audioStreams.map((s, idx) => {
        const lang = (s.tags?.language || 'und').toLowerCase();
        const title = s.tags?.title || '';
        const codec = (s.codec_name || 'aac').toLowerCase();
        const channelsNum = Number(s.channels) || 2;
        const channelDesc =
          channelsNum >= 8
            ? '7.1 Surround'
            : channelsNum >= 6
            ? '5.1 Surround'
            : channelsNum === 1
            ? '1.0 Mono'
            : '2.0 Stereo';

        return {
          id: `audio-${idx}`,
          index: idx,
          label: `Track ${idx + 1}${title ? ` (${title})` : ''} · ${codec.toUpperCase()}`,
          language: lang,
          codec: codec.toUpperCase(),
          channels: channelDesc,
        };
      });

      return NextResponse.json({
        audioTracks,
        needsCompanionAudio: true,
      });
    } catch {
      return NextResponse.json({
        audioTracks: [],
        needsCompanionAudio: true,
      });
    }
  }

  // Ultrafast Stereo MP3 Transcode for stripped MKV / AVI audio streams
  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-analyzeduration',
    '250000',
    '-probesize',
    '250000',
    '-fflags',
    '+genpts+igndts+discardcorrupt',
    '-i',
    'pipe:0',
    '-vn',
    '-sn',
    '-dn',
    '-map',
    `0:a:${audioTrackIndex}?`,
    '-af',
    'asetpts=PTS-STARTPTS',
    '-ac',
    '2',
    '-ar',
    '44100',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    '-compression_level',
    '9',
    '-f',
    'mp3',
    'pipe:1',
  ];

  const ffProcess = spawn('ffmpeg', ffmpegArgs);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeInput = Readable.fromWeb(request.body as any);
  nodeInput.on('error', () => {
    ffProcess.stdin.destroy();
  });
  ffProcess.stdin.on('error', () => {
    // Ignore EPIPE when ffmpeg finishes early
  });
  nodeInput.pipe(ffProcess.stdin);

  let controllerClosed = false;
  const cleanup = () => {
    controllerClosed = true;
    try {
      nodeInput.destroy();
    } catch {}
    try {
      ffProcess.kill('SIGKILL');
    } catch {}
  };

  const webOutput = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeClose = () => {
        if (controllerClosed) return;
        controllerClosed = true;
        try {
          controller.close();
        } catch {}
      };

      ffProcess.stdout.on('data', (chunk: Buffer) => {
        if (controllerClosed) return;
        try {
          controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        } catch {
          cleanup();
        }
      });

      ffProcess.stdout.on('end', safeClose);
      ffProcess.stdout.on('close', safeClose);
      ffProcess.stdout.on('error', safeClose);

      request.signal.addEventListener(
        'abort',
        () => {
          safeClose();
          cleanup();
        },
        { once: true }
      );
    },
    cancel() {
      cleanup();
    },
  });

  return new NextResponse(webOutput, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}
