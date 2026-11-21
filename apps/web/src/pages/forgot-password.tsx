import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/forgot-password")({
  beforeLoad: async () => {
    const user = await getCurrentUser().catch(() => null);
    if (user) throw redirect({ to: "/" });
  },
  component: ForgotPasswordPage,
});

// The server has no email transport, so don't call the reset endpoint: an admin resets passwords.
function ForgotPasswordPage() {
  const { t } = useTranslation("common");

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="mx-auto h-12 w-12 flex items-center justify-center">
            <KeyRound className="w-10 h-10 text-primary-400" />
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            {t("forgotPassword.title")}
          </h2>
          <p className="mt-4 text-center text-sm text-neutral-400">
            {t("forgotPassword.description")}
          </p>
        </div>
        <div className="text-center">
          <Link
            to="/login"
            className="font-medium text-primary-400 hover:text-primary-300"
          >
            {t("forgotPassword.backToLogin")}
          </Link>
        </div>
      </div>
    </div>
  );
}
