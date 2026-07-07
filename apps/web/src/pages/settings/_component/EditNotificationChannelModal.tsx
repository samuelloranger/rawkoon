import { useState } from "react";
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
      toast.error("Label cannot be empty.");
      return;
    }
    updateMutation.mutate(
      { id: channel.id, label: editLabel.trim(), config: editConfig },
      {
        onSuccess: () => {
          toast.success("Channel updated.");
          onClose();
        },
        onError: (err) => {
          toast.error(
            err instanceof Error ? err.message : "Failed to update channel.",
          );
        },
      },
    );
  }

  return (
    <Dialog
      isOpen={channel !== null}
      onClose={onClose}
      title={`Edit — ${channel?.label ?? ""}`}
      panelClassName="max-w-lg"
    >
      <div className="space-y-4 pt-2">
        <div>
          <h3 className="text-sm font-medium text-neutral-300 mb-1">Label</h3>
          <Input
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            placeholder="My channel"
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
            {updateMutation.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={updateMutation.isPending}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
