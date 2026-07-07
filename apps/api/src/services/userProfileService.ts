import type { User } from "@prisma/client";
import { prisma } from "@rawkoon/api/db";
import {
  deleteImageFiles,
  getAvatarUrl,
  saveImageAndCreateThumbnail,
} from "@rawkoon/api/services/imageService";
import { validateImageMimeAndSize } from "@rawkoon/shared/utils";

export type UserProfileUpdateInput = {
  first_name?: string | null;
  last_name?: string | null;
  locale?: string | null;
  nav_position?: string | null;
};

export type UserProfileUpdateResult =
  | { ok: true; user: User }
  | { ok: false; status: 400 | 401; error: string };

export async function updateUserProfile(
  userId: string,
  input: UserProfileUpdateInput,
): Promise<UserProfileUpdateResult> {
  const { first_name, last_name, locale, nav_position } = input;

  if (
    first_name === undefined &&
    last_name === undefined &&
    locale === undefined &&
    nav_position === undefined
  ) {
    return {
      ok: false,
      status: 400,
      error: "At least one field must be provided",
    };
  }

  if (locale && locale.length > 10) {
    return {
      ok: false,
      status: 400,
      error: "Locale must be 10 characters or less",
    };
  }

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) {
    return { ok: false, status: 401, error: "User not found" };
  }

  const user = await updateUserProfileFields(
    userId,
    {
      first_name,
      last_name,
      locale,
      nav_position,
    },
    existing,
  );

  return { ok: true, user };
}

export async function updateUserProfileFields(
  userId: string,
  input: UserProfileUpdateInput,
  existingUser?: User,
): Promise<User> {
  const existing =
    existingUser ?? (await prisma.user.findUnique({ where: { id: userId } }));
  if (!existing) {
    throw new Error("User not found");
  }

  const updateData: Partial<{
    firstName: string | null;
    lastName: string | null;
    locale: string | null;
    navPosition: string | null;
  }> = {};

  if (input.first_name !== undefined) {
    updateData.firstName = input.first_name;
  }
  if (input.last_name !== undefined) {
    updateData.lastName = input.last_name;
  }
  if (input.locale !== undefined) {
    updateData.locale = input.locale;
  }
  if (input.nav_position !== undefined) {
    updateData.navPosition = input.nav_position;
  }

  return prisma.user.update({
    where: { id: userId },
    data: updateData,
  });
}

export async function updateUserAvatarFromUpload(
  userId: string,
  avatar: unknown,
): Promise<{ ok: true; avatarUrl: string } | { ok: false; message: string }> {
  const validationError = validateImageMimeAndSize(
    avatar as { type: string; size?: number },
    { maxSizeBytes: 5 * 1024 * 1024 },
  );
  if (validationError) {
    return { ok: false, message: validationError.error };
  }

  const dbUser = await prisma.user.findFirst({
    where: { id: userId },
  });
  if (dbUser?.avatarUrl) {
    const oldFilename = dbUser.avatarUrl.split("/").pop();
    if (oldFilename) {
      await deleteImageFiles(oldFilename);
    }
  }

  const filename = await saveImageAndCreateThumbnail(avatar as File);
  const avatarUrl = getAvatarUrl(filename);
  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl },
  });
  return { ok: true, avatarUrl };
}
