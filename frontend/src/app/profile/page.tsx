'use client';

import { useState } from 'react';
import Link from 'next/link';
import { logout, adminResetPassword } from '@/lib/api';
import {
  useCurrentUser,
  useUpdateUserProfile,
  useChangePassword,
  useHousehold,
  useRotateInviteCode,
  useHouseholdMembers,
} from '@/lib/hooks';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="ml-2 px-2 py-0.5 text-xs bg-zinc-700 hover:bg-zinc-600 rounded"
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

  const [displayName, setDisplayName] = useState('');
  const [nameEditing, setNameEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [emailEditing, setEmailEditing] = useState(false);
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [resetTargetName, setResetTargetName] = useState('');
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  if (userLoading) {
    return (
      <div className="min-h-screen bg-zinc-900 text-white flex items-center justify-center">
        <p className="text-zinc-400">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-900 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-400 mb-4">Profile not available in legacy auth mode.</p>
          <Link href="/" className="text-emerald-400 hover:underline">← Back home</Link>
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
    <div className="min-h-screen bg-zinc-900 text-white">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-zinc-400 hover:text-white text-sm">← Home</Link>
          <h1 className="text-2xl font-bold">Profile</h1>
          <button
            onClick={() => logout()}
            className="ml-auto px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded"
          >
            Sign out
          </button>
        </div>

        {/* Profile section */}
        <section className="bg-zinc-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Your Account</h2>
          <div>
            <p className="text-xs text-zinc-400 uppercase tracking-wide mb-1">Username</p>
            <p className="text-zinc-200">{user.username}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-400 uppercase tracking-wide mb-1">Display Name</p>
            {nameEditing ? (
              <div className="flex gap-2">
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-zinc-700 border border-zinc-600 rounded text-sm focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={saveName}
                  disabled={updateProfile.isPending}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded text-sm font-medium"
                >
                  Save
                </button>
                <button
                  onClick={() => setNameEditing(false)}
                  className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <p className="text-zinc-200">{user.display_name}</p>
                <button onClick={startEditName} className="text-xs text-emerald-400 hover:underline">
                  Edit
                </button>
              </div>
            )}
          </div>
          <div>
            <p className="text-xs text-zinc-400 uppercase tracking-wide mb-1">Email</p>
            {emailEditing ? (
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-zinc-700 border border-zinc-600 rounded text-sm focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={saveEmail}
                  disabled={updateProfile.isPending}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded text-sm font-medium"
                >
                  Save
                </button>
                <button
                  onClick={() => setEmailEditing(false)}
                  className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <p className="text-zinc-200">{user.email ?? <span className="text-zinc-500 italic">not set</span>}</p>
                <button onClick={startEditEmail} className="text-xs text-emerald-400 hover:underline">
                  {user.email ? 'Edit' : 'Add'}
                </button>
              </div>
            )}
          </div>
          {user.is_admin && (
            <p className="text-xs text-emerald-400 font-medium">Admin</p>
          )}
        </section>

        {/* Change password */}
        <section className="bg-zinc-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Change Password</h2>
          <form onSubmit={handlePasswordChange} className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400 uppercase tracking-wide block mb-1">Current Password</label>
              <input
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                required
                className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 uppercase tracking-wide block mb-1">New Password</label>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                required
                minLength={8}
                className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 uppercase tracking-wide block mb-1">Confirm New Password</label>
              <input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                required
                className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            {pwError && <p className="text-red-400 text-sm">{pwError}</p>}
            {pwSuccess && <p className="text-emerald-400 text-sm">Password changed successfully.</p>}
            <button
              type="submit"
              disabled={changePw.isPending}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded text-sm font-medium"
            >
              {changePw.isPending ? 'Saving…' : 'Update Password'}
            </button>
          </form>
        </section>

        {/* Household section — visible to all members */}
        {household && (
          <section className="bg-zinc-800 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold">Household</h2>
            <div>
              <p className="text-xs text-zinc-400 uppercase tracking-wide mb-1">Name</p>
              <p className="text-zinc-200">{household.name}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-400 uppercase tracking-wide mb-1">Members</p>
              <p className="text-zinc-200">{household.member_count}</p>
            </div>

            {/* Invite code — admin only */}
            {user.is_admin && (
              <div>
                <p className="text-xs text-zinc-400 uppercase tracking-wide mb-1">Invite Code</p>
                <div className="flex items-center gap-2">
                  <code className="bg-zinc-700 px-3 py-1.5 rounded text-sm font-mono text-emerald-300">
                    {household.invite_code}
                  </code>
                  <CopyButton text={household.invite_code} />
                  <button
                    onClick={() => rotateInvite.mutate()}
                    disabled={rotateInvite.isPending}
                    className="px-2 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 rounded"
                  >
                    Rotate
                  </button>
                </div>
                <p className="text-xs text-zinc-500 mt-1">Share this code with household members to let them create an account.</p>
              </div>
            )}

            {/* Member list */}
            {members && members.length > 0 && (
              <div>
                <p className="text-xs text-zinc-400 uppercase tracking-wide mb-2">Members</p>
                <ul className="space-y-2">
                  {members.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-200">{m.display_name}</span>
                      <span className="text-zinc-500">@{m.username}</span>
                      {m.is_admin && <span className="text-xs text-emerald-400">admin</span>}
                      {m.id === user.id && <span className="text-xs text-zinc-500">(you)</span>}
                      {user.is_admin && m.id !== user.id && (
                        <button
                          onClick={() => { setResetTargetId(m.id); setResetTargetName(m.display_name); setTempPassword(null); setResetError(null); }}
                          className="ml-auto text-xs px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-300"
                        >
                          Reset password
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Admin reset password modal */}
      {resetTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-zinc-800 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-xl">
            {!tempPassword ? (
              <>
                <h3 className="text-lg font-semibold">Reset password</h3>
                <p className="text-sm text-zinc-400">
                  This will generate a temporary password for <span className="text-zinc-200 font-medium">{resetTargetName}</span>. They will be required to set a new password on next login.
                </p>
                {resetError && <p className="text-sm text-red-400">{resetError}</p>}
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={handleAdminReset}
                    disabled={resetLoading}
                    className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-xl text-sm font-medium"
                  >
                    {resetLoading ? 'Resetting…' : 'Confirm reset'}
                  </button>
                  <button
                    onClick={() => setResetTargetId(null)}
                    className="flex-1 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-xl text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold">Temporary password</h3>
                <p className="text-sm text-zinc-400">
                  Share this with <span className="text-zinc-200 font-medium">{resetTargetName}</span>. It will not be shown again.
                </p>
                <div className="flex items-center gap-2 bg-zinc-700 rounded-xl px-3 py-2">
                  <code className="flex-1 text-emerald-300 font-mono text-sm break-all">{tempPassword}</code>
                  <CopyButton text={tempPassword} />
                </div>
                <button
                  onClick={() => { setResetTargetId(null); setTempPassword(null); }}
                  className="w-full py-2 bg-zinc-700 hover:bg-zinc-600 rounded-xl text-sm"
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
