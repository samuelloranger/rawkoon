// Type definitions for service worker

export interface NotificationData {
  url?: string;
  notification_type?: string | null;
  action?: string;
  silent?: boolean;
  notification_id?: number | null;
}

export interface PushNotificationData {
  title?: string;
  body?: string;
  icon?: string;
  badge?: string;
  image?: string;
  tag?: string;
  vibrate?: number[];
  actions?: Array<{ action: string; title: string }>;
  data?: NotificationData;
}

export interface MessageData {
  type:
    | "clearBadge"
    | "syncBadge"
    | "showUpdateNotification"
    | "notification-sync"
    | "notification-received"
    | "clearCache"
    | "cacheBookFile"
    | "evictBookFile"
    | "bookCacheStatus";
  notificationId?: number | null;
  /** Books: every BookFile a cache message covers — an audiobook has several. */
  fileIds?: number[];
  /** Books: identifies the metadata to store alongside the bytes. */
  bookId?: number | null;
  editionId?: number | null;
  notificationData?: PushNotificationData;
}

export interface UnreadCountResponse {
  unread_count?: number;
}

export interface SyncEvent extends ExtendableEvent {
  tag?: string;
}
