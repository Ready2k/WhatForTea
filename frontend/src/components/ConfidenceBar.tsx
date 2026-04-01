interface ConfidenceBarProps {
  confidence: number;
  className?: string;
}

export function ConfidenceBar({ confidence, className = '' }: ConfidenceBarProps) {
  const pct = Math.round(Math.min(Math.max(confidence * 100, 0), 100));

  let colorClass: string;
  if (pct >= 70) {
    colorClass = 'bg-emerald-500';
  } else if (pct >= 40) {
    colorClass = 'bg-yellow-400';
  } else {
    colorClass = 'bg-red-500';
  }

  return (
    <div className={`w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden ${className}`}>
      <div
        className={`h-2 rounded-full transition-all duration-300 ${colorClass}`}
        style={{ width: `${pct}%` }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Confidence: ${pct}%`}
      />
    </div>
  );
}
