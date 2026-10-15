import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { getCurrentUser } from "@/lib/auth";
import { useSetupStatus } from "@/lib/auth/useAuth";
import { LoginForm } from "@/pages/login/_component/LoginForm";
import { SetupForm } from "@/pages/login/_component/SetupForm";

type LoginSearch = { redirect?: string };

/** Only same-app paths, so a crafted link can't bounce a fresh login offsite. */
export const safeRedirect = (target: string | undefined) =>
  target?.startsWith("/") && !target.startsWith("//") ? target : "/";

export const Route = createFileRoute("/login/")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const user = await getCurrentUser().catch(() => null);
    if (user) throw redirect({ href: safeRedirect(search.redirect) });
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
            <img
              decoding="async"
              src="/icon-192.png"
              alt="Rawkoon"
              className="h-12 w-12"
            />
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
