'use client';

import { useEffect } from 'react';
import { AlertCircle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex h-dvh min-h-dvh flex-col bg-background px-4 pb-safe-0 pt-safe-0 text-foreground">
      <div className="m-auto flex w-full max-w-sm flex-col items-start gap-4 py-8">
        <span className="flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-red-700 dark:text-red-300">
          <AlertCircle className="size-5" />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold">The inbox hit an error</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Something went wrong while showing this screen. Reload the inbox to continue. If it keeps
            happening, the browser console has the details.
          </p>
          {error.digest && (
            <p className="font-mono text-xs text-muted-foreground">Reference {error.digest}</p>
          )}
        </div>
        <Button type="button" onClick={reset} className="h-11 w-full sm:h-10 sm:w-auto">
          <RotateCw className="size-4" />
          Reload inbox
        </Button>
      </div>
    </main>
  );
}
