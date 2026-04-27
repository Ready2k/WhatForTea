import React from 'react';
import { Clock } from 'lucide-react';

export function RecipeCard({ recipe_id, title, match_score, cook_time, missing_ingredients, className = '' }: any) {
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
      
      <div className="flex items-center gap-4 text-xs text-brand-muted mb-3">
        {cook_time && (
          <span className="flex items-center gap-1">
            <Clock size={14} />
            {cook_time} min
          </span>
        )}
      </div>

      {missing_ingredients && missing_ingredients.length > 0 && (
        <div className="text-xs">
          <span className="text-brand-muted/40">Missing:</span>{' '}
          <span className="text-brand-tomato font-medium">
            {missing_ingredients.join(', ')}
          </span>
        </div>
      )}
      
      <button 
        onClick={() => { window.location.href = `/recipes/${recipe_id}`; }}
        className="mt-3 w-full py-2 bg-brand-linen/10 hover:bg-brand-primary/10 dark:bg-brand-primary/20 dark:hover:bg-brand-primary/30 text-brand-primary font-medium text-xs rounded-lg transition-colors"
      >
        View Recipe
      </button>
    </div>
  );
}
