import React, { useState } from 'react';
import { DownloadCloud, Check, X } from 'lucide-react';
import { useCopilotAction } from '@copilotkit/react-core';

export function IngestReview({ job_id, parsed_recipe, className = '' }: any) {
  const [status, setStatus] = useState<'reviewing' | 'confirmed' | 'rejected'>('reviewing');
  
  useCopilotAction({
    name: 'confirm_recipe_ingestion',
    description: 'Confirm the ingestion of the scanned or linked recipe.',
    parameters: [
      { name: 'confirmed', type: 'boolean', description: 'True to add recipe, false to discard' }
    ],
    handler: ({ confirmed }) => {
      setStatus(confirmed ? 'confirmed' : 'rejected');
    }
  });

  if (!parsed_recipe) return null;

  return (
    <div className={`p-4 rounded-xl border ${
      status === 'reviewing' ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/10' :
      status === 'confirmed' ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10 opacity-70' :
      'border-gray-200 bg-gray-50 dark:bg-gray-800 opacity-50 grayscale'
    } shadow-sm transition-all relative ${className}`}>
      
      {/* Visual State Indicators */}
      {status === 'reviewing' && <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-400 rounded-full animate-ping" />}
      {status === 'confirmed' && <Check className="absolute top-2 right-2 text-emerald-500" size={20} />}
      {status === 'rejected' && <X className="absolute top-2 right-2 text-gray-400" size={20} />}

      <div className="flex items-center gap-2 mb-4 border-b border-amber-200 dark:border-amber-800/30 pb-3">
        <DownloadCloud size={20} className="text-amber-500" />
        <h3 className="font-bold text-gray-900 dark:text-white leading-tight">
          Review Recipe Import
        </h3>
      </div>
      
      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Title Extracted</label>
          <div className="p-2.5 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 font-medium text-sm">
            {parsed_recipe.title}
          </div>
        </div>
        
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Cook Time</label>
            <div className="p-2.5 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 font-medium text-sm">
              {parsed_recipe.cooking_time_mins} mins
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Servings</label>
            <div className="p-2.5 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 font-medium text-sm">
              {parsed_recipe.base_servings}
            </div>
          </div>
        </div>
        
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
            Ingredients ({parsed_recipe.ingredients?.length || 0})
          </label>
          <div className="max-h-32 overflow-y-auto p-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-1">
            {parsed_recipe.ingredients?.map((ing: any, i: number) => (
              <div key={i} className="text-xs flex justify-between py-1 border-b border-gray-50 dark:border-gray-800 last:border-0">
                <span className="font-medium text-gray-800 dark:text-gray-200">{ing.raw_name}</span>
                <span className="font-mono text-gray-500">{ing.quantity} {ing.unit}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {status === 'reviewing' && (
        <div className="flex gap-2">
          <button 
            onClick={() => setStatus('confirmed')}
            className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-lg transition-colors flex items-center justify-center gap-1 shadow-sm"
          >
            <Check size={16} /> Save to Collection
          </button>
          <button 
            onClick={() => setStatus('rejected')}
            className="px-4 py-2 bg-white dark:bg-gray-900 hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-700 dark:text-gray-300 hover:text-red-600 font-medium text-sm rounded-lg border border-gray-200 dark:border-gray-700 transition-colors"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
