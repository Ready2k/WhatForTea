'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useMatches } from '@/lib/hooks';
import { MatchBadge } from '@/components/MatchBadge';
import { getActiveCookingSession } from '@/lib/api';
import type { RecipeMatchResult } from '@/lib/types';
import type { CookingSession } from '@/lib/api';

type Mode = 'planning' | 'hangry';

function RecipeCard({ match }: { match: RecipeMatchResult }) {
  return (
    <Link
      href={`/recipes/${match.recipe.id}`}
      className="flex-shrink-0 w-48 rounded-2xl overflow-hidden bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md transition-shadow"
    >
      <div className="w-full h-28 bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-900/50 dark:to-teal-900/50 flex items-center justify-center">
        {match.recipe.hero_image_path ? (
          <img
            src={`/api/v1/recipes/${match.recipe.id}/image`}
            alt={match.recipe.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-4xl">🍽️</span>
        )}
      </div>
      <div className="p-3 space-y-1.5">
        <p className="text-sm font-semibold text-gray-900 dark:text-white leading-tight line-clamp-2">{match.recipe.title}</p>
        {match.recipe.cooking_time_mins && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{match.recipe.cooking_time_mins} min</p>
        )}
        <MatchBadge score={match.score} category={match.category} />
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const [mode, setMode] = useState<Mode>('planning');
  const { data: allMatches, isLoading } = useMatches();
  const [activeSession, setActiveSession] = useState<CookingSession | null>(null);

  useEffect(() => {
    getActiveCookingSession()
      .then((s) => setActiveSession(s))
      .catch(() => {});
  }, []);

  const cookNowCount = allMatches?.filter((m) => m.category === 'cook_now').length ?? 0;
  
  // Filter matches based on mode
  const filteredMatches = allMatches?.filter(m => {
    if (mode === 'hangry') {
      return m.category === 'cook_now';
    }
    return true; // Show all in planning mode
  }) ?? [];

  const topMatches = filteredMatches.slice(0, 3);

  return (
    <main className="max-w-lg mx-auto px-4 pt-6 pb-4 space-y-6">
      {/* Resume cooking banner */}
      {activeSession && (
        <Link
          href={`/recipes/${activeSession.recipe_id}/cook`}
          className="flex items-center gap-3 w-full px-4 py-3 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700/50 rounded-2xl hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
          onClick={() => setActiveSession(null)}
        >
          <span className="text-2xl flex-shrink-0">👨‍🍳</span>
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">What's for Tea?</h1>
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
          {mode === 'hangry' ? '🔥 Hangry' : '📅 Planning'}
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
          <div className="text-3xl">🥦</div>
          <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1">My Pantry</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Manage ingredients</div>
        </Link>
        
        {mode !== 'hangry' && (
          <>
            <Link
              href="/planner"
              className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="text-3xl">📅</div>
              <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1">This Week</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Meal plan & shopping</div>
            </Link>

            <Link
              href="/ingest"
              className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="text-3xl">📷</div>
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
            {mode === 'hangry' ? '🔥 Quick Matches' : '📅 Top Matches'}
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
            <p className="text-4xl mb-3">🧊</p>
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
