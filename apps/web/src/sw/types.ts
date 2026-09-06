import type { SwUiStrings } from "./strings";

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
    | "notification-sync"
    | "notification-received"
    | "clearCache"
    | "setStrings";
  notificationId?: number | null;
  notificationData?: PushNotificationData;
  strings?: Partial<SwUiStrings>;
}

export interface UnreadCountResponse {
  unread_count?: number;
}

export interface SyncEvent extends ExtendableEvent {
  tag?: string;
}
