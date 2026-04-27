'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  useAvailable,
  useConfirmPantryItem,
  useUpsertPantryItem,
  useDeletePantryItem,
  useIngredients,
  useCreateIngredient,
  useBulkConfirmPantry,
  useUpdateIngredientCategory,
} from '@/lib/hooks';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import type { Ingredient, PantryAvailability } from '@/lib/types';
import type { BarcodeLookupResponse } from '@/lib/api';

// ─── constants ────────────────────────────────────────────────────────────────

const CATEGORY_EMOJI: Record<string, string> = {
  produce: '🥦', dairy: '🧀', meat: '🥩', fish: '🐟', seafood: '🦐',
  pantry: '🥫', spice: '🌶️', bakery: '🍞', other: '📦',
};
const CATEGORY_ORDER = ['produce', 'dairy', 'meat', 'fish', 'seafood', 'pantry', 'spice', 'bakery', 'other'];

const W = {
  bg:        'dark:bg-zinc-950',
  surface:   'dark:bg-zinc-900',
  raised:    'dark:bg-zinc-800',
  hi:        'dark:bg-zinc-700',
  border:    'dark:border-zinc-700',
  borderLo:  'dark:border-zinc-800',
  txPrimary: 'dark:text-zinc-100',
  txSecond:  'dark:text-zinc-400',
  txMuted:   'dark:text-zinc-500',
  hoverHi:   'dark:hover:bg-zinc-700',
  hoverRaised: 'dark:hover:bg-zinc-800',
};

function catEmoji(cat: string) { return CATEGORY_EMOJI[cat] ?? '📦'; }

// ─── helpers ──────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

// ─── sub-components ───────────────────────────────────────────────────────────

function ExpiryBadge({ expiresAt }: { expiresAt: string }) {
  const days = daysUntil(expiresAt);
  if (days < 0)  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400">Expired</span>;
  if (days === 0) return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400">Today</span>;
  if (days <= 3)  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">{days}d left</span>;
  return <span className="text-[10px] text-gray-400 dark:text-zinc-500">{new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>;
}

function ConfidenceDot({ confidence }: { confidence: number }) {
  const pct = confidence * 100;
  if (pct >= 70) return <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-green-500 shadow-[0_0_6px_rgba(74,222,128,0.6)]" />;
  if (pct >= 40) return <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-yellow-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]" />;
  return <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-red-500 shadow-[0_0_6px_rgba(248,113,113,0.6)]" />;
}

function AccentStripe({ confidence, expiresAt }: { confidence: number; expiresAt?: string | null }) {
  const expiring = expiresAt && daysUntil(expiresAt) <= 3;
  if (expiring || confidence < 0.4)
    return <div className="w-1 self-stretch rounded-full flex-shrink-0 bg-red-500 shadow-[0_0_8px_rgba(248,113,113,0.45)]" />;
  if (confidence < 0.7)
    return <div className="w-1 self-stretch rounded-full flex-shrink-0 bg-yellow-400 shadow-[0_0_8px_rgba(251,191,36,0.35)]" />;
  return <div className="w-1 self-stretch rounded-full flex-shrink-0 bg-green-500 shadow-[0_0_6px_rgba(74,222,128,0.35)]" />;
}

// ─── UseItUpCard ──────────────────────────────────────────────────────────────

interface UseItUpCardProps {
  item: PantryAvailability;
  onConfirm: () => void;
  onRemove: () => void;
  confirmPending: boolean;
  deletePending: boolean;
}

function UseItUpCard({ item, onConfirm, onRemove, confirmPending, deletePending }: UseItUpCardProps) {
  const days = item.expires_at ? daysUntil(item.expires_at) : null;
  const isUrgent = days !== null && days <= 0;
  const isWarn   = days !== null && days > 0 && days <= 2;
  const confPct  = Math.round(item.confidence * 100);
  const urgencyLabel = days === null ? 'Low stock'
    : days < 0 ? 'Expired'
    : days === 0 ? 'Expires today'
    : `${days}d left`;

  const del = useDeleteConfirm(onRemove);

  return (
    <div className={`w-44 flex-shrink-0 rounded-2xl border p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl ${
      isUrgent
        ? 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800/30'
        : isWarn
          ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-700/25'
          : `bg-white border-gray-200 ${W.raised} ${W.border}`
    }`}>
      <div className="flex items-start justify-between mb-2">
        <span className={`text-[10px] font-extrabold uppercase tracking-wider ${
          isUrgent ? 'text-red-500 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
        }`}>{urgencyLabel}</span>
        <span className="text-lg leading-none">{catEmoji(item.ingredient.category)}</span>
      </div>

      <p className={`text-sm font-bold leading-snug mb-0.5 line-clamp-2 text-gray-900 ${W.txPrimary}`}>
        {item.ingredient.canonical_name}
      </p>
      <p className={`text-[11px] mb-3 text-gray-500 ${W.txSecond}`}>
        {item.available_quantity.toFixed(1)} {item.unit}
      </p>

      <div className="h-[3px] bg-gray-200 dark:bg-zinc-800 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full rounded-full ${confPct >= 70 ? 'bg-green-500' : confPct >= 40 ? 'bg-yellow-400' : 'bg-red-500'}`}
          style={{ width: `${confPct}%` }}
        />
      </div>

      <div className="flex gap-1.5">
        {del.pending ? (
          <>
            <button
              onClick={del.cancel}
              className="flex-1 py-1.5 rounded-[10px] text-[11px] font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={del.confirm}
              disabled={deletePending}
              className="flex-1 py-1.5 rounded-[10px] text-[11px] font-extrabold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-all active:scale-95"
            >
              Sure?
            </button>
          </>
        ) : (
          <>
            <button
              onClick={del.request}
              disabled={deletePending}
              className="flex-1 py-1.5 rounded-[10px] text-[11px] font-bold bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20 dark:border dark:border-red-500/20 disabled:opacity-40 transition-colors"
            >
              Remove
            </button>
            <button
              onClick={onConfirm}
              disabled={confirmPending}
              className="flex-1 py-1.5 rounded-[10px] text-[11px] font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-all active:scale-95"
            >
              {confirmPending ? '…' : 'Confirm'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── useDeleteConfirm ─────────────────────────────────────────────────────────

function useDeleteConfirm(onDelete: () => void, onBeforeConfirm?: () => void) {
  const [pending, setPending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  function request() {
    setPending(true);
    timerRef.current = setTimeout(() => setPending(false), 3000);
  }
  function cancel() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPending(false);
  }
  function confirm() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPending(false);
    onBeforeConfirm?.();
    onDelete();
  }

  return { pending, request, cancel, confirm };
}

// ─── PantryRow ────────────────────────────────────────────────────────────────

const SWIPE_REVEAL = 88; // px — width of the action strip revealed on swipe
const SWIPE_THRESHOLD = 44; // px — minimum drag to snap open

interface PantryRowProps {
  item: PantryAvailability;
  editingId: string | null;
  editQty: string;
  setEditQty: (v: string) => void;
  setEditingId: (id: string | null) => void;
  onSaveQty: (item: PantryAvailability) => void;
  onConfirm: () => void;
  onDelete: () => void;
  confirmPending: boolean;
  deletePending: boolean;
  showStripe?: boolean;
}

function PantryRow({ item, editingId, editQty, setEditQty, setEditingId, onSaveQty, onConfirm, onDelete, confirmPending, deletePending, showStripe = false }: PantryRowProps) {
  const isEditing = editingId === item.pantry_item_id;
  const confPct   = Math.round(item.confidence * 100);
  const isLow     = item.confidence < 0.4;

  // Category editing
  const [editCategory, setEditCategory] = useState(item.ingredient.category);
  const updateCategory = useUpdateIngredientCategory();
  useEffect(() => { if (isEditing) setEditCategory(item.ingredient.category); }, [isEditing, item.ingredient.category]);

  function handleSave() {
    if (editCategory !== item.ingredient.category) {
      updateCategory.mutate({ ingredientId: item.ingredient.id, category: editCategory });
    }
    onSaveQty(item);
  }

  // Swipe state
  const [offset, setOffset] = useState(0);
  const [snapped, setSnapped] = useState(false);
  const startX = useRef<number | null>(null);
  const isDragging = useRef(false);

  function snapClose() { setOffset(0); setSnapped(false); }
  function snapOpen()  { setOffset(-SWIPE_REVEAL); setSnapped(true); }

  // Delete confirmation
  const del = useDeleteConfirm(onDelete, snapClose);

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
    isDragging.current = false;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (startX.current === null) return;
    const dx = e.touches[0].clientX - startX.current;
    // Allow dragging left from closed, or right from snapped
    const base = snapped ? -SWIPE_REVEAL : 0;
    const raw  = base + dx;
    const clamped = Math.max(-SWIPE_REVEAL, Math.min(0, raw));
    if (Math.abs(dx) > 4) isDragging.current = true;
    setOffset(clamped);
  }
  function onTouchEnd() {
    if (startX.current === null) return;
    isDragging.current = false; // re-enable CSS transition before snap
    const delta = offset - (snapped ? -SWIPE_REVEAL : 0);
    if (!snapped && offset < -SWIPE_THRESHOLD) snapOpen();
    else if (snapped && delta > SWIPE_THRESHOLD) snapClose();
    else if (snapped) snapOpen();
    else snapClose();
    startX.current = null;
  }

  // Close when another row starts editing
  useEffect(() => { if (isEditing) snapClose(); }, [isEditing]);

  const translate = `translateX(${offset}px)`;
  const transition = isDragging.current ? 'none' : 'transform 0.2s ease';

  return (
    <div className="relative overflow-hidden border-b border-gray-100 last:border-b-0 dark:border-zinc-800">
      {/* Action strip — revealed behind the row on swipe */}
      <div
        className="absolute right-0 top-0 bottom-0 flex"
        style={{ width: SWIPE_REVEAL }}
        aria-hidden
      >
        {del.pending ? (
          /* Confirm state: Cancel + Sure? */
          <>
            <button
              onClick={del.cancel}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-gray-500 hover:bg-gray-600 text-white text-[10px] font-bold transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={del.confirm}
              disabled={deletePending}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-red-600 hover:bg-red-700 text-white text-[10px] font-extrabold transition-colors disabled:opacity-50"
            >
              Sure?
            </button>
          </>
        ) : (
          /* Normal state: Edit + Remove */
          <>
            <button
              onClick={() => { snapClose(); setEditingId(item.pantry_item_id); setEditQty(item.total_quantity.toString()); }}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"/>
              </svg>
              Edit
            </button>
            <button
              onClick={del.request}
              disabled={deletePending}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-red-500 hover:bg-red-600 text-white text-[10px] font-bold transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>
              </svg>
              Remove
            </button>
          </>
        )}
      </div>

      {/* Row content — slides left on swipe */}
      <div
        className={`flex items-center gap-2.5 px-4 py-3 transition-colors bg-white dark:bg-zinc-900 hover:bg-gray-50 ${W.hoverRaised} group`}
        style={{ transform: translate, transition, willChange: 'transform' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => { if (snapped) snapClose(); }}
      >
        {showStripe && <AccentStripe confidence={item.confidence} expiresAt={item.expires_at} />}
        {!showStripe && <ConfidenceDot confidence={item.confidence} />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-semibold text-gray-900 ${W.txPrimary} truncate`}>
              {item.ingredient.canonical_name}
            </span>
            {item.expires_at && <ExpiryBadge expiresAt={item.expires_at} />}
          </div>

          {isEditing ? (
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <input
                type="number" min="0" step="any"
                value={editQty}
                onChange={e => setEditQty(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditingId(null); }}
                autoFocus
                className="w-20 px-2 py-1 text-sm border border-indigo-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-zinc-800 dark:text-zinc-100 dark:border-indigo-400/60"
              />
              <span className={`text-xs text-gray-500 ${W.txSecond}`}>{item.unit}</span>
              <select
                value={editCategory}
                onChange={e => setEditCategory(e.target.value)}
                className="text-xs border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 dark:text-zinc-100 px-2 py-1 focus:outline-none focus:border-indigo-400"
              >
                {CATEGORY_ORDER.map(c => <option key={c} value={c}>{catEmoji(c)} {c}</option>)}
              </select>
              <button onClick={handleSave} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Save</button>
              <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-zinc-100">×</button>
            </div>
          ) : (
            <button
              onClick={() => { if (!snapped) { setEditingId(item.pantry_item_id); setEditQty(item.total_quantity.toString()); } }}
              className={`text-[11px] text-gray-500 ${W.txSecond} mt-0.5 hover:text-indigo-600 dark:hover:text-indigo-400 text-left`}
            >
              {item.available_quantity.toFixed(1)} {item.unit}
              {item.reserved_quantity > 0 && <span className="text-yellow-600 dark:text-yellow-400"> · {item.reserved_quantity.toFixed(1)} reserved</span>}
              <span className={`ml-1 font-bold ${confPct >= 70 ? 'text-green-600 dark:text-green-400' : confPct >= 40 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}> {confPct}%</span>
              <span className="ml-1 opacity-0 group-hover:opacity-50 transition-opacity">✎</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isLow && (
            <button
              onClick={e => { e.stopPropagation(); onConfirm(); }}
              disabled={confirmPending}
              className="text-[11px] font-bold px-2.5 py-1.5 rounded-[8px] bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {confirmPending ? '…' : 'Confirm'}
            </button>
          )}
          {/* Desktop-only delete — hidden on touch (swipe handles it) */}
          {del.pending ? (
            <span className="hidden md:flex items-center gap-1">
              <button
                onClick={e => { e.stopPropagation(); del.cancel(); }}
                className="text-[10px] font-bold px-2 py-1 rounded-lg bg-gray-100 dark:bg-zinc-700 text-gray-500 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={e => { e.stopPropagation(); del.confirm(); }}
                disabled={deletePending}
                className="text-[10px] font-extrabold px-2 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                Remove
              </button>
            </span>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); del.request(); }}
              disabled={deletePending}
              className="hidden md:block text-[11px] text-gray-400 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-40 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove item"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── AddItemForm state ────────────────────────────────────────────────────────

interface AddItemForm {
  search: string;
  ingredient: Ingredient | null;
  quantity: string;
  unit: string;
  expires_at: string;
}
const EMPTY_FORM: AddItemForm = { search: '', ingredient: null, quantity: '', unit: '', expires_at: '' };

// ─── AddItemSheet ─────────────────────────────────────────────────────────────

interface AddItemSheetProps {
  open: boolean;
  onClose: () => void;
  ingredients: Ingredient[];
  upsertMutation: ReturnType<typeof useUpsertPantryItem>;
  createIngredientMutation: ReturnType<typeof useCreateIngredient>;
  prefillIngredient?: Ingredient | null;
  onClearPrefill: () => void;
}

function AddItemSheet({ open, onClose, ingredients, upsertMutation, createIngredientMutation, prefillIngredient, onClearPrefill }: AddItemSheetProps) {
  const [form, setForm] = useState<AddItemForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [newIngForm, setNewIngForm] = useState<{ category: string; dimension: string; unit: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prefillIngredient) {
      setForm({ search: prefillIngredient.canonical_name, ingredient: prefillIngredient, quantity: '', unit: prefillIngredient.typical_unit || '', expires_at: '' });
      onClearPrefill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillIngredient]);

  const suggestions = useMemo(() => {
    if (form.ingredient || !inputFocused) return [];
    const q = form.search.trim().toLowerCase();
    if (!q) return ingredients.slice(0, 8);
    return ingredients.filter(i => i.canonical_name.toLowerCase().includes(q)).slice(0, 8);
  }, [form.search, form.ingredient, ingredients, inputFocused]);

  const noMatch = inputFocused && !form.ingredient && form.search.trim().length > 1 && suggestions.length === 0;

  const expiryPreview = useMemo(() => {
    if (!form.expires_at) return null;
    const days = daysUntil(form.expires_at);
    if (days < 0) return { label: 'Already expired!', warn: true };
    if (days <= 7) return { label: `${days}d — will appear in Use It Up`, warn: true };
    return { label: `${days} days from today`, warn: false };
  }, [form.expires_at]);

  function selectIngredient(ing: Ingredient) {
    setForm(f => ({ ...f, ingredient: ing, search: ing.canonical_name, unit: ing.typical_unit || '' }));
    setInputFocused(false);
  }

  function handleClose() {
    setForm(EMPTY_FORM);
    setFormError('');
    setNewIngForm(null);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
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

    if (!ingredient) { setFormError('Select an ingredient from the list'); return; }
    const qty = parseFloat(form.quantity);
    if (isNaN(qty) || qty <= 0) { setFormError('Enter a valid quantity'); return; }

    try {
      await upsertMutation.mutateAsync({
        ingredient_id: ingredient.id,
        quantity: qty,
        unit: form.unit.trim() || ingredient.typical_unit || 'unit',
        expires_at: form.expires_at || null,
      });
      setForm(EMPTY_FORM);
      handleClose();
    } catch (err: any) {
      setFormError(err.message ?? 'Failed to add item');
    }
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/55 backdrop-blur-[3px] transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={handleClose}
      />
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-zinc-900 rounded-t-[28px] border-t border-gray-200 ${W.border} shadow-2xl transition-transform duration-300 ease-out ${open ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3.5 pb-1">
          <div className={`w-10 h-[5px] rounded-full bg-gray-300 dark:bg-zinc-700`} />
        </div>

        <div className="px-5 pb-4 overflow-y-auto max-h-[85vh]">
          <div className="flex items-center justify-between mb-5">
            <h2 className={`text-lg font-extrabold text-gray-900 ${W.txPrimary} tracking-tight`}>Add to Pantry</h2>
            <button
              onClick={handleClose}
              className={`w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 hover:bg-gray-200 ${W.hoverHi} transition-colors`}
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Ingredient search */}
            <div className="relative">
              <label className={`block text-xs font-semibold text-gray-500 ${W.txSecond} mb-1.5`}>Ingredient</label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-zinc-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 0z"/>
                </svg>
                <input
                  ref={searchRef}
                  type="text"
                  value={form.search}
                  onChange={e => {
                    const val = e.target.value;
                    setForm(f => ({ ...f, search: val, ingredient: f.ingredient?.canonical_name === val ? f.ingredient : null }));
                  }}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setTimeout(() => setInputFocused(false), 150)}
                  placeholder="Search ingredients…"
                  autoComplete="off"
                  className={`w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border focus:outline-none transition-colors ${W.txPrimary} ${
                    form.ingredient
                      ? 'border-green-400 bg-green-50 dark:bg-green-900/20'
                      : `border-gray-200 ${W.border} bg-white dark:bg-zinc-800 dark:placeholder-zinc-500`
                  } focus:border-indigo-400 dark:focus:border-indigo-400`}
                />
                {form.ingredient && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                    <svg width="8" height="8" fill="none" stroke="white" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                  </div>
                )}
              </div>

              {(suggestions.length > 0 || noMatch) && (
                <ul className={`absolute z-10 w-full mt-1 bg-white dark:bg-zinc-800 border border-gray-200 ${W.border} rounded-xl shadow-xl max-h-48 overflow-y-auto`}>
                  {suggestions.map(ing => (
                    <li key={ing.id}>
                      <button
                        type="button"
                        onMouseDown={e => { e.preventDefault(); selectIngredient(ing); }}
                        className={`w-full text-left px-3 py-2.5 text-sm hover:bg-indigo-50 dark:hover:bg-zinc-700 flex items-center justify-between text-gray-800 ${W.txPrimary}`}
                      >
                        <span>{ing.canonical_name}</span>
                        <span className={`text-xs text-gray-400 ${W.txMuted} ml-2 capitalize`}>{ing.category}</span>
                      </button>
                    </li>
                  ))}
                  {noMatch && (
                    <li className={`px-3 py-2.5 text-sm text-gray-500 ${W.txSecond} flex items-center gap-2`}>
                      <span className="italic">No match for &ldquo;{form.search.trim()}&rdquo;</span>
                      <button
                        type="button"
                        onMouseDown={e => { e.preventDefault(); setInputFocused(false); setNewIngForm({ category: 'other', dimension: 'count', unit: '' }); }}
                        className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline whitespace-nowrap"
                      >
                        + Create it
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>

            {newIngForm && (
              <div className={`p-3 bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-700/30 rounded-xl space-y-2`}>
                <p className="text-xs font-semibold text-indigo-800 dark:text-indigo-300">
                  Creating &ldquo;{form.search.trim()}&rdquo; as new ingredient
                </p>
                <div className="flex gap-2">
                  {['category', 'dimension'].map(field => (
                    <div key={field} className="flex-1">
                      <label className={`block text-xs text-gray-500 ${W.txSecond} mb-1 capitalize`}>{field}</label>
                      <select
                        value={(newIngForm as any)[field]}
                        onChange={e => setNewIngForm(f => f && ({ ...f, [field]: e.target.value }))}
                        className={`w-full px-2 py-1.5 text-sm border border-gray-300 ${W.border} rounded-lg focus:outline-none dark:bg-zinc-800 ${W.txPrimary}`}
                      >
                        {field === 'category'
                          ? ['produce','dairy','meat','fish','pantry','spice','bakery','other'].map(c => <option key={c} value={c}>{c}</option>)
                          : ['mass','volume','count','pack'].map(d => <option key={d} value={d}>{d}</option>)
                        }
                      </select>
                    </div>
                  ))}
                  <div className="flex-1">
                    <label className={`block text-xs text-gray-500 ${W.txSecond} mb-1`}>Unit</label>
                    <input
                      type="text"
                      value={newIngForm.unit}
                      onChange={e => setNewIngForm(f => f && ({ ...f, unit: e.target.value }))}
                      placeholder="g / ml / unit"
                      className={`w-full px-2 py-1.5 text-sm border border-gray-300 ${W.border} rounded-lg focus:outline-none dark:bg-zinc-800 ${W.txPrimary} dark:placeholder-zinc-500`}
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
                          canonical_name: name, category: newIngForm.category,
                          dimension: newIngForm.dimension, typical_unit: newIngForm.unit || 'unit',
                        });
                        selectIngredient(ing);
                        setNewIngForm(null);
                        setForm(f => ({ ...f, unit: ing.typical_unit || '' }));
                      } catch (err: any) { setFormError(err.message ?? 'Failed to create ingredient'); }
                    }}
                    disabled={createIngredientMutation.isPending}
                    className="flex-1 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {createIngredientMutation.isPending ? 'Creating…' : 'Create & Select'}
                  </button>
                  <button type="button" onClick={() => setNewIngForm(null)} className={`px-3 py-1.5 text-xs text-gray-500 ${W.txSecond} hover:text-gray-700 dark:hover:text-zinc-100`}>Cancel</button>
                </div>
              </div>
            )}

            {/* Qty + Unit */}
            <div className="flex gap-3">
              {(['Quantity', 'Unit'] as const).map((label) => (
                <div key={label} className="flex-1">
                  <label className={`block text-xs font-semibold text-gray-500 ${W.txSecond} mb-1.5`}>{label}</label>
                  {label === 'Quantity' ? (
                    <input
                      type="number" min="0" step="any"
                      value={form.quantity}
                      onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                      placeholder="1"
                      className={`w-full px-3 py-2.5 text-sm border border-gray-200 ${W.border} rounded-xl focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-400 dark:bg-zinc-800 ${W.txPrimary} dark:placeholder-zinc-500`}
                    />
                  ) : (
                    <input
                      type="text"
                      value={form.unit}
                      onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                      placeholder="g / ml / unit"
                      className={`w-full px-3 py-2.5 text-sm border border-gray-200 ${W.border} rounded-xl focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-400 dark:bg-zinc-800 ${W.txPrimary} dark:placeholder-zinc-500`}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Expiry date */}
            <div>
              <label className={`block text-xs font-semibold text-gray-500 ${W.txSecond} mb-1.5`}>
                Best-before date <span className={`font-normal text-gray-400 ${W.txMuted}`}>(optional)</span>
              </label>
              <input
                type="date"
                value={form.expires_at}
                onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
                min={new Date().toISOString().split('T')[0]}
                className={`w-full px-3 py-2.5 text-sm border border-gray-200 ${W.border} rounded-xl focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-400 dark:bg-zinc-800 ${W.txPrimary}`}
              />
              {expiryPreview && (
                <p className={`text-xs mt-1.5 flex items-center gap-1.5 ${expiryPreview.warn ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-zinc-500'}`}>
                  {expiryPreview.warn && (
                    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
                    </svg>
                  )}
                  {expiryPreview.label}
                </p>
              )}
            </div>

            {/* Confidence info */}
            <div className={`flex items-start gap-2.5 p-3 bg-gray-50 dark:bg-zinc-800 rounded-xl border border-gray-100 ${W.borderLo}`}>
              <svg className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-gray-400 ${W.txMuted}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/>
              </svg>
              <p className={`text-[11px] text-gray-500 ${W.txSecond} leading-relaxed`}>
                Confirming sets confidence to 100%. It decays daily until you confirm again — this is how WhatsForTea knows what&apos;s still in your cupboard.
              </p>
            </div>

            {formError && <p className="text-xs text-red-500 dark:text-red-400">{formError}</p>}

            <button
              type="submit"
              disabled={upsertMutation.isPending}
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-sm rounded-2xl disabled:opacity-50 transition-all active:scale-[0.98] shadow-lg shadow-indigo-600/25"
            >
              {upsertMutation.isPending ? 'Adding…' : 'Add to Pantry'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function PantryPage() {
  const { data: items, isLoading, isError, refetch } = useAvailable();
  const { data: ingredients = [] } = useIngredients();

  const confirmMutation     = useConfirmPantryItem();
  const upsertMutation      = useUpsertPantryItem();
  const deleteMutation      = useDeletePantryItem();
  const bulkConfirmMutation = useBulkConfirmPantry();
  const createIngredientMutation = useCreateIngredient();

  const [showAddSheet, setShowAddSheet]   = useState(false);
  const [showScanner, setShowScanner]     = useState(false);
  const [prefillIngredient, setPrefillIngredient] = useState<Ingredient | null>(null);
  const [editingId, setEditingId]         = useState<string | null>(null);
  const [editQty, setEditQty]             = useState('');
  const [searchQuery, setSearchQuery]     = useState('');
  const [activeFilter, setActiveFilter]   = useState<string | null>(null);
  const [openCategories, setOpenCategories] = useState<Set<string>>(() => new Set(CATEGORY_ORDER));

  // ── derived data ─────────────────────────────────────────────────────────────

  const sorted = useMemo(() => {
    if (!items) return [];
    return [...items].sort((a, b) => {
      const aExp = a.expires_at ? daysUntil(a.expires_at) <= 3 : false;
      const bExp = b.expires_at ? daysUntil(b.expires_at) <= 3 : false;
      if (aExp !== bExp) return aExp ? -1 : 1;
      return a.confidence - b.confidence;
    });
  }, [items]);

  const expiringSoon = useMemo(
    () => sorted.filter(i => i.expires_at && daysUntil(i.expires_at) <= 3),
    [sorted],
  );
  const expiringSoonIds = useMemo(() => new Set(expiringSoon.map(i => i.pantry_item_id)), [expiringSoon]);

  const needsConfirming = useMemo(
    () => sorted.filter(i => !expiringSoonIds.has(i.pantry_item_id) && i.confidence < 0.4),
    [sorted, expiringSoonIds],
  );
  const needsConfirmingIds = useMemo(() => new Set(needsConfirming.map(i => i.pantry_item_id)), [needsConfirming]);

  const attentionIds = useMemo(
    () => new Set([...expiringSoonIds, ...needsConfirmingIds]),
    [expiringSoonIds, needsConfirmingIds],
  );

  const categorySorted = useMemo(
    () => sorted.filter(i => !attentionIds.has(i.pantry_item_id)),
    [sorted, attentionIds],
  );

  const categoryGroups = useMemo(() => {
    const map = new Map<string, PantryAvailability[]>();
    for (const item of categorySorted) {
      const cat = item.ingredient.category;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    const ordered = new Map<string, PantryAvailability[]>();
    for (const cat of CATEGORY_ORDER) { if (map.has(cat)) ordered.set(cat, map.get(cat)!); }
    for (const [cat, v] of map) { if (!ordered.has(cat)) ordered.set(cat, v); }
    return ordered;
  }, [categorySorted]);

  const presentCategories = useMemo(() => [...categoryGroups.keys()], [categoryGroups]);

  const isFiltering = searchQuery.trim().length > 0 || activeFilter !== null;
  const filteredItems = useMemo(() => {
    if (!isFiltering) return null;
    const q = searchQuery.trim().toLowerCase();
    return sorted.filter(item => {
      const matchesQuery = !q || item.ingredient.canonical_name.toLowerCase().includes(q);
      if (!matchesQuery) return false;
      if (!activeFilter) return true;
      if (activeFilter === 'attention') return attentionIds.has(item.pantry_item_id);
      if (activeFilter === 'expiring')  return expiringSoonIds.has(item.pantry_item_id);
      return item.ingredient.category === activeFilter;
    });
  }, [isFiltering, searchQuery, activeFilter, sorted, attentionIds, expiringSoonIds]);

  // ── handlers ─────────────────────────────────────────────────────────────────

  const handleUpdateQty = useCallback(async (item: PantryAvailability) => {
    const qty = parseFloat(editQty);
    if (isNaN(qty) || qty < 0) { setEditingId(null); return; }
    await upsertMutation.mutateAsync({ ingredient_id: item.ingredient.id, quantity: qty, unit: item.unit });
    setEditingId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editQty, upsertMutation.mutateAsync]);

  async function handleBulkConfirm() {
    if (!needsConfirming.length) return;
    await bulkConfirmMutation.mutateAsync(
      needsConfirming.map(i => ({ ingredient_id: i.ingredient.id, quantity: i.total_quantity, unit: i.unit })),
    );
  }

  function handleScanResolved(data: BarcodeLookupResponse) {
    setShowScanner(false);
    if (data.ingredient_id) {
      const matched = ingredients.find(i => i.id === data.ingredient_id);
      if (matched) setPrefillIngredient(matched);
    }
    setShowAddSheet(true);
  }

  function toggleCategory(cat: string) {
    setOpenCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  const sharedRowProps = { editingId, editQty, setEditQty, setEditingId, onSaveQty: handleUpdateQty };

  // ── derived counts ────────────────────────────────────────────────────────────

  const totalItems    = sorted.length;
  const expiringCount = expiringSoon.length;
  const lowStockCount = sorted.filter(i => i.confidence < 0.4).length;
  const hasAttention  = expiringSoon.length > 0 || needsConfirming.length > 0;

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <main className="px-4 pt-6 pb-6 mx-auto max-w-lg lg:max-w-5xl">

      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className={`text-2xl font-extrabold tracking-tight text-gray-900 ${W.txPrimary}`}>My Pantry</h1>
          {!isLoading && !isError && totalItems > 0 && (
            <p className={`text-xs text-gray-400 ${W.txMuted} mt-0.5`}>Updated just now</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowScanner(true)}
            title="Scan barcode"
            className={`w-10 h-10 flex items-center justify-center bg-gray-100 dark:bg-zinc-800 border border-gray-200 ${W.border} text-gray-600 dark:text-zinc-400 rounded-[13px] hover:bg-gray-200 ${W.hoverHi} transition-colors`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
            </svg>
          </button>
          <button
            onClick={() => setShowAddSheet(true)}
            className="h-10 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[13px] text-sm font-extrabold transition-all active:scale-95 shadow-md shadow-indigo-600/25"
          >
            + Add
          </button>
        </div>
      </div>

      {/* ── Skeleton ── */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`h-16 bg-gray-200 dark:bg-zinc-900 rounded-2xl animate-pulse`} />
          ))}
        </div>
      )}

      {/* ── Error ── */}
      {isError && (
        <div className="text-center py-12">
          <p className={`text-gray-500 ${W.txSecond} mb-3`}>Failed to load pantry</p>
          <button onClick={() => refetch()} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium">Retry</button>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {/* ── Empty state ── */}
          {totalItems === 0 && (
            <div className="text-center py-16 px-6">
              <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-indigo-100 dark:border-indigo-900/40 shadow-lg mx-auto mb-4">
                <img src="/teabot-chef.png" alt="TeaBot" className="w-full h-full object-cover" />
              </div>
              <p className={`font-semibold text-gray-700 ${W.txPrimary}`}>Your pantry is empty</p>
              <p className={`text-sm text-gray-500 ${W.txSecond} mt-1 max-w-[240px] mx-auto`}>
                Add some items so I can suggest what to cook tonight.
              </p>
              <button
                onClick={() => setShowAddSheet(true)}
                className="mt-5 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-2xl transition-colors"
              >
                Add first item
              </button>
            </div>
          )}

          {totalItems > 0 && (
            <>
              {/* ── Stat strip ── */}
              <div className="flex gap-2.5 mb-5">
                <div className={`flex-1 bg-gray-100 dark:bg-zinc-900 border border-gray-200 ${W.border} rounded-2xl px-3 py-2.5`}>
                  <div className={`text-xl font-extrabold text-gray-900 ${W.txPrimary} leading-none`}>{totalItems}</div>
                  <div className={`text-[10px] font-medium text-gray-500 ${W.txSecond} mt-0.5`}>items</div>
                </div>
                <div className={`flex-1 rounded-2xl px-3 py-2.5 border ${
                  expiringCount > 0
                    ? 'bg-amber-50 dark:bg-amber-950/15 border-amber-200 dark:border-amber-700/25'
                    : `bg-gray-100 dark:bg-zinc-900 border-gray-200 ${W.border}`
                }`}>
                  <div className={`text-xl font-extrabold leading-none ${expiringCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-zinc-500'}`}>{expiringCount}</div>
                  <div className={`text-[10px] font-medium text-gray-500 ${W.txSecond} mt-0.5`}>expiring</div>
                </div>
                <div className={`flex-1 rounded-2xl px-3 py-2.5 border ${
                  lowStockCount > 0
                    ? 'bg-red-50 dark:bg-red-950/15 border-red-200 dark:border-red-800/25'
                    : `bg-gray-100 dark:bg-zinc-900 border-gray-200 ${W.border}`
                }`}>
                  <div className={`text-xl font-extrabold leading-none ${lowStockCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-zinc-500'}`}>{lowStockCount}</div>
                  <div className={`text-[10px] font-medium text-gray-500 ${W.txSecond} mt-0.5`}>low stock</div>
                </div>
              </div>

              {/* ── Search + filter chips ── */}
              <div className="mb-4 space-y-2.5">
                <div className={`flex items-center gap-2.5 bg-gray-100 dark:bg-zinc-900 border border-gray-200 ${W.border} rounded-2xl px-3 py-2.5`}>
                  <svg className={`w-4 h-4 text-gray-400 dark:text-zinc-500 flex-shrink-0`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 0z"/>
                  </svg>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => { setSearchQuery(e.target.value); setActiveFilter(null); }}
                    placeholder="Search pantry…"
                    className={`flex-1 bg-transparent text-sm text-gray-800 ${W.txPrimary} placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none`}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className={`text-gray-400 ${W.txMuted} hover:text-gray-600 dark:hover:text-zinc-100`}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  )}
                </div>

                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
                  <button
                    onClick={() => { setActiveFilter(null); setSearchQuery(''); }}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                      !activeFilter && !searchQuery
                        ? 'bg-gray-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-gray-900 dark:border-zinc-100'
                        : `bg-transparent text-gray-500 ${W.txSecond} border-gray-200 ${W.border} hover:border-gray-400 dark:hover:border-zinc-500`
                    }`}
                  >
                    All {totalItems}
                  </button>
                  {(expiringCount > 0 || lowStockCount > 0) && (
                    <button
                      onClick={() => { setActiveFilter('attention'); setSearchQuery(''); }}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                        activeFilter === 'attention'
                          ? 'bg-red-600 text-white border-red-600'
                          : `bg-transparent text-gray-500 ${W.txSecond} border-gray-200 ${W.border} hover:border-red-400/60 dark:hover:border-red-700/60`
                      }`}
                    >
                      🔴 Attention {expiringCount + lowStockCount}
                    </button>
                  )}
                  {expiringCount > 0 && (
                    <button
                      onClick={() => { setActiveFilter('expiring'); setSearchQuery(''); }}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                        activeFilter === 'expiring'
                          ? 'bg-amber-500 text-white border-amber-500'
                          : `bg-transparent text-gray-500 ${W.txSecond} border-gray-200 ${W.border} hover:border-amber-400/60 dark:hover:border-amber-700/60`
                      }`}
                    >
                      ⏰ Expiring {expiringCount}
                    </button>
                  )}
                  {presentCategories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => { setActiveFilter(cat); setSearchQuery(''); }}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors capitalize ${
                        activeFilter === cat
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : `bg-transparent text-gray-500 ${W.txSecond} border-gray-200 ${W.border} hover:border-indigo-400/60 dark:hover:border-indigo-700/60`
                      }`}
                    >
                      {catEmoji(cat)} {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Alert bar (expiring soon) ── */}
              {expiringCount > 0 && !isFiltering && (
                <div className="mb-4 flex items-center gap-3 px-3.5 py-2.5 bg-amber-50 dark:bg-amber-950/15 border border-amber-200 dark:border-amber-700/25 rounded-[14px]">
                  <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
                  </svg>
                  <span className="flex-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                    {expiringCount} item{expiringCount !== 1 ? 's' : ''} expiring in ≤ 3 days
                  </span>
                  <button
                    onClick={() => setActiveFilter('expiring')}
                    className="text-[11px] font-extrabold text-amber-700 dark:text-amber-400 hover:underline whitespace-nowrap"
                  >
                    Show →
                  </button>
                </div>
              )}

              {/* ── FILTERED FLAT LIST (Phone B) ── */}
              {isFiltering && filteredItems !== null && (
                <>
                  {filteredItems.length === 0 ? (
                    <div className={`text-center py-10 text-gray-500 ${W.txSecond} text-sm`}>
                      No items match &ldquo;{searchQuery || activeFilter}&rdquo;
                    </div>
                  ) : (() => {
                    const attentionItems = filteredItems.filter(i => attentionIds.has(i.pantry_item_id));
                    const stockedItems   = filteredItems.filter(i => !attentionIds.has(i.pantry_item_id));
                    const hasBoth = attentionItems.length > 0 && stockedItems.length > 0;

                    function Divider({ label, color }: { label: string; color: 'red' | 'green' }) {
                      return (
                        <div className={`flex items-center gap-2.5 px-4 py-2 bg-gray-50 dark:bg-zinc-900`}>
                          <div className="flex-1 h-px bg-gray-100 dark:bg-zinc-800" />
                          <span className={`text-[10px] font-extrabold uppercase tracking-widest ${
                            color === 'red' ? 'text-red-500 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                          }`}>{label}</span>
                          <div className="flex-1 h-px bg-gray-100 dark:bg-zinc-800" />
                        </div>
                      );
                    }

                    return (
                      <div className={`bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 ${W.borderLo} overflow-hidden shadow-sm`}>
                        {hasBoth && <Divider label="Needs attention" color="red" />}
                        {attentionItems.map(item => (
                          <PantryRow
                            key={item.pantry_item_id}
                            item={item}
                            {...sharedRowProps}
                            onConfirm={() => confirmMutation.mutate(item.pantry_item_id)}
                            onDelete={() => deleteMutation.mutate(item.pantry_item_id)}
                            confirmPending={confirmMutation.isPending}
                            deletePending={deleteMutation.isPending}
                            showStripe
                          />
                        ))}
                        {hasBoth && <Divider label="Well stocked" color="green" />}
                        {stockedItems.map(item => (
                          <PantryRow
                            key={item.pantry_item_id}
                            item={item}
                            {...sharedRowProps}
                            onConfirm={() => confirmMutation.mutate(item.pantry_item_id)}
                            onDelete={() => deleteMutation.mutate(item.pantry_item_id)}
                            confirmPending={confirmMutation.isPending}
                            deletePending={deleteMutation.isPending}
                            showStripe
                          />
                        ))}
                        {/* Swipe hint footer */}
                        <div className={`flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-zinc-900 border-t border-gray-100 ${W.borderLo}`}>
                          <svg className={`w-3.5 h-3.5 text-gray-400 ${W.txMuted} flex-shrink-0`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
                          </svg>
                          <span className={`text-[11px] text-gray-400 ${W.txMuted}`}>Swipe left to edit or remove</span>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}

              {/* ── FULL SECTIONED VIEW ── */}
              {!isFiltering && (
                /* Desktop: 2-col grid when attention items exist; full-width otherwise */
                <div className={hasAttention ? 'lg:grid lg:grid-cols-5 lg:gap-6 lg:items-start' : ''}>

                  {/* ── Left column: Use It Up + Needs Confirming ── */}
                  {hasAttention && (
                    <div className="lg:col-span-2 space-y-5 mb-5 lg:mb-0">

                      {expiringSoon.length > 0 && (
                        <section>
                          <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-1.5">
                              <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
                              </svg>
                              <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400">Use It Up</span>
                            </div>
                            <button
                              onClick={() => setActiveFilter('expiring')}
                              className={`text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline`}
                            >
                              See all
                            </button>
                          </div>
                          {/* Horizontal scroll on mobile, wrap on desktop left col */}
                          <div className="flex gap-3 overflow-x-auto lg:flex-wrap lg:overflow-x-visible no-scrollbar pb-1 lg:pb-0">
                            {expiringSoon.map(item => (
                              <UseItUpCard
                                key={item.pantry_item_id}
                                item={item}
                                onConfirm={() => confirmMutation.mutate(item.pantry_item_id)}
                                onRemove={() => deleteMutation.mutate(item.pantry_item_id)}
                                confirmPending={confirmMutation.isPending}
                                deletePending={deleteMutation.isPending}
                              />
                            ))}
                          </div>
                        </section>
                      )}

                      {needsConfirming.length > 0 && (
                        <section>
                          <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(248,113,113,0.6)]" />
                              <span className="text-[11px] font-extrabold uppercase tracking-wider text-red-600 dark:text-red-400">Needs Confirming</span>
                            </div>
                            <button
                              onClick={handleBulkConfirm}
                              disabled={bulkConfirmMutation.isPending}
                              className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
                            >
                              {bulkConfirmMutation.isPending ? 'Confirming…' : 'Confirm all'}
                            </button>
                          </div>
                          <div className={`bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 ${W.borderLo} overflow-hidden shadow-sm`}>
                            {needsConfirming.map(item => (
                              <PantryRow
                                key={item.pantry_item_id}
                                item={item}
                                {...sharedRowProps}
                                onConfirm={() => confirmMutation.mutate(item.pantry_item_id)}
                                onDelete={() => deleteMutation.mutate(item.pantry_item_id)}
                                confirmPending={confirmMutation.isPending}
                                deletePending={deleteMutation.isPending}
                              />
                            ))}
                          </div>
                        </section>
                      )}
                    </div>
                  )}

                  {/* ── Right column (or full-width): Category sections ── */}
                  <div className={`${hasAttention ? 'lg:col-span-3' : ''} space-y-3`}>
                    {[...categoryGroups.entries()].map(([cat, catItems]) => {
                      const isOpen = openCategories.has(cat);
                      return (
                        <section key={cat}>
                          <button
                            onClick={() => toggleCategory(cat)}
                            className={`w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-zinc-900 border border-gray-100 ${W.borderLo} rounded-2xl hover:bg-gray-100 ${W.hoverRaised} transition-colors`}
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="text-lg leading-none">{catEmoji(cat)}</span>
                              <span className={`text-sm font-bold text-gray-800 ${W.txPrimary} capitalize`}>{cat}</span>
                              <span className={`text-xs text-gray-400 ${W.txMuted}`}>{catItems.length} item{catItems.length !== 1 ? 's' : ''}</span>
                            </div>
                            <svg
                              className={`w-4 h-4 text-gray-400 dark:text-zinc-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/>
                            </svg>
                          </button>

                          {isOpen && (
                            <div className={`mt-1 bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 ${W.borderLo} overflow-hidden shadow-sm`}>
                              {catItems.map(item => (
                                <PantryRow
                                  key={item.pantry_item_id}
                                  item={item}
                                  {...sharedRowProps}
                                  onConfirm={() => confirmMutation.mutate(item.pantry_item_id)}
                                  onDelete={() => deleteMutation.mutate(item.pantry_item_id)}
                                  confirmPending={confirmMutation.isPending}
                                  deletePending={deleteMutation.isPending}
                                  showStripe
                                />
                              ))}
                            </div>
                          )}
                        </section>
                      );
                    })}

                    {categoryGroups.size === 0 && attentionIds.size > 0 && (
                      <p className={`text-center text-xs text-gray-400 ${W.txMuted} py-4`}>
                        All items are in the sections above
                      </p>
                    )}
                  </div>

                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Barcode scanner modal ── */}
      {showScanner && (
        <BarcodeScanner
          onResolved={handleScanResolved}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* ── Add item bottom sheet ── */}
      <AddItemSheet
        open={showAddSheet}
        onClose={() => setShowAddSheet(false)}
        ingredients={ingredients}
        upsertMutation={upsertMutation}
        createIngredientMutation={createIngredientMutation}
        prefillIngredient={prefillIngredient}
        onClearPrefill={() => setPrefillIngredient(null)}
      />
    </main>
  );
}
