import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { getCurrentUser } from "@/lib/auth";
import { useSetupStatus } from "@/lib/auth/useAuth";
import { LoginForm } from "@/pages/login/_component/LoginForm";
import { SetupForm } from "@/pages/login/_component/SetupForm";

export const Route = createFileRoute("/login/")({
  beforeLoad: async () => {
    const user = await getCurrentUser().catch(() => null);
    if (user) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation("common");
  const { data: setup, isLoading } = useSetupStatus();
  const needsSetup = setup?.needs_setup === true;

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="mx-auto h-12 w-12 flex items-center justify-center">
            <img src="/icon-192.png" alt="Rawkoon" className="h-12 w-12" />
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            {needsSetup ? t("setup.title") : t("login.welcome")}
          </h2>
          <p className="mt-2 text-center text-sm text-neutral-400">
            {needsSetup ? t("setup.subtitle") : t("login.signIn")}
          </p>
        </div>
        {isLoading ? null : needsSetup ? <SetupForm /> : <LoginForm />}
      </div>
    </div>
  );
}
