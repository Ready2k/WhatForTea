import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchIngredients,
  fetchRecipes,
  fetchRecipe,
  fetchMatches,
  fetchPantry,
  fetchAvailable,
  upsertPantryItem,
  confirmPantryItem,
  deletePantryItem,
  fetchCurrentPlan,
  setWeekPlan,
  fetchShoppingList,
  ingestRecipe,
} from './api';

export function useIngredients() {
  return useQuery({
    queryKey: ['ingredients'],
    queryFn: fetchIngredients,
    staleTime: 5 * 60 * 1000, // ingredient list changes infrequently
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

export function useMatches(category?: string) {
  return useQuery({
    queryKey: ['matches', category],
    queryFn: () => fetchMatches(category),
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
