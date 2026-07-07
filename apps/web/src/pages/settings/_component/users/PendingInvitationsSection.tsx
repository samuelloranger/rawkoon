import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { HttpError } from "@/lib/api/httpClient";
import { Button } from "@/components/ui/button";
import { useAdminInvitations } from "@/pages/settings/useAdminInvitations";
import { useResendInvitation } from "@/pages/settings/useResendInvitation";
import { useRevokeInvitation } from "@/pages/settings/useRevokeInvitation";
import { formatDateTime } from "@rawkoon/shared/utils";
import { LoadingState } from "@/components/LoadingState";
import { useConfirm } from "@/components/confirm/ConfirmContext";

interface PendingInvitationsSectionProps {
  onLinkGenerated: (link: string) => void;
}

export function PendingInvitationsSection({
  onLinkGenerated,
}: PendingInvitationsSectionProps) {
  const { t, i18n } = useTranslation("common");
  const { confirm } = useConfirm();
  const regenerateInviteMutation = useResendInvitation();
  const revokeMutation = useRevokeInvitation();
  const { data: invitationsData, isLoading: invitationsLoading } =
    useAdminInvitations();

  const handleRegenerateInvitation = async (id: number) => {
    try {
      const result = await regenerateInviteMutation.mutateAsync(id);
      if (result.success && result.token) {
        const link = `${window.location.origin}/accept-invitation?token=${result.token}`;
        onLinkGenerated(link);
        toast.success("New invitation link generated");
      }
    } catch (error: unknown) {
      toast.error(
        (error instanceof HttpError ? error.apiError() : undefined) ||
          "Failed to regenerate invitation link",
      );
    }
  };

  const handleRevokeInvitation = async (id: number, email: string) => {
    confirm({
      variant: "destructive",
      description: t("settings.users.revokeConfirm", { email }),
      confirmLabel: t("settings.users.revoke"),
      onConfirm: async () => {
        try {
          await revokeMutation.mutateAsync(id);
          toast.success(t("settings.users.revokeSuccess"));
        } catch (error: unknown) {
          toast.error(
            (error instanceof HttpError ? error.apiError() : undefined) ||
              t("settings.users.revokeError") ||
              "Failed to revoke invitation",
          );
        }
      },
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-900 text-yellow-200">
            {t("settings.users.statusPending")}
          </span>
        );
      case "accepted":
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-900 text-green-200">
            {t("settings.users.statusAccepted")}
          </span>
        );
      case "revoked":
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-900 text-red-200">
            {t("settings.users.statusRevoked")}
          </span>
        );
      case "expired":
        return (
          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-neutral-700 text-neutral-200">
            {t("settings.users.statusExpired")}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
      <h2 className="text-base font-semibold mb-1.5 text-neutral-100">
        Pending Invite Links
      </h2>

      {invitationsLoading ? (
        <LoadingState />
      ) : invitationsData?.invitations &&
        invitationsData.invitations.length > 0 ? (
        <div className="overflow-x-auto mt-4">
          <table className="w-full">
            <thead>
              <tr className="border-b border-neutral-700">
                <th className="text-left py-3 px-4 text-sm font-medium text-neutral-300">
                  {t("settings.users.email")}
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-neutral-300">
                  {t("settings.users.status")}
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-neutral-300">
                  Created At
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-neutral-300">
                  {t("settings.users.expiresAt")}
                </th>
                <th className="text-right py-3 px-4 text-sm font-medium text-neutral-300">
                  {t("settings.users.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {invitationsData.invitations.map((inv) => (
                <tr
                  key={inv.id}
                  className="border-b border-neutral-700 hover:bg-neutral-700/50 transition-colors"
                >
                  <td className="py-3 px-4 text-sm text-neutral-100">
                    {inv.email}
                  </td>
                  <td className="py-3 px-4 text-sm">
                    {getStatusBadge(inv.status)}
                  </td>
                  <td className="py-3 px-4 text-sm text-neutral-400">
                    {formatDateTime(inv.created_at, i18n.language)}
                  </td>
                  <td className="py-3 px-4 text-sm text-neutral-400">
                    {formatDateTime(inv.expires_at, i18n.language)}
                  </td>
                  <td className="py-3 px-4 text-sm text-right">
                    {inv.status === "pending" && (
                      <div className="flex gap-2 justify-end">
                        <Button
                          size="sm"
                          onClick={() => handleRegenerateInvitation(inv.id)}
                          disabled={regenerateInviteMutation.isPending}
                        >
                          {regenerateInviteMutation.isPending
                            ? "Regenerating..."
                            : "Regenerate Link"}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() =>
                            handleRevokeInvitation(inv.id, inv.email)
                          }
                          disabled={revokeMutation.isPending}
                        >
                          {revokeMutation.isPending
                            ? t("settings.users.revoking") || "Revoking..."
                            : t("settings.users.revoke") || "Revoke"}
                        </Button>
                      </div>
                    )}
                    {inv.status === "expired" && (
                      <Button
                        size="sm"
                        onClick={() => handleRegenerateInvitation(inv.id)}
                        disabled={regenerateInviteMutation.isPending}
                      >
                        {regenerateInviteMutation.isPending
                          ? "Regenerating..."
                          : "Regenerate Link"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-8 text-neutral-400">
          No pending invite links
        </div>
      )}
    </div>
  );
}
