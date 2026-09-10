import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@rawkoon/api/db";
import { hashPassword, verifyPassword } from "@rawkoon/api/utils/password";
import { validatePassword } from "@rawkoon/shared/utils";
import {
  getContentType,
  getImage,
  isAllowedFile,
} from "@rawkoon/api/services/imageService";
import {
  updateUserAvatarFromUpload,
  updateUserProfile,
} from "@rawkoon/api/services/userProfileService";
import {
  badRequest,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { resolveUser } from "@rawkoon/api/middleware/auth";
import { jsonV } from "@rawkoon/api/middleware/validate";
import { mapUser } from "@rawkoon/api/utils/mappers";

// Auth here is optional at the router level (the avatar route is public); the
// protected handlers resolve the user themselves and 401 when absent.
const profileBody = z.object({
  first_name: z.union([z.string(), z.null()]).optional(),
  last_name: z.union([z.string(), z.null()]).optional(),
  locale: z.union([z.string(), z.null()]).optional(),
  nav_position: z
    .union([
      z.literal("left"),
      z.literal("right"),
      z.literal("top"),
      z.literal("bottom"),
      z.null(),
    ])
    .optional(),
});

const notificationPrefsBody = z.object({
  notification_preferences: z.record(z.string(), z.boolean()),
});

const passwordBody = z.object({
  current_password: z.string(),
  new_password: z.string(),
});

// Mounted at /api/users by the edge.
export const usersRoutes = new Hono<Env>()
  // PUT /api/users/me - Update user profile
  .put("/me", jsonV(profileBody), async (c) => {
    const user = await resolveUser(c.req.raw);
    if (!user) return unauthorized("Unauthorized");

    const body = c.req.valid("json");
    try {
      const result = await updateUserProfile(user.id, body);
      if (!result.ok) {
        if (result.status === 401) return unauthorized(result.error);
        return badRequest(result.error);
      }
      return ok({ user: mapUser(result.user) });
    } catch (error) {
      console.error("Error updating user profile:", error);
      return serverError("Failed to update profile");
    }
  })
  // PUT /api/users/me/notification-preferences
  .put(
    "/me/notification-preferences",
    jsonV(notificationPrefsBody),
    async (c) => {
      const user = await resolveUser(c.req.raw);
      if (!user) return unauthorized("Unauthorized");
      const body = c.req.valid("json");
      try {
        const { updateUserNotificationPreferences } = await import(
          "@rawkoon/api/services/notificationPreferences"
        );
        const prefs = await updateUserNotificationPreferences(
          user.id,
          body.notification_preferences,
        );
        return ok({ notification_preferences: prefs });
      } catch (error) {
        console.error("Error updating notification preferences:", error);
        return serverError("Failed to update notification preferences");
      }
    },
  )
  // POST /api/users/me/password - Change password
  .post("/me/password", jsonV(passwordBody), async (c) => {
    const user = await resolveUser(c.req.raw);
    if (!user) return unauthorized("Unauthorized");

    const { current_password, new_password } = c.req.valid("json");

    const [isValid, passwordError] = validatePassword(new_password);
    if (!isValid) return badRequest(passwordError ?? "Invalid password");

    try {
      const dbUser = await prisma.user.findFirst({
        where: { id: user.id },
        select: { id: true, passwordHash: true },
      });

      if (!dbUser) return unauthorized("User not found");
      if (!dbUser.passwordHash) {
        return badRequest(
          "This account uses passkey authentication and has no password.",
        );
      }

      const isCurrentValid = await verifyPassword(
        current_password,
        dbUser.passwordHash,
      );
      if (!isCurrentValid) return badRequest("Current password is incorrect");

      const passwordHash = await hashPassword(new_password);
      await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
        prisma.baAccount.updateMany({
          where: { userId: user.id, providerId: "credential" },
          data: { password: passwordHash },
        }),
        prisma.baSession.deleteMany({ where: { userId: user.id } }),
      ]);

      return ok({ message: "Password updated successfully" });
    } catch (error) {
      console.error("Error changing password:", error);
      return serverError("Failed to change password");
    }
  })
  // GET /api/users/avatar/:filename - Serve avatar image (public)
  .get("/avatar/:filename", async (c) => {
    const filename = c.req.param("filename");

    if (!filename || !isAllowedFile(filename)) {
      return badRequest("Invalid filename");
    }

    try {
      const imageBuffer = await getImage(filename);
      if (!imageBuffer) return notFound("Image not found");

      return new Response(new Uint8Array(imageBuffer), {
        headers: {
          "Content-Type": getContentType(filename),
          "Cache-Control": "public, max-age=31536000", // Cache for 1 year
        },
      });
    } catch (error) {
      console.error("Error serving avatar:", error);
      return serverError("Failed to serve avatar");
    }
  })
  // POST /api/users/me/avatar - Upload avatar (multipart)
  .post("/me/avatar", async (c) => {
    const user = await resolveUser(c.req.raw);
    if (!user) return unauthorized("Unauthorized");

    const form = await c.req.parseBody();
    const avatar = form.avatar;

    const isWebFile = avatar instanceof File;
    const isReactNativeFile =
      avatar &&
      typeof avatar === "object" &&
      "uri" in avatar &&
      "name" in avatar &&
      "type" in avatar;

    if (!avatar || (!isWebFile && !isReactNativeFile)) {
      return badRequest("Avatar file is required");
    }

    try {
      const result = await updateUserAvatarFromUpload(user.id, avatar);
      if (!result.ok) return badRequest(result.message);
      return ok({
        message: "Avatar uploaded successfully",
        avatar_url: result.avatarUrl,
        url: result.avatarUrl,
      });
    } catch (error) {
      console.error("[avatar-upload][users] failed:", error);
      return serverError("Failed to upload avatar");
    }
  })
  .notFound(() => notFound("Not found"));
