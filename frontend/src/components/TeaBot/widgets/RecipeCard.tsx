import React from 'react';
import { Clock } from 'lucide-react';

export function RecipeCard({ recipe_id, title, match_score, cook_time, missing_ingredients, className = '' }: any) {
  return (
    <div className={`p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm transition-all hover:border-indigo-300 ${className}`}>
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-bold text-gray-900 dark:text-white leading-tight flex-1 pr-4">{title}</h3>
        {match_score !== undefined && (
          <span className={`px-2 py-1 text-xs font-bold rounded-lg shrink-0 ${
            match_score >= 90 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30' :
            match_score >= 50 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30' :
            'bg-gray-100 text-gray-700 dark:bg-gray-700'
          }`}>
            {Math.round(match_score)}%
          </span>
        )}
      </div>
      
      <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
        {cook_time && (
          <span className="flex items-center gap-1">
            <Clock size={14} />
            {cook_time} min
          </span>
        )}
      </div>

      {missing_ingredients && missing_ingredients.length > 0 && (
        <div className="text-xs">
          <span className="text-gray-400">Missing:</span>{' '}
          <span className="text-red-500 dark:text-red-400 font-medium">
            {missing_ingredients.join(', ')}
          </span>
        </div>
      )}
      
      <button 
        onClick={() => { window.location.href = `/recipes/${recipe_id}`; }}
        className="mt-3 w-full py-2 bg-gray-50 hover:bg-indigo-50 dark:bg-gray-900/50 dark:hover:bg-indigo-900/20 text-indigo-600 font-medium text-xs rounded-lg transition-colors"
      >
        View Recipe
      </button>
    </div>
  );
}
