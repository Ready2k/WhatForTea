import React from 'react';

export function ActionButton({ label, action, style = 'primary', className = '' }: any) {
  return (
    <button
      onClick={() => console.log(`Triggering action ${action}`)}
      className={`px-4 py-2 mt-2 rounded-lg font-medium text-sm transition-colors shadow-sm active:scale-95 ${
        style === 'primary' 
          ? 'bg-brand-primary hover:bg-brand-primary-hover text-brand-background' 
          : 'bg-brand-card dark:bg-brand-primary border border-brand-linen dark:border-brand-primary-hover/50 text-brand-ink dark:text-brand-background hover:bg-brand-linen/10 dark:hover:bg-brand-primary-hover/30'
      } ${className}`}
    >
      {label}
    </button>
  );
}
