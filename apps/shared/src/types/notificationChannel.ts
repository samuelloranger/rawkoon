// Provider key. Add new members when implementing a new provider.
export type NotificationChannelType =
  | "ntfy"
  | "telegram"
  | "discord"
  | "gotify"
  | "pushover"
  | "slack"
  | "webhook";

export interface NtfyChannelConfig {
  url: string;
  topic: string;
  token?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
}

export interface TelegramChannelConfig {
  bot_token: string;
  chat_id: string;
}

export interface DiscordChannelConfig {
  webhook_url: string;
}

export interface GotifyChannelConfig {
  url: string;
  token: string;
  priority?: number;
}

export interface PushoverChannelConfig {
  token: string;
  user: string;
  priority?: -2 | -1 | 0 | 1;
}

export interface SlackChannelConfig {
  webhook_url: string;
}

export interface WebhookChannelConfig {
  url: string;
  method?: "GET" | "POST";
  body_template?: string;
}

// Discriminated union of all supported provider configs. When adding a new
// provider, add its *ChannelConfig interface to this union.
export type NotificationChannelConfig =
  | NtfyChannelConfig
  | TelegramChannelConfig
  | DiscordChannelConfig
  | GotifyChannelConfig
  | PushoverChannelConfig
  | SlackChannelConfig
  | WebhookChannelConfig;

export interface NotificationChannel {
  id: number;
  type: NotificationChannelType;
  label: string;
  config: NotificationChannelConfig;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationChannelsResponse {
  channels: NotificationChannel[];
}
