import type {
  Ingredient,
  Recipe,
  RecipeSummary,
  RecipeMatchResult,
  PantryItem,
  PantryAvailability,
  MealPlan,
  ShoppingList,
  IngestStatusResponse,
  IngestReviewPayload,
} from './types';

const BASE = '';

// 401 → attempt one silent token refresh, then retry original request
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, { credentials: 'include', ...options });

  if (res.status === 401) {
    // Try to refresh the access token
    const refreshRes = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (refreshRes.ok) {
      // Retry the original request with the new cookie
      const retryRes = await fetch(`${BASE}${url}`, { credentials: 'include', ...options });
      if (retryRes.status === 401) {
        // Still unauthorized after refresh — redirect to login
        if (typeof window !== 'undefined') window.location.href = '/login';
        throw new Error('Authentication required');
      }
      if (!retryRes.ok) {
        let message = `HTTP ${retryRes.status}`;
        try {
          const body = await retryRes.json();
          if (body?.error?.message) message = body.error.message;
          else if (body?.detail) message = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
        } catch { /* ignore */ }
        throw new Error(message);
      }
      if (retryRes.status === 204) return undefined as unknown as T;
      return retryRes.json() as Promise<T>;
    }
    // Refresh failed — redirect to login
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new Error('Authentication required');
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error?.message) {
        message = body.error.message;
      } else if (body?.detail) {
        message = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? 'Login failed');
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/login';
}

export function fetchIngredients(): Promise<Ingredient[]> {
  return request<Ingredient[]>('/api/v1/ingredients');
}

export function createIngredient(data: {
  canonical_name: string;
  category: string;
  dimension: string;
  typical_unit: string;
  aliases?: string[];
}): Promise<Ingredient> {
  return request<Ingredient>('/api/v1/ingredients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aliases: [], ...data }),
  });
}

export function fetchRecipes(): Promise<RecipeSummary[]> {
  return request<RecipeSummary[]>('/api/v1/recipes');
}

export function fetchRecipe(id: string): Promise<Recipe> {
  return request<Recipe>(`/api/v1/recipes/${id}`);
}

export function fetchMatches(category?: string): Promise<RecipeMatchResult[]> {
  const params = category ? `?category=${encodeURIComponent(category)}` : '';
  return request<RecipeMatchResult[]>(`/api/v1/recipes/match${params}`);
}

export function fetchPantry(): Promise<PantryItem[]> {
  return request<PantryItem[]>('/api/v1/pantry');
}

export function fetchAvailable(): Promise<PantryAvailability[]> {
  return request<PantryAvailability[]>('/api/v1/pantry/available');
}

export function upsertPantryItem(data: {
  ingredient_id: string;
  quantity: number;
  unit: string;
  confidence?: number;
}): Promise<PantryItem> {
  return request<PantryItem>('/api/v1/pantry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function confirmPantryItem(id: string): Promise<PantryItem> {
  return request<PantryItem>(`/api/v1/pantry/${id}/confirm`, {
    method: 'POST',
  });
}

export function deleteRecipe(id: string): Promise<void> {
  return request<void>(`/api/v1/recipes/${id}`, { method: 'DELETE' });
}

export function deletePantryItem(id: string): Promise<void> {
  return request<void>(`/api/v1/pantry/${id}`, {
    method: 'DELETE',
  });
}

export function fetchCurrentPlan(): Promise<MealPlan> {
  return request<MealPlan>('/api/v1/planner/week/current');
}

export function setWeekPlan(data: {
  week_start: string;
  entries: Array<{ day_of_week: number; recipe_id: string; servings?: number }>;
}): Promise<MealPlan> {
  return request<MealPlan>('/api/v1/planner/week', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function fetchShoppingList(): Promise<ShoppingList> {
  return request<ShoppingList>('/api/v1/planner/shopping-list');
}

export function ingestRecipe(formData: FormData): Promise<{ job_id: string }> {
  return request<{ job_id: string }>('/api/v1/recipes/ingest', {
    method: 'POST',
    body: formData,
  });
}

export function getIngestStatus(jobId: string): Promise<IngestStatusResponse> {
  return request<IngestStatusResponse>(`/api/v1/recipes/ingest/${jobId}/status`);
}

export function getIngestReview(jobId: string): Promise<IngestReviewPayload> {
  return request<IngestReviewPayload>(`/api/v1/recipes/ingest/${jobId}/review`);
}

export function confirmIngest(jobId: string, recipe: any): Promise<Recipe> {
  return request<Recipe>(`/api/v1/recipes/ingest/confirm/${jobId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe }),
  });
}
