import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { HttpError } from "@/lib/api/httpClient";
import { Button } from "@/components/ui/button";
import { useAdminUsers } from "@/pages/settings/useAdminUsers";
import { useDeleteUser } from "@/pages/settings/useDeleteUser";
import { useUpdateUserRole } from "@/pages/settings/useUpdateUserRole";
import { useResetUserPassword } from "@/pages/settings/useResetUserPassword";
import { useCurrentUser } from "@/lib/auth/useAuth";
import { formatDateTime } from "@rawkoon/shared/utils";
import { LoadingState } from "@/components/LoadingState";
import { useConfirm } from "@/components/confirm/ConfirmContext";

const formatDisplayName = (user: {
  first_name: string | null;
  last_name: string | null;
  email: string;
}) => {
  if (user.first_name || user.last_name) {
    return [user.first_name, user.last_name].filter(Boolean).join(" ");
  }
  return user.email;
};

export function UsersListSection() {
  const { t, i18n } = useTranslation("common");
  const { confirm } = useConfirm();
  const updateRoleMutation = useUpdateUserRole();
  const resetPasswordMutation = useResetUserPassword();
  const deleteMutation = useDeleteUser();
  const { data: currentUser } = useCurrentUser();
  const {
    data: usersData,
    isLoading: usersLoading,
    error: usersError,
  } = useAdminUsers();

  const handleDeleteUser = async (userId: string, userEmail: string) => {
    confirm({
      variant: "destructive",
      description: t("settings.users.deleteConfirm", { email: userEmail }),
      confirmLabel: t("common.delete"),
      onConfirm: async () => {
        try {
          await deleteMutation.mutateAsync(userId);
          toast.success(t("settings.users.deleteSuccess"));
        } catch (error: unknown) {
          toast.error(
            (error instanceof HttpError ? error.apiError() : undefined) ||
              t("settings.users.deleteError") ||
              "Failed to delete user",
          );
        }
      },
    });
  };

  const handleToggleRole = async (
    userId: string,
    email: string,
    currentIsAdmin: boolean,
  ) => {
    confirm({
      description: `Are you sure you want to ${currentIsAdmin ? "demote" : "promote"} ${email}?`,
      confirmLabel: "Confirm",
      onConfirm: async () => {
        try {
          await updateRoleMutation.mutateAsync({
            userId,
            isAdmin: !currentIsAdmin,
          });
          toast.success("User role updated successfully");
        } catch (error: unknown) {
          toast.error(
            (error instanceof HttpError ? error.apiError() : undefined) ||
              "Failed to update user role",
          );
        }
      },
    });
  };

  const handleResetPassword = async (userId: string, email: string) => {
    const password = prompt(
      `Enter new password for ${email} (minimum 8 characters):`,
    );
    if (password === null) return;
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    try {
      await resetPasswordMutation.mutateAsync({ userId, password });
      toast.success("Password reset successfully");
    } catch (error: unknown) {
      toast.error(
        (error instanceof HttpError ? error.apiError() : undefined) ||
          "Failed to reset user password",
      );
    }
  };

  return (
    <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
      <h2 className="text-base font-semibold mb-1.5 text-neutral-100">
        {t("settings.users.listTitle")}
      </h2>

      {usersLoading ? (
        <LoadingState />
      ) : usersError ? (
        <div className="text-red-400">
          {t("settings.users.loadError") || "Failed to load users"}
        </div>
      ) : usersData?.users && usersData.users.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-neutral-700">
                <th className="text-left py-3 px-4 text-sm font-medium text-neutral-300">
                  {t("settings.users.email")}
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-neutral-300">
                  {t("settings.users.name")}
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-neutral-300">
                  {t("settings.users.role")}
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-neutral-300">
                  {t("settings.users.createdAt")}
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-neutral-300">
                  {t("settings.users.lastLogin")}
                </th>
                <th className="text-right py-3 px-4 text-sm font-medium text-neutral-300">
                  {t("settings.users.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {usersData.users.map((user) => {
                const isCurrentUser = currentUser?.id === user.id;
                const displayName = formatDisplayName(user);
                const initials =
                  [user.first_name, user.last_name]
                    .filter(Boolean)
                    .map((n) => n![0].toUpperCase())
                    .join("") || user.email[0].toUpperCase();
                return (
                  <tr
                    key={user.id}
                    className="border-b border-neutral-700 hover:bg-neutral-700/50 transition-colors"
                  >
                    <td className="py-3 px-4 text-sm text-neutral-100">
                      {user.email}
                    </td>
                    <td className="py-3 px-4 text-sm text-neutral-100">
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary-500/20 text-primary-400 text-xs font-semibold flex-shrink-0">
                          {initials}
                        </span>
                        {displayName}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {isCurrentUser ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-900 text-purple-200">
                          {t("settings.users.admin")}
                        </span>
                      ) : (
                        <button
                          onClick={() =>
                            handleToggleRole(
                              user.id,
                              user.email,
                              !!user.is_admin,
                            )
                          }
                          className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium hover:opacity-85 transition-opacity bg-neutral-700 text-neutral-200 cursor-pointer"
                        >
                          {user.is_admin ? (
                            <span className="bg-purple-900 text-purple-200 px-1 rounded mr-1">
                              Admin
                            </span>
                          ) : (
                            <span className="bg-neutral-800 text-neutral-400 px-1 rounded mr-1">
                              User
                            </span>
                          )}
                          (Change)
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-neutral-400">
                      {user.created_at
                        ? formatDateTime(user.created_at, i18n.language)
                        : "-"}
                    </td>
                    <td className="py-3 px-4 text-sm text-neutral-400">
                      {user.last_login
                        ? formatDateTime(user.last_login, i18n.language)
                        : "-"}
                    </td>
                    <td className="py-3 px-4 text-sm text-right">
                      {isCurrentUser ? (
                        <span className="text-neutral-500 text-xs">
                          {t("settings.users.currentUser")}
                        </span>
                      ) : (
                        <div className="flex items-center gap-2 justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              handleResetPassword(user.id, user.email)
                            }
                            title="Reset User Password"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() =>
                              handleDeleteUser(user.id, user.email)
                            }
                            disabled={deleteMutation.isPending}
                          >
                            {deleteMutation.isPending
                              ? t("settings.users.deleting") || "Deleting..."
                              : t("settings.users.delete") || "Delete"}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-8 text-neutral-400">
          {t("settings.users.noUsers") || "No users found"}
        </div>
      )}
    </div>
  );
}
