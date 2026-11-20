"use client";

import { io, type Socket } from "socket.io-client";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { API_URL, api, type PublishedAlert } from "./api";

interface AlertsState {
  alerts: PublishedAlert[];
  /** When the list last came from the server; null = never. Shown when offline so saved copies are not mistaken for live data. */
  fetchedAt: string | null;
  readIds: string[];
  /** Areas this device cares about (also used for push). Empty = show every area. */
  areas: string[];
  status: "idle" | "loading" | "live" | "offline" | "error";
  refresh: () => Promise<void>;
  markRead: (id: string) => void;
  markAllRead: () => void;
  setAreas: (areas: string[]) => void;
}

const noopStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

export const useAlerts = create<AlertsState>()(
  persist(
    (set, get) => ({
      alerts: [],
      fetchedAt: null,
      readIds: [],
      areas: [],
      status: "idle",
      refresh: async () => {
        set({ status: get().alerts.length ? get().status : "loading" });
        try {
          const res = await api<{ data: PublishedAlert[]; generatedAt: string }>("/alerts");
          set({ alerts: res.data, fetchedAt: res.generatedAt, status: "live" });
        } catch {
          set({ status: navigator.onLine ? "error" : "offline" });
        }
      },
      markRead: (id) => set((s) => (s.readIds.includes(id) ? s : { readIds: [...s.readIds, id].slice(-200) })),
      markAllRead: () => set((s) => ({ readIds: [...new Set([...s.readIds, ...s.alerts.map((a) => a.id)])].slice(-200) })),
      setAreas: (areas) => set({ areas }),
    }),
    {
      name: "suraksha-alerts-v1",
      storage: createJSONStorage(() => (typeof window === "undefined" ? noopStorage : window.localStorage)),
      partialize: (s) => ({ alerts: s.alerts, fetchedAt: s.fetchedAt, readIds: s.readIds, areas: s.areas }),
      skipHydration: true,
    },
  ),
);

/** An alert reaches the chosen areas if it targets everyone, one of them, or the district containing one. */
export function relevant(alert: PublishedAlert, areas: string[]) {
  if (!areas.length || alert.targetArea === "all") return true;
  return areas.some((a) => a === alert.targetArea || a.split("/")[0] === alert.targetArea || alert.targetArea.split("/")[0] === a);
}

export const isCurrent = (a: PublishedAlert) => !a.expired && (!a.expiresAt || Date.parse(a.expiresAt) > Date.now());

let socket: Socket | null = null;

/** One shared connection; new alerts arrive here whether or not notification permission was granted. */
export function connectAlerts() {
  if (socket || typeof window === "undefined") return;
  void useAlerts.persist.rehydrate();
  void useAlerts.getState().refresh();
  socket = io(API_URL, { path: "/socket.io", transports: ["websocket", "polling"], reconnectionDelayMax: 15_000 });
  socket.on("alert.published", (event: { data: { alert: PublishedAlert } }) => {
    const alert = event.data?.alert;
    if (!alert?.id) return;
    useAlerts.setState((s) => ({ alerts: [alert, ...s.alerts.filter((a) => a.id !== alert.id)], fetchedAt: new Date().toISOString(), status: "live" }));
  });
  socket.on("connect", () => void useAlerts.getState().refresh()); // catch up on anything missed while disconnected
  window.addEventListener("online", () => void useAlerts.getState().refresh());
  window.addEventListener("offline", () => useAlerts.setState({ status: "offline" }));
  navigator.serviceWorker?.addEventListener("message", (e: MessageEvent<{ type?: string }>) => {
    if (e.data?.type === "suraksha:push") void useAlerts.getState().refresh();
  });
}
