import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, saveState } from '@/src/lib/mediaServer';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ episodeId: string }> }
) {
  const { episodeId } = await context.params;
  const state = await ensureInitialized();
  const body = await request.json().catch(() => ({}));
  const { currentTime, duration, completed } = body as {
    currentTime?: number;
    duration?: number;
    completed?: boolean;
  };

  const existing = state.episodeProgress[episodeId] || {
    currentTime: 0,
    duration: 1440,
    completed: false,
    updatedAt: new Date().toISOString(),
  };

  const nextDuration = typeof duration === 'number' && duration > 0 ? duration : existing.duration;
  const nextTime = typeof currentTime === 'number' && currentTime >= 0 ? currentTime : existing.currentTime;
  const isCompleted =
    typeof completed === 'boolean' ? completed : nextDuration > 0 && nextTime / nextDuration >= 0.92;

  state.episodeProgress[episodeId] = {
    currentTime: isCompleted && typeof completed === 'boolean' && completed ? 0 : Math.floor(nextTime),
    duration: Math.floor(nextDuration),
    completed: isCompleted,
    updatedAt: new Date().toISOString(),
  };

  saveState(state);
  return NextResponse.json({ progress: state.episodeProgress[episodeId] });
}
