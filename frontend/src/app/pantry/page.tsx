'use client';

import { useState, useMemo, useRef } from 'react';
import { useAvailable, useConfirmPantryItem, useUpsertPantryItem, useDeletePantryItem, useIngredients, useCreateIngredient } from '@/lib/hooks';
import { ConfidenceBar } from '@/components/ConfidenceBar';
import type { Ingredient } from '@/lib/types';

interface AddItemForm {
  search: string;
  ingredient: Ingredient | null;
  quantity: string;
  unit: string;
  expires_at: string;
}

const EMPTY_FORM: AddItemForm = { search: '', ingredient: null, quantity: '', unit: '', expires_at: '' };

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function ExpiryBadge({ expiresAt }: { expiresAt: string }) {
  const days = daysUntil(expiresAt);
  if (days < 0) return <span className="text-xs font-semibold text-red-600 dark:text-red-400">Expired</span>;
  if (days === 0) return <span className="text-xs font-semibold text-red-500 dark:text-red-400">Expires today</span>;
  if (days <= 3) return <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">Expires in {days}d</span>;
  return <span className="text-xs text-gray-400 dark:text-gray-500">Expires {new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>;
}

export default function PantryPage() {
  const { data: items, isLoading, isError, refetch } = useAvailable();
  const { data: ingredients = [] } = useIngredients();
  const confirmMutation = useConfirmPantryItem();
  const upsertMutation = useUpsertPantryItem();
  const deleteMutation = useDeletePantryItem();

  const createIngredientMutation = useCreateIngredient();

  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<AddItemForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [newIngForm, setNewIngForm] = useState<{ category: string; dimension: string; unit: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Per-item inline quantity editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState('');

  async function handleUpdateQty(item: typeof sorted[number]) {
    const qty = parseFloat(editQty);
    if (isNaN(qty) || qty < 0) { setEditingId(null); return; }
    await upsertMutation.mutateAsync({
      ingredient_id: item.ingredient.id,
      quantity: qty,
      unit: item.unit,
    });
    setEditingId(null);
  }

  const suggestions = useMemo(() => {
    if (form.ingredient || !inputFocused) return [];
    const q = form.search.trim().toLowerCase();
    if (!q) return ingredients.slice(0, 8);
    return ingredients
      .filter((i) => i.canonical_name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [form.search, form.ingredient, ingredients, inputFocused]);

  const noResults = inputFocused && !form.ingredient && form.search.trim().length > 0 && suggestions.length === 0;

  const sorted = items
    ? [...items].sort((a, b) => {
        // Expiring within 3 days floats to top, then by confidence ascending
        const aExpiring = a.expires_at ? daysUntil(a.expires_at) <= 3 : false;
        const bExpiring = b.expires_at ? daysUntil(b.expires_at) <= 3 : false;
        if (aExpiring !== bExpiring) return aExpiring ? -1 : 1;
        return a.confidence - b.confidence;
      })
    : [];

  const expiringSoon = sorted.filter((i) => i.expires_at && daysUntil(i.expires_at) <= 3);

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    let ingredient = form.ingredient;

    if (!ingredient && newIngForm) {
      const name = form.search.trim();
      if (!name) { setFormError('Enter an ingredient name'); return; }
      try {
        ingredient = await createIngredientMutation.mutateAsync({
          canonical_name: name,
          category: newIngForm.category,
          dimension: newIngForm.dimension,
          typical_unit: newIngForm.unit || 'unit',
        });
        setNewIngForm(null);
      } catch (err: any) {
        setFormError(err.message ?? 'Failed to create ingredient');
        return;
      }
    }

    if (!ingredient) {
      setFormError('Select an ingredient from the list');
      return;
    }

    const qty = parseFloat(form.quantity);
    if (isNaN(qty) || qty <= 0) {
      setFormError('Enter a valid quantity');
      return;
    }
    try {
      await upsertMutation.mutateAsync({
        ingredient_id: ingredient.id,
        quantity: qty,
        unit: form.unit.trim() || ingredient.typical_unit || 'unit',
        expires_at: form.expires_at || null,
      });
      setForm(EMPTY_FORM);
      setShowAddForm(false);
    } catch (err: any) {
      setFormError(err.message ?? 'Failed to add item');
    }
  }

  function selectIngredient(ing: Ingredient) {
    setForm((f) => ({ ...f, ingredient: ing, search: ing.canonical_name, unit: ing.typical_unit || '' }));
  }

  return (
    <main className="max-w-lg mx-auto px-4 pt-6 pb-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">My Pantry</h1>
        <button
          onClick={() => { setShowAddForm((v) => !v); setFormError(''); setForm(EMPTY_FORM); }}
          className="px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          {showAddForm ? 'Cancel' : '+ Add Item'}
        </button>
      </div>

      {/* Add item form */}
      {showAddForm && (
        <form onSubmit={handleAddItem} className="mb-4 p-4 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-600 space-y-3 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Add Pantry Item</h2>
          <div className="relative">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Ingredient</label>
            <input
              ref={searchRef}
              type="text"
              value={form.search}
              onChange={(e) => {
                const val = e.target.value;
                setForm((f) => ({
                  ...f,
                  search: val,
                  ingredient: f.ingredient?.canonical_name === val ? f.ingredient : null,
                }));
              }}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setTimeout(() => setInputFocused(false), 150)}
              placeholder="Search ingredients..."
              autoComplete="off"
              className={`w-full px-3 py-2 text-sm border rounded-xl focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 ${
                form.ingredient
                  ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 focus:ring-emerald-400'
                  : 'border-gray-300 dark:border-gray-500 focus:ring-emerald-400'
              }`}
            />
            {(suggestions.length > 0 || noResults) && (
              <ul className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {suggestions.map((ing) => (
                  <li key={ing.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); selectIngredient(ing); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 dark:hover:bg-emerald-900/30 flex items-center justify-between text-gray-800 dark:text-gray-200"
                    >
                      <span>{ing.canonical_name}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">{ing.category}</span>
                    </button>
                  </li>
                ))}
                {noResults && (
                  <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                    <span className="italic">No match for "{form.search.trim()}"</span>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setInputFocused(false);
                        setNewIngForm({ category: 'other', dimension: 'count', unit: '' });
                      }}
                      className="ml-2 text-emerald-600 font-medium hover:underline"
                    >
                      + Create it
                    </button>
                  </li>
                )}
              </ul>
            )}
            {form.ingredient && (
              <p className="text-xs text-emerald-600 mt-1">✓ {form.ingredient.canonical_name}</p>
            )}
          </div>

          {/* Inline new-ingredient creation */}
          {newIngForm && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl space-y-2">
              <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                Creating "{form.search.trim()}" as a new ingredient
              </p>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Category</label>
                  <select
                    value={newIngForm.category}
                    onChange={(e) => setNewIngForm((f) => f && ({ ...f, category: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:bg-gray-700 dark:text-white"
                  >
                    {['produce','dairy','meat','fish','pantry','spice','bakery','other'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Dimension</label>
                  <select
                    value={newIngForm.dimension}
                    onChange={(e) => setNewIngForm((f) => f && ({ ...f, dimension: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:bg-gray-700 dark:text-white"
                  >
                    {['mass','volume','count','pack'].map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Unit</label>
                  <input
                    type="text"
                    value={newIngForm.unit}
                    onChange={(e) => setNewIngForm((f) => f && ({ ...f, unit: e.target.value }))}
                    placeholder="ml / g / unit"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const name = form.search.trim();
                    if (!name) return;
                    try {
                      const ing = await createIngredientMutation.mutateAsync({
                        canonical_name: name,
                        category: newIngForm.category,
                        dimension: newIngForm.dimension,
                        typical_unit: newIngForm.unit || 'unit',
                      });
                      selectIngredient(ing);
                      setNewIngForm(null);
                      setForm((f) => ({ ...f, unit: ing.typical_unit || '' }));
                    } catch (err: any) {
                      setFormError(err.message ?? 'Failed to create ingredient');
                    }
                  }}
                  disabled={createIngredientMutation.isPending}
                  className="flex-1 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  {createIngredientMutation.isPending ? 'Creating...' : 'Create & Select'}
                </button>
                <button
                  type="button"
                  onClick={() => setNewIngForm(null)}
                  className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Quantity</label>
              <input
                type="number"
                min="0"
                step="any"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                placeholder="1"
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Unit</label>
              <input
                type="text"
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                placeholder="g / ml / unit"
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              Best-before date <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="date"
              value={form.expires_at}
              onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
              min={new Date().toISOString().split('T')[0]}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:bg-gray-700 dark:text-white"
            />
          </div>
          {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}
          <button
            type="submit"
            disabled={upsertMutation.isPending}
            className="w-full py-2.5 bg-emerald-600 text-white font-medium text-sm rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {upsertMutation.isPending ? 'Adding...' : 'Add to Pantry'}
          </button>
        </form>
      )}

      {isError && (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400 mb-3">Failed to load pantry</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 bg-gray-200 dark:bg-gray-700 rounded-2xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Expiring soon banner */}
      {!isLoading && !isError && expiringSoon.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/60 rounded-2xl flex items-start gap-2">
          <span className="text-lg flex-shrink-0">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {expiringSoon.length} item{expiringSoon.length > 1 ? 's' : ''} expiring soon
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              {expiringSoon.map((i) => i.ingredient.canonical_name).join(', ')}
            </p>
          </div>
        </div>
      )}

      {!isLoading && !isError && sorted.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <p className="text-5xl mb-3">🥦</p>
          <p className="font-medium text-gray-600 dark:text-gray-300">Your pantry is empty</p>
          <p className="text-sm mt-1">Add items to start tracking your ingredients</p>
        </div>
      )}

      {!isLoading && !isError && sorted.length > 0 && (
        <div className="space-y-2">
          {sorted.map((item) => {
            const confidencePct = Math.round(item.confidence * 100);
            return (
              <div
                key={item.ingredient.id}
                className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                        {item.ingredient.canonical_name}
                      </p>
                      <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 ml-2">
                        {confidencePct}%
                      </span>
                    </div>
                    {editingId === item.pantry_item_id ? (
                      <div className="flex items-center gap-2 mt-0.5">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={editQty}
                          onChange={(e) => setEditQty(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleUpdateQty(item);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          autoFocus
                          className="w-24 px-2 py-1 text-sm border border-emerald-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:bg-gray-700 dark:text-white"
                        />
                        <span className="text-xs text-gray-500 dark:text-gray-400">{item.unit}</span>
                        <button
                          type="button"
                          onClick={() => handleUpdateQty(item)}
                          disabled={upsertMutation.isPending}
                          className="text-xs px-2 py-1 bg-emerald-600 text-white rounded-lg disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setEditingId(item.pantry_item_id); setEditQty(item.total_quantity.toString()); }}
                        className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 hover:text-emerald-700 dark:hover:text-emerald-400 text-left"
                      >
                        {item.available_quantity.toFixed(1)} {item.unit} available
                        {item.reserved_quantity > 0 && (
                          <span className="text-yellow-600 dark:text-yellow-400"> · {item.reserved_quantity.toFixed(1)} reserved</span>
                        )}
                        <span className="ml-1 text-gray-300 dark:text-gray-600">✎</span>
                      </button>
                    )}
                    <div className="mt-2">
                      <ConfidenceBar confidence={item.confidence} />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {item.ingredient.category}
                    </p>
                    {item.expires_at && <ExpiryBadge expiresAt={item.expires_at} />}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => deleteMutation.mutate(item.pantry_item_id)}
                      disabled={deleteMutation.isPending}
                      className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 disabled:opacity-40 px-2 py-1"
                    >
                      Remove
                    </button>
                    <button
                      onClick={() => confirmMutation.mutate(item.pantry_item_id)}
                      disabled={confirmMutation.isPending}
                      className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                    >
                      {confirmMutation.isPending ? '...' : 'Confirm'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
