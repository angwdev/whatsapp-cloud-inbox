import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isAuthEnabled } from '@/lib/auth-config';

export async function GET() {
  if (!isAuthEnabled()) {
    return NextResponse.json({ authEnabled: false, user: null });
  }

  const session = await auth();

  return NextResponse.json({
    authEnabled: true,
    user: session?.user
      ? {
          name: session.user.name ?? null,
          email: session.user.email ?? null,
          image: session.user.image ?? null,
        }
      : null,
  });
}
