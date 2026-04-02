'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRecipe, useMatches, useDeleteRecipe } from '@/lib/hooks';
import { MatchBadge } from '@/components/MatchBadge';
import { FixIngredients } from '@/components/FixIngredients';
import { rotateRecipePhoto, uploadRecipePhoto } from '@/lib/api';
import type { IngredientMatchDetail, RecipeIngredient, Recipe } from '@/lib/types';
import { updateRecipe } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';

function IngredientScore({ detail }: { detail: IngredientMatchDetail | undefined; name: string }) {
  if (!detail) return <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>;

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
  const [servings, setServings] = useState<number>(2);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [isFlipping, setIsFlipping] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [imageVersion, setImageVersion] = useState(0);
  const [isRotating, setIsRotating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  // Ingredient edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editIngredients, setEditIngredients] = useState<RecipeIngredient[]>([]);

  // Step edit state
  const [isEditingSteps, setIsEditingSteps] = useState(false);
  const [editSteps, setEditSteps] = useState<Array<{ order: number; text: string; timer_seconds?: number }>>([]);

  const queryClient = useQueryClient();
  const updateMutation = useMutation({
    mutationFn: (payload: { ingredients: Partial<RecipeIngredient>[] }) => updateRecipe(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipe', id] });
      setIsEditing(false);
    },
    onError: (err) => {
      alert(`Failed to update recipe: ${err.message}`);
    }
  });

  const updateStepsMutation = useMutation({
    mutationFn: (payload: { steps: Array<{ order: number; text: string; timer_seconds?: number }> }) =>
      updateRecipe(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipe', id] });
      setIsEditingSteps(false);
    },
    onError: (err) => {
      alert(`Failed to update steps: ${(err as Error).message}`);
    },
  });

  const { data: recipe, isLoading, isError, refetch } = useRecipe(id);
  const { data: matches } = useMatches();
  const deleteMutation = useDeleteRecipe();

  const matchData = matches?.find((m) => m.recipe.id === id);

  useEffect(() => {
    if (recipe) setServings(recipe.base_servings ?? 2);
  }, [recipe?.id]);

  useEffect(() => { setMounted(true); }, []);

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxOpen]);

  function handleFlip() {
    if (isFlipping || !recipe || recipe.image_count < 2) return;
    setIsFlipping(true);
    setTimeout(() => {
      setLightboxIndex((i) => (i === 0 ? 1 : 0));
      setIsFlipping(false);
    }, 150); // flip at mid-point of animation
  }

  async function handleRotate(index: number) {
    if (isRotating) return;
    setIsRotating(true);
    try {
      await rotateRecipePhoto(id, index);
      setImageVersion(v => v + 1);
    } catch (err) {
      alert('Failed to rotate image');
      console.error(err);
    } finally {
      setIsRotating(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || isUploading) return;
    
    setIsUploading(true);
    try {
      await uploadRecipePhoto(id, file);
      setImageVersion(v => v + 1);
      refetch(); // New hero path might have changed
    } catch (err) {
      alert('Failed to upload image');
      console.error(err);
    } finally {
      setIsUploading(false);
      e.target.value = ''; // Reset input
    }
  }

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
        <div className="w-full aspect-video bg-gray-200 dark:bg-gray-700" />
        <div className="p-4 space-y-3">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
          ))}
        </div>
      </main>
    );
  }

  if (isError || !recipe) {
    return (
      <main className="max-w-lg mx-auto p-4 text-center py-16">
        <p className="text-gray-500 dark:text-gray-400 mb-3">Failed to load recipe</p>
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
    <>
    <main className="max-w-lg mx-auto pb-8">
      {/* Hero — clickable to open lightbox */}
      <div className="relative w-full aspect-video bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-900/50 dark:to-teal-900/50 flex items-center justify-center">
        {recipe.hero_image_path ? (
          <div className="relative w-full h-full group">
            <button
              onClick={() => { setLightboxIndex(0); setLightboxOpen(true); }}
              className="w-full h-full focus:outline-none relative overflow-hidden"
              aria-label="View full-size image"
            >
              <img
                src={`/api/v1/recipes/${recipe.id}/image?index=0&v=${imageVersion}`}
                alt={recipe.title}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              {/* Expand hint */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 backdrop-blur-sm text-white text-sm font-medium px-3 py-1.5 rounded-full flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                  {recipe.image_count > 1 ? 'View card (front + back)' : 'View full size'}
                </span>
              </div>
            </button>

            {/* Photo Controls */}
            <div className="absolute bottom-4 right-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handleRotate(0)}
                disabled={isRotating}
                className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-white hover:bg-white/40 transition-colors shadow-lg"
                title="Rotate image"
              >
                <svg className={`w-5 h-5 ${isRotating ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <label className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center text-white hover:bg-white/40 transition-colors shadow-lg cursor-pointer">
                <input type="file" accept="image/*" onChange={handleUpload} className="hidden" disabled={isUploading} />
                <svg className={`w-5 h-5 ${isUploading ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </label>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <span className="text-7xl">🍽️</span>
            <label className="px-4 py-2 bg-white/20 backdrop-blur-md border border-white/30 rounded-xl text-white text-sm font-medium hover:bg-white/30 transition-colors cursor-pointer focus-within:ring-2 focus-within:ring-emerald-500">
              <input type="file" accept="image/*" onChange={handleUpload} className="hidden" disabled={isUploading} />
              {isUploading ? 'Uploading...' : 'Add Photo'}
            </label>
          </div>
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
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white leading-tight">{recipe.title}</h1>
            {matchData && <MatchBadge score={matchData.score} category={matchData.category} />}
          </div>
          <div className="flex items-center gap-3 mt-2 text-sm text-gray-500 dark:text-gray-400">
            {recipe.cooking_time_mins && <span>⏱ {recipe.cooking_time_mins} min</span>}
            <span>👥 Serves {recipe.base_servings}</span>
          </div>
          {recipe.mood_tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {recipe.mood_tags.map((tag) => (
                <span key={tag} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Ingredients */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Ingredients</h2>
              {!isEditing ? (
                <button
                  onClick={() => {
                    setEditIngredients(JSON.parse(JSON.stringify(recipe.ingredients)));
                    setIsEditing(true);
                  }}
                  className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 px-2 py-0.5 rounded transition-colors"
                >
                  Edit
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateMutation.mutate({ ingredients: editIngredients })}
                    disabled={updateMutation.isPending}
                    className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                  >
                    {updateMutation.isPending ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => setIsEditing(false)}
                    disabled={updateMutation.isPending}
                    className="text-xs font-semibold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 px-2 py-0.5 rounded transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <div className={`flex items-center gap-1.5 transition-opacity ${isEditing ? 'opacity-30 pointer-events-none' : ''}`}>
              <span className="text-xs text-gray-400 dark:text-gray-500 mr-0.5">Servings:</span>
              {[1, 2, 3, 4, 6, 8].map((n) => (
                <button
                  key={n}
                  onClick={() => setServings(n)}
                  className={`w-7 h-7 flex items-center justify-center text-xs font-semibold rounded-lg transition-colors ${
                    servings === n
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <ul className="space-y-1.5">
            {isEditing ? (
              // EDIT MODE
              <>
                {editIngredients.map((ing, idx) => (
                  <li key={idx} className="flex items-center gap-2 py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0 group">
                    <input
                      type="text"
                      value={ing.raw_name}
                      onChange={(e) => {
                        const next = [...editIngredients];
                        next[idx].raw_name = e.target.value;
                        setEditIngredients(next);
                      }}
                      className="flex-1 min-w-0 bg-transparent text-sm text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      placeholder="Ingredient name"
                    />
                    <input
                      type="number"
                      step="any"
                      value={ing.quantity || ''}
                      onChange={(e) => {
                        const next = [...editIngredients];
                        next[idx].quantity = parseFloat(e.target.value) || 0;
                        setEditIngredients(next);
                      }}
                      className="w-16 bg-transparent text-sm text-right text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      placeholder="Qty"
                    />
                    <input
                      type="text"
                      value={ing.unit || ''}
                      onChange={(e) => {
                        const next = [...editIngredients];
                        next[idx].unit = e.target.value;
                        setEditIngredients(next);
                      }}
                      className="w-16 bg-transparent text-sm text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      placeholder="Unit"
                    />
                    <button
                      onClick={() => {
                        const next = [...editIngredients];
                        next.splice(idx, 1);
                        setEditIngredients(next);
                      }}
                      className="w-7 h-7 flex-shrink-0 flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors opacity-100 sm:opacity-50 sm:group-hover:opacity-100"
                      aria-label="Remove ingredient"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    onClick={() => {
                      setEditIngredients([...editIngredients, {
                        id: crypto.randomUUID(),
                        recipe_id: recipe.id,
                        raw_name: '',
                        quantity: 1,
                        unit: '',
                      } as unknown as RecipeIngredient]);
                    }}
                    className="w-full py-2 mt-2 border-2 border-dashed border-emerald-500/30 text-emerald-600 dark:text-emerald-500 text-sm font-semibold rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                    Add Ingredient
                  </button>
                </li>
              </>
            ) : (
              // READ MODE
              recipe.ingredients.map((ing) => {
                const detail = ing.ingredient_id ? scoreMap.get(ing.ingredient_id) : undefined;
                let displayQty = ing.servings_quantities?.[String(servings)];
                if (displayQty === undefined) {
                  const scale = servings / (recipe.base_servings || 2);
                  displayQty = Math.round(ing.quantity * scale * 100) / 100;
                }

                return (
                  <li key={ing.id} className="py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-800 dark:text-gray-200">{ing.raw_name}</span>
                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span>{displayQty} {ing.unit ?? ''}</span>
                        <IngredientScore detail={detail} name={ing.raw_name} />
                      </div>
                    </div>
                    {detail?.substitute_used && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                        Using {detail.substitute_used} instead
                      </p>
                    )}
                  </li>
                );
              })
            )}
          </ul>
          
          {!isEditing && (
            <div className="mt-4">
              <FixIngredients recipeId={recipe.id} ingredients={recipe.ingredients} />
            </div>
          )}
        </div>

        {/* Steps */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Method</h2>
            {!isEditingSteps ? (
              <button
                onClick={() => {
                  setEditSteps(sortedSteps.map((s) => ({ order: s.order, text: s.text, timer_seconds: s.timer_seconds })));
                  setIsEditingSteps(true);
                }}
                disabled={isEditing}
                className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 px-2 py-0.5 rounded transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                Edit
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateStepsMutation.mutate({ steps: editSteps })}
                  disabled={updateStepsMutation.isPending}
                  className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                >
                  {updateStepsMutation.isPending ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setIsEditingSteps(false)}
                  disabled={updateStepsMutation.isPending}
                  className="text-xs font-semibold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 px-2 py-0.5 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {isEditingSteps ? (
            <ol className="space-y-3">
              {editSteps.map((step, idx) => (
                <li key={idx} className="flex gap-2 items-start">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 font-bold text-sm flex items-center justify-center mt-1">
                    {idx + 1}
                  </span>
                  <div className="flex-1 space-y-1.5">
                    <textarea
                      value={step.text}
                      onChange={(e) => {
                        const next = [...editSteps];
                        next[idx] = { ...next[idx], text: e.target.value };
                        setEditSteps(next);
                      }}
                      rows={3}
                      className="w-full text-sm text-gray-900 dark:text-white bg-transparent border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none leading-relaxed"
                      placeholder="Step instructions"
                    />
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                        <span>⏱</span>
                        <input
                          type="number"
                          min="0"
                          placeholder="Timer (min)"
                          value={step.timer_seconds ? Math.round(step.timer_seconds / 60) : ''}
                          onChange={(e) => {
                            const mins = parseFloat(e.target.value);
                            const next = [...editSteps];
                            next[idx] = { ...next[idx], timer_seconds: mins > 0 ? Math.round(mins * 60) : undefined };
                            setEditSteps(next);
                          }}
                          className="w-24 bg-transparent border border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <span>min</span>
                      </label>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0 mt-1">
                    <button
                      onClick={() => {
                        if (idx === 0) return;
                        const next = [...editSteps];
                        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                        next.forEach((s, i) => { s.order = i + 1; });
                        setEditSteps(next);
                      }}
                      disabled={idx === 0}
                      className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-20 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      aria-label="Move step up"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                    </button>
                    <button
                      onClick={() => {
                        if (idx === editSteps.length - 1) return;
                        const next = [...editSteps];
                        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                        next.forEach((s, i) => { s.order = i + 1; });
                        setEditSteps(next);
                      }}
                      disabled={idx === editSteps.length - 1}
                      className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-20 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      aria-label="Move step down"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    <button
                      onClick={() => {
                        const next = editSteps.filter((_, i) => i !== idx);
                        next.forEach((s, i) => { s.order = i + 1; });
                        setEditSteps(next);
                      }}
                      className="w-6 h-6 flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                      aria-label="Remove step"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </li>
              ))}
              <li>
                <button
                  onClick={() => setEditSteps([...editSteps, { order: editSteps.length + 1, text: '' }])}
                  className="w-full py-2 mt-1 border-2 border-dashed border-emerald-500/30 text-emerald-600 dark:text-emerald-500 text-sm font-semibold rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                  Add Step
                </button>
              </li>
            </ol>
          ) : (
            <ol className="space-y-3">
              {sortedSteps.map((step, idx) => (
                <li key={step.id} className="flex gap-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 font-bold text-sm flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <div className="flex-1 pt-0.5">
                    <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">{step.text}</p>
                    {step.image_description && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 italic mt-1">{step.image_description}</p>
                    )}
                    {step.timer_seconds && (
                      <span className="inline-block mt-1 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">
                        ⏱ {Math.round(step.timer_seconds / 60)} min timer
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
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

    {/* Lightbox Modal — rendered via portal so it sits above the nav bar */}
    {lightboxOpen && mounted && createPortal(
      <div
        className="fixed inset-0 z-[9999] bg-black/90"
        onClick={() => setLightboxOpen(false)}
      >
        {/* Close button — top right, always visible */}
        <button
          onClick={(e) => { e.stopPropagation(); setLightboxOpen(false); }}
          className="absolute top-4 right-4 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white border border-white/20 shadow-lg transition-colors"
          aria-label="Close"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Side label — top left */}
        {recipe.image_count > 1 && (
          <div className="absolute top-4 left-4 z-10 bg-black/60 border border-white/20 text-white/80 text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg">
            {lightboxIndex === 0 ? '① Front' : '② Back'}
          </div>
        )}

        {/* Image — fills viewport, clicking stops propagation to backdrop */}
        <div
          className="absolute inset-0 flex items-center justify-center p-2"
          onClick={(e) => e.stopPropagation()}
        >
          <img
            key={`${lightboxIndex}-${imageVersion}`}
            src={`/api/v1/recipes/${recipe.id}/image?index=${lightboxIndex}&v=${imageVersion}`}
            alt={`${recipe.title} — ${lightboxIndex === 0 ? 'front' : 'back'}`}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            style={{
              transition: 'opacity 0.2s ease, transform 0.2s ease',
              opacity: isFlipping ? 0 : 1,
              transform: isFlipping ? 'scale(0.95)' : 'scale(1)',
            }}
          />
        </div>

        {/* Bottom controls — flip + dots, floating above image */}
        {recipe.image_count > 1 && (
          <div
            className="absolute bottom-8 left-0 right-0 flex flex-col items-center gap-3 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleFlip}
              disabled={isFlipping}
              className="flex items-center gap-2 bg-black/70 hover:bg-black/90 disabled:opacity-40 text-white text-sm font-semibold px-5 py-2.5 rounded-full border border-white/20 shadow-lg transition-colors"
              aria-label="Flip card"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
              Flip to {lightboxIndex === 0 ? 'Back' : 'Front'}
            </button>
            <div className="flex gap-2">
              {[0, 1].map((i) => (
                <button
                  key={i}
                  onClick={() => setLightboxIndex(i)}
                  className={`w-2.5 h-2.5 rounded-full transition-all ${
                    lightboxIndex === i ? 'bg-white scale-125' : 'bg-white/40 hover:bg-white/60'
                  }`}
                  aria-label={i === 0 ? 'Front' : 'Back'}
                />
              ))}
            </div>
          </div>
        )}
      </div>,
      document.body
    )}
    </>
  );
}
