import React from 'react';
import { ChefHat, CheckCircle2, Circle } from 'lucide-react';

export function CookingStep({ session_id, step_number, total_steps, text, timers = {}, className = '' }: any) {
  return (
    <div className={`p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-emerald-50 dark:bg-emerald-900/10 shadow-sm ${className}`}>
      <div className="flex items-center gap-2 mb-4 border-b border-emerald-100 dark:border-emerald-800/50 pb-3">
        <ChefHat size={20} className="text-emerald-500" />
        <h3 className="font-bold text-gray-900 dark:text-white leading-tight">
          Step {step_number} of {total_steps}
        </h3>
      </div>
      
      <div className="text-lg leading-relaxed text-gray-800 dark:text-gray-100 font-medium mb-6">
        {text}
      </div>

      {Object.keys(timers).length > 0 && (
        <div className="mb-4 space-y-2">
          {Object.entries(timers).map(([timer_id, duration_secs]: any) => (
            <div key={timer_id} className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700">
               <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
               <div className="flex flex-col">
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    {Math.floor(duration_secs / 60)}:{(duration_secs % 60).toString().padStart(2, '0')}
                  </span>
                  <span className="text-xs text-gray-500">Timer remaining</span>
               </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button 
          onClick={() => console.log('Previous')}
          disabled={step_number <= 1}
          className="flex-1 py-3 px-4 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium text-sm rounded-lg border border-gray-200 dark:border-gray-700 transition-colors disabled:opacity-50"
        >
          Previous
        </button>
        <button 
          onClick={() => console.log('Next')}
          className="flex-[2] py-3 px-4 bg-emerald-500 hover:bg-emerald-600 text-white font-medium text-sm rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm"
        >
          {step_number === total_steps ? (
            <>Finish Recipe <CheckCircle2 size={18} /></>
          ) : (
            <>Next Step <Circle size={18} className="fill-current text-emerald-400/30" /></>
          )}
        </button>
      </div>
    </div>
  );
}
