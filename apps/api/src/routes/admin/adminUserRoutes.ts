import { Hono } from "hono";
import { z } from "zod";
import { formatIso, sanitizeInput } from "@rawkoon/api/utils";
import {
  badGateway,
  badRequest,
  conflict,
  notFound,
  ok,
  serverError,
  serviceUnavailable,
} from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { jsonV } from "@rawkoon/api/middleware/validate";
import {
  copyJellyfinAvatar,
  copyJellyfinAvatars,
  createJellyfinRawkoonUser,
} from "@rawkoon/api/services/jellyfin/jellyfinSignIn";
import {
  getJellyfinConfig,
  listJellyfinUsers,
} from "@rawkoon/api/services/jellyfin/jellyfinUsers";
import {
  createUserWithCredential,
  deleteUser,
  findUserByEmail,
  findUsersLinkedToJellyfin,
  isJellyfinUserLinked,
  listUsers,
  resetUserPassword,
  setJellyfinLink,
  setUserRole,
} from "@rawkoon/api/services/admin/adminUsers";
import {
  createInvitation,
  listInvitations,
  regenerateInvitation,
  revokeInvitation,
} from "@rawkoon/api/services/admin/adminInvitations";

const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Mounted under /api/admin; requireAdmin is applied at the admin parent.
export const adminUserRoutes = new Hono<Env>()
  .get("/users", async () => {
    try {
      const allUsers = await listUsers();

      const usersData = allUsers.map((u) => ({
        id: u.id,
        email: u.email,
        first_name: u.firstName,
        last_name: u.lastName,
        is_admin: u.isAdmin,
        locale: u.locale || "en",
        created_at: formatIso(u.createdAt),
        last_login: formatIso(u.lastLogin),
        jellyfin_user_id: u.jellyfinUserId,
        avatar_url: u.avatarUrl,
      }));

      return ok({ success: true, users: usersData });
    } catch (error) {
      console.error("Error listing users:", error);
      return serverError("Failed to list users");
    }
  })

  .post(
    "/users",
    jsonV(
      z.object({
        email: z.string(),
        password: z.string(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        is_admin: z.boolean().optional(),
        locale: z.string().optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const emailTrimmed = (body.email || "").trim().toLowerCase();
      if (!emailTrimmed || !validateEmail(emailTrimmed)) {
        return badRequest("Invalid email format");
      }
      if (!body.password || body.password.length < 8) {
        return badRequest("Password must be at least 8 characters");
      }

      const sanitizedEmail = sanitizeInput(emailTrimmed);
      const existingUser = await findUserByEmail(sanitizedEmail);
      if (existingUser) {
        return badRequest("A user with this email already exists");
      }

      try {
        const newUser = await createUserWithCredential({
          email: sanitizedEmail,
          password: body.password,
          firstName: body.first_name,
          lastName: body.last_name,
          isAdmin: body.is_admin,
          locale: body.locale,
        });

        return ok(
          {
            success: true,
            user: {
              id: newUser.id,
              email: newUser.email,
              first_name: newUser.firstName,
              last_name: newUser.lastName,
              is_admin: newUser.isAdmin,
              locale: newUser.locale,
              created_at: newUser.createdAt
                ? newUser.createdAt.toISOString()
                : new Date().toISOString(),
            },
          },
          201,
        );
      } catch (error) {
        console.error("Error creating user:", error);
        return serverError("Failed to create user");
      }
    },
  )

  .get("/jellyfin-users", async () => {
    const config = await getJellyfinConfig();
    if (!config) {
      return serviceUnavailable("Jellyfin integration is not configured");
    }
    try {
      const users = await listJellyfinUsers(config);
      const linked = await findUsersLinkedToJellyfin(users.map((u) => u.id));
      const linkedBy = new Map(linked.map((u) => [u.jellyfinUserId, u.id]));
      return ok({
        users: users.map((u) => ({
          id: u.id,
          name: u.name,
          disabled: u.disabled,
          linked_user_id: linkedBy.get(u.id) ?? null,
        })),
      });
    } catch (error) {
      console.error("Error listing Jellyfin users:", error);
      return badGateway("Failed to reach Jellyfin");
    }
  })

  .post(
    "/users/import-jellyfin",
    jsonV(
      z.object({
        users: z
          .array(
            z.object({
              jellyfin_user_id: z.string().min(1),
              is_admin: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(200),
      }),
    ),
    async (c) => {
      const config = await getJellyfinConfig();
      if (!config) {
        return serviceUnavailable("Jellyfin integration is not configured");
      }
      let jellyfinUsers;
      try {
        jellyfinUsers = await listJellyfinUsers(config);
      } catch (error) {
        console.error("Error listing Jellyfin users:", error);
        return badGateway("Failed to reach Jellyfin");
      }
      const byId = new Map(jellyfinUsers.map((u) => [u.id, u]));

      const created: { jellyfin_user_id: string; user_id: string }[] = [];
      const skipped: { jellyfin_user_id: string; reason: string }[] = [];
      const avatarJobs: { jellyfinUserId: string; rawkoonUserId: string }[] =
        [];
      const seen = new Set<string>();
      for (const entry of c.req.valid("json").users) {
        const id = entry.jellyfin_user_id;
        const jellyfinUser = byId.get(id);
        if (seen.has(id)) {
          skipped.push({ jellyfin_user_id: id, reason: "duplicate" });
        } else if (!jellyfinUser) {
          skipped.push({ jellyfin_user_id: id, reason: "not_found" });
        } else if (jellyfinUser.disabled) {
          skipped.push({ jellyfin_user_id: id, reason: "disabled" });
        } else if (await isJellyfinUserLinked(id)) {
          skipped.push({ jellyfin_user_id: id, reason: "already_linked" });
        } else {
          const result = await createJellyfinRawkoonUser(
            jellyfinUser,
            entry.is_admin === true,
          );
          if (result.created) {
            created.push({ jellyfin_user_id: id, user_id: result.user.id });
            avatarJobs.push({
              jellyfinUserId: id,
              rawkoonUserId: result.user.id,
            });
          } else {
            skipped.push({ jellyfin_user_id: id, reason: "already_linked" });
          }
        }
        seen.add(id);
      }
      // Not awaited: avatars are best effort and a big import must not outlast the proxy.
      void copyJellyfinAvatars(config, avatarJobs);
      return ok({ created, skipped });
    },
  )

  .patch(
    "/users/:id/jellyfin",
    jsonV(z.object({ jellyfin_user_id: z.string().min(1).nullable() })),
    async (c) => {
      const userId = c.req.param("id");
      const jellyfinUserId = c.req.valid("json").jellyfin_user_id;
      const link = await setJellyfinLink(userId, jellyfinUserId);
      if (link.kind === "not_found") return notFound("User not found");
      if (link.kind === "conflict") {
        return conflict("That Jellyfin user is linked to another account");
      }
      // Same rule as the self-service link: a user without a picture gets their Jellyfin one.
      if (link.kind === "linked" && jellyfinUserId && !link.hadAvatar) {
        // Best effort: the link already committed, so a failure here must not turn it into an error.
        void getJellyfinConfig()
          .then((config) =>
            config
              ? copyJellyfinAvatar(config, jellyfinUserId, userId)
              : undefined,
          )
          .catch((error) =>
            console.warn("[jellyfin] avatar copy after link failed:", error),
          );
      }
      return ok({ success: true, jellyfin_user_id: jellyfinUserId });
    },
  )

  .patch(
    "/users/:id/role",
    jsonV(z.object({ is_admin: z.boolean() })),
    async (c) => {
      const userId = c.req.param("id");
      const body = c.req.valid("json");
      try {
        const result = await setUserRole(userId, body.is_admin);
        if (result.kind === "not_found") return notFound("User not found");
        if (result.kind === "last_admin") {
          return badRequest("Cannot demote the last remaining admin user");
        }

        return ok({
          success: true,
          user: { id: result.user.id, is_admin: result.user.isAdmin },
        });
      } catch (error) {
        console.error("Error updating user role:", error);
        return serverError("Failed to update user role");
      }
    },
  )

  .post(
    "/users/:id/reset-password",
    jsonV(z.object({ password: z.string() })),
    async (c) => {
      const userId = c.req.param("id");
      const body = c.req.valid("json");
      if (!body.password || body.password.length < 8) {
        return badRequest("Password must be at least 8 characters");
      }

      try {
        const result = await resetUserPassword(userId, body.password);
        if (result === "not_found") return notFound("User not found");

        return ok({ success: true, message: "Password reset successfully" });
      } catch (error) {
        console.error("Error resetting user password:", error);
        return serverError("Failed to reset password");
      }
    },
  )

  .post(
    "/invitations",
    jsonV(
      z.object({
        email: z.string(),
        is_admin: z.boolean().optional(),
        locale: z.string().optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      try {
        const emailTrimmed = (body.email || "").trim().toLowerCase();

        if (!emailTrimmed) {
          return badRequest("Email is required");
        }

        if (!validateEmail(emailTrimmed)) {
          return badRequest("Invalid email format");
        }

        const sanitizedEmail = sanitizeInput(emailTrimmed);

        const result = await createInvitation({
          email: sanitizedEmail,
          isAdmin: body.is_admin,
          locale: body.locale,
          invitedBy: c.get("user").id,
        });
        if (result.kind === "user_exists") {
          return badRequest("A user with this email already exists");
        }
        if (result.kind === "pending_exists") {
          return badRequest(
            "A pending invitation already exists for this email. You can regenerate the link instead.",
          );
        }
        const { token, invitation } = result;

        return ok(
          {
            success: true,
            token,
            invitation: {
              id: invitation.id,
              email: invitation.email,
              status: invitation.status,
              is_admin: invitation.isAdmin,
              locale: invitation.locale,
              expires_at: invitation.expiresAt.toISOString(),
              created_at: invitation.createdAt.toISOString(),
              accepted_at: null,
            },
          },
          201,
        );
      } catch (error) {
        console.error("Error creating invitation:", error);
        return serverError("Failed to create invitation");
      }
    },
  )

  .get("/invitations", async () => {
    try {
      const invitations = await listInvitations();

      const now = new Date();

      return ok({
        success: true,
        invitations: invitations.map((inv) => ({
          id: inv.id,
          email: inv.email,
          status:
            inv.status === "pending" && inv.expiresAt < now
              ? "expired"
              : inv.status,
          is_admin: inv.isAdmin,
          locale: inv.locale,
          expires_at: inv.expiresAt.toISOString(),
          created_at: inv.createdAt.toISOString(),
          accepted_at: inv.acceptedAt?.toISOString() || null,
          invited_by_email: inv.inviter?.email || "Deleted User",
          invited_by_name: inv.inviter
            ? [inv.inviter.firstName, inv.inviter.lastName]
                .filter(Boolean)
                .join(" ") || null
            : "Deleted User",
        })),
      });
    } catch (error) {
      console.error("Error listing invitations:", error);
      return serverError("Failed to list invitations");
    }
  })

  .post("/invitations/:id/resend", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) return badRequest("Invalid invitation ID");

    try {
      const result = await regenerateInvitation(id);
      if (result.kind === "not_found") return notFound("Invitation not found");
      if (result.kind === "not_pending") {
        return badRequest("Can only regenerate pending invitations");
      }
      if (result.kind === "raced") {
        return badRequest("Invitation not found or no longer pending");
      }

      return ok({
        success: true,
        token: result.token,
        message: "Invitation link regenerated",
      });
    } catch (error) {
      console.error("Error regenerating invitation:", error);
      return serverError("Failed to regenerate invitation");
    }
  })

  .delete("/invitations/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) return badRequest("Invalid invitation ID");

    try {
      const result = await revokeInvitation(id);
      if (result.kind === "not_found") return notFound("Invitation not found");
      if (result.kind === "not_pending") {
        return badRequest("Can only revoke pending invitations");
      }
      if (result.kind === "raced") {
        return badRequest("Invitation not found or no longer pending");
      }

      return ok({ success: true, message: "Invitation revoked" });
    } catch (error) {
      console.error("Error revoking invitation:", error);
      return serverError("Failed to revoke invitation");
    }
  })

  .delete("/users/:id", async (c) => {
    const userId = c.req.param("id");

    try {
      if (userId === c.get("user").id)
        return badRequest("Cannot delete your own account");

      const result = await deleteUser(userId);
      if (result.kind === "not_found") return notFound("User not found");

      return ok({
        success: true,
        message: `User ${result.email} deleted successfully`,
      });
    } catch (error) {
      console.error("Error deleting user:", error);
      return serverError("Failed to delete user");
    }
  });
