import { z } from "../../lib/zod.js";
import { ALERT_LANGUAGES, ALERT_SEVERITIES, ALERT_STATUSES } from "../../types/enums.js";
import { ALL_AREAS, AREA_CODES } from "./areas.js";

export const AlertCreateBody = z
  .object({
    title: z.string().trim().min(3).max(110).openapi({ example: "Severe Flood Warning — Darbhanga", description: "\"[DEMO] \" is prefixed by the server for demonstration alerts" }),
    body: z.string().trim().min(10).max(500),
    severity: z.enum(ALERT_SEVERITIES),
    targetArea: z.enum([ALL_AREAS, ...AREA_CODES]),
    language: z.enum(ALERT_LANGUAGES).default("en"),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
    deliverInApp: z.boolean().default(true),
    deliverPush: z.boolean().default(true),
  })
  .strict()
  .refine((b) => b.deliverInApp || b.deliverPush, { message: "Choose at least one delivery option", path: ["deliverPush"] })
  .refine((b) => !b.expiresAt || Date.parse(b.expiresAt) > Date.now() + 60_000, { message: "Expiry must be in the future", path: ["expiresAt"] })
  .openapi("AlertCreateRequest");

export const AlertSendBody = z.object({ confirm: z.literal(true).openapi({ description: "Explicit operator confirmation" }) }).strict().openapi("AlertSendRequest");

export const AlertListQuery = z.object({
  area: z.enum(AREA_CODES).optional().openapi({ description: "Only alerts reaching this area (plus all-area alerts)" }),
  includeExpired: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

export const Alert = z
  .object({
    id: z.uuid(),
    title: z.string(),
    body: z.string(),
    severity: z.enum(ALERT_SEVERITIES),
    targetArea: z.string(),
    targetAreaLabel: z.string(),
    language: z.enum(ALERT_LANGUAGES),
    classification: z.enum(["demo", "verified"]),
    deliverInApp: z.boolean(),
    deliverPush: z.boolean(),
    status: z.enum(ALERT_STATUSES),
    expiresAt: z.string().nullable(),
    expired: z.boolean(),
    createdAt: z.string(),
    sentAt: z.string().nullable(),
  })
  .openapi("Alert");

export const NotificationPayload = z
  .object({
    alertId: z.uuid(),
    title: z.string(),
    body: z.string(),
    severity: z.enum(ALERT_SEVERITIES),
    classification: z.enum(["demo", "verified"]),
    url: z.string(),
    sentAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
  })
  .openapi("NotificationPayload", { description: "Exact JSON delivered to the service worker" });

export const DispatchSummary = z
  .object({
    id: z.uuid(),
    status: z.enum(["running", "completed", "failed"]),
    eligible: z.number().int(),
    accepted: z.number().int().openapi({ description: "Accepted by the push service — not a confirmed receipt or read" }),
    failed: z.number().int(),
    invalid: z.number().int().openapi({ description: "Subscription gone (404/410); removed from future sends" }),
    error: z.string().nullable(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .openapi("AlertDispatch");

export const AlertDraftResponse = z
  .object({
    alert: Alert,
    preview: z.object({ notification: NotificationPayload, audienceLabel: z.string(), eligibleSubscriptions: z.number().int(), pushEnabled: z.boolean() }),
  })
  .openapi("AlertDraft");

export const AdminAlert = Alert.extend({ dispatch: DispatchSummary.nullable() }).openapi("AdminAlert");

export const DeliveryReport = z
  .object({
    alert: Alert,
    dispatch: DispatchSummary.nullable(),
    deliveries: z.array(
      z.object({ subscriptionId: z.uuid(), status: z.enum(["accepted", "failed", "invalid"]), httpStatus: z.number().int().nullable(), attempts: z.number().int(), error: z.string().nullable(), at: z.string() }),
    ),
  })
  .openapi("AlertDeliveryReport");
