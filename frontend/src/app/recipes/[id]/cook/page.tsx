'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useRecipe } from '@/lib/hooks';
import { StepTimer } from '@/components/StepTimer';
import type { Step } from '@/lib/types';

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
    r.onerror = () => {}; // silent
    try {
      r.start();
    } catch {
      // ignore
    }
    recognitionRef.current = r;
    return () => {
      try { r.stop(); } catch {}
    };
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
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-lg animate-pulse">Loading recipe...</div>
      </div>
    );
  }

  if (isError || !recipe || steps.length === 0) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center gap-4 text-white px-6">
        <p className="text-xl">Could not load recipe steps.</p>
        <button
          onClick={() => router.back()}
          className="px-5 py-2.5 bg-emerald-600 rounded-xl font-medium hover:bg-emerald-500"
        >
          Go Back
        </button>
      </div>
    );
  }

  const progressPct = total > 1 ? (currentIndex / (total - 1)) * 100 : 100;
  const isLast = currentIndex === total - 1;

  return (
    <div
      className="min-h-screen bg-gray-900 text-white flex flex-col select-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Progress bar */}
      <div className="w-full h-1 bg-gray-700">
        <div
          className="h-1 bg-emerald-400 transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3">
        <span className="text-sm text-gray-400 font-medium truncate max-w-[60%]">{recipe.title}</span>
        <Link
          href={`/recipes/${id}`}
          className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
          aria-label="Exit cooking mode"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </Link>
      </header>

      {/* Step content */}
      <div className="flex-1 flex flex-col justify-center px-6 py-4 max-w-lg mx-auto w-full">
        <p className="text-sm font-medium text-emerald-400 mb-4">
          Step {currentIndex + 1} of {total}
        </p>
        <p className="text-2xl font-medium leading-relaxed text-white">
          {currentStep.text}
        </p>

        {currentStep.timer_seconds && currentStep.timer_seconds > 0 && (
          <div className="mt-8">
            <StepTimer
              key={`${currentStep.id}-${currentIndex}`}
              seconds={currentStep.timer_seconds}
              autoStart={true}
            />
          </div>
        )}
      </div>

      {/* Navigation */}
      <footer className="px-4 pb-8 pt-4 max-w-lg mx-auto w-full space-y-3">
        {isLast ? (
          <Link
            href={`/recipes/${id}`}
            className="block w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white text-center font-semibold text-base rounded-2xl transition-colors"
          >
            Finish Cooking
          </Link>
        ) : null}

        <div className="flex gap-3">
          <button
            onClick={goPrev}
            disabled={currentIndex === 0}
            className="flex-1 py-3.5 rounded-2xl bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>

          {!isLast && (
            <button
              onClick={goNext}
              className="flex-1 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 font-semibold transition-colors flex items-center justify-center gap-2"
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
