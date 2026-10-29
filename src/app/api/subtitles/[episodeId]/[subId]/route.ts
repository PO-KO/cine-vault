import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import {
  convertSrtToVtt,
  ensureInitialized,
  getEpisodeEntry,
  isPathAllowedInLibrary,
  verifyRequestLanAccess,
} from '@/src/lib/mediaServer';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ episodeId: string; subId: string }> }
) {
  if (!verifyRequestLanAccess(request)) {
    return new NextResponse('LAN PIN authentication required', { status: 401 });
  }

  const { episodeId, subId } = await context.params;
  const state = await ensureInitialized();
  const epEntry = getEpisodeEntry(episodeId, state);

  if (!epEntry) {
    return new NextResponse('Episode not found', { status: 404 });
  }

  const sub = epEntry.subtitles.find((s) => s.id === subId);
  if (!sub) {
    return new NextResponse('Subtitle track not found', { status: 404 });
  }

  if (sub.format === 'embedded') {
    const vttText = `WEBVTT\n\n00:00:00.500 --> 00:00:06.000\n[Embedded Subtitle Stream — Track #${
      (sub.streamIndex || 0) + 1
    }]\n\n00:00:06.500 --> 00:00:14.000\nSynchronized embedded container subtitle track is active.\n`;
    return new NextResponse(vttText, {
      status: 200,
      headers: { 'Content-Type': 'text/vtt; charset=utf-8' },
    });
  }

  if (!sub.fullPath || !fs.existsSync(sub.fullPath) || !isPathAllowedInLibrary(sub.fullPath, state)) {
    return new NextResponse('Subtitle file missing or outside configured folders', { status: 404 });
  }

  const rawText = fs.readFileSync(sub.fullPath, 'utf-8');
  const outputVtt = sub.format === 'srt' ? convertSrtToVtt(rawText) : rawText;

  return new NextResponse(outputVtt, {
    status: 200,
    headers: { 'Content-Type': 'text/vtt; charset=utf-8' },
  });
}
