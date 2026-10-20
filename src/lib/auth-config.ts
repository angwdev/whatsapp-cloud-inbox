import type { Provider } from 'next-auth/providers';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';

export type SsoProviderSummary = {
  id: string;
  name: string;
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseList(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Builds the SSO providers enabled through environment variables. A provider is
 * only registered when both its client ID and secret are present.
 */
export function getSsoProviders(): Provider[] {
  const providers: Provider[] = [];

  const oidcIssuer = env('AUTH_OIDC_ISSUER');
  const oidcClientId = env('AUTH_OIDC_ID');
  const oidcClientSecret = env('AUTH_OIDC_SECRET');
  if (oidcIssuer && oidcClientId && oidcClientSecret) {
    providers.push({
      id: 'oidc',
      name: env('AUTH_OIDC_NAME') ?? 'Single sign-on',
      type: 'oidc',
      issuer: oidcIssuer,
      clientId: oidcClientId,
      clientSecret: oidcClientSecret,
      authorization: { params: { scope: 'openid email profile' } },
    });
  }

  const googleId = env('AUTH_GOOGLE_ID');
  const googleSecret = env('AUTH_GOOGLE_SECRET');
  if (googleId && googleSecret) {
    const hostedDomain = env('AUTH_GOOGLE_HOSTED_DOMAIN');
    providers.push(Google({
      clientId: googleId,
      clientSecret: googleSecret,
      // `hd` only pre-filters the account chooser; the domain is enforced in the signIn callback.
      authorization: hostedDomain ? { params: { hd: hostedDomain } } : undefined,
    }));
  }

  const entraId = env('AUTH_MICROSOFT_ENTRA_ID_ID');
  const entraSecret = env('AUTH_MICROSOFT_ENTRA_ID_SECRET');
  if (entraId && entraSecret) {
    providers.push(MicrosoftEntraID({
      clientId: entraId,
      clientSecret: entraSecret,
      issuer: env('AUTH_MICROSOFT_ENTRA_ID_ISSUER'),
    }));
  }

  const githubId = env('AUTH_GITHUB_ID');
  const githubSecret = env('AUTH_GITHUB_SECRET');
  if (githubId && githubSecret) {
    providers.push(GitHub({ clientId: githubId, clientSecret: githubSecret }));
  }

  return providers;
}

export function getSsoProviderSummaries(): SsoProviderSummary[] {
  return getSsoProviders().map((provider) => {
    const config = typeof provider === 'function' ? provider() : provider;
    return { id: config.id, name: config.name };
  });
}

/**
 * The provider to send signed-out visitors to straight away, skipping the
 * sign-in page. AUTH_AUTO_REDIRECT=true picks the only configured provider;
 * with several, set it to a provider ID (oidc, google, microsoft-entra-id, github).
 */
export function getAutoRedirectProviderId(): string | null {
  const setting = env('AUTH_AUTO_REDIRECT');
  if (!setting || setting === 'false') return null;

  const providers = getSsoProviderSummaries();
  if (setting === 'true') {
    return providers.length === 1 ? providers[0].id : null;
  }

  return providers.find((provider) => provider.id === setting)?.id ?? null;
}

/** Same-origin relative paths only; rejects protocol-relative URLs like //evil.com. */
export function safeCallbackUrl(value?: string | string[] | null): string {
  const callbackUrl = Array.isArray(value) ? value[0] : value;
  if (!callbackUrl || !callbackUrl.startsWith('/') || callbackUrl.startsWith('//') || callbackUrl.startsWith('/\\')) {
    return '/';
  }
  return callbackUrl;
}

/**
 * SSO protects every page and API route unless it is explicitly turned off with
 * AUTH_DISABLED=true. Without providers the app stays open in development (so
 * `npm run dev` keeps working) but is locked in production.
 */
export function isAuthEnabled(): boolean {
  if (env('AUTH_DISABLED') === 'true') return false;
  if (getSsoProviders().length > 0) return true;
  return process.env.NODE_ENV === 'production';
}

export function isEmailAllowed(email?: string | null): boolean {
  const allowedEmails = parseList(env('AUTH_ALLOWED_EMAILS'));
  const allowedDomains = parseList(env('AUTH_ALLOWED_DOMAINS'));

  if (allowedEmails.length === 0 && allowedDomains.length === 0) return true;
  if (!email) return false;

  const normalizedEmail = email.trim().toLowerCase();
  const domain = normalizedEmail.split('@').pop() ?? '';

  return allowedEmails.includes(normalizedEmail) || allowedDomains.includes(domain);
}
