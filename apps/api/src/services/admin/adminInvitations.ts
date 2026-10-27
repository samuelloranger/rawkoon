import { prisma } from "@rawkoon/api/db";
import {
  generateOpaqueToken,
  hashOpaqueToken,
} from "@rawkoon/api/utils/tokens";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type CreateInvitationInput = {
  email: string;
  isAdmin?: boolean;
  locale?: string;
  invitedBy: string;
};

export type CreateInvitationResult =
  | { kind: "user_exists" }
  | { kind: "pending_exists" }
  | {
      kind: "created";
      token: string;
      invitation: Awaited<ReturnType<typeof prisma.invitation.create>>;
    };

export async function createInvitation(
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  const existingUser = await prisma.user.findFirst({
    where: { email: input.email },
  });
  if (existingUser) return { kind: "user_exists" };

  const existingInvitation = await prisma.invitation.findFirst({
    where: {
      email: input.email,
      status: "pending",
      expiresAt: { gt: new Date() },
    },
  });
  if (existingInvitation) return { kind: "pending_exists" };

  const token = generateOpaqueToken();
  const locale = (input.locale || "en").trim().slice(0, 10);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  try {
    const invitation = await prisma.invitation.create({
      data: {
        email: input.email,
        token: hashOpaqueToken(token),
        status: "pending",
        expiresAt,
        invitedBy: input.invitedBy,
        locale,
        isAdmin: input.isAdmin || false,
      },
    });
    return { kind: "created", token, invitation };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return { kind: "pending_exists" };
    }
    throw error;
  }
}

export const listInvitations = () =>
  prisma.invitation.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      inviter: { select: { email: true, firstName: true, lastName: true } },
    },
  });

export type PendingInvitationChange =
  | { kind: "not_found" }
  | { kind: "not_pending" }
  // The row stopped being pending between the read and the guarded update.
  | { kind: "raced" };

export async function regenerateInvitation(
  id: number,
): Promise<PendingInvitationChange | { kind: "ok"; token: string }> {
  const invitation = await prisma.invitation.findFirst({ where: { id } });
  if (!invitation) return { kind: "not_found" };
  if (invitation.status !== "pending") return { kind: "not_pending" };

  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const result = await prisma.invitation.updateMany({
    where: { id, status: "pending" },
    data: { token: hashOpaqueToken(token), expiresAt },
  });
  if (result.count === 0) return { kind: "raced" };
  return { kind: "ok", token };
}

export async function revokeInvitation(
  id: number,
): Promise<PendingInvitationChange | { kind: "ok" }> {
  const invitation = await prisma.invitation.findFirst({ where: { id } });
  if (!invitation) return { kind: "not_found" };
  if (invitation.status !== "pending") return { kind: "not_pending" };

  const result = await prisma.invitation.updateMany({
    where: { id, status: "pending" },
    data: { status: "revoked" },
  });
  if (result.count === 0) return { kind: "raced" };
  return { kind: "ok" };
}
