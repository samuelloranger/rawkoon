import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { HttpError } from "@/lib/api/httpClient";
import { setUser } from "@/lib/auth";
import { useValidateInvitation, useAcceptInvitation } from "@/lib/auth/useAuth";
import { getCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/accept-invitation")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) || "",
  }),
  beforeLoad: async () => {
    const user = await getCurrentUser().catch(() => null);
    if (user) throw redirect({ to: "/" });
  },
  component: AcceptInvitationPage,
});

interface AcceptInvitationFormData {
  firstName: string;
  lastName: string;
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

function AcceptInvitationPage() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const { token } = Route.useSearch();

  const { data: validation, isLoading: isValidating } =
    useValidateInvitation(token);
  const acceptMutation = useAcceptInvitation();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<AcceptInvitationFormData>();
  const password = useWatch({ control, name: "password" });

  const onSubmit = async (data: AcceptInvitationFormData) => {
    try {
      const response = await acceptMutation.mutateAsync({
        token,
        password: data.password,
        first_name: data.firstName || undefined,
        last_name: data.lastName || undefined,
      });
      if (response.user) setUser(response.user);
      toast.success(t("acceptInvitation.successTitle"));
      navigate({ to: "/" });
    } catch (err: unknown) {
      toast.error(
        (err instanceof HttpError
          ? (err.apiError() ?? err.message)
          : undefined) || t("acceptInvitation.error"),
      );
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8 text-center">
          <h2 className="text-3xl font-extrabold text-white">
            {t("acceptInvitation.invalidTokenTitle")}
          </h2>
          <p className="text-sm text-neutral-400">
            {t("acceptInvitation.invalidTokenMessage")}
          </p>
        </div>
      </div>
    );
  }

  if (isValidating) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8 text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full mx-auto" />
          <p className="text-neutral-400">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (!validation?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8 text-center">
          <h2 className="text-3xl font-extrabold text-white">
            {t("acceptInvitation.invalidTokenTitle")}
          </h2>
          <p className="text-sm text-neutral-400">
            {t("acceptInvitation.invalidTokenMessage")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="mx-auto h-12 w-12 flex items-center justify-center">
            <img src="/icon-192.png" alt="Rawkoon" className="h-12 w-12" />
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            {t("acceptInvitation.title")}
          </h2>
          <p className="mt-2 text-center text-sm text-neutral-400">
            {t("acceptInvitation.description")}
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email" className="sr-only">
                {t("acceptInvitation.email")}
              </label>
              <input
                id="email"
                type="email"
                value={validation.email}
                disabled
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-neutral-600 text-neutral-400 bg-neutral-700 rounded-t-md sm:text-sm"
              />
            </div>
            <div>
              <label htmlFor="firstName" className="sr-only">
                {t("acceptInvitation.firstName")}
              </label>
              <input
                id="firstName"
                type="text"
                autoComplete="given-name"
                {...register("firstName")}
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-neutral-600 placeholder-neutral-400 text-white bg-neutral-800 focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
                placeholder={t("acceptInvitation.firstName")}
              />
            </div>
            <div>
              <label htmlFor="lastName" className="sr-only">
                {t("acceptInvitation.lastName")}
              </label>
              <input
                id="lastName"
                type="text"
                autoComplete="family-name"
                {...register("lastName")}
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-neutral-600 placeholder-neutral-400 text-white bg-neutral-800 focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
                placeholder={t("acceptInvitation.lastName")}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                {t("acceptInvitation.password")}
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
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
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-neutral-600 placeholder-neutral-400 text-white bg-neutral-800 focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
                placeholder={t("acceptInvitation.password")}
              />
              {errors.password && (
                <p className="mt-1 text-sm text-red-400">
                  {errors.password.message || t("login.passwordRequired")}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="confirmPassword" className="sr-only">
                {t("acceptInvitation.confirmPassword")}
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                {...register("confirmPassword", {
                  required: true,
                  validate: (value) =>
                    value === password ||
                    t("acceptInvitation.passwordsDoNotMatch"),
                })}
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-neutral-600 placeholder-neutral-400 text-white bg-neutral-800 rounded-b-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
                placeholder={t("acceptInvitation.confirmPassword")}
              />
              {errors.confirmPassword && (
                <p className="mt-1 text-sm text-red-400">
                  {errors.confirmPassword.message ||
                    t("acceptInvitation.confirmPasswordRequired")}
                </p>
              )}
            </div>
          </div>
          <div>
            <button
              type="submit"
              disabled={acceptMutation.isPending}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 focus:ring-offset-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {acceptMutation.isPending
                ? t("acceptInvitation.creating")
                : t("acceptInvitation.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
