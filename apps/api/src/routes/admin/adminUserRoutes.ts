import { Elysia, t } from "elysia";
import { prisma } from "@rawkoon/api/db";
import { formatIso, sanitizeInput } from "@rawkoon/api/utils";
import { hashPassword } from "@rawkoon/api/utils/password";
import {
  generateOpaqueToken,
  hashOpaqueToken,
} from "@rawkoon/api/utils/tokens";
import { badRequest, notFound, serverError } from "@rawkoon/api/errors";
import { requireAdmin } from "@rawkoon/api/middleware/auth";

const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const adminUserRoutes = new Elysia()
  .use(requireAdmin)
  // GET /api/admin/users - List all users
  .get("/users", async ({ set }) => {
    try {
      const allUsers = await prisma.user.findMany({
        orderBy: { createdAt: "desc" },
      });

      const usersData = allUsers.map((u) => ({
        id: u.id,
        email: u.email,
        first_name: u.firstName,
        last_name: u.lastName,
        is_admin: u.isAdmin,
        locale: u.locale || "en",
        created_at: formatIso(u.createdAt),
        last_login: formatIso(u.lastLogin),
      }));

      return {
        success: true,
        users: usersData,
      };
    } catch (error) {
      console.error("Error listing users:", error);
      return serverError(set, "Failed to list users");
    }
  })

  // POST /api/admin/users - Direct user creation
  .post(
    "/users",
    async ({ body, set }) => {
      const emailTrimmed = (body.email || "").trim().toLowerCase();
      if (!emailTrimmed || !validateEmail(emailTrimmed)) {
        return badRequest(set, "Invalid email format");
      }
      if (!body.password || body.password.length < 8) {
        return badRequest(set, "Password must be at least 8 characters");
      }

      const sanitizedEmail = sanitizeInput(emailTrimmed);
      const existingUser = await prisma.user.findFirst({
        where: { email: sanitizedEmail },
      });
      if (existingUser) {
        return badRequest(set, "A user with this email already exists");
      }

      try {
        const passwordHash = await hashPassword(body.password);
        const displayName = [body.first_name, body.last_name]
          .filter(Boolean)
          .join(" ");

        const newUser = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              name: displayName || sanitizedEmail,
              email: sanitizedEmail,
              emailVerified: true,
              passwordHash,
              firstName: body.first_name || null,
              lastName: body.last_name || null,
              isAdmin: body.is_admin || false,
              locale: body.locale || "en",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });

          await tx.baAccount.create({
            data: {
              id: crypto.randomUUID(),
              accountId: sanitizedEmail,
              providerId: "credential",
              userId: user.id,
              password: passwordHash,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });

          return user;
        });

        set.status = 201;
        return {
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
        };
      } catch (error) {
        console.error("Error creating user:", error);
        return serverError(set, "Failed to create user");
      }
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
        first_name: t.Optional(t.String()),
        last_name: t.Optional(t.String()),
        is_admin: t.Optional(t.Boolean()),
        locale: t.Optional(t.String()),
      }),
    },
  )

  // PATCH /api/admin/users/:id/role - Update user role (promote/demote)
  .patch(
    "/users/:id/role",
    async ({ params, body, set }) => {
      const userId = params.id;
      try {
        const userToUpdate = await prisma.user.findFirst({
          where: { id: userId },
        });
        if (!userToUpdate) return notFound(set, "User not found");

        if (body.is_admin === false && userToUpdate.isAdmin) {
          const adminCount = await prisma.user.count({
            where: { isAdmin: true, id: { not: userId } },
          });
          if (adminCount === 0) {
            return badRequest(
              set,
              "Cannot demote the last remaining admin user",
            );
          }
        }

        const updated = await prisma.user.update({
          where: { id: userId },
          data: { isAdmin: body.is_admin },
        });

        return {
          success: true,
          user: {
            id: updated.id,
            is_admin: updated.isAdmin,
          },
        };
      } catch (error) {
        console.error("Error updating user role:", error);
        return serverError(set, "Failed to update user role");
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ is_admin: t.Boolean() }),
    },
  )

  // POST /api/admin/users/:id/reset-password - Admin reset user password
  .post(
    "/users/:id/reset-password",
    async ({ params, body, set }) => {
      const userId = params.id;
      if (!body.password || body.password.length < 8) {
        return badRequest(set, "Password must be at least 8 characters");
      }

      try {
        const userToUpdate = await prisma.user.findFirst({
          where: { id: userId },
        });
        if (!userToUpdate) return notFound(set, "User not found");

        const passwordHash = await hashPassword(body.password);

        await prisma.$transaction([
          prisma.user.update({
            where: { id: userId },
            data: { passwordHash },
          }),
          prisma.baAccount.updateMany({
            where: { userId, providerId: "credential" },
            data: { password: passwordHash },
          }),
          prisma.baSession.deleteMany({
            where: { userId },
          }),
        ]);

        return { success: true, message: "Password reset successfully" };
      } catch (error) {
        console.error("Error resetting user password:", error);
        return serverError(set, "Failed to reset password");
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ password: t.String() }),
    },
  )

  // POST /api/admin/invitations - Create an invitation link
  .post(
    "/invitations",
    async ({ user, body, set }) => {
      try {
        const emailTrimmed = (body.email || "").trim().toLowerCase();

        if (!emailTrimmed) {
          return badRequest(set, "Email is required");
        }

        if (!validateEmail(emailTrimmed)) {
          return badRequest(set, "Invalid email format");
        }

        const sanitizedEmail = sanitizeInput(emailTrimmed);

        const existingUser = await prisma.user.findFirst({
          where: { email: sanitizedEmail },
        });

        if (existingUser) {
          return badRequest(set, "A user with this email already exists");
        }

        const existingInvitation = await prisma.invitation.findFirst({
          where: {
            email: sanitizedEmail,
            status: "pending",
            expiresAt: { gt: new Date() },
          },
        });

        if (existingInvitation) {
          return badRequest(
            set,
            "A pending invitation already exists for this email. You can regenerate the link instead.",
          );
        }

        const token = generateOpaqueToken();
        const locale = (body.locale || "en").trim().slice(0, 10);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        let invitation;
        try {
          invitation = await prisma.invitation.create({
            data: {
              email: sanitizedEmail,
              token: hashOpaqueToken(token),
              status: "pending",
              expiresAt,
              invitedBy: user!.id,
              locale,
              isAdmin: body.is_admin || false,
            },
          });
        } catch (error) {
          if ((error as { code?: string }).code === "P2002") {
            return badRequest(
              set,
              "A pending invitation already exists for this email. You can regenerate the link instead.",
            );
          }
          throw error;
        }

        set.status = 201;
        return {
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
        };
      } catch (error) {
        console.error("Error creating invitation:", error);
        return serverError(set, "Failed to create invitation");
      }
    },
    {
      body: t.Object({
        email: t.String(),
        is_admin: t.Optional(t.Boolean()),
        locale: t.Optional(t.String()),
      }),
    },
  )

  // GET /api/admin/invitations - List all invitations
  .get("/invitations", async ({ set }) => {
    try {
      const invitations = await prisma.invitation.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          inviter: {
            select: { email: true, firstName: true, lastName: true },
          },
        },
      });

      const now = new Date();

      return {
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
      };
    } catch (error) {
      console.error("Error listing invitations:", error);
      return serverError(set, "Failed to list invitations");
    }
  })

  // POST /api/admin/invitations/:id/resend - Regenerate an invitation link
  .post(
    "/invitations/:id/resend",
    async ({ params, set }) => {
      const id = parseInt(params.id, 10);
      if (isNaN(id)) return badRequest(set, "Invalid invitation ID");

      try {
        const invitation = await prisma.invitation.findFirst({ where: { id } });
        if (!invitation) return notFound(set, "Invitation not found");
        if (invitation.status !== "pending")
          return badRequest(set, "Can only regenerate pending invitations");

        const token = generateOpaqueToken();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const result = await prisma.invitation.updateMany({
          where: { id, status: "pending" },
          data: { token: hashOpaqueToken(token), expiresAt },
        });
        if (result.count === 0) {
          return badRequest(set, "Invitation not found or no longer pending");
        }

        return { success: true, token, message: "Invitation link regenerated" };
      } catch (error) {
        console.error("Error regenerating invitation:", error);
        return serverError(set, "Failed to regenerate invitation");
      }
    },
    { params: t.Object({ id: t.String() }) },
  )

  // DELETE /api/admin/invitations/:id - Revoke an invitation
  .delete(
    "/invitations/:id",
    async ({ params, set }) => {
      const id = parseInt(params.id, 10);
      if (isNaN(id)) return badRequest(set, "Invalid invitation ID");

      try {
        const invitation = await prisma.invitation.findFirst({ where: { id } });
        if (!invitation) return notFound(set, "Invitation not found");
        if (invitation.status !== "pending")
          return badRequest(set, "Can only revoke pending invitations");

        const result = await prisma.invitation.updateMany({
          where: { id, status: "pending" },
          data: { status: "revoked" },
        });
        if (result.count === 0) {
          return badRequest(set, "Invitation not found or no longer pending");
        }

        return { success: true, message: "Invitation revoked" };
      } catch (error) {
        console.error("Error revoking invitation:", error);
        return serverError(set, "Failed to revoke invitation");
      }
    },
    { params: t.Object({ id: t.String() }) },
  )

  // DELETE /api/admin/users/:id - Delete a user
  .delete(
    "/users/:id",
    async ({ user, params, set }) => {
      const userId = params.id;

      try {
        if (userId === user!.id)
          return badRequest(set, "Cannot delete your own account");

        const userToDelete = await prisma.user.findFirst({
          where: { id: userId },
        });
        if (!userToDelete) return notFound(set, "User not found");

        const userEmail = userToDelete.email;
        // Self-delete is already blocked by the early return above.
        const result = await prisma.user.deleteMany({
          where: { id: userId },
        });
        if (result.count === 0) {
          return notFound(set, "User not found");
        }

        return {
          success: true,
          message: `User ${userEmail} deleted successfully`,
        };
      } catch (error) {
        console.error("Error deleting user:", error);
        return serverError(set, "Failed to delete user");
      }
    },
    { params: t.Object({ id: t.String() }) },
  );
