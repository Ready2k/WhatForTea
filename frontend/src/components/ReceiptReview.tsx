'use client';

import { useState } from 'react';
import { Check, Loader2, ShoppingBasket } from 'lucide-react';
import { receiptConfirmPantry } from '@/lib/api';
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

  const allSelectable = items.map((_, i) => i);
  const allSelected = allSelectable.every((i) => selected.has(i));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allSelectable));
    }
  }

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function handleConfirm() {
    if (selected.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const payload = [...selected].map((i) => ({
        ingredient_id: items[i].ingredient_id ?? null,
        raw_name: items[i].resolved ? null : items[i].raw_name,
        quantity: quantities[i] ?? items[i].quantity,
        unit: items[i].unit ?? 'count',
      }));
      await receiptConfirmPantry(payload);
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
        <ShoppingBasket className="w-12 h-12 mx-auto text-brand-herb" />
        <p className="text-base font-semibold text-gray-900 dark:text-white">
          {selected.size} item{selected.size !== 1 ? 's' : ''} added to your pantry
        </p>
        <button
          onClick={onDone}
          className="mt-2 px-6 py-2 bg-brand-primary text-brand-background text-sm font-medium rounded-xl hover:bg-brand-primary-hover transition-colors"
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
        <p className="text-sm text-brand-muted dark:text-brand-secondary">
          Found <span className="font-semibold text-brand-ink dark:text-brand-background">{items.length}</span> items
          {unresolved.length > 0 && (
            <span className="text-brand-accent"> · {unresolved.length} new ingredients</span>
          )}
        </p>
        <button
          onClick={toggleAll}
          className="text-xs text-brand-herb font-medium hover:underline"
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
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                isSelected
                  ? isResolved
                    ? 'border-brand-herb/30 dark:border-brand-herb/40 bg-brand-herb/5 dark:bg-brand-herb/10'
                    : 'border-brand-accent/30 dark:border-brand-accent/40 bg-brand-accent/5 dark:bg-brand-accent/10'
                  : 'border-brand-linen/10 dark:border-brand-primary-hover/30 bg-brand-card dark:bg-brand-primary/40 hover:border-brand-linen/30 dark:hover:border-brand-primary-hover/50'
              }`}
            >
              {/* Checkbox */}
              <div
                className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                  isSelected
                    ? isResolved
                      ? 'border-brand-herb bg-brand-herb'
                      : 'border-brand-accent bg-brand-accent'
                    : 'border-brand-linen/30 dark:border-brand-primary-hover/50'
                }`}
              >
                {isSelected && <Check size={12} className="text-white" strokeWidth={3} />}
              </div>

              {/* Name */}
              <span className="flex-1 text-sm font-medium text-gray-900 dark:text-white capitalize">
                {item.raw_name}
              </span>

              {/* Quantity editor + status badge */}
              <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                <input
                  type="number"
                  value={quantities[i] ?? item.quantity}
                  onChange={(e) => setQuantities((q) => ({ ...q, [i]: Number(e.target.value) }))}
                  disabled={!isSelected}
                  className="w-14 text-right text-sm font-mono bg-transparent border-b border-brand-linen/30 dark:border-brand-primary-hover/50 focus:border-brand-herb focus:outline-none disabled:opacity-40 py-0 text-brand-ink dark:text-brand-background"
                  min={0}
                />
                {item.unit && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 w-8">{item.unit}</span>
                )}
                {!isResolved && (
                  <span className="text-xs text-brand-accent whitespace-nowrap">new</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {unresolved.length > 0 && (
        <p className="text-xs text-brand-accent">
          Items marked <span className="font-semibold">new</span> will be added to the ingredient database automatically when confirmed.
        </p>
      )}

      {error && (
        <p className="text-sm text-brand-tomato">{error}</p>
      )}

      <button
        onClick={handleConfirm}
        disabled={selected.size === 0 || saving}
        className="w-full py-3 bg-brand-primary hover:bg-brand-primary-hover disabled:opacity-40 disabled:cursor-not-allowed text-brand-background font-semibold text-sm rounded-2xl transition-colors flex items-center justify-center gap-2 shadow-lg shadow-brand-primary/20"
      >
        {saving ? (
          <><Loader2 size={16} className="animate-spin" /> Saving…</>
        ) : (
          `Add ${selected.size} item${selected.size !== 1 ? 's' : ''} to pantry`
        )}
      </button>
    </div>
  );
}
