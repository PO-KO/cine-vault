import { NextRequest, NextResponse } from 'next/server';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

export const dynamic = 'force-dynamic';

interface StreamSubscriber {
  onData: (chunk: Buffer) => void;
  onEnd: () => void;
}

interface RemuxSession {
  id: string;
  ffProcess: ChildProcessWithoutNullStreams;
  bufferedChunks: Buffer[];
  bufferedBytesCount: number;
  subscribers: Set<StreamSubscriber>;
  createdAt: number;
  ended: boolean;
  closed: boolean;
}

const MAX_INITIAL_BUFFER_BYTES = 24 * 1024 * 1024; // 24 MB contiguous startup buffer for browser multi-GET probes

// Persist session map on globalThis across Next.js route invocations
const globalForRemux = globalThis as unknown as {
  __cinevaultRemuxSessions?: Map<string, RemuxSession>;
};

if (!globalForRemux.__cinevaultRemuxSessions) {
  globalForRemux.__cinevaultRemuxSessions = new Map<string, RemuxSession>();
}

const sessions = globalForRemux.__cinevaultRemuxSessions;

function cleanupStaleSessions() {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now - s.createdAt > 1000 * 60 * 60 || s.closed) {
      destroySession(id);
    }
  }
}

function notifySessionEnd(session: RemuxSession) {
  session.ended = true;
  for (const sub of Array.from(session.subscribers)) {
    try {
      sub.onEnd();
    } catch {}
  }
  session.subscribers.clear();
}

function destroySession(sessionId: string) {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.closed = true;
  sessions.delete(sessionId);
  notifySessionEnd(s);
  s.bufferedChunks = [];
  s.bufferedBytesCount = 0;
  try {
    s.ffProcess.stdin.destroy();
  } catch {}
  try {
    s.ffProcess.kill('SIGKILL');
  } catch {}
}

function getOrCreateSession(
  sessionId: string,
  options: { audioTrackIndex: number; isHevc: boolean; isAvi: boolean }
): RemuxSession {
  cleanupStaleSessions();

  const existing = sessions.get(sessionId);
  if (existing && !existing.closed) {
    return existing;
  }

  const { audioTrackIndex, isHevc, isAvi } = options;

  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-fflags',
    '+genpts+igndts+discardcorrupt',
    '-i',
    'pipe:0',
    '-sn',
    '-dn',
    '-map',
    '0:v:0',
    '-map',
    `0:a:${audioTrackIndex}?`,
    '-c:v',
    isAvi ? 'libx264' : 'copy',
    ...(isHevc && !isAvi ? ['-tag:v', 'hvc1'] : []),
    '-c:a',
    'aac',
    '-ac',
    '2',
    '-ar',
    '48000',
    '-b:a',
    '192k',
    '-avoid_negative_ts',
    'make_zero',
    '-frag_duration',
    '500000',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    '-f',
    'mp4',
    'pipe:1',
  ];

  const ffProcess = spawn('ffmpeg', ffmpegArgs);

  const session: RemuxSession = {
    id: sessionId,
    ffProcess,
    bufferedChunks: [],
    bufferedBytesCount: 0,
    subscribers: new Set<StreamSubscriber>(),
    createdAt: Date.now(),
    ended: false,
    closed: false,
  };

  ffProcess.stdout.on('data', (chunk: Buffer) => {
    if (session.closed) return;
    const copy = Buffer.from(chunk);
    if (session.bufferedBytesCount < MAX_INITIAL_BUFFER_BYTES) {
      session.bufferedChunks.push(copy);
      session.bufferedBytesCount += copy.length;
    }
    for (const sub of Array.from(session.subscribers)) {
      try {
        sub.onData(copy);
      } catch {}
    }
  });

  ffProcess.stdout.on('end', () => {
    notifySessionEnd(session);
  });

  ffProcess.stdout.on('error', () => {
    notifySessionEnd(session);
  });

  ffProcess.stdin.on('error', () => {
    // Ignore EPIPE when ffmpeg exits early
  });

  ffProcess.on('error', () => {
    notifySessionEnd(session);
  });

  ffProcess.on('close', () => {
    notifySessionEnd(session);
  });

  sessions.set(sessionId, session);
  return session;
}

/**
 * GET /api/remux-mp4?sessionId=...
 * Streams the remuxed video/mp4 (H.264/HEVC video copy + Stereo 2.0 AAC audio) directly to <video src="...">
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  const audioTrackIndex = Math.max(0, parseInt(searchParams.get('audioTrack') || '0', 10) || 0);
  const isHevc = searchParams.get('isHevc') === '1';
  const isAvi = searchParams.get('isAvi') === '1';

  const session = getOrCreateSession(sessionId, {
    audioTrackIndex,
    isHevc,
    isAvi,
  });

  let subscriber: StreamSubscriber | null = null;
  let controllerClosed = false;

  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: Buffer) => {
        if (controllerClosed) return;
        try {
          controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        } catch {
          controllerClosed = true;
          if (subscriber) {
            session.subscribers.delete(subscriber);
            subscriber = null;
          }
        }
      };

      const safeClose = () => {
        if (controllerClosed) return;
        controllerClosed = true;
        if (subscriber) {
          session.subscribers.delete(subscriber);
          subscriber = null;
        }
        try {
          controller.close();
        } catch {}
      };

      // Replay contiguous startup chunks so any secondary GET from <video> receives ftyp+moov+initial fragments
      for (const chunk of session.bufferedChunks) {
        if (controllerClosed) break;
        safeEnqueue(chunk);
      }

      if (session.closed || session.ended) {
        safeClose();
        return;
      }

      subscriber = {
        onData: safeEnqueue,
        onEnd: safeClose,
      };
      session.subscribers.add(subscriber);

      request.signal.addEventListener(
        'abort',
        () => {
          safeClose();
        },
        { once: true }
      );
    },
    cancel() {
      controllerClosed = true;
      if (subscriber) {
        session.subscribers.delete(subscriber);
        subscriber = null;
      }
    },
  });

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * POST /api/remux-mp4?sessionId=...
 * Receives binary chunks of the local MKV/AVI file from the browser and pipes them into FFmpeg stdin with backpressure.
 */
export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const sessionId = searchParams.get('sessionId');
  const action = searchParams.get('action');

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  if (action === 'abort') {
    destroySession(sessionId);
    return NextResponse.json({ aborted: true });
  }

  const audioTrackIndex = Math.max(0, parseInt(searchParams.get('audioTrack') || '0', 10) || 0);
  const isHevc = searchParams.get('isHevc') === '1';
  const isAvi = searchParams.get('isAvi') === '1';
  const isEof = searchParams.get('eof') === '1';

  const session = getOrCreateSession(sessionId, {
    audioTrackIndex,
    isHevc,
    isAvi,
  });

  if (session.closed || session.ffProcess.stdin.destroyed) {
    return NextResponse.json({ closed: true }, { status: 410 });
  }

  try {
    const arrayBuffer = await request.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    if (buf.length > 0 && !session.ffProcess.stdin.destroyed) {
      const canContinue = session.ffProcess.stdin.write(buf);
      if (!canContinue && !session.ffProcess.stdin.destroyed) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            cleanup();
            resolve();
          }, 8000);
          const onDrain = () => {
            cleanup();
            resolve();
          };
          const cleanup = () => {
            clearTimeout(timer);
            session.ffProcess.stdin.off('drain', onDrain);
            session.ffProcess.stdin.off('close', onDrain);
            session.ffProcess.stdin.off('error', onDrain);
          };
          session.ffProcess.stdin.once('drain', onDrain);
          session.ffProcess.stdin.once('close', onDrain);
          session.ffProcess.stdin.once('error', onDrain);
        });
      }
    }

    if (isEof && !session.ffProcess.stdin.destroyed) {
      session.ffProcess.stdin.end();
    }

    return NextResponse.json({ ok: true, bytesWritten: buf.length });
  } catch {
    return NextResponse.json({ closed: true }, { status: 410 });
  }
}
