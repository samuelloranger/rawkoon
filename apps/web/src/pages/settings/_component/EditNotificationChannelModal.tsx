import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  NotificationChannel,
  NotificationChannelConfig,
} from "@rawkoon/shared/types";
import { useUpdateNotificationChannel } from "@/lib/notifications/useNotificationChannels";
import { Dialog } from "@/components/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  emptyConfig,
  NotificationChannelConfigFields,
} from "./NotificationChannelConfigFields";

interface Props {
  channel: NotificationChannel | null;
  onClose: () => void;
}

export function EditNotificationChannelModal({ channel, onClose }: Props) {
  const { t } = useTranslation("common");
  const updateMutation = useUpdateNotificationChannel();

  // Initialized from props on mount — parent passes key={channel.id} to remount
  // when the target channel changes, so useState always starts with fresh values.
  const [editLabel, setEditLabel] = useState(channel?.label ?? "");
  const [editConfig, setEditConfig] = useState<NotificationChannelConfig>(
    channel?.config ?? emptyConfig("ntfy"),
  );

  async function handleSave() {
    if (!channel) return;
    if (!editLabel.trim()) {
      toast.error(t("settings.notifications.channels.labelEmpty"));
      return;
    }
    updateMutation.mutate(
      { id: channel.id, label: editLabel.trim(), config: editConfig },
      {
        onSuccess: () => {
          toast.success(t("settings.notifications.channels.updated"));
          onClose();
        },
        onError: (err) => {
          toast.error(
            err instanceof Error
              ? err.message
              : t("settings.notifications.channels.updateError"),
          );
        },
      },
    );
  }

  return (
    <Dialog
      isOpen={channel !== null}
      onClose={onClose}
      title={t("settings.notifications.channels.editTitle", {
        label: channel?.label ?? "",
      })}
      panelClassName="max-w-lg"
    >
      <div className="space-y-4 pt-2">
        <div>
          <h3 className="text-sm font-medium text-neutral-300 mb-1">
            {t("settings.notifications.channels.label")}
          </h3>
          <Input
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            placeholder={t("settings.notifications.channels.labelPlaceholder")}
          />
        </div>

        {channel && (
          <NotificationChannelConfigFields
            type={channel.type}
            config={editConfig}
            onChange={setEditConfig}
          />
        )}

        <div className="flex gap-2 pt-1">
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? t("common.saving") : t("common.save")}
          </Button>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={updateMutation.isPending}
          >
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
