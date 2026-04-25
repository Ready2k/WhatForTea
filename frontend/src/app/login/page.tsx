'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { login, joinHousehold } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'join'>('login');

  // Login fields
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Join fields
  const [inviteCode, setInviteCode] = useState('');
  const [joinUsername, setJoinUsername] = useState('');
  const [joinDisplayName, setJoinDisplayName] = useState('');
  const [joinEmail, setJoinEmail] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinConfirm, setJoinConfirm] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      router.replace('/');
    } catch (err: any) {
      setError(err.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (joinPassword !== joinConfirm) {
      setError('Passwords do not match');
      return;
    }
    if (joinPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      await joinHousehold({
        invite_code: inviteCode.trim(),
        username: joinUsername.trim(),
        display_name: joinDisplayName.trim(),
        email: joinEmail.trim() || undefined,
        password: joinPassword,
      });
      await login(joinUsername.trim(), joinPassword);
      router.replace('/');
    } catch (err: any) {
      setError(err.message ?? 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next: 'login' | 'join') {
    setError(null);
    setMode(next);
  }

  return (
    // Negate the sidebar offset applied by the root layout on desktop
    <main className="md:-ml-[220px] md:w-[calc(100%+220px)] bg-white dark:bg-gray-950">

      {/* ── Hero ── */}
      <section className="relative pt-20 pb-32 overflow-hidden bg-gradient-to-b from-indigo-950 via-indigo-900 to-indigo-800">
        <div
          className="absolute inset-0 pointer-events-none opacity-30"
          style={{
            backgroundImage:
              'radial-gradient(circle at 15% 85%, #6366f1 0%, transparent 45%), radial-gradient(circle at 85% 15%, #818cf8 0%, transparent 45%)',
          }}
        />

        <div className="relative max-w-5xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/20 text-indigo-200 text-sm font-medium mb-8">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
            </span>
            Your kitchen, organised
          </div>

          <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight text-white">
            Know what&apos;s for tea,<br />
            <span className="text-indigo-300">before you even ask.</span>
          </h1>

          <p className="text-xl text-indigo-200 mb-10 max-w-2xl mx-auto leading-relaxed">
            Scan your HelloFresh cards, track what&apos;s in the fridge, and let TeaBot plan the week — all from your kitchen.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16">
            <a
              href="#signin"
              className="w-full sm:w-auto px-8 py-4 bg-indigo-500 text-white rounded-xl font-bold shadow-lg shadow-indigo-900/40 hover:bg-indigo-400 hover:-translate-y-0.5 transition-all duration-200"
            >
              Sign In
            </a>
            <a
              href="#signin"
              onClick={() => switchMode('join')}
              className="w-full sm:w-auto px-8 py-4 bg-white/10 text-white rounded-xl font-bold border border-white/20 hover:bg-white/20 transition-all duration-200"
            >
              Join a Household
            </a>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-3xl mx-auto border-t border-white/10 pt-12">
            <div>
              <div className="text-3xl mb-1">📸</div>
              <div className="text-sm text-indigo-300 font-medium">Scan any card</div>
            </div>
            <div>
              <div className="text-3xl mb-1">🧮</div>
              <div className="text-sm text-indigo-300 font-medium">Smart pantry</div>
            </div>
            <div>
              <div className="text-3xl mb-1">📅</div>
              <div className="text-sm text-indigo-300 font-medium">Plan the week</div>
            </div>
            <div>
              <div className="text-3xl mb-1">🤖</div>
              <div className="text-sm text-indigo-300 font-medium">TeaBot AI</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-24 bg-white dark:bg-gray-950">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4 text-gray-900 dark:text-white">Everything your kitchen needs</h2>
            <p className="text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
              From scanning recipe cards to asking what you can cook tonight — WhatsForTea handles the thinking so you don&apos;t have to.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
              <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900 rounded-xl flex items-center justify-center text-2xl mb-6">📸</div>
              <h3 className="text-xl font-bold mb-3 text-gray-900 dark:text-white">Scan Recipe Cards</h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Photograph your HelloFresh cards or paste a URL — Claude extracts every ingredient, quantity, and step in seconds.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-orange-50 dark:bg-orange-950/20 border border-orange-100 dark:border-orange-900/40 hover:border-orange-300 dark:hover:border-orange-700 transition-colors">
              <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/40 rounded-xl flex items-center justify-center text-2xl mb-6">🍽️</div>
              <h3 className="text-xl font-bold mb-3 text-gray-900 dark:text-white">Hangry Matcher</h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                See exactly which recipes you can cook right now based on what&apos;s actually in your fridge and pantry, scored in real time.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-purple-50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/40 hover:border-purple-300 dark:hover:border-purple-700 transition-colors">
              <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/40 rounded-xl flex items-center justify-center text-2xl mb-6">🤖</div>
              <h3 className="text-xl font-bold mb-3 text-gray-900 dark:text-white">TeaBot</h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Ask your AI kitchen assistant to plan the week, suggest substitutes, or check what&apos;s about to expire before it&apos;s too late.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="py-24 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-5xl mx-auto px-4">
          <div className="bg-white dark:bg-gray-800 rounded-3xl p-8 md:p-12 shadow-xl shadow-gray-200/50 dark:shadow-black/20">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div>
                <h2 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">How it works</h2>
                <div className="space-y-8">
                  <div className="flex gap-4">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-sm">1</div>
                    <div>
                      <h4 className="font-bold text-gray-900 dark:text-white mb-1">Scan your recipe cards</h4>
                      <p className="text-gray-500 dark:text-gray-400 text-sm">Take a photo of any HelloFresh card or paste a URL — Claude reads it for you.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-sm">2</div>
                    <div>
                      <h4 className="font-bold text-gray-900 dark:text-white mb-1">Keep your pantry fresh</h4>
                      <p className="text-gray-500 dark:text-gray-400 text-sm">Scan receipts, track expiry dates, and the Hangry Matcher scores what you can cook tonight.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-sm">3</div>
                    <div>
                      <h4 className="font-bold text-gray-900 dark:text-white mb-1">Ask TeaBot</h4>
                      <p className="text-gray-500 dark:text-gray-400 text-sm">Plan the week, generate a shopping list, or just ask &quot;what&apos;s for tea?&quot; — TeaBot has the answer.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative h-64 md:h-full min-h-[280px] bg-indigo-50 dark:bg-indigo-950/40 rounded-2xl overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-purple-600 opacity-10" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                  <span className="text-6xl mb-2 block">🍵</span>
                  <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Your kitchen, sorted</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Sign in ── */}
      <section id="signin" className="py-20 bg-white dark:bg-gray-950">
        <div className="w-full max-w-sm mx-auto px-4 space-y-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              {mode === 'login' ? 'Welcome back' : 'Join a household'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {mode === 'login' ? 'Sign in to your household' : 'You\'ll need an invite code from your admin'}
            </p>
          </div>

          <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
            <button
              onClick={() => switchMode('login')}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                mode === 'login'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => switchMode('join')}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                mode === 'join'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              Join Household
            </button>
          </div>

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="username">Username</label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-2xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
              <div className="text-center">
                <Link href="/forgot-password" className="text-sm text-gray-500 dark:text-gray-400 hover:underline">
                  Forgot password?
                </Link>
              </div>
            </form>
          ) : (
            <form onSubmit={handleJoin} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="invite_code">Invite Code</label>
                <input
                  id="invite_code"
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  required
                  placeholder="Paste code from your household admin"
                  className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="join_username">Username</label>
                <input
                  id="join_username"
                  type="text"
                  autoComplete="username"
                  value={joinUsername}
                  onChange={(e) => setJoinUsername(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="join_display_name">Display Name</label>
                <input
                  id="join_display_name"
                  type="text"
                  autoComplete="name"
                  value={joinDisplayName}
                  onChange={(e) => setJoinDisplayName(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="join_email">
                  Email address <span className="text-gray-400 font-normal">(optional — for password reset)</span>
                </label>
                <input
                  id="join_email"
                  type="email"
                  autoComplete="email"
                  value={joinEmail}
                  onChange={(e) => setJoinEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="join_password">Password</label>
                <input
                  id="join_password"
                  type="password"
                  autoComplete="new-password"
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="join_confirm">Confirm Password</label>
                <input
                  id="join_confirm"
                  type="password"
                  autoComplete="new-password"
                  value={joinConfirm}
                  onChange={(e) => setJoinConfirm(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-2xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
