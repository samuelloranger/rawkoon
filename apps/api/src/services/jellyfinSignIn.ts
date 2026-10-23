import type { User } from "@prisma/client";
import { prisma } from "@rawkoon/api/db";
import {
  getAvatarUrl,
  saveImageAndCreateThumbnail,
} from "@rawkoon/api/services/imageService";
import {
  jellyfinAuthHeader,
  type JellyfinUser,
} from "@rawkoon/api/services/jellyfinUsers";
import type { JellyfinIntegrationConfig } from "@rawkoon/api/utils/integrations/types";
import { validateImageMimeAndSize } from "@rawkoon/shared/utils";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_TIMEOUT_MS = 10_000;
const AVATAR_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Open sign-in only counts while sign-in itself is on. */
export function isOpenSignInEffective(
  config: JellyfinIntegrationConfig,
): boolean {
  return config.sign_in_enabled && config.open_sign_in;
}

export function placeholderJellyfinEmail(jellyfinUserId: string): string {
  return `${jellyfinUserId}@jellyfin.invalid`;
}

/**
 * Creates the Rawkoon account for a Jellyfin user with a direct write, so
 * better-auth's first-signup hook is never reached. Returns the existing owner
 * when a concurrent request created the account first.
 */
export async function createJellyfinRawkoonUser(
  jellyfinUser: JellyfinUser,
  isAdmin: boolean,
): Promise<{ user: User; created: boolean }> {
  const now = new Date();
  try {
    const user = await prisma.user.create({
      data: {
        name: jellyfinUser.name || jellyfinUser.id,
        email: placeholderJellyfinEmail(jellyfinUser.id),
        emailVerified: true,
        isAdmin,
        jellyfinUserId: jellyfinUser.id,
        locale: "en",
        createdAt: now,
        updatedAt: now,
      },
    });
    return { user, created: true };
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const winner = await prisma.user.findUnique({
      where: { jellyfinUserId: jellyfinUser.id },
    });
    if (!winner) throw error;
    return { user: winner, created: false };
  }
}

export type JellyfinResolution =
  | { status: "ok"; user: User }
  | { status: "no_access" };

/**
 * Maps a Jellyfin user to a Rawkoon user. Only `User.jellyfinUserId` ever ties
 * them together, never a name or email.
 */
export async function resolveOrCreateJellyfinRawkoonUser(
  jellyfinUser: JellyfinUser,
  config: JellyfinIntegrationConfig,
): Promise<JellyfinResolution> {
  if (jellyfinUser.disabled) return { status: "no_access" };

  const linked = await prisma.user.findUnique({
    where: { jellyfinUserId: jellyfinUser.id },
  });
  if (linked) return { status: "ok", user: linked };

  if (!isOpenSignInEffective(config)) return { status: "no_access" };

  const { user, created } = await createJellyfinRawkoonUser(
    jellyfinUser,
    false,
  );
  if (created) await copyJellyfinAvatar(config, jellyfinUser.id, user.id);
  return { status: "ok", user };
}

/**
 * Copies the Jellyfin profile picture onto a user that has none. Best effort:
 * every failure is logged and swallowed, and an existing avatar always wins.
 */
export async function copyJellyfinAvatar(
  config: JellyfinIntegrationConfig,
  jellyfinUserId: string,
  rawkoonUserId: string,
): Promise<void> {
  try {
    const res = await fetch(
      `${config.website_url}/Users/${encodeURIComponent(jellyfinUserId)}/Images/Primary`,
      {
        headers: jellyfinAuthHeader(config.api_key),
        signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS),
      },
    );
    if (res.status === 404) return;
    if (!res.ok) {
      console.warn(`[jellyfin] avatar fetch returned ${res.status}`);
      return;
    }

    const type = (res.headers.get("content-type") ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    const bytes = await res.arrayBuffer();
    const validationError = validateImageMimeAndSize(
      { type, size: bytes.byteLength },
      { maxSizeBytes: AVATAR_MAX_BYTES },
    );
    const extension = AVATAR_EXTENSIONS[type];
    if (validationError || !extension) return;

    const current = await prisma.user.findUnique({
      where: { id: rawkoonUserId },
      select: { avatarUrl: true },
    });
    if (!current || current.avatarUrl) return;

    const file = new File([bytes], `jellyfin.${extension}`, { type });
    const filename = await saveImageAndCreateThumbnail(file);
    // The null guard keeps a picture uploaded in the meantime.
    await prisma.user.updateMany({
      where: { id: rawkoonUserId, avatarUrl: null },
      data: { avatarUrl: getAvatarUrl(filename) },
    });
  } catch (error) {
    console.warn("[jellyfin] avatar copy failed:", error);
  }
}

const AVATAR_COPY_CONCURRENCY = 4;

/** Copies several avatars with a small concurrency limit; resolves once all are done. */
export async function copyJellyfinAvatars(
  config: JellyfinIntegrationConfig,
  pairs: { jellyfinUserId: string; rawkoonUserId: string }[],
): Promise<void> {
  const queue = [...pairs];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await copyJellyfinAvatar(config, next.jellyfinUserId, next.rawkoonUserId);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(AVATAR_COPY_CONCURRENCY, queue.length) },
      worker,
    ),
  );
}
