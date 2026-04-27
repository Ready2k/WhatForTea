'use client';

import React, { useState, useEffect } from 'react';
import { ChefHat, CheckCircle2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { patchCookingSession, endCookingSession } from '@/lib/api';

export function CookingStep({ session_id, step_number, total_steps, text, timers = {}, completed_steps = [], className = '' }: any) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // Live countdown for each timer (duration_secs at mount → 0)
  const [timeLeft, setTimeLeft] = useState<Record<string, number>>(
    Object.fromEntries(Object.entries(timers as Record<string, number>).map(([id, secs]) => [id, secs]))
  );
  useEffect(() => {
    const ids = Object.keys(timeLeft);
    if (ids.length === 0) return;
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        const next = { ...prev };
        for (const id of ids) { if (next[id] > 0) next[id]--; }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePrev = async () => {
    if (saving || step_number <= 1) return;
    setSaving(true);
    try {
      await patchCookingSession(session_id, { current_step: step_number - 1 });
      queryClient.invalidateQueries({ queryKey: ['cookingSession'] });
    } finally {
      setSaving(false);
    }
  };

  const handleNext = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (step_number >= total_steps) {
        await endCookingSession(session_id, { confirmed: true });
        queryClient.invalidateQueries({ queryKey: ['cookingSession'] });
        setDone(true);
      } else {
        await patchCookingSession(session_id, {
          current_step: step_number + 1,
          completed_steps: [...(completed_steps as number[]), step_number],
        });
        queryClient.invalidateQueries({ queryKey: ['cookingSession'] });
      }
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <div className={`p-4 rounded-xl border border-brand-herb/40 bg-brand-herb/10 dark:bg-brand-herb/20 shadow-sm text-center ${className}`}>
        <CheckCircle2 className="mx-auto mb-2 text-brand-herb" size={32} />
        <p className="font-bold text-brand-ink dark:text-brand-background">Recipe complete!</p>
        <p className="text-xs text-brand-muted dark:text-brand-secondary mt-1">Pantry updated. Great cook! 🎉</p>
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-xl border border-brand-linen dark:border-brand-primary-hover/50 bg-brand-herb/10 dark:bg-brand-herb/20 shadow-sm ${className}`}>
      <div className="flex items-center gap-2 mb-4 border-b border-brand-herb/20 dark:border-brand-herb/30 pb-3">
        <ChefHat size={20} className="text-brand-herb" />
        <h3 className="font-bold text-brand-ink dark:text-brand-background leading-tight flex-1">
          Step {step_number} of {total_steps}
        </h3>
        {/* Step dots */}
        <div className="flex gap-1">
          {Array.from({ length: total_steps }).map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                (completed_steps as number[]).includes(i + 1) ? 'bg-brand-herb' :
                i + 1 === step_number ? 'bg-brand-primary' :
                'bg-brand-linen dark:bg-brand-primary-hover/30'
              }`}
            />
          ))}
        </div>
      </div>

      <p className="text-base leading-relaxed text-brand-ink dark:text-brand-background font-medium mb-5">
        {text}
      </p>

      {Object.keys(timeLeft).length > 0 && (
        <div className="mb-4 space-y-2">
          {Object.entries(timeLeft).map(([timer_id, secs]) => {
            const mins = Math.floor(secs / 60);
            const s = secs % 60;
            const finished = secs === 0;
            return (
              <div key={timer_id} className="flex items-center gap-3 p-3 bg-brand-card dark:bg-brand-primary rounded-lg border border-brand-linen dark:border-brand-primary-hover/50">
                {finished ? (
                  <CheckCircle2 size={20} className="text-brand-herb shrink-0" />
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-brand-herb border-t-transparent animate-spin shrink-0" />
                )}
                <div>
                  <span className="text-sm font-bold text-brand-herb">
                    {finished ? 'Done!' : `${mins}:${String(s).padStart(2, '0')}`}
                  </span>
                  <span className="text-xs text-brand-muted dark:text-brand-secondary ml-2">{timer_id}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handlePrev}
          disabled={saving || step_number <= 1}
          className="flex items-center gap-1 px-3 py-3 bg-brand-card dark:bg-brand-primary hover:bg-brand-linen/10 dark:hover:bg-brand-primary-hover text-brand-muted dark:text-brand-secondary font-medium text-sm rounded-lg border border-brand-linen dark:border-brand-primary-hover/50 transition-colors disabled:opacity-40"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={handleNext}
          disabled={saving}
          className="flex-1 py-3 px-4 bg-brand-herb hover:bg-brand-herb/90 disabled:opacity-60 text-brand-background font-medium text-sm rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm active:scale-95"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : step_number >= total_steps ? (
            <><CheckCircle2 size={16} /> Finish & Save</>
          ) : (
            <>Next Step <ChevronRight size={16} /></>
          )}
        </button>
      </div>
    </div>
  );
}
