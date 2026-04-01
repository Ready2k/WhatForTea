'use client';

import { useState } from 'react';
import { useCurrentPlan, useRecipes, useSetWeekPlan, useShoppingList, useUpsertPantryItem } from '@/lib/hooks';
import type { RecipeSummary, ShoppingListItem } from '@/lib/types';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type Tab = 'week' | 'shopping';

// day_of_week: 0=Monday ... 6=Sunday
function getWeekStart(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sunday
  const diff = day === 0 ? -6 : 1 - day; // offset to Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split('T')[0];
}

export default function PlannerPage() {
  const [activeTab, setActiveTab] = useState<Tab>('week');
  const [dayPlan, setDayPlan] = useState<Record<number, string | null>>({});
  const [servingsPlan, setServingsPlan] = useState<Record<number, number | null>>({});
  const [showPickerFor, setShowPickerFor] = useState<number | null>(null);
  const [showServingPickerFor, setShowServingPickerFor] = useState<number | null>(null);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  const { data: plan, isLoading: planLoading } = useCurrentPlan();
  const { data: recipes } = useRecipes();
  const setWeekPlanMutation = useSetWeekPlan();
  const { data: shoppingList, isLoading: shopLoading, isError: shopError, refetch: refetchShopping } = useShoppingList();
  const upsertMutation = useUpsertPantryItem();

  // Merge server plan with local overrides
  const resolvedPlan: Record<number, string | null> = {};
  const resolvedServings: Record<number, number | null> = {};
  for (let d = 0; d < 7; d++) {
    if (d in dayPlan) {
      resolvedPlan[d] = dayPlan[d];
      resolvedServings[d] = servingsPlan[d] ?? null;
    } else {
      const entry = plan?.entries.find((e) => e.day_of_week === d);
      resolvedPlan[d] = entry?.recipe_id ?? null;
      resolvedServings[d] = entry?.servings ?? null;
    }
  }

  function getRecipeSummary(recipeId: string | null): RecipeSummary | undefined {
    if (!recipeId) return undefined;
    return recipes?.find((r) => r.id === recipeId);
  }

  async function handleSavePlan() {
    const entries = Object.entries(resolvedPlan)
      .filter(([, recipeId]) => recipeId !== null)
      .map(([dayStr, recipeId]) => {
        const d = parseInt(dayStr);
        return {
          day_of_week: d,
          recipe_id: recipeId as string,
          servings: resolvedServings[d] ?? undefined,
        };
      });

    try {
      await setWeekPlanMutation.mutateAsync({
        week_start: getWeekStart(),
        entries,
      });
      setDayPlan({});
      setServingsPlan({});
    } catch {
      // errors shown via mutation state
    }
  }

  function toggleItem(key: string) {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleBought(item: ShoppingListItem) {
    if (!item.ingredient_id) return; // can't add unresolved items to pantry
    try {
      await upsertMutation.mutateAsync({
        ingredient_id: item.ingredient_id,
        quantity: item.rounded_quantity,
        unit: item.rounded_unit,
      });
      toggleItem(item.ingredient_id);
    } catch {}
  }

  return (
    <main className="max-w-lg mx-auto px-4 pt-6 pb-4">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Planner</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
        {(['week', 'shopping'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === tab
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {tab === 'week' ? 'This Week' : 'Shopping List'}
          </button>
        ))}
      </div>

      {/* This Week tab */}
      {activeTab === 'week' && (
        <div className="space-y-3">
          {planLoading && (
            <div className="space-y-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded-2xl animate-pulse" />
              ))}
            </div>
          )}

          {!planLoading && DAYS.map((dayName, idx) => {
            const recipeId = resolvedPlan[idx];
            const recipeSummary = getRecipeSummary(recipeId);

            return (
              <div key={idx} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">{dayName}</span>

                  {recipeSummary ? (
                    <div className="flex-1 flex items-center justify-between min-w-0">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{recipeSummary.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {recipeSummary.cooking_time_mins && (
                            <p className="text-xs text-gray-400 dark:text-gray-500">{recipeSummary.cooking_time_mins} min</p>
                          )}
                          <span className="text-gray-300 dark:text-gray-600">•</span>
                          <button
                            onClick={() => setShowServingPickerFor(showServingPickerFor === idx ? null : idx)}
                            className="text-xs font-medium text-emerald-600 hover:text-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded flex items-center gap-1"
                          >
                            👥 {resolvedServings[idx] || 'Default'}
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-3 ml-2">
                        <button
                          onClick={() => setShowPickerFor(idx)}
                          className="text-xs text-gray-400 dark:text-gray-500 hover:text-emerald-600 transition-colors"
                        >
                          Change
                        </button>
                        <button
                          onClick={() => {
                            setDayPlan((p) => ({ ...p, [idx]: null }));
                            setServingsPlan((p) => ({ ...p, [idx]: null }));
                          }}
                          className="text-xs text-red-300 hover:text-red-500 transition-colors"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowPickerFor(idx)}
                      className="flex-1 py-2 border-2 border-dashed border-gray-200 dark:border-gray-600 text-sm text-gray-400 dark:text-gray-500 rounded-xl hover:border-emerald-300 dark:hover:border-emerald-500 hover:text-emerald-600 transition-colors text-center"
                    >
                      + Add recipe
                    </button>
                  )}
                </div>

                {/* Serving Picker */}
                {showServingPickerFor === idx && (
                  <div className="mt-3 flex items-center gap-1.5 border-t border-gray-100 dark:border-gray-700 pt-3">
                    <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">Servings for {dayName}:</span>
                    {[1, 2, 3, 4, 6, 8].map((n) => (
                      <button
                        key={n}
                        onClick={() => {
                          setServingsPlan((p) => ({ ...p, [idx]: n }));
                          setShowServingPickerFor(null);
                        }}
                        className={`w-7 h-7 flex items-center justify-center text-xs font-semibold rounded-lg transition-colors ${
                          resolvedServings[idx] === n
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        setServingsPlan((p) => ({ ...p, [idx]: null }));
                        setShowServingPickerFor(null);
                      }}
                      className="ml-auto text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    >
                      Default
                    </button>
                  </div>
                )}

                {/* Inline picker */}
                {showPickerFor === idx && (
                  <div className="mt-3 border-t border-gray-100 dark:border-gray-700 pt-3">
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {recipes?.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => {
                            setDayPlan((p) => ({ ...p, [idx]: r.id }));
                            // Reset servings to recipe base servings when recipe changes
                            setServingsPlan((p) => ({ ...p, [idx]: r.base_servings || 2 }));
                            setShowPickerFor(null);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-lg transition-colors"
                        >
                          {r.title}
                          {r.cooking_time_mins && (
                            <span className="text-gray-400 dark:text-gray-500 ml-2">({r.cooking_time_mins} min)</span>
                          )}
                        </button>
                      ))}
                      {(!recipes || recipes.length === 0) && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 px-2">No recipes available</p>
                      )}
                    </div>
                    <button
                      onClick={() => setShowPickerFor(null)}
                      className="mt-2 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {!planLoading && (
            <div className="pt-2">
              <button
                onClick={handleSavePlan}
                disabled={setWeekPlanMutation.isPending}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-2xl transition-colors disabled:opacity-50"
              >
                {setWeekPlanMutation.isPending ? 'Saving...' : 'Save Week Plan'}
              </button>
              {setWeekPlanMutation.isSuccess && (
                <p className="text-center text-sm text-emerald-600 mt-2">Plan saved!</p>
              )}
              {setWeekPlanMutation.isError && (
                <p className="text-center text-sm text-red-500 mt-2">Failed to save plan</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Shopping List tab */}
      {activeTab === 'shopping' && (
        <div>
          {shopLoading && (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 bg-gray-200 dark:bg-gray-700 rounded-2xl animate-pulse" />
              ))}
            </div>
          )}

          {shopError && (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400 mb-3">Failed to load shopping list</p>
              <button
                onClick={() => refetchShopping()}
                className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium"
              >
                Retry
              </button>
            </div>
          )}

          {!shopLoading && !shopError && shoppingList && (
            <>
              {/* Action buttons */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(shoppingList.text_export).catch(() => {});
                  }}
                  className="flex-1 py-2.5 border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Copy List
                </button>
                <button
                  onClick={() => window.open(shoppingList.whatsapp_url, '_blank')}
                  className="flex-1 py-2.5 bg-green-500 text-white text-sm font-medium rounded-xl hover:bg-green-600 transition-colors"
                >
                  Share via WhatsApp
                </button>
              </div>

              {/* Zones */}
              <div className="space-y-4">
                {Object.entries(shoppingList.zones).map(([zone, items]) => (
                  <details key={zone} open className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                    <summary className="px-4 py-3 cursor-pointer font-semibold text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 select-none capitalize">
                      {zone} ({items.length})
                    </summary>
                    <ul className="divide-y divide-gray-50 dark:divide-gray-700">
                      {items.map((item, itemIdx) => {
                        // Use ingredient_id if available; fall back to name+index for unresolved items
                        const itemKey = item.ingredient_id ?? `${zone}-${item.canonical_name}-${itemIdx}`;
                        const isChecked = !!(item.ingredient_id && checkedItems.has(item.ingredient_id));
                        const isUnresolved = !item.ingredient_id;
                        return (
                          <li
                            key={itemKey}
                            className={`flex items-center gap-3 px-4 py-3 transition-colors ${isChecked ? 'bg-gray-50 dark:bg-gray-700/50 opacity-60' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => item.ingredient_id && toggleItem(item.ingredient_id)}
                              disabled={isUnresolved}
                              className="w-4 h-4 accent-emerald-600 flex-shrink-0 disabled:opacity-40"
                            />
                            <div className="flex-1 min-w-0">
                              <span className={`text-sm font-medium ${isChecked ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>
                                {item.canonical_name}
                                {isUnresolved && (
                                  <span className="ml-1.5 text-xs text-amber-500 dark:text-amber-400 font-normal">(unmatched)</span>
                                )}
                              </span>
                              <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                                {item.rounded_quantity} {item.rounded_unit}
                              </span>
                            </div>
                            {!isUnresolved && (
                              <button
                                onClick={() => handleBought(item)}
                                disabled={upsertMutation.isPending}
                                className="text-xs text-emerald-600 hover:text-emerald-800 dark:hover:text-emerald-400 font-medium whitespace-nowrap disabled:opacity-40"
                              >
                                Bought
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                ))}

                {Object.keys(shoppingList.zones).length === 0 && (
                  <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                    <p className="text-4xl mb-2">🛒</p>
                    <p>No items yet — plan your week first!</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}
