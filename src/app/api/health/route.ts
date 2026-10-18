import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Unauthenticated liveness probe used by the container HEALTHCHECK.
export function GET() {
  return NextResponse.json({ status: 'ok' });
}
