'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useCurrentUser } from '@/lib/hooks';

const UNGUARDED = ['/login', '/forgot-password', '/reset-password', '/change-password'];

export function ForcePasswordChangeGuard({ children }: { children: React.ReactNode }) {
  const { data: user } = useCurrentUser();
  const router = useRouter();
  const pathname = usePathname();

  const isUnguarded = UNGUARDED.some((p) => pathname === p || pathname.startsWith(p + '/'));

  useEffect(() => {
    if (!user) return;
    if (user.force_password_change && !isUnguarded) {
      router.replace('/change-password');
    }
  }, [user, isUnguarded, router]);

  // Render nothing until redirect completes so the user never sees underlying page
  if (user?.force_password_change && !isUnguarded) return null;

  return <>{children}</>;
}
