import webpush from "web-push";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let vapidKeys: VapidKeys | null = null;

/**
 * Load VAPID keys from files or environment variables
 */
function loadVapidKeys(): VapidKeys {
  if (vapidKeys) {
    return vapidKeys;
  }

  // Try to load from files first (preferred method)
  const vapidKeysDir = join(process.cwd(), "..", "..", "vapid_keys");
  const privateKeyPath = join(vapidKeysDir, "vapid_private_key.pem");
  const publicKeyPath = join(vapidKeysDir, "vapid_public_key.pem");

  if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
    console.log(`Loading VAPID keys from files: ${vapidKeysDir}`);
    try {
      const publicKeyPem = readFileSync(publicKeyPath, "utf-8").trim();
      const privateKeyPem = readFileSync(privateKeyPath, "utf-8").trim();

      // Convert PEM to base64url format if needed
      const publicKey = convertPemToBase64Url(publicKeyPem);
      const privateKey = convertPrivateKeyPemToBase64Url(privateKeyPem);

      vapidKeys = { publicKey, privateKey };

      // Set VAPID details
      webpush.setVapidDetails(
        Bun.env.VAPID_CONTACT_EMAIL || "mailto:admin@localhost",
        publicKey,
        privateKey,
      );

      return vapidKeys;
    } catch (e) {
      console.error("Error reading VAPID key files:", e);
      // Fall through to environment variables
    }
  }

  // Fallback to environment variables
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    throw new Error(
      "VAPID keys must be provided via files (vapid_keys/) or environment variables (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)",
    );
  }

  vapidKeys = { publicKey, privateKey };

  // Set VAPID details
  webpush.setVapidDetails(
    Bun.env.VAPID_CONTACT_EMAIL || "mailto:admin@localhost",
    publicKey,
    privateKey,
  );

  return vapidKeys;
}

/**
 * Convert PEM public key to base64url format for web push
 */
function convertPemToBase64Url(pem: string): string {
  // If already in base64url format (no PEM headers), return as-is
  if (!pem.startsWith("-----BEGIN")) {
    return pem;
  }

  // For EC public keys in PEM format, we need to extract the raw key
  // The PEM contains ASN.1 DER encoded data, and we need just the EC point

  // Remove PEM headers and decode base64
  const pemContents = pem
    .replace(/-----BEGIN.*-----/, "")
    .replace(/-----END.*-----/, "")
    .replace(/\s/g, "");

  const derBuffer = Buffer.from(pemContents, "base64");

  // For P-256 EC public keys, the uncompressed point is the last 65 bytes
  // (0x04 prefix + 32 bytes x + 32 bytes y)
  // The DER structure is: SEQUENCE { SEQUENCE { OID, OID }, BIT STRING { point } }
  // The point starts at a fixed offset for P-256 keys

  // Find the 0x04 byte which marks the start of uncompressed point
  let pointStart = -1;
  for (let i = 0; i < derBuffer.length - 65; i++) {
    if (derBuffer[i] === 0x04) {
      // Check if this could be the start of a 65-byte uncompressed point
      if (derBuffer.length - i >= 65) {
        pointStart = i;
        break;
      }
    }
  }

  if (pointStart === -1) {
    throw new Error("Could not find EC point in PEM public key");
  }

  const point = derBuffer.slice(pointStart, pointStart + 65);

  // Convert to base64url (URL-safe base64 without padding)
  return point
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Convert PEM private key to base64url format for web push
 */
function convertPrivateKeyPemToBase64Url(pem: string): string {
  // If already in base64url format, return as-is
  if (!pem.startsWith("-----BEGIN")) {
    return pem;
  }

  // Remove PEM headers and decode base64
  const pemContents = pem
    .replace(/-----BEGIN.*-----/, "")
    .replace(/-----END.*-----/, "")
    .replace(/\s/g, "");

  const derBuffer = Buffer.from(pemContents, "base64");

  // For P-256 EC private keys, we need to extract the 32-byte private key value
  // The DER structure varies but typically the private key is preceded by 0x04 0x20
  // (OCTET STRING of length 32)

  // Look for the pattern 0x04 0x20 followed by 32 bytes
  for (let i = 0; i < derBuffer.length - 34; i++) {
    if (derBuffer[i] === 0x04 && derBuffer[i + 1] === 0x20) {
      const privateKeyBytes = derBuffer.slice(i + 2, i + 34);
      return privateKeyBytes
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    }
  }

  throw new Error("Could not extract private key from PEM");
}

/**
 * Get the public key in base64url format for the frontend
 */
export function getVapidPublicKey(): string {
  const keys = loadVapidKeys();
  return keys.publicKey;
}

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  image?: string;
  badge?: string;
  vibrate?: number[];
  tag?: string;
  data?: Record<string, unknown>;
  actions?: Array<{ action: string; title: string }>;
}

/**
 * Send a web push notification
 */
export async function sendWebPushNotification(
  subscription: PushSubscription,
  payload: PushPayload,
): Promise<{ success: boolean; expired?: boolean; error?: string }> {
  try {
    // Ensure VAPID keys are loaded
    loadVapidKeys();

    const fullPayload = {
      ...payload,
      icon: payload.icon || "/icon-192.png",
      badge: payload.badge || "/icon-32.png",
      vibrate: payload.vibrate || [200, 100, 200],
    };

    const parsedKeys =
      typeof subscription.keys === "string"
        ? JSON.parse(subscription.keys)
        : subscription.keys;

    const normalizedSub = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: parsedKeys?.p256dh,
        auth: parsedKeys?.auth,
      },
    };

    await webpush.sendNotification(normalizedSub, JSON.stringify(fullPayload), {
      TTL: 86400, // 24 hours — push services discard queued messages after this
    });

    console.log(`Sent notification: ${payload.title}`);
    return { success: true };
  } catch (error: unknown) {
    const err = error as { statusCode?: number; message?: string };
    console.error("WebPush error:", err);

    // Check for expired subscription (410 Gone)
    if (err.statusCode === 410) {
      return { success: false, expired: true, error: "Subscription expired" };
    }

    return {
      success: false,
      error: err.message || "Failed to send notification",
    };
  }
}
