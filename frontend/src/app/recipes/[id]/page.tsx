'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { useRecipe, useMatches, useDeleteRecipe } from '@/lib/hooks';
import { MatchBadge } from '@/components/MatchBadge';
import type { IngredientMatchDetail } from '@/lib/types';

function IngredientScore({ detail }: { detail: IngredientMatchDetail | undefined; name: string }) {
  if (!detail) return <span className="text-gray-400 text-xs">—</span>;

  const pct = Math.round(detail.score * 100);
  let color = 'text-emerald-600';
  let icon = '✓';
  if (pct < 50) {
    color = 'text-red-500';
    icon = '✗';
  } else if (pct < 90) {
    color = 'text-yellow-500';
    icon = '~';
  }

  return (
    <span className={`text-xs font-medium ${color}`}>
      {icon} {pct}%
    </span>
  );
}

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: recipe, isLoading, isError, refetch } = useRecipe(id);
  const { data: matches } = useMatches();
  const deleteMutation = useDeleteRecipe();

  const matchData = matches?.find((m) => m.recipe.id === id);

  // Build ingredient score map
  const scoreMap = new Map<string, IngredientMatchDetail>();
  if (matchData) {
    [...matchData.full, ...matchData.partial, ...matchData.low_confidence, ...matchData.hard_missing].forEach(
      (d) => {
        if (d.ingredient_id) scoreMap.set(d.ingredient_id, d);
      }
    );
  }

  if (isLoading) {
    return (
      <main className="max-w-lg mx-auto animate-pulse">
        <div className="w-full aspect-video bg-gray-200" />
        <div className="p-4 space-y-3">
          <div className="h-6 bg-gray-200 rounded w-2/3" />
          <div className="h-4 bg-gray-200 rounded w-1/3" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-4 bg-gray-200 rounded" />
          ))}
        </div>
      </main>
    );
  }

  if (isError || !recipe) {
    return (
      <main className="max-w-lg mx-auto p-4 text-center py-16">
        <p className="text-gray-500 mb-3">Failed to load recipe</p>
        <button
          onClick={() => refetch()}
          className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium"
        >
          Retry
        </button>
      </main>
    );
  }

  const sortedSteps = [...recipe.steps].sort((a, b) => a.order - b.order);

  return (
    <main className="max-w-lg mx-auto pb-8">
      {/* Hero */}
      <div className="relative w-full aspect-video bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
        {recipe.hero_image_path ? (
          <img
            src={`/api/v1/recipes/${recipe.id}/image`}
            alt={recipe.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-7xl">🍽️</span>
        )}
        <button
          onClick={() => router.back()}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 transition-colors"
          aria-label="Go back"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Delete */}
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-red-500/80 transition-colors"
            aria-label="Delete recipe"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        ) : (
          <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5">
            <span className="text-white text-xs font-medium">Delete?</span>
            <button
              onClick={async () => {
                await deleteMutation.mutateAsync(id);
                router.replace('/recipes');
              }}
              disabled={deleteMutation.isPending}
              className="text-xs font-semibold text-red-300 hover:text-red-100 disabled:opacity-50"
            >
              {deleteMutation.isPending ? '…' : 'Yes'}
            </button>
            <span className="text-white/40 text-xs">|</span>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs font-semibold text-white/70 hover:text-white"
            >
              No
            </button>
          </div>
        )}
      </div>

      <div className="px-4 pt-4 space-y-5">
        {/* Title + meta */}
        <div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-bold text-gray-900 leading-tight">{recipe.title}</h1>
            {matchData && <MatchBadge score={matchData.score} category={matchData.category} />}
          </div>
          <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
            {recipe.cooking_time_mins && <span>⏱ {recipe.cooking_time_mins} min</span>}
            <span>👥 Serves {recipe.base_servings}</span>
          </div>
          {recipe.mood_tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {recipe.mood_tags.map((tag) => (
                <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Ingredients */}
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-2">Ingredients</h2>
          <ul className="space-y-1.5">
            {recipe.ingredients.map((ing) => {
              const detail = scoreMap.get(ing.ingredient_id);
              return (
                <li key={ing.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                  <span className="text-sm text-gray-800">{ing.raw_name}</span>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>
                      {ing.quantity} {ing.unit ?? ''}
                    </span>
                    <IngredientScore detail={detail} name={ing.raw_name} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Steps */}
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-2">Method</h2>
          <ol className="space-y-3">
            {sortedSteps.map((step, idx) => (
              <li key={step.id} className="flex gap-3">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 font-bold text-sm flex items-center justify-center">
                  {idx + 1}
                </span>
                <div className="flex-1 pt-0.5">
                  <p className="text-sm text-gray-800 leading-relaxed">{step.text}</p>
                  {step.timer_seconds && (
                    <span className="inline-block mt-1 text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                      ⏱ {Math.round(step.timer_seconds / 60)} min timer
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* CTA */}
        <Link
          href={`/recipes/${recipe.id}/cook`}
          className="block w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white text-center font-semibold text-base rounded-2xl transition-colors shadow-sm"
        >
          Start Cooking
        </Link>
      </div>
    </main>
  );
}
