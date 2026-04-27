'use client';

import React, { useState } from 'react';
import { DownloadCloud, Check, X, Loader2, ExternalLink } from 'lucide-react';
import { confirmIngest, dismissIngestJob } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

export function IngestReview({ job_id, parsed_recipe, className = '' }: any) {
  const [status, setStatus] = useState<'reviewing' | 'confirmed' | 'rejected' | 'error'>('reviewing');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();

  if (!parsed_recipe) return null;

  const handleConfirm = async () => {
    setIsSaving(true);
    try {
      const recipe = await confirmIngest(job_id, parsed_recipe);
      setSavedId(recipe.id);
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      setStatus('confirmed');
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Failed to save recipe.');
      setStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = async () => {
    setIsSaving(true);
    try {
      await dismissIngestJob(job_id);
    } finally {
      setIsSaving(false);
      setStatus('rejected');
    }
  };

  const borderClass =
    status === 'reviewing' ? 'border-brand-accent bg-brand-accent/10 dark:bg-brand-accent/20' :
    status === 'confirmed' ? 'border-brand-herb/50 bg-brand-herb/10 dark:bg-brand-herb/20 opacity-80' :
    status === 'error' ? 'border-brand-tomato/50 bg-brand-tomato/5' :
    'border-brand-linen bg-brand-linen/10 dark:bg-brand-primary opacity-50 grayscale';

  return (
    <div className={`p-4 rounded-xl border ${borderClass} shadow-sm transition-all relative ${className}`}>
      {status === 'reviewing' && (
        <span className="absolute -top-1 -right-1 w-3 h-3 bg-brand-accent rounded-full animate-ping" />
      )}
      {status === 'confirmed' && <Check className="absolute top-2 right-2 text-brand-herb" size={20} />}
      {(status === 'rejected') && <X className="absolute top-2 right-2 text-brand-muted/40" size={20} />}

      <div className="flex items-center gap-2 mb-4 border-b border-brand-accent/30 dark:border-brand-accent/20 pb-3">
        <DownloadCloud size={20} className="text-brand-accent" />
        <h3 className="font-bold text-brand-ink dark:text-brand-background leading-tight">
          Review Recipe Import
        </h3>
      </div>

      <div className="space-y-3 mb-5">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-muted dark:text-brand-secondary mb-1">Title</label>
          <div className="p-2.5 bg-brand-card dark:bg-brand-primary rounded-lg border border-brand-linen dark:border-brand-primary-hover/50 font-medium text-sm text-brand-ink dark:text-brand-background">
            {parsed_recipe.title}
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-muted dark:text-brand-secondary mb-1">Cook Time</label>
            <div className="p-2.5 bg-brand-card dark:bg-brand-primary rounded-lg border border-brand-linen dark:border-brand-primary-hover/50 font-medium text-sm text-brand-ink dark:text-brand-background">
              {parsed_recipe.cooking_time_mins} mins
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-muted dark:text-brand-secondary mb-1">Servings</label>
            <div className="p-2.5 bg-brand-card dark:bg-brand-primary rounded-lg border border-brand-linen dark:border-brand-primary-hover/50 font-medium text-sm text-brand-ink dark:text-brand-background">
              {parsed_recipe.base_servings}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-muted dark:text-brand-secondary mb-1">
            Ingredients ({parsed_recipe.ingredients?.length || 0})
          </label>
          <div className="max-h-28 overflow-y-auto p-2 bg-brand-card dark:bg-brand-primary rounded-lg border border-brand-linen dark:border-brand-primary-hover/50 space-y-1">
            {parsed_recipe.ingredients?.map((ing: any, i: number) => (
              <div key={i} className="text-xs flex justify-between py-1 border-b border-brand-linen/10 dark:border-brand-primary-hover/20 last:border-0">
                <span className="font-medium text-brand-ink dark:text-brand-background">{ing.raw_name}</span>
                <span className="font-mono text-brand-muted dark:text-brand-secondary">{ing.quantity} {ing.unit}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {status === 'error' && (
        <p className="mb-3 text-xs text-brand-tomato">{errorMsg}</p>
      )}

      {status === 'confirmed' && savedId && (
        <button
          onClick={() => router.push(`/recipes/${savedId}`)}
          className="w-full py-2 flex items-center justify-center gap-2 bg-brand-herb/20 hover:bg-brand-herb/30 text-brand-herb font-medium text-sm rounded-lg transition-colors"
        >
          <ExternalLink size={14} /> View Recipe
        </button>
      )}

      {(status === 'reviewing' || status === 'error') && (
        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            disabled={isSaving}
            className="flex-1 py-2 bg-brand-primary hover:bg-brand-primary-hover disabled:opacity-60 text-brand-background font-medium text-sm rounded-lg transition-colors flex items-center justify-center gap-1 shadow-sm"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={16} />}
            Save to Collection
          </button>
          <button
            onClick={handleDiscard}
            disabled={isSaving}
            className="px-4 py-2 bg-brand-card dark:bg-brand-primary hover:bg-brand-tomato/10 text-brand-muted dark:text-brand-secondary hover:text-brand-tomato font-medium text-sm rounded-lg border border-brand-linen dark:border-brand-primary-hover/50 transition-colors"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
