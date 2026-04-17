'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  useCollections,
  useCreateCollection,
  useUpdateCollection,
  useDeleteCollection,
  useAddRecipeToCollection,
  useRemoveRecipeFromCollection,
  useCollectionRecipeIds,
} from '@/lib/hooks';
import { fetchRecipes } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import type { Collection } from '@/lib/types';
import { FolderOpen } from 'lucide-react';

const PRESET_COLOURS = [
  '#10b981', // emerald
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
];

function CollectionCard({
  col,
  onEdit,
  onDelete,
}: {
  col: Collection;
  onEdit: (col: Collection) => void;
  onDelete: (col: Collection) => void;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <div
            className="w-4 h-4 rounded-full flex-shrink-0"
            style={{ backgroundColor: col.colour }}
          />
          <span className="font-semibold text-gray-900 dark:text-white text-sm">{col.name}</span>
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
          {col.recipe_count} {col.recipe_count === 1 ? 'recipe' : 'recipes'}
        </span>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => onEdit(col)}
          className="flex-1 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          Edit
        </button>
        <button
          onClick={() => onDelete(col)}
          className="flex-1 py-1.5 text-xs font-medium text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function ManageRecipesModal({
  col,
  onClose,
}: {
  col: Collection;
  onClose: () => void;
}) {
  const { data: allRecipes = [] } = useQuery({
    queryKey: ['recipes'],
    queryFn: fetchRecipes,
  });
  const { data: colRecipes } = useCollectionRecipeIds(col.id);
  const addMutation = useAddRecipeToCollection();
  const removeMutation = useRemoveRecipeFromCollection();
  const [search, setSearch] = useState('');

  const inCollection = new Set(colRecipes?.recipe_ids ?? []);
  const filtered = allRecipes.filter((r) =>
    !search || r.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center px-4 pb-4">
      <div className="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 dark:border-gray-700">
          <div>
            <p className="font-bold text-gray-900 dark:text-white">{col.name}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Tap to add or remove recipes</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipes..."
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-1">
          {filtered.map((recipe) => {
            const isMember = inCollection.has(recipe.id);
            const isPending =
              addMutation.isPending || removeMutation.isPending;
            return (
              <button
                key={recipe.id}
                disabled={isPending}
                onClick={() => {
                  if (isMember) {
                    removeMutation.mutate({ collectionId: col.id, recipeId: recipe.id });
                  } else {
                    addMutation.mutate({ collectionId: col.id, recipeId: recipe.id });
                  }
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors disabled:opacity-50 ${
                  isMember
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                }`}
              >
                <span className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  isMember
                    ? 'border-emerald-500 bg-emerald-500'
                    : 'border-gray-300 dark:border-gray-600'
                }`}>
                  {isMember && (
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                <span className="text-sm font-medium truncate">{recipe.title}</span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-6">No recipes found</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CollectionsPage() {
  const { data: collections = [], isLoading } = useCollections();
  const createMutation = useCreateCollection();
  const updateMutation = useUpdateCollection();
  const deleteMutation = useDeleteCollection();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColour, setNewColour] = useState(PRESET_COLOURS[0]);
  const [createError, setCreateError] = useState('');

  const [editingCol, setEditingCol] = useState<Collection | null>(null);
  const [editName, setEditName] = useState('');
  const [editColour, setEditColour] = useState('');

  const [managingCol, setManagingCol] = useState<Collection | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Collection | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');
    if (!newName.trim()) { setCreateError('Name is required'); return; }
    try {
      await createMutation.mutateAsync({ name: newName.trim(), colour: newColour });
      setNewName('');
      setNewColour(PRESET_COLOURS[0]);
      setShowCreate(false);
    } catch (err: any) {
      setCreateError(err.message ?? 'Failed to create collection');
    }
  }

  async function handleSaveEdit() {
    if (!editingCol) return;
    await updateMutation.mutateAsync({ id: editingCol.id, data: { name: editName.trim(), colour: editColour } });
    setEditingCol(null);
  }

  return (
    <main className="max-w-lg mx-auto px-4 pt-6 pb-10">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link href="/recipes" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Collections</h1>
        </div>
        <button
          onClick={() => { setShowCreate((v) => !v); setCreateError(''); }}
          className="px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          {showCreate ? 'Cancel' : '+ New'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mb-4 p-4 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-600 space-y-3 shadow-sm"
        >
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">New Collection</h2>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Collection name"
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
          />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Colour</p>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLOURS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColour(c)}
                  className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${newColour === c ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-gray-300 scale-110' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          {createError && <p className="text-xs text-red-600 dark:text-red-400">{createError}</p>}
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="w-full py-2.5 bg-emerald-600 text-white font-medium text-sm rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Collection'}
          </button>
        </form>
      )}

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-200 dark:bg-gray-700 rounded-2xl animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && collections.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <FolderOpen className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
          <p className="font-medium text-gray-600 dark:text-gray-300">No collections yet</p>
          <p className="text-sm mt-1">Create a collection to organise your recipes</p>
        </div>
      )}

      <div className="space-y-3">
        {collections.map((col) => (
          <div key={col.id}>
            <CollectionCard
              col={col}
              onEdit={(c) => { setEditingCol(c); setEditName(c.name); setEditColour(c.colour); }}
              onDelete={(c) => setDeleteConfirm(c)}
            />
            <button
              onClick={() => setManagingCol(col)}
              className="w-full mt-1 py-1.5 text-xs text-center text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              Manage recipes →
            </button>
          </div>
        ))}
      </div>

      {/* Edit modal */}
      {editingCol && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4">
          <div className="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-sm p-6 shadow-2xl space-y-4">
            <h2 className="font-bold text-gray-900 dark:text-white">Edit Collection</h2>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:bg-gray-700 dark:text-white"
            />
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLOURS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setEditColour(c)}
                  className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${editColour === c ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-gray-300 scale-110' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSaveEdit}
                disabled={updateMutation.isPending}
                className="flex-1 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => setEditingCol(null)}
                className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4">
          <div className="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-sm p-6 shadow-2xl space-y-4">
            <h2 className="font-bold text-gray-900 dark:text-white">Delete &ldquo;{deleteConfirm.name}&rdquo;?</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              This removes the collection but does not delete any recipes.
            </p>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  await deleteMutation.mutateAsync(deleteConfirm.id);
                  setDeleteConfirm(null);
                }}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 disabled:opacity-50"
              >
                Delete
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage recipes modal */}
      {managingCol && (
        <ManageRecipesModal col={managingCol} onClose={() => setManagingCol(null)} />
      )}
    </main>
  );
}
