import { NextRequest, NextResponse } from 'next/server';
import {
  configureLanPinInDb,
  ensureInitialized,
  getLanNetworkInfo,
  verifyLanPinInDb,
} from '@/src/lib/mediaServer';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  await ensureInitialized();
  return NextResponse.json({
    networkInfo: getLanNetworkInfo(request),
  });
}

export async function POST(request: NextRequest) {
  await ensureInitialized();
  const body = await request.json().catch(() => ({}));
  const { action, enabled, pin } = body as {
    action?: 'configure-pin' | 'verify-pin';
    enabled?: boolean;
    pin?: string;
  };

  if (action === 'configure-pin') {
    if (enabled && (!pin || pin.trim().length < 4)) {
      return NextResponse.json(
        { error: 'Please enter a PIN of at least 4 digits/characters.' },
        { status: 400 }
      );
    }
    configureLanPinInDb(Boolean(enabled), pin?.trim());
    const response = NextResponse.json({
      networkInfo: getLanNetworkInfo(request),
    });
    if (enabled && pin) {
      response.cookies.set('cinevault_lan_auth', pin.trim(), {
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
        sameSite: 'lax',
      });
    } else if (!enabled) {
      response.cookies.delete('cinevault_lan_auth');
    }
    return response;
  }

  if (action === 'verify-pin') {
    const valid = verifyLanPinInDb(pin || '');
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid PIN code. Please check the PIN on your Host PC.' },
        { status: 401 }
      );
    }
    const response = NextResponse.json({
      authorized: true,
      networkInfo: {
        ...getLanNetworkInfo(request),
        isAuthorizedClient: true,
      },
    });
    response.cookies.set('cinevault_lan_auth', (pin || '').trim(), {
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
      sameSite: 'lax',
    });
    return response;
  }

  return NextResponse.json({ error: 'Unsupported network action' }, { status: 400 });
}
