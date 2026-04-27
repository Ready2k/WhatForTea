'use client';

import { useState, FormEvent, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { login, joinHousehold, registerHousehold, completeGoogleSetup } from '@/lib/api';

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<'login' | 'create' | 'join' | 'google_setup'>('login');

  // Login fields
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Create household fields
  const [householdName, setHouseholdName] = useState('');
  const [createUsername, setCreateUsername] = useState('');
  const [createDisplayName, setCreateDisplayName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createConfirm, setCreateConfirm] = useState('');

  // Join household fields
  const [inviteCode, setInviteCode] = useState('');
  const [joinUsername, setJoinUsername] = useState('');
  const [joinDisplayName, setJoinDisplayName] = useState('');
  const [joinEmail, setJoinEmail] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinConfirm, setJoinConfirm] = useState('');

  // Google setup fields
  const [googleToken, setGoogleToken] = useState('');
  const [googleSetupChoice, setGoogleSetupChoice] = useState<'create' | 'join' | null>(null);
  const [googleHouseholdName, setGoogleHouseholdName] = useState('');
  const [googleInviteCode, setGoogleInviteCode] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const oauthErrors: Record<string, string> = {
    oauth_cancelled: 'Google sign-in was cancelled.',
    oauth_invalid_state: 'Sign-in session expired — please try again.',
    oauth_failed: 'Google sign-in failed — please try again.',
    oauth_no_email: 'Your Google account did not provide an email address.',
  };

  useEffect(() => {
    const errorCode = searchParams.get('error');
    if (errorCode && oauthErrors[errorCode]) {
      setError(oauthErrors[errorCode]);
    }
    const urlMode = searchParams.get('mode');
    const token = searchParams.get('token');
    if (urlMode === 'google_setup' && token) {
      setGoogleToken(token);
      setMode('google_setup');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (createPassword !== createConfirm) {
      setError('Passwords do not match');
      return;
    }
    if (createPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      await registerHousehold({
        household_name: householdName.trim(),
        username: createUsername.trim(),
        display_name: createDisplayName.trim(),
        email: createEmail.trim() || undefined,
        password: createPassword,
      });
      await login(createUsername.trim(), createPassword);
      router.replace('/');
    } catch (err: any) {
      setError(err.message ?? 'Registration failed');
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

  async function handleGoogleComplete(e: FormEvent) {
    e.preventDefault();
    if (!googleSetupChoice) return;
    setError(null);
    setLoading(true);
    try {
      await completeGoogleSetup({
        google_token: googleToken,
        mode: googleSetupChoice,
        household_name: googleSetupChoice === 'create' ? googleHouseholdName.trim() : undefined,
        invite_code: googleSetupChoice === 'join' ? googleInviteCode.trim() : undefined,
      });
      router.replace('/');
    } catch (err: any) {
      setError(err.message ?? 'Setup failed');
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next: 'login' | 'create' | 'join') {
    setError(null);
    setMode(next);
  }

  const tabClass = (m: 'login' | 'create' | 'join') =>
    `flex-1 py-2 text-sm font-medium transition-colors ${
      mode === m
        ? 'bg-brand-primary text-brand-background'
        : 'bg-brand-card dark:bg-brand-primary-hover text-brand-muted dark:text-brand-secondary hover:text-brand-ink dark:hover:text-brand-background'
    }`;

  const inputClass =
    'w-full px-3.5 py-2.5 border border-brand-linen dark:border-brand-primary-hover/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent dark:bg-brand-primary dark:text-brand-background dark:placeholder-brand-secondary/50';

  return (
    <main className="md:-ml-[220px] md:w-[calc(100%+220px)] bg-white dark:bg-gray-950">

      {/* ── Hero ── */}
      <section className="relative pt-20 pb-32 overflow-hidden bg-gradient-to-b from-brand-primary via-brand-primary-hover to-brand-secondary">
        <div
          className="absolute inset-0 pointer-events-none opacity-30"
          style={{
            backgroundImage:
              'radial-gradient(circle at 15% 85%, var(--color-brand-secondary) 0%, transparent 45%), radial-gradient(circle at 85% 15%, var(--color-brand-accent) 0%, transparent 45%)',
          }}
        />

        <div className="relative max-w-5xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/20 text-brand-accent-soft text-sm font-medium mb-8">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
            </span>
            Your kitchen, organised
          </div>

          <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight text-white">
            Know what&apos;s for tea,<br />
            <span className="text-brand-accent-soft">before you even ask.</span>
          </h1>

          <p className="text-xl text-brand-background/80 mb-10 max-w-2xl mx-auto leading-relaxed">
            Scan your HelloFresh cards, track what&apos;s in the fridge, and let TeaBot plan the week — all from your kitchen.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16">
            <a
              href="#signin"
              className="w-full sm:w-auto px-8 py-4 bg-brand-accent text-brand-ink rounded-xl font-bold shadow-lg shadow-brand-primary/40 hover:bg-brand-accent-soft hover:-translate-y-0.5 transition-all duration-200"
            >
              Sign In
            </a>
            <a
              href="#signin"
              onClick={() => switchMode('create')}
              className="w-full sm:w-auto px-8 py-4 bg-white/10 text-white rounded-xl font-bold border border-white/20 hover:bg-white/20 transition-all duration-200"
            >
              Get Started
            </a>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-3xl mx-auto border-t border-white/10 pt-12">
            <div>
              <div className="text-3xl mb-1">📸</div>
              <div className="text-sm text-brand-background/70 font-medium">Scan any card</div>
            </div>
            <div>
              <div className="text-3xl mb-1">🧮</div>
              <div className="text-sm text-brand-background/70 font-medium">Smart pantry</div>
            </div>
            <div>
              <div className="text-3xl mb-1">📅</div>
              <div className="text-sm text-brand-background/70 font-medium">Plan the week</div>
            </div>
            <div>
              <div className="text-3xl mb-1">🤖</div>
              <div className="text-sm text-brand-background/70 font-medium">TeaBot AI</div>
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
            <div className="p-8 rounded-2xl bg-brand-card dark:bg-brand-primary-hover/30 border border-brand-linen dark:border-brand-primary-hover/50 hover:border-brand-accent transition-colors">
              <div className="w-12 h-12 bg-brand-linen dark:bg-brand-primary-hover rounded-xl flex items-center justify-center text-2xl mb-6">📸</div>
              <h3 className="text-xl font-bold mb-3 text-brand-ink dark:text-brand-background">Scan Recipe Cards</h3>
              <p className="text-brand-muted dark:text-brand-secondary leading-relaxed">
                Photograph your HelloFresh cards or paste a URL — Claude extracts every ingredient, quantity, and step in seconds.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-brand-accent/5 dark:bg-brand-accent/10 border border-brand-accent/20 hover:border-brand-accent transition-colors">
              <div className="w-12 h-12 bg-brand-accent/20 rounded-xl flex items-center justify-center text-2xl mb-6">🍽️</div>
              <h3 className="text-xl font-bold mb-3 text-brand-ink dark:text-brand-background">Hangry Matcher</h3>
              <p className="text-brand-muted dark:text-brand-secondary leading-relaxed">
                See exactly which recipes you can cook right now based on what&apos;s actually in your fridge and pantry, scored in real time.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-brand-herb/5 dark:bg-brand-herb/10 border border-brand-herb/20 hover:border-brand-herb transition-colors">
              <div className="w-12 h-12 bg-brand-herb/20 rounded-xl flex items-center justify-center text-2xl mb-6">🤖</div>
              <h3 className="text-xl font-bold mb-3 text-brand-ink dark:text-brand-background">TeaBot</h3>
              <p className="text-brand-muted dark:text-brand-secondary leading-relaxed">
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
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-linen dark:bg-brand-primary-hover text-brand-primary dark:text-brand-accent flex items-center justify-center font-bold text-sm">1</div>
                    <div>
                      <h4 className="font-bold text-brand-ink dark:text-brand-background mb-1">Scan your recipe cards</h4>
                      <p className="text-brand-muted dark:text-brand-secondary text-sm">Take a photo of any HelloFresh card or paste a URL — Claude reads it for you.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-linen dark:bg-brand-primary-hover text-brand-primary dark:text-brand-accent flex items-center justify-center font-bold text-sm">2</div>
                    <div>
                      <h4 className="font-bold text-brand-ink dark:text-brand-background mb-1">Keep your pantry fresh</h4>
                      <p className="text-brand-muted dark:text-brand-secondary text-sm">Scan receipts, track expiry dates, and the Hangry Matcher scores what you can cook tonight.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-linen dark:bg-brand-primary-hover text-brand-primary dark:text-brand-accent flex items-center justify-center font-bold text-sm">3</div>
                    <div>
                      <h4 className="font-bold text-brand-ink dark:text-brand-background mb-1">Ask TeaBot</h4>
                      <p className="text-brand-muted dark:text-brand-secondary text-sm">Plan the week, generate a shopping list, or just ask &quot;what&apos;s for tea?&quot; — TeaBot has the answer.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative h-64 md:h-full min-h-[280px] bg-brand-card dark:bg-brand-primary rounded-2xl overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-brand-primary to-brand-accent opacity-10" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                  <span className="text-6xl mb-2 block">🍵</span>
                  <span className="text-sm font-medium text-brand-muted dark:text-brand-secondary">Your kitchen, sorted</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Sign in / Register ── */}
      <section id="signin" className="py-20 bg-white dark:bg-gray-950">
        <div className="w-full max-w-sm mx-auto px-4 space-y-6">

          {mode === 'google_setup' ? (
            /* ── Google household setup ── */
            <>
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">One more step</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Do you want to create a new household or join an existing one?
                </p>
              </div>

              {!googleSetupChoice ? (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setGoogleSetupChoice('create')}
                    className="p-5 rounded-2xl border-2 border-gray-200 dark:border-gray-700 hover:border-indigo-400 dark:hover:border-indigo-500 text-center transition-colors"
                  >
                    <div className="text-2xl mb-2">🏠</div>
                    <div className="font-semibold text-sm text-gray-900 dark:text-white">Create Household</div>
                    <div className="text-xs text-gray-400 mt-1">Start fresh</div>
                  </button>
                  <button
                    onClick={() => setGoogleSetupChoice('join')}
                    className="p-5 rounded-2xl border-2 border-gray-200 dark:border-gray-700 hover:border-indigo-400 dark:hover:border-indigo-500 text-center transition-colors"
                  >
                    <div className="text-2xl mb-2">🔑</div>
                    <div className="font-semibold text-sm text-gray-900 dark:text-white">Join Household</div>
                    <div className="text-xs text-gray-400 mt-1">Use an invite code</div>
                  </button>
                </div>
              ) : (
                <form onSubmit={handleGoogleComplete} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 space-y-4">
                  {error && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
                      {error}
                    </div>
                  )}
                  {googleSetupChoice === 'create' ? (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="google_household_name">
                        Household Name
                      </label>
                      <input
                        id="google_household_name"
                        type="text"
                        value={googleHouseholdName}
                        onChange={(e) => setGoogleHouseholdName(e.target.value)}
                        required
                        placeholder="e.g. The Cregeens"
                        className={inputClass}
                      />
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="google_invite_code">
                        Invite Code
                      </label>
                      <input
                        id="google_invite_code"
                        type="text"
                        value={googleInviteCode}
                        onChange={(e) => setGoogleInviteCode(e.target.value)}
                        required
                        placeholder="Paste code from your household admin"
                        className={inputClass}
                      />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setGoogleSetupChoice(null); setError(null); }}
                      className="flex-1 py-2.5 border border-gray-200 dark:border-gray-600 text-sm font-medium rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex-1 py-2.5 bg-brand-primary text-brand-background text-sm font-semibold rounded-xl hover:bg-brand-primary-hover disabled:opacity-50 transition-colors"
                    >
                      {loading ? 'Setting up...' : googleSetupChoice === 'create' ? 'Create' : 'Join'}
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            /* ── Normal login / register modes ── */
            <>
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {mode === 'login' ? 'Welcome back' : mode === 'create' ? 'Create a household' : 'Join a household'}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {mode === 'login'
                    ? 'Sign in to your household'
                    : mode === 'create'
                    ? 'Set up a new household and admin account'
                    : 'You\'ll need an invite code from your admin'}
                </p>
              </div>

              <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
                <button onClick={() => switchMode('login')} className={tabClass('login')}>Sign In</button>
                <button onClick={() => switchMode('create')} className={tabClass('create')}>Create</button>
                <button onClick={() => switchMode('join')} className={tabClass('join')}>Join</button>
              </div>

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
                  {error}
                </div>
              )}

              {mode === 'login' && (
                <form onSubmit={handleLogin} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 space-y-4">
                  <a
                    href="/api/auth/google"
                    className="flex items-center justify-center gap-3 w-full py-2.5 px-4 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
                      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
                      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
                      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
                    </svg>
                    Continue with Google
                  </a>

                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                    or sign in with password
                    <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="username">Username</label>
                    <input id="username" type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required className={inputClass} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="password">Password</label>
                    <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className={inputClass} />
                  </div>
                  <button type="submit" disabled={loading} className="w-full py-3 bg-brand-primary text-brand-background font-semibold rounded-2xl hover:bg-brand-primary-hover disabled:opacity-50 transition-colors">
                    {loading ? 'Signing in...' : 'Sign In'}
                  </button>
                  <div className="text-center">
                    <Link href="/forgot-password" className="text-sm text-gray-500 dark:text-gray-400 hover:underline">Forgot password?</Link>
                  </div>
                </form>
              )}

              {mode === 'create' && (
                <form onSubmit={handleCreate} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 space-y-4">
                  <a
                    href="/api/auth/google"
                    className="flex items-center justify-center gap-3 w-full py-2.5 px-4 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
                      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
                      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
                      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
                    </svg>
                    Continue with Google
                  </a>

                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                    or create with password
                    <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="household_name">Household Name</label>
                    <input id="household_name" type="text" value={householdName} onChange={(e) => setHouseholdName(e.target.value)} required placeholder="e.g. The Cregeens" className={inputClass} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="create_username">Username</label>
                    <input id="create_username" type="text" autoComplete="username" value={createUsername} onChange={(e) => setCreateUsername(e.target.value)} required className={inputClass} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="create_display_name">Display Name</label>
                    <input id="create_display_name" type="text" autoComplete="name" value={createDisplayName} onChange={(e) => setCreateDisplayName(e.target.value)} required className={inputClass} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="create_email">
                      Email address <span className="text-gray-400 font-normal">(optional — for password reset)</span>
                    </label>
                    <input id="create_email" type="email" autoComplete="email" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} className={inputClass} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="create_password">Password</label>
                    <input id="create_password" type="password" autoComplete="new-password" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} required minLength={8} className={inputClass} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="create_confirm">Confirm Password</label>
                    <input id="create_confirm" type="password" autoComplete="new-password" value={createConfirm} onChange={(e) => setCreateConfirm(e.target.value)} required className={inputClass} />
                  </div>
                  <button type="submit" disabled={loading} className="w-full py-3 bg-brand-primary text-brand-background font-semibold rounded-2xl hover:bg-brand-primary-hover disabled:opacity-50 transition-colors">
                    {loading ? 'Creating household...' : 'Create Household'}
                  </button>
                </form>
              )}

              {mode === 'join' && (
                <form onSubmit={handleJoin} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="invite_code">Invite Code</label>
                    <input id="invite_code" type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required placeholder="Paste code from your household admin" className={inputClass} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="join_username">Username</label>
                    <input id="join_username" type="text" autoComplete="username" value={joinUsername} onChange={(e) => setJoinUsername(e.target.value)} required className={inputClass} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="join_display_name">Display Name</label>
                    <input id="join_display_name" type="text" autoComplete="name" value={joinDisplayName} onChange={(e) => setJoinDisplayName(e.target.value)} required className={inputClass} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="join_email">
                      Email address <span className="text-gray-400 font-normal">(optional — for password reset)</span>
                    </label>
                    <input id="join_email" type="email" autoComplete="email" value={joinEmail} onChange={(e) => setJoinEmail(e.target.value)} className={inputClass} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="join_password">Password</label>
                    <input id="join_password" type="password" autoComplete="new-password" value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)} required minLength={8} className={inputClass} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="join_confirm">Confirm Password</label>
                    <input id="join_confirm" type="password" autoComplete="new-password" value={joinConfirm} onChange={(e) => setJoinConfirm(e.target.value)} required className={inputClass} />
                  </div>
                  <button type="submit" disabled={loading} className="w-full py-3 bg-brand-primary text-brand-background font-semibold rounded-2xl hover:bg-brand-primary-hover disabled:opacity-50 transition-colors">
                    {loading ? 'Joining...' : 'Join Household'}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}
