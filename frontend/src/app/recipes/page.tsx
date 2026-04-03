'use client';

import { useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMatches } from '@/lib/hooks';
import { MatchBadge } from '@/components/MatchBadge';
import type { RecipeMatchResult } from '@/lib/types';

// ── Constants ─────────────────────────────────────────────────────────────────
const FILTER_TABS = [
  { label: 'All',          value: undefined },
  { label: 'Cook Now',     value: 'cook_now' },
  { label: 'Almost There', value: 'almost_there' },
  { label: 'Planner',      value: 'planner' },
] as const;

// ── Recipe card ───────────────────────────────────────────────────────────────
function RecipeGridCard({ match, query, showUrgency }: { match: RecipeMatchResult; query: string; showUrgency?: boolean }) {
  // Highlight matching text in title
  const title = match.recipe.title;
  const lq = query.toLowerCase();
  const idx = query ? title.toLowerCase().indexOf(lq) : -1;

  return (
    <Link
      href={`/recipes/${match.recipe.id}`}
      className="group rounded-2xl overflow-hidden bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
    >
      <div className="w-full aspect-video bg-gradient-to-br from-emerald-50 to-teal-100 dark:from-emerald-900/30 dark:to-teal-900/30 flex items-center justify-center overflow-hidden">
        {match.recipe.hero_image_path ? (
          <img
            src={`/api/v1/recipes/${match.recipe.id}/image`}
            alt={match.recipe.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <span className="text-5xl">🍽️</span>
        )}
      </div>
      <div className="p-3 space-y-1.5">
        {/* Title with optional highlight */}
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white leading-tight line-clamp-2">
          {idx >= 0 ? (
            <>
              {title.slice(0, idx)}
              <mark className="bg-emerald-100 dark:bg-emerald-800/60 text-emerald-800 dark:text-emerald-200 rounded-sm px-0.5">
                {title.slice(idx, idx + lq.length)}
              </mark>
              {title.slice(idx + lq.length)}
            </>
          ) : title}
        </h3>

        <div className="flex items-center gap-2 flex-wrap">
          {match.recipe.cooking_time_mins && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              ⏱ {match.recipe.cooking_time_mins} min
            </span>
          )}
          {match.recipe.last_cooked_at && (() => {
            const days = Math.floor((Date.now() - new Date(match.recipe.last_cooked_at!).getTime()) / 86400000);
            return (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Cooked {days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`}
              </span>
            );
          })()}
        </div>

        {match.recipe.mood_tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {match.recipe.mood_tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        )}

        {showUrgency && match.at_risk_ingredients && match.at_risk_ingredients.length > 0 ? (
          <div className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400 font-medium">
            <span>⚠</span>
            <span>Uses {match.at_risk_ingredients.length} expiring item{match.at_risk_ingredients.length > 1 ? 's' : ''}</span>
          </div>
        ) : (
          <MatchBadge score={match.score} category={match.category} />
        )}
      </div>
    </Link>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="rounded-2xl overflow-hidden bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 animate-pulse">
      <div className="w-full aspect-video bg-gray-200 dark:bg-gray-700" />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
      </div>
    </div>
  );
}

// ── Main content ──────────────────────────────────────────────────────────────
function RecipesContent() {
  const searchParams = useSearchParams();
  const initialCategory = searchParams.get('category') ?? undefined;
  const initialSort = searchParams.get('sort');

  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(initialCategory);
  const [query, setQuery] = useState('');
  const [selectedMoodTag, setSelectedMoodTag] = useState<string | null>(null);
  const [useItUp, setUseItUp] = useState(initialSort === 'use_it_up');

  const { data: matches, isLoading, isError, refetch } = useMatches(
    selectedCategory,
    useItUp ? 'use_it_up' : undefined,
  );

  // Collect unique mood tags from current category results
  const allMoodTags = useMemo(() => {
    if (!matches) return [];
    const tags = new Set<string>();
    matches.forEach((m) => m.recipe.mood_tags?.forEach((t) => tags.add(t)));
    return [...tags].sort();
  }, [matches]);

  // Apply client-side filters
  const filtered = useMemo(() => {
    if (!matches) return [];
    const q = query.trim().toLowerCase();
    return matches
      .filter((m) => !q || m.recipe.title.toLowerCase().includes(q))
      .filter((m) => !selectedMoodTag || m.recipe.mood_tags?.includes(selectedMoodTag));
  }, [matches, query, selectedMoodTag]);

  const hasActiveFilters = query.trim() !== '' || selectedMoodTag !== null;

  function clearFilters() {
    setQuery('');
    setSelectedMoodTag(null);
  }

  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 pb-20">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Recipe Library</h1>
        {!isLoading && matches && (
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2.5 py-1 rounded-full">
            {filtered.length} {filtered.length === 1 ? 'recipe' : 'recipes'}
          </span>
        )}
      </div>

      {/* ── Search bar ──────────────────────────────────────────────────────── */}
      <div className="relative mb-3">
        <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none">
          <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
        <input
          type="search"
          id="recipe-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search recipes by name…"
          className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
            aria-label="Clear search"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Category tabs ────────────────────────────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-3 -mx-4 px-4 no-scrollbar">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setSelectedCategory(tab.value)}
            className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedCategory === tab.value
                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-500/30'
                : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Use it up toggle ────────────────────────────────────────────────── */}
      <div className="mb-3">
        <button
          onClick={() => setUseItUp((v) => !v)}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            useItUp
              ? 'bg-orange-500 text-white shadow-sm shadow-orange-400/30'
              : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
        >
          <span>⚠</span>
          Use it up
        </button>
      </div>

      {/* ── Mood tag pills ───────────────────────────────────────────────────── */}
      {allMoodTags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-4">
          {allMoodTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setSelectedMoodTag(selectedMoodTag === tag ? null : tag)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                selectedMoodTag === tag
                  ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-400 dark:ring-emerald-600'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* ── Active filter indicator ──────────────────────────────────────────── */}
      {hasActiveFilters && !isLoading && (
        <div className="flex items-center gap-2 mb-3 text-xs text-gray-500 dark:text-gray-400">
          <span>
            Showing {filtered.length} of {matches?.length ?? 0} recipes
          </span>
          <button
            onClick={clearFilters}
            className="text-emerald-600 dark:text-emerald-400 font-medium hover:underline"
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* ── Error state ──────────────────────────────────────────────────────── */}
      {isError && (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400 mb-3">Failed to load recipes</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Loading skeleton ─────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────────────── */}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <p className="text-5xl mb-3">{hasActiveFilters ? '🔍' : '🍽️'}</p>
          <p className="font-medium text-gray-600 dark:text-gray-300">
            {hasActiveFilters ? 'No recipes match your search' : 'No recipes found'}
          </p>
          {hasActiveFilters ? (
            <button
              onClick={clearFilters}
              className="mt-3 text-sm text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
            >
              Clear filters
            </button>
          ) : (
            <>
              <p className="text-sm mt-1">
                {selectedCategory ? 'Try a different filter' : 'Scan a recipe card to get started'}
              </p>
              <Link
                href="/ingest"
                className="inline-block mt-4 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700"
              >
                Scan Recipe Card
              </Link>
            </>
          )}
        </div>
      )}

      {/* ── Recipe grid ──────────────────────────────────────────────────────── */}
      {!isLoading && !isError && filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filtered.map((match) => (
            <RecipeGridCard key={match.recipe.id} match={match} query={query.trim()} showUrgency={useItUp} />
          ))}
        </div>
      )}
    </main>
  );
}

export default function RecipesPage() {
  return (
    <Suspense>
      <RecipesContent />
    </Suspense>
  );
}
