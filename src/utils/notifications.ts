import type { FacilitatorSeatId, HelpCall } from '../shared/types';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return reg;
  } catch (err) {
    console.warn('Service worker registration failed:', err);
    return null;
  }
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function enableFacilitatorAlerts(
  facilitatorId: FacilitatorSeatId
): Promise<{
  permission: NotificationPermission | 'unsupported';
  pushSubscribed: boolean;
}> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { permission: 'unsupported', pushSubscribed: false };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    return { permission, pushSubscribed: false };
  }

  let pushSubscribed = false;
  try {
    const reg = (await registerServiceWorker()) || (await navigator.serviceWorker.ready);
    if (reg && 'pushManager' in reg) {
      const keyRes = await fetch('/api/push/vapid-public-key');
      if (keyRes.ok) {
        const { publicKey } = (await keyRes.json()) as { publicKey: string };
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          const applicationServerKey = urlBase64ToUint8Array(publicKey);
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
          });
        }
        const saveRes = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: sub.toJSON(),
            facilitatorId,
          }),
        });
        pushSubscribed = saveRes.ok;
      }
    }
  } catch (err) {
    console.warn('Web Push subscription skipped/unavailable:', err);
  }

  return { permission, pushSubscribed };
}

export async function showCallNotification(call: HelpCall): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const locationPart = call.station ? ` (${call.station})` : '';
  const notePart = call.note ? ` — "${call.note}"` : '';
  const title = `${call.participantName}${locationPart} is calling`;
  const body = `Needs facilitator assistance${notePart}.`;

  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, {
        body,
        tag: `call-${call.id}`,
        requireInteraction: true,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        data: { url: '/dashboard', callId: call.id },
      });
      return;
    }
  } catch {
    // Fall back to standard Notification API
  }

  try {
    const n = new Notification(title, {
      body,
      tag: `call-${call.id}`,
      requireInteraction: true,
      icon: '/pwa-192x192.png',
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Ignore notification display failure
  }
}

export async function dismissCallNotification(callId: string): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    if (reg.active) {
      reg.active.postMessage({ type: 'CLOSE_CALL_NOTIFICATION', callId });
    }
    const list = await reg.getNotifications({ tag: `call-${callId}` });
    list.forEach((n) => n.close());
  } catch {
    // Ignore cleanup errors
  }
}
