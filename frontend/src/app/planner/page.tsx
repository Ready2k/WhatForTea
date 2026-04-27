'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useWeekPlan, useRecipes, useSetWeekPlan, useShoppingList, useBulkConfirmPantry } from '@/lib/hooks';
import { Wand2, Users, Clock, GripVertical } from 'lucide-react';
import { autoFillWeek, type AutoFillEntry, fetchShoppingItems, addShoppingItem, patchShoppingItem, deleteShoppingItem, clearDoneShoppingItems, type ShoppingItem } from '@/lib/api';
import type { RecipeSummary, ShoppingListItem } from '@/lib/types';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MOOD_OPTIONS = ['Comfort', 'Quick', 'Light', 'Vegetarian', 'Spicy', 'Family', 'Fancy', 'Healthy', 'Indulgent'];

type Tab = 'week' | 'shopping';

function getMondayOf(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(d.getDate() + n);
  return r;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatWeekRange(monday: Date): string {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const month = sunday.toLocaleDateString('en-GB', { month: 'short' });
  if (sameMonth) {
    return `${monday.getDate()}–${sunday.getDate()} ${month}`;
  }
  return `${monday.getDate()} ${monday.toLocaleDateString('en-GB', { month: 'short' })} – ${sunday.getDate()} ${month}`;
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}

// Extracted so useDraggable / useDroppable hooks can be called at the top level of a component
function DaySlot({
  dayIdx,
  dayDate,
  isToday,
  isPast,
  recipeId,
  recipeSummary,
  servings,
  anyDragActive,
  showPickerFor,
  showServingPickerFor,
  recipes,
  onSetDay,
  onSetServings,
  onShowPicker,
  onShowServingPicker,
}: {
  dayIdx: number;
  dayDate: Date;
  isToday: boolean;
  isPast: boolean;
  recipeId: string | null;
  recipeSummary: RecipeSummary | undefined;
  servings: number | null;
  anyDragActive: boolean;
  showPickerFor: number | null;
  showServingPickerFor: number | null;
  recipes: RecipeSummary[] | undefined;
  onSetDay: (recipeId: string | null) => void;
  onSetServings: (servings: number | null) => void;
  onShowPicker: (idx: number | null) => void;
  onShowServingPicker: (idx: number | null) => void;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: dayIdx,
    disabled: !recipeId,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: dayIdx });

  const setRef = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  const highlightDrop = isOver && anyDragActive && !isDragging;

  return (
    <div
      ref={setRef}
      className={`rounded-2xl border p-3 shadow-sm transition-all ${
        isDragging
          ? 'opacity-30'
          : highlightDrop
          ? 'ring-2 ring-brand-accent ring-offset-1 border-brand-accent/50 dark:border-brand-accent/60 bg-brand-accent/10 dark:bg-brand-accent/20'
          : isToday
          ? 'bg-brand-herb/10 dark:bg-brand-herb/20 border-brand-herb/30 dark:border-brand-herb/50'
          : 'bg-brand-card dark:bg-brand-primary border-brand-linen dark:border-brand-primary-hover/50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        {/* Drag handle — only when a recipe is assigned */}
        {recipeId ? (
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing touch-none flex-shrink-0 text-brand-linen dark:text-brand-primary-hover hover:text-brand-muted/40 dark:hover:text-brand-secondary/40 p-0.5"
            aria-label="Drag to reschedule"
          >
            <GripVertical className="w-4 h-4" />
          </div>
        ) : (
          <div className="w-5 flex-shrink-0" />
        )}

        {/* Day label */}
        <div className="flex flex-col w-16 flex-shrink-0">
          <span
            className={`text-sm font-medium ${
              isToday
                ? 'text-brand-herb'
                : isPast
                ? 'text-brand-muted/40 dark:text-brand-secondary/40'
                : 'text-brand-muted dark:text-brand-secondary'
            }`}
          >
            {formatDayLabel(dayDate)}
          </span>
          {isToday && (
            <span className="text-[10px] font-semibold text-brand-herb uppercase tracking-wide">
              Today
            </span>
          )}
        </div>

        {/* Recipe content or add button */}
        {recipeSummary ? (
          <div className="flex-1 flex items-center justify-between min-w-0">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand-ink dark:text-brand-background truncate">{recipeSummary.title}</p>
              <div className="flex items-center gap-2 mt-0.5">
                {recipeSummary.cooking_time_mins && (
                  <p className="text-xs text-brand-muted/60 dark:text-brand-secondary/60 flex items-center gap-0.5">
                    <Clock className="w-3 h-3" />
                    {recipeSummary.cooking_time_mins} min
                  </p>
                )}
                <span className="text-brand-linen dark:text-brand-primary-hover">•</span>
                <button
                  onClick={() => onShowServingPicker(showServingPickerFor === dayIdx ? null : dayIdx)}
                  className="text-xs font-medium text-brand-herb hover:text-brand-herb/80 bg-brand-herb/10 dark:bg-brand-herb/20 px-1.5 py-0.5 rounded flex items-center gap-1"
                >
                  <Users className="w-3 h-3 inline mr-0.5" />
                  {servings || 'Default'}
                </button>
              </div>
            </div>
            <div className="flex gap-3 ml-2">
              <button
                onClick={() => onShowPicker(dayIdx)}
                className="text-xs text-brand-muted dark:text-brand-secondary hover:text-brand-primary transition-colors"
              >
                Change
              </button>
              <button
                onClick={() => { onSetDay(null); onSetServings(null); }}
                className="text-xs text-brand-tomato/60 hover:text-brand-tomato transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => onShowPicker(dayIdx)}
            className="flex-1 py-2 border-2 border-dashed border-brand-linen dark:border-brand-primary-hover/50 text-sm text-brand-muted dark:text-brand-secondary rounded-xl hover:border-brand-accent/50 dark:hover:border-brand-accent/70 hover:text-brand-primary transition-colors text-center"
          >
            + Add recipe
          </button>
        )}
      </div>

      {/* Serving picker */}
      {showServingPickerFor === dayIdx && (
        <div className="mt-3 flex items-center gap-1.5 border-t border-brand-linen/30 dark:border-brand-primary-hover/30 pt-3">
          <span className="text-xs text-brand-muted/60 dark:text-brand-secondary/60 mr-1">Servings:</span>
          {[1, 2, 3, 4, 6, 8].map((n) => (
            <button
              key={n}
              onClick={() => { onSetServings(n); onShowServingPicker(null); }}
              className={`w-7 h-7 flex items-center justify-center text-xs font-semibold rounded-lg transition-colors ${
                servings === n
                  ? 'bg-brand-primary text-brand-background shadow-sm'
                  : 'bg-brand-linen/20 dark:bg-brand-primary-hover text-brand-muted dark:text-brand-secondary hover:bg-brand-linen/40 dark:hover:bg-brand-primary'
              }`}
            >
              {n}
            </button>
          ))}
          <button
            onClick={() => { onSetServings(null); onShowServingPicker(null); }}
            className="ml-auto text-xs text-brand-muted/40 hover:text-brand-ink dark:text-brand-secondary/40 dark:hover:text-brand-background transition-colors"
          >
            Default
          </button>
        </div>
      )}

      {/* Recipe picker */}
      {showPickerFor === dayIdx && (
        <div className="mt-3 border-t border-brand-linen/30 dark:border-brand-primary-hover/30 pt-3">
          <div className="max-h-40 overflow-y-auto space-y-1">
            {recipes?.map((r) => (
              <button
                key={r.id}
                onClick={() => { onSetDay(r.id); onSetServings(2); onShowPicker(null); }}
                className="w-full text-left px-3 py-2 text-sm text-brand-ink dark:text-brand-background hover:bg-brand-linen/10 dark:hover:bg-brand-primary-hover/30 rounded-lg transition-colors"
              >
                {r.title}
                {r.cooking_time_mins && (
                  <span className="text-brand-muted/60 dark:text-brand-secondary/60 ml-2">({r.cooking_time_mins} min)</span>
                )}
              </button>
            ))}
            {(!recipes || recipes.length === 0) && (
              <p className="text-xs text-brand-muted/40 dark:text-brand-secondary/40 px-2">No recipes available</p>
            )}
          </div>
          <button
            onClick={() => onShowPicker(null)}
            className="mt-2 text-xs text-brand-muted/40 hover:text-brand-ink dark:text-brand-secondary/40 dark:hover:text-brand-background transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default function PlannerPage() {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const thisMonday = useMemo(() => getMondayOf(today), [today]);
  const nextMonday = useMemo(() => addDays(thisMonday, 7), [thisMonday]);
  const weeks = useMemo(() => [thisMonday, nextMonday], [thisMonday, nextMonday]);

  const [weekOffset, setWeekOffset] = useState(0);
  const selectedMonday = weeks[weekOffset];
  const weekStart = toDateStr(selectedMonday);

  const [activeTab, setActiveTab] = useState<Tab>('week');
  const [dayPlan, setDayPlan] = useState<Record<string, Record<number, string | null>>>({});
  const [servingsPlan, setServingsPlan] = useState<Record<string, Record<number, number | null>>>({});
  const [showPickerFor, setShowPickerFor] = useState<number | null>(null);
  const [showServingPickerFor, setShowServingPickerFor] = useState<number | null>(null);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [showAutoFill, setShowAutoFill] = useState(false);
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);
  const [autoFillServings, setAutoFillServings] = useState(2);
  const [maxCookTime, setMaxCookTime] = useState<number | ''>('');
  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [autoFillError, setAutoFillError] = useState<string | null>(null);
  const [activeDragDay, setActiveDragDay] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const { data: plan, isLoading: planLoading } = useWeekPlan(weekStart);
  const { data: recipes } = useRecipes();
  const setWeekPlanMutation = useSetWeekPlan();
  const { data: shoppingList, isLoading: shopLoading, isError: shopError, refetch: refetchShopping } = useShoppingList(weekStart);
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
  const [manualUnit] = useState('count');

  const handleAddManual = () => {
    const name = manualInput.trim();
    if (!name) return;
    addManualMutation.mutate({ raw_name: name, quantity: parseFloat(manualQty) || 1, unit: manualUnit || 'count' });
    setManualInput('');
    setManualQty('1');
  };

  const pendingManual = manualItems.filter(i => !i.done);
  const doneManual = manualItems.filter(i => i.done);

  const localDayPlan = dayPlan[weekStart] ?? {};
  const localServingsPlan = servingsPlan[weekStart] ?? {};

  const resolvedPlan: Record<number, string | null> = {};
  const resolvedServings: Record<number, number | null> = {};
  for (let d = 0; d < 7; d++) {
    if (d in localDayPlan) {
      resolvedPlan[d] = localDayPlan[d];
      resolvedServings[d] = localServingsPlan[d] ?? null;
    } else {
      const entry = plan?.entries.find((e) => e.day_of_week === d);
      resolvedPlan[d] = entry?.recipe_id ?? null;
      resolvedServings[d] = entry?.servings ?? null;
    }
  }

  function setLocalDay(dayIdx: number, recipeId: string | null) {
    setDayPlan(p => ({ ...p, [weekStart]: { ...(p[weekStart] ?? {}), [dayIdx]: recipeId } }));
  }
  function setLocalServings(dayIdx: number, servings: number | null) {
    setServingsPlan(p => ({ ...p, [weekStart]: { ...(p[weekStart] ?? {}), [dayIdx]: servings } }));
  }

  function getRecipeSummary(recipeId: string | null): RecipeSummary | undefined {
    if (!recipeId) return undefined;
    return recipes?.find((r) => r.id === recipeId);
  }

  function handleDragStart({ active }: DragStartEvent) {
    setActiveDragDay(Number(active.id));
    setShowPickerFor(null);
    setShowServingPickerFor(null);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveDragDay(null);
    if (!over || active.id === over.id) return;
    const from = Number(active.id);
    const to = Number(over.id);
    const fromRecipe = resolvedPlan[from] ?? null;
    const toRecipe = resolvedPlan[to] ?? null;
    const fromServings = resolvedServings[from] ?? null;
    const toServings = resolvedServings[to] ?? null;
    setLocalDay(from, toRecipe);
    setLocalDay(to, fromRecipe);
    setLocalServings(from, toServings);
    setLocalServings(to, fromServings);
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
      const newDays: Record<number, string | null> = {};
      const newSrv: Record<number, number | null> = {};
      entries.forEach((e) => {
        newDays[e.day_of_week] = e.recipe_id;
        newSrv[e.day_of_week] = e.servings;
      });
      setDayPlan(p => ({ ...p, [weekStart]: newDays }));
      setServingsPlan(p => ({ ...p, [weekStart]: newSrv }));
      setShowAutoFill(false);
    } catch (err: unknown) {
      setAutoFillError(err instanceof Error ? err.message : 'Auto-fill failed');
    } finally {
      setAutoFillLoading(false);
    }
  }

  async function handleSavePlan() {
    const entries = Object.entries(resolvedPlan)
      .filter(([, recipeId]) => recipeId !== null)
      .map(([dayStr, recipeId]) => {
        const d = parseInt(dayStr);
        return { day_of_week: d, recipe_id: recipeId as string, servings: resolvedServings[d] ?? undefined };
      });
    try {
      await setWeekPlanMutation.mutateAsync({ week_start: weekStart, entries });
      setDayPlan(p => ({ ...p, [weekStart]: {} }));
      setServingsPlan(p => ({ ...p, [weekStart]: {} }));
    } catch { /* shown via mutation state */ }
  }

  const allItems = useMemo<ShoppingListItem[]>(() => {
    if (!shoppingList) return [];
    return Object.values(shoppingList.zones).flat();
  }, [shoppingList]);

  function toggleItem(key: string) {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function itemKey(item: ShoppingListItem) {
    return item.ingredient_id ?? item.canonical_name;
  }

  async function handleMarkCheckedAsBought() {
    const toConfirm = allItems
      .filter((item) => item.ingredient_id && checkedItems.has(itemKey(item)))
      .map((item) => ({ ingredient_id: item.ingredient_id!, quantity: item.rounded_quantity, unit: item.rounded_unit }));
    if (toConfirm.length > 0) {
      try { await bulkConfirmMutation.mutateAsync(toConfirm); } catch { /* silent */ }
    }
  }

  async function handleMarkAllAsBought() {
    setCheckedItems(new Set(allItems.map(itemKey)));
    const toConfirm = allItems
      .filter((item) => item.ingredient_id)
      .map((item) => ({ ingredient_id: item.ingredient_id!, quantity: item.rounded_quantity, unit: item.rounded_unit }));
    if (toConfirm.length > 0) {
      try { await bulkConfirmMutation.mutateAsync(toConfirm); } catch { /* silent */ }
    }
  }

  const todayStr = toDateStr(today);
  const todayFormatted = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <main className="max-w-lg mx-auto px-4 pt-6 pb-4">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-xl font-bold text-brand-ink dark:text-brand-background">Planner</h1>
        <span className="text-xs text-brand-muted dark:text-brand-secondary">{todayFormatted}</span>
      </div>

      {/* Week switcher */}
      <div className="flex gap-2 mb-4">
        {weeks.map((monday, i) => {
          const label = i === 0 ? 'This Week' : 'Next Week';
          const range = formatWeekRange(monday);
          const active = weekOffset === i;
          return (
            <button
              key={i}
              onClick={() => { setWeekOffset(i); setShowPickerFor(null); setShowServingPickerFor(null); }}
              className={`flex-1 py-2.5 px-3 rounded-xl border text-left transition-colors ${
                active
                  ? 'bg-brand-primary border-brand-primary text-brand-background'
                  : 'border-brand-linen dark:border-brand-primary-hover/50 text-brand-muted dark:text-brand-secondary hover:border-brand-accent/50 dark:hover:border-brand-accent/70'
              }`}
            >
              <div className={`text-xs font-semibold ${active ? 'text-brand-background/60' : 'text-brand-muted/60'}`}>{label}</div>
              <div className={`text-sm font-medium leading-tight ${active ? 'text-brand-background' : 'text-brand-ink dark:text-brand-background'}`}>{range}</div>
            </button>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-brand-linen/20 dark:bg-brand-primary-hover/50 p-1 rounded-xl">
        {(['week', 'shopping'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === tab
                ? 'bg-brand-card dark:bg-brand-primary text-brand-ink dark:text-brand-background shadow-sm'
                : 'text-brand-muted dark:text-brand-secondary hover:text-brand-ink dark:hover:text-brand-background'
            }`}
          >
            {tab === 'week' ? 'Meal Plan' : 'Shopping List'}
          </button>
        ))}
      </div>

      {/* Meal Plan tab */}
      {activeTab === 'week' && (
        <div className="space-y-3">
          {!planLoading && (
            <button
              onClick={() => { setShowAutoFill(true); setAutoFillError(null); }}
              className="w-full py-2.5 border border-brand-primary/20 dark:border-brand-primary-hover text-brand-primary dark:text-brand-secondary text-sm font-medium rounded-xl hover:bg-brand-linen/10 dark:hover:bg-brand-primary-hover/30 transition-colors flex items-center justify-center gap-2"
            >
              <Wand2 className="w-4 h-4" /> Auto-fill week
            </button>
          )}

          {planLoading && (
            <div className="space-y-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-16 bg-brand-linen/10 dark:bg-brand-primary-hover/20 rounded-2xl animate-pulse" />
              ))}
            </div>
          )}

          {!planLoading && (
            <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              {DAYS.map((_, idx) => {
                const dayDate = addDays(selectedMonday, idx);
                const dayDateStr = toDateStr(dayDate);
                const isToday = dayDateStr === todayStr;
                const isPast = dayDate < today;
                const recipeId = resolvedPlan[idx];
                const recipeSummary = getRecipeSummary(recipeId ?? null);

                return (
                  <DaySlot
                    key={idx}
                    dayIdx={idx}
                    dayDate={dayDate}
                    isToday={isToday}
                    isPast={isPast}
                    recipeId={recipeId ?? null}
                    recipeSummary={recipeSummary}
                    servings={resolvedServings[idx] ?? null}
                    anyDragActive={activeDragDay !== null}
                    showPickerFor={showPickerFor}
                    showServingPickerFor={showServingPickerFor}
                    recipes={recipes}
                    onSetDay={(id) => setLocalDay(idx, id)}
                    onSetServings={(s) => setLocalServings(idx, s)}
                    onShowPicker={setShowPickerFor}
                    onShowServingPicker={setShowServingPickerFor}
                  />
                );
              })}

              <DragOverlay dropAnimation={null}>
                {activeDragDay !== null && (() => {
                  const r = getRecipeSummary(resolvedPlan[activeDragDay] ?? null);
                  return r ? (
                    <div className="bg-brand-card dark:bg-brand-primary-hover rounded-2xl border-2 border-brand-accent shadow-2xl px-4 py-3 opacity-95 pointer-events-none">
                      <p className="text-sm font-semibold text-brand-ink dark:text-brand-background">{r.title}</p>
                      {r.cooking_time_mins && (
                        <p className="text-xs text-brand-muted/60 dark:text-brand-secondary/60 mt-0.5 flex items-center gap-1">
                          <Clock className="w-3 h-3" />{r.cooking_time_mins} min
                        </p>
                      )}
                    </div>
                  ) : null;
                })()}
              </DragOverlay>
            </DndContext>
          )}

          {!planLoading && (
            <div className="pt-2">
              <button
                onClick={handleSavePlan}
                disabled={setWeekPlanMutation.isPending}
                className="w-full py-3.5 bg-brand-primary hover:bg-brand-primary-hover text-brand-background font-semibold rounded-2xl transition-colors disabled:opacity-50"
              >
                {setWeekPlanMutation.isPending ? 'Saving...' : 'Save Plan'}
              </button>
              {setWeekPlanMutation.isSuccess && (
                <p className="text-center text-sm text-brand-herb mt-2">Plan saved!</p>
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
              <p className="text-brand-muted dark:text-brand-secondary mb-3">Failed to load shopping list</p>
              <button onClick={() => refetchShopping()} className="px-4 py-2 bg-brand-primary text-brand-background rounded-xl text-sm font-medium">
                Retry
              </button>
            </div>
          )}

          {!shopLoading && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-brand-ink dark:text-brand-background">My list</h3>
                {doneManual.length > 0 && (
                  <button onClick={() => clearDoneMutation.mutate()} className="text-xs text-brand-muted hover:text-brand-tomato transition-colors">
                    Clear done ({doneManual.length})
                  </button>
                )}
              </div>

              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="Add item…"
                  value={manualInput}
                  onChange={e => setManualInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddManual()}
                   className="flex-1 bg-brand-linen/20 dark:bg-brand-primary-hover/50 border-transparent focus:border-brand-accent rounded-xl px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  value={manualQty}
                  onChange={e => setManualQty(e.target.value)}
                   className="w-14 bg-brand-linen/20 dark:bg-brand-primary-hover/50 border-transparent focus:border-brand-accent rounded-xl px-2 py-2 text-sm text-center"
                  min="0.1"
                  step="0.5"
                />
                <button
                  onClick={handleAddManual}
                  disabled={!manualInput.trim() || addManualMutation.isPending}
                   className="px-3 py-2 bg-brand-primary hover:bg-brand-primary-hover disabled:opacity-40 text-brand-background rounded-xl text-sm font-semibold transition-colors"
                >
                  +
                </button>
              </div>

              {pendingManual.length > 0 && (
                <ul className="space-y-1 mb-1">
                  {pendingManual.map(item => (
                    <li key={item.id} className="flex items-center gap-3 bg-brand-card dark:bg-brand-primary rounded-xl border border-brand-linen dark:border-brand-primary-hover/50 px-3 py-2.5 shadow-sm">
                      <input type="checkbox" checked={false} onChange={() => toggleDoneMutation.mutate({ id: item.id, done: true })} className="w-4 h-4 accent-brand-herb flex-shrink-0 cursor-pointer" />
                      <span className="flex-1 text-sm text-brand-ink dark:text-brand-background">
                        {item.raw_name}
                        <span className="text-brand-muted/60 dark:text-brand-secondary/60 ml-2 text-xs">
                          {item.quantity !== 1 || item.unit !== 'count' ? `${item.quantity} ${item.unit}` : ''}
                        </span>
                      </span>
                      <button onClick={() => deleteManualMutation.mutate(item.id)} className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none">×</button>
                    </li>
                  ))}
                </ul>
              )}

              {doneManual.length > 0 && (
                <ul className="space-y-1 opacity-50">
                  {doneManual.map(item => (
                    <li key={item.id} className="flex items-center gap-3 bg-brand-linen/10 dark:bg-brand-primary-hover/30 rounded-xl px-3 py-2">
                      <input type="checkbox" checked={true} onChange={() => toggleDoneMutation.mutate({ id: item.id, done: false })} className="w-4 h-4 accent-brand-herb flex-shrink-0 cursor-pointer" />
                      <span className="flex-1 text-sm text-brand-muted/50 dark:text-brand-secondary/50 line-through">{item.raw_name}</span>
                      <button onClick={() => deleteManualMutation.mutate(item.id)} className="text-brand-muted/40 hover:text-brand-tomato transition-colors text-lg leading-none">×</button>
                    </li>
                  ))}
                </ul>
              )}

              {manualItems.length === 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">Nothing on your list yet — add items above or ask TeaBot.</p>
              )}

               <div className="border-t border-brand-linen dark:border-brand-primary-hover/50 mt-4 mb-4" />
              <h3 className="text-sm font-semibold text-brand-ink dark:text-brand-background mb-3">From meal plan</h3>
            </div>
          )}

          {!shopLoading && !shopError && shoppingList && (
            <>
              <div className="flex gap-2 mb-4">
                 <button
                  onClick={() => { navigator.clipboard?.writeText(shoppingList.text_export).catch(() => {}); }}
                  className="flex-1 py-2.5 border border-brand-linen dark:border-brand-primary-hover/50 text-sm font-medium text-brand-ink dark:text-brand-background rounded-xl hover:bg-brand-linen/10 dark:hover:bg-brand-primary-hover/30 transition-colors"
                >
                  Copy
                </button>
                 <button
                  onClick={() => window.open(shoppingList.whatsapp_url, '_blank')}
                  className="flex-1 py-2.5 bg-brand-herb text-brand-background text-sm font-medium rounded-xl hover:bg-brand-herb/90 transition-colors"
                >
                  WhatsApp
                </button>
              </div>

              <div className="space-y-4 pb-24">
                {Object.entries(shoppingList.zones).map(([zone, items]) => (
                   <details key={zone} open className="bg-brand-card dark:bg-brand-primary rounded-2xl border border-brand-linen dark:border-brand-primary-hover/50 shadow-sm overflow-hidden">
                    <summary className="px-4 py-3 cursor-pointer font-semibold text-sm text-brand-ink dark:text-brand-background hover:bg-brand-linen/10 dark:hover:bg-brand-primary-hover/30 select-none capitalize">
                      ▾ {zone} ({items.length})
                    </summary>
                     <ul className="divide-y divide-brand-linen dark:divide-brand-primary-hover/50">
                      {items.map((item, itemIdx) => {
                        const key = item.ingredient_id ?? `${zone}-${item.canonical_name}-${itemIdx}`;
                        const ck = itemKey(item);
                        const isChecked = checkedItems.has(ck);
                        return (
                          <li
                            key={key}
                             onClick={() => toggleItem(ck)}
                            className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${isChecked ? 'bg-brand-linen/10 dark:bg-brand-primary-hover/20' : 'hover:bg-brand-linen/5 dark:hover:bg-brand-primary-hover/10'}`}
                          >
                            <input type="checkbox" checked={isChecked} onChange={() => {}} className="w-4 h-4 accent-brand-herb flex-shrink-0 pointer-events-none" />
                            <div className="flex-1 min-w-0">
                              <span className={`text-sm font-medium ${isChecked ? 'line-through text-brand-muted/50' : 'text-brand-ink dark:text-brand-background'}`}>
                                {item.canonical_name}
                              </span>
                              <span className="text-sm text-brand-muted/70 dark:text-brand-secondary/70 ml-2">
                                {item.rounded_unit === 'pack'
                                  ? `x ${item.rounded_quantity} pack`
                                  : `${item.rounded_quantity} ${item.rounded_unit}`}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                ))}

                {Object.keys(shoppingList.zones).length === 0 && (
                  <div className="text-center py-12 px-6">
                    <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-indigo-100 dark:border-indigo-900 shadow-md mx-auto mb-4">
                      <img src="/teabot-chef.png" alt="TeaBot" className="w-full h-full object-cover opacity-60" />
                    </div>
                    <p className="font-medium text-gray-600 dark:text-gray-300 italic">&ldquo;I&apos;m hungry! Plan your week to generate a shopping list.&rdquo;</p>
                  </div>
                )}
              </div>

              {allItems.length > 0 && (
                 <div className="fixed bottom-16 left-0 right-0 flex justify-center pointer-events-none">
                  <div className="pointer-events-auto mx-4 max-w-lg w-full bg-brand-card dark:bg-brand-primary border border-brand-linen dark:border-brand-primary-hover shadow-lg px-4 py-3 flex gap-2">
                    {checkedItems.size > 0 ? (
                      <>
                         <button
                          onClick={handleMarkCheckedAsBought}
                          disabled={bulkConfirmMutation.isPending}
                          className="flex-1 py-2.5 bg-brand-primary text-brand-background text-sm font-semibold rounded-xl hover:bg-brand-primary-hover disabled:opacity-50 transition-colors"
                        >
                          {bulkConfirmMutation.isPending ? 'Saving...' : `Mark ${checkedItems.size} as bought`}
                        </button>
                        <button onClick={() => setCheckedItems(new Set())} className="px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
                          Clear
                        </button>
                      </>
                    ) : (
                       <button
                        onClick={handleMarkAllAsBought}
                        disabled={bulkConfirmMutation.isPending}
                        className="flex-1 py-2.5 bg-brand-primary text-brand-background text-sm font-semibold rounded-xl hover:bg-brand-primary-hover disabled:opacity-50 transition-colors"
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

      {/* Auto-fill modal */}
      {showAutoFill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAutoFill(false)} />
          <div className="relative w-full max-w-lg bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-6 pb-8 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-white">Auto-fill week</h2>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{formatWeekRange(selectedMonday)}</p>
              </div>
              <button onClick={() => setShowAutoFill(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">×</button>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Mood (pick any)</p>
              <div className="flex flex-wrap gap-2">
                {MOOD_OPTIONS.map((mood) => (
                  <button
                    key={mood}
                    onClick={() => setSelectedMoods((prev) => prev.includes(mood) ? prev.filter((m) => m !== mood) : [...prev, mood])}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      selectedMoods.includes(mood)
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {mood}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Servings per meal</p>
              <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-lg px-1 py-0.5">
                <button onClick={() => setAutoFillServings((s) => Math.max(1, s - 1))} disabled={autoFillServings <= 1} className="w-7 h-7 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:text-indigo-600 disabled:opacity-30 font-bold text-base">−</button>
                <span className="w-5 text-center text-sm font-semibold text-gray-900 dark:text-white tabular-nums">{autoFillServings}</span>
                <button onClick={() => setAutoFillServings((s) => Math.min(12, s + 1))} disabled={autoFillServings >= 12} className="w-7 h-7 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:text-indigo-600 disabled:opacity-30 font-bold text-base">+</button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Max cook time (optional)</p>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={10} max={180} step={5} value={maxCookTime}
                  onChange={(e) => setMaxCookTime(e.target.value ? Number(e.target.value) : '')}
                  placeholder="Any"
                  className="w-20 text-right px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <span className="text-sm text-gray-500 dark:text-gray-400">min</span>
              </div>
            </div>

            {autoFillError && <p className="text-sm text-red-600 dark:text-red-400">{autoFillError}</p>}

            <button
              onClick={handleAutoFill}
              disabled={autoFillLoading}
              className="w-full py-3.5 bg-indigo-600 text-white font-semibold rounded-2xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {autoFillLoading ? 'Finding recipes…' : 'Fill my week'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
