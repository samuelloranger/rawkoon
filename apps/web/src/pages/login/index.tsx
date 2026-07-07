import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/pages/login/_component/LoginForm";

export const Route = createFileRoute("/login/")({
  beforeLoad: async () => {
    const user = await getCurrentUser().catch(() => null);
    if (user) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation("common");

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="mx-auto h-12 w-12 flex items-center justify-center">
            <img src="/icon-192.png" alt="Rawkoon" className="h-12 w-12" />
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            {t("login.welcome")}
          </h2>
          <p className="mt-2 text-center text-sm text-neutral-400">
            {t("login.signIn")}
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
