import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from "react-image-crop";
import { useCurrentUser } from "@/lib/auth/useAuth";
import {
  useUpdateProfile,
  useChangePassword,
  useUploadAvatar,
} from "@/pages/settings/useUsers";
import { Dialog } from "@/components/dialog";
import type { UpdateProfileRequest } from "@rawkoon/shared/types";
import "react-image-crop/dist/ReactCrop.css";

interface ProfileFormData {
  first_name: string;
  last_name: string;
}

interface PasswordFormData {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

const MAX_AVATAR_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_CROPPED_DIMENSION_PX = 1024;

function centerAspectCrop(
  mediaWidth: number,
  mediaHeight: number,
  aspect: number,
) {
  return centerCrop(
    makeAspectCrop(
      {
        unit: "%",
        width: 90,
      },
      aspect,
      mediaWidth,
      mediaHeight,
    ),
    mediaWidth,
    mediaHeight,
  );
}

export function ProfileForm() {
  const { t } = useTranslation("common");
  const { data: currentUser } = useCurrentUser();
  const updateProfileMutation = useUpdateProfile();
  const changePasswordMutation = useChangePassword();
  const uploadAvatarMutation = useUploadAvatar();
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Profile form
  const {
    register: registerProfile,
    handleSubmit: handleProfileSubmit,
    reset: resetProfile,
  } = useForm<ProfileFormData>({
    defaultValues: {
      first_name: "",
      last_name: "",
    },
  });

  // Password form
  const {
    register: registerPassword,
    handleSubmit: handlePasswordSubmit,
    reset: resetPassword,
    watch,
    formState: { errors: passwordErrors },
  } = useForm<PasswordFormData>({
    defaultValues: {
      current_password: "",
      new_password: "",
      confirm_password: "",
    },
  });

  // react-hook-form's watch() opts this component out of React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const newPassword = watch("new_password");

  useEffect(() => {
    if (currentUser) {
      resetProfile({
        first_name: currentUser.first_name || "",
        last_name: currentUser.last_name || "",
      });
    }
  }, [currentUser, resetProfile]);

  const onProfileSubmit = async (data: ProfileFormData) => {
    const updates: UpdateProfileRequest = {};

    if (data.first_name !== (currentUser?.first_name || "")) {
      updates.first_name = data.first_name;
    }

    if (data.last_name !== (currentUser?.last_name || "")) {
      updates.last_name = data.last_name;
    }

    if (Object.keys(updates).length === 0) {
      toast.info(t("settings.profile.noChanges") || "No changes to save");
      return;
    }

    try {
      await updateProfileMutation.mutateAsync(updates);
      toast.success(t("settings.profile.updateSuccess"));
    } catch (error) {
      console.error("Profile update error:", error);
      toast.error(
        (error instanceof Error ? error.message : null) ||
          t("settings.profile.updateError"),
      );
    }
  };

  const uploadAvatarFile = async (file: File) => {
    const formData = new FormData();
    formData.append("avatar", file);

    const response = await uploadAvatarMutation.mutateAsync(formData);
    const nextAvatar = response.avatar_url || response.url || null;
    setAvatarPreview(nextAvatar);
  };

  const onAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      if (file.size > MAX_AVATAR_FILE_SIZE_BYTES) {
        toast.error(t("settings.profile.maxFileSizeError"));
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      setSelectedImageUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return objectUrl;
      });
    } catch (error) {
      console.error("Avatar upload error:", error);
      toast.error(
        (error instanceof Error ? error.message : null) ||
          t("settings.profile.avatarUpdateError"),
      );
    } finally {
      event.target.value = "";
    }
  };

  const onCropCancel = () => {
    setSelectedImageUrl((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return null;
    });
    setCrop(undefined);
    setCompletedCrop(undefined);
  };

  const onCropApply = async () => {
    if (!imageRef.current || !completedCrop || !selectedImageUrl) return;

    const image = imageRef.current;
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    const sourceWidth = Math.max(1, Math.round(completedCrop.width * scaleX));
    const sourceHeight = Math.max(1, Math.round(completedCrop.height * scaleY));
    const downscaleFactor = Math.min(
      1,
      MAX_CROPPED_DIMENSION_PX / Math.max(sourceWidth, sourceHeight),
    );
    const outputWidth = Math.max(1, Math.round(sourceWidth * downscaleFactor));
    const outputHeight = Math.max(
      1,
      Math.round(sourceHeight * downscaleFactor),
    );

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(
      image,
      completedCrop.x * scaleX,
      completedCrop.y * scaleY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      outputWidth,
      outputHeight,
    );

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });

    if (!blob) {
      toast.error(t("settings.profile.avatarUpdateError"));
      return;
    }

    const croppedFile = new File([blob], "avatar.jpg", { type: "image/jpeg" });

    try {
      await uploadAvatarFile(croppedFile);
      toast.success(t("settings.profile.avatarUpdateSuccess"));
      onCropCancel();
    } catch (error) {
      console.error("Avatar upload error:", error);
      toast.error(
        (error instanceof Error ? error.message : null) ||
          t("settings.profile.avatarUpdateError"),
      );
    }
  };

  useEffect(() => {
    return () => {
      if (selectedImageUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(selectedImageUrl);
      }
    };
  }, [selectedImageUrl]);

  const onPasswordSubmit = async (data: PasswordFormData) => {
    try {
      await changePasswordMutation.mutateAsync({
        current_password: data.current_password,
        new_password: data.new_password,
      });
      resetPassword();
      toast.success(
        t("settings.profile.passwordUpdateSuccess") ||
          "Password updated successfully",
      );
    } catch (error) {
      console.error("Password change error:", error);
      toast.error(
        (error instanceof Error ? error.message : null) ||
          t("settings.profile.passwordUpdateError") ||
          "Failed to update password",
      );
    }
  };

  return (
    <div className="space-y-8">
      {/* Profile Section */}
      <form
        onSubmit={handleProfileSubmit(onProfileSubmit)}
        className="space-y-6"
      >
        <h3 className="text-lg font-medium text-neutral-100">
          {t("settings.profile.personalInfo") || "Personal Information"}
        </h3>

        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-2">
            {t("settings.profile.profilePicture")}
          </label>
          <div className="flex items-center gap-4">
            {avatarPreview || currentUser?.avatar_url ? (
              <img
                src={avatarPreview || currentUser?.avatar_url || ""}
                alt={t("settings.profile.profilePictureAlt")}
                className="h-14 w-14 rounded-full object-cover border border-neutral-600"
              />
            ) : (
              <div className="h-14 w-14 rounded-full border border-neutral-600 bg-neutral-700 text-neutral-300 flex items-center justify-center font-semibold text-sm">
                {`${currentUser?.first_name?.[0] || ""}${currentUser?.last_name?.[0] || ""}`.toUpperCase() ||
                  "U"}
              </div>
            )}
            <label className="inline-flex cursor-pointer items-center px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-neutral-100 hover:bg-neutral-600 transition-colors">
              <span>
                {uploadAvatarMutation.isPending
                  ? t("settings.profile.uploading")
                  : t("settings.profile.uploadPhoto")}
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={onAvatarChange}
                disabled={uploadAvatarMutation.isPending}
                className="hidden"
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-neutral-400">
            {t("settings.profile.imageRequirements")}
          </p>
        </div>

        {/* Email (Read-only) */}
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-2">
            {t("settings.profile.email")}
          </label>
          <input
            type="email"
            value={currentUser?.email || ""}
            disabled
            className="w-full px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-neutral-400 cursor-not-allowed"
          />
          <p className="mt-1 text-sm text-neutral-400">
            {t("settings.profile.emailReadOnly")}
          </p>
        </div>

        {/* First Name */}
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-2">
            {t("settings.profile.firstName")}
          </label>
          <input
            type="text"
            {...registerProfile("first_name")}
            placeholder={t("settings.profile.firstNamePlaceholder")}
            className="w-full px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-neutral-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        {/* Last Name */}
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-2">
            {t("settings.profile.lastName")}
          </label>
          <input
            type="text"
            {...registerProfile("last_name")}
            placeholder={t("settings.profile.lastNamePlaceholder")}
            className="w-full px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-neutral-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          disabled={updateProfileMutation.isPending}
          className="w-full"
        >
          {updateProfileMutation.isPending
            ? t("settings.profile.saving")
            : t("settings.profile.saveChanges")}
        </Button>
      </form>

      {/* Divider */}
      <div className="border-t border-neutral-700" />

      {/* Password Section */}
      <form
        onSubmit={handlePasswordSubmit(onPasswordSubmit)}
        className="space-y-6"
      >
        <h3 className="text-lg font-medium text-neutral-100">
          {t("settings.profile.changePassword") || "Change Password"}
        </h3>

        {/* Current Password */}
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-2">
            {t("settings.profile.currentPassword") || "Current Password"}
          </label>
          <input
            type="password"
            {...registerPassword("current_password", {
              required:
                t("settings.profile.currentPasswordRequired") ||
                "Current password is required",
            })}
            placeholder={
              t("settings.profile.currentPasswordPlaceholder") ||
              "Enter your current password"
            }
            className="w-full px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-neutral-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          {passwordErrors.current_password && (
            <p className="mt-1 text-sm text-red-400">
              {passwordErrors.current_password.message}
            </p>
          )}
        </div>

        {/* New Password */}
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-2">
            {t("settings.profile.newPassword")}
          </label>
          <input
            type="password"
            {...registerPassword("new_password", {
              required:
                t("settings.profile.newPasswordRequired") ||
                "New password is required",
              minLength: {
                value: 8,
                message:
                  t("settings.profile.passwordMinLength") ||
                  "Password must be at least 8 characters",
              },
            })}
            placeholder={t("settings.profile.newPasswordPlaceholder")}
            className="w-full px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-neutral-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          {passwordErrors.new_password && (
            <p className="mt-1 text-sm text-red-400">
              {passwordErrors.new_password.message}
            </p>
          )}
          <p className="mt-1 text-sm text-neutral-400">
            {t("settings.profile.passwordHelp")}
          </p>
        </div>

        {/* Confirm New Password */}
        <div>
          <label className="block text-sm font-medium text-neutral-300 mb-2">
            {t("settings.profile.confirmPassword") || "Confirm New Password"}
          </label>
          <input
            type="password"
            {...registerPassword("confirm_password", {
              required:
                t("settings.profile.confirmPasswordRequired") ||
                "Please confirm your new password",
              validate: (value) =>
                value === newPassword ||
                t("settings.profile.passwordMismatch") ||
                "Passwords do not match",
            })}
            placeholder={
              t("settings.profile.confirmPasswordPlaceholder") ||
              "Confirm your new password"
            }
            className="w-full px-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-neutral-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          {passwordErrors.confirm_password && (
            <p className="mt-1 text-sm text-red-400">
              {passwordErrors.confirm_password.message}
            </p>
          )}
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          disabled={changePasswordMutation.isPending}
          className="w-full"
        >
          {changePasswordMutation.isPending
            ? t("settings.profile.saving")
            : t("settings.profile.updatePassword") || "Update Password"}
        </Button>
      </form>

      <Dialog
        isOpen={Boolean(selectedImageUrl)}
        onClose={onCropCancel}
        title={t("settings.profile.cropPhoto")}
      >
        <div className="space-y-4">
          {selectedImageUrl && (
            <div className="overflow-auto">
              <ReactCrop
                crop={crop}
                onChange={(_, percentCrop) => setCrop(percentCrop)}
                onComplete={(cropPixels) => setCompletedCrop(cropPixels)}
                aspect={1}
                circularCrop
                keepSelection
              >
                <img
                  ref={imageRef}
                  src={selectedImageUrl}
                  alt={t("settings.profile.profilePictureAlt")}
                  className="max-h-[60dvh] w-auto"
                  onLoad={(event) => {
                    const { width, height } = event.currentTarget;
                    setCrop(centerAspectCrop(width, height, 1));
                  }}
                />
              </ReactCrop>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={onCropCancel}
              disabled={uploadAvatarMutation.isPending}
            >
              {t("settings.profile.cancelCrop")}
            </Button>
            <Button
              type="button"
              onClick={onCropApply}
              disabled={uploadAvatarMutation.isPending || !completedCrop}
            >
              {uploadAvatarMutation.isPending
                ? t("settings.profile.uploading")
                : t("settings.profile.applyCrop")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
