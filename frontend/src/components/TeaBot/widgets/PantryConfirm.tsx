import React, { useState, useEffect } from 'react';
import { useCopilotAction } from '@copilotkit/react-core';
import { Check, X, AlertTriangle } from 'lucide-react';

export function PantryConfirm({ raw_name, quantity: default_quantity, unit, ingredient_id, className = '' }: any) {
  const [quantity, setQuantity] = useState(default_quantity);
  const [status, setStatus] = useState<'waiting' | 'applied' | 'rejected'>('waiting');
  
  // 5-minute timeout as per specs
  useEffect(() => {
    if (status !== 'waiting') return;
    const timeout = setTimeout(() => {
      setStatus('rejected');
    }, 5 * 60 * 1000);
    return () => clearTimeout(timeout);
  }, [status]);

  useCopilotAction({
    name: 'confirm_pantry_upsert',
    description: 'Confirm the addition or update to the pantry',
    parameters: [
      { name: 'confirmed', type: 'boolean', description: 'True to apply, false to reject' },
      { name: 'final_quantity', type: 'number', description: 'The final quantity selected by the user' }
    ],
    handler: async ({ confirmed, final_quantity }) => {
      setStatus(confirmed ? 'applied' : 'rejected');
      // In a real app, this action will return to the CoAgent's interrupt()
    }
  });

  const handleConfirm = () => {
    setStatus('applied');
    // We would trigger a CopilotAction here to resolve the LangGraph interrupt.
    // CopilotKit usually resolves state directly if using useCoAgent, 
    // but a frontend action explicitly confirms the state transition.
  };

  const handleReject = () => {
    setStatus('rejected');
  };

  return (
    <div className={`p-4 rounded-xl border ${
      status === 'waiting' ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/10' :
      status === 'applied' ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10 opacity-70' :
      'border-gray-200 bg-gray-50 dark:bg-gray-800 opacity-50 grayscale'
    } shadow-sm transition-all relative ${className}`}>
      
      {/* Visual State Indicators */}
      {status === 'waiting' && <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-400 rounded-full animate-ping" />}
      {status === 'applied' && <Check className="absolute top-2 right-2 text-emerald-500" size={20} />}
      {status === 'rejected' && <X className="absolute top-2 right-2 text-gray-400" size={20} />}

      <div className="flex items-center gap-2 mb-3">
        {status === 'waiting' && <AlertTriangle size={16} className="text-amber-500" />}
        <h3 className="font-bold text-gray-900 dark:text-white leading-tight">
          Pantry Update
        </h3>
      </div>
      
      <div className="space-y-3">
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
      </div>

      {status === 'waiting' && (
        <div className="flex gap-2 mt-4">
          <button 
            onClick={handleConfirm}
            className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-medium text-sm rounded-lg transition-colors flex items-center justify-center gap-1 shadow-sm"
          >
            <Check size={16} /> Confirm
          </button>
          <button 
            onClick={handleReject}
            className="px-4 py-2 bg-white dark:bg-gray-900 hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-700 dark:text-gray-300 hover:text-red-600 font-medium text-sm rounded-lg border border-gray-200 dark:border-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
