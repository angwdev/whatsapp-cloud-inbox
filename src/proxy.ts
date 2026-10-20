import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getAutoRedirectProviderId, isAuthEnabled } from '@/lib/auth-config';

const LOGIN_PATH = '/login';

export default auth((request) => {
  if (!isAuthEnabled()) return NextResponse.next();

  const { nextUrl } = request;
  // Includes /login/sso, which starts the auto-redirect sign-in.
  const isLoginPage = nextUrl.pathname === LOGIN_PATH || nextUrl.pathname.startsWith(`${LOGIN_PATH}/`);

  if (request.auth) {
    return isLoginPage
      ? NextResponse.redirect(new URL('/', nextUrl))
      : NextResponse.next();
  }

  if (isLoginPage) return NextResponse.next();

  if (nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // With auto-redirect, go straight to the identity provider instead of the sign-in page.
  const loginUrl = new URL(getAutoRedirectProviderId() ? `${LOGIN_PATH}/sso` : LOGIN_PATH, nextUrl);
  loginUrl.searchParams.set('callbackUrl', `${nextUrl.pathname}${nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
});

export const config = {
  // Everything except Auth.js endpoints, the health probe, signed webhooks, emoji data, and static assets.
  matcher: [
    '/((?!api/auth|api/health|api/webhooks|emojibase|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon|apple-icon).*)',
  ],
};
