'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMatches, useAvailable, useCurrentPlan } from '@/lib/hooks';
import { MatchBadge } from '@/components/MatchBadge';
import { getActiveCookingSession, endCookingSession } from '@/lib/api';
import type { RecipeMatchResult } from '@/lib/types';
import Image from 'next/image';
import {
  UtensilsCrossed, ChefHat, AlertTriangle, Flame, CalendarDays,
  ShoppingBasket, ScanLine, PackageSearch, Clock, Users, Sparkles, X,
} from 'lucide-react';

type Mode = 'planning' | 'hangry';

function RecipeCard({ match }: { match: RecipeMatchResult }) {
  const cookedDaysAgo = match.recipe.last_cooked_at
    ? Math.floor((Date.now() - new Date(match.recipe.last_cooked_at).getTime()) / 86400000)
    : null;
  const recentlyCooked = cookedDaysAgo !== null && cookedDaysAgo <= 7;

  return (
    <Link
      href={`/recipes/${match.recipe.id}`}
      className={`flex-shrink-0 w-48 rounded-2xl overflow-hidden bg-brand-card dark:bg-brand-primary/40 shadow-sm border border-brand-linen dark:border-brand-primary/60 hover:shadow-md transition-all ${recentlyCooked ? 'opacity-50' : ''}`}
    >
      <div className="w-full h-28 bg-gradient-to-br from-brand-secondary/20 to-brand-primary/20 dark:from-brand-primary/60 dark:to-brand-primary/80 flex items-center justify-center">
        {match.recipe.hero_image_path ? (
          <img
            src={`/api/v1/recipes/${match.recipe.id}/image`}
            alt={match.recipe.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <UtensilsCrossed className="w-10 h-10 text-brand-herb/40" />
        )}
      </div>
      <div className="p-3 space-y-1.5">
        <p className="text-sm font-semibold text-brand-ink dark:text-brand-background leading-tight line-clamp-2">{match.recipe.title}</p>
        {recentlyCooked ? (
          <p className="text-xs text-brand-muted dark:text-brand-secondary">
            Cooked {cookedDaysAgo === 0 ? 'today' : cookedDaysAgo === 1 ? 'yesterday' : `${cookedDaysAgo}d ago`}
          </p>
        ) : match.recipe.cooking_time_mins ? (
          <p className="text-xs text-brand-muted dark:text-brand-secondary">{match.recipe.cooking_time_mins} min</p>
        ) : null}
        <MatchBadge score={match.score} category={match.category} />
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const [mode, setMode] = useState<Mode>('planning');
  const { data: allMatches, isLoading } = useMatches();
  const { data: available } = useAvailable();
  const { data: currentPlan } = useCurrentPlan();
  const atRiskCount = available?.filter((a) => a.confidence < 0.5).length ?? 0;
  
  const queryClient = useQueryClient();
  const { data: activeSession } = useQuery({
    queryKey: ['cookingSession'],
    queryFn: () => getActiveCookingSession(),
    staleTime: 30_000,
  });
  const cancelSession = useMutation({
    mutationFn: () => endCookingSession(activeSession!.id, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cookingSession'] }),
  });

  const todayIndex = (new Date().getDay() + 6) % 7;
  const tonightPlan = currentPlan?.entries.find(e => e.day_of_week === todayIndex);

  const cookNowCount = allMatches?.filter((m) => m.category === 'cook_now').length ?? 0;

  const filteredMatches = allMatches?.filter(m => {
    if (mode === 'hangry') return m.category === 'cook_now';
    return true;
  }) ?? [];

  const topMatches = filteredMatches.slice(0, 5);

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">

      {/* Resume cooking banner */}
      {activeSession && (
        <div className="flex items-center gap-2 w-full px-4 py-3 bg-brand-secondary/10 dark:bg-brand-primary/30 border border-brand-secondary/20 dark:border-brand-primary/50 rounded-2xl">
          <Link
            href={`/recipes/${activeSession.recipe_id}/cook`}
            className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity"
          >
            <ChefHat className="w-6 h-6 flex-shrink-0 text-brand-primary dark:text-brand-accent" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-brand-primary dark:text-brand-accent-soft truncate">
                Resume cooking
              </p>
              <p className="text-xs text-brand-primary/70 dark:text-brand-accent-soft/70 truncate">
                {activeSession.recipe_title ?? 'Continue where you left off'} — step {activeSession.current_step}
              </p>
            </div>
            <svg className="w-5 h-5 text-brand-herb dark:text-brand-accent flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
          <button
            onClick={() => cancelSession.mutate()}
            disabled={cancelSession.isPending}
            className="flex-shrink-0 p-1.5 rounded-lg text-brand-herb dark:text-brand-accent hover:bg-brand-herb/10 dark:hover:bg-brand-accent/20 disabled:opacity-40 transition-colors"
            title="Dismiss session"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-ink dark:text-brand-background">What&apos;s for Tea?</h1>
          <p className="text-sm text-brand-muted dark:text-brand-secondary mt-0.5">
            {mode === 'hangry' ? 'Quick — what can I cook RIGHT NOW?' : new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <button
          onClick={() => setMode((m) => (m === 'planning' ? 'hangry' : 'planning'))}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
            mode === 'hangry'
              ? 'bg-brand-accent text-brand-ink border-brand-accent shadow-brand-accent/20 shadow-md'
              : 'bg-brand-linen/30 dark:bg-brand-primary/50 text-brand-muted dark:text-brand-secondary border-brand-linen dark:border-brand-primary/70 hover:bg-brand-linen/50 dark:hover:bg-brand-primary/80'
          }`}
        >
          {mode === 'hangry' ? <><Flame className="w-3.5 h-3.5 inline mr-1" />Hangry</> : <><CalendarDays className="w-3.5 h-3.5 inline mr-1" />Planning</>}
        </button>
      </div>

      {/* Smart Layout Header (Option B/E) */}
      {tonightPlan && mode === 'planning' && !activeSession && (
        <div className="bg-gradient-to-br from-brand-primary via-brand-primary-hover to-brand-secondary rounded-[24px] p-5 relative overflow-hidden shadow-lg shadow-brand-primary/20 mt-6 lg:mb-2">
          <div className="absolute top-0 right-0 w-32 h-full opacity-10 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+CjxwYXRoIGQ9Ik0wIDBoNDB2NDBIMHoiIHRpbGw9Im5vbmUiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMiIgZmlsbD0iI2ZmZiIvPgo8L3N2Zz4=')] bg-repeat" />
          <div className="text-[10px] font-bold text-brand-accent-soft tracking-[0.1em] uppercase mb-1.5 z-10 relative">Tonight&apos;s Plan</div>
          <div className="text-xl md:text-2xl font-extrabold text-white leading-tight mb-2 z-10 relative">{tonightPlan.recipe.title}</div>
          <div className="flex gap-2 items-center text-brand-background/90 text-xs font-medium z-10 relative">
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{tonightPlan.recipe.cooking_time_mins || '?'} min</span>
            <span className="opacity-50">·</span>
            <span className="flex items-center gap-1"><Users className="w-3 h-3" />{tonightPlan.servings || 2} servings</span>
          </div>
          <div className="mt-5 flex gap-2 z-10 relative">
            <Link href={`/recipes/${tonightPlan.recipe_id}/cook`} className="bg-white/20 border border-white/30 rounded-xl px-5 py-2 text-xs font-bold text-white hover:bg-white/30 transition-colors shadow-sm text-center">Start Cooking</Link>
            <Link href="/planner" className="border border-white/20 bg-transparent rounded-xl px-4 py-2 text-xs font-medium text-white/80 hover:bg-white/10 transition-colors text-center">Change</Link>
          </div>
        </div>
      )}

      {/* 2x2 Hybrid Dashboard Grid (Option D) */}
      <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 ${tonightPlan ? 'mt-3' : 'mt-6'}`}>
        
        {(!tonightPlan || mode === 'hangry') && (
          <Link href="/recipes?category=cook_now" className="col-span-2 lg:col-span-4 bg-gradient-to-br from-brand-primary to-brand-primary-hover rounded-[20px] p-4 text-brand-background shadow-sm hover:opacity-95 transition-opacity flex items-center justify-between group">
            <div>
              <div className="text-[11px] text-brand-accent-soft font-bold uppercase tracking-wider">Cook Now</div>
              <div className="text-4xl font-extrabold leading-none mt-1 mb-1.5 group-hover:scale-105 transition-transform origin-left">{isLoading ? '-' : cookNowCount}</div>
              <div className="text-[11px] text-brand-background font-medium">recipes ready to make</div>
            </div>
            <div className="text-right hidden sm:block flex-shrink-0 max-w-[220px]">
              {cookNowCount > 0 ? (
                <>
                  <div className="text-[10px] text-white/60 font-medium mb-1.5">Top picks</div>
                  {allMatches?.filter(m => m.category === 'cook_now').slice(0, 2).map((m, i) => (
                    <div key={i} className="text-xs font-semibold text-white mb-0.5 truncate">✓ {m.recipe.title}</div>
                  ))}
                  {cookNowCount > 2 && (
                    <div className="text-[10px] text-white/60 mt-1 hover:text-white/90 transition-colors underline underline-offset-2">
                      +{cookNowCount - 2} more
                    </div>
                  )}
                </>
              ) : (
                <div className="text-right">
                  <div className="text-[11px] text-white/60 leading-snug">Add pantry items<br />to unlock matches</div>
                  <div className="mt-2 inline-block text-[10px] font-bold text-white/80 border border-white/30 rounded-lg px-2 py-1 hover:bg-white/10 transition-colors">
                    Update Pantry →
                  </div>
                </div>
              )}
            </div>
          </Link>
        )}

        {(() => {
          const count = available?.length ?? 0;
          const stockedPct = count === 0 ? 0 : Math.round(available!.reduce((sum, a) => sum + a.confidence, 0) / count * 100);
          return (
            <Link href="/pantry" className="bg-brand-card dark:bg-brand-primary/40 border-brand-linen dark:border-brand-primary/60 border hover:border-brand-accent transition-colors rounded-[20px] p-4">
              <ShoppingBasket className="w-6 h-6 mb-1.5 text-brand-herb" />
              <div className="text-xs font-bold text-brand-ink dark:text-brand-background">My Pantry</div>
              <div className="text-[10px] text-gray-500 mt-0.5 font-medium">{count} ingredients</div>
              {count === 0 ? (
                <div className="mt-2.5 text-[9px] font-semibold text-brand-herb">
                  Add items →
                </div>
              ) : (
                <>
                  <div className="mt-2.5 h-1.5 bg-brand-linen dark:bg-brand-primary/50 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-herb rounded-full transition-all" style={{ width: `${stockedPct}%` }}></div>
                  </div>
                  <div className="text-[9px] text-brand-muted mt-1.5 font-medium">{stockedPct}% stocked</div>
                </>
              )}
            </Link>
          );
        })()}
        
        <Link href="/planner" className="bg-brand-card dark:bg-brand-primary/40 border-brand-linen dark:border-brand-primary/60 border hover:border-brand-accent transition-colors rounded-[20px] p-4">
          <div className="text-[9px] font-bold text-brand-herb mb-1 leading-none tracking-wider uppercase border-b border-transparent">This week</div>
          <div className="text-xs font-bold text-brand-ink dark:text-brand-background border-t border-transparent leading-none mt-1">Meal Plan</div>
          <div className="text-[10px] text-brand-muted mt-1 font-medium">{currentPlan?.entries.length ?? 0} of 7 planned</div>
          {(currentPlan?.entries.length ?? 0) === 0 ? (
            <div className="mt-2.5 text-[9px] font-semibold text-brand-herb">
              Plan your week →
            </div>
          ) : (
            <div className="flex gap-1 mt-2.5 h-6 items-center">
              {['M','T','W','T','F','S','S'].map((day, idx) => {
                const isPlanned = currentPlan?.entries.some(e => e.day_of_week === idx);
                const isToday = todayIndex === idx;
                return (
                  <div key={idx} className={`w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold ${isPlanned ? 'bg-brand-herb text-white' : 'bg-brand-linen/30 dark:bg-brand-primary/50 text-brand-muted'} ${isToday && !isPlanned ? 'ring-2 ring-offset-1 ring-offset-brand-background dark:ring-offset-brand-primary ring-brand-accent bg-brand-accent text-brand-ink' : ''} ${isToday && isPlanned ? 'ring-2 ring-offset-1 ring-offset-brand-background dark:ring-offset-brand-primary ring-brand-herb' : ''}`}>
                    {day}
                  </div>
                );
              })}
            </div>
          )}
        </Link>

        {/* Scan / At Risk subgrid */}
        <div className="col-span-2 lg:col-span-2 grid gap-3 grid-cols-2">
          <Link href="/ingest" className="bg-brand-card dark:bg-brand-primary/40 border-brand-linen dark:border-brand-primary/60 border hover:border-brand-accent transition-colors rounded-[16px] p-3 pl-4 flex items-center gap-3 transition-colors col-span-2 lg:col-span-1">
            <ScanLine className="w-5 h-5 text-brand-muted flex-shrink-0" />
            <div>
              <div className="text-[11px] font-bold text-brand-ink dark:text-brand-background">Scanner</div>
              <div className="text-[9px] text-brand-muted font-medium mt-0.5">Add recipe</div>
            </div>
          </Link>
          
          {atRiskCount > 0 ? (
            <Link href="/recipes?sort=use_it_up" className="bg-brand-tomato/10 border-brand-tomato/30 border hover:bg-brand-tomato/20 rounded-[16px] p-3 pl-4 flex items-center gap-3 transition-colors col-span-2 lg:col-span-1">
              <AlertTriangle className="w-5 h-5 text-brand-tomato flex-shrink-0" />
              <div>
                <div className="text-[11px] font-bold text-brand-tomato">{atRiskCount} going off</div>
                <div className="text-[9px] text-brand-tomato/80 font-medium mt-0.5">Use them up</div>
              </div>
            </Link>
          ) : (
            <div className="bg-brand-card/50 dark:bg-brand-primary-hover/30 border border-transparent dark:border-brand-primary-hover/30 rounded-[16px] p-3 pl-4 flex items-center gap-3 col-span-2 lg:col-span-1 border-dashed">
              <Sparkles className="w-5 h-5 text-brand-linen dark:text-brand-primary-hover flex-shrink-0" />
              <div>
                <div className="text-[11px] font-bold text-brand-muted dark:text-brand-secondary">Pantry clear</div>
                <div className="text-[9px] text-brand-muted dark:text-brand-secondary font-medium mt-0.5">Nothing going off</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top recipes */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-brand-ink dark:text-brand-background">
            {mode === 'hangry' ? <span className="flex items-center gap-1.5"><Flame className="w-4 h-4 text-brand-accent" />Quick Matches</span> : <span className="flex items-center gap-1.5"><CalendarDays className="w-4 h-4 text-brand-herb" />Top Matches</span>}
          </h2>
          <Link href="/recipes" className="text-sm text-brand-primary dark:text-brand-accent font-medium hover:underline">
            See all
          </Link>
        </div>

        {(available?.length ?? 0) === 0 && (allMatches?.length ?? 0) > 0 && (
          <Link href="/pantry" className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-brand-accent-soft/20 border border-brand-accent/20 rounded-xl hover:bg-brand-accent-soft/30 transition-colors">
            <ShoppingBasket className="w-4 h-4 text-brand-accent flex-shrink-0" />
            <p className="text-xs text-brand-primary dark:text-brand-accent-soft flex-1">
              Your pantry is empty — add ingredients to see real match scores.
            </p>
            <span className="text-xs font-semibold text-brand-primary dark:text-brand-accent whitespace-nowrap">Add items →</span>
          </Link>
        )}

        {isLoading ? (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex-shrink-0 w-48 rounded-2xl overflow-hidden bg-brand-card dark:bg-brand-primary-hover/30 shadow-sm border border-brand-linen dark:border-brand-primary-hover/50 animate-pulse">
                <div className="w-full h-28 bg-brand-linen/50 dark:bg-brand-primary-hover/50" />
                <div className="p-3 space-y-2">
                  <div className="h-3 bg-brand-linen/50 dark:bg-brand-primary-hover/50 rounded w-3/4" />
                  <div className="h-3 bg-brand-linen/50 dark:bg-brand-primary-hover/50 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : topMatches.length === 0 ? (
          <div className="text-center py-10 bg-brand-card/50 dark:bg-brand-primary-hover/30 rounded-3xl border border-dashed border-brand-linen dark:border-brand-primary-hover/50 flex flex-col items-center gap-3">
            {allMatches && allMatches.length === 0 ? (
              // No recipes at all — first run
              <>
                <div className="w-16 h-16 rounded-full overflow-hidden border-4 border-brand-accent/20 dark:border-brand-accent/40 shadow">
                  <Image src="/teabot-chef.png" alt="TeaBot" width={64} height={64} className="object-cover" />
                </div>
                <p className="text-sm text-brand-muted dark:text-brand-secondary px-8">
                  No recipes yet — scan your first card to get started!
                </p>
                <Link href="/ingest" className="text-xs font-bold text-brand-primary dark:text-brand-accent hover:underline uppercase tracking-wider">
                  Scan a Card →
                </Link>
              </>
            ) : (
              // Has recipes but nothing matches current pantry / mode
              <>
                <PackageSearch className="w-10 h-10 text-brand-linen dark:text-brand-primary-hover" />
                <p className="text-sm text-brand-muted dark:text-brand-secondary px-8">
                  {mode === 'hangry'
                    ? "Nothing ready to cook right now. Try updating your pantry!"
                    : "No recipes match the current filter."}
                </p>
                {mode === 'hangry' && (
                  <Link href="/pantry" className="text-xs font-bold text-brand-accent hover:text-brand-accent-soft uppercase tracking-wider">
                    Update Pantry →
                  </Link>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
            {topMatches.map((match) => (
              <RecipeCard key={match.recipe.id} match={match} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
