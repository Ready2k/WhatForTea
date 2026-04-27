import React from 'react';
import { Calendar } from 'lucide-react';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function WeekPlan({ week_start, entries = [], className = '' }: any) {
  
  const getEntryForDay = (dayIndex: number) => {
    return entries.find((e: any) => e.day_of_week === dayIndex);
  };

  return (
    <div className={`p-4 rounded-xl border border-brand-linen dark:border-brand-primary-hover/50 bg-brand-card dark:bg-brand-primary shadow-sm ${className}`}>
      <div className="flex items-center gap-2 mb-4 border-b border-brand-linen/50 dark:border-brand-primary-hover/30 pb-3">
        <Calendar size={18} className="text-brand-primary" />
        <h3 className="font-bold text-brand-ink dark:text-brand-background leading-tight">
          Plan for week of {week_start}
        </h3>
      </div>
      
      <div className="space-y-2">
        {DAYS.map((dayName, idx) => {
          const entry = getEntryForDay(idx);
          return (
            <div key={idx} className="flex items-stretch min-h-[44px] bg-brand-linen/10 dark:bg-brand-primary-hover/20 rounded-lg overflow-hidden border border-brand-linen/50 dark:border-brand-primary-hover/30">
              <div className="w-12 flex items-center justify-center bg-brand-linen/20 dark:bg-brand-primary-hover/50 font-medium text-xs text-brand-muted shrink-0">
                {dayName}
              </div>
              <div className="flex-1 p-2 flex items-center">
                {entry ? (
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm font-medium text-brand-ink dark:text-brand-background line-clamp-1">{entry.title}</span>
                    <span className="text-[10px] bg-brand-primary/10 text-brand-primary dark:bg-brand-primary/20 dark:text-brand-secondary px-1.5 py-0.5 rounded ml-2 shrink-0">
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
