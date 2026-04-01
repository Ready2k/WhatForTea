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
}

const EMPTY_FORM: AddItemForm = { search: '', ingredient: null, quantity: '', unit: '' };

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

  const suggestions = useMemo(() => {
    if (form.ingredient || !inputFocused) return [];
    const q = form.search.trim().toLowerCase();
    if (!q) return ingredients.slice(0, 8); // show first 8 when empty
    return ingredients
      .filter((i) => i.canonical_name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [form.search, form.ingredient, ingredients, inputFocused]);

  const noResults = inputFocused && !form.ingredient && form.search.trim().length > 0 && suggestions.length === 0;

  const sorted = items
    ? [...items].sort((a, b) => a.confidence - b.confidence)
    : [];

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.ingredient) {
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
        ingredient_id: form.ingredient.id,
        quantity: qty,
        unit: form.unit.trim() || form.ingredient.typical_unit || 'unit',
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
        <h1 className="text-xl font-bold text-gray-900">My Pantry</h1>
        <button
          onClick={() => { setShowAddForm((v) => !v); setFormError(''); setForm(EMPTY_FORM); }}
          className="px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          {showAddForm ? 'Cancel' : '+ Add Item'}
        </button>
      </div>

      {/* Add item form */}
      {showAddForm && (
        <form onSubmit={handleAddItem} className="mb-4 p-4 bg-white rounded-2xl border border-gray-200 space-y-3 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700">Add Pantry Item</h2>
          <div className="relative">
            <label className="block text-xs text-gray-500 mb-1">Ingredient</label>
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
              className={`w-full px-3 py-2 text-sm border rounded-xl focus:outline-none focus:ring-2 ${
                form.ingredient
                  ? 'border-emerald-400 bg-emerald-50 focus:ring-emerald-400'
                  : 'border-gray-300 focus:ring-emerald-400'
              }`}
            />
            {(suggestions.length > 0 || noResults) && (
              <ul className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {suggestions.map((ing) => (
                  <li key={ing.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); selectIngredient(ing); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 flex items-center justify-between"
                    >
                      <span>{ing.canonical_name}</span>
                      <span className="text-xs text-gray-400 ml-2">{ing.category}</span>
                    </button>
                  </li>
                ))}
                {noResults && (
                  <li className="px-3 py-2 text-sm text-gray-500">
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
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
              <p className="text-xs font-semibold text-emerald-800">
                Creating "{form.search.trim()}" as a new ingredient
              </p>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Category</label>
                  <select
                    value={newIngForm.category}
                    onChange={(e) => setNewIngForm((f) => f && ({ ...f, category: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  >
                    {['produce','dairy','meat','fish','pantry','spice','bakery','other'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Dimension</label>
                  <select
                    value={newIngForm.dimension}
                    onChange={(e) => setNewIngForm((f) => f && ({ ...f, dimension: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  >
                    {['mass','volume','count','pack'].map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Unit</label>
                  <input
                    type="text"
                    value={newIngForm.unit}
                    onChange={(e) => setNewIngForm((f) => f && ({ ...f, unit: e.target.value }))}
                    placeholder="ml / g / unit"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
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
                  className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Quantity</label>
              <input
                type="number"
                min="0"
                step="any"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                placeholder="1"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Unit</label>
              <input
                type="text"
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                placeholder="g / ml / unit"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
          </div>
          {formError && <p className="text-xs text-red-600">{formError}</p>}
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
          <p className="text-gray-500 mb-3">Failed to load pantry</p>
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
            <div key={i} className="h-20 bg-gray-200 rounded-2xl animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && !isError && sorted.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-5xl mb-3">🥦</p>
          <p className="font-medium text-gray-600">Your pantry is empty</p>
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
                className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {item.ingredient.canonical_name}
                      </p>
                      <span className="text-xs text-gray-500 flex-shrink-0 ml-2">
                        {confidencePct}%
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {item.available_quantity.toFixed(1)} {item.unit} available
                      {item.reserved_quantity > 0 && (
                        <span className="text-yellow-600"> · {item.reserved_quantity.toFixed(1)} reserved</span>
                      )}
                    </p>
                    <div className="mt-2">
                      <ConfidenceBar confidence={item.confidence} />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3">
                  <p className="text-xs text-gray-400">
                    {item.ingredient.category}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => deleteMutation.mutate(item.ingredient.id)}
                      disabled={deleteMutation.isPending}
                      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40 px-2 py-1"
                    >
                      Remove
                    </button>
                    <button
                      onClick={() => confirmMutation.mutate(item.ingredient.id)}
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
