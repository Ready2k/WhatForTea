'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '@/context/ThemeContext';
import { useCurrentUser } from '@/lib/hooks';
import { Home, BookOpen, ShoppingCart, CalendarDays, ShoppingBasket, ScanLine, Moon, Sun } from 'lucide-react';
import { TeaBotTrigger } from '@/components/TeaBot/TeaBotTrigger';

const navItems = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/recipes', label: 'Collection', icon: BookOpen },
  { href: '/pantry', label: 'Pantry', icon: ShoppingBasket },
  { href: '/planner', label: 'Planner', icon: CalendarDays },
  { href: '/shopping-list', label: 'Shopping', icon: ShoppingCart },
  { href: '/ingest', label: 'Scan Card', icon: ScanLine },
];

export function Sidebar() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const { data: currentUser } = useCurrentUser();

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  return (
    <aside className="hidden md:flex flex-col w-[220px] fixed top-0 left-0 h-full border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0f1117] z-40 py-6">
      
      {/* App Branding */}
      <div className="px-6 mb-8 flex items-center gap-3">
        <img src="/teabot-chef.png" alt="TeaBot Chef" className="w-10 h-10 rounded-full border-2 border-indigo-600 bg-indigo-900" />
        <div>
          <div className="text-lg font-extrabold text-gray-900 dark:text-gray-50 leading-tight tracking-tight">What&apos;s for Tea?</div>
          <div className="text-[10px] uppercase font-bold tracking-wider text-emerald-600 dark:text-emerald-500 mt-0.5">Kitchen Assistant</div>
        </div>
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
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' 
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:text-gray-900 dark:hover:text-gray-100'
              }`}
            >
              <Icon className={`w-5 h-5 ${active ? 'text-emerald-600 dark:text-emerald-500' : 'text-gray-400 dark:text-gray-500'}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer Items */}
      <div className="p-4 mt-auto space-y-4">
        {/* Note: The floating TeaBotTrigger will remain visible on desktop, 
            but adding a small panel shortcut in sidebar too per mockup style */}
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 rounded-xl p-3 flex items-center gap-3 relative overflow-hidden">
             <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
             <img src="/teabot-chef.png" alt="TeaBot" className="w-8 h-8 rounded-full border border-indigo-200 dark:border-indigo-700" />
             <div>
               <div className="text-[11px] font-bold text-indigo-900 dark:text-indigo-300">Ask TeaBot</div>
               <div className="text-[9px] text-indigo-700 dark:text-indigo-400/70 leading-tight mt-0.5">Your kitchen assistant</div>
             </div>
        </div>

        {/* User Profile & Theme */}
        <div className="flex items-center gap-3 px-2 pt-4 border-t border-gray-100 dark:border-gray-800/60">
          <Link href="/profile" className="flex items-center gap-2 flex-1 min-w-0 group">
            <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center flex-shrink-0 group-hover:ring-2 ring-emerald-500 transition-all">
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                {currentUser ? currentUser.display_name.charAt(0).toUpperCase() : 'U'}
              </span>
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
              {currentUser ? currentUser.display_name : 'Profile'}
            </span>
          </Link>
          <button
            onClick={toggle}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-gray-800 bg-gray-50 hover:bg-gray-100 transition-colors"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

    </aside>
  );
}
