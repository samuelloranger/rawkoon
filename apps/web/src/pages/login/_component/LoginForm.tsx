import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { useLogin, useSSOProviders } from "@/lib/auth/useAuth";
import { oidcProviderIconUrl } from "@/lib/auth/useOidcProviders";
import { authClient } from "@/lib/auth/betterAuthClient";
import {
  browserSupportsWebAuthn,
  usePasskeyAuthenticate,
} from "@/lib/auth/usePasskey";

interface FormData {
  email: string;
  password: string;
}

export function LoginForm() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const loginMutation = useLogin();
  const passkeyMutation = usePasskeyAuthenticate();
  const { data: ssoProviders } = useSSOProviders();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: FormData) => {
    try {
      await loginMutation.mutateAsync({
        email: data.email,
        password: data.password,
      });

      navigate({ to: "/" });
    } catch (err: unknown) {
      toast.error(
        (err instanceof Error ? err.message : null) ||
          loginMutation.error?.message ||
          t("login.authFailed"),
      );
    }
  };

  const onPasskeyLogin = async () => {
    try {
      await passkeyMutation.mutateAsync();
      navigate({ to: "/" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : null;
      if (message && !message.toLowerCase().includes("cancel")) {
        toast.error(message || t("login.passkeyFailed"));
      }
    }
  };

  return (
    <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
      <div className="rounded-md shadow-sm -space-y-px">
        <div>
          <label htmlFor="email" className="sr-only">
            {t("login.emailAddress")}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email webauthn"
            {...register("email", {
              required: true,
              pattern: {
                value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                message: t("login.invalidEmail") || "Invalid email address",
              },
            })}
            className="appearance-none rounded-none relative block w-full px-3 py-2 border border-neutral-600 placeholder-neutral-400 text-white bg-neutral-800 rounded-t-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
            placeholder={t("login.emailAddress")}
          />
          {errors.email && (
            <p className="mt-1 text-sm text-red-400">
              {errors.email.message || t("login.emailRequired")}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="password" className="sr-only">
            {t("login.password")}
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register("password", { required: true })}
            className="appearance-none rounded-none relative block w-full px-3 py-2 border border-neutral-600 placeholder-neutral-400 text-white bg-neutral-800 rounded-b-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
            placeholder={t("login.password")}
          />
          {errors.password && (
            <p className="mt-1 text-sm text-red-400">
              {errors.password.message || t("login.passwordRequired")}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <button
          type="submit"
          disabled={loginMutation.isPending}
          className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 focus:ring-offset-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loginMutation.isPending
            ? t("login.loading")
            : t("login.signInButton")}
        </button>

        {(browserSupportsWebAuthn() ||
          (ssoProviders?.providers?.length ?? 0) > 0) && (
          <div className="relative flex items-center">
            <div className="flex-1 border-t border-neutral-600" />
            <span className="px-3 text-xs text-neutral-400">
              {t("login.or")}
            </span>
            <div className="flex-1 border-t border-neutral-600" />
          </div>
        )}

        {browserSupportsWebAuthn() && (
          <button
            type="button"
            onClick={onPasskeyLogin}
            disabled={passkeyMutation.isPending}
            className="group relative w-full flex justify-center items-center gap-2 py-2 px-4 border border-neutral-600 text-sm font-medium rounded-md text-neutral-300 bg-neutral-800 hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 focus:ring-offset-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <KeyRound className="w-4 h-4" />
            {passkeyMutation.isPending
              ? t("login.loading")
              : t("login.signInWithPasskey")}
          </button>
        )}

        {ssoProviders?.providers?.map((provider) => (
          <button
            key={provider.slug}
            type="button"
            onClick={() =>
              authClient.signIn.oauth2({
                providerId: provider.slug,
                callbackURL: "/",
              })
            }
            className="group relative w-full flex justify-center items-center gap-2.5 py-2 px-4 border border-neutral-600 text-sm font-medium rounded-md text-neutral-300 bg-neutral-800 hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 focus:ring-offset-neutral-900 transition-colors"
          >
            <img
              src={oidcProviderIconUrl(provider.slug, provider.icon_url)}
              alt=""
              className="size-5 rounded object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            {t("login.signInWith", { provider: provider.name })}
          </button>
        ))}
      </div>
    </form>
  );
}
