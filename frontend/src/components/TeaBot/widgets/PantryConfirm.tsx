'use client';

import React, { useState, useEffect } from 'react';
import { Check, X, AlertTriangle, Loader2 } from 'lucide-react';
import { fetchIngredients, upsertPantryItem } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import type { OnResumeFn } from '@/lib/a2ui';

interface PantryConfirmProps {
  raw_name: string;
  quantity?: number;
  unit?: string;
  ingredient_id?: string;
  /** Present when this widget is backed by a LangGraph interrupt (HITL mode). */
  onResume?: OnResumeFn;
  className?: string;
}

export function PantryConfirm({ raw_name, quantity: default_quantity, unit, ingredient_id, onResume, className = '' }: PantryConfirmProps) {
  const [quantity, setQuantity] = useState(default_quantity ?? 1);
  const [status, setStatus] = useState<'waiting' | 'saving' | 'applied' | 'rejected' | 'error'>('waiting');
  const [errorMsg, setErrorMsg] = useState('');
  const queryClient = useQueryClient();

  // 5-minute timeout — auto-reject if user ignores
  useEffect(() => {
    if (status !== 'waiting') return;
    const timeout = setTimeout(() => {
      if (onResume) onResume('reject');
      setStatus('rejected');
    }, 5 * 60 * 1000);
    return () => clearTimeout(timeout);
  }, [status, onResume]);

  const handleConfirm = async () => {
    setStatus('saving');
    try {
      if (onResume) {
        // HITL mode: hand back to the graph — it owns the upsert
        onResume('confirm', quantity);
        setStatus('applied');
        return;
      }

      // Standalone mode: execute upsert directly from the frontend
      let resolvedId: string | null = ingredient_id ?? null;
      if (!resolvedId) {
        const results = await fetchIngredients(raw_name);
        if (results.length > 0) {
          resolvedId = results[0].id;
        } else {
          setStatus('error');
          setErrorMsg('Ingredient not found — add it via the Pantry page.');
          return;
        }
      }

      await upsertPantryItem({
        ingredient_id: resolvedId,
        quantity,
        unit: unit ?? 'count',
        confidence: 1.0,
      });

      queryClient.invalidateQueries({ queryKey: ['pantry'] });
      queryClient.invalidateQueries({ queryKey: ['available'] });
      setStatus('applied');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err?.message ?? 'Something went wrong.');
    }
  };

  const handleReject = () => {
    if (onResume) onResume('reject');
    setStatus('rejected');
  };

  const borderColor =
    status === 'waiting' || status === 'saving' ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/10' :
    status === 'applied' ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10 opacity-70' :
    'border-gray-200 bg-gray-50 dark:bg-gray-800 opacity-50 grayscale';

  return (
    <div className={`p-4 rounded-xl border ${borderColor} shadow-sm transition-all relative ${className}`}>
      {status === 'waiting' && <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-400 rounded-full animate-ping" />}
      {status === 'applied' && <Check className="absolute top-2 right-2 text-emerald-500" size={20} />}
      {(status === 'rejected' || status === 'error') && <X className="absolute top-2 right-2 text-gray-400" size={20} />}

      <div className="flex items-center gap-2 mb-3">
        {(status === 'waiting' || status === 'saving') && <AlertTriangle size={16} className="text-amber-500" />}
        <h3 className="font-bold text-gray-900 dark:text-white leading-tight text-sm">
          Add to Pantry
        </h3>
      </div>

      <div className="flex justify-between items-center bg-white dark:bg-gray-900 p-3 rounded-lg border border-gray-100 dark:border-gray-800">
        <span className="font-medium text-sm">{raw_name}</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            disabled={status !== 'waiting'}
            className="w-16 text-right font-mono bg-transparent border-b border-gray-300 dark:border-gray-700 focus:border-indigo-500 p-0 text-sm focus:ring-0"
          />
          <span className="text-sm text-gray-500">{unit}</span>
        </div>
      </div>

      {status === 'error' && (
        <p className="mt-2 text-xs text-red-500">{errorMsg}</p>
      )}

      {(status === 'waiting' || status === 'saving') && (
        <div className="flex gap-2 mt-4">
          <button
            onClick={handleConfirm}
            disabled={status === 'saving'}
            className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white font-medium text-sm rounded-lg transition-colors flex items-center justify-center gap-1 shadow-sm"
          >
            {status === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <Check size={16} />}
            {status === 'saving' ? 'Saving…' : 'Confirm'}
          </button>
          <button
            onClick={handleReject}
            disabled={status === 'saving'}
            className="px-4 py-2 bg-white dark:bg-gray-900 hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-700 dark:text-gray-300 hover:text-red-600 font-medium text-sm rounded-lg border border-gray-200 dark:border-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
