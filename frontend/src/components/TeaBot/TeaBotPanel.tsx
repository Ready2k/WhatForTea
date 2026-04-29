'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Command } from 'lucide-react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import { RenderA2UI, type A2UIDescriptor, type OnResumeFn } from '@/lib/a2ui';
import { endCookingSession, createCookingSession, fetchCurrentPlan, setWeekPlan, submitChatFeedback, addShoppingItem } from '@/lib/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  widgets?: A2UIDescriptor[];  // display widgets (recipe_card, pantry_confirm, …)
  actionResult?: string;       // inline status from auto-executed actions
  traceId?: string;            // Langfuse trace ID for this response
  feedback?: 'up' | 'down';   // user rating, set after submission
}

/** Extract <widget>JSON</widget> blocks from text, return clean text + descriptors */
function parseWidgets(raw: string): { text: string; widgets: A2UIDescriptor[] } {
  const widgets: A2UIDescriptor[] = [];
  const text = raw.replace(/<widget>([\s\S]*?)<\/widget>/g, (_match, json) => {
    try {
      const descriptor = JSON.parse(json.trim());
      if (descriptor?.type) widgets.push(descriptor);
    } catch {
      // ignore malformed widget JSON
    }
    return '';
  }).trim();
  return { text, widgets };
}

/** Widget types that are executed silently by the frontend, not rendered as UI */
const AUTO_EXECUTE_TYPES = new Set(['end_cooking_session', 'navigate', 'start_cooking', 'plan_meal', 'shopping_add']);

/** Paths the navigate widget is allowed to route to */
const ALLOWED_NAV_PATHS = new Set(['/pantry', '/recipes', '/planner', '/shopping-list', '/ingest', '/collections', '/profile']);

/** Loose UUID v4 check — rejects obviously bad LLM-hallucinated IDs */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Langfuse session rotation: 4 h idle or 25 h absolute age → new session
const LANGFUSE_IDLE_MS = 4 * 60 * 60 * 1000;
const LANGFUSE_MAX_AGE_MS = 25 * 60 * 60 * 1000;

function getOrRotateLangfuseSession(): string {
  const now = Date.now();
  const stored = localStorage.getItem('teabot_langfuse_session_id');
  const startedAt = Number(localStorage.getItem('teabot_langfuse_session_started_at') ?? 0);
  const lastActive = Number(localStorage.getItem('teabot_langfuse_session_last_active') ?? 0);

  const needsRotation =
    !stored ||
    now - lastActive > LANGFUSE_IDLE_MS ||
    now - startedAt > LANGFUSE_MAX_AGE_MS;

  const sessionId = needsRotation ? crypto.randomUUID() : stored;
  if (needsRotation) {
    localStorage.setItem('teabot_langfuse_session_started_at', String(now));
  }
  localStorage.setItem('teabot_langfuse_session_id', sessionId);
  localStorage.setItem('teabot_langfuse_session_last_active', String(now));
  return sessionId;
}

export function TeaBotPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isMobile, setIsMobile] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const threadIdRef = useRef<string | null>(
    typeof window !== 'undefined' ? localStorage.getItem('teabot_thread_id') : null
  );
  const pendingHitlWidget = useRef<(A2UIDescriptor & { thread_id: string }) | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  /** Execute auto-action widgets; return display widgets + status string */
  const executeActions = useCallback(async (widgets: A2UIDescriptor[]): Promise<{ displayWidgets: A2UIDescriptor[]; actionResult?: string }> => {
    const displayWidgets: A2UIDescriptor[] = [];
    const results: string[] = [];

    for (const w of widgets) {
      if (w.type === 'end_cooking_session') {
        try {
          await endCookingSession(w.session_id as string, { confirmed: !!(w.confirmed) });
          queryClient.invalidateQueries({ queryKey: ['cookingSession'] });
          results.push('✓ Cooking session ended.');
        } catch {
          results.push('⚠ Could not end cooking session — it may have already finished.');
        }

      } else if (w.type === 'start_cooking') {
        const recipeId = w.recipe_id as string;
        if (!UUID_RE.test(recipeId)) {
          results.push('⚠ Could not start cooking — invalid recipe reference.');
        } else {
          try {
            await createCookingSession(recipeId);
            queryClient.invalidateQueries({ queryKey: ['cookingSession'] });
            router.push(`/recipes/${recipeId}/cook`);
            setIsOpen(false);
            results.push(`✓ Starting "${w.recipe_title}"…`);
          } catch {
            results.push(`⚠ Could not start cooking session. Try opening the recipe manually.`);
          }
        }

      } else if (w.type === 'plan_meal') {
        try {
          const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
          const dayName = (w.day_name as string) || dayNames[w.day_of_week as number] || `Day ${w.day_of_week}`;
          // Fetch current plan so we preserve existing days
          let existingEntries: Array<{ day_of_week: number; recipe_id: string; servings?: number }> = [];
          try {
            const current = await fetchCurrentPlan();
            existingEntries = current.entries
              .filter(e => e.day_of_week !== (w.day_of_week as number))
              .map(e => ({ day_of_week: e.day_of_week, recipe_id: e.recipe_id, servings: e.servings }));
          } catch {
            // No existing plan — start fresh
          }
          await setWeekPlan({
            week_start: w.week_start as string,
            entries: [...existingEntries, { day_of_week: w.day_of_week as number, recipe_id: w.recipe_id as string }],
          });
          queryClient.invalidateQueries({ queryKey: ['weekPlan'] });
          results.push(`✓ "${w.recipe_title}" added to ${dayName}.`);
        } catch {
          results.push(`⚠ Could not update the meal plan. Try the Planner page.`);
        }

      } else if (w.type === 'shopping_add') {
        try {
          await addShoppingItem({
            raw_name: w.raw_name as string,
            quantity: (w.quantity as number) ?? 1,
            unit: (w.unit as string) ?? 'count',
          });
          queryClient.invalidateQueries({ queryKey: ['shoppingList'] });
          results.push(`✓ "${w.raw_name}" added to your shopping list.`);
        } catch {
          results.push(`⚠ Could not add to shopping list — try the Planner page.`);
        }

      } else if (w.type === 'navigate') {
        const path = w.path as string;
        if (!ALLOWED_NAV_PATHS.has(path)) {
          results.push(`⚠ Navigation to "${path}" is not allowed.`);
        } else {
          const label = (w.label as string) || path;
          router.push(path);
          setIsOpen(false);
          results.push(`→ Taking you to ${label}…`);
        }

      } else {
        // pantry_confirm, recipe_card, etc. — rendered as UI
        displayWidgets.push(w);
      }
    }

    return { displayWidgets, actionResult: results.length ? results.join(' ') : undefined };
  }, [router, queryClient]);

  /** Called by PantryConfirm (HITL mode) — resumes the paused graph and streams the result. */
  const handleResume: OnResumeFn = useCallback(async (decision, quantity) => {
    const tid = threadIdRef.current;
    if (!tid) return;

    setIsLoading(true);
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    const abort = new AbortController();
    streamAbortRef.current = abort;

    try {
      const resumeBody = JSON.stringify({ thread_id: tid, decision, quantity, session_id: getOrRotateLangfuseSession() });
      let res = await fetch('/api/v1/chat/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: resumeBody,
        signal: abort.signal,
      });
      if (res.status === 401) {
        const refreshed = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        if (!refreshed.ok) { window.location.href = '/login'; return; }
        res = await fetch('/api/v1/chat/resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: resumeBody,
          signal: abort.signal,
        });
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      let resumeHitlWidget: (A2UIDescriptor & { thread_id: string }) | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          let event: any;
          try {
            event = JSON.parse(raw);
          } catch {
            continue; // genuinely malformed JSON — skip
          }
          if (event.type === 'text_delta' && event.content) {
            accumulated += event.content;
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { ...updated[updated.length - 1], content: accumulated };
              return updated;
            });
          } else if (event.type === 'TEXT_MESSAGE_CONTENT' && event.delta) {
            // Support for AIMock AGUI mock responses
            accumulated += event.delta;
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { ...updated[updated.length - 1], content: accumulated };
              return updated;
            });
          } else if (event.type === 'ACTIVITY_SNAPSHOT' && event.activityType && event.content) {
            // Support for AIMock AGUI widget snapshots
            const widgetStr = `<widget>${JSON.stringify({ type: event.activityType, ...event.content })}</widget>`;
            accumulated += widgetStr;
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { ...updated[updated.length - 1], content: accumulated };
              return updated;
            });
          } else if (event.type === 'hitl_waiting' && event.widget) {
            resumeHitlWidget = { ...event.widget, thread_id: event.thread_id };
          } else if (event.type === 'error') {
            throw new Error(event.message ?? 'Stream error');
          }
        }
      }

      const { text, widgets } = parseWidgets(accumulated);
      const displayWidgets = widgets
        .filter(w => !AUTO_EXECUTE_TYPES.has(w.type))
        .map(w => (w.type === 'pantry_confirm' && resumeHitlWidget ? { ...w, thread_id: resumeHitlWidget.thread_id } : w));
      // If no pantry_confirm came through the text but a hitl_waiting arrived, inject it directly
      if (resumeHitlWidget && !displayWidgets.some(w => w.type === 'pantry_confirm')) {
        displayWidgets.push(resumeHitlWidget);
      }
      const actionWidgets  = widgets.filter(w =>  AUTO_EXECUTE_TYPES.has(w.type));

      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: text, widgets: displayWidgets };
        return updated;
      });

      if (actionWidgets.length > 0) {
        const { actionResult } = await executeActions(actionWidgets);
        if (actionResult) {
          setMessages(prev => {
            const updated = [...prev];
            const idx = updated.length - 1;
            if (updated[idx]?.role === 'assistant') {
              updated[idx] = { ...updated[idx], actionResult };
            }
            return updated;
          });
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `Sorry, something went wrong. ${err?.message ?? ''}`.trim(),
        };
        return updated;
      });
    } finally {
      streamAbortRef.current = null;
      setIsLoading(false);
    }
  }, [executeActions]);

  const handleFeedback = useCallback(async (msgIndex: number, value: 1 | -1) => {
    const msg = messages[msgIndex];
    if (!msg?.traceId || msg.feedback) return;
    setMessages(prev => {
      const updated = [...prev];
      updated[msgIndex] = { ...updated[msgIndex], feedback: value === 1 ? 'up' : 'down' };
      return updated;
    });
    try {
      await submitChatFeedback(msg.traceId, value);
    } catch {
      // Revert on failure
      setMessages(prev => {
        const updated = [...prev];
        updated[msgIndex] = { ...updated[msgIndex], feedback: undefined };
        return updated;
      });
    }
  }, [messages]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handleToggle = () => setIsOpen(prev => !prev);
    window.addEventListener('teabot-toggle', handleToggle);
    return () => window.removeEventListener('teabot-toggle', handleToggle);
  }, []);

  // Abort any in-flight SSE stream when the panel closes or the component unmounts
  useEffect(() => {
    if (!isOpen) {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
    }
    return () => {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
    };
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSend = async (override?: string) => {
    const userContent = (override ?? input).trim();
    if (!userContent || isLoading) return;
    setInput('');

    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: userContent }];
    setMessages(newMessages);
    setIsLoading(true);

    // Add empty assistant placeholder
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    const abort = new AbortController();
    streamAbortRef.current = abort;

    try {
      // Only send the current user message — LangGraph checkpointer holds full
      // thread history on the backend; sending the entire array wastes bandwidth
      // and doesn't change what the LLM sees (backend uses user_messages[-1] only).
      const body = JSON.stringify({
        messages: [{ role: 'user', content: userContent }],
        thread_id: threadIdRef.current ?? undefined,
        session_id: getOrRotateLangfuseSession(),
      });

      let res = await fetch('/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body,
        signal: abort.signal,
      });

      // Attempt silent token refresh on 401, then retry once
      if (res.status === 401) {
        const refreshed = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        if (!refreshed.ok) {
          window.location.href = '/login';
          return;
        }
        res = await fetch('/api/v1/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body,
          signal: abort.signal,
        });
      }

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = ''; // track full response locally — avoids reading from state

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          let event: any;
          try {
            event = JSON.parse(raw);
          } catch {
            continue; // genuinely malformed JSON — skip
          }
          if (event.type === 'text_delta' && event.content) {
            accumulated += event.content;
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                content: accumulated,
              };
              return updated;
            });
          } else if (event.type === 'TEXT_MESSAGE_CONTENT' && event.delta) {
            // Support for AIMock AGUI mock responses
            accumulated += event.delta;
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                content: accumulated,
              };
              return updated;
            });
          } else if (event.type === 'ACTIVITY_SNAPSHOT' && event.activityType && event.content) {
            // Support for AIMock AGUI widget snapshots
            const widgetStr = `<widget>${JSON.stringify({ type: event.activityType, ...event.content })}</widget>`;
            accumulated += widgetStr;
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                content: accumulated,
              };
              return updated;
            });
          } else if (event.type === 'hitl_waiting' && event.widget) {
            pendingHitlWidget.current = { ...event.widget, thread_id: event.thread_id };
          } else if (event.type === 'done' && event.thread_id) {
            threadIdRef.current = event.thread_id;
            localStorage.setItem('teabot_thread_id', event.thread_id);
            if (event.trace_id) {
              setMessages(prev => {
                const updated = [...prev];
                const idx = updated.length - 1;
                if (updated[idx]?.role === 'assistant') {
                  updated[idx] = { ...updated[idx], traceId: event.trace_id };
                }
                return updated;
              });
            }
          } else if (event.type === 'error') {
            throw new Error(event.message ?? 'Stream error');
          }
        }
      }

      // Stream complete — parse widgets from local variable (not state)
      const { text, widgets } = parseWidgets(accumulated);
      // If the graph signalled a HITL interrupt, inject thread_id into the pantry_confirm widget
      const hitlWidget = pendingHitlWidget.current;
      pendingHitlWidget.current = null;
      const displayWidgets = widgets
        .filter(w => !AUTO_EXECUTE_TYPES.has(w.type))
        .map(w => (w.type === 'pantry_confirm' && hitlWidget ? { ...w, thread_id: hitlWidget.thread_id } : w));
      const actionWidgets  = widgets.filter(w =>  AUTO_EXECUTE_TYPES.has(w.type));

      // Update message with clean text + display widgets, capped at 100 messages
      setMessages(prev => {
        const updated = [...prev];
        const idx = updated.length - 1;
        if (updated[idx]?.role === 'assistant') {
          updated[idx] = { ...updated[idx], content: text, widgets: displayWidgets };
        }
        return updated.length > 100 ? updated.slice(updated.length - 100) : updated;
      });

      // Execute action widgets outside any state setter — safe to navigate here
      if (actionWidgets.length > 0) {
        const { actionResult } = await executeActions(actionWidgets);
        if (actionResult) {
          setMessages(prev => {
            const updated = [...prev];
            const idx = updated.length - 1;
            if (updated[idx]?.role === 'assistant') {
              updated[idx] = { ...updated[idx], actionResult };
            }
            return updated;
          });
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `Sorry, something went wrong. ${err?.message ?? ''}`.trim(),
        };
        return updated;
      });
    } finally {
      streamAbortRef.current = null;
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Backdrop — CSS-controlled so pointer-events: none when closed.
          Kept outside AnimatePresence to prevent iOS Safari getting it stuck
          in the DOM at opacity:0 but still eating all touch events. */}
      <div
        onClick={() => setIsOpen(false)}
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-50 transition-opacity duration-200 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

    <AnimatePresence>
      {isOpen && (
        <>
          {/* Side Panel / Bottom Sheet */}
          <motion.div
            initial={isMobile ? { y: '100%' } : { x: '100%' }}
            animate={isMobile ? { y: 0 } : { x: 0 }}
            exit={isMobile ? { y: '100%' } : { x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed bottom-0 w-full h-[88dvh] rounded-t-3xl md:rounded-none md:inset-y-0 md:right-0 md:left-auto md:h-full md:w-[420px] bg-brand-background dark:bg-brand-primary border-t md:border-t-0 md:border-l border-brand-linen dark:border-brand-primary-hover/50 z-50 flex flex-col shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <header className="p-4 border-b border-brand-linen/20 dark:border-brand-primary-hover/30 flex items-center justify-between bg-brand-linen/10 dark:bg-brand-primary/50">
              <div className="flex items-center gap-3">
                <div className="rounded-xl overflow-hidden shadow-md w-10 h-10 flex-shrink-0">
                  <Image src="/teabot-chef.png" alt="TeaBot Chef" width={40} height={40} className="object-cover" />
                </div>
                <div>
                  <h2 className="font-semibold text-sm">TeaBot</h2>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${isLoading ? 'bg-brand-accent animate-pulse' : 'bg-brand-herb'}`} />
                    <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500 dark:text-gray-400">
                      {isLoading ? 'Thinking…' : 'Ready'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    threadIdRef.current = null;
                    localStorage.removeItem('teabot_thread_id');
                    localStorage.removeItem('teabot_langfuse_session_id');
                    localStorage.removeItem('teabot_langfuse_session_started_at');
                    localStorage.removeItem('teabot_langfuse_session_last_active');
                    setMessages([]);
                  }}
                  className="p-2 hover:bg-brand-linen/20 dark:hover:bg-brand-primary-hover rounded-full transition-colors text-brand-muted hover:text-brand-ink dark:hover:text-brand-background"
                  aria-label="New conversation"
                  title="New conversation"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 hover:bg-brand-linen/20 dark:hover:bg-brand-primary-hover rounded-full transition-colors text-brand-muted hover:text-brand-ink dark:hover:text-brand-background"
                  aria-label="Close TeaBot"
                >
                  <X size={20} />
                </button>
              </div>
            </header>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-6 gap-6">
                  <div className="text-center">
                    <div className="w-24 h-24 mx-auto mb-4 rounded-full overflow-hidden shadow-lg border-4 border-brand-linen dark:border-brand-primary-hover/50">
                      <Image src="/teabot-chef.png" alt="TeaBot Chef" width={96} height={96} className="object-cover" />
                    </div>
                    <p className="text-sm font-semibold text-brand-ink dark:text-brand-background">Hello! I&apos;m TeaBot.</p>
                    <p className="text-xs text-brand-muted dark:text-brand-secondary mt-1">Your kitchen assistant — ask me anything.</p>
                  </div>
                  <div className="w-full space-y-2">
                    {[
                      "What's for tea tonight?",
                      "What can I cook right now?",
                      "Plan this week's meals",
                      "What's going off in my pantry?",
                      "Show me something quick and easy",
                    ].map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => handleSend(prompt)}
                        className="w-full text-left px-4 py-2.5 rounded-xl bg-brand-card dark:bg-brand-primary-hover/50 hover:bg-brand-linen/20 dark:hover:bg-brand-primary-hover hover:text-brand-primary dark:hover:text-brand-accent text-sm text-brand-muted dark:text-brand-secondary border border-brand-linen/10 dark:border-brand-primary-hover/20 transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    {/* Text bubble */}
                    {(msg.content || (msg.role === 'assistant' && isLoading && i === messages.length - 1)) && (
                      <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${
                        msg.role === 'user'
                          ? 'bg-brand-primary text-brand-background rounded-tr-none shadow-md shadow-brand-primary/10'
                          : 'bg-brand-card dark:bg-brand-primary-hover/80 text-brand-ink dark:text-brand-background border border-brand-linen/10 dark:border-brand-primary-hover/30 rounded-tl-none'
                      }`}>
                        {msg.role === 'user' ? (
                          <span>{msg.content}</span>
                        ) : msg.content ? (
                          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                        ) : isLoading && i === messages.length - 1 ? (
                          <span className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
                            <span className="inline-flex gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
                              <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
                              <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
                            </span>
                          </span>
                        ) : null}
                      </div>
                    )}

                    {/* Action result status */}
                    {msg.role === 'assistant' && msg.actionResult && (
                      <div className="mt-2 text-xs text-brand-herb font-medium">
                        {msg.actionResult}
                      </div>
                    )}

                    {/* Feedback thumbs — only on completed assistant messages with a trace */}
                    {msg.role === 'assistant' && msg.traceId && !(isLoading && i === messages.length - 1) && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <button
                          onClick={() => handleFeedback(i, 1)}
                          disabled={!!msg.feedback}
                          aria-label="Helpful"
                          className={`p-1 rounded-md transition-colors ${
                            msg.feedback === 'up'
                              ? 'text-brand-herb'
                              : 'text-brand-linen dark:text-brand-primary-hover hover:text-brand-herb dark:hover:text-brand-herb disabled:opacity-40'
                          }`}
                        >
                          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                            <path d="M8.864.046C7.908-.193 7.02.53 6.956 1.466c-.072 1.051-.23 2.016-.428 2.59-.125.36-.479 1.013-1.04 1.639-.557.623-1.282 1.178-2.131 1.41C2.685 7.288 2 7.87 2 8.72v4.001c0 .845.682 1.464 1.448 1.545 1.07.114 1.564.415 2.068.723l.048.03c.272.165.578.348.97.484.397.136.861.217 1.466.217h3.5c.937 0 1.599-.477 1.934-1.064a1.86 1.86 0 0 0 .254-.912c0-.152-.023-.312-.077-.464.201-.263.38-.578.488-.901.11-.33.172-.762.004-1.149.069-.13.12-.269.159-.403.077-.27.113-.568.113-.857 0-.288-.036-.585-.113-.856a2.144 2.144 0 0 0-.138-.362 1.9 1.9 0 0 0 .234-1.734c-.206-.592-.682-1.1-1.2-1.272-.847-.282-1.803-.276-2.516-.211a9.84 9.84 0 0 0-.443.05 9.365 9.365 0 0 0-.062-4.509A1.38 1.38 0 0 0 9.125.111L8.864.046z"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => handleFeedback(i, -1)}
                          disabled={!!msg.feedback}
                          aria-label="Not helpful"
                          className={`p-1 rounded-md transition-colors ${
                            msg.feedback === 'down'
                              ? 'text-brand-tomato'
                              : 'text-brand-linen dark:text-brand-primary-hover hover:text-brand-tomato dark:hover:text-brand-tomato disabled:opacity-40'
                          }`}
                        >
                          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                            <path d="M8.864 15.674c-.956.24-1.843-.484-1.908-1.42-.072-1.05-.23-2.015-.428-2.59-.125-.36-.479-1.012-1.04-1.638-.557-.624-1.282-1.179-2.131-1.41C2.685 8.432 2 7.85 2 7V3c0-.845.682-1.464 1.448-1.546 1.07-.113 1.564-.415 2.068-.723l.048-.029c.272-.166.578-.349.97-.484C6.931.108 7.395.026 8 .026c.524 0 .968.068 1.376.19.406.12.76.298 1.07.468l.017.009c.285.157.58.322.917.44.346.12.75.19 1.22.19h.013c.658 0 1.108.224 1.394.564.287.34.395.79.359 1.237-.035.432-.196.835-.467 1.127.09.22.146.467.146.724 0 .27-.058.527-.162.76.09.22.14.463.14.713 0 .27-.058.528-.163.761.09.22.14.463.14.713 0 .527-.186 1.03-.504 1.407-.317.376-.79.617-1.385.617H8c-.523 0-.967-.068-1.376-.19a4.37 4.37 0 0 1-1.07-.468l-.017-.01a5.338 5.338 0 0 0-.917-.44C4.273 6.34 3.87 6.27 3.4 6.27H3.39c-.66 0-1.11-.224-1.396-.564-.287-.34-.394-.79-.358-1.237.035-.432.196-.835.467-1.127a2.12 2.12 0 0 1-.146-.724c0-.27.057-.528.162-.76a2.258 2.258 0 0 1-.14-.714c0-.27.058-.528.163-.761a2.078 2.078 0 0 1-.14-.713c0-.528.186-1.03.504-1.407.317-.376.79-.618 1.385-.618h3.5c.937 0 1.6.477 1.934 1.064.232.41.348.9.254 1.39l.022.016z"/>
                          </svg>
                        </button>
                      </div>
                    )}

                    {/* A2UI display widgets below the bubble */}
                    {msg.role === 'assistant' && msg.widgets && msg.widgets.length > 0 && (
                      <div className="w-full mt-2 space-y-2">
                        {msg.widgets.map((descriptor, j) => (
                          <div key={j}>
                            {RenderA2UI(descriptor, handleResume, (value) => handleSend(value))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <div className="p-4 border-t border-brand-linen/20 dark:border-brand-primary-hover/30">
              <div className="relative group flex items-center">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Ask TeaBot..."
                  className="w-full bg-brand-card dark:bg-brand-primary-hover/50 border-transparent focus:border-brand-accent focus:ring-0 rounded-xl py-3 pl-4 pr-20 text-sm transition-all shadow-inner text-brand-ink dark:text-brand-background placeholder-brand-muted/50"
                />
                <div className="absolute right-2 flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
                        alert("Speech recognition isn't supported in this browser.");
                        return;
                      }
                      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
                      const recognition = new SpeechRecognition();
                      recognition.onresult = (event: any) => {
                        const transcript = event.results[0][0].transcript;
                        setInput(prev => prev ? `${prev} ${transcript}` : transcript);
                      };
                      recognition.start();
                    }}
                    className="p-2 text-brand-muted hover:text-brand-primary hover:bg-brand-linen/20 dark:hover:bg-brand-primary-hover rounded-lg transition-colors"
                    title="Dictate message"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                      <line x1="8" y1="22" x2="16" y2="22" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleSend()}
                    disabled={!input.trim() || isLoading}
                    className="p-2 bg-brand-primary text-brand-background rounded-lg disabled:opacity-50 disabled:grayscale transition-all shadow-md active:scale-95 border border-brand-accent/20"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2 opacity-30 px-1">
                <Command size={10} />
                <span className="text-[10px] font-mono">Press Enter to send</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
    </>
  );
}
