'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTheme } from '@/context/ThemeContext';
import { useCurrentUser } from '@/lib/hooks';
import { Home, BookOpen, ShoppingCart, CalendarDays, ShoppingBasket, ScanLine, Moon, Sun, X } from 'lucide-react';

const navItems = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/recipes', label: 'Collection', icon: BookOpen },
  { href: '/pantry', label: 'Pantry', icon: ShoppingBasket },
  { href: '/planner', label: 'Planner', icon: CalendarDays },
  { href: '/shopping-list', label: 'Shopping', icon: ShoppingCart },
  { href: '/ingest', label: 'Scanner', icon: ScanLine },
];

const VERSION = process.env.NEXT_PUBLIC_RELEASE_ID ?? 'dev';

export function Sidebar() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const { data: currentUser } = useCurrentUser();
  const [showVersion, setShowVersion] = useState(false);

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  return (
    <aside className="hidden md:flex flex-col w-[220px] fixed top-0 left-0 h-full border-r border-brand-linen dark:border-brand-primary/50 bg-brand-card dark:bg-brand-primary z-40 py-6">
      
      {/* App Branding */}
      <div className={`px-6 mb-8 relative ${showVersion ? 'z-50' : 'z-10'}`}>
        <button
          onClick={() => setShowVersion((v) => !v)}
          className="flex items-center gap-3 w-full text-left hover:opacity-80 transition-opacity"
          title="Version info"
        >
          <img src="/teabot-chef.png" alt="TeaBot Chef" className="w-10 h-10 rounded-full border-2 border-brand-accent bg-brand-primary flex-shrink-0" />
          <div>
            <div className="text-lg font-extrabold text-brand-ink dark:text-brand-background leading-tight tracking-tight">What&apos;s for Tea?</div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-brand-herb dark:text-brand-secondary mt-0.5">Kitchen Assistant</div>
          </div>
        </button>
        {showVersion && (
          <div className="absolute left-4 right-4 top-full mt-2 bg-brand-card dark:bg-brand-primary border border-brand-linen dark:border-brand-primary-hover/50 rounded-xl shadow-xl p-3 ring-1 ring-black/5 dark:ring-white/5 animate-in">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-brand-ink dark:text-brand-background">App Info</span>
              <button onClick={() => setShowVersion(false)} className="text-brand-muted hover:text-brand-ink dark:hover:text-brand-background p-1">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1 font-mono text-[11px] text-brand-muted/60 dark:text-brand-secondary/60">
              <div><span className="text-brand-muted/40">version </span>{VERSION}</div>
              <div><span className="text-brand-muted/40">stack </span>Next.js · FastAPI · Postgres</div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active
                  ? 'bg-brand-primary text-brand-background dark:bg-brand-accent dark:text-brand-primary'
                  : 'text-brand-muted dark:text-brand-secondary hover:bg-brand-background dark:hover:bg-brand-primary-hover hover:text-brand-ink dark:hover:text-brand-background'
              }`}
            >
              <Icon className={`w-5 h-5 ${active ? 'text-brand-accent-soft dark:text-brand-primary' : 'text-brand-linen dark:text-brand-primary/50'}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer Items */}
      <div className="p-4 mt-auto space-y-4">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('teabot-toggle'))}
          className="w-full bg-brand-accent/10 dark:bg-brand-accent/20 border border-brand-accent/20 dark:border-brand-accent/30 rounded-xl p-3 flex items-center gap-3 relative overflow-hidden hover:bg-brand-accent/20 dark:hover:bg-brand-accent/40 transition-colors text-left"
        >
          <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-brand-herb animate-pulse"></div>
          <img src="/teabot-chef.png" alt="TeaBot" className="w-8 h-8 rounded-full border border-brand-accent/30 dark:border-brand-accent/50" />
          <div>
            <div className="text-[11px] font-bold text-brand-primary dark:text-brand-accent">Ask TeaBot</div>
            <div className="text-[9px] text-brand-primary/70 dark:text-brand-accent/70 leading-tight mt-0.5">Your kitchen assistant</div>
          </div>
        </button>

        {/* User Profile & Theme */}
        <div className="flex items-center gap-3 px-2 pt-4 border-t border-brand-linen dark:border-brand-primary/30">
          <Link href="/profile" className="flex items-center gap-2 flex-1 min-w-0 group">
            <div className="w-7 h-7 rounded-full bg-brand-secondary/20 dark:bg-brand-secondary/40 flex items-center justify-center flex-shrink-0 group-hover:ring-2 ring-brand-accent transition-all">
              <span className="text-xs font-bold text-brand-primary dark:text-brand-background">
                {currentUser ? currentUser.display_name.charAt(0).toUpperCase() : 'U'}
              </span>
            </div>
            <span className="text-sm font-medium text-brand-muted dark:text-brand-secondary truncate group-hover:text-brand-ink dark:group-hover:text-brand-background transition-colors">
              {currentUser ? currentUser.display_name : 'Profile'}
            </span>
          </Link>
          <button
            onClick={toggle}
            className="p-1.5 rounded-lg text-brand-muted/60 hover:text-brand-ink dark:text-brand-secondary/60 dark:hover:text-brand-background hover:bg-brand-linen/10 dark:hover:bg-brand-primary-hover transition-colors"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

    </aside>
  );
}
