import React from 'react';
import { Calendar } from 'lucide-react';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function WeekPlan({ week_start, entries = [], className = '' }: any) {
  
  const getEntryForDay = (dayIndex: number) => {
    return entries.find((e: any) => e.day_of_week === dayIndex);
  };

  return (
    <div className={`p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm ${className}`}>
      <div className="flex items-center gap-2 mb-4 border-b border-gray-100 dark:border-gray-700 pb-3">
        <Calendar size={18} className="text-indigo-500" />
        <h3 className="font-bold text-gray-900 dark:text-white leading-tight">
          Plan for week of {week_start}
        </h3>
      </div>
      
      <div className="space-y-2">
        {DAYS.map((dayName, idx) => {
          const entry = getEntryForDay(idx);
          return (
            <div key={idx} className="flex items-stretch min-h-[44px] bg-gray-50 dark:bg-gray-900/50 rounded-lg overflow-hidden border border-gray-100 dark:border-gray-800">
              <div className="w-12 flex items-center justify-center bg-gray-100 dark:bg-gray-800 font-medium text-xs text-gray-500 shrink-0">
                {dayName}
              </div>
              <div className="flex-1 p-2 flex items-center">
                {entry ? (
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-1">{entry.title}</span>
                    <span className="text-[10px] bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 px-1.5 py-0.5 rounded ml-2 shrink-0">
                      {entry.servings}p
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-gray-400 italic">Unplanned</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
