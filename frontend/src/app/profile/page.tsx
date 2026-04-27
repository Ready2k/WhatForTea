'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { logout, adminResetPassword } from '@/lib/api';
import { PushNotifications } from '@/components/PushNotifications';
import {
  useCurrentUser,
  useUpdateUserProfile,
  useChangePassword,
  useHousehold,
  useRotateInviteCode,
  useHouseholdMembers,
  useRemoveHouseholdMember,
} from '@/lib/hooks';

const VOICE_KEY = 'wft_tts_voice';

function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function VoiceSettings() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [previewing, setPreviewing] = useState(false);
  const onIOS = isIOS();

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    setSelected(localStorage.getItem(VOICE_KEY) ?? '');
    function load() {
      const all = window.speechSynthesis.getVoices();
      const en = all.filter(v => v.lang.startsWith('en'));
      if (en.length) setVoices(en);
    }
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  if (typeof window === 'undefined' || !('speechSynthesis' in window) || voices.length === 0) return null;

  function handleChange(name: string) {
    setSelected(name);
    localStorage.setItem(VOICE_KEY, name);
  }

  function handlePreview() {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance('Fry the onion in a little oil until soft, about five minutes.');
    const v = voices.find(v => v.name === selected) ?? null;
    if (v) { u.voice = v; u.lang = v.lang; }
    u.onend = () => setPreviewing(false);
    u.onerror = () => setPreviewing(false);
    setPreviewing(true);
    window.speechSynthesis.speak(u);
  }

  function stopPreview() {
    window.speechSynthesis.cancel();
    setPreviewing(false);
  }

  const gb = voices.filter(v => v.lang.startsWith('en-GB'));
  const us = voices.filter(v => v.lang.startsWith('en-US'));
  const other = voices.filter(v => !v.lang.startsWith('en-GB') && !v.lang.startsWith('en-US'));

  return (
    <section className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Cooking Voice</h2>
      <p className="text-xs text-gray-500 dark:text-zinc-400">Choose the voice used to read recipe steps aloud during cooking.</p>
      {onIOS && (
        <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-lg px-3 py-2">
          On iOS, only built-in system voices are available — Google voices require Chrome on desktop or Android.
        </p>
      )}
      <div className="flex gap-2 items-center">
        <select
          value={selected}
          onChange={e => handleChange(e.target.value)}
          className="flex-1 px-3 py-2 bg-gray-100 dark:bg-zinc-700 border border-gray-300 dark:border-zinc-600 rounded text-sm focus:outline-none focus:border-emerald-500 text-gray-900 dark:text-zinc-200"
        >
          <option value="">Auto (best available)</option>
          {gb.length > 0 && <optgroup label="English (UK)">{gb.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}</optgroup>}
          {us.length > 0 && <optgroup label="English (US)">{us.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}</optgroup>}
          {other.length > 0 && <optgroup label="Other English">{other.map(v => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}</optgroup>}
        </select>
        <button
          onClick={previewing ? stopPreview : handlePreview}
          className={`px-3 py-2 rounded text-sm font-medium transition-colors ${previewing ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
        >
          {previewing ? 'Stop' : 'Preview'}
        </button>
      </div>
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="ml-2 px-2 py-0.5 text-xs bg-gray-200 dark:bg-zinc-700 hover:bg-gray-300 dark:hover:bg-zinc-600 text-gray-700 dark:text-white rounded"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

export default function ProfilePage() {
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const { data: household } = useHousehold();
  const { data: members } = useHouseholdMembers();
  const updateProfile = useUpdateUserProfile();
  const changePw = useChangePassword();
  const rotateInvite = useRotateInviteCode();
  const removeMember = useRemoveHouseholdMember();

  const [displayName, setDisplayName] = useState('');
  const [nameEditing, setNameEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [emailEditing, setEmailEditing] = useState(false);
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [resetTargetName, setResetTargetName] = useState('');
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [removeTargetId, setRemoveTargetId] = useState<string | null>(null);
  const [removeTargetName, setRemoveTargetName] = useState('');
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  if (userLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-zinc-900 text-gray-900 dark:text-white flex items-center justify-center">
        <p className="text-gray-500 dark:text-zinc-400">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-zinc-900 text-gray-900 dark:text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 dark:text-zinc-400 mb-4">Profile not available in legacy auth mode.</p>
          <Link href="/" className="text-emerald-600 dark:text-emerald-400 hover:underline">← Back home</Link>
        </div>
      </div>
    );
  }

  function startEditName() {
    setDisplayName(user!.display_name);
    setNameEditing(true);
  }

  async function saveName() {
    await updateProfile.mutateAsync({ display_name: displayName.trim() });
    setNameEditing(false);
  }

  function startEditEmail() {
    setEmail(user!.email ?? '');
    setEmailEditing(true);
  }

  async function saveEmail() {
    await updateProfile.mutateAsync({ email: email.trim() || '' });
    setEmailEditing(false);
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwError('');
    setPwSuccess(false);
    if (newPw !== confirmPw) {
      setPwError('New passwords do not match');
      return;
    }
    if (newPw.length < 8) {
      setPwError('Password must be at least 8 characters');
      return;
    }
    try {
      await changePw.mutateAsync({ current_password: currentPw, new_password: newPw });
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setPwSuccess(true);
      setTimeout(() => setPwSuccess(false), 3000);
    } catch (err: any) {
      setPwError(err.message ?? 'Password change failed');
    }
  }

  async function handleAdminReset() {
    if (!resetTargetId) return;
    setResetLoading(true);
    setResetError(null);
    try {
      const result = await adminResetPassword(resetTargetId);
      setTempPassword(result.temp_password);
    } catch (err: any) {
      setResetError(err.message ?? 'Reset failed');
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-900 text-gray-900 dark:text-white">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white text-sm">← Home</Link>
          <h1 className="text-2xl font-bold">Profile</h1>
          <button
            onClick={() => logout()}
            className="ml-auto px-3 py-1.5 text-sm bg-gray-200 dark:bg-zinc-700 hover:bg-gray-300 dark:hover:bg-zinc-600 text-gray-700 dark:text-zinc-300 rounded"
          >
            Sign out
          </button>
        </div>

        {/* Profile section */}
        <section className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Your Account</h2>
          <div>
            <p className="text-xs text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1">Username</p>
            <p className="text-gray-800 dark:text-zinc-200">{user.username}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1">Display Name</p>
            {nameEditing ? (
              <div className="flex gap-2">
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-gray-100 dark:bg-zinc-700 border border-gray-300 dark:border-zinc-600 rounded text-sm focus:outline-none focus:border-emerald-500 text-gray-900 dark:text-white"
                />
                <button
                  onClick={saveName}
                  disabled={updateProfile.isPending}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm font-medium text-white"
                >
                  Save
                </button>
                <button
                  onClick={() => setNameEditing(false)}
                  className="px-3 py-1.5 bg-gray-200 dark:bg-zinc-700 hover:bg-gray-300 dark:hover:bg-zinc-600 text-gray-700 dark:text-white rounded text-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <p className="text-gray-800 dark:text-zinc-200">{user.display_name}</p>
                <button onClick={startEditName} className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline">
                  Edit
                </button>
              </div>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1">Email</p>
            {emailEditing ? (
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-gray-100 dark:bg-zinc-700 border border-gray-300 dark:border-zinc-600 rounded text-sm focus:outline-none focus:border-emerald-500 text-gray-900 dark:text-white"
                />
                <button
                  onClick={saveEmail}
                  disabled={updateProfile.isPending}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm font-medium text-white"
                >
                  Save
                </button>
                <button
                  onClick={() => setEmailEditing(false)}
                  className="px-3 py-1.5 bg-gray-200 dark:bg-zinc-700 hover:bg-gray-300 dark:hover:bg-zinc-600 text-gray-700 dark:text-white rounded text-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <p className="text-gray-800 dark:text-zinc-200">{user.email ?? <span className="text-gray-400 dark:text-zinc-500 italic">not set</span>}</p>
                <button onClick={startEditEmail} className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline">
                  {user.email ? 'Edit' : 'Add'}
                </button>
              </div>
            )}
          </div>
          {user.is_admin && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Admin</p>
          )}
        </section>

        {/* Change password */}
        <section className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Change Password</h2>
          <form onSubmit={handlePasswordChange} className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-zinc-400 uppercase tracking-wide block mb-1">Current Password</label>
              <input
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                required
                className="w-full px-3 py-2 bg-gray-100 dark:bg-zinc-700 border border-gray-300 dark:border-zinc-600 rounded text-sm focus:outline-none focus:border-emerald-500 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-zinc-400 uppercase tracking-wide block mb-1">New Password</label>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                required
                minLength={8}
                className="w-full px-3 py-2 bg-gray-100 dark:bg-zinc-700 border border-gray-300 dark:border-zinc-600 rounded text-sm focus:outline-none focus:border-emerald-500 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-zinc-400 uppercase tracking-wide block mb-1">Confirm New Password</label>
              <input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                required
                className="w-full px-3 py-2 bg-gray-100 dark:bg-zinc-700 border border-gray-300 dark:border-zinc-600 rounded text-sm focus:outline-none focus:border-emerald-500 text-gray-900 dark:text-white"
              />
            </div>
            {pwError && <p className="text-red-500 dark:text-red-400 text-sm">{pwError}</p>}
            {pwSuccess && <p className="text-emerald-600 dark:text-emerald-400 text-sm">Password changed successfully.</p>}
            <button
              type="submit"
              disabled={changePw.isPending}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm font-medium text-white"
            >
              {changePw.isPending ? 'Saving…' : 'Update Password'}
            </button>
          </form>
        </section>

        <VoiceSettings />

        {/* Notifications */}
        <section className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl p-6 space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Notifications</h2>
          <PushNotifications />
        </section>

        {/* Household section */}
        {household && (
          <section className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Household</h2>
            <div>
              <p className="text-xs text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1">Name</p>
              <p className="text-gray-800 dark:text-zinc-200">{household.name}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1">Members</p>
              <p className="text-gray-800 dark:text-zinc-200">{household.member_count}</p>
            </div>

            {user.is_admin && (
              <div>
                <p className="text-xs text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1">Invite Code</p>
                <div className="flex items-center gap-2">
                  <code className="bg-gray-100 dark:bg-zinc-700 px-3 py-1.5 rounded text-sm font-mono text-emerald-600 dark:text-emerald-300">
                    {household.invite_code}
                  </code>
                  <CopyButton text={household.invite_code} />
                  <button
                    onClick={() => rotateInvite.mutate()}
                    disabled={rotateInvite.isPending}
                    className="px-2 py-1.5 text-xs bg-gray-200 dark:bg-zinc-700 hover:bg-gray-300 dark:hover:bg-zinc-600 disabled:opacity-50 text-gray-700 dark:text-white rounded"
                  >
                    Rotate
                  </button>
                </div>
                <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">Share this code with household members to let them create an account.</p>
              </div>
            )}

            {members && members.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-2">Members</p>
                <ul className="space-y-2">
                  {members.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 text-sm">
                      <span className="text-gray-800 dark:text-zinc-200">{m.display_name}</span>
                      <span className="text-gray-400 dark:text-zinc-500">@{m.username}</span>
                      {m.is_admin && <span className="text-xs text-emerald-600 dark:text-emerald-400">admin</span>}
                      {m.id === user.id && <span className="text-xs text-gray-400 dark:text-zinc-500">(you)</span>}
                      {user.is_admin && m.id !== user.id && (
                        <div className="ml-auto flex gap-1">
                          <button
                            onClick={() => { setResetTargetId(m.id); setResetTargetName(m.display_name); setTempPassword(null); setResetError(null); }}
                            className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-zinc-700 hover:bg-gray-300 dark:hover:bg-zinc-600 text-gray-700 dark:text-zinc-300 rounded"
                          >
                            Reset password
                          </button>
                          <button
                            onClick={() => { setRemoveTargetId(m.id); setRemoveTargetName(m.display_name); setRemoveError(null); }}
                            className="text-xs px-2 py-0.5 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/60 text-red-700 dark:text-red-400 rounded"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Remove member confirmation modal */}
      {removeTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Remove member</h3>
            <p className="text-sm text-gray-500 dark:text-zinc-400">
              Are you sure you want to remove <span className="text-gray-800 dark:text-zinc-200 font-medium">{removeTargetName}</span> from the household? Their account will be deleted and they will need a new invite to rejoin.
            </p>
            {removeError && <p className="text-sm text-red-500 dark:text-red-400">{removeError}</p>}
            <div className="flex gap-3 pt-1">
              <button
                onClick={async () => {
                  setRemoveError(null);
                  try {
                    await removeMember.mutateAsync(removeTargetId);
                    setRemoveTargetId(null);
                  } catch (err: any) {
                    setRemoveError(err.message ?? 'Failed to remove member');
                  }
                }}
                disabled={removeMember.isPending}
                className="flex-1 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-xl text-sm font-medium text-white"
              >
                {removeMember.isPending ? 'Removing…' : 'Remove member'}
              </button>
              <button
                onClick={() => setRemoveTargetId(null)}
                className="flex-1 py-2 bg-gray-200 dark:bg-zinc-700 hover:bg-gray-300 dark:hover:bg-zinc-600 text-gray-700 dark:text-white rounded-xl text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin reset password modal */}
      {resetTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-xl">
            {!tempPassword ? (
              <>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Reset password</h3>
                <p className="text-sm text-gray-500 dark:text-zinc-400">
                  This will generate a temporary password for <span className="text-gray-800 dark:text-zinc-200 font-medium">{resetTargetName}</span>. They will be required to set a new password on next login.
                </p>
                {resetError && <p className="text-sm text-red-500 dark:text-red-400">{resetError}</p>}
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={handleAdminReset}
                    disabled={resetLoading}
                    className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl text-sm font-medium text-white"
                  >
                    {resetLoading ? 'Resetting…' : 'Confirm reset'}
                  </button>
                  <button
                    onClick={() => setResetTargetId(null)}
                    className="flex-1 py-2 bg-gray-200 dark:bg-zinc-700 hover:bg-gray-300 dark:hover:bg-zinc-600 text-gray-700 dark:text-white rounded-xl text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Temporary password</h3>
                <p className="text-sm text-gray-500 dark:text-zinc-400">
                  Share this with <span className="text-gray-800 dark:text-zinc-200 font-medium">{resetTargetName}</span>. It will not be shown again.
                </p>
                <div className="flex items-center gap-2 bg-gray-100 dark:bg-zinc-700 rounded-xl px-3 py-2">
                  <code className="flex-1 text-emerald-600 dark:text-emerald-300 font-mono text-sm break-all">{tempPassword}</code>
                  <CopyButton text={tempPassword} />
                </div>
                <button
                  onClick={() => { setResetTargetId(null); setTempPassword(null); }}
                  className="w-full py-2 bg-gray-200 dark:bg-zinc-700 hover:bg-gray-300 dark:hover:bg-zinc-600 text-gray-700 dark:text-white rounded-xl text-sm"
                >
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
