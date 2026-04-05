'use client';

import React, { useState, useEffect } from 'react';
import { useCopilotChat } from '@copilotkit/react-core';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X, Send, Command, Loader2 } from 'lucide-react';
import { RenderA2UI } from '@/lib/a2ui';

/**
 * TeaBotPanel - Phase 1 Foundation.
 * Section 11.2 Compliance: Header status indicator.
 */
export function TeaBotPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isMobile, setIsMobile] = useState(true);
  
  // Suppress TS errors for CopilotKit 1.0+ vs Legacy bindings
  const chatHook = useCopilotChat() as any;
  const messages = chatHook.visibleMessages || chatHook.messages || [];
  const appendMessage = chatHook.appendMessage;
  const isLoading = chatHook.isLoading;

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize(); // init
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Listener for custom open event used by TeaBotTrigger
  useEffect(() => {
    const handleToggle = () => setIsOpen(prev => !prev);
    window.addEventListener('teabot-toggle', handleToggle);
    return () => window.removeEventListener('teabot-toggle', handleToggle);
  }, []);

  const handleSend = async () => {
    if (!input.trim()) return;
    const currentInput = input;
    setInput('');
    // Safely append
    const msg = { content: currentInput, role: 'user' };
    await appendMessage(msg);
  };

  // Mock status for Phase 1 (will be tied to hitl_status later)
  const isWaiting = messages.some((m: any) => m.hitl_status === 'waiting');

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
            {/* Header - Section 11.2 Compliance */}
            <header className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-500 rounded-lg text-white">
                  <Bot size={20} />
                </div>
                <div>
                  <h2 className="font-semibold text-sm">TeaBot</h2>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${isWaiting ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                    <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500 dark:text-gray-400">
                      {isWaiting ? 'Waiting for you' : 'Ready'}
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
                <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-40">
                  <Bot size={48} className="mb-4" />
                  <p className="text-sm font-medium">Hello! I'm TeaBot.</p>
                  <p className="text-xs">Ask me anything about recipes, your pantry, or meal planning.</p>
                </div>
              ) : (
                messages.map((msg: any, i: number) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-tr-none'
                        : 'bg-gray-100 dark:bg-gray-800 dark:text-gray-200 rounded-tl-none'
                    }`}>
                      {msg.content}
                      {/* Placeholder for A2UI Rendering (Phase 2+) */}
                      {msg.role === 'assistant' && (msg as any).a2ui && (
                        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                          {(msg as any).a2ui.map((node: any, j: number) => (
                            <RenderA2UI key={j} {...node} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded-2xl rounded-tl-none flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin text-indigo-500" />
                    <span className="text-xs text-gray-500">TeaBot is thinking...</span>
                  </div>
                </div>
              )}
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
                      if (!('webkitSpeechRecognition' in window)) {
                        alert("Speech recognition isn't supported in this browser.");
                        return;
                      }
                      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
                      const recognition = new SpeechRecognition();
                      recognition.onresult = (event: any) => {
                        const transcript = event.results[0][0].transcript;
                        setInput((prev) => prev ? `${prev} ${transcript}` : transcript);
                      };
                      recognition.start();
                    }}
                    className="p-2 text-gray-500 hover:text-indigo-500 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    title="Dictate message"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                      <line x1="12" y1="19" x2="12" y2="22"></line>
                      <line x1="8" y1="22" x2="16" y2="22"></line>
                    </svg>
                  </button>
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    className="p-2 bg-indigo-500 text-white rounded-lg disabled:opacity-50 disabled:grayscale transition-all shadow-md active:scale-95"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 mt-2 opacity-30 px-1">
                <div className="flex items-center gap-2">
                  <Command size={10} />
                  <span className="text-[10px] font-mono">Press Enter to send</span>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
