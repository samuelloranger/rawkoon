import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Dialog } from "@/components/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HttpError } from "@/lib/api/httpClient";
import { useImportJellyfinUsers } from "@/pages/settings/useJellyfinUserLink";
import type { JellyfinUserOption } from "@rawkoon/shared/types";

type Role = "user" | "admin";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  users: JellyfinUserOption[];
}

export const isImportable = (user: JellyfinUserOption) =>
  !user.disabled && !user.linked_user_id;

export function ImportJellyfinDialog({ isOpen, onClose, users }: Props) {
  const { t } = useTranslation("common");
  const importMutation = useImportJellyfinUsers();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [roles, setRoles] = useState<Record<string, Role>>({});

  const toggle = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleImport = async () => {
    try {
      const result = await importMutation.mutateAsync(
        [...selected].map((id) => ({
          jellyfin_user_id: id,
          is_admin: roles[id] === "admin",
        })),
      );
      toast.success(
        t("settings.users.importJellyfin.success", {
          count: result.created.length,
        }),
      );
      if (result.skipped.length > 0) {
        const names = result.skipped.map(
          (s) =>
            `${users.find((u) => u.id === s.jellyfin_user_id)?.name ?? s.jellyfin_user_id} (${s.reason})`,
        );
        toast.warning(
          t("settings.users.importJellyfin.skipped", {
            list: names.join(", "),
          }),
        );
      }
      setSelected(new Set());
      onClose();
    } catch (error: unknown) {
      toast.error(
        (error instanceof HttpError ? error.apiError() : undefined) ||
          t("settings.users.importJellyfin.error"),
      );
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("settings.users.importJellyfin.title")}
    >
      <p className="text-sm text-neutral-400 mb-4">
        {t("settings.users.importJellyfin.description")}
      </p>
      <ul className="space-y-2 mb-6">
        {users.map((user) => {
          const importable = isImportable(user);
          const note = user.disabled
            ? t("settings.users.importJellyfin.disabled")
            : user.linked_user_id
              ? t("settings.users.importJellyfin.alreadyLinked")
              : null;
          return (
            <li
              key={user.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-neutral-700/50 border border-neutral-600"
            >
              <Checkbox
                id={`import-jellyfin-${user.id}`}
                aria-label={user.name}
                checked={selected.has(user.id)}
                disabled={!importable}
                onChange={(e) => toggle(user.id, e.target.checked)}
              />
              <label
                htmlFor={`import-jellyfin-${user.id}`}
                className="flex-1 min-w-0 text-sm text-neutral-100 truncate"
              >
                {user.name}
                {note && (
                  <span className="ml-2 text-xs text-neutral-400">{note}</span>
                )}
              </label>
              <Select
                value={roles[user.id] ?? "user"}
                onValueChange={(value) =>
                  setRoles((prev) => ({ ...prev, [user.id]: value as Role }))
                }
                disabled={!importable}
              >
                <SelectTrigger
                  className="w-28"
                  aria-label={t("settings.users.role")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">
                    {t("settings.users.importJellyfin.roleUser")}
                  </SelectItem>
                  <SelectItem value="admin">
                    {t("settings.users.importJellyfin.roleAdmin")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          onClick={handleImport}
          disabled={selected.size === 0 || importMutation.isPending}
        >
          {t("settings.users.importJellyfin.import", {
            count: selected.size,
          })}
        </Button>
      </div>
    </Dialog>
  );
}
