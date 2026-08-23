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
    | "clearCache";
  notificationId?: number | null;
  notificationData?: PushNotificationData;
}

export interface UnreadCountResponse {
  unread_count?: number;
}

export interface SyncEvent extends ExtendableEvent {
  tag?: string;
}
