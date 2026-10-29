import { NextRequest, NextResponse } from 'next/server';
import {
  clearWatchHistory,
  ensureInitialized,
  getUserPreferences,
  getWatchHistory,
  saveUserPreferences,
} from '@/src/lib/mediaServer';
import { UserPreferences } from '@/src/types/media';

export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureInitialized();
  return NextResponse.json({
    preferences: getUserPreferences(),
    watchHistory: getWatchHistory(60),
  });
}

export async function PUT(request: NextRequest) {
  await ensureInitialized();
  const body = (await request.json().catch(() => ({}))) as Partial<UserPreferences>;
  const updated = saveUserPreferences(body);
  return NextResponse.json({
    preferences: updated,
  });
}

export async function DELETE() {
  await ensureInitialized();
  clearWatchHistory();
  return NextResponse.json({
    watchHistory: [],
  });
}
