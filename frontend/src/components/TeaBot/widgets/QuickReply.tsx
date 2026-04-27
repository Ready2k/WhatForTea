'use client';

import React, { useState } from 'react';

interface QuickReplyOption {
  label: string;
  value: string;
}

export function QuickReply({ options = [], onQuickReply, className = '' }: {
  options?: QuickReplyOption[];
  onQuickReply?: (value: string) => void;
  className?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleSelect = (value: string) => {
    if (selected) return;
    setSelected(value);
    onQuickReply?.(value);
  };

  if (!options.length) return null;

  return (
    <div className={`flex flex-wrap gap-2 mt-1 ${className}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => handleSelect(opt.value)}
          disabled={!!selected}
          className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all active:scale-95 ${
            selected === opt.value
              ? 'bg-brand-primary text-brand-background border-brand-primary shadow-sm'
              : selected
              ? 'bg-brand-card dark:bg-brand-primary-hover/30 text-brand-muted dark:text-brand-secondary border-brand-linen/20 dark:border-brand-primary-hover/20 opacity-40 cursor-not-allowed'
              : 'bg-brand-card dark:bg-brand-primary-hover/50 text-brand-ink dark:text-brand-background border-brand-linen/20 dark:border-brand-primary-hover/30 hover:border-brand-primary hover:text-brand-primary dark:hover:text-brand-accent hover:bg-brand-primary/5'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
