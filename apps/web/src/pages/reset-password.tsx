import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckCircle, AlertTriangle, Lock } from "lucide-react";
import { useResetPassword } from "@/lib/auth/useAuth";
import { getCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) || "",
  }),
  beforeLoad: async () => {
    const user = await getCurrentUser().catch(() => null);
    if (user) throw redirect({ to: "/" });
  },
  component: ResetPasswordPage,
});

interface ResetPasswordFormData {
  password: string;
  confirmPassword: string;
}

function validatePasswordComplexity(
  value: string,
  t: (key: string) => string,
): string | true {
  if (!/[A-Z]/.test(value))
    return (
      t("login.passwordNeedsUppercase") ||
      "Password must contain at least one uppercase letter"
    );
  if (!/[a-z]/.test(value))
    return (
      t("login.passwordNeedsLowercase") ||
      "Password must contain at least one lowercase letter"
    );
  if (!/[0-9]/.test(value))
    return (
      t("login.passwordNeedsNumber") ||
      "Password must contain at least one number"
    );
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(value))
    return (
      t("login.passwordNeedsSpecialChar") ||
      "Password must contain at least one special character"
    );
  return true;
}

function ResetPasswordPage() {
  const { t } = useTranslation("common");
  const { token } = Route.useSearch();
  const [isSuccess, setIsSuccess] = useState(false);
  const resetPasswordMutation = useResetPassword();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ResetPasswordFormData>();
  const password = useWatch({ control, name: "password" });

  const onSubmit = async (data: ResetPasswordFormData) => {
    if (!token) {
      toast.error(t("resetPassword.invalidLink"));
      return;
    }
    try {
      await resetPasswordMutation.mutateAsync({
        token,
        password: data.password,
      });
      setIsSuccess(true);
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(err.message || t("resetPassword.error"));
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <div className="mx-auto h-12 w-12 flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-green-400" />
            </div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
              {t("resetPassword.successTitle")}
            </h2>
            <p className="mt-4 text-center text-sm text-neutral-400">
              {t("resetPassword.successMessage")}
            </p>
          </div>
          <div className="text-center">
            <Link
              to="/login"
              className="inline-flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              {t("resetPassword.goToLogin")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <div className="mx-auto h-12 w-12 flex items-center justify-center">
              <AlertTriangle className="w-10 h-10 text-red-400" />
            </div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
              {t("resetPassword.invalidLinkTitle")}
            </h2>
            <p className="mt-4 text-center text-sm text-neutral-400">
              {t("resetPassword.invalidLinkMessage")}
            </p>
          </div>
          <div className="text-center">
            <Link
              to="/forgot-password"
              className="font-medium text-primary-400 hover:text-primary-300"
            >
              {t("resetPassword.requestNewLink")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="mx-auto h-12 w-12 flex items-center justify-center">
            <Lock className="w-10 h-10 text-primary-400" />
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            {t("resetPassword.title")}
          </h2>
          <p className="mt-2 text-center text-sm text-neutral-400">
            {t("resetPassword.description")}
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="password" className="sr-only">
                {t("resetPassword.newPassword")}
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-neutral-600 placeholder-neutral-400 text-white bg-neutral-800 rounded-t-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
                placeholder={t("resetPassword.newPassword")}
                {...register("password", {
                  required: true,
                  minLength: {
                    value: 8,
                    message:
                      t("login.passwordMinLength") ||
                      "Password must be at least 8 characters",
                  },
                  validate: (value) => validatePasswordComplexity(value, t),
                })}
              />
              {errors.password && (
                <p className="mt-1 text-sm text-red-400">
                  {errors.password.message || t("login.passwordRequired")}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="confirmPassword" className="sr-only">
                {t("resetPassword.confirmPassword")}
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-neutral-600 placeholder-neutral-400 text-white bg-neutral-800 rounded-b-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
                placeholder={t("resetPassword.confirmPassword")}
                {...register("confirmPassword", {
                  required: true,
                  validate: (value) =>
                    value === password ||
                    t("resetPassword.passwordsDoNotMatch"),
                })}
              />
              {errors.confirmPassword && (
                <p className="mt-1 text-sm text-red-400">
                  {errors.confirmPassword.message ||
                    t("resetPassword.confirmPasswordRequired")}
                </p>
              )}
            </div>
          </div>
          <div>
            <button
              type="submit"
              disabled={resetPasswordMutation.isPending}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resetPasswordMutation.isPending
                ? t("common.loading")
                : t("resetPassword.submit")}
            </button>
          </div>
          <div className="text-center">
            <Link
              to="/login"
              className="font-medium text-primary-400 hover:text-primary-300"
            >
              {t("resetPassword.backToLogin")}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
