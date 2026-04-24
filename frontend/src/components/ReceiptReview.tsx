'use client';

import { useState } from 'react';
import { Check, Loader2, ShoppingBasket } from 'lucide-react';
import { bulkConfirmPantry } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import type { ReceiptItem } from '@/lib/types';

interface Props {
  items: ReceiptItem[];
  onDone: () => void;
}

export function ReceiptReview({ items, onDone }: Props) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(items.map((_, i) => i).filter((i) => items[i].resolved)),
  );
  const [quantities, setQuantities] = useState<Record<number, number>>(
    () => Object.fromEntries(items.map((item, i) => [i, item.quantity])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const queryClient = useQueryClient();

  const resolvedSelected = [...selected].filter((i) => items[i].resolved);
  const allResolved = items.filter((_, i) => items[i].resolved).map((_, i) => i);
  const allSelected = allResolved.every((i) => selected.has(i));

  function toggleAll() {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        allResolved.forEach((i) => next.delete(i));
        return next;
      });
    } else {
      setSelected((prev) => new Set([...prev, ...allResolved]));
    }
  }

  function toggle(i: number) {
    if (!items[i].resolved) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function handleConfirm() {
    if (resolvedSelected.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const payload = resolvedSelected.map((i) => ({
        ingredient_id: items[i].ingredient_id!,
        quantity: quantities[i] ?? items[i].quantity,
        unit: items[i].unit ?? 'count',
      }));
      await bulkConfirmPantry(payload);
      queryClient.invalidateQueries({ queryKey: ['pantry'] });
      queryClient.invalidateQueries({ queryKey: ['available'] });
      setDone(true);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="text-center py-10 space-y-3">
        <ShoppingBasket className="w-12 h-12 mx-auto text-emerald-500" />
        <p className="text-base font-semibold text-gray-900 dark:text-white">
          {resolvedSelected.length} item{resolvedSelected.length !== 1 ? 's' : ''} added to your pantry
        </p>
        <button
          onClick={onDone}
          className="mt-2 px-6 py-2 bg-indigo-500 text-white text-sm font-medium rounded-xl hover:bg-indigo-600 transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  const unresolved = items.filter((item) => !item.resolved);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Found <span className="font-semibold text-gray-800 dark:text-white">{items.length}</span> items
          {unresolved.length > 0 && (
            <span className="text-amber-600 dark:text-amber-400"> · {unresolved.length} unrecognised</span>
          )}
        </p>
        <button
          onClick={toggleAll}
          className="text-xs text-emerald-600 dark:text-emerald-400 font-medium hover:underline"
        >
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
        {items.map((item, i) => {
          const isSelected = selected.has(i);
          const isResolved = item.resolved;
          return (
            <div
              key={i}
              onClick={() => toggle(i)}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                !isResolved
                  ? 'border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 opacity-50 cursor-not-allowed'
                  : isSelected
                  ? 'border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 cursor-pointer'
                  : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800 cursor-pointer hover:border-gray-200 dark:hover:border-gray-700'
              }`}
            >
              {/* Checkbox */}
              <div
                className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                  isSelected && isResolved
                    ? 'border-emerald-500 bg-emerald-500'
                    : 'border-gray-300 dark:border-gray-600'
                }`}
              >
                {isSelected && isResolved && <Check size={12} className="text-white" strokeWidth={3} />}
              </div>

              {/* Name */}
              <span className="flex-1 text-sm font-medium text-gray-900 dark:text-white capitalize">
                {item.raw_name}
              </span>

              {/* Quantity editor (resolved items only) */}
              {isResolved ? (
                <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="number"
                    value={quantities[i] ?? item.quantity}
                    onChange={(e) => setQuantities((q) => ({ ...q, [i]: Number(e.target.value) }))}
                    disabled={!isSelected}
                    className="w-14 text-right text-sm font-mono bg-transparent border-b border-gray-300 dark:border-gray-600 focus:border-emerald-500 focus:outline-none disabled:opacity-40 py-0"
                    min={0}
                  />
                  {item.unit && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 w-8">{item.unit}</span>
                  )}
                </div>
              ) : (
                <span className="text-xs text-amber-600 dark:text-amber-400 flex-shrink-0">unrecognised</span>
              )}
            </div>
          );
        })}
      </div>

      {unresolved.length > 0 && (
        <details className="text-xs text-gray-500 dark:text-gray-400">
          <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-200">
            {unresolved.length} item{unresolved.length !== 1 ? 's' : ''} skipped (not in ingredient database)
          </summary>
          <ul className="mt-1 pl-3 space-y-0.5">
            {unresolved.map((item, i) => (
              <li key={i} className="capitalize">{item.raw_name}</li>
            ))}
          </ul>
        </details>
      )}

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      <button
        onClick={handleConfirm}
        disabled={resolvedSelected.length === 0 || saving}
        className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-2xl transition-colors flex items-center justify-center gap-2"
      >
        {saving ? (
          <><Loader2 size={16} className="animate-spin" /> Saving…</>
        ) : (
          `Add ${resolvedSelected.length} item${resolvedSelected.length !== 1 ? 's' : ''} to pantry`
        )}
      </button>
    </div>
  );
}
