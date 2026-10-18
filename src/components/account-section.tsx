'use client';

import { useQuery } from '@tanstack/react-query';
import { LogOut, UserRound } from 'lucide-react';
import { signOutAction } from '@/app/actions/auth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

type MeResponse = {
  authEnabled: boolean;
  user: { name: string | null; email: string | null; image: string | null } | null;
};

async function fetchMe(): Promise<MeResponse> {
  const response = await fetch('/api/me');
  if (!response.ok) throw new Error('Failed to load account');
  return response.json();
}

export function AccountSection() {
  const { data } = useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 5 * 60_000 });

  if (!data?.authEnabled || !data.user) return null;

  const label = data.user.name || data.user.email || 'Signed in';
  const initials = label.slice(0, 2).toUpperCase();

  return (
    <section className="mb-5 flex flex-col gap-3 rounded-md border border-[var(--chat-border-strong)] bg-[var(--chat-surface)] p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="size-10 flex-shrink-0">
          {data.user.image && <AvatarImage src={data.user.image} alt="" />}
          <AvatarFallback className="bg-[var(--chat-avatar)] text-xs font-semibold">
            {initials || <UserRound className="size-4" />}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{label}</p>
          {data.user.email && data.user.email !== label && (
            <p className="truncate text-xs text-muted-foreground">{data.user.email}</p>
          )}
        </div>
      </div>
      <form action={signOutAction}>
        <Button type="submit" variant="outline" className="h-11 w-full rounded-md sm:h-9 sm:w-auto">
          <LogOut className="size-4" />
          Sign out
        </Button>
      </form>
    </section>
  );
}
