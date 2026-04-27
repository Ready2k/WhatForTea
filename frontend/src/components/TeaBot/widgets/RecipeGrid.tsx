'use client';

import React, { useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { RecipeCard } from './RecipeCard';

export function RecipeGrid({ recipes, className = '' }: { recipes: any[]; className?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const scroll = useCallback((dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = el.firstElementChild?.clientWidth ?? 260;
    el.scrollBy({ left: dir === 'right' ? cardWidth + 12 : -(cardWidth + 12), behavior: 'smooth' });
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = (el.firstElementChild?.clientWidth ?? 260) + 12;
    setActiveIdx(Math.round(el.scrollLeft / cardWidth));
  }, []);

  if (!recipes || recipes.length === 0) return null;

  if (recipes.length === 1) {
    return <RecipeCard {...recipes[0]} className={className} />;
  }

  return (
    <div className={`relative ${className}`}>
      {/* Carousel track */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1 scroll-smooth"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {recipes.map((r, idx) => (
          <div key={idx} className="snap-start shrink-0 w-[82%]">
            <RecipeCard {...r} />
          </div>
        ))}
        {/* Trailing spacer so last card doesn't feel clipped */}
        <div className="shrink-0 w-4" aria-hidden />
      </div>

      {/* Dot indicators */}
      <div className="flex justify-center gap-1.5 mt-2">
        {recipes.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              i === activeIdx ? 'w-4 bg-brand-primary' : 'w-1.5 bg-brand-linen dark:bg-brand-primary-hover/40'
            }`}
          />
        ))}
      </div>

      {/* Prev/Next arrows — hidden on touch, visible on hover for desktop */}
      {activeIdx > 0 && (
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 w-7 h-7 rounded-full bg-brand-card dark:bg-brand-primary border border-brand-linen dark:border-brand-primary-hover/50 shadow flex items-center justify-center text-brand-muted hover:text-brand-primary transition-colors hidden md:flex"
          aria-label="Previous"
        >
          <ChevronLeft size={14} />
        </button>
      )}
      {activeIdx < recipes.length - 1 && (
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 w-7 h-7 rounded-full bg-brand-card dark:bg-brand-primary border border-brand-linen dark:border-brand-primary-hover/50 shadow flex items-center justify-center text-brand-muted hover:text-brand-primary transition-colors hidden md:flex"
          aria-label="Next"
        >
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}
