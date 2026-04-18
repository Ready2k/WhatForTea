'use client';

/**
 * Renders Nav + TeaBotPanel only for authenticated pages.
 * Suppresses them on /login to prevent unauthenticated API calls
 * that would otherwise cause a redirect loop.
 */
import { usePathname } from 'next/navigation';
import { Nav } from '@/components/nav';
import { Sidebar } from '@/components/Sidebar';
import { TeaBotPanel } from '@/components/TeaBot/TeaBotPanel';

const SHELL_SUPPRESSED = ['/login', '/forgot-password', '/reset-password', '/change-password'];

export function ShellUI() {
  const pathname = usePathname();
  if (SHELL_SUPPRESSED.some((p) => pathname === p || pathname.startsWith(p + '/'))) return null;
  return (
    <>
      <Sidebar />
      <Nav />
      <TeaBotPanel />
    </>
  );
}
