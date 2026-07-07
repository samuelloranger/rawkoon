import { useState } from "react";
import { toast } from "sonner";
import { Trash2, Send, Plus, Pencil } from "lucide-react";
import type { NotificationChannel } from "@rawkoon/shared/types";
import {
  useNotificationChannels,
  useUpdateNotificationChannel,
  useDeleteNotificationChannel,
  useTestNotificationChannel,
} from "@/lib/notifications/useNotificationChannels";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AddNotificationChannelModal } from "./AddNotificationChannelModal";
import { EditNotificationChannelModal } from "./EditNotificationChannelModal";

export function NotificationChannelsSection() {
  const { data, isLoading } = useNotificationChannels();
  const updateMutation = useUpdateNotificationChannel();
  const deleteMutation = useDeleteNotificationChannel();
  const testMutation = useTestNotificationChannel();

  const channels = data?.channels ?? [];

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] =
    useState<NotificationChannel | null>(null);

  async function handleToggle(id: number, enabled: boolean) {
    updateMutation.mutate(
      { id, enabled },
      {
        onSuccess: () =>
          toast.success(enabled ? "Channel enabled." : "Channel disabled."),
        onError: (err) => {
          toast.error(
            err instanceof Error ? err.message : "Failed to update channel.",
          );
        },
      },
    );
  }

  async function handleTest(id: number) {
    testMutation.mutate(id, {
      onSuccess: () => toast.success("Test notification sent."),
      onError: (err) => {
        toast.error(
          err instanceof Error
            ? err.message
            : "Failed to send test notification.",
        );
      },
    });
  }

  async function handleDelete(id: number) {
    deleteMutation.mutate(id, {
      onSuccess: () => toast.success("Channel deleted."),
      onError: (err) => {
        toast.error(
          err instanceof Error ? err.message : "Failed to delete channel.",
        );
      },
    });
  }

  return (
    <>
      <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">
              Notification Channels
            </h2>
            <p className="text-sm text-neutral-400 mt-0.5">
              Push notifications to external services.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setAddModalOpen(true)}
            className="whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add Channel
          </Button>
        </div>

        {isLoading ? (
          <div className="p-4 text-center text-neutral-400 text-sm">
            Loading channels…
          </div>
        ) : channels.length === 0 ? (
          <div className="p-4 bg-neutral-700/50 rounded-lg text-neutral-400 text-sm">
            No channels configured.
          </div>
        ) : (
          <div className="space-y-2">
            {channels.map((channel) => (
              <div
                key={channel.id}
                className="flex items-center justify-between p-4 bg-neutral-700/50 rounded-lg"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Switch
                    checked={channel.enabled}
                    onCheckedChange={(checked) =>
                      handleToggle(channel.id, checked)
                    }
                    disabled={updateMutation.isPending}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-neutral-100 truncate">
                      {channel.label}
                    </div>
                    <div className="text-xs text-neutral-400">
                      {channel.type}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 ml-3 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditingChannel(channel)}
                    title="Edit channel"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleTest(channel.id)}
                    disabled={testMutation.isPending}
                    title="Send test notification"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(channel.id)}
                    disabled={deleteMutation.isPending}
                    title="Delete channel"
                    className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AddNotificationChannelModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
      />

      <EditNotificationChannelModal
        key={editingChannel?.id ?? "none"}
        channel={editingChannel}
        onClose={() => setEditingChannel(null)}
      />
    </>
  );
}
