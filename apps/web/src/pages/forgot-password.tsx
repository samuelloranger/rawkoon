import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Mail, KeyRound } from "lucide-react";
import { useForgotPassword } from "@/lib/auth/useAuth";
import { getCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/forgot-password")({
  beforeLoad: async () => {
    const user = await getCurrentUser().catch(() => null);
    if (user) throw redirect({ to: "/" });
  },
  component: ForgotPasswordPage,
});

interface ForgotPasswordFormData {
  email: string;
}

function ForgotPasswordPage() {
  const { t } = useTranslation("common");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const forgotPasswordMutation = useForgotPassword();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>();

  const onSubmit = async (data: ForgotPasswordFormData) => {
    try {
      await forgotPasswordMutation.mutateAsync({ email: data.email });
      setIsSubmitted(true);
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(err.message || t("forgotPassword.error"));
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <div className="mx-auto h-12 w-12 flex items-center justify-center">
              <Mail className="w-10 h-10 text-primary-400" />
            </div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
              {t("forgotPassword.checkEmail")}
            </h2>
            <p className="mt-4 text-center text-sm text-neutral-400">
              {t("forgotPassword.emailSent")}
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
          <p className="mt-2 text-center text-sm text-neutral-400">
            {t("forgotPassword.description")}
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
          <div>
            <label htmlFor="email" className="sr-only">
              {t("login.email")}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="appearance-none rounded-md relative block w-full px-3 py-2 border border-neutral-600 placeholder-neutral-400 text-white bg-neutral-800 focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
              placeholder={t("login.email")}
              {...register("email", {
                required: true,
                pattern: {
                  value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                  message: t("login.invalidEmail"),
                },
              })}
            />
            {errors.email && (
              <p className="mt-1 text-sm text-red-400">
                {errors.email.message || t("login.emailRequired")}
              </p>
            )}
          </div>

          <div>
            <button
              type="submit"
              disabled={forgotPasswordMutation.isPending}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {forgotPasswordMutation.isPending
                ? t("common.loading")
                : t("forgotPassword.submit")}
            </button>
          </div>

          <div className="text-center">
            <Link
              to="/login"
              className="font-medium text-primary-400 hover:text-primary-300"
            >
              {t("forgotPassword.backToLogin")}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
