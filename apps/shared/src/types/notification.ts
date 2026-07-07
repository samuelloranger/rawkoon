export type NotificationType =
  | "reminder"
  | "external"
  | "app-update"
  | "service_monitor"
  | "system"
  | "request_pending"
  | "request_decided"
  | "request_available";

export interface Notification {
  id: number;
  user_id?: string;
  title: string;
  body: string;
  type: NotificationType;
  read: boolean;
  read_at: string | null;
  url: string | null;
  image_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface NotificationsResponse {
  notifications: Notification[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface UnreadCountResponse {
  unread_count: number;
}

interface NotificationDevice {
  id: number;
  endpoint: string;
  device_name: string;
  platform: string;
  os_name: string;
  os_version: string;
  browser_name: string;
  browser_version: string;
  created_at: string | Date;
}

export interface NotificationDevicesResponse {
  devices: NotificationDevice[];
}
