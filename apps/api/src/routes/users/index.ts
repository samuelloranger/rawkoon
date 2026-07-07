import { Elysia, t } from "elysia";
import { auth } from "@rawkoon/api/auth";
import { prisma } from "@rawkoon/api/db";
import { hashPassword, verifyPassword } from "@rawkoon/api/utils/password";
import { validatePassword } from "@rawkoon/shared/utils";
import {
  isAllowedFile,
  getImage,
  getContentType,
} from "@rawkoon/api/services/imageService";
import {
  updateUserAvatarFromUpload,
  updateUserProfile,
} from "@rawkoon/api/services/userProfileService";
import {
  badRequest,
  notFound,
  serverError,
  unauthorized,
} from "@rawkoon/api/errors";
import { mapUser } from "@rawkoon/api/utils/mappers";
export const usersRoutes = new Elysia({ prefix: "/api/users" })
  .use(auth)
  // PUT /api/users/me - Update user profile
  .put(
    "/me",
    async ({ user, body, set }) => {
      if (!user) {
        return unauthorized(set, "Unauthorized");
      }

      try {
        const result = await updateUserProfile(user.id, body);
        if (!result.ok) {
          if (result.status === 401) {
            return unauthorized(set, result.error);
          }
          return badRequest(set, result.error);
        }

        return { user: mapUser(result.user) };
      } catch (error) {
        console.error("Error updating user profile:", error);
        return serverError(set, "Failed to update profile");
      }
    },
    {
      body: t.Object({
        first_name: t.Optional(t.Union([t.String(), t.Null()])),
        last_name: t.Optional(t.Union([t.String(), t.Null()])),
        locale: t.Optional(t.Union([t.String(), t.Null()])),
        nav_position: t.Optional(
          t.Union([
            t.Literal("left"),
            t.Literal("right"),
            t.Literal("top"),
            t.Literal("bottom"),
            t.Null(),
          ]),
        ),
      }),
    },
  )
  // POST /api/users/me/password - Change password
  .post(
    "/me/password",
    async ({ user, body, set }) => {
      if (!user) {
        return unauthorized(set, "Unauthorized");
      }

      const { current_password, new_password } = body;

      // Validate new password
      const [isValid, passwordError] = validatePassword(new_password);
      if (!isValid) {
        return badRequest(set, passwordError ?? "Invalid password");
      }

      try {
        // Fetch user with password hash
        const dbUser = await prisma.user.findFirst({
          where: { id: user.id },
          select: { id: true, passwordHash: true },
        });

        if (!dbUser) {
          return unauthorized(set, "User not found");
        }

        if (!dbUser.passwordHash) {
          return badRequest(
            set,
            "This account uses passkey authentication and has no password.",
          );
        }

        // Verify current password
        const isCurrentValid = await verifyPassword(
          current_password,
          dbUser.passwordHash,
        );
        if (!isCurrentValid) {
          return badRequest(set, "Current password is incorrect");
        }

        // Hash new password and update
        const passwordHash = await hashPassword(new_password);
        await prisma.$transaction([
          prisma.user.update({
            where: { id: user.id },
            data: { passwordHash },
          }),
          prisma.baAccount.updateMany({
            where: { userId: user.id, providerId: "credential" },
            data: { password: passwordHash },
          }),
          prisma.baSession.deleteMany({
            where: { userId: user.id },
          }),
        ]);

        return { message: "Password updated successfully" };
      } catch (error) {
        console.error("Error changing password:", error);
        return serverError(set, "Failed to change password");
      }
    },
    {
      body: t.Object({
        current_password: t.String(),
        new_password: t.String(),
      }),
    },
  )
  // GET /api/users/avatar/:filename - Serve avatar image
  .get("/avatar/:filename", async ({ params, set }) => {
    const { filename } = params;

    if (!filename || !isAllowedFile(filename)) {
      return badRequest(set, "Invalid filename");
    }

    try {
      const imageBuffer = await getImage(filename);

      if (!imageBuffer) {
        return notFound(set, "Image not found");
      }

      // Set content type based on filename extension
      set.headers["Content-Type"] = getContentType(filename);
      set.headers["Cache-Control"] = "public, max-age=31536000"; // Cache for 1 year

      return imageBuffer;
    } catch (error) {
      console.error("Error serving avatar:", error);
      return serverError(set, "Failed to serve avatar");
    }
  })
  // POST /api/users/me/avatar - Upload avatar
  .post(
    "/me/avatar",
    async ({ user, body, set }) => {
      if (!user) {
        return unauthorized(set, "Unauthorized");
      }

      const { avatar } = body;

      const isWebFile = avatar instanceof File;
      const isReactNativeFile =
        avatar &&
        typeof avatar === "object" &&
        "uri" in avatar &&
        "name" in avatar &&
        "type" in avatar;

      if (!avatar || (!isWebFile && !isReactNativeFile)) {
        return badRequest(set, "Avatar file is required");
      }

      try {
        const result = await updateUserAvatarFromUpload(user.id, avatar);
        if (!result.ok) {
          return badRequest(set, result.message);
        }
        return {
          message: "Avatar uploaded successfully",
          avatar_url: result.avatarUrl,
          url: result.avatarUrl,
        };
      } catch (error) {
        console.error("[avatar-upload][users] failed:", error);
        return serverError(set, "Failed to upload avatar");
      }
    },
    {
      body: t.Object({
        avatar: t.Any(), // Accept any type for React Native compatibility
      }),
      type: "multipart/form-data",
    },
  );
