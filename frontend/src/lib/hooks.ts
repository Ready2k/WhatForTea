import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchIngredients,
  createIngredient,
  fetchRecipes,
  fetchRecipe,
  fetchMatches,
  fetchPantry,
  fetchAvailable,
  upsertPantryItem,
  bulkConfirmPantry,
  confirmPantryItem,
  deletePantryItem,
  deleteRecipe,
  fetchCurrentPlan,
  setWeekPlan,
  fetchShoppingList,
  ingestRecipe,
  resolveRecipeIngredient,
  fetchCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  fetchCollectionRecipeIds,
  addRecipeToCollection,
  removeRecipeFromCollection,
  getCurrentUser,
  updateUserProfile,
  changePassword,
  getHousehold,
  rotateInviteCode,
  getHouseholdMembers,
} from './api';

export function useIngredients(q?: string) {
  return useQuery({
    queryKey: ['ingredients', q ?? ''],
    queryFn: () => fetchIngredients(q),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateIngredient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createIngredient,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ingredients'] }),
  });
}

export function useRecipes() {
  return useQuery({
    queryKey: ['recipes'],
    queryFn: fetchRecipes,
  });
}

export function useRecipe(id: string) {
  return useQuery({
    queryKey: ['recipe', id],
    queryFn: () => fetchRecipe(id),
    enabled: !!id,
  });
}

export function useMatches(category?: string, sort?: 'use_it_up') {
  return useQuery({
    queryKey: ['matches', category, sort],
    queryFn: () => fetchMatches(category, sort),
    staleTime: 30_000,
  });
}

export function usePantry() {
  return useQuery({
    queryKey: ['pantry'],
    queryFn: fetchPantry,
  });
}

export function useAvailable() {
  return useQuery({
    queryKey: ['available'],
    queryFn: fetchAvailable,
  });
}

export function useCurrentPlan() {
  return useQuery({
    queryKey: ['plan', 'current'],
    queryFn: fetchCurrentPlan,
  });
}

export function useShoppingList() {
  return useQuery({
    queryKey: ['shopping-list'],
    queryFn: fetchShoppingList,
  });
}

export function useUpsertPantryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: upsertPantryItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pantry'] });
      qc.invalidateQueries({ queryKey: ['available'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

export function useBulkConfirmPantry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: bulkConfirmPantry,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pantry'] });
      qc.invalidateQueries({ queryKey: ['available'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
      qc.invalidateQueries({ queryKey: ['shopping-list'] });
    },
  });
}

export function useConfirmPantryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: confirmPantryItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pantry'] });
      qc.invalidateQueries({ queryKey: ['available'] });
    },
  });
}

export function useDeletePantryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deletePantryItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pantry'] });
      qc.invalidateQueries({ queryKey: ['available'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteRecipe,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

export function useSetWeekPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setWeekPlan,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plan'] });
      qc.invalidateQueries({ queryKey: ['shopping-list'] });
    },
  });
}

export function useIngestRecipe() {
  return useMutation({
    mutationFn: ingestRecipe,
  });
}

export function useResolveRecipeIngredient(recipeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ riId, ingredientId }: { riId: string; ingredientId: string }) =>
      resolveRecipeIngredient(recipeId, riId, ingredientId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipe', recipeId] });
      qc.invalidateQueries({ queryKey: ['matches'] });
      qc.invalidateQueries({ queryKey: ['shopping-list'] });
    },
  });
}

// ── Collections ───────────────────────────────────────────────────────────────

export function useCollections() {
  return useQuery({
    queryKey: ['collections'],
    queryFn: fetchCollections,
    staleTime: 2 * 60 * 1000,
  });
}

export function useCollectionRecipeIds(collectionId: string | null) {
  return useQuery({
    queryKey: ['collection-recipes', collectionId],
    queryFn: () => fetchCollectionRecipeIds(collectionId!),
    enabled: !!collectionId,
    staleTime: 30 * 1000,
  });
}

export function useCreateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createCollection,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections'] }),
  });
}

export function useUpdateCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; colour?: string } }) =>
      updateCollection(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections'] }),
  });
}

export function useDeleteCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteCollection,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections'] }),
  });
}

export function useAddRecipeToCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, recipeId }: { collectionId: string; recipeId: string }) =>
      addRecipeToCollection(collectionId, recipeId),
    onSuccess: (_data, { collectionId }) => {
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['collection-recipes', collectionId] });
    },
  });
}

export function useRemoveRecipeFromCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, recipeId }: { collectionId: string; recipeId: string }) =>
      removeRecipeFromCollection(collectionId, recipeId),
    onSuccess: (_data, { collectionId }) => {
      qc.invalidateQueries({ queryKey: ['collections'] });
      qc.invalidateQueries({ queryKey: ['collection-recipes', collectionId] });
    },
  });
}

// ── User / Household ──────────────────────────────────────────────────────────

export function useCurrentUser() {
  return useQuery({
    queryKey: ['current-user'],
    queryFn: getCurrentUser,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useUpdateUserProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateUserProfile,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['current-user'] }),
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: changePassword });
}

export function useHousehold() {
  return useQuery({
    queryKey: ['household'],
    queryFn: getHousehold,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useRotateInviteCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rotateInviteCode,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['household'] }),
  });
}

export function useHouseholdMembers() {
  return useQuery({
    queryKey: ['household-members'],
    queryFn: getHouseholdMembers,
    staleTime: 2 * 60 * 1000,
    retry: false,
  });
}
