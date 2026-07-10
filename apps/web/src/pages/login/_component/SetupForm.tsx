import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useSignUp } from "@/lib/auth/useAuth";
import { validatePassword } from "@rawkoon/shared/utils";

interface FormData {
  name: string;
  email: string;
  password: string;
}

/**
 * First-run form shown only when the instance has no accounts yet. The account
 * it creates becomes the administrator (enforced server-side by the sign-up
 * hook); afterwards public sign-up is closed and this form disappears.
 */
export function SetupForm() {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const signUpMutation = useSignUp();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: { name: "", email: "", password: "" },
  });

  const onSubmit = async (data: FormData) => {
    const [passwordValid, passwordError] = validatePassword(data.password);
    if (!passwordValid) {
      toast.error(passwordError || t("login.passwordMinLength"));
      return;
    }
    try {
      await signUpMutation.mutateAsync({
        name: data.name.trim(),
        email: data.email,
        password: data.password,
      });
      navigate({ to: "/" });
    } catch (err: unknown) {
      toast.error(
        (err instanceof Error ? err.message : null) ||
          signUpMutation.error?.message ||
          t("setup.failed"),
      );
    }
  };

  return (
    <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
      <div className="rounded-md shadow-sm -space-y-px">
        <div>
          <label htmlFor="name" className="sr-only">
            {t("setup.name")}
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            {...register("name", { required: true })}
            className="appearance-none rounded-none relative block w-full px-3 py-2 border border-neutral-600 placeholder-neutral-400 text-white bg-neutral-800 rounded-t-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
            placeholder={t("setup.name")}
          />
          {errors.name && (
            <p className="mt-1 text-sm text-red-400">{t("setup.nameRequired")}</p>
          )}
        </div>

        <div>
          <label htmlFor="email" className="sr-only">
            {t("login.emailAddress")}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            {...register("email", {
              required: true,
              pattern: {
                value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                message: t("login.invalidEmail") || "Invalid email address",
              },
            })}
            className="appearance-none rounded-none relative block w-full px-3 py-2 border border-neutral-600 placeholder-neutral-400 text-white bg-neutral-800 focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
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
            autoComplete="new-password"
            {...register("password", { required: true })}
            className="appearance-none rounded-none relative block w-full px-3 py-2 border border-neutral-600 placeholder-neutral-400 text-white bg-neutral-800 rounded-b-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 focus:z-10 sm:text-sm"
            placeholder={t("login.password")}
          />
          {errors.password && (
            <p className="mt-1 text-sm text-red-400">
              {t("login.passwordRequired")}
            </p>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={signUpMutation.isPending}
        className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 focus:ring-offset-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {signUpMutation.isPending
          ? t("login.loading")
          : t("setup.createButton")}
      </button>
    </form>
  );
}
