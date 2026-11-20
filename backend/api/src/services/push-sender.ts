import webpush from "web-push";

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushOptions {
  ttlSeconds: number;
  urgency: "very-low" | "low" | "normal" | "high";
  /** Replaces an undelivered message with the same topic on the push service (max 32 base64url chars). */
  topic?: string;
}

export type PushOutcome =
  | { kind: "accepted"; statusCode: number }
  | { kind: "invalid"; statusCode: number; error: string } // 404/410: subscription is gone
  | { kind: "transient"; statusCode: number | null; error: string; retryAfterMs?: number } // 429/5xx/network/timeout
  | { kind: "permanent"; statusCode: number; error: string }; // other 4xx: retrying will not help

export interface PushSender {
  send(target: PushTarget, payload: string, options: PushOptions): Promise<PushOutcome>;
}

/**
 * Standards Web Push (RFC 8030/8291/8292): `web-push` builds the aes128gcm body and VAPID headers,
 * we send with fetch so we control the timeout and refuse redirects.
 */
export class WebPushSender implements PushSender {
  constructor(
    private readonly vapid: { subject: string; publicKey: string; privateKey: string },
    private readonly timeoutMs: number,
  ) {}

  async send(target: PushTarget, payload: string, options: PushOptions): Promise<PushOutcome> {
    const details = webpush.generateRequestDetails(target, payload, {
      vapidDetails: this.vapid,
      TTL: options.ttlSeconds,
      urgency: options.urgency,
      ...(options.topic && { topic: options.topic }),
    });
    let res: Response;
    try {
      res = await fetch(details.endpoint, {
        method: "POST",
        headers: details.headers as Record<string, string>,
        body: details.body ? new Uint8Array(details.body) : null,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      return { kind: "transient", statusCode: null, error: (err as Error).name === "TimeoutError" ? "timeout" : (err as Error).message };
    }
    const text = (await res.text().catch(() => "")).slice(0, 300);
    const s = res.status;
    if (s >= 200 && s < 300) return { kind: "accepted", statusCode: s };
    if (s === 404 || s === 410) return { kind: "invalid", statusCode: s, error: text || res.statusText };
    if (s === 429 || s >= 500) {
      const ra = Number(res.headers.get("retry-after"));
      return { kind: "transient", statusCode: s, error: text || res.statusText, ...(Number.isFinite(ra) && ra > 0 && { retryAfterMs: ra * 1000 }) };
    }
    return { kind: "permanent", statusCode: s, error: text || res.statusText };
  }
}
