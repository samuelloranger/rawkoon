export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Convert a base64url or base64 string to Uint8Array
 * Handles both standard base64 and base64url (URL-safe) formats
 * Also handles PEM format by extracting the base64 content
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  // Remove any whitespace
  let cleanedString = base64String.trim();

  // If it's a PEM format, extract the base64 content
  if (cleanedString.includes("-----BEGIN")) {
    // Extract base64 content between headers
    const base64Match = cleanedString.match(
      /-----BEGIN[^-]+-----\s*([A-Za-z0-9+/=\s]+)\s*-----END[^-]+-----/,
    );
    if (base64Match && base64Match[1]) {
      cleanedString = base64Match[1].replace(/\s/g, "");
    } else {
      throw new Error("Invalid PEM format: could not extract base64 content");
    }
  }

  // Convert base64url to standard base64
  // Base64url uses - and _ instead of + and /, and no padding
  let base64 = cleanedString.replace(/-/g, "+").replace(/_/g, "/");

  // Add padding if needed (base64 strings must be multiples of 4)
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  base64 = base64 + padding;

  try {
    // Decode base64 to binary string
    const rawData = window.atob(base64);

    // Convert binary string to Uint8Array
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
  } catch (error) {
    console.error("Error decoding base64 string:", error);
    console.error(
      "Input string (first 100 chars):",
      cleanedString.substring(0, 100),
    );
    throw new Error(`Invalid base64 string: ${error}`, { cause: error });
  }
}

export const saveEndpoint = (endpoint: string) => {
  try {
    localStorage.setItem("push-subscription-endpoint", endpoint);
  } catch (e) {
    console.warn("Failed to save subscription to localStorage:", e);
  }
};

export const removeEndpoint = () => {
  try {
    localStorage.removeItem("push-subscription-endpoint");
  } catch (e) {
    console.warn("Failed to remove subscription from localStorage:", e);
  }
};

// Store the full serialized subscription (endpoint + keys) so we can detect
// key rotation: same endpoint, different p256dh/auth.
const SUBSCRIPTION_STORAGE_KEY = "push-subscription-data";

export const saveSubscription = (sub: PushSubscriptionData) => {
  try {
    localStorage.setItem(SUBSCRIPTION_STORAGE_KEY, JSON.stringify(sub));
  } catch (e) {
    console.warn("Failed to save subscription data to localStorage:", e);
  }
};

export const loadSubscription = (): PushSubscriptionData | null => {
  try {
    const raw = localStorage.getItem(SUBSCRIPTION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PushSubscriptionData) : null;
  } catch {
    return null;
  }
};

export const removeSubscription = () => {
  try {
    localStorage.removeItem(SUBSCRIPTION_STORAGE_KEY);
  } catch (e) {
    console.warn("Failed to remove subscription data from localStorage:", e);
  }
};

export const isPushStoreError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("error retrieving push subscription");
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const hardResetServiceWorkerForPush =
  async (): Promise<ServiceWorkerRegistration> => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((reg) => reg.unregister()));
    await navigator.serviceWorker.register("/sw.js");
    const readyRegistration = await navigator.serviceWorker.ready;
    await wait(200);
    return readyRegistration;
  };

export const serializeSubscription = (
  sub: globalThis.PushSubscription,
): PushSubscriptionData => ({
  endpoint: sub.endpoint,
  keys: {
    p256dh: arrayBufferToBase64(sub.getKey("p256dh")!),
    auth: arrayBufferToBase64(sub.getKey("auth")!),
  },
});
