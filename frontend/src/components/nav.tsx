'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '@/context/ThemeContext';
import { useCurrentUser } from '@/lib/hooks';
import { TeaBotTrigger } from '@/components/TeaBot/TeaBotTrigger';

const tabs = [
  {
    href: '/',
    label: 'Home',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" />
        <path d="M9 21V12h6v9" />
      </svg>
    ),
  },
  {
    href: '/recipes',
    label: 'Collection',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M18 8h1a4 4 0 010 8h-1" />
        <path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
        <line x1="6" y1="1" x2="6" y2="4" />
        <line x1="10" y1="1" x2="10" y2="4" />
        <line x1="14" y1="1" x2="14" y2="4" />
      </svg>
    ),
  },
  {
    href: '/shopping-list',
    label: 'Shopping',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
    ),
  },
];

export function Nav() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const { data: currentUser } = useCurrentUser();

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  return (
    <>
      {/* TeaBot Assistant Trigger (Floating FAB) */}
      <div className="fixed right-4 bottom-20 z-50 animate-bounce-slow">
        <TeaBotTrigger />
      </div>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-brand-card dark:bg-brand-primary border-t border-brand-linen dark:border-brand-primary/50 pb-safe">
        <div className="flex items-stretch h-16">
          {tabs.map((tab) => {
            const active = isActive(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-label={tab.label}
                className={`flex flex-col items-center justify-center flex-1 gap-0.5 text-xs font-medium transition-colors ${
                  active ? 'text-brand-primary dark:text-brand-accent' : 'text-brand-muted dark:text-brand-secondary hover:text-brand-ink dark:hover:text-brand-background'
                }`}
              >
                <span className={active ? 'text-brand-primary dark:text-brand-accent' : 'text-brand-linen dark:text-brand-primary/50'}>{tab.icon}</span>
                {tab.label}
              </Link>
            );
          })}

          {/* Profile link */}
          <Link
            href="/profile"
            className={`w-12 flex flex-col items-center justify-center gap-0.5 border-l border-brand-linen/30 text-xs font-medium transition-colors flex-shrink-0 ${
              pathname.startsWith('/profile')
                ? 'text-brand-primary dark:text-brand-accent'
                : 'text-brand-muted dark:text-brand-secondary hover:text-brand-ink dark:hover:text-brand-background'
            }`}
            title={currentUser ? currentUser.display_name : 'Profile'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span className="truncate max-w-[44px] text-[10px]">
              {currentUser ? currentUser.display_name.split(' ')[0] : 'Profile'}
            </span>
          </Link>

          {/* Theme toggle */}
          <button
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="w-12 flex items-center justify-center border-l border-brand-linen/30 text-brand-linen dark:text-brand-secondary hover:text-brand-ink dark:hover:text-brand-background transition-colors flex-shrink-0"
          >
            {theme === 'dark' ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
      </nav>
    </>
  );
}
