interface MatchBadgeProps {
  score: number;
  category: string;
}

export function MatchBadge({ score, category }: MatchBadgeProps) {
  let colorClass: string;
  let label: string;

  if (category === 'cook_now' || score >= 90) {
    colorClass = 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700';
    label = 'Cook Now';
  } else if (category === 'almost_there' || (score >= 50 && score < 90)) {
    colorClass = 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-700';
    label = 'Almost There';
  } else {
    colorClass = 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700';
    label = 'Planner';
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${colorClass}`}
    >
      <span>{Math.round(score)}%</span>
      <span>{label}</span>
    </span>
  );
}
