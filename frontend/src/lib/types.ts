export interface Ingredient {
  id: string;
  canonical_name: string;
  category: string;
  dimension: string;
  typical_unit: string;
  count_to_mass_g?: number;
}

export interface RecipeIngredient {
  id: string;
  recipe_id: string;
  ingredient_id: string;
  raw_name: string;
  quantity: number;
  unit?: string;
  normalized_quantity?: number;
  normalized_unit?: string;
}

export interface Step {
  id: string;
  recipe_id: string;
  order: number;
  text: string;
  timer_seconds?: number;
}

export interface Recipe {
  id: string;
  title: string;
  hero_image_path?: string;
  cooking_time_mins?: number;
  base_servings: number;
  source_type: string;
  mood_tags: string[];
  created_at: string;
  ingredients: RecipeIngredient[];
  steps: Step[];
}

export interface RecipeSummary {
  id: string;
  title: string;
  hero_image_path?: string;
  cooking_time_mins?: number;
  mood_tags: string[];
}

export interface PantryItem {
  id: string;
  ingredient_id: string;
  quantity: number;
  unit: string;
  confidence: number;
  decay_rate: number;
  last_confirmed_at: string;
  last_used_at?: string;
}

export interface PantryAvailability {
  ingredient: Ingredient;
  total_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  confidence: number;
  unit: string;
}

export interface IngredientMatchDetail {
  ingredient_id?: string;
  raw_name: string;
  required_qty: number;
  required_unit?: string;
  available_qty: number;
  score: number;
  confidence: number;
}

export interface RecipeMatchResult {
  recipe: RecipeSummary;
  score: number;
  category: 'cook_now' | 'almost_there' | 'planner';
  hard_missing: IngredientMatchDetail[];
  partial: IngredientMatchDetail[];
  low_confidence: IngredientMatchDetail[];
  full: IngredientMatchDetail[];
}

export interface MealPlanEntry {
  id: string;
  meal_plan_id: string;
  day_of_week: number;
  recipe_id: string;
  servings?: number;
  recipe: RecipeSummary;
}

export interface MealPlan {
  id: string;
  week_start: string;
  created_at: string;
  entries: MealPlanEntry[];
}

export interface ShoppingListItem {
  ingredient_id: string;
  canonical_name: string;
  quantity: number;
  unit: string;
  rounded_quantity: number;
  rounded_unit: string;
}

export interface ShoppingList {
  zones: Record<string, ShoppingListItem[]>;
  text_export: string;
  whatsapp_url: string;
}

export interface IngestStatusResponse {
  job_id: string;
  status: 'queued' | 'processing' | 'review' | 'complete' | 'failed';
  error_message?: string;
}

export interface IngestReviewPayload {
  job_id: string;
  parsed_recipe: any;
  unresolved_ingredients: string[];
}
