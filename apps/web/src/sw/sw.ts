// Extend NotificationOptions to include vibrate and actions
// This needs to be in a regular .ts file (not .d.ts) to be properly included
declare global {
  interface NotificationOptions {
    vibrate?: number[];
    actions?: Array<{ action: string; title: string }>;
  }
}

// Typed reference to self for use throughout the service worker
// TypeScript doesn't allow overriding the global self type when DOM types are present,
// so we provide a typed constant instead
export const sw: ServiceWorkerGlobalScope =
  self as unknown as ServiceWorkerGlobalScope;
