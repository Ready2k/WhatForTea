'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMatches } from '@/lib/hooks';
import { MatchBadge } from '@/components/MatchBadge';
import type { RecipeMatchResult } from '@/lib/types';

const FILTER_TABS = [
  { label: 'All', value: undefined },
  { label: 'Cook Now', value: 'cook_now' },
  { label: 'Almost There', value: 'almost_there' },
  { label: 'Planner', value: 'planner' },
] as const;

function RecipeGridCard({ match }: { match: RecipeMatchResult }) {
  return (
    <Link
      href={`/recipes/${match.recipe.id}`}
      className="rounded-2xl overflow-hidden bg-white border border-gray-100 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="w-full aspect-video bg-gradient-to-br from-emerald-50 to-teal-100 flex items-center justify-center">
        {match.recipe.hero_image_path ? (
          <img
            src={`/api/v1/recipes/${match.recipe.id}/image`}
            alt={match.recipe.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-5xl">🍽️</span>
        )}
      </div>
      <div className="p-3 space-y-2">
        <h3 className="text-sm font-semibold text-gray-900 leading-tight line-clamp-2">
          {match.recipe.title}
        </h3>
        <div className="flex items-center justify-between gap-2">
          {match.recipe.cooking_time_mins && (
            <span className="text-xs text-gray-500">⏱ {match.recipe.cooking_time_mins} min</span>
          )}
        </div>
        {match.recipe.mood_tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {match.recipe.mood_tags.slice(0, 2).map((tag) => (
              <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        )}
        <MatchBadge score={match.score} category={match.category} />
      </div>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl overflow-hidden bg-white border border-gray-100 animate-pulse">
      <div className="w-full aspect-video bg-gray-200" />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-gray-200 rounded w-3/4" />
        <div className="h-3 bg-gray-200 rounded w-1/2" />
        <div className="h-5 bg-gray-200 rounded w-1/3" />
      </div>
    </div>
  );
}

export default function RecipesPage() {
  const searchParams = useSearchParams();
  const initialCategory = searchParams.get('category') ?? undefined;
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(initialCategory);

  const { data: matches, isLoading, isError, refetch } = useMatches(selectedCategory);

  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 pb-4">
      <h1 className="text-xl font-bold text-gray-900 mb-4">Recipe Library</h1>

      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-4 px-4">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setSelectedCategory(tab.value)}
            className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedCategory === tab.value
                ? 'bg-emerald-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isError && (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-3">Failed to load recipes</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700"
          >
            Retry
          </button>
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {!isLoading && !isError && matches?.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-5xl mb-3">🍽️</p>
          <p className="font-medium text-gray-600">No recipes found</p>
          <p className="text-sm mt-1">
            {selectedCategory ? 'Try a different filter' : 'Scan a recipe card to get started'}
          </p>
          <Link
            href="/ingest"
            className="inline-block mt-4 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700"
          >
            Scan Recipe Card
          </Link>
        </div>
      )}

      {!isLoading && !isError && matches && matches.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {matches.map((match) => (
            <RecipeGridCard key={match.recipe.id} match={match} />
          ))}
        </div>
      )}
    </main>
  );
}
