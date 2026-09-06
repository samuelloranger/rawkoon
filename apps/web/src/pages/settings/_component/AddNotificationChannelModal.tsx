import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  NotificationChannelType,
  NotificationChannelConfig,
  NtfyChannelConfig,
} from "@rawkoon/shared/types";
import { useCreateNotificationChannel } from "@/lib/notifications/useNotificationChannels";
import { Dialog } from "@/components/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CHANNEL_TYPES,
  emptyConfig,
  NotificationChannelConfigFields,
} from "./NotificationChannelConfigFields";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function AddNotificationChannelModal({ isOpen, onClose }: Props) {
  const { t } = useTranslation("common");
  const createMutation = useCreateNotificationChannel();

  const [formType, setFormType] = useState<NotificationChannelType>("ntfy");
  const [formLabel, setFormLabel] = useState("");
  const [formConfig, setFormConfig] = useState<NotificationChannelConfig>(
    emptyConfig("ntfy"),
  );

  function handleTypeChange(value: NotificationChannelType) {
    setFormType(value);
    setFormConfig(emptyConfig(value));
  }

  function handleClose() {
    setFormType("ntfy");
    setFormLabel("");
    setFormConfig(emptyConfig("ntfy"));
    onClose();
  }

  async function handleAdd() {
    if (!formLabel.trim()) {
      toast.error(t("settings.notifications.channels.labelRequired"));
      return;
    }
    const config =
      formType === "ntfy"
        ? {
            ...(formConfig as NtfyChannelConfig),
            token: (formConfig as NtfyChannelConfig).token?.trim() || undefined,
          }
        : formConfig;

    createMutation.mutate(
      { type: formType, label: formLabel.trim(), config },
      {
        onSuccess: () => {
          toast.success(t("settings.notifications.channels.added"));
          handleClose();
        },
        onError: (err) => {
          toast.error(
            err instanceof Error
              ? err.message
              : t("settings.notifications.channels.addError"),
          );
        },
      },
    );
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={t("settings.notifications.channels.addTitle")}
      panelClassName="max-w-lg"
    >
      <div className="space-y-4 pt-2">
        <div>
          <h3 className="text-sm font-medium text-neutral-300 mb-1">
            {t("settings.notifications.channels.type")}
          </h3>
          <Select
            value={formType}
            onValueChange={(v) =>
              handleTypeChange(v as NotificationChannelType)
            }
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNEL_TYPES.map((ct) => (
                <SelectItem key={ct.value} value={ct.value}>
                  {ct.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <h3 className="text-sm font-medium text-neutral-300 mb-1">
            {t("settings.notifications.channels.label")}
          </h3>
          <Input
            value={formLabel}
            onChange={(e) => setFormLabel(e.target.value)}
            placeholder={t("settings.notifications.channels.labelPlaceholder")}
          />
        </div>

        <NotificationChannelConfigFields
          type={formType}
          config={formConfig}
          onChange={setFormConfig}
        />

        <div className="flex gap-2 pt-1">
          <Button onClick={handleAdd} disabled={createMutation.isPending}>
            {createMutation.isPending
              ? t("settings.notifications.channels.adding")
              : t("settings.notifications.channels.addTitle")}
          </Button>
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={createMutation.isPending}
          >
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
