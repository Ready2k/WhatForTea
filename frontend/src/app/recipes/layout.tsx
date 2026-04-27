'use client';

import { usePathname } from 'next/navigation';
import { RecipeList } from '@/components/RecipeList';

export default function RecipesLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Check if we are on a specific recipe detail page
  const isDetail = pathname?.match(/\/recipes\/[a-z0-9-]+$/i);
  // Check if we are in cooking execution mode (which should be full width)
  const isCook = pathname?.endsWith('/cook');

  // Let cooking mode take over the full screen
  if (isCook) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-[calc(100vh-64px)] md:h-screen overflow-hidden bg-brand-background dark:bg-brand-primary md:bg-brand-card md:dark:bg-brand-primary">
      {/* Master pane (sidebar on desktop, full on mobile if not detail) */}
      <div 
        className={`w-full md:w-[400px] lg:w-[480px] flex-shrink-0 h-full overflow-y-auto no-scrollbar 
          bg-brand-background dark:bg-brand-primary border-r-0 md:border-r border-brand-linen dark:border-brand-primary/50
          ${isDetail ? 'hidden md:block' : 'block'}
        `}
      >
        <RecipeList />
      </div>
      
      {/* Detail pane (hidden on mobile if not detail, takes remaining width on desktop) */}
      <div 
        className={`flex-1 min-w-0 h-full overflow-y-auto relative
          bg-brand-card dark:bg-brand-primary
          ${!isDetail ? 'hidden md:flex flex-col items-center justify-center' : 'block'}
        `}
      >
        {children}
      </div>
    </div>
  );
}
