'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useMatches, useAvailable, useCurrentPlan } from '@/lib/hooks';
import { MatchBadge } from '@/components/MatchBadge';
import { getActiveCookingSession } from '@/lib/api';
import type { RecipeMatchResult } from '@/lib/types';
import {
  UtensilsCrossed, ChefHat, AlertTriangle, Flame, CalendarDays,
  ShoppingBasket, ScanLine, PackageSearch, Clock, Users, Sparkles,
} from 'lucide-react';

type Mode = 'planning' | 'hangry';

function RecipeCard({ match }: { match: RecipeMatchResult }) {
  const cookedDaysAgo = match.recipe.last_cooked_at
    ? Math.floor((Date.now() - new Date(match.recipe.last_cooked_at).getTime()) / 86400000)
    : null;
  const recentlyCooked = cookedDaysAgo !== null && cookedDaysAgo <= 7;

  return (
    <Link
      href={`/recipes/${match.recipe.id}`}
      className={`flex-shrink-0 w-48 rounded-2xl overflow-hidden bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md transition-all ${recentlyCooked ? 'opacity-50' : ''}`}
    >
      <div className="w-full h-28 bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-900/50 dark:to-teal-900/50 flex items-center justify-center">
        {match.recipe.hero_image_path ? (
          <img
            src={`/api/v1/recipes/${match.recipe.id}/image`}
            alt={match.recipe.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <UtensilsCrossed className="w-10 h-10 text-emerald-400/60" />
        )}
      </div>
      <div className="p-3 space-y-1.5">
        <p className="text-sm font-semibold text-gray-900 dark:text-white leading-tight line-clamp-2">{match.recipe.title}</p>
        {recentlyCooked ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Cooked {cookedDaysAgo === 0 ? 'today' : cookedDaysAgo === 1 ? 'yesterday' : `${cookedDaysAgo}d ago`}
          </p>
        ) : match.recipe.cooking_time_mins ? (
          <p className="text-xs text-gray-500 dark:text-gray-400">{match.recipe.cooking_time_mins} min</p>
        ) : null}
        <MatchBadge score={match.score} category={match.category} />
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const [mode, setMode] = useState<Mode>('planning');
  const { data: allMatches, isLoading } = useMatches();
  const { data: available } = useAvailable();
  const { data: currentPlan } = useCurrentPlan();
  const atRiskCount = available?.filter((a) => a.confidence < 0.5).length ?? 0;
  
  const { data: activeSession } = useQuery({
    queryKey: ['cookingSession'],
    queryFn: () => getActiveCookingSession(),
    staleTime: 30_000,
  });

  const todayIndex = (new Date().getDay() + 6) % 7;
  const tonightPlan = currentPlan?.entries.find(e => e.day_of_week === todayIndex);

  const cookNowCount = allMatches?.filter((m) => m.category === 'cook_now').length ?? 0;

  const filteredMatches = allMatches?.filter(m => {
    if (mode === 'hangry') return m.category === 'cook_now';
    return true;
  }) ?? [];

  const topMatches = filteredMatches.slice(0, 3);

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">

      {/* Resume cooking banner */}
      {activeSession && (
        <Link
          href={`/recipes/${activeSession.recipe_id}/cook`}
          className="flex items-center gap-3 w-full px-4 py-3 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700/50 rounded-2xl hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
        >
          <ChefHat className="w-6 h-6 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 truncate">
              Resume cooking
            </p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 truncate">
              {activeSession.recipe_title ?? 'Continue where you left off'} — step {activeSession.current_step}
            </p>
          </div>
          <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">What&apos;s for Tea?</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {mode === 'hangry' ? 'Quick — what can I cook RIGHT NOW?' : new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <button
          onClick={() => setMode((m) => (m === 'planning' ? 'hangry' : 'planning'))}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
            mode === 'hangry'
              ? 'bg-orange-500 text-white shadow-orange-200 shadow-md'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          {mode === 'hangry' ? <><Flame className="w-3.5 h-3.5 inline mr-1" />Hangry</> : <><CalendarDays className="w-3.5 h-3.5 inline mr-1" />Planning</>}
        </button>
      </div>

      {/* Smart Layout Header (Option B/E) */}
      {tonightPlan && mode === 'planning' && !activeSession && (
        <div className="bg-gradient-to-br from-[#064e3b] via-[#065f46] to-[#0d9488] rounded-[24px] p-5 relative overflow-hidden shadow-lg shadow-emerald-900/20 mt-6 lg:mb-2">
          <div className="absolute top-0 right-0 w-32 h-full opacity-10 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+CjxwYXRoIGQ9Ik0wIDBoNDB2NDBIMHoiIHRpbGw9Im5vbmUiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMiIgZmlsbD0iI2ZmZiIvPgo8L3N2Zz4=')] bg-repeat" />
          <div className="text-[10px] font-bold text-emerald-300 tracking-[0.1em] uppercase mb-1.5 z-10 relative">Tonight&apos;s Plan</div>
          <div className="text-xl md:text-2xl font-extrabold text-white leading-tight mb-2 z-10 relative">{tonightPlan.recipe.title}</div>
          <div className="flex gap-2 items-center text-emerald-100/90 text-xs font-medium z-10 relative">
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{tonightPlan.recipe.cooking_time_mins || '?'} min</span>
            <span className="opacity-50">·</span>
            <span className="flex items-center gap-1"><Users className="w-3 h-3" />{tonightPlan.servings || 2} servings</span>
          </div>
          <div className="mt-5 flex gap-2 z-10 relative">
            <Link href={`/recipes/${tonightPlan.recipe_id}/cook`} className="bg-white/20 border border-white/30 rounded-xl px-5 py-2 text-xs font-bold text-white hover:bg-white/30 transition-colors shadow-sm text-center">Start Cooking</Link>
            <Link href="/planner" className="border border-white/20 bg-transparent rounded-xl px-4 py-2 text-xs font-medium text-white/80 hover:bg-white/10 transition-colors text-center">Change</Link>
          </div>
        </div>
      )}

      {/* 2x2 Hybrid Dashboard Grid (Option D) */}
      <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 ${tonightPlan ? 'mt-3' : 'mt-6'}`}>
        
        {(!tonightPlan || mode === 'hangry') && (
          <Link href="/recipes?category=cook_now" className="col-span-2 lg:col-span-4 bg-gradient-to-br from-emerald-600 to-teal-600 rounded-[20px] p-4 text-white shadow-sm hover:opacity-95 transition-opacity flex items-center justify-between group">
            <div>
              <div className="text-[11px] text-emerald-200 font-bold uppercase tracking-wider">Cook Now</div>
              <div className="text-4xl font-extrabold leading-none mt-1 mb-1.5 group-hover:scale-105 transition-transform origin-left">{isLoading ? '-' : cookNowCount}</div>
              <div className="text-[11px] text-emerald-100 font-medium">recipes ready to make</div>
            </div>
            <div className="text-right hidden sm:block flex-shrink-0">
               <div className="text-[10px] text-white/60 font-medium mb-1.5">Top picks</div>
               {topMatches.slice(0,2).map((m, i) => (
                 <div key={i} className="text-xs font-semibold text-white mb-0.5 truncate max-w-[200px]">✓ {m.recipe.title}</div>
               ))}
               {topMatches.length > 2 && <div className="text-[10px] text-white/50 mt-1">+{topMatches.length - 2} more →</div>}
            </div>
          </Link>
        )}

        <Link href="/pantry" className="bg-white dark:bg-gray-800 border-transparent dark:border-gray-700/60 border hover:border-gray-300 dark:hover:border-gray-500 rounded-[20px] p-4 transition-colors">
          <ShoppingBasket className="w-6 h-6 mb-1.5 text-emerald-500" />
          <div className="text-xs font-bold text-gray-900 dark:text-white">My Pantry</div>
          <div className="text-[10px] text-gray-500 mt-0.5 font-medium">{available?.length ?? 0} ingredients</div>
          <div className="mt-2.5 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
             <div className="h-full bg-emerald-500 rounded-full w-4/5"></div>
          </div>
          <div className="text-[9px] text-gray-400 mt-1.5 font-medium border-t border-transparent">82% stocked</div>
        </Link>
        
        <Link href="/planner" className="bg-white dark:bg-gray-800 border-transparent dark:border-gray-700/60 border hover:border-gray-300 dark:hover:border-gray-500 rounded-[20px] p-4 transition-colors">
          <div className="text-[9px] font-bold text-emerald-500 mb-1 leading-none tracking-wider uppercase border-b border-transparent">This week</div>
          <div className="text-xs font-bold text-gray-900 dark:text-white border-t border-transparent leading-none mt-1">Meal Plan</div>
          <div className="text-[10px] text-gray-500 mt-1 font-medium">{currentPlan?.entries.length ?? 0} of 7 planned</div>
          <div className="flex gap-1 mt-2.5 h-6 items-center">
             {['M','T','W','T','F','S','S'].map((day, idx) => {
                const isPlanned = currentPlan?.entries.some(e => e.day_of_week === idx);
                const isToday = todayIndex === idx;
                return (
                  <div key={idx} className={`w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold ${isPlanned ? 'bg-emerald-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'} ${isToday && !isPlanned ? 'ring-2 ring-offset-1 ring-offset-white dark:ring-offset-gray-800 ring-blue-500 bg-blue-500 text-white' : ''} ${isToday && isPlanned ? 'ring-2 ring-offset-1 ring-offset-white dark:ring-offset-gray-800 ring-emerald-500' : ''}`}>
                    {day}
                  </div>
                )
             })}
          </div>
        </Link>

        {/* Scan / At Risk subgrid */}
        <div className="col-span-2 lg:col-span-2 grid gap-3 grid-cols-2">
          <Link href="/ingest" className="bg-white dark:bg-gray-800 border-transparent dark:border-gray-700/60 border hover:border-gray-300 dark:hover:border-gray-500 rounded-[16px] p-3 pl-4 flex items-center gap-3 transition-colors col-span-2 lg:col-span-1">
            <ScanLine className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
            <div>
              <div className="text-[11px] font-bold text-gray-900 dark:text-white">Scan Card</div>
              <div className="text-[9px] text-gray-500 font-medium mt-0.5">Add recipe</div>
            </div>
          </Link>
          
          {atRiskCount > 0 ? (
            <Link href="/recipes?sort=use_it_up" className="bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20 border hover:bg-orange-100 dark:hover:bg-orange-500/30 rounded-[16px] p-3 pl-4 flex items-center gap-3 transition-colors col-span-2 lg:col-span-1">
              <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0" />
              <div>
                <div className="text-[11px] font-bold text-orange-600 dark:text-orange-400">{atRiskCount} going off</div>
                <div className="text-[9px] text-orange-800 dark:text-orange-600/70 font-medium mt-0.5">Use them up</div>
              </div>
            </Link>
          ) : (
            <div className="bg-white/50 dark:bg-gray-800/30 border border-transparent dark:border-gray-700/30 rounded-[16px] p-3 pl-4 flex items-center gap-3 col-span-2 lg:col-span-1 border-dashed">
              <Sparkles className="w-5 h-5 text-gray-300 dark:text-gray-600 flex-shrink-0" />
              <div>
                <div className="text-[11px] font-bold text-gray-400 dark:text-gray-500">Pantry clear</div>
                <div className="text-[9px] text-gray-400 dark:text-gray-500 font-medium mt-0.5">Nothing going off</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top recipes */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {mode === 'hangry' ? <span className="flex items-center gap-1.5"><Flame className="w-4 h-4 text-orange-500" />Quick Matches</span> : <span className="flex items-center gap-1.5"><CalendarDays className="w-4 h-4 text-emerald-500" />Top Matches</span>}
          </h2>
          <Link href="/recipes" className="text-sm text-emerald-600 font-medium hover:underline">
            See all
          </Link>
        </div>

        {isLoading ? (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex-shrink-0 w-48 rounded-2xl overflow-hidden bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 animate-pulse">
                <div className="w-full h-28 bg-gray-200 dark:bg-gray-700" />
                <div className="p-3 space-y-2">
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : topMatches.length === 0 ? (
          <div className="text-center py-10 bg-gray-50/50 dark:bg-gray-800/30 rounded-3xl border border-dashed border-gray-200 dark:border-gray-700">
            <PackageSearch className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-500 dark:text-gray-400 px-8">
              {mode === 'hangry' 
                ? "No recipes ready to cook right now. Try updating your pantry!" 
                : "No recipes yet. Scan your first card!"}
            </p>
            {mode === 'hangry' && (
              <Link href="/pantry" className="inline-block mt-4 text-xs font-bold text-orange-600 hover:text-orange-500 uppercase tracking-wider">
                Update Pantry →
              </Link>
            )}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
            {topMatches.map((match) => (
              <RecipeCard key={match.recipe.id} match={match} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
