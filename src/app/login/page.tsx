import type { Metadata } from 'next';
import { AlertCircle, KeyRound, MessageCircle } from 'lucide-react';
import { signIn } from '@/auth';
import { getSsoProviderSummaries } from '@/lib/auth-config';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Sign in · WhatsApp inbox',
};

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: 'Your account is not allowed to access this inbox.',
  Configuration: 'Sign-in is misconfigured. Check the server logs.',
  Verification: 'The sign-in link is no longer valid.',
};

function safeCallbackUrl(value?: string | string[]): string {
  const callbackUrl = Array.isArray(value) ? value[0] : value;
  // Only same-origin relative paths; reject protocol-relative URLs like //evil.com.
  if (!callbackUrl || !callbackUrl.startsWith('/') || callbackUrl.startsWith('//')) {
    return '/';
  }
  return callbackUrl;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const providers = getSsoProviderSummaries();
  const redirectTo = safeCallbackUrl(params.callbackUrl);
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  const errorMessage = errorCode
    ? ERROR_MESSAGES[errorCode] ?? 'Sign-in failed. Please try again.'
    : null;

  return (
    <main className="flex h-dvh min-h-dvh flex-col overflow-y-auto bg-background px-4 pb-safe-0 pt-safe-0 text-foreground">
      <div className="m-auto w-full max-w-sm py-8">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <MessageCircle className="size-7" />
          </span>
          <h1 className="text-2xl font-semibold">WhatsApp inbox</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with your organization account to continue.
          </p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-red-700 dark:text-red-300"
          >
            <AlertCircle className="mt-0.5 size-4 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {providers.length === 0 ? (
          <div className="rounded-lg border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] px-4 py-5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No SSO provider is configured.</p>
            <p className="mt-2">
              Set the <code className="font-mono text-xs">AUTH_*</code> environment variables for at
              least one identity provider and restart the server.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {providers.map((provider) => (
              <form
                key={provider.id}
                action={async () => {
                  'use server';
                  await signIn(provider.id, { redirectTo });
                }}
              >
                <Button
                  type="submit"
                  variant="outline"
                  className="h-12 w-full rounded-lg text-base sm:h-11 sm:text-sm"
                >
                  <KeyRound className="size-4" />
                  Continue with {provider.name}
                </Button>
              </form>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
