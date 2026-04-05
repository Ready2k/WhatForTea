import React from 'react';

/**
 * A2UI v0.8 Protocol - Section 11.3 compliance.
 * Own the renderer, never auto-generate.
 */

export type A2UIType =
  | 'recipe_card'
  | 'recipe_grid'
  | 'ingredient_list'
  | 'pantry_card'
  | 'pantry_confirm'
  | 'week_plan'
  | 'shopping_list'
  | 'cooking_step'
  | 'nutrition_summary'
  | 'barcode_prompt'
  | 'ingest_review'
  | 'action_button'
  | 'confirm_dialog'
  | 'text'
  | 'heading';

export interface A2UIDescriptor {
  type: A2UIType | string;
  [key: string]: unknown;
}

import { RecipeCard } from '@/components/TeaBot/widgets/RecipeCard';
import { RecipeGrid } from '@/components/TeaBot/widgets/RecipeGrid';
import { PantryConfirm } from '@/components/TeaBot/widgets/PantryConfirm';
import { WeekPlan } from '@/components/TeaBot/widgets/WeekPlan';
import { ShoppingList } from '@/components/TeaBot/widgets/ShoppingList';
import { ActionButton } from '@/components/TeaBot/widgets/ActionButton';
import { CookingStep } from '@/components/TeaBot/widgets/CookingStep';
import { IngestReview } from '@/components/TeaBot/widgets/IngestReview';

// Registry of validated widgets
const REGISTRY: Record<string, React.ComponentType<any>> = {
  'recipe_card': RecipeCard,
  'recipe_grid': RecipeGrid,
  'pantry_confirm': PantryConfirm,
  'week_plan': WeekPlan,
  'shopping_list': ShoppingList,
  'action_button': ActionButton,
  'cooking_step': CookingStep,
  'ingest_review': IngestReview,
  'text': ({ text }: { text: string }) => <p className="text-sm text-gray-700 dark:text-gray-300 my-2">{text}</p>,
  'heading': ({ text, level = 2 }: { text: string; level?: number }) => {
    const Tag = `h${level}` as any;
    return <Tag className="font-bold text-lg my-1">{text}</Tag>;
  },
};


/**
 * Maps A2UI JSON to React widgets safely.
 * Section 11.3: Render nothing in prod for unknown types; warning in dev.
 */
export function RenderA2UI(descriptor: A2UIDescriptor): React.ReactNode {
  const Widget = REGISTRY[descriptor.type as string];

  if (!Widget) {
    if (process.env.NODE_ENV === 'development') {
      return (
        <div className="p-2 border border-dashed border-red-500 text-xs text-red-500 bg-red-50 dark:bg-red-900/10">
          Unknown Widget: {descriptor.type}
        </div>
      );
    }
    return null;
  }

  return <Widget {...descriptor} />;
}
