'use client';

import React from 'react';
import Image from 'next/image';

/**
 * TeaBotTrigger - Floating Trigger for the TeaBot Panel.
 * This can be placed anywhere (e.g. Nav or FAB).
 * It communicates with TeaBotPanel via a custom event 'teabot-toggle'.
 */
export function TeaBotTrigger({ className = "" }: { className?: string }) {
  const toggleTeaBot = () => {
    window.dispatchEvent(new CustomEvent('teabot-toggle'));
  };

  return (
    <button
      onClick={toggleTeaBot}
      className={`p-3 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-500 transition-all active:scale-95 group relative ${className}`}
      aria-label="Open TeaBot"
    >
      <Image
        src="/teabot-chef.png"
        alt="TeaBot Chef"
        width={28}
        height={28}
        className="rounded-full group-hover:scale-110 transition-transform"
      />
      <span className="absolute -top-1 -right-1 flex h-3 w-3">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
      </span>
    </button>
  );
}
