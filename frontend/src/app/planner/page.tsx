'use client';

import { useState, useMemo } from 'react';
import { useCurrentPlan, useRecipes, useSetWeekPlan, useShoppingList, useBulkConfirmPantry } from '@/lib/hooks';
import { autoFillWeek, type AutoFillEntry, fetchShoppingItems, addShoppingItem, patchShoppingItem, deleteShoppingItem, clearDoneShoppingItems, type ShoppingItem } from '@/lib/api';
import type { RecipeSummary, ShoppingListItem } from '@/lib/types';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const MOOD_OPTIONS = ['Comfort', 'Quick', 'Light', 'Vegetarian', 'Spicy', 'Family', 'Fancy', 'Healthy', 'Indulgent'];

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
  const [showAutoFill, setShowAutoFill] = useState(false);
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);
  const [autoFillServings, setAutoFillServings] = useState(2);
  const [maxCookTime, setMaxCookTime] = useState<number | ''>('');
  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [autoFillError, setAutoFillError] = useState<string | null>(null);

  const { data: plan, isLoading: planLoading } = useCurrentPlan();
  const { data: recipes } = useRecipes();
  const setWeekPlanMutation = useSetWeekPlan();
  const { data: shoppingList, isLoading: shopLoading, isError: shopError, refetch: refetchShopping } = useShoppingList();
  const bulkConfirmMutation = useBulkConfirmPantry();
  const qc = useQueryClient();
  const { data: manualItems = [] } = useQuery<ShoppingItem[]>({ queryKey: ['shoppingList'], queryFn: fetchShoppingItems });
  const addManualMutation = useMutation({
    mutationFn: (d: { raw_name: string; quantity: number; unit: string }) => addShoppingItem(d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shoppingList'] }),
  });
  const toggleDoneMutation = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => patchShoppingItem(id, done),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shoppingList'] }),
  });
  const deleteManualMutation = useMutation({
    mutationFn: (id: string) => deleteShoppingItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shoppingList'] }),
  });
  const clearDoneMutation = useMutation({
    mutationFn: () => clearDoneShoppingItems(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shoppingList'] }),
  });
  const [manualInput, setManualInput] = useState('');
  const [manualQty, setManualQty] = useState('1');
  const [manualUnit, setManualUnit] = useState('count');

  const handleAddManual = () => {
    const name = manualInput.trim();
    if (!name) return;
    addManualMutation.mutate({ raw_name: name, quantity: parseFloat(manualQty) || 1, unit: manualUnit || 'count' });
    setManualInput('');
    setManualQty('1');
  };

  const pendingManual = manualItems.filter(i => !i.done);
  const doneManual = manualItems.filter(i => i.done);

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

  async function handleAutoFill() {
    setAutoFillLoading(true);
    setAutoFillError(null);
    try {
      const entries: AutoFillEntry[] = await autoFillWeek({
        moods: selectedMoods,
        servings: autoFillServings,
        max_cook_time_mins: maxCookTime ? Number(maxCookTime) : undefined,
      });
      if (entries.length === 0) {
        setAutoFillError('No matching recipes found. Try fewer mood filters.');
        return;
      }
      const newDayPlan: Record<number, string | null> = {};
      const newServings: Record<number, number | null> = {};
      entries.forEach((e) => {
        newDayPlan[e.day_of_week] = e.recipe_id;
        newServings[e.day_of_week] = e.servings;
      });
      setDayPlan(newDayPlan);
      setServingsPlan(newServings);
      setShowAutoFill(false);
    } catch (err: any) {
      setAutoFillError(err.message ?? 'Auto-fill failed');
    } finally {
      setAutoFillLoading(false);
    }
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

  // Flat list of all shopping items for bulk operations
  const allItems = useMemo<ShoppingListItem[]>(() => {
    if (!shoppingList) return [];
    return Object.values(shoppingList.zones).flat();
  }, [shoppingList]);

  function toggleItem(key: string) {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function itemKey(item: ShoppingListItem) {
    return item.ingredient_id ?? item.canonical_name;
  }

  async function handleMarkCheckedAsBought() {
    const toConfirm = allItems.filter(
      (item) => item.ingredient_id && checkedItems.has(itemKey(item)),
    ).map((item) => ({
      ingredient_id: item.ingredient_id!,
      quantity: item.rounded_quantity,
      unit: item.rounded_unit,
    }));
    if (toConfirm.length > 0) {
      try { await bulkConfirmMutation.mutateAsync(toConfirm); } catch { /* show nothing extra */ }
    }
  }

  async function handleMarkAllAsBought() {
    const allKeys = new Set(allItems.map(itemKey));
    setCheckedItems(allKeys);
    const toConfirm = allItems
      .filter((item) => item.ingredient_id)
      .map((item) => ({
        ingredient_id: item.ingredient_id!,
        quantity: item.rounded_quantity,
        unit: item.rounded_unit,
      }));
    if (toConfirm.length > 0) {
      try { await bulkConfirmMutation.mutateAsync(toConfirm); } catch { /* show nothing extra */ }
    }
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
          {/* Auto-fill button */}
          {!planLoading && (
            <button
              onClick={() => { setShowAutoFill(true); setAutoFillError(null); }}
              className="w-full py-2.5 border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 text-sm font-medium rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors flex items-center justify-center gap-2"
            >
              <span>✨</span> Auto-fill week
            </button>
          )}

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
                            setServingsPlan((p) => ({ ...p, [idx]: 2 }));
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

          {/* Manual shopping list */}
          {!shopLoading && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">My list</h3>
                {doneManual.length > 0 && (
                  <button
                    onClick={() => clearDoneMutation.mutate()}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                  >
                    Clear done ({doneManual.length})
                  </button>
                )}
              </div>

              {/* Add row */}
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="Add item…"
                  value={manualInput}
                  onChange={e => setManualInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddManual()}
                  className="flex-1 bg-gray-100 dark:bg-gray-800 border-transparent focus:border-indigo-500 rounded-xl px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  value={manualQty}
                  onChange={e => setManualQty(e.target.value)}
                  className="w-14 bg-gray-100 dark:bg-gray-800 border-transparent focus:border-indigo-500 rounded-xl px-2 py-2 text-sm text-center"
                  min="0.1"
                  step="0.5"
                />
                <button
                  onClick={handleAddManual}
                  disabled={!manualInput.trim() || addManualMutation.isPending}
                  className="px-3 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  +
                </button>
              </div>

              {/* Pending items */}
              {pendingManual.length > 0 && (
                <ul className="space-y-1 mb-1">
                  {pendingManual.map(item => (
                    <li key={item.id} className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-3 py-2.5 shadow-sm">
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => toggleDoneMutation.mutate({ id: item.id, done: true })}
                        className="w-4 h-4 accent-emerald-600 flex-shrink-0 cursor-pointer"
                      />
                      <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">
                        {item.raw_name}
                        <span className="text-gray-400 dark:text-gray-500 ml-2 text-xs">
                          {item.quantity !== 1 || item.unit !== 'count' ? `${item.quantity} ${item.unit}` : ''}
                        </span>
                      </span>
                      <button onClick={() => deleteManualMutation.mutate(item.id)} className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none">×</button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Done items (collapsed) */}
              {doneManual.length > 0 && (
                <ul className="space-y-1 opacity-50">
                  {doneManual.map(item => (
                    <li key={item.id} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl px-3 py-2">
                      <input
                        type="checkbox"
                        checked={true}
                        onChange={() => toggleDoneMutation.mutate({ id: item.id, done: false })}
                        className="w-4 h-4 accent-emerald-600 flex-shrink-0 cursor-pointer"
                      />
                      <span className="flex-1 text-sm text-gray-400 line-through">{item.raw_name}</span>
                      <button onClick={() => deleteManualMutation.mutate(item.id)} className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none">×</button>
                    </li>
                  ))}
                </ul>
              )}

              {manualItems.length === 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">
                  Nothing on your list yet — add items above or ask TeaBot.
                </p>
              )}

              <div className="border-t border-gray-100 dark:border-gray-700 mt-4 mb-4" />
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">From meal plan</h3>
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
              <div className="space-y-4 pb-24">
                {Object.entries(shoppingList.zones).map(([zone, items]) => (
                  <details key={zone} open className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                    <summary className="px-4 py-3 cursor-pointer font-semibold text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 select-none capitalize">
                      {zone} ({items.length})
                    </summary>
                    <ul className="divide-y divide-gray-50 dark:divide-gray-700">
                      {items.map((item, itemIdx) => {
                        const key = item.ingredient_id ?? `${zone}-${item.canonical_name}-${itemIdx}`;
                        const ck = itemKey(item);
                        const isChecked = checkedItems.has(ck);
                        return (
                          <li
                            key={key}
                            onClick={() => toggleItem(ck)}
                            className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${isChecked ? 'bg-gray-50 dark:bg-gray-700/50' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="w-4 h-4 accent-emerald-600 flex-shrink-0 pointer-events-none"
                            />
                            <div className="flex-1 min-w-0">
                              <span className={`text-sm font-medium ${isChecked ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'}`}>
                                {item.canonical_name}
                              </span>
                              <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                                {item.rounded_quantity} {item.rounded_unit}
                              </span>
                            </div>
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

              {/* Floating bottom bar */}
              {allItems.length > 0 && (
                <div className="fixed bottom-16 left-0 right-0 flex justify-center pointer-events-none">
                  <div className="pointer-events-auto mx-4 max-w-lg w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg px-4 py-3 flex gap-2">
                    {checkedItems.size > 0 ? (
                      <>
                        <button
                          onClick={handleMarkCheckedAsBought}
                          disabled={bulkConfirmMutation.isPending}
                          className="flex-1 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                        >
                          {bulkConfirmMutation.isPending
                            ? 'Saving...'
                            : `Mark ${checkedItems.size} as bought`}
                        </button>
                        <button
                          onClick={() => setCheckedItems(new Set())}
                          className="px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                        >
                          Clear
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={handleMarkAllAsBought}
                        disabled={bulkConfirmMutation.isPending}
                        className="flex-1 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                      >
                        I bought everything
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Auto-fill bottom sheet */}
      {showAutoFill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAutoFill(false)} />
          <div className="relative w-full max-w-lg bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-6 pb-8 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900 dark:text-white">Auto-fill week</h2>
              <button onClick={() => setShowAutoFill(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">×</button>
            </div>

            {/* Mood chips */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Mood (pick any)</p>
              <div className="flex flex-wrap gap-2">
                {MOOD_OPTIONS.map((mood) => (
                  <button
                    key={mood}
                    onClick={() => setSelectedMoods((prev) =>
                      prev.includes(mood) ? prev.filter((m) => m !== mood) : [...prev, mood]
                    )}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      selectedMoods.includes(mood)
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {mood}
                  </button>
                ))}
              </div>
            </div>

            {/* Servings */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Servings per meal</p>
              <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-lg px-1 py-0.5">
                <button onClick={() => setAutoFillServings((s) => Math.max(1, s - 1))} disabled={autoFillServings <= 1}
                  className="w-7 h-7 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:text-emerald-600 disabled:opacity-30 font-bold text-base">−</button>
                <span className="w-5 text-center text-sm font-semibold text-gray-900 dark:text-white tabular-nums">{autoFillServings}</span>
                <button onClick={() => setAutoFillServings((s) => Math.min(12, s + 1))} disabled={autoFillServings >= 12}
                  className="w-7 h-7 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:text-emerald-600 disabled:opacity-30 font-bold text-base">+</button>
              </div>
            </div>

            {/* Max cook time */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Max cook time (optional)</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={10}
                  max={180}
                  step={5}
                  value={maxCookTime}
                  onChange={(e) => setMaxCookTime(e.target.value ? Number(e.target.value) : '')}
                  placeholder="Any"
                  className="w-20 text-right px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <span className="text-sm text-gray-500 dark:text-gray-400">min</span>
              </div>
            </div>

            {autoFillError && (
              <p className="text-sm text-red-600 dark:text-red-400">{autoFillError}</p>
            )}

            <button
              onClick={handleAutoFill}
              disabled={autoFillLoading}
              className="w-full py-3.5 bg-emerald-600 text-white font-semibold rounded-2xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {autoFillLoading ? 'Finding recipes…' : 'Fill my week'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
