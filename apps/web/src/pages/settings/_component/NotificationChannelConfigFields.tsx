import type {
  NotificationChannelType,
  NotificationChannelConfig,
  NtfyChannelConfig,
  TelegramChannelConfig,
  DiscordChannelConfig,
  GotifyChannelConfig,
  PushoverChannelConfig,
  SlackChannelConfig,
  WebhookChannelConfig,
} from "@rawkoon/shared/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const CHANNEL_TYPES: {
  value: NotificationChannelType;
  label: string;
}[] = [
  { value: "ntfy", label: "ntfy" },
  { value: "telegram", label: "Telegram" },
  { value: "discord", label: "Discord" },
  { value: "gotify", label: "Gotify" },
  { value: "pushover", label: "Pushover" },
  { value: "slack", label: "Slack" },
  { value: "webhook", label: "Webhook" },
];

export function emptyConfig(
  type: NotificationChannelType,
): NotificationChannelConfig {
  switch (type) {
    case "ntfy":
      return { url: "", topic: "", token: "", priority: undefined };
    case "telegram":
      return { bot_token: "", chat_id: "" };
    case "discord":
      return { webhook_url: "" };
    case "gotify":
      return { url: "", token: "", priority: undefined };
    case "pushover":
      return { token: "", user: "", priority: undefined };
    case "slack":
      return { webhook_url: "" };
    case "webhook":
      return { url: "", method: "POST" as const, body_template: undefined };
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown channel type: ${_exhaustive}`);
    }
  }
}

interface ConfigFieldsProps {
  type: NotificationChannelType;
  config: NotificationChannelConfig;
  onChange: (config: NotificationChannelConfig) => void;
}

const fieldClass = "text-sm font-medium text-neutral-300 mb-1";

export function NotificationChannelConfigFields({
  type,
  config,
  onChange,
}: ConfigFieldsProps) {
  switch (type) {
    case "ntfy": {
      const cfg = config as NtfyChannelConfig;
      return (
        <div className="space-y-3">
          <div>
            <h3 className={fieldClass}>Server URL</h3>
            <Input
              value={cfg.url}
              onChange={(e) => onChange({ ...cfg, url: e.target.value })}
              placeholder="https://ntfy.sh"
            />
          </div>
          <div>
            <h3 className={fieldClass}>Topic</h3>
            <Input
              value={cfg.topic}
              onChange={(e) => onChange({ ...cfg, topic: e.target.value })}
              placeholder="my-topic"
            />
          </div>
          <div>
            <h3 className={fieldClass}>
              Access token{" "}
              <span className="font-normal text-neutral-500">(optional)</span>
            </h3>
            <Input
              value={cfg.token ?? ""}
              onChange={(e) =>
                onChange({ ...cfg, token: e.target.value || undefined })
              }
              placeholder="tk_..."
            />
          </div>
        </div>
      );
    }
    case "telegram": {
      const cfg = config as TelegramChannelConfig;
      return (
        <div className="space-y-3">
          <div>
            <h3 className={fieldClass}>Bot Token</h3>
            <Input
              value={cfg.bot_token}
              onChange={(e) => onChange({ ...cfg, bot_token: e.target.value })}
              placeholder="123456:ABC-DEF..."
            />
          </div>
          <div>
            <h3 className={fieldClass}>Chat ID</h3>
            <Input
              value={cfg.chat_id}
              onChange={(e) => onChange({ ...cfg, chat_id: e.target.value })}
              placeholder="-1001234567890"
            />
          </div>
        </div>
      );
    }
    case "discord": {
      const cfg = config as DiscordChannelConfig;
      return (
        <div>
          <h3 className={fieldClass}>Webhook URL</h3>
          <Input
            value={cfg.webhook_url}
            onChange={(e) => onChange({ ...cfg, webhook_url: e.target.value })}
            placeholder="https://discord.com/api/webhooks/..."
          />
        </div>
      );
    }
    case "gotify": {
      const cfg = config as GotifyChannelConfig;
      return (
        <div className="space-y-3">
          <div>
            <h3 className={fieldClass}>Server URL</h3>
            <Input
              value={cfg.url}
              onChange={(e) => onChange({ ...cfg, url: e.target.value })}
              placeholder="https://gotify.example.com"
            />
          </div>
          <div>
            <h3 className={fieldClass}>App Token</h3>
            <Input
              value={cfg.token}
              onChange={(e) => onChange({ ...cfg, token: e.target.value })}
              placeholder="A_z..."
            />
          </div>
        </div>
      );
    }
    case "pushover": {
      const cfg = config as PushoverChannelConfig;
      return (
        <div className="space-y-3">
          <div>
            <h3 className={fieldClass}>API Token</h3>
            <Input
              value={cfg.token}
              onChange={(e) => onChange({ ...cfg, token: e.target.value })}
              placeholder="azGDORePK8gMaC0QOYAMyEEuzJnyUi"
            />
          </div>
          <div>
            <h3 className={fieldClass}>User Key</h3>
            <Input
              value={cfg.user}
              onChange={(e) => onChange({ ...cfg, user: e.target.value })}
              placeholder="uQiRzpo4DXghDmr9QzzfQu27cmVRsG"
            />
          </div>
        </div>
      );
    }
    case "slack": {
      const cfg = config as SlackChannelConfig;
      return (
        <div>
          <h3 className={fieldClass}>Webhook URL</h3>
          <Input
            value={cfg.webhook_url}
            onChange={(e) => onChange({ ...cfg, webhook_url: e.target.value })}
            placeholder="https://hooks.slack.com/services/..."
          />
        </div>
      );
    }
    case "webhook": {
      const cfg = config as WebhookChannelConfig;
      return (
        <div className="space-y-3">
          <div>
            <h3 className={fieldClass}>
              URL{" "}
              <span className="font-normal text-neutral-500">
                (supports <code>{"{{title}}"}</code>, <code>{"{{body}}"}</code>,{" "}
                <code>{"{{url}}"}</code>)
              </span>
            </h3>
            <Input
              value={cfg.url}
              onChange={(e) => onChange({ ...cfg, url: e.target.value })}
              placeholder="https://your-server.example.com/webhook?msg={{body}}"
            />
          </div>
          <div>
            <h3 className={fieldClass}>Method</h3>
            <Select
              value={cfg.method ?? "POST"}
              onValueChange={(v) =>
                onChange({
                  ...cfg,
                  method: v as "GET" | "POST",
                  body_template: v === "GET" ? undefined : cfg.body_template,
                })
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="GET">GET</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(cfg.method ?? "POST") === "POST" && (
            <div>
              <h3 className={fieldClass}>
                Body template{" "}
                <span className="font-normal text-neutral-500">
                  (optional — must be valid JSON)
                </span>
              </h3>
              <Textarea
                value={cfg.body_template ?? ""}
                onChange={(e) =>
                  onChange({
                    ...cfg,
                    body_template: e.target.value || undefined,
                  })
                }
                placeholder={'{"message": "{{body}}", "subject": "{{title}}"}'}
                rows={3}
                className="font-mono text-xs"
              />
            </div>
          )}
        </div>
      );
    }
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown channel type: ${_exhaustive}`);
    }
  }
}
