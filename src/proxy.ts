import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isAuthEnabled } from '@/lib/auth-config';

const LOGIN_PATH = '/login';

export default auth((request) => {
  if (!isAuthEnabled()) return NextResponse.next();

  const { nextUrl } = request;
  const isLoginPage = nextUrl.pathname === LOGIN_PATH;

  if (request.auth) {
    return isLoginPage
      ? NextResponse.redirect(new URL('/', nextUrl))
      : NextResponse.next();
  }

  if (isLoginPage) return NextResponse.next();

  if (nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const loginUrl = new URL(LOGIN_PATH, nextUrl);
  loginUrl.searchParams.set('callbackUrl', `${nextUrl.pathname}${nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
});

export const config = {
  // Everything except Auth.js endpoints, the health probe, and static assets.
  matcher: [
    '/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon).*)',
  ],
};
