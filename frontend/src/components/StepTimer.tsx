'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface StepTimerProps {
  seconds: number;
  autoStart?: boolean;
  onComplete?: () => void;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function StepTimer({ seconds, autoStart = false, onComplete }: StepTimerProps) {
  const [remaining, setRemaining] = useState(seconds);
  const [running, setRunning] = useState(autoStart);
  const [done, setDone] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    setRemaining(seconds);
    setRunning(autoStart);
    setDone(false);
  }, [seconds, autoStart]);

  useEffect(() => {
    if (!running || done) {
      clearTimer();
      return;
    }

    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearTimer();
          setRunning(false);
          setDone(true);
          onComplete?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return clearTimer;
  }, [running, done, clearTimer, onComplete]);

  function handleReset() {
    clearTimer();
    setRemaining(seconds);
    setRunning(false);
    setDone(false);
  }

  const pct = seconds > 0 ? ((seconds - remaining) / seconds) * 100 : 100;

  return (
    <div className="flex flex-col items-center gap-3">
      {done ? (
        <p className="text-3xl font-bold text-emerald-500">✅ Done!</p>
      ) : (
        <p className="text-4xl font-mono font-bold text-gray-900 dark:text-white tabular-nums">
          {formatTime(remaining)}
        </p>
      )}

      {/* Progress bar */}
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
        <div
          className="bg-emerald-500 h-2 rounded-full transition-all duration-1000"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex gap-3">
        {!done && (
          <button
            onClick={() => setRunning((r) => !r)}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors"
          >
            {running ? 'Pause' : 'Start'}
          </button>
        )}
        <button
          onClick={handleReset}
          className="px-4 py-2 rounded-xl bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-semibold text-sm transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
