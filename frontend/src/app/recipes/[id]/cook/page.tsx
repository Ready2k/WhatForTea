'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useRecipe } from '@/lib/hooks';
import { StepTimer } from '@/components/StepTimer';
import type { Step } from '@/lib/types';

// ── Types ─────────────────────────────────────────────────────────────────────
type SubStep = { text: string; label: string; type: 'task' | 'important' | 'tip' };

type StepTimerState = {
  remaining: number;
  total: number;
  running: boolean;
  done: boolean;
  halfwayAlerted: boolean;
  ringing: boolean;   // true briefly when done or halfway — drives bell shake
  stepNumber: number;
};

type Toast = { id: string; message: string; variant: 'halfway' | 'done' };

// ── Sub-step parser ────────────────────────────────────────────────────────────
function parseSubSteps(raw: string): SubStep[] {
  const lettered = raw.split(/(?=\b[a-z]\)\s)/);
  if (lettered.length > 1) {
    return lettered.map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = s.match(/^([a-z]\))\s*/);
      return { label: m ? m[1].toUpperCase() : '', text: m ? s.slice(m[0].length) : s, type: 'task' };
    });
  }
  const sentences: string[] = [];
  let buf = '';
  for (let i = 0; i < raw.length; i++) {
    buf += raw[i];
    if (raw[i] === '.' && raw[i + 1] === ' ' && raw[i + 2] && /[A-Z]/.test(raw[i + 2])) {
      sentences.push(buf.trim()); buf = ''; i++;
    }
  }
  if (buf.trim()) sentences.push(buf.trim());
  if (sentences.length <= 1) return [{ label: '', text: raw, type: 'task' }];
  return sentences.map((s) => {
    if (/^IMPORTANT:/i.test(s)) return { label: '!', text: s.replace(/^IMPORTANT:\s*/i, ''), type: 'important' };
    if (/^TIP:/i.test(s))       return { label: '💡', text: s.replace(/^TIP:\s*/i, ''),     type: 'tip' };
    return { label: '', text: s, type: 'task' };
  });
}

// ── Speaker icon SVG ──────────────────────────────────────────────────────────
function SpeakerIcon({ muted, className }: { muted: boolean; className?: string }) {
  return muted ? (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.531V19.94a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.506-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.757 3.63 8.25 4.51 8.25H6.75z" />
    </svg>
  );
}

// ── Bell icon SVG ─────────────────────────────────────────────────────────────
function BellIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
      />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function CookingModePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: recipe, isLoading, isError } = useRecipe(id);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [timerStates, setTimerStates] = useState<Record<string, StepTimerState>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const hasSpeechSynth = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // KEY FIX: keep a ref so the setInterval closure always reads fresh timer state
  // without needing setState's functional-updater pattern (which can't produce side effects)
  const timerStatesRef = useRef<Record<string, StepTimerState>>({});

  const steps: Step[] = recipe ? [...recipe.steps].sort((a, b) => a.order - b.order) : [];
  const total = steps.length;
  const currentStep = steps[currentIndex];

  // ── Initialise timer states ──────────────────────────────────────────────
  useEffect(() => {
    if (!recipe || steps.length === 0) return;
    const initial: Record<string, StepTimerState> = {};
    steps.forEach((step, idx) => {
      if (step.timer_seconds && step.timer_seconds > 0) {
        initial[step.id] = {
          remaining: step.timer_seconds,
          total: step.timer_seconds,
          running: false,
          done: false,
          halfwayAlerted: false,
          ringing: false,
          stepNumber: idx + 1,
        };
      }
    });
    timerStatesRef.current = initial;
    setTimerStates(initial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe?.id]);

  // ── Global timer tick ────────────────────────────────────────────────────
  // Reads/writes timerStatesRef directly so no stale closure.
  // Calls setTimerStates + setToasts after computing the new state imperatively.
  useEffect(() => {
    const interval = setInterval(() => {
      const current = timerStatesRef.current;
      const next: Record<string, StepTimerState> = { ...current };
      const pendingToasts: Toast[] = [];
      const ringingIds: string[] = [];
      let changed = false;

      Object.entries(current).forEach(([sid, state]) => {
        if (!state.running || state.done) return;
        changed = true;
        const newRemaining = Math.max(0, state.remaining - 1);
        const isHalfway = !state.halfwayAlerted
          && newRemaining <= Math.floor(state.total / 2)
          && newRemaining > 0;
        const isDone = newRemaining === 0;

        if (isHalfway) {
          pendingToasts.push({
            id: `halfway-${sid}-${Date.now()}`,
            message: `⏰ Step ${state.stepNumber} — halfway through!`,
            variant: 'halfway',
          });
          ringingIds.push(sid);
        }
        if (isDone) {
          pendingToasts.push({
            id: `done-${sid}-${Date.now()}`,
            message: `✅ Step ${state.stepNumber} timer finished!`,
            variant: 'done',
          });
          ringingIds.push(sid);
        }

        next[sid] = {
          ...state,
          remaining: newRemaining,
          done: isDone,
          running: !isDone,
          halfwayAlerted: state.halfwayAlerted || isHalfway,
          ringing: isHalfway || isDone,
        };
      });

      if (changed) {
        timerStatesRef.current = next;
        setTimerStates({ ...next });
      }

      if (pendingToasts.length > 0) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([300, 150, 300, 150, 300]);
        }
        setToasts((prev) => [...prev, ...pendingToasts]);
        pendingToasts.forEach((t) => {
          setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 7000);
        });
      }

      // Clear ringing flag after 5s
      if (ringingIds.length > 0) {
        setTimeout(() => {
          const cleared = { ...timerStatesRef.current };
          ringingIds.forEach((sid) => {
            if (cleared[sid]) cleared[sid] = { ...cleared[sid], ringing: false };
          });
          timerStatesRef.current = cleared;
          setTimerStates({ ...cleared });
        }, 5000);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []); // runs once — all state access via ref

  // ── Timer callbacks ──────────────────────────────────────────────────────
  const handleTimerStart = useCallback((stepId: string) => {
    const s = timerStatesRef.current[stepId];
    if (!s) return;
    const updated = { ...timerStatesRef.current, [stepId]: { ...s, running: true } };
    timerStatesRef.current = updated;
    setTimerStates({ ...updated });
  }, []);

  const handleTimerPause = useCallback((stepId: string) => {
    const s = timerStatesRef.current[stepId];
    if (!s) return;
    const updated = { ...timerStatesRef.current, [stepId]: { ...s, running: false } };
    timerStatesRef.current = updated;
    setTimerStates({ ...updated });
  }, []);

  const handleTimerReset = useCallback((stepId: string) => {
    const s = timerStatesRef.current[stepId];
    if (!s) return;
    const reset: StepTimerState = { ...s, remaining: s.total, running: false, done: false, halfwayAlerted: false, ringing: false };
    const updated = { ...timerStatesRef.current, [stepId]: reset };
    timerStatesRef.current = updated;
    setTimerStates({ ...updated });
  }, []);

  // ── Text-to-speech ────────────────────────────────────────────────────────
  function speakStep() {
    if (!hasSpeechSynth || !currentStep) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(currentStep.text);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if (!hasSpeechSynth) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }

  // Cancel speech when the user moves to a different step
  useEffect(() => {
    if (hasSpeechSynth) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  // ── Navigation ───────────────────────────────────────────────────────────
  const goNext = useCallback(() => setCurrentIndex((i) => Math.min(i + 1, total - 1)), [total]);
  const goPrev = useCallback(() => setCurrentIndex((i) => Math.max(i - 1, 0)), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = true; r.lang = 'en-US';
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

  function handleTouchStart(e: React.TouchEvent) { touchStartX.current = e.touches[0].clientX; }
  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const delta = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(delta) > 50) { delta > 0 ? goNext() : goPrev(); }
    touchStartX.current = null;
  }

  // ── Loading / error ──────────────────────────────────────────────────────
  if (isLoading) return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
      <div className="text-gray-500 dark:text-gray-400 text-lg animate-pulse">Loading recipe…</div>
    </div>
  );
  if (isError || !recipe || steps.length === 0) return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center gap-4 px-6">
      <p className="text-xl text-gray-800 dark:text-white">Could not load recipe steps.</p>
      <button onClick={() => router.back()} className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-500">Go Back</button>
    </div>
  );

  const progressPct = total > 1 ? (currentIndex / (total - 1)) * 100 : 100;
  const isLast = currentIndex === total - 1;
  const subSteps = currentStep ? parseSubSteps(currentStep.text) : [];
  const currentTimerState = currentStep ? timerStates[currentStep.id] : undefined;

  return (
    <div
      className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white flex flex-col select-none transition-colors duration-200"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* CSS for bell ring animation */}
      <style>{`
        @keyframes bellRing {
          0%,100% { transform: rotate(0deg); }
          10%      { transform: rotate(-20deg); }
          20%      { transform: rotate(20deg); }
          30%      { transform: rotate(-18deg); }
          40%      { transform: rotate(18deg); }
          50%      { transform: rotate(-12deg); }
          60%      { transform: rotate(12deg); }
          70%      { transform: rotate(-6deg); }
          80%      { transform: rotate(6deg); }
        }
        .bell-ring {
          animation: bellRing 0.6s ease-in-out infinite;
          transform-origin: top center;
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .toast-enter { animation: slideUp 0.3s ease-out forwards; }
      `}</style>

      {/* Top progress bar */}
      <div className="w-full h-1 bg-gray-200 dark:bg-gray-700">
        <div className="h-1 bg-emerald-500 transition-all duration-500 ease-out" style={{ width: `${progressPct}%` }} />
      </div>

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700/60">
        <span className="text-sm font-semibold text-gray-600 dark:text-gray-300 truncate max-w-[70%]">{recipe.title}</span>
        <Link
          href={`/recipes/${id}`}
          className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 flex items-center justify-center transition-colors"
          aria-label="Exit"
        >
          <svg className="w-4 h-4 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </Link>
      </header>

      {/* Step navigator — dots for plain steps, bell icons for timed steps */}
      <div className="flex items-center justify-center gap-2.5 py-3 px-4">
        {steps.map((step, i) => {
          const ts = step.timer_seconds ? timerStates[step.id] : undefined;
          const hasActiveTimer = ts?.running === true;
          const timerDone = ts?.done === true;
          const isRinging = ts?.ringing === true;
          const isCurrent = i === currentIndex;

          if (ts) {
            // Bell icon for steps that have a timer
            return (
              <button
                key={i}
                onClick={() => setCurrentIndex(i)}
                aria-label={`Step ${i + 1} (has timer)`}
                className={`relative w-7 h-7 flex items-center justify-center rounded-full transition-all ${
                  isCurrent ? 'bg-emerald-500/15 dark:bg-emerald-500/20' : ''
                }`}
              >
                <BellIcon
                  className={`w-5 h-5 transition-colors ${
                    isRinging    ? 'bell-ring text-orange-500 drop-shadow-[0_0_6px_rgba(249,115,22,0.8)]' :
                    timerDone    ? 'text-emerald-500' :
                    hasActiveTimer ? 'text-orange-400 animate-pulse' :
                    isCurrent    ? 'text-emerald-500' :
                    i < currentIndex ? 'text-emerald-300 dark:text-emerald-700' :
                    'text-gray-400 dark:text-gray-600'
                  }`}
                />
                {/* Small pulsing halo when running */}
                {hasActiveTimer && !isRinging && (
                  <span className="absolute inset-0 rounded-full border-2 border-orange-400 animate-ping opacity-60" />
                )}
              </button>
            );
          }

          // Plain dot for steps without a timer
          return (
            <button
              key={i}
              onClick={() => setCurrentIndex(i)}
              aria-label={`Step ${i + 1}`}
              className={`block flex-shrink-0 rounded-full transition-all duration-300 ${
                isCurrent
                  ? 'w-6 h-2.5 bg-emerald-500'
                  : i < currentIndex
                  ? 'w-2.5 h-2.5 bg-emerald-300 dark:bg-emerald-700'
                  : 'w-2.5 h-2.5 bg-gray-300 dark:bg-gray-600'
              }`}
            />
          );
        })}
      </div>

      {/* Step content */}
      <div className="flex-1 flex flex-col px-4 pb-2 max-w-lg mx-auto w-full overflow-y-auto">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0 shadow-md shadow-emerald-500/30">
            <span className="text-white font-bold text-sm">{currentIndex + 1}</span>
          </div>
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide flex-1">
            Step {currentIndex + 1} of {total}
          </p>
          {hasSpeechSynth && (
            <button
              onClick={isSpeaking ? stopSpeaking : speakStep}
              aria-label={isSpeaking ? 'Stop reading' : 'Read step aloud'}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ${
                isSpeaking
                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              <SpeakerIcon muted={!isSpeaking} className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="space-y-3">
          {subSteps.map((sub, si) => {
            const isImportant = sub.type === 'important';
            const isTip = sub.type === 'tip';
            return (
              <div key={si} className={`flex gap-3 p-4 rounded-2xl border ${
                isImportant ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/60'
                  : isTip   ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/60'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
              }`}>
                {sub.label && (
                  <span className={`flex-shrink-0 w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center mt-0.5 ${
                    isImportant ? 'bg-red-100 dark:bg-red-800/50 text-red-700 dark:text-red-300'
                      : isTip   ? 'bg-amber-100 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 text-base'
                      : 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                  }`}>
                    {sub.label.replace(')', '')}
                  </span>
                )}
                <p className={`text-base font-medium leading-relaxed ${
                  isImportant ? 'text-red-800 dark:text-red-200'
                    : isTip   ? 'text-amber-800 dark:text-amber-200'
                    : 'text-gray-800 dark:text-gray-100'
                }`}>
                  {isImportant && <span className="font-bold">Important: </span>}
                  {isTip       && <span className="font-bold">Tip: </span>}
                  {sub.text}
                </p>
              </div>
            );
          })}
        </div>

        {currentTimerState && (
          <div className="mt-5 p-4 rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <StepTimer
              remaining={currentTimerState.remaining}
              total={currentTimerState.total}
              running={currentTimerState.running}
              done={currentTimerState.done}
              onStart={() => handleTimerStart(currentStep.id)}
              onPause={() => handleTimerPause(currentStep.id)}
              onReset={() => handleTimerReset(currentStep.id)}
            />
          </div>
        )}
      </div>

      {/* Navigation footer */}
      <footer className="px-4 pb-8 pt-3 max-w-lg mx-auto w-full space-y-3">
        {isLast && (
          <Link href={`/recipes/${id}`} className="block w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white text-center font-semibold text-base rounded-2xl transition-colors shadow-md shadow-emerald-500/30">
            🎉 Finish Cooking
          </Link>
        )}
        <div className="flex gap-3">
          <button
            onClick={goPrev} disabled={currentIndex === 0}
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

      {/* Toast alerts */}
      <div className="fixed bottom-24 left-0 right-0 flex flex-col items-center gap-2 z-[9998] pointer-events-none px-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast-enter w-full max-w-sm flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl text-white font-semibold pointer-events-auto ${
              toast.variant === 'done' ? 'bg-emerald-500' : 'bg-orange-500'
            }`}
          >
            <span className="text-2xl flex-shrink-0">
              {toast.variant === 'done' ? '✅' : '⏰'}
            </span>
            <span className="text-sm leading-snug">{toast.message}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="ml-auto flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
