interface MatchBadgeProps {
  score: number;
  category: string;
}

export function MatchBadge({ score, category }: MatchBadgeProps) {
  let colorClass: string;
  let label: string;

  if (category === 'cook_now' || score >= 90) {
    colorClass = 'bg-brand-herb/10 text-brand-herb border-brand-herb/20 dark:bg-brand-herb/20 dark:text-brand-background dark:border-brand-herb/30';
    label = 'Cook Now';
  } else if (category === 'almost_there' || (score >= 50 && score < 90)) {
    colorClass = 'bg-brand-accent/10 text-brand-primary border-brand-accent/20 dark:bg-brand-accent/20 dark:text-brand-accent-soft dark:border-brand-accent/30';
    label = 'Almost There';
  } else {
    colorClass = 'bg-brand-tomato/10 text-brand-tomato border-brand-tomato/20 dark:bg-brand-tomato/20 dark:text-brand-tomato dark:border-brand-tomato/30';
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
