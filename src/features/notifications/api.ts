/** Client for the SURAKSHA Express API (backend/api). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

export type AlertSeverity = "advisory" | "warning" | "severe" | "critical";
export type AlertLanguage = "en" | "hi";

export interface PublishedAlert {
  id: string;
  title: string;
  body: string;
  severity: AlertSeverity;
  targetArea: string;
  targetAreaLabel: string;
  language: AlertLanguage;
  classification: "demo" | "verified";
  deliverInApp: boolean;
  deliverPush: boolean;
  status: "draft" | "sending" | "sent" | "failed";
  expiresAt: string | null;
  expired: boolean;
  createdAt: string;
  sentAt: string | null;
}

export interface AlertArea {
  code: string;
  name: string;
  nameHi: string;
  kind: "district" | "locality";
  district: string;
}

export interface PushConfig {
  enabled: boolean;
  vapidPublicKey: string | null;
  areas: AlertArea[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; token?: string | null; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body !== undefined && { "Content-Type": "application/json" }),
        ...(init.token && { Authorization: `Bearer ${init.token}` }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the SURAKSHA server. Check your connection.");
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "HTTP_ERROR", err?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const SEVERITY_LABEL: Record<AlertSeverity, string> = { advisory: "Advisory", warning: "Warning", severe: "Severe", critical: "Critical" };
export const SEVERITY_TONE = { advisory: "info", warning: "warn", severe: "danger", critical: "danger" } as const;
