import { NextResponse } from 'next/server';
import { signIn } from '@/auth';
import { getAutoRedirectProviderId, safeCallbackUrl } from '@/lib/auth-config';

export const dynamic = 'force-dynamic';

/**
 * Starts sign-in with the auto-redirect provider without showing the sign-in page.
 * A route handler rather than the page itself, because Auth.js has to set its
 * state and PKCE cookies before redirecting to the identity provider.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const redirectTo = safeCallbackUrl(searchParams.get('callbackUrl'));
  const providerId = getAutoRedirectProviderId();

  if (!providerId) {
    const loginUrl = new URL('/login', origin);
    loginUrl.searchParams.set('callbackUrl', redirectTo);
    return NextResponse.redirect(loginUrl);
  }

  // Throws Next's redirect to the identity provider.
  await signIn(providerId, { redirectTo });
  return NextResponse.redirect(new URL('/login', origin));
}
