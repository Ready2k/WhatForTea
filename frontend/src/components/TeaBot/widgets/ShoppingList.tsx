import React from 'react';
import { ShoppingCart } from 'lucide-react';

export function ShoppingList({ zones = {}, className = '' }: any) {
  const zoneNames = Object.keys(zones);
  
  if (zoneNames.length === 0) {
    return (
      <div className={`p-4 rounded-xl border border-brand-linen dark:border-brand-primary-hover/50 bg-brand-card dark:bg-brand-primary text-center text-sm text-brand-muted dark:text-brand-secondary shadow-sm ${className}`}>
        Your shopping list is empty.
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-xl border border-brand-linen dark:border-brand-primary-hover/50 bg-brand-card dark:bg-brand-primary shadow-sm ${className}`}>
      <div className="flex items-center gap-2 mb-4 border-b border-brand-linen/20 dark:border-brand-primary-hover/30 pb-3">
        <ShoppingCart size={18} className="text-brand-herb" />
        <h3 className="font-bold text-brand-ink dark:text-brand-background leading-tight">
          Shopping List
        </h3>
      </div>
      
      <div className="space-y-4">
        {zoneNames.map(zone => (
          <div key={zone}>
            <h4 className="text-xs font-bold text-brand-muted dark:text-brand-secondary uppercase tracking-wider mb-2">{zone}</h4>
            <div className="space-y-1">
              {zones[zone].map((item: any, idx: number) => (
                <div key={idx} className="flex items-center gap-2 text-sm text-brand-muted dark:text-brand-secondary">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-linen dark:bg-brand-primary-hover/50 shrink-0" />
                  <span className="font-mono text-brand-ink dark:text-brand-background font-medium">
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
