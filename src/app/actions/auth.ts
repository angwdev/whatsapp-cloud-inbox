'use server';

import { signOut } from '@/auth';

export async function signOutAction() {
  // `signedOut` stops the login page from auto-redirecting straight back into SSO.
  await signOut({ redirectTo: '/login?signedOut=1' });
}
