import { api, type PushConfig } from "./api";

/** What this device keeps about its own subscription. The manage token is the only way to change it anonymously. */
export interface StoredSubscription {
  id: string;
  token: string;
  endpoint: string;
  areas: string[];
  minSeverity: "advisory" | "warning" | "severe";
}

const KEY = "suraksha-push-subscription";

export const readStored = (): StoredSubscription | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") as StoredSubscription | null;
  } catch {
    return null;
  }
};
const writeStored = (s: StoredSubscription | null) => (s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY));
const ownerHeaders = (s: StoredSubscription): Record<string, string> => ({ "X-Push-Subscription-Id": s.id, "X-Push-Token": s.token });

export type PushSupport = "supported" | "unsupported" | "needs-install" | "insecure";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  // iOS/iPadOS 16.4+ only offers Web Push to web apps added to the Home Screen.
  if (ios && !standalone) return "needs-install";
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window ? "supported" : "unsupported";
}

export async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

const keyBytes = (b64url: string) => {
  const s = atob(b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function save(sub: PushSubscription, areas: string[], minSeverity: StoredSubscription["minSeverity"], previous: StoredSubscription | null) {
  const res = await api<{ subscription: { id: string }; manageToken: string }>("/push/subscribe", {
    method: "POST",
    body: { subscription: sub.toJSON(), selectedAreas: areas, preferences: { minSeverity } },
    headers: previous ? ownerHeaders(previous) : undefined, // lets the server retire a replaced subscription
  });
  const stored = { id: res.subscription.id, token: res.manageToken, endpoint: sub.endpoint, areas, minSeverity };
  writeStored(stored);
  return stored;
}

/** Must be called from a click: the permission prompt needs a user gesture. */
export async function enablePush(config: PushConfig, areas: string[], minSeverity: StoredSubscription["minSeverity"]) {
  if (!config.enabled || !config.vapidPublicKey) throw new Error("Notifications are not set up on the server yet.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { permission, stored: null };
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.vapidPublicKey) }));
  return { permission, stored: await save(sub, areas, minSeverity, readStored()) };
}

export async function disablePush() {
  const stored = readStored();
  const reg = await navigator.serviceWorker.getRegistration("/");
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
  if (stored) await api("/push/unsubscribe", { method: "POST", headers: ownerHeaders(stored) }).catch(() => undefined); // already gone server-side is fine
  writeStored(null);
}

export async function updatePrefs(areas: string[], minSeverity: StoredSubscription["minSeverity"]) {
  const stored = readStored();
  if (!stored) return null;
  await api("/push/preferences", { method: "PATCH", headers: ownerHeaders(stored), body: { selectedAreas: areas, preferences: { minSeverity } } });
  const next = { ...stored, areas, minSeverity };
  writeStored(next);
  return next;
}

/**
 * Renewal without a prompt: if permission is still granted but the browser dropped or rotated the subscription,
 * subscribe again and tell the server (which retires the old row). Returns the current stored record.
 */
export async function reconcilePush(config: PushConfig): Promise<StoredSubscription | null> {
  const stored = readStored();
  if (!stored || pushSupport() !== "supported" || Notification.permission !== "granted" || !config.vapidPublicKey) return stored;
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const serverKnows = await api("/push/preferences", { headers: ownerHeaders(stored) }).then(() => true, () => false);
  if (sub && sub.endpoint === stored.endpoint && serverKnows) return stored;
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.vapidPublicKey) });
  return save(sub, stored.areas, stored.minSeverity, serverKnows ? stored : null);
}
