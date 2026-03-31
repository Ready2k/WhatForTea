'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMatches } from '@/lib/hooks';
import { MatchBadge } from '@/components/MatchBadge';
import type { RecipeMatchResult } from '@/lib/types';

type Mode = 'planning' | 'hangry';

function RecipeCard({ match }: { match: RecipeMatchResult }) {
  return (
    <Link
      href={`/recipes/${match.recipe.id}`}
      className="flex-shrink-0 w-48 rounded-2xl overflow-hidden bg-white shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
    >
      <div className="w-full h-28 bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
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
        <p className="text-sm font-semibold text-gray-900 leading-tight line-clamp-2">{match.recipe.title}</p>
        {match.recipe.cooking_time_mins && (
          <p className="text-xs text-gray-500">{match.recipe.cooking_time_mins} min</p>
        )}
        <MatchBadge score={match.score} category={match.category} />
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const [mode, setMode] = useState<Mode>('planning');
  const { data: allMatches, isLoading } = useMatches();

  const cookNowCount = allMatches?.filter((m) => m.category === 'cook_now').length ?? 0;
  const topMatches = allMatches?.slice(0, 3) ?? [];

  return (
    <main className="max-w-lg mx-auto px-4 pt-6 pb-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">What's for Tea?</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {mode === 'hangry' ? 'Quick — what can I cook RIGHT NOW?' : 'Plan your week ahead'}
          </p>
        </div>
        <button
          onClick={() => setMode((m) => (m === 'planning' ? 'hangry' : 'planning'))}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
            mode === 'hangry'
              ? 'bg-orange-500 text-white shadow-orange-200 shadow-md'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
          className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="text-3xl">🥦</div>
          <div className="text-sm font-semibold text-gray-900 mt-1">My Pantry</div>
          <div className="text-xs text-gray-500 mt-0.5">Manage ingredients</div>
        </Link>

        <Link
          href="/planner"
          className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="text-3xl">📅</div>
          <div className="text-sm font-semibold text-gray-900 mt-1">This Week</div>
          <div className="text-xs text-gray-500 mt-0.5">Meal plan & shopping</div>
        </Link>

        <Link
          href="/ingest"
          className="rounded-2xl bg-white border border-gray-100 p-4 shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="text-3xl">📷</div>
          <div className="text-sm font-semibold text-gray-900 mt-1">Scan Card</div>
          <div className="text-xs text-gray-500 mt-0.5">Add new recipe</div>
        </Link>
      </div>

      {/* Top recipes */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">Top Matches</h2>
          <Link href="/recipes" className="text-sm text-emerald-600 font-medium hover:underline">
            See all
          </Link>
        </div>

        {isLoading ? (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex-shrink-0 w-48 rounded-2xl overflow-hidden bg-white shadow-sm border border-gray-100 animate-pulse">
                <div className="w-full h-28 bg-gray-200" />
                <div className="p-3 space-y-2">
                  <div className="h-3 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : topMatches.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <p className="text-4xl mb-2">🍽️</p>
            <p className="text-sm">No recipes yet. Scan your first card!</p>
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
