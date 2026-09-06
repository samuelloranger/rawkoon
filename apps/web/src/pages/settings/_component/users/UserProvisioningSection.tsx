import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { HttpError } from "@/lib/api/httpClient";
import { FormInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { useInviteUser } from "@/pages/settings/useInviteUser";
import { useCreateUser } from "@/pages/settings/useCreateUser";

interface InviteFormData {
  email: string;
  is_admin: boolean;
  locale: string;
}

interface DirectAddFormData {
  email: string;
  first_name?: string;
  last_name?: string;
  password: string;
  is_admin: boolean;
  locale: string;
}

interface UserProvisioningSectionProps {
  onLinkGenerated: (link: string) => void;
}

export function UserProvisioningSection({
  onLinkGenerated,
}: UserProvisioningSectionProps) {
  const { t } = useTranslation("common");
  const inviteMutation = useInviteUser();
  const createUserMutation = useCreateUser();
  const [directAdd, setDirectAdd] = useState(false);

  const inviteSchema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .min(1, t("settings.users.emailRequired") || "Email is required")
          .refine(
            (val) => /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(val),
            {
              message: t("settings.users.invalidEmail") || "Invalid email",
            },
          ),
        locale: z.string(),
        is_admin: z.boolean(),
      }),
    [t],
  );

  const directAddSchema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .min(1, "Email is required")
          .refine(
            (val) => /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(val),
            {
              message: "Invalid email",
            },
          ),
        first_name: z.string().optional().default(""),
        last_name: z.string().optional().default(""),
        password: z.string().min(8, "Password must be at least 8 characters"),
        locale: z.string(),
        is_admin: z.boolean(),
      }),
    [],
  );

  const {
    register: registerInvite,
    handleSubmit: handleSubmitInvite,
    reset: resetInvite,
    formState: { errors: inviteErrors },
  } = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: "",
      is_admin: false,
      locale: "en",
    },
  });

  const {
    register: registerDirect,
    handleSubmit: handleSubmitDirect,
    reset: resetDirect,
    formState: { errors: directErrors },
  } = useForm<DirectAddFormData>({
    resolver: zodResolver(directAddSchema),
    defaultValues: {
      email: "",
      first_name: "",
      last_name: "",
      password: "",
      is_admin: false,
      locale: "en",
    },
  });

  const onInviteSubmit = async (data: InviteFormData) => {
    try {
      const result = await inviteMutation.mutateAsync({
        email: data.email.trim(),
        is_admin: data.is_admin,
        locale: data.locale,
      });

      if (result.success && result.token) {
        const link = `${window.location.origin}/accept-invitation?token=${result.token}`;
        onLinkGenerated(link);
        resetInvite();
        toast.success(t("settings.users.inviteLinkGenerated"));
      }
    } catch (error: unknown) {
      toast.error(
        (error instanceof HttpError ? error.apiError() : undefined) ||
          t("settings.users.inviteLinkError"),
      );
    }
  };

  const onDirectSubmit = async (data: DirectAddFormData) => {
    try {
      const result = await createUserMutation.mutateAsync({
        email: data.email.trim(),
        first_name: (data.first_name || "").trim(),
        last_name: (data.last_name || "").trim(),
        password: data.password,
        is_admin: data.is_admin,
        locale: data.locale,
      });

      if (result.success) {
        resetDirect();
        toast.success(t("settings.users.userCreated"));
      }
    } catch (error: unknown) {
      toast.error(
        (error instanceof HttpError ? error.apiError() : undefined) ||
          t("settings.users.userCreateError"),
      );
    }
  };

  return (
    <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-base font-semibold text-neutral-100">
            {directAdd ? "Add User Directly" : "Generate Invitation Link"}
          </h2>
          <p className="text-neutral-400 text-xs mt-1">
            {directAdd
              ? "Create user credentials immediately. They can log in right away."
              : "Create single-use signup link. Link expires in 7 days."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDirectAdd(!directAdd)}
        >
          {directAdd ? "Generate Invitation Link" : "Add User Directly"}
        </Button>
      </div>

      {/* Form 1: Generate Link */}
      {!directAdd && (
        <form
          onSubmit={handleSubmitInvite(onInviteSubmit)}
          className="space-y-4"
        >
          <FormInput
            {...registerInvite("email")}
            type="email"
            aria-label={t("settings.users.emailPlaceholder")}
            placeholder={t("settings.users.emailPlaceholder")}
            error={
              inviteErrors.email
                ? inviteErrors.email.type === "required" ||
                  inviteErrors.email.type === "too_small"
                  ? t("settings.users.emailRequired")
                  : inviteErrors.email.message
                : undefined
            }
          />

          <div>
            <label
              htmlFor="user-provisioning-section-locale"
              className="block text-sm font-medium text-neutral-300 mb-2"
            >
              {t("settings.users.locale")}
            </label>
            <select
              id="user-provisioning-section-locale"
              {...registerInvite("locale")}
              className="focus-ring w-full px-3 py-2 border border-neutral-600 rounded-md text-white bg-neutral-700 focus:border-primary-500"
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
            </select>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_admin_invite"
              {...registerInvite("is_admin")}
              className="focus-ring w-4 h-4 text-primary-600 rounded bg-neutral-700 border-neutral-600"
            />
            <label
              htmlFor="is_admin_invite"
              className="ml-2 text-sm text-neutral-300"
            >
              {t("settings.users.isAdmin")}
            </label>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={inviteMutation.isPending}>
              {inviteMutation.isPending
                ? "Generating Link..."
                : "Generate Link"}
            </Button>
          </div>
        </form>
      )}

      {/* Form 2: Direct Add */}
      {directAdd && (
        <form
          onSubmit={handleSubmitDirect(onDirectSubmit)}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormInput
              {...registerDirect("first_name")}
              type="text"
              placeholder={t("settings.users.firstNameOptional")}
              error={directErrors.first_name?.message}
            />
            <FormInput
              {...registerDirect("last_name")}
              type="text"
              placeholder={t("settings.users.lastNameOptional")}
              error={directErrors.last_name?.message}
            />
          </div>

          <FormInput
            {...registerDirect("email")}
            type="email"
            placeholder={t("settings.users.emailAddress")}
            error={directErrors.email?.message}
          />

          <FormInput
            {...registerDirect("password")}
            type="password"
            placeholder={t("settings.users.passwordMinPlaceholder")}
            error={directErrors.password?.message}
          />

          <div>
            <label
              htmlFor="user-provisioning-direct-locale"
              className="block text-sm font-medium text-neutral-300 mb-2"
            >
              Locale
            </label>
            <select
              id="user-provisioning-direct-locale"
              {...registerDirect("locale")}
              className="focus-ring w-full px-3 py-2 border border-neutral-600 rounded-md text-white bg-neutral-700 focus:border-primary-500"
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
            </select>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_admin_direct"
              {...registerDirect("is_admin")}
              className="focus-ring w-4 h-4 text-primary-600 rounded bg-neutral-700 border-neutral-600"
            />
            <label
              htmlFor="is_admin_direct"
              className="ml-2 text-sm text-neutral-300"
            >
              Give Admin Privileges
            </label>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={createUserMutation.isPending}>
              {createUserMutation.isPending
                ? "Adding User..."
                : "Add User Directly"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
