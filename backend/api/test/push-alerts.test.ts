// Web Push + alert dispatch against a local push-service stand-in. Uses the real WebPushSender:
// payloads are aes128gcm-encrypted with VAPID headers and decrypted here with the subscriber's private key.
import { createECDH, randomBytes, type ECDH } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import webpush from "web-push";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebPushSender } from "../src/services/push-sender.js";
import { bearer, login, makeTestApp } from "./helpers.js";
// @ts-expect-error http_ece ships no types
import ece from "http_ece";

const vapid = webpush.generateVAPIDKeys();
const env = {
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "mailto:test@example.org",
  PUSH_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  PUSH_ENDPOINT_HOSTS: "127.0.0.1",
};
const sender = new WebPushSender({ subject: env.VAPID_SUBJECT, publicKey: vapid.publicKey, privateKey: vapid.privateKey }, 5000);
const { app, pool, events } = makeTestApp({ push: sender }, env);

// Local push service: /ok → 201, /gone → 410, /flaky → 503 once then 201, /bad → 400.
const received: { path: string; headers: IncomingHttpHeaders; body: Buffer }[] = [];
const hits = new Map<string, number>();
let receiver: Server;
let base: string;

interface Device {
  ecdh: ECDH;
  auth: Buffer;
  id: string;
  token: string;
  path: string;
}
const devices: Record<string, Device> = {};
let admin: string;
let citizen: string;

async function subscribe(name: string, path: string, selectedAreas: string[], minSeverity?: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const res = await request(app)
    .post("/api/v1/push/subscribe")
    .send({
      subscription: { endpoint: `${base}${path}`, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } },
      selectedAreas,
      ...(minSeverity && { preferences: { minSeverity } }),
    });
  expect(res.status).toBe(201);
  devices[name] = { ecdh, auth, id: res.body.subscription.id, token: res.body.manageToken, path };
  return res;
}

const owner = (d: Device) => ({ "X-Push-Subscription-Id": d.id, "X-Push-Token": d.token });

async function waitForDispatch(alertId: string) {
  for (let i = 0; i < 100; i++) {
    const res = await request(app).get(`/api/v1/admin/alerts/${alertId}/delivery`).set(bearer(admin));
    if (res.body.dispatch && res.body.dispatch.status !== "running") return res.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("dispatch did not finish");
}

beforeAll(async () => {
  receiver = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const path = req.url ?? "";
      const n = (hits.get(path) ?? 0) + 1;
      hits.set(path, n);
      received.push({ path, headers: req.headers, body: Buffer.concat(chunks) });
      const status = path.startsWith("/gone") ? 410 : path.startsWith("/bad") ? 400 : path.startsWith("/flaky") && n === 1 ? 503 : 201;
      res.writeHead(status).end();
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
  admin = await login(app, "admin@suraksha.demo");
  citizen = await login(app, "citizen@suraksha.demo");

  await subscribe("A", "/ok/a", ["darbhanga/benta"]);
  await subscribe("B", "/ok/b", ["darbhanga"]);
  await subscribe("C", "/ok/c", ["darbhanga/mabbi"]);
  await subscribe("G", "/gone/g", ["darbhanga/benta"]);
  await subscribe("F", "/flaky/f", ["darbhanga/benta"]);
  await subscribe("X", "/bad/x", ["darbhanga/benta"]);
  await subscribe("S", "/ok/s", ["darbhanga/benta"], "severe");
});
afterAll(async () => {
  receiver.close();
  await pool.end();
});

describe("push subscriptions", () => {
  it("exposes the public VAPID key and areas", async () => {
    const res = await request(app).get("/api/v1/push/config");
    expect(res.body).toMatchObject({ enabled: true, vapidPublicKey: vapid.publicKey });
    expect(res.body.areas.map((a: { code: string }) => a.code)).toContain("darbhanga/benta");
  });

  it("stores endpoint and keys encrypted", async () => {
    const { rows } = await pool.query(`SELECT endpoint_enc, p256dh_enc, auth_enc FROM push_subscriptions WHERE id = $1`, [devices.A!.id]);
    expect(JSON.stringify(rows[0])).not.toContain("127.0.0.1");
    expect(rows[0].endpoint_enc).toMatch(/^v1\./);
  });

  it("re-subscribing the same endpoint updates in place and rotates the manage token", async () => {
    const d = devices.C!;
    const res = await request(app)
      .post("/api/v1/push/subscribe")
      .send({ subscription: { endpoint: `${base}${d.path}`, keys: { p256dh: d.ecdh.getPublicKey().toString("base64url"), auth: d.auth.toString("base64url") } }, selectedAreas: ["darbhanga/mabbi"] });
    expect(res.status).toBe(200);
    expect(res.body.subscription.id).toBe(d.id);
    expect((await request(app).get("/api/v1/push/preferences").set(owner(d))).status).toBe(404); // old token no longer valid
    d.token = res.body.manageToken;
    expect((await request(app).get("/api/v1/push/preferences").set(owner(d))).body.selectedAreas).toEqual(["darbhanga/mabbi"]);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM push_subscriptions WHERE id = $1 OR (invalidated_at IS NULL AND endpoint_hash = (SELECT endpoint_hash FROM push_subscriptions WHERE id = $1))`, [d.id]);
    expect(rows[0].n).toBe(1);
  });

  it("rejects endpoints that are not push services and unknown areas", async () => {
    const keys = { p256dh: devices.A!.ecdh.getPublicKey().toString("base64url"), auth: devices.A!.auth.toString("base64url") };
    expect((await request(app).post("/api/v1/push/subscribe").send({ subscription: { endpoint: "https://evil.example.com/x", keys }, selectedAreas: ["darbhanga"] })).status).toBe(422);
    expect((await request(app).post("/api/v1/push/subscribe").send({ subscription: { endpoint: `${base}/ok/z`, keys }, selectedAreas: ["patna"] })).status).toBe(400);
  });

  it("only the token holder can read or change preferences", async () => {
    const d = devices.B!;
    expect((await request(app).get("/api/v1/push/preferences").set({ "X-Push-Subscription-Id": d.id, "X-Push-Token": "x".repeat(43) })).status).toBe(404);
    const res = await request(app).patch("/api/v1/push/preferences").set(owner(d)).send({ selectedAreas: ["darbhanga", "darbhanga/donar"] });
    expect(res.status).toBe(200);
    expect(res.body.selectedAreas).toEqual(["darbhanga", "darbhanga/donar"]);
  });
});

describe("admin alerts", () => {
  const draft = { title: "Severe Flood Warning — Benta", body: "Water is rising near Benta. Move to Benta Stadium Camp.", severity: "warning", targetArea: "darbhanga/benta" };
  let alertId: string;

  it("blocks citizens and anonymous users", async () => {
    expect((await request(app).post("/api/v1/admin/alerts").send(draft)).status).toBe(401);
    expect((await request(app).post("/api/v1/admin/alerts").set(bearer(citizen)).send(draft)).status).toBe(403);
  });

  it("creates a [DEMO] draft with a preview and district-aware audience count", async () => {
    const res = await request(app).post("/api/v1/admin/alerts").set(bearer(admin)).send(draft);
    expect(res.status).toBe(201);
    alertId = res.body.alert.id;
    expect(res.body.alert.title).toBe("[DEMO] Severe Flood Warning — Benta");
    expect(res.body.alert.status).toBe("draft");
    expect(res.body.preview.notification.body).toContain("not an official warning");
    expect(res.body.preview.notification.url).toBe(`/alerts?alert=${alertId}`);
    // A, B (whole district), G, F, X — not C (Mabbi) and not S (wants severe+).
    expect(res.body.preview.eligibleSubscriptions).toBe(5);
    expect((await request(app).get(`/api/v1/alerts/${alertId}`)).status).toBe(404); // drafts are not public
  });

  it("requires confirmation and an Idempotency-Key", async () => {
    expect((await request(app).post(`/api/v1/admin/alerts/${alertId}/send`).set(bearer(admin)).send({ confirm: true })).status).toBe(400);
    expect((await request(app).post(`/api/v1/admin/alerts/${alertId}/send`).set(bearer(admin)).set("Idempotency-Key", "send-key-0001").send({})).status).toBe(400);
  });

  it("sends real encrypted Web Push requests and records per-subscription results", async () => {
    const res = await request(app).post(`/api/v1/admin/alerts/${alertId}/send`).set(bearer(admin)).set("Idempotency-Key", "send-key-0001").send({ confirm: true });
    expect(res.status).toBe(202);
    const report = await waitForDispatch(alertId);
    expect(report.dispatch).toMatchObject({ status: "completed", eligible: 5, accepted: 3, invalid: 1, failed: 1 });
    expect(report.alert.status).toBe("sent");

    const byId = Object.fromEntries(report.deliveries.map((d: { subscriptionId: string }) => [d.subscriptionId, d]));
    expect(byId[devices.G!.id]).toMatchObject({ status: "invalid", httpStatus: 410, attempts: 1 });
    expect(byId[devices.X!.id]).toMatchObject({ status: "failed", httpStatus: 400, attempts: 1 }); // permanent: no retry
    expect(byId[devices.F!.id]).toMatchObject({ status: "accepted", attempts: 2 }); // 503 then retried
    expect(byId[devices.C!.id]).toBeUndefined();
    expect(byId[devices.S!.id]).toBeUndefined();

    const msg = received.find((r) => r.path === "/ok/a")!;
    expect(msg.headers["content-encoding"]).toBe("aes128gcm");
    expect(msg.headers.authorization).toMatch(new RegExp(`^vapid t=.+, k=${vapid.publicKey}$`));
    expect(msg.headers.urgency).toBe("high");
    expect(msg.headers.topic).toBe(alertId.replaceAll("-", ""));
    const plain = ece.decrypt(msg.body, { version: "aes128gcm", privateKey: devices.A!.ecdh, authSecret: devices.A!.auth.toString("base64url") }) as Buffer;
    expect(JSON.parse(plain.toString("utf8"))).toMatchObject({ alertId, title: "[DEMO] Severe Flood Warning — Benta", severity: "warning", url: `/alerts?alert=${alertId}` });
  });

  it("is idempotent: replays return the dispatch, a new key is refused", async () => {
    const replay = await request(app).post(`/api/v1/admin/alerts/${alertId}/send`).set(bearer(admin)).set("Idempotency-Key", "send-key-0001").send({ confirm: true });
    expect(replay.status).toBe(200);
    expect(replay.body.replay).toBe(true);
    const again = await request(app).post(`/api/v1/admin/alerts/${alertId}/send`).set(bearer(admin)).set("Idempotency-Key", "send-key-0002").send({ confirm: true });
    expect(again.status).toBe(409);
    expect(received.filter((r) => r.path === "/ok/a")).toHaveLength(1);
  });

  it("removes gone subscriptions from future audiences", async () => {
    const { rows } = await pool.query(`SELECT invalidated_at, invalidated_reason FROM push_subscriptions WHERE id = $1`, [devices.G!.id]);
    expect(rows[0].invalidated_at).not.toBeNull();
    const next = await request(app).post("/api/v1/admin/alerts").set(bearer(admin)).send({ ...draft, severity: "critical", deliverInApp: false });
    expect(next.body.preview.eligibleSubscriptions).toBe(5); // A, B, F, X, S — G is gone
  });

  it("publishes in-app (Socket.IO) and lists the alert publicly, filtered by area", async () => {
    const pub = events.ofType("alert.published").find((e) => e.input.entityId === alertId)!;
    expect(pub.rooms).toEqual(["public"]);
    expect(events.ofType("alert.dispatch.updated").some((e) => e.input.entityId === alertId && e.rooms[0] === "admins")).toBe(true);

    const all = await request(app).get("/api/v1/alerts");
    expect(all.body.data.map((a: { id: string }) => a.id)).toContain(alertId);
    const benta = await request(app).get("/api/v1/alerts").query({ area: "darbhanga/benta" });
    expect(benta.body.data.map((a: { id: string }) => a.id)).toContain(alertId);
    const mabbi = await request(app).get("/api/v1/alerts").query({ area: "darbhanga/mabbi" });
    expect(mabbi.body.data.map((a: { id: string }) => a.id)).not.toContain(alertId);
  });

  it("hides expired alerts unless asked", async () => {
    const res = await request(app)
      .post("/api/v1/admin/alerts")
      .set(bearer(admin))
      .send({ ...draft, deliverPush: false, expiresAt: new Date(Date.now() + 120_000).toISOString() });
    const id = res.body.alert.id as string;
    expect((await request(app).post(`/api/v1/admin/alerts/${id}/send`).set(bearer(admin)).set("Idempotency-Key", "send-key-expiry").send({ confirm: true })).status).toBe(202);
    await pool.query(`UPDATE alerts SET expires_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    expect((await request(app).get("/api/v1/alerts")).body.data.map((a: { id: string }) => a.id)).not.toContain(id);
    const withExpired = await request(app).get("/api/v1/alerts").query({ includeExpired: "true" });
    expect(withExpired.body.data.find((a: { id: string }) => a.id === id).expired).toBe(true);
  });

  it("unsubscribe revokes the subscription", async () => {
    const d = devices.A!;
    expect((await request(app).post("/api/v1/push/unsubscribe").set(owner(d))).status).toBe(200);
    expect((await request(app).get("/api/v1/push/preferences").set(owner(d))).status).toBe(404);
  });
});

describe("push disabled", () => {
  it("reports disabled and refuses subscriptions with 503", async () => {
    const plain = makeTestApp();
    expect((await request(plain.app).get("/api/v1/push/config")).body).toMatchObject({ enabled: false, vapidPublicKey: null });
    const keys = { p256dh: devices.B!.ecdh.getPublicKey().toString("base64url"), auth: devices.B!.auth.toString("base64url") };
    expect((await request(plain.app).post("/api/v1/push/subscribe").send({ subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys }, selectedAreas: ["darbhanga"] })).status).toBe(503);
    await plain.pool.end();
  });
});
