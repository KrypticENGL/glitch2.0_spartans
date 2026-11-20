import { z } from "../../lib/zod.js";
import { AREA_CODES } from "../alerts/areas.js";

const b64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/, "must be base64url");

export const MinSeverity = z.enum(["advisory", "warning", "severe"]).openapi({ description: "Lowest severity to receive; critical alerts are always delivered" });

export const Preferences = z.object({ minSeverity: MinSeverity.default("advisory") }).strict().openapi("PushPreferences");

export const SubscribeBody = z
  .object({
    subscription: z
      .object({
        endpoint: z.url().max(2048),
        expirationTime: z.number().nullable().optional(),
        keys: z.object({ p256dh: b64url.min(80).max(100), auth: b64url.min(16).max(32) }).strict(),
      })
      .strict()
      .openapi({ description: "PushSubscription.toJSON() from the browser" }),
    selectedAreas: z.array(z.enum(AREA_CODES)).min(1).max(20),
    preferences: Preferences.optional(),
  })
  .strict()
  .openapi("PushSubscribeRequest");

export const PreferencesPatch = z
  .object({ selectedAreas: z.array(z.enum(AREA_CODES)).min(1).max(20).optional(), preferences: Preferences.optional() })
  .strict()
  .refine((b) => b.selectedAreas || b.preferences, { message: "Nothing to update" })
  .openapi("PushPreferencesPatch");

export const PushHeaders = z.object({
  "x-push-subscription-id": z.uuid().openapi({ description: "Subscription id returned by /push/subscribe" }),
  "x-push-token": z.string().min(20).max(100).optional().openapi({ description: "Manage token returned by /push/subscribe (not needed by the signed-in owner)" }),
});

export const PushSubscriptionView = z
  .object({
    id: z.uuid(),
    selectedAreas: z.array(z.string()),
    preferences: Preferences,
    audience: z.enum(["demo", "verified"]),
    createdAt: z.string(),
    updatedAt: z.string(),
    lastSuccessAt: z.string().nullable(),
  })
  .openapi("PushSubscription");

export const SubscribeResponse = z
  .object({
    subscription: PushSubscriptionView,
    manageToken: z.string().openapi({ description: "Shown once. Keep it on the device to change or revoke this subscription." }),
  })
  .openapi("PushSubscribeResponse");

export const PushConfigResponse = z
  .object({
    enabled: z.boolean(),
    vapidPublicKey: z.string().nullable(),
    areas: z.array(z.object({ code: z.string(), name: z.string(), nameHi: z.string(), kind: z.enum(["district", "locality"]), district: z.string() })),
  })
  .openapi("PushConfig");
