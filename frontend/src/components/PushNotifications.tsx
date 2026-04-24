'use client';

import { useState, useEffect } from 'react';
import { Bell, BellOff } from 'lucide-react';

async function getVapidPublicKey(): Promise<string> {
  const res = await fetch('/api/v1/push/vapid-public-key');
  if (!res.ok) throw new Error('Push not configured');
  const data = await res.json();
  return data.public_key as string;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function subscribe(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const publicKey = await getVapidPublicKey();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
  });
  const json = sub.toJSON();
  await fetch('/api/v1/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    }),
  });
}

async function unsubscribe(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  await fetch('/api/v1/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    }),
  });
  await sub.unsubscribe();
}

export function PushNotifications() {
  const [supported, setSupported] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    setSupported(true);
    setPermission(Notification.permission);

    // Check if VAPID is configured and if we're already subscribed
    Promise.all([
      getVapidPublicKey().then(() => setConfigured(true)).catch(() => setConfigured(false)),
      getCurrentSubscription().then((s) => setSubscribed(!!s)),
    ]);
  }, []);

  if (!supported || !configured) return null;

  async function handleToggle() {
    setLoading(true);
    try {
      if (subscribed) {
        const sub = await getCurrentSubscription();
        if (sub) await unsubscribe(sub);
        setSubscribed(false);
      } else {
        if (permission === 'denied') return;
        await subscribe();
        setPermission(Notification.permission);
        setSubscribed(true);
      }
    } catch (err) {
      console.error('Push toggle failed', err);
    } finally {
      setLoading(false);
    }
  }

  if (permission === 'denied') {
    return (
      <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl">
        <BellOff className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Notifications blocked</p>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
            Allow notifications in your browser settings to receive expiry and planning alerts.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
      <div className="flex items-center gap-3">
        {subscribed ? (
          <Bell className="w-5 h-5 text-indigo-500 flex-shrink-0" />
        ) : (
          <BellOff className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
        )}
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
            {subscribed ? 'Notifications on' : 'Push notifications'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {subscribed
              ? 'Expiry alerts and weekly planning reminders enabled.'
              : 'Get alerts when items expire and your weekly plan is empty.'}
          </p>
        </div>
      </div>
      <button
        onClick={handleToggle}
        disabled={loading}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${
          subscribed ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
        }`}
        aria-label={subscribed ? 'Disable notifications' : 'Enable notifications'}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
            subscribed ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
