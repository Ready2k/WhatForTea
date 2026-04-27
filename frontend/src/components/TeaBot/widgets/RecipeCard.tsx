'use client';

import React, { useState } from 'react';
import { Clock, ChefHat, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createCookingSession } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';

function closeTeaBot() {
  window.dispatchEvent(new CustomEvent('teabot-toggle'));
}

export function RecipeCard({ recipe_id, title, match_score, cook_time, missing_ingredients, className = '' }: any) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);

  const handleView = () => {
    router.push(`/recipes/${recipe_id}`);
    closeTeaBot();
  };

  const handleStartCooking = async () => {
    if (starting) return;
    setStarting(true);
    try {
      await createCookingSession(recipe_id);
      queryClient.invalidateQueries({ queryKey: ['cookingSession'] });
      router.push(`/recipes/${recipe_id}/cook`);
      closeTeaBot();
    } catch {
      setStarting(false);
    }
  };

  return (
    <div className={`p-4 rounded-xl border border-brand-linen dark:border-brand-primary-hover/50 bg-brand-card dark:bg-brand-primary shadow-sm transition-all hover:border-brand-primary/30 ${className}`}>
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-bold text-brand-ink dark:text-brand-background leading-tight flex-1 pr-4">{title}</h3>
        {match_score !== undefined && (
          <span className={`px-2 py-1 text-xs font-bold rounded-lg shrink-0 ${
            match_score >= 90 ? 'bg-brand-herb/10 text-brand-herb' :
            match_score >= 50 ? 'bg-brand-accent/10 text-brand-accent' :
            'bg-brand-linen/20 text-brand-muted'
          }`}>
            {Math.round(match_score)}%
          </span>
        )}
      </div>

      {cook_time && (
        <div className="flex items-center gap-1 text-xs text-brand-muted mb-3">
          <Clock size={13} />
          <span>{cook_time} min</span>
        </div>
      )}

      {missing_ingredients && missing_ingredients.length > 0 && (
        <div className="text-xs mb-3">
          <span className="text-brand-muted/60">Missing: </span>
          <span className="text-brand-tomato font-medium">{missing_ingredients.join(', ')}</span>
        </div>
      )}

      <div className="flex gap-2 mt-3">
        <button
          onClick={handleStartCooking}
          disabled={starting}
          className="flex-1 py-2 bg-brand-herb hover:bg-brand-herb/90 disabled:opacity-60 text-brand-background font-medium text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm active:scale-95"
        >
          {starting ? <Loader2 size={13} className="animate-spin" /> : <ChefHat size={13} />}
          {starting ? 'Starting…' : 'Start Cooking'}
        </button>
        <button
          onClick={handleView}
          className="px-3 py-2 bg-brand-linen/10 hover:bg-brand-primary/10 dark:bg-brand-primary/20 dark:hover:bg-brand-primary/30 text-brand-primary font-medium text-xs rounded-lg transition-colors"
        >
          View
        </button>
      </div>
    </div>
  );
}
