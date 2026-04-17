'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useMatches, useAvailable } from '@/lib/hooks';
import { MatchBadge } from '@/components/MatchBadge';
import { getActiveCookingSession } from '@/lib/api';
import type { RecipeMatchResult } from '@/lib/types';
import {
  UtensilsCrossed, ChefHat, AlertTriangle, Flame, CalendarDays,
  ShoppingBasket, ScanLine, PackageSearch, Clock,
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
  const atRiskCount = available?.filter((a) => a.confidence < 0.5).length ?? 0;
  const { data: activeSession } = useQuery({
    queryKey: ['cookingSession'],
    queryFn: () => getActiveCookingSession(),
    staleTime: 30_000,
  });

  const cookNowCount = allMatches?.filter((m) => m.category === 'cook_now').length ?? 0;

  const filteredMatches = allMatches?.filter(m => {
    if (mode === 'hangry') return m.category === 'cook_now';
    return true;
  }) ?? [];

  const topMatches = filteredMatches.slice(0, 3);

  return (
    <main className="max-w-lg mx-auto px-4 pt-6 pb-4 space-y-6">

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

      {/* At-risk pantry prompt */}
      {atRiskCount > 0 && mode === 'planning' && !activeSession && (
        <Link
          href="/recipes?sort=use_it_up"
          className="flex items-center gap-3 w-full px-4 py-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700/40 rounded-2xl hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors"
        >
          <AlertTriangle className="w-5 h-5 flex-shrink-0 text-orange-500" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-orange-800 dark:text-orange-300">
              {atRiskCount} ingredient{atRiskCount > 1 ? 's are' : ' is'} going off
            </p>
            <p className="text-xs text-orange-600 dark:text-orange-400">Find recipes that use them up</p>
          </div>
          <svg className="w-5 h-5 text-orange-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">What&apos;s for Tea?</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {mode === 'hangry' ? 'Quick — what can I cook RIGHT NOW?' : 'Plan your week ahead'}
          </p>
        </div>
        <button
          onClick={() => setMode((m) => (m === 'planning' ? 'hangry' : 'planning'))}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
            mode === 'hangry'
              ? 'bg-orange-500 text-white shadow-orange-200 shadow-md'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          {mode === 'hangry' ? <><Flame className="w-3.5 h-3.5 inline mr-1" />Hangry</> : <><CalendarDays className="w-3.5 h-3.5 inline mr-1" />Planning</>}
        </button>
      </div>

      {/* Quick tiles */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/recipes?category=cook_now"
          className="rounded-2xl bg-emerald-500 p-4 text-white shadow-sm hover:bg-emerald-600 transition-colors"
        >
          <div className="text-3xl font-bold">
            {isLoading ? '—' : cookNowCount}
          </div>
          <div className="text-sm font-medium mt-1 text-emerald-100">Cook Now</div>
          <div className="text-xs text-emerald-200 mt-0.5">Ready to make</div>
        </Link>

        <Link
          href="/pantry"
          className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-4 shadow-sm hover:shadow-md transition-shadow"
        >
          <ShoppingBasket className="w-8 h-8 text-emerald-500" />
          <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1">My Pantry</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Manage ingredients</div>
        </Link>
        
        {mode !== 'hangry' && (
          <>
            <Link
              href="/planner"
              className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <CalendarDays className="w-8 h-8 text-blue-500" />
              <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1">This Week</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Meal plan & shopping</div>
            </Link>

            <Link
              href="/ingest"
              className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <ScanLine className="w-8 h-8 text-purple-500" />
              <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1">Scan Card</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Add new recipe</div>
            </Link>
          </>
        )}
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
