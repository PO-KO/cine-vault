import { NextRequest, NextResponse } from 'next/server';
import {
  ensureInitialized,
  getWatchHistory,
  upsertEpisodeProgressInDb,
} from '@/src/lib/mediaServer';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ episodeId: string }> }
) {
  const { episodeId } = await context.params;
  const state = await ensureInitialized();
  const body = await request.json().catch(() => ({}));
  const {
    currentTime,
    duration,
    completed,
    mediaId,
    mediaTitle,
    episodeTitle,
    seasonNumber,
    episodeNumber,
    posterUrl,
  } = body as {
    currentTime?: number;
    duration?: number;
    completed?: boolean;
    mediaId?: string;
    mediaTitle?: string;
    episodeTitle?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    posterUrl?: string;
  };

  const progress = upsertEpisodeProgressInDb(
    episodeId,
    {
      currentTime,
      duration,
      completed,
      mediaId,
      mediaTitle,
      episodeTitle,
      seasonNumber,
      episodeNumber,
      posterUrl,
    },
    state
  );

  return NextResponse.json({
    progress,
    watchHistory: getWatchHistory(60),
  });
}
