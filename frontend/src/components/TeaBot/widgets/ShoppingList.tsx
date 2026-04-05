import React from 'react';
import { ShoppingCart } from 'lucide-react';

export function ShoppingList({ zones = {}, className = '' }: any) {
  const zoneNames = Object.keys(zones);
  
  if (zoneNames.length === 0) {
    return (
      <div className={`p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-center text-sm text-gray-500 shadow-sm ${className}`}>
        Your shopping list is empty.
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm ${className}`}>
      <div className="flex items-center gap-2 mb-4 border-b border-gray-100 dark:border-gray-700 pb-3">
        <ShoppingCart size={18} className="text-emerald-500" />
        <h3 className="font-bold text-gray-900 dark:text-white leading-tight">
          Shopping List
        </h3>
      </div>
      
      <div className="space-y-4">
        {zoneNames.map(zone => (
          <div key={zone}>
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{zone}</h4>
            <div className="space-y-1">
              {zones[zone].map((item: any, idx: number) => (
                <div key={idx} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0" />
                  <span className="font-mono text-gray-900 dark:text-gray-100 font-medium">
                    {item.rounded_quantity === Math.floor(item.rounded_quantity) ? item.rounded_quantity : item.rounded_quantity.toFixed(1)}
                    {item.rounded_unit !== 'count' && item.rounded_unit}
                  </span>
                  <span>{item.canonical_name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
