'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useRecipe } from '@/lib/hooks';
import { StepTimer } from '@/components/StepTimer';
import { createCookingSession, patchCookingSession, endCookingSession, sendVoiceCommand } from '@/lib/api';
import { ImageCropModal } from '@/components/ImageCropModal';
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

type Toast = { id: string; message: string; variant: 'halfway' | 'done' | 'teabot' | 'error' };

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

// ── Mic icon SVG ──────────────────────────────────────────────────────────────
function MicIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
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
  const [showRating, setShowRating] = useState(false);
  const [pendingRating, setPendingRating] = useState(0);
  const [pendingNotes, setPendingNotes] = useState('');
  const [isSavingRating, setIsSavingRating] = useState(false);
  const [teabotActive, setTeabotActive] = useState(false);
  const [voiceNotesActive, setVoiceNotesActive] = useState(false);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cardImageVersion, setCardImageVersion] = useState(0);
  const sessionIdRef = useRef<string | null>(null);
  const patchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartX = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const commandRecognitionRef = useRef<any>(null);
  const hasSpeechSynth = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  // iOS WKWebView: speechSynthesis.pause() is silently broken — speech continues unpaused
  const canPause = typeof navigator !== 'undefined' &&
    !/iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const hasSpeechRecognition = typeof window !== 'undefined' && !!(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  );

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

  // ── Session lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!recipe) return;
    // Create a session when the recipe loads; fire-and-forget
    createCookingSession(recipe.id)
      .then((s) => { sessionIdRef.current = s.id; })
      .catch(() => {}); // non-critical — session tracking is best-effort

    return () => {
      // End the session if the component unmounts (browser nav, tab close)
      if (sessionIdRef.current) {
        endCookingSession(sessionIdRef.current).catch(() => {});
      }
      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
      // Stop any active voice command recognition and TTS
      try { commandRecognitionRef.current?.stop(); } catch { /* ignore */ }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe?.id]);

  // ── Persist step progress (debounced) ─────────────────────────────────────
  useEffect(() => {
    if (!sessionIdRef.current) return;
    if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
    patchTimerRef.current = setTimeout(() => {
      if (!sessionIdRef.current) return;
      const stepOrder = steps[currentIndex]?.order ?? currentIndex + 1;
      const completedOrders = steps
        .slice(0, currentIndex)
        .map((s) => s.order);
      patchCookingSession(sessionIdRef.current, {
        current_step: stepOrder,
        completed_steps: completedOrders,
      }).catch(() => {});
    }, 3000); // debounce — only persist if user stays on the step for 3s
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

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
  useEffect(() => {
    if (!hasSpeechSynth) return;
    const isNatural = (v: SpeechSynthesisVoice) => /neural|natural|enhanced|premium/i.test(v.name);
    function pickVoice() {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;
      const saved = localStorage.getItem('wft_tts_voice');
      if (saved) {
        const match = voices.find(v => v.name === saved);
        if (match) { preferredVoiceRef.current = match; return; }
      }
      const enGB = voices.filter(v => v.lang.startsWith('en-GB'));
      const enUS = voices.filter(v => v.lang.startsWith('en-US'));
      const enAny = voices.filter(v => v.lang.startsWith('en'));
      preferredVoiceRef.current =
        enGB.find(isNatural) ?? enGB[0] ?? enUS.find(isNatural) ?? enUS[0] ?? enAny[0] ?? null;
    }
    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [hasSpeechSynth]);

  function speakText(text: string) {
    if (!hasSpeechSynth) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (preferredVoiceRef.current) {
      utterance.voice = preferredVoiceRef.current;
      utterance.lang = preferredVoiceRef.current.lang;
    }
    utterance.onend = () => { setIsSpeaking(false); setIsPaused(false); };
    utterance.onerror = () => { setIsSpeaking(false); setIsPaused(false); };
    setIsSpeaking(true);
    setIsPaused(false);
    window.speechSynthesis.speak(utterance);
  }

  function speakStep() {
    if (!currentStep) return;
    speakText(currentStep.text);
  }

  function stopSpeaking() {
    if (!hasSpeechSynth) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
  }

  function pauseSpeaking() {
    if (!hasSpeechSynth) return;
    window.speechSynthesis.pause();
    setIsPaused(true);
  }

  function resumeSpeaking() {
    if (!hasSpeechSynth) return;
    window.speechSynthesis.resume();
    setIsPaused(false);
  }

  // Cancel speech when the user moves to a different step
  useEffect(() => {
    if (hasSpeechSynth) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setIsPaused(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  // ── TeaBot voice command ─────────────────────────────────────────────────
  function addToast(message: string, variant: Toast['variant']) {
    const id = `${variant}-${Date.now()}`;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
  }

  function startTeabotCommand() {
    if (teabotActive) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    // Stop navigation recognition while TeaBot listens
    try { recognitionRef.current?.stop(); } catch {}
    setTeabotActive(true);
    const r = new SR();
    r.lang = 'en-US';
    r.onresult = async (e: any) => {
      const transcript = Array.from(e.results as SpeechRecognitionResultList)
        .map((res) => (res as SpeechRecognitionResult)[0].transcript)
        .join(' ');
      setTeabotActive(false);
      try {
        const result = await sendVoiceCommand(transcript);
        if (result.intent === 'add_to_list' && result.item) {
          addToast(`Added "${result.item}" to your notes`, 'teabot');
          setPendingNotes((prev) => {
            const line = `Need: ${result.item}`;
            return prev ? `${prev}\n${line}` : line;
          });
        } else if (result.intent === 'session_note' && result.note) {
          addToast('Note saved', 'teabot');
          setPendingNotes((prev) => (prev ? `${prev}\n${result.note}` : result.note!));
        } else if (result.intent === 'navigation') {
          if (result.direction === 'next') { goNext(); } else { goPrev(); }
        } else if (result.intent === 'repeat') {
          speakStep();
        } else if (result.intent === 'stop') {
          stopSpeaking();
        } else if (result.intent === 'cooking_question' && result.answer) {
          addToast(result.answer, 'teabot');
          speakText(result.answer);
        } else {
          addToast('Sorry, I didn\'t catch that', 'error');
        }
      } catch {
        addToast('TeaBot unavailable right now', 'error');
      }
    };
    r.onerror = () => setTeabotActive(false);
    r.onend = () => setTeabotActive(false);
    try { r.start(); } catch { setTeabotActive(false); }
    commandRecognitionRef.current = r;
  }

  function startVoiceNotes() {
    if (voiceNotesActive) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    setVoiceNotesActive(true);
    const r = new SR();
    r.lang = 'en-US';
    r.onresult = async (e: any) => {
      const transcript = Array.from(e.results as SpeechRecognitionResultList)
        .map((res) => (res as SpeechRecognitionResult)[0].transcript)
        .join(' ');
      setVoiceNotesActive(false);
      try {
        const result = await sendVoiceCommand(transcript, 'session_notes');
        const text = result.note ?? transcript;
        setPendingNotes((prev) => (prev ? `${prev}\n${text}` : text));
      } catch {
        // Fallback: use raw transcript
        setPendingNotes((prev) => (prev ? `${prev}\n${transcript}` : transcript));
      }
    };
    r.onerror = () => setVoiceNotesActive(false);
    r.onend = () => setVoiceNotesActive(false);
    try { r.start(); } catch { setVoiceNotesActive(false); }
  }

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
      if (t.includes('next step') || (t.includes('next') && !t.includes('next time'))) goNext();
      else if (t.includes('go back') || t.includes('previous') || t.includes('back')) goPrev();
      else if (t.includes('repeat') || t.includes('read that again') || t.includes('say that again') || t.includes('read it again') || t.includes('what was that')) speakStep();
      else if (t.includes('stop reading') || (t.includes('stop') && !t.includes('stop the'))) stopSpeaking();
      else if (t.includes('teabot') || t.includes('hey tea') || t.includes('add to list') || t.includes('i need') || t.includes('we need')) {
        startTeabotCommand();
      }
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
    if (Math.abs(delta) > 50) { if (delta > 0) { goNext(); } else { goPrev(); } }
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
    <div className="min-h-screen flex bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white select-none transition-colors duration-200">
      {/* Left Pane: Main Cooking Flow */}
      <div 
        className="flex-1 flex flex-col w-full min-w-0"
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
        <span className="text-sm font-semibold text-gray-600 dark:text-gray-300 truncate max-w-[55%]">{recipe.title}</span>
        <div className="flex items-center gap-2">
          {recipe.hero_image_path && (
            <button
              onClick={() => setCropModalOpen(true)}
              className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 flex items-center justify-center transition-colors"
              aria-label="View and crop recipe card"
              title="View / crop recipe card"
            >
              <svg className="w-4 h-4 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14" />
              </svg>
            </button>
          )}
          <button
            onClick={async () => {
              if (sessionIdRef.current) {
                await endCookingSession(sessionIdRef.current).catch(() => {});
                sessionIdRef.current = null;
              }
              router.push(`/recipes/${id}`);
            }}
            className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 flex items-center justify-center transition-colors"
            aria-label="Exit"
          >
            <svg className="w-4 h-4 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
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
      <div className="flex-1 flex flex-col px-4 md:px-12 pb-2 max-w-2xl md:max-w-4xl mx-auto w-full overflow-y-auto pt-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0 shadow-md shadow-emerald-500/30">
            <span className="text-white font-bold text-sm">{currentIndex + 1}</span>
          </div>
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide flex-1">
            Step {currentIndex + 1} of {total}
          </p>
          {hasSpeechSynth && !isSpeaking && (
            <button
              onClick={speakStep}
              aria-label="Read step aloud"
              className="w-9 h-9 rounded-full flex items-center justify-center transition-colors flex-shrink-0 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              <SpeakerIcon muted={true} className="w-5 h-5" />
            </button>
          )}
          {hasSpeechSynth && isSpeaking && (
            <div className="flex items-center gap-1 flex-shrink-0">
              {/* Repeat */}
              <button
                onClick={speakStep}
                aria-label="Repeat step"
                title="Repeat"
                className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              {/* Pause / Resume — hidden on iOS where pause() is broken */}
              {canPause && (
                <button
                  onClick={isPaused ? resumeSpeaking : pauseSpeaking}
                  aria-label={isPaused ? 'Resume reading' : 'Pause reading'}
                  title={isPaused ? 'Resume' : 'Pause'}
                  className="w-8 h-8 rounded-full flex items-center justify-center bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-800/50 transition-colors"
                >
                  {isPaused
                    ? <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    : <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                  }
                </button>
              )}
              {/* Stop */}
              <button
                onClick={stopSpeaking}
                aria-label="Stop reading"
                title="Stop"
                className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500 transition-colors"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
              </button>
            </div>
          )}
          {hasSpeechRecognition && (
            <button
              onClick={startTeabotCommand}
              disabled={teabotActive}
              aria-label={teabotActive ? 'TeaBot listening…' : 'TeaBot voice command'}
              title={teabotActive ? 'Listening…' : 'Say a command (e.g. "add garlic to list")'}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
                teabotActive
                  ? 'bg-emerald-500 text-white animate-pulse shadow-lg shadow-emerald-500/50'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              <MicIcon className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Step crop image */}
        {currentStep?.image_crop_path && (
          <div className="mb-3 rounded-2xl overflow-hidden h-44">
            <img
              src={`/api/v1/recipes/${recipe.id}/steps/${currentStep.order}/image`}
              alt={currentStep.image_description ?? `Step ${currentIndex + 1}`}
              className="w-full h-full object-cover object-top"
            />
          </div>
        )}

        <div className="space-y-3">
          {subSteps.map((sub, si) => {
            const isImportant = sub.type === 'important';
            const isTip = sub.type === 'tip';
            return (
              <div
                key={si}
                onClick={hasSpeechSynth ? () => speakText(sub.text) : undefined}
                className={`group flex gap-3 p-4 rounded-2xl border transition-colors ${
                  hasSpeechSynth ? 'cursor-pointer active:scale-[0.99]' : ''
                } ${
                  isImportant ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/60 hover:bg-red-100/80 dark:hover:bg-red-900/30'
                    : isTip   ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/60 hover:bg-amber-100/80 dark:hover:bg-amber-900/30'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/80'
                }`}
              >
                {sub.label && (
                  <span className={`flex-shrink-0 w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center mt-0.5 ${
                    isImportant ? 'bg-red-100 dark:bg-red-800/50 text-red-700 dark:text-red-300'
                      : isTip   ? 'bg-amber-100 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 text-base'
                      : 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                  }`}>
                    {sub.label.replace(')', '')}
                  </span>
                )}
                <div className="flex-1 flex items-start justify-between gap-2">
                  <p className={`text-base md:text-[22px] md:leading-normal font-medium leading-relaxed ${
                    isImportant ? 'text-red-800 dark:text-red-200'
                      : isTip   ? 'text-amber-800 dark:text-amber-200'
                      : 'text-gray-800 dark:text-gray-100'
                  }`}>
                    {isImportant && <span className="font-bold">Important: </span>}
                    {isTip       && <span className="font-bold">Tip: </span>}
                    {sub.text}
                  </p>
                  {hasSpeechSynth && (
                    <svg className="w-4 h-4 flex-shrink-0 mt-1 opacity-25 group-hover:opacity-60 transition-opacity text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.757 3.63 8.25 4.51 8.25H6.75z" />
                    </svg>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {currentTimerState && (
          <div className="mt-6 p-4 md:hidden rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
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
      <footer className="px-4 md:px-12 pb-8 pt-3 max-w-2xl md:max-w-4xl mx-auto w-full space-y-3">
        {isLast && (
          <button
            onClick={() => setShowRating(true)}
            className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white text-center font-semibold text-base rounded-2xl transition-colors shadow-md shadow-emerald-500/30"
          >
            Finish Cooking
          </button>
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
      </div> {/* End Left Pane */}

      {/* Right Pane: iPad Utilities Sidebar */}
      <aside className="hidden md:flex flex-col w-[340px] flex-shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0f1117] h-screen overflow-y-auto pt-8 shadow-[-10px_0_30px_rgba(0,0,0,0.02)]">
        {currentTimerState ? (
          <div className="px-6 mb-8">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><BellIcon className="w-4 h-4 text-orange-500" /> Active Timer</h3>
            <div className="p-4 rounded-3xl bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700/50 shadow-sm">
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
          </div>
        ) : (
          <div className="px-6 mb-8">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 tracking-wide"><BellIcon className="w-4 h-4 text-gray-400" /> Timer</h3>
            <div className="text-center py-10 rounded-3xl bg-gray-50 dark:bg-gray-800/50 border border-dashed border-gray-200 dark:border-gray-700/50">
               <BellIcon className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2 opacity-50" />
               <p className="text-[11px] text-gray-500 font-medium">No timer required<br/>for this step</p>
            </div>
          </div>
        )}

        <div className="flex-1 px-6 overflow-y-auto">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4 tracking-wide">You&apos;ll Need</h3>
          <ul className="space-y-2">
            {recipe.ingredients.map((ing, i) => (
              <li key={i} className="text-[13px] flex justify-between border-b border-gray-100 dark:border-gray-800/60 pb-2.5 last:border-0 pointer-events-none">
                <span className="text-gray-700 dark:text-gray-300 font-medium truncate pr-3">{ing.raw_name}</span>
                <span className="text-gray-500 dark:text-gray-500 text-right whitespace-nowrap font-medium">{ing.quantity}{ing.unit ? ` ${ing.unit}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
        
        {/* TeaBot Shortcut */}
        <div className="p-6 mt-auto">
           <button 
             onClick={startTeabotCommand}
             disabled={teabotActive}
             className={`w-full p-4 rounded-3xl flex items-center gap-4 transition-all hover:scale-[1.02] active:scale-95 shadow-sm ${teabotActive ? 'bg-indigo-600 text-white animate-pulse' : 'bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 border border-indigo-100 dark:border-indigo-800/50 text-indigo-900 dark:text-indigo-300'}`}
           >
             <div className="relative">
               {teabotActive && <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-indigo-600"></span>}
               <img src="/teabot-chef.png" alt="TeaBot" className="w-12 h-12 rounded-full border-[2px] border-white dark:border-indigo-700/50 bg-indigo-200" />
             </div>
             <div className="text-left leading-tight py-1 flex-1">
               <div className="text-sm font-extrabold tracking-tight">Ask TeaBot</div>
               <div className={`text-[10px] font-medium mt-0.5 ${teabotActive ? 'text-white/80' : 'text-indigo-700/80 dark:text-indigo-400/80'}`}>{teabotActive ? 'Listening...' : 'Voice commands'}</div>
             </div>
             <div className={`w-8 h-8 rounded-full flex items-center justify-center bg-white/50 dark:bg-indigo-900/50 ${teabotActive ? 'bg-white/20 text-white' : 'text-indigo-500'}`}>
               <MicIcon className="w-4 h-4" />
             </div>
           </button>
        </div>
      </aside>

      {/* Post-cook rating overlay */}
      {showRating && (
        <div className="fixed inset-0 z-[10000] bg-gray-900/95 flex flex-col items-center justify-center px-6 text-white">
          <div className="w-full max-w-sm space-y-6">
            <div className="text-center space-y-1">
              <p className="text-4xl">🎉</p>
              <h2 className="text-xl font-bold">Nice work!</h2>
              <p className="text-sm text-gray-400">How did <span className="text-white font-medium">{recipe.title}</span> turn out?</p>
            </div>

            {/* Star rating */}
            <div className="flex justify-center gap-3">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setPendingRating(star)}
                  className={`text-4xl transition-transform hover:scale-110 active:scale-95 ${
                    star <= pendingRating ? 'text-amber-400' : 'text-gray-600'
                  }`}
                  aria-label={`${star} star${star > 1 ? 's' : ''}`}
                >
                  ★
                </button>
              ))}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <textarea
                value={pendingNotes}
                onChange={(e) => setPendingNotes(e.target.value)}
                placeholder="Any notes for next time? (optional)"
                rows={3}
                className="w-full bg-gray-800 border border-gray-600 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              />
              {hasSpeechRecognition && (
                <button
                  type="button"
                  onClick={startVoiceNotes}
                  disabled={voiceNotesActive}
                  className={`flex items-center gap-2 text-sm px-3 py-2 rounded-xl transition-all ${
                    voiceNotesActive
                      ? 'bg-emerald-600 text-white animate-pulse'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  <MicIcon className="w-4 h-4" />
                  {voiceNotesActive ? 'Listening… speak your notes' : 'Dictate notes'}
                </button>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <button
                disabled={isSavingRating}
                onClick={async () => {
                  setIsSavingRating(true);
                  try {
                    if (sessionIdRef.current) {
                      // Save rating and notes first
                      if (pendingRating > 0 || pendingNotes.trim()) {
                        await patchCookingSession(sessionIdRef.current, {
                          rating: pendingRating > 0 ? pendingRating : undefined,
                          notes: pendingNotes.trim() || undefined,
                        }).catch(() => {});
                      }
                      await endCookingSession(sessionIdRef.current, { confirmed: true }).catch(() => {});
                      sessionIdRef.current = null;
                    }
                  } finally {
                    setIsSavingRating(false);
                    router.push(`/recipes/${id}`);
                  }
                }}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold rounded-2xl transition-colors"
              >
                {isSavingRating ? 'Saving…' : 'Done'}
              </button>
              <button
                disabled={isSavingRating}
                onClick={async () => {
                  if (sessionIdRef.current) {
                    await endCookingSession(sessionIdRef.current, { confirmed: false }).catch(() => {});
                    sessionIdRef.current = null;
                  }
                  router.push(`/recipes/${id}`);
                }}
                className="w-full py-2 text-gray-400 hover:text-gray-200 text-sm transition-colors"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast alerts */}
      <div className="fixed bottom-24 left-0 right-0 flex flex-col items-center gap-2 z-[9998] pointer-events-none px-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast-enter w-full max-w-sm flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl text-white font-semibold pointer-events-auto ${
              toast.variant === 'done' ? 'bg-emerald-500' :
              toast.variant === 'teabot' ? 'bg-indigo-600' :
              toast.variant === 'error' ? 'bg-red-600' :
              'bg-orange-500'
            }`}
          >
            <span className="text-2xl flex-shrink-0">
              {toast.variant === 'done' ? '✅' :
               toast.variant === 'teabot' ? '🤖' :
               toast.variant === 'error' ? '❌' : '⏰'}
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

      {cropModalOpen && (
        <ImageCropModal
          recipeId={id}
          imageIndex={0}
          imageVersion={cardImageVersion}
          onClose={() => setCropModalOpen(false)}
          onSaved={() => setCardImageVersion(v => v + 1)}
        />
      )}
    </div>
  );
}
