import type {
  Collection,
  HouseholdInfo,
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
  ReceiptIngestResponse,
  UserProfile,
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
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') window.location.href = '/login';
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

export function fetchIngredients(q?: string): Promise<Ingredient[]> {
  const params = q ? `?q=${encodeURIComponent(q)}` : '';
  return request<Ingredient[]>(`/api/v1/ingredients${params}`);
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

export function fetchMatches(category?: string, sort?: 'use_it_up'): Promise<RecipeMatchResult[]> {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (sort) params.set('sort', sort);
  const qs = params.toString();
  return request<RecipeMatchResult[]>(`/api/v1/recipes/match${qs ? `?${qs}` : ''}`);
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
  expires_at?: string | null;
}): Promise<PantryItem> {
  return request<PantryItem>('/api/v1/pantry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function bulkConfirmPantry(items: Array<{ ingredient_id: string; quantity: number; unit: string }>): Promise<PantryItem[]> {
  return request<PantryItem[]>('/api/v1/pantry/bulk-confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
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

export interface AutoFillEntry {
  day_of_week: number;
  recipe_id: string;
  recipe_title: string;
  score: number;
  servings: number;
}

export function autoFillWeek(data: {
  moods: string[];
  servings: number;
  max_cook_time_mins?: number;
  avoid_recent_days?: number;
}): Promise<AutoFillEntry[]> {
  return request<AutoFillEntry[]>('/api/v1/planner/auto-fill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function ingestRecipe(formData: FormData): Promise<{ job_id: string }> {
  return request<{ job_id: string }>('/api/v1/recipes/ingest', {
    method: 'POST',
    body: formData,
  });
}

export function ingestReceipt(formData: FormData): Promise<ReceiptIngestResponse> {
  return request<ReceiptIngestResponse>('/api/v1/pantry/ingest-receipt', {
    method: 'POST',
    body: formData,
  });
}

export function getIngestStatus(jobId: string): Promise<IngestStatusResponse> {
  return request<IngestStatusResponse>(`/api/v1/recipes/ingest/${jobId}/status`);
}

export function importRecipeFromUrl(url: string): Promise<{ job_id: string }> {
  return request<{ job_id: string }>('/api/v1/recipes/import-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

export function getIngestReview(jobId: string): Promise<IngestReviewPayload> {
  return request<IngestReviewPayload>(`/api/v1/recipes/ingest/${jobId}/review`);
}

export async function confirmIngest(jobId: string, recipe: any, force = false): Promise<Recipe> {
  const url = `/api/v1/recipes/ingest/confirm/${jobId}${force ? '?force=true' : ''}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ recipe }),
  });
  if (!res.ok) {
    let body: any = {};
    try { body = await res.json(); } catch { /* ignore */ }
    const err: any = new Error(body?.error?.message ?? `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json() as Promise<Recipe>;
}

export function resolveRecipeIngredient(
  recipeId: string,
  riId: string,
  ingredientId: string,
): Promise<{ id: string; ingredient_id: string; raw_name: string }> {
  return request(`/api/v1/recipes/${recipeId}/ingredients/${riId}/resolve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ingredient_id: ingredientId }),
  });
}

export function updateRecipe(recipeId: string, payload: any): Promise<Recipe> {
  return request<Recipe>(`/api/v1/recipes/${recipeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ── Cooking Sessions ──────────────────────────────────────────────────────────

export interface CookingSession {
  id: string;
  recipe_id: string;
  current_step: number;
  completed_steps: number[];
  timers: Record<string, { remaining_seconds: number; running: boolean }>;
  confirmed_cook: boolean;
  servings_cooked?: number | null;
  notes?: string | null;
  rating?: number | null;
  started_at: string;
  ended_at?: string | null;
  recipe_title?: string | null;
  user_id?: string | null;
  user_display_name?: string | null;
}

export function createCookingSession(recipeId: string): Promise<CookingSession> {
  return request<CookingSession>('/api/v1/cooking/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe_id: recipeId }),
  });
}

export function getActiveCookingSession(): Promise<CookingSession | null> {
  return request<CookingSession | null>('/api/v1/cooking/sessions/active');
}

export function patchCookingSession(
  sessionId: string,
  data: {
    current_step?: number;
    completed_steps?: number[];
    timers?: Record<string, unknown>;
    notes?: string;
    rating?: number;
  },
): Promise<CookingSession> {
  return request<CookingSession>(`/api/v1/cooking/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function endCookingSession(
  sessionId: string,
  data: { confirmed?: boolean; servings_cooked?: number } = {},
): Promise<CookingSession> {
  return request<CookingSession>(`/api/v1/cooking/sessions/${sessionId}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function getCookingHistory(recipeId?: string, limit = 20): Promise<CookingSession[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (recipeId) params.set('recipe_id', recipeId);
  return request<CookingSession[]>(`/api/v1/cooking/history?${params}`);
}

export function rotateRecipePhoto(recipeId: string, index = 0): Promise<void> {
  return request<void>(`/api/v1/recipes/${recipeId}/photo/rotate?index=${index}`, {
    method: 'POST',
  });
}

export function uploadRecipePhoto(recipeId: string, file: File): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);
  return request<void>(`/api/v1/recipes/${recipeId}/photo`, {
    method: 'POST',
    body: formData,
  });
}

// ── Barcode ───────────────────────────────────────────────────────────────────

export interface BarcodeLookupResponse {
  barcode: string;
  product_name?: string | null;
  ingredient_id?: string | null;
  canonical_name?: string | null;
  confidence: number;
  source: 'cache' | 'openfoodfacts' | 'not_found' | 'unresolved' | 'error';
  error?: string | null;
}

export function lookupBarcode(barcode: string): Promise<BarcodeLookupResponse> {
  return request<BarcodeLookupResponse>('/api/v1/barcode/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ barcode }),
  });
}

// ── Collections ───────────────────────────────────────────────────────────────

export function fetchCollections(): Promise<Collection[]> {
  return request<Collection[]>('/api/v1/collections');
}

export function createCollection(data: { name: string; colour?: string }): Promise<Collection> {
  return request<Collection>('/api/v1/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function updateCollection(id: string, data: { name?: string; colour?: string }): Promise<Collection> {
  return request<Collection>(`/api/v1/collections/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function deleteCollection(id: string): Promise<void> {
  return request<void>(`/api/v1/collections/${id}`, { method: 'DELETE' });
}

export function fetchCollectionRecipeIds(id: string): Promise<{ collection_id: string; recipe_ids: string[] }> {
  return request(`/api/v1/collections/${id}/recipe-ids`);
}

export function addRecipeToCollection(collectionId: string, recipeId: string): Promise<Collection> {
  return request<Collection>(`/api/v1/collections/${collectionId}/recipes/${recipeId}`, { method: 'POST' });
}

export function removeRecipeFromCollection(collectionId: string, recipeId: string): Promise<Collection> {
  return request<Collection>(`/api/v1/collections/${collectionId}/recipes/${recipeId}`, { method: 'DELETE' });
}

// ── User / Household ──────────────────────────────────────────────────────────

export async function getCurrentUser(): Promise<UserProfile | null> {
  try {
    return await request<UserProfile>('/api/auth/me');
  } catch (err: any) {
    // 404 = legacy "household" user with no profile record — treat as logged in but no profile
    if (err.message && (err.message.includes('404') || err.message.includes('No user profile'))) {
      return null;
    }
    throw err;
  }
}

export function updateUserProfile(data: { display_name?: string }): Promise<UserProfile> {
  return request<UserProfile>('/api/v1/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function changePassword(data: { current_password: string; new_password: string }): Promise<void> {
  return request<void>('/api/v1/users/me/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function getHousehold(): Promise<HouseholdInfo> {
  return request<HouseholdInfo>('/api/v1/household');
}

export function rotateInviteCode(): Promise<HouseholdInfo> {
  return request<HouseholdInfo>('/api/v1/household/invite', { method: 'POST' });
}

export function getHouseholdMembers(): Promise<UserProfile[]> {
  return request<UserProfile[]>('/api/v1/household/members');
}

export function joinHousehold(data: {
  invite_code: string;
  username: string;
  display_name: string;
  password: string;
}): Promise<UserProfile> {
  return request<UserProfile>('/api/v1/household/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export interface VoiceCommandResponse {
  intent: 'add_to_list' | 'session_note' | 'navigation' | 'unknown';
  item?: string | null;
  note?: string | null;
  direction?: string | null;
  raw_transcript: string;
}

export function sendVoiceCommand(transcript: string, context?: string): Promise<VoiceCommandResponse> {
  return request<VoiceCommandResponse>('/api/v1/voice/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, context }),
  });
}
