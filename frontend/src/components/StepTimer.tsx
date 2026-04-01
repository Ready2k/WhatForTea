'use client';

// StepTimer is now a fully-controlled/stateless component.
// All timer state is managed by the parent so it persists when the user
// navigates between cooking steps.

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

interface StepTimerProps {
  remaining: number;
  total: number;
  running: boolean;
  done: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
}

export function StepTimer({ remaining, total, running, done, onStart, onPause, onReset }: StepTimerProps) {
  const pct = total > 0 ? ((total - remaining) / total) * 100 : 100;
  const isLow = remaining <= total * 0.25 && !done;

  return (
    <div className="flex flex-col items-center gap-3">
      {done ? (
        <p className="text-3xl font-bold text-emerald-500">✅ Done!</p>
      ) : (
        <p className={`text-4xl font-mono font-bold tabular-nums transition-colors ${
          isLow ? 'text-orange-500 dark:text-orange-400' : 'text-gray-900 dark:text-white'
        }`}>
          {formatTime(remaining)}
        </p>
      )}

      {/* Progress bar */}
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all duration-1000 ${
            isLow ? 'bg-orange-400' : 'bg-emerald-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex gap-3">
        {!done && (
          <button
            onClick={running ? onPause : onStart}
            className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-semibold text-sm transition-all"
          >
            {running ? 'Pause' : 'Start'}
          </button>
        )}
        <button
          onClick={onReset}
          className="px-5 py-2 rounded-xl bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-semibold text-sm transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
