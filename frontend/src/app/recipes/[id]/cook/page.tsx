'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useRecipe } from '@/lib/hooks';
import { StepTimer } from '@/components/StepTimer';
import type { Step } from '@/lib/types';

// ── Sub-step parser ──────────────────────────────────────────────────────────
// Splits "a) Do this. b) Do that. c) And this." into an array of task strings.
function parseSubSteps(text: string): string[] {
  // Match segments like "a) ...", "b) ..." etc.
  const lettered = text.split(/(?=\b[a-z]\)\s)/);
  if (lettered.length > 1) {
    return lettered.map((s) => s.trim()).filter(Boolean);
  }
  return [text];
}

// Uppercase the first character of a label like "a)" → "A)"
function formatLabel(s: string): { label: string; body: string } {
  const match = s.match(/^([a-z]\))\s*/);
  if (match) {
    return { label: match[1].toUpperCase(), body: s.slice(match[0].length) };
  }
  return { label: '', body: s };
}

export default function CookingModePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: recipe, isLoading, isError } = useRecipe(id);

  const [currentIndex, setCurrentIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);

  const steps: Step[] = recipe
    ? [...recipe.steps].sort((a, b) => a.order - b.order)
    : [];

  const total = steps.length;
  const currentStep = steps[currentIndex];

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, total - 1));
  }, [total]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  // Voice commands
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = true;
    r.lang = 'en-US';
    r.onresult = (e: any) => {
      const t = e.results[e.results.length - 1][0].transcript.toLowerCase();
      if (t.includes('next')) goNext();
      if (t.includes('back') || t.includes('previous')) goPrev();
    };
    r.onerror = () => {};
    try { r.start(); } catch {}
    recognitionRef.current = r;
    return () => { try { r.stop(); } catch {} };
  }, [currentIndex, goNext, goPrev]);

  // Swipe gesture
  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const delta = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(delta) > 50) {
      if (delta > 0) goNext();
      else goPrev();
    }
    touchStartX.current = null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400 text-lg animate-pulse">Loading recipe…</div>
      </div>
    );
  }

  if (isError || !recipe || steps.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-xl text-gray-800 dark:text-white">Could not load recipe steps.</p>
        <button
          onClick={() => router.back()}
          className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-500"
        >
          Go Back
        </button>
      </div>
    );
  }

  const progressPct = total > 1 ? (currentIndex / (total - 1)) * 100 : 100;
  const isLast = currentIndex === total - 1;
  const subSteps = currentStep ? parseSubSteps(currentStep.text) : [];

  return (
    <div
      className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white flex flex-col select-none transition-colors duration-200"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Top progress bar ── */}
      <div className="w-full h-1 bg-gray-200 dark:bg-gray-700">
        <div
          className="h-1 bg-emerald-500 transition-all duration-500 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700/60">
        <span className="text-sm font-semibold text-gray-600 dark:text-gray-300 truncate max-w-[70%]">
          {recipe.title}
        </span>
        <Link
          href={`/recipes/${id}`}
          className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 flex items-center justify-center transition-colors"
          aria-label="Exit cooking mode"
        >
          <svg className="w-4 h-4 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </Link>
      </header>

      {/* ── Step dots ── */}
      <div className="flex items-center justify-center gap-1.5 py-3 px-4">
        {steps.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentIndex(i)}
            className={`rounded-full transition-all duration-300 ${
              i === currentIndex
                ? 'w-6 h-2 bg-emerald-500'
                : i < currentIndex
                ? 'w-2 h-2 bg-emerald-300 dark:bg-emerald-700'
                : 'w-2 h-2 bg-gray-300 dark:bg-gray-600'
            }`}
            aria-label={`Go to step ${i + 1}`}
          />
        ))}
      </div>

      {/* ── Step content ── */}
      <div className="flex-1 flex flex-col px-4 pb-2 max-w-lg mx-auto w-full overflow-y-auto">

        {/* Step badge */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0 shadow-md shadow-emerald-500/30">
            <span className="text-white font-bold text-sm">{currentIndex + 1}</span>
          </div>
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
            Step {currentIndex + 1} of {total}
          </p>
        </div>

        {/* Sub-steps */}
        <div className="space-y-4">
          {subSteps.map((sub, si) => {
            const { label, body } = formatLabel(sub);
            return (
              <div
                key={si}
                className={`flex gap-3 p-4 rounded-2xl border transition-colors ${
                  subSteps.length === 1
                    ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                }`}
              >
                {label && (
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center justify-center mt-0.5">
                    {label.replace(')', '')}
                  </span>
                )}
                <p className="text-base font-medium leading-relaxed text-gray-800 dark:text-gray-100">
                  {body}
                </p>
              </div>
            );
          })}
        </div>

        {/* Timer */}
        {currentStep.timer_seconds && currentStep.timer_seconds > 0 && (
          <div className="mt-5 p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <StepTimer
              key={`${currentStep.id}-${currentIndex}`}
              seconds={currentStep.timer_seconds}
              autoStart={true}
            />
          </div>
        )}
      </div>

      {/* ── Navigation footer ── */}
      <footer className="px-4 pb-8 pt-3 max-w-lg mx-auto w-full space-y-3">
        {isLast && (
          <Link
            href={`/recipes/${id}`}
            className="block w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white text-center font-semibold text-base rounded-2xl transition-colors shadow-md shadow-emerald-500/30"
          >
            🎉 Finish Cooking
          </Link>
        )}

        <div className="flex gap-3">
          <button
            onClick={goPrev}
            disabled={currentIndex === 0}
            className="flex-1 py-3.5 rounded-2xl bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed font-semibold text-gray-700 dark:text-gray-200 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>

          {!isLast && (
            <button
              onClick={goNext}
              className="flex-1 py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold transition-colors flex items-center justify-center gap-2 shadow-md shadow-emerald-500/30"
            >
              Next
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
