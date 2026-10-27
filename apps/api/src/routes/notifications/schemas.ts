import { z } from "zod";

export const listQuery = z.object({
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  read: z.string().optional(),
});

// Optional bodies validated by safeParse in the handlers (a missing body is a
// no-op; a present-but-malformed one is a 400) — matches the original schemas.
export const unsubscribeBody = z
  .object({ subscription: z.object({ endpoint: z.string() }).optional() })
  .optional();

export const testBody = z
  .object({
    subscription: z
      .object({
        endpoint: z.string(),
        keys: z.object({ p256dh: z.string(), auth: z.string() }),
      })
      .optional(),
  })
  .optional();

export const subscribeBody = z.object({
  subscription: z.object({
    endpoint: z.string(),
    keys: z.object({ p256dh: z.string(), auth: z.string() }),
  }),
  device_info: z
    .object({
      deviceName: z.string().nullable().optional(),
      osName: z.string().nullable().optional(),
      osVersion: z.string().nullable().optional(),
      browserName: z.string().nullable().optional(),
      browserVersion: z.string().nullable().optional(),
      platform: z.string().nullable().optional(),
    })
    .optional(),
});

export const apnsRegisterBody = z.object({
  device_token: z.string(),
  device_info: z
    .object({
      device_name: z.string().optional(),
      os_version: z.string().optional(),
      app_version: z.string().optional(),
      bundle_id: z.string().optional(),
    })
    .optional(),
});
