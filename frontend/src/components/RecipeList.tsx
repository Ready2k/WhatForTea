'use client';

import { useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { useMatches, useCollections, useCollectionRecipeIds } from '@/lib/hooks';
import { MatchBadge } from '@/components/MatchBadge';
import type { RecipeMatchResult } from '@/lib/types';
import { Clock, Search } from 'lucide-react';

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
      className="card-premium group overflow-hidden animate-in"
    >
      <div className="w-full aspect-video bg-gradient-to-br from-brand-linen/20 to-brand-linen/40 dark:from-brand-primary-hover/30 dark:to-brand-primary-hover/50 flex items-center justify-center overflow-hidden">
        {match.recipe.hero_image_path ? (
          <img
            src={`/api/v1/recipes/${match.recipe.id}/image`}
            alt={match.recipe.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <span className="text-3xl opacity-30">🍽</span>
        )}
      </div>
      <div className="p-3 space-y-1.5">
        {/* Title with optional highlight */}
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white leading-tight line-clamp-2">
          {idx >= 0 ? (
            <>
              {title.slice(0, idx)}
              <mark className="bg-brand-accent/20 dark:bg-brand-accent/40 text-brand-ink dark:text-brand-background rounded-sm px-0.5">
                {title.slice(idx, idx + lq.length)}
              </mark>
              {title.slice(idx + lq.length)}
            </>
          ) : title}
        </h3>

        <div className="flex items-center gap-2 flex-wrap">
          {match.recipe.cooking_time_mins && (
            <span className="text-xs text-brand-muted dark:text-brand-secondary">
              <Clock className="w-3 h-3 inline mr-0.5" />{match.recipe.cooking_time_mins} min
            </span>
          )}
          {match.recipe.last_cooked_at && (() => {
            const days = Math.floor((Date.now() - new Date(match.recipe.last_cooked_at!).getTime()) / 86400000);
            return (
              <span className="text-xs text-brand-muted/60 dark:text-brand-secondary/60">
                Cooked {days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`}
              </span>
            );
          })()}
        </div>

        {match.recipe.mood_tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {match.recipe.mood_tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-xs bg-brand-linen/20 dark:bg-brand-primary-hover text-brand-muted dark:text-brand-secondary px-1.5 py-0.5 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        )}

        {showUrgency && match.at_risk_ingredients && match.at_risk_ingredients.length > 0 ? (
          <div className="flex items-center gap-1 text-xs text-brand-accent font-medium">
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
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const TAG_VISIBLE_COUNT = 8;

  const { data: matches, isLoading, isError, refetch } = useMatches(
    selectedCategory,
    useItUp ? 'use_it_up' : undefined,
  );
  const { data: collections = [] } = useCollections();
  const { data: collectionRecipes } = useCollectionRecipeIds(selectedCollectionId);
  const collectionRecipeSet = collectionRecipes
    ? new Set(collectionRecipes.recipe_ids)
    : null;

  // Collect unique mood tags — normalise to lowercase to deduplicate existing dirty data
  const allMoodTags = useMemo(() => {
    if (!matches) return [];
    const seen = new Set<string>();
    matches.forEach((m) => m.recipe.mood_tags?.forEach((t) => seen.add(t.trim().toLowerCase())));
    return [...seen].sort();
  }, [matches]);

  // Apply client-side filters
  const filtered = useMemo(() => {
    if (!matches) return [];
    const q = query.trim().toLowerCase();
    return matches
      .filter((m) => !q || m.recipe.title.toLowerCase().includes(q))
      .filter((m) => !selectedMoodTag || m.recipe.mood_tags?.some((t) => t.trim().toLowerCase() === selectedMoodTag))
      .filter((m) => !collectionRecipeSet || collectionRecipeSet.has(m.recipe.id));
  }, [matches, query, selectedMoodTag, collectionRecipeSet]);

  const hasActiveFilters = query.trim() !== '' || selectedMoodTag !== null || selectedCollectionId !== null;

  function clearFilters() {
    setQuery('');
    setSelectedMoodTag(null);
    setSelectedCollectionId(null);
  }

  return (
    <main className="max-w-2xl mx-auto px-4 pt-6 pb-20">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-brand-ink dark:text-brand-background">Recipe Library</h1>
        {!isLoading && matches && (
          <span className="text-xs font-medium text-brand-muted dark:text-brand-secondary bg-brand-linen/20 dark:bg-brand-primary-hover px-2.5 py-1 rounded-full">
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
          className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-brand-card dark:bg-brand-primary-hover border border-brand-linen dark:border-brand-primary/60 text-sm text-brand-ink dark:text-brand-background placeholder-brand-muted focus:outline-none focus:ring-2 focus:ring-brand-accent focus:border-transparent transition"
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
                ? 'bg-brand-primary text-brand-background shadow-sm shadow-brand-primary/30'
                : 'bg-brand-card dark:bg-brand-primary-hover border border-brand-linen dark:border-brand-primary/60 text-brand-muted dark:text-brand-secondary hover:bg-brand-linen/10 dark:hover:bg-brand-primary'
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
                ? 'bg-brand-accent text-brand-ink shadow-sm shadow-brand-accent/30'
                : 'bg-brand-card dark:bg-brand-primary-hover border border-brand-linen dark:border-brand-primary/60 text-brand-muted dark:text-brand-secondary hover:bg-brand-linen/10 dark:hover:bg-brand-primary'
            }`}
          >
          <span>⚠</span>
          Use it up
        </button>
      </div>

      {/* ── Mood tag pills ───────────────────────────────────────────────────── */}
      {allMoodTags.length > 0 && (
        <div className="mb-4">
          <div className="flex gap-1.5 flex-wrap">
            {(tagsExpanded ? allMoodTags : allMoodTags.slice(0, TAG_VISIBLE_COUNT)).map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedMoodTag(selectedMoodTag === tag ? null : tag)}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  selectedMoodTag === tag
                    ? 'bg-brand-herb/20 dark:bg-brand-herb/40 text-brand-herb ring-1 ring-brand-herb/50'
                    : 'bg-brand-linen/20 dark:bg-brand-primary-hover text-brand-muted dark:text-brand-secondary hover:bg-brand-linen/40 dark:hover:bg-brand-primary'
                }`}
              >
                {tag}
              </button>
            ))}
            {allMoodTags.length > TAG_VISIBLE_COUNT && (
              <button
                onClick={() => setTagsExpanded(!tagsExpanded)}
                className="flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium bg-brand-linen/20 dark:bg-brand-primary-hover text-brand-muted dark:text-brand-secondary hover:bg-brand-linen/40 dark:hover:bg-brand-primary transition-all"
              >
                {tagsExpanded ? 'Show less' : `+${allMoodTags.length - TAG_VISIBLE_COUNT} more`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Collection filter chips ──────────────────────────────────────────── */}
      {collections.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-4 items-center">
          <span className="text-xs text-gray-400 dark:text-gray-500 mr-1">Collections:</span>
          {collections.map((col) => (
            <button
              key={col.id}
              onClick={() => setSelectedCollectionId(selectedCollectionId === col.id ? null : col.id)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all border ${
                selectedCollectionId === col.id
                  ? 'text-brand-background shadow-sm'
                  : 'bg-brand-card dark:bg-brand-primary-hover text-brand-muted dark:text-brand-secondary hover:bg-brand-linen/10 dark:hover:bg-brand-primary border-brand-linen dark:border-brand-primary/60'
              }`}
              style={selectedCollectionId === col.id
                ? { backgroundColor: col.colour, borderColor: col.colour }
                : { borderColor: col.colour + '80' }}
            >
              {col.name}
              <span className="ml-1 opacity-60">{col.recipe_count}</span>
            </button>
          ))}
          <Link
            href="/collections"
            className="text-xs text-brand-muted hover:text-brand-primary dark:text-brand-secondary dark:hover:text-brand-background ml-1"
          >
            Manage
          </Link>
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
            className="text-brand-herb hover:underline font-medium"
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
            className="px-4 py-2 bg-brand-primary text-brand-background rounded-xl text-sm font-medium hover:bg-brand-primary-hover"
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
          {hasActiveFilters ? (
            <>
              <Search className="w-10 h-10 mx-auto mb-3 text-brand-linen dark:text-brand-primary-hover" />
              <p className="font-medium text-brand-ink dark:text-brand-background">No recipes match your search</p>
              <button
                onClick={clearFilters}
                className="mt-3 text-sm text-brand-herb hover:underline font-medium"
              >
                Clear filters
              </button>
            </>
          ) : (matches?.length ?? 0) === 0 ? (
            // True first-run: no recipes at all
            <div className="flex flex-col items-center gap-4 px-6">
              <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-brand-linen/30 dark:border-brand-primary-hover shadow-lg">
                <Image src="/teabot-chef.png" alt="TeaBot" width={96} height={96} className="object-cover" />
              </div>
              <div>
                <p className="font-semibold text-brand-ink dark:text-brand-background">Hi, I&apos;m TeaBot!</p>
                <p className="text-sm text-brand-muted dark:text-brand-secondary mt-1">
                  Your kitchen is empty. Scan your first recipe card to get started.
                </p>
              </div>
              <Link
                href="/ingest"
                className="px-6 py-3 bg-brand-primary text-brand-background rounded-xl text-sm font-semibold hover:bg-brand-primary-hover shadow-sm transition-colors"
              >
                Scan a Recipe Card
              </Link>
            </div>
          ) : (
            // Has recipes but current filter shows nothing
            <>
              <p className="font-medium text-brand-ink dark:text-brand-background">No recipes in this category</p>
              <p className="text-sm text-brand-muted mt-1">Try a different filter</p>
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

export function RecipeList() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-brand-muted">Loading recipe library...</div>}>
      <RecipesContent />
    </Suspense>
  );
}
