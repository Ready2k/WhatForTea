'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useShoppingList, useBulkConfirmPantry, useIngredients } from '@/lib/hooks';
import {
  fetchShoppingItems,
  addShoppingItem,
  patchShoppingItem,
  deleteShoppingItem,
  clearDoneShoppingItems,
  type ShoppingItem,
} from '@/lib/api';
import type { Ingredient, ShoppingListItem } from '@/lib/types';

export default function ShoppingListPage() {
  const qc = useQueryClient();

  // ── From meal plan ────────────────────────────────────────────────────────
  const { data: shoppingList, isLoading: planLoading, isError: planError, refetch } = useShoppingList();
  const bulkConfirmMutation = useBulkConfirmPantry();
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  const allPlanItems = useMemo<ShoppingListItem[]>(() => {
    if (!shoppingList) return [];
    return Object.values(shoppingList.zones).flat();
  }, [shoppingList]);

  function itemKey(item: ShoppingListItem) {
    return item.ingredient_id ?? item.canonical_name;
  }

  function toggleItem(key: string) {
    setCheckedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleMarkChecked() {
    const toConfirm = allPlanItems
      .filter(item => item.ingredient_id && checkedItems.has(itemKey(item)))
      .map(item => ({ ingredient_id: item.ingredient_id!, quantity: item.rounded_quantity, unit: item.rounded_unit }));
    if (toConfirm.length > 0) {
      try {
        await bulkConfirmMutation.mutateAsync(toConfirm);
        setCheckedItems(new Set());
      } catch { /* ignore */ }
    }
  }

  async function handleMarkAll() {
    const toConfirm = allPlanItems
      .filter(item => item.ingredient_id)
      .map(item => ({ ingredient_id: item.ingredient_id!, quantity: item.rounded_quantity, unit: item.rounded_unit }));
    if (toConfirm.length > 0) {
      try {
        await bulkConfirmMutation.mutateAsync(toConfirm);
        setCheckedItems(new Set());
      } catch { /* ignore */ }
    }
  }

  // ── Manually added ────────────────────────────────────────────────────────
  const { data: manualItems = [] } = useQuery<ShoppingItem[]>({
    queryKey: ['shoppingList'],
    queryFn: fetchShoppingItems,
  });
  const { data: ingredients = [] } = useIngredients();

  const addMutation = useMutation({
    mutationFn: (d: { raw_name: string; quantity: number; unit: string }) => addShoppingItem(d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shoppingList'] }),
  });
  const toggleDoneMutation = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => patchShoppingItem(id, done),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shoppingList'] }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteShoppingItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shoppingList'] }),
  });
  const clearDoneMutation = useMutation({
    mutationFn: () => clearDoneShoppingItems(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shoppingList'] }),
  });

  const [input, setInput] = useState('');
  const [selectedIngredient, setSelectedIngredient] = useState<Ingredient | null>(null);
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState('count');
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    if (selectedIngredient || !inputFocused) return [];
    const q = input.trim().toLowerCase();
    if (!q) return [];
    return ingredients
      .filter(i => i.canonical_name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [input, selectedIngredient, ingredients, inputFocused]);

  function handleSelectIngredient(ing: Ingredient) {
    setSelectedIngredient(ing);
    setInput(ing.canonical_name);
    setUnit(ing.typical_unit || 'count');
    setInputFocused(false);
    inputRef.current?.blur();
  }

  function handleClearSelection() {
    setSelectedIngredient(null);
    setInput('');
    setUnit('count');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleAdd() {
    const name = input.trim();
    if (!name) return;
    addMutation.mutate({
      raw_name: selectedIngredient ? selectedIngredient.canonical_name : name,
      quantity: parseFloat(qty) || 1,
      unit: unit || 'count',
    });
    setInput('');
    setQty('1');
    setUnit('count');
    setSelectedIngredient(null);
  }

  const pendingManual = manualItems.filter(i => !i.done);
  const doneManual = manualItems.filter(i => i.done);

  return (
    <main className="max-w-lg mx-auto px-4 pt-6 pb-28">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-5">Shopping List</h1>

      {/* ── Manually added ─────────────────────────────────────────────────── */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Manually added</h2>
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
        <div className="relative mb-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                placeholder="Search ingredient or type item…"
                value={input}
                onChange={e => {
                  setInput(e.target.value);
                  if (selectedIngredient) setSelectedIngredient(null);
                }}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setTimeout(() => setInputFocused(false), 150)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                className={`w-full bg-gray-100 dark:bg-gray-800 border-transparent focus:border-indigo-500 rounded-xl px-3 py-2 text-sm pr-7 ${selectedIngredient ? 'text-indigo-600 dark:text-indigo-400 font-medium' : ''}`}
              />
              {selectedIngredient && (
                <button
                  onClick={handleClearSelection}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-base leading-none"
                >
                  ×
                </button>
              )}
            </div>
            <input
              type="number"
              value={qty}
              onChange={e => setQty(e.target.value)}
              className="w-14 bg-gray-100 dark:bg-gray-800 border-transparent focus:border-indigo-500 rounded-xl px-2 py-2 text-sm text-center"
              min="0.1"
              step="0.5"
            />
            <button
              onClick={handleAdd}
              disabled={!input.trim() || addMutation.isPending}
              className="px-3 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition-colors"
            >
              +
            </button>
          </div>

          {/* Autocomplete dropdown */}
          {suggestions.length > 0 && (
            <ul className="absolute z-20 left-0 right-16 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden">
              {suggestions.map(ing => (
                <li key={ing.id}>
                  <button
                    onMouseDown={() => handleSelectIngredient(ing)}
                    className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors flex items-center justify-between"
                  >
                    <span>{ing.canonical_name}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">{ing.typical_unit || 'count'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Pending */}
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
                  {(item.quantity !== 1 || item.unit !== 'count') && (
                    <span className="text-gray-400 dark:text-gray-500 ml-2 text-xs">{item.quantity} {item.unit}</span>
                  )}
                </span>
                <button
                  onClick={() => deleteMutation.mutate(item.id)}
                  className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                  aria-label="Remove"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Done */}
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
                <button
                  onClick={() => deleteMutation.mutate(item.id)}
                  className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                  aria-label="Remove"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {manualItems.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-3">
            Nothing added yet — type above or ask TeaBot.
          </p>
        )}
      </section>

      <div className="border-t border-gray-100 dark:border-gray-700 mb-6" />

      {/* ── From meal plan ──────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">From meal plan</h2>
          {shoppingList && (
            <div className="flex gap-2">
              <button
                onClick={() => navigator.clipboard?.writeText(shoppingList.text_export).catch(() => {})}
                className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                Copy
              </button>
              <button
                onClick={() => window.open(shoppingList.whatsapp_url, '_blank')}
                className="text-xs text-green-600 hover:text-green-700 dark:hover:text-green-400 transition-colors"
              >
                WhatsApp
              </button>
            </div>
          )}
        </div>

        {planLoading && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 bg-gray-200 dark:bg-gray-700 rounded-2xl animate-pulse" />
            ))}
          </div>
        )}

        {planError && (
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400 mb-3 text-sm">Failed to load meal plan list</p>
            <button onClick={() => refetch()} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium">
              Retry
            </button>
          </div>
        )}

        {!planLoading && !planError && shoppingList && (
          <>
            {Object.keys(shoppingList.zones).length === 0 ? (
              <div className="text-center py-10 text-gray-400 dark:text-gray-500">
                <p className="text-3xl mb-2">🛒</p>
                <p className="text-sm">Nothing needed — pantry covers everything, or no meals planned.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(shoppingList.zones).map(([zone, items]) => (
                  <details key={zone} open className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                    <summary className="px-4 py-3 cursor-pointer font-semibold text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 select-none capitalize">
                      {zone} ({items.length})
                    </summary>
                    <ul className="divide-y divide-gray-50 dark:divide-gray-700">
                      {items.map((item, idx) => {
                        const key = item.ingredient_id ?? `${zone}-${item.canonical_name}-${idx}`;
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
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Floating buy bar (meal plan items) ─────────────────────────────── */}
      {allPlanItems.length > 0 && (
        <div className="fixed bottom-16 left-0 right-0 flex justify-center pointer-events-none">
          <div className="pointer-events-auto mx-4 max-w-lg w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg px-4 py-3 flex gap-2">
            {checkedItems.size > 0 ? (
              <>
                <button
                  onClick={handleMarkChecked}
                  disabled={bulkConfirmMutation.isPending}
                  className="flex-1 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  {bulkConfirmMutation.isPending ? 'Saving…' : `Mark ${checkedItems.size} as bought`}
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
                onClick={handleMarkAll}
                disabled={bulkConfirmMutation.isPending}
                className="flex-1 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                I bought everything
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
