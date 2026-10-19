export const NOTIFICATION_CLICK_MESSAGE = 'inbox-notification-click';

const SERVICE_WORKER_URL = '/sw.js';

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Registers the notification service worker once. Android Chrome (and installed
 * iOS web apps) only allow notifications through a service worker registration;
 * `new Notification()` throws "Illegal constructor" there.
 */
export function getNotificationRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }

  registrationPromise ??= navigator.serviceWorker
    .register(SERVICE_WORKER_URL, { scope: '/' })
    .then(() => navigator.serviceWorker.ready)
    .catch(() => {
      registrationPromise = null;
      return null;
    });

  return registrationPromise;
}

type InboxNotification = {
  title: string;
  body: string;
  threadKey: string;
  onClick: () => void;
};

export async function showInboxNotification({ title, body, threadKey, onClick }: InboxNotification) {
  const tag = `whatsapp-inbox:${threadKey}`;
  const registration = await getNotificationRegistration();

  if (registration) {
    await registration.showNotification(title, {
      body,
      tag,
      icon: '/icon.svg',
      data: { threadKey },
    });
    return;
  }

  // Desktop browsers without service worker support still have the constructor.
  const notification = new Notification(title, { body, tag });
  notification.onclick = () => {
    window.focus();
    onClick();
    notification.close();
  };
}
