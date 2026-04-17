'use client';

import { useState, useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useIngredients, useResolveRecipeIngredient } from '@/lib/hooks';
import { createIngredient } from '@/lib/api';
import type { RecipeIngredient, Ingredient } from '@/lib/types';

// ── Keyword heuristic for auto-suggesting category/dimension/unit ─────────────
const HEURISTICS: Array<{
  keywords: string[];
  category: string;
  dimension: string;
  unit: string;
}> = [
  { keywords: ['bun', 'bread', 'roll', 'brioche', 'wrap', 'tortilla', 'pitta', 'bagel', 'naan', 'crumpet'], category: 'bakery', dimension: 'count', unit: 'count' },
  { keywords: ['sauce', 'ketchup', 'mayo', 'mayonnaise', 'mustard', 'relish', 'vinegar', 'oil', 'stock paste', 'paste', 'miso', 'sriracha', 'ketjap', 'soy'], category: 'pantry', dimension: 'mass', unit: 'g' },
  { keywords: ['spice', 'mix', 'seasoning', 'rub', 'blend', 'herb', 'paprika', 'cumin', 'coriander', 'turmeric', 'oregano', 'sachet'], category: 'spice', dimension: 'mass', unit: 'g' },
  { keywords: ['milk', 'cream', 'butter', 'cheese', 'yogurt', 'yoghurt', 'creme fraiche', 'sour cream'], category: 'dairy', dimension: 'mass', unit: 'g' },
  { keywords: ['chicken', 'beef', 'pork', 'lamb', 'mince', 'steak', 'sausage', 'bacon', 'meatball', 'lardons'], category: 'meat', dimension: 'mass', unit: 'g' },
  { keywords: ['salmon', 'cod', 'prawn', 'tuna', 'fish', 'shrimp', 'haddock', 'sea bass'], category: 'fish', dimension: 'mass', unit: 'g' },
  { keywords: ['coleslaw', 'lettuce', 'spinach', 'rocket', 'salad', 'cabbage', 'broccoli', 'carrot', 'pepper', 'courgette', 'cucumber', 'tomato', 'bean', 'pea', 'mushroom', 'spring onion'], category: 'produce', dimension: 'mass', unit: 'g' },
  { keywords: ['honey', 'sugar', 'syrup', 'flour', 'rice', 'pasta', 'noodle', 'lentil', 'tin', 'can'], category: 'pantry', dimension: 'mass', unit: 'g' },
];

function suggestFromName(rawName: string): { category: string; dimension: string; unit: string } {
  const lower = rawName.toLowerCase();
  for (const rule of HEURISTICS) {
    if (rule.keywords.some((k) => lower.includes(k))) {
      return { category: rule.category, dimension: rule.dimension, unit: rule.unit };
    }
  }
  return { category: 'other', dimension: 'mass', unit: 'g' };
}

const CATEGORIES = ['produce', 'dairy', 'meat', 'fish', 'pantry', 'spice', 'bakery', 'other'];
const DIMENSIONS = ['mass', 'volume', 'count', 'pack'];
const COMMON_UNITS: Record<string, string[]> = {
  mass: ['g', 'kg', 'oz', 'lb'],
  volume: ['ml', 'l', 'tbsp', 'tsp', 'fl oz'],
  count: ['count', 'pack', 'sachet', 'bunch'],
  pack: ['pack', 'box', 'bag', 'jar', 'tin', 'can'],
};

// ── Single unresolved ingredient row ─────────────────────────────────────────
function IngredientFixRow({
  ri,
  recipeId,
  onResolved,
}: {
  ri: RecipeIngredient;
  recipeId: string;
  onResolved: () => void;
}) {
  const [mode, setMode] = useState<'search' | 'create'>('search');
  const [searchQ, setSearchQ] = useState(ri.raw_name);
  const [debouncedQ, setDebouncedQ] = useState(ri.raw_name);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create-new form
  const suggested = suggestFromName(ri.raw_name);
  const [newName, setNewName] = useState(ri.raw_name);
  const [newCategory, setNewCategory] = useState(suggested.category);
  const [newDimension, setNewDimension] = useState(suggested.dimension);
  const [newUnit, setNewUnit] = useState(suggested.unit);
  const [creating, setCreating] = useState(false);

  const { data: suggestions = [] } = useIngredients(debouncedQ.trim().length >= 2 ? debouncedQ : undefined);
  const resolveMutation = useResolveRecipeIngredient(recipeId);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(searchQ), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQ]);

  async function handleSelect(ingredient: Ingredient) {
    setError('');
    try {
      await resolveMutation.mutateAsync({ riId: ri.id, ingredientId: ingredient.id });
      setDone(true);
      onResolved();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to link ingredient');
    }
    setDropdownOpen(false);
  }

  async function handleCreate() {
    setCreating(true);
    setError('');
    try {
      const created = await createIngredient({
        canonical_name: newName.trim(),
        category: newCategory,
        dimension: newDimension,
        typical_unit: newUnit,
        aliases: [ri.raw_name.trim()],
      });
      await resolveMutation.mutateAsync({ riId: ri.id, ingredientId: created.id });
      setDone(true);
      onResolved();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create ingredient');
    } finally {
      setCreating(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="text-emerald-500 text-base">✓</span>
        <span className="text-sm text-gray-500 dark:text-gray-400 line-through">{ri.raw_name}</span>
        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium ml-1">Matched!</span>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-2 border-b border-orange-100 dark:border-orange-900/30 last:border-0">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{ri.raw_name}</span>
        <div className="flex gap-1.5">
          <button
            onClick={() => setMode('search')}
            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${mode === 'search' ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
            Match existing
          </button>
          <button
            onClick={() => setMode('create')}
            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${mode === 'create' ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
            Add as new
          </button>
        </div>
      </div>

      {mode === 'search' && (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={searchQ}
            onChange={(e) => { setSearchQ(e.target.value); setDropdownOpen(true); }}
            onFocus={() => setDropdownOpen(true)}
            placeholder="Search ingredient library…"
            className="w-full pl-3 pr-8 py-1.5 text-sm rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
          />
          {searchQ && (
            <button onClick={() => { setSearchQ(''); setDropdownOpen(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
          )}
          {dropdownOpen && suggestions.length > 0 && (
            <ul className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg max-h-48 overflow-y-auto">
              {suggestions.slice(0, 10).map((ig) => (
                <li key={ig.id}>
                  <button
                    onClick={() => handleSelect(ig)}
                    disabled={resolveMutation.isPending}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-orange-50 dark:hover:bg-orange-900/20 text-gray-800 dark:text-gray-200 flex items-center justify-between gap-2 disabled:opacity-50"
                  >
                    <span>{ig.canonical_name}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{ig.category} · {ig.typical_unit}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {dropdownOpen && suggestions.length === 0 && debouncedQ.trim().length >= 2 && (
            <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
              No matches — try &quot;Add as new&quot;
            </div>
          )}
        </div>
      )}

      {mode === 'create' && (
        <div className="space-y-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Canonical name"
            className="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
          <div className="grid grid-cols-3 gap-2">
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="px-2 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={newDimension}
              onChange={(e) => { setNewDimension(e.target.value); setNewUnit(COMMON_UNITS[e.target.value]?.[0] ?? 'g'); }}
              className="px-2 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              {DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
              className="px-2 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              {(COMMON_UNITS[newDimension] ?? ['g']).map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="w-full py-1.5 text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {creating ? 'Creating…' : 'Create & Link'}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ── Main exported component ───────────────────────────────────────────────────
export function FixIngredients({
  recipeId,
  ingredients,
}: {
  recipeId: string;
  ingredients: RecipeIngredient[];
}) {
  const unresolved = ingredients.filter((i) => !i.ingredient_id);
  const [open, setOpen] = useState(false);
  const [resolvedCount, setResolvedCount] = useState(0);

  if (unresolved.length === 0) return null;

  const remaining = unresolved.length - resolvedCount;

  return (
    <div className="rounded-2xl border border-orange-200 dark:border-orange-800/60 bg-orange-50/60 dark:bg-orange-900/10 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-orange-700 dark:text-orange-300">
            {remaining} ingredient{remaining !== 1 ? 's' : ''} not matched to library
          </p>
          <p className="text-xs text-orange-600/70 dark:text-orange-400/70 mt-0.5">
            Tap to fix — this improves pantry tracking, shopping list zones, and future scans
          </p>
        </div>
        <span className={`text-orange-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {open && (
        <div className="border-t border-orange-200 dark:border-orange-800/60">
          {unresolved.map((ri) => (
            <IngredientFixRow
              key={ri.id}
              ri={ri}
              recipeId={recipeId}
              onResolved={() => setResolvedCount((c) => c + 1)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
