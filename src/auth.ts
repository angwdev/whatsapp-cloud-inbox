import NextAuth from 'next-auth';
import { getSsoProviders, isEmailAllowed } from '@/lib/auth-config';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: getSsoProviders(),
  session: { strategy: 'jwt', maxAge: 60 * 60 * 12 },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    signIn({ user, profile }) {
      // Never trust an address the identity provider says is unverified.
      if (profile?.email_verified === false) return false;

      return isEmailAllowed(user.email ?? profile?.email);
    },
  },
});
