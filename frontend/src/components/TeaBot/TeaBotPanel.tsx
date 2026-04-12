'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Command } from 'lucide-react';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import { RenderA2UI, type A2UIDescriptor, type OnResumeFn } from '@/lib/a2ui';
import { endCookingSession, createCookingSession, fetchCurrentPlan, setWeekPlan } from '@/lib/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  widgets?: A2UIDescriptor[];  // display widgets (recipe_card, pantry_confirm, …)
  actionResult?: string;       // inline status from auto-executed actions
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
const AUTO_EXECUTE_TYPES = new Set(['end_cooking_session', 'navigate', 'start_cooking', 'plan_meal']);

/** Paths the navigate widget is allowed to route to */
const ALLOWED_NAV_PATHS = new Set(['/pantry', '/recipes', '/planner', '/ingest', '/collections', '/profile']);

/** Loose UUID v4 check — rejects obviously bad LLM-hallucinated IDs */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    try {
      const resumeBody = JSON.stringify({ thread_id: tid, decision, quantity });
      let res = await fetch('/api/v1/chat/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: resumeBody,
      });
      if (res.status === 401) {
        const refreshed = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        if (!refreshed.ok) { window.location.href = '/login'; return; }
        res = await fetch('/api/v1/chat/resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: resumeBody,
        });
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

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
          try {
            const event = JSON.parse(raw);
            if (event.type === 'text_delta' && event.content) {
              accumulated += event.content;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], content: accumulated };
                return updated;
              });
            }
          } catch { /* ignore */ }
        }
      }

      const { text } = parseWidgets(accumulated);
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: text };
        return updated;
      });
    } catch (err: any) {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `Sorry, something went wrong. ${err?.message ?? ''}`.trim(),
        };
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

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

    try {
      const body = JSON.stringify({
        messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        thread_id: threadIdRef.current ?? undefined,
      });

      let res = await fetch('/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body,
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
          try {
            const event = JSON.parse(raw);
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
            } else if (event.type === 'hitl_waiting' && event.widget) {
                pendingHitlWidget.current = { ...event.widget, thread_id: event.thread_id };
            } else if (event.type === 'done' && event.thread_id) {
              threadIdRef.current = event.thread_id;
              localStorage.setItem('teabot_thread_id', event.thread_id);
            } else if (event.type === 'error') {
              throw new Error(event.message ?? 'Stream error');
            }
          } catch {
            // ignore malformed SSE lines
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

      // Update message with clean text + display widgets
      setMessages(prev => {
        const updated = [...prev];
        const idx = updated.length - 1;
        if (updated[idx]?.role === 'assistant') {
          updated[idx] = { ...updated[idx], content: text, widgets: displayWidgets };
        }
        return updated;
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
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `Sorry, something went wrong. ${err?.message ?? ''}`.trim(),
        };
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 transition-opacity"
          />

          {/* Side Panel / Bottom Sheet */}
          <motion.div
            initial={isMobile ? { y: '100%' } : { x: '100%' }}
            animate={isMobile ? { y: 0 } : { x: 0 }}
            exit={isMobile ? { y: '100%' } : { x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed bottom-0 w-full h-[88dvh] rounded-t-3xl md:rounded-none md:inset-y-0 md:right-0 md:left-auto md:h-full md:w-[420px] bg-white dark:bg-gray-900 border-t md:border-t-0 md:border-l border-gray-200 dark:border-gray-800 z-50 flex flex-col shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <header className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50">
              <div className="flex items-center gap-3">
                <div className="rounded-xl overflow-hidden shadow-md w-10 h-10 flex-shrink-0">
                  <Image src="/teabot-chef.png" alt="TeaBot Chef" width={40} height={40} className="object-cover" />
                </div>
                <div>
                  <h2 className="font-semibold text-sm">TeaBot</h2>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${isLoading ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                    <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500 dark:text-gray-400">
                      {isLoading ? 'Thinking…' : 'Ready'}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-full transition-colors"
                aria-label="Close TeaBot"
              >
                <X size={20} />
              </button>
            </header>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-6 gap-6">
                  <div className="text-center">
                    <div className="w-24 h-24 mx-auto mb-4 rounded-full overflow-hidden shadow-lg border-4 border-indigo-100 dark:border-indigo-900">
                      <Image src="/teabot-chef.png" alt="TeaBot Chef" width={96} height={96} className="object-cover" />
                    </div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Hello! I'm TeaBot.</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Your kitchen assistant — ask me anything.</p>
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
                        className="w-full text-left px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-700 dark:hover:text-indigo-300 text-sm text-gray-600 dark:text-gray-400 border border-gray-100 dark:border-gray-700 transition-colors"
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
                          ? 'bg-indigo-600 text-white rounded-tr-none'
                          : 'bg-gray-100 dark:bg-gray-800 dark:text-gray-200 rounded-tl-none'
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
                      <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        {msg.actionResult}
                      </div>
                    )}

                    {/* A2UI display widgets below the bubble */}
                    {msg.role === 'assistant' && msg.widgets && msg.widgets.length > 0 && (
                      <div className="w-full mt-2 space-y-2">
                        {msg.widgets.map((descriptor, j) => (
                          <div key={j}>
                            {RenderA2UI(descriptor, handleResume)}
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
            <div className="p-4 border-t border-gray-200 dark:border-gray-800">
              <div className="relative group flex items-center">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Ask TeaBot..."
                  className="w-full bg-gray-100 dark:bg-gray-800 border-transparent focus:border-indigo-500 focus:ring-0 rounded-xl py-3 pl-4 pr-20 text-sm transition-all shadow-inner"
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
                    className="p-2 text-gray-500 hover:text-indigo-500 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
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
                    className="p-2 bg-indigo-500 text-white rounded-lg disabled:opacity-50 disabled:grayscale transition-all shadow-md active:scale-95"
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
  );
}
