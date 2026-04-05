import React from 'react';
import { RecipeCard } from './RecipeCard';

export function RecipeGrid({ recipes, className = '' }: { recipes: any[]; className?: string }) {
  if (!recipes || recipes.length === 0) return null;

  return (
    <div className={`grid grid-cols-1 gap-3 my-4 ${className}`}>
      {recipes.map((r, idx) => (
        <RecipeCard key={idx} {...r} />
      ))}
    </div>
  );
}
