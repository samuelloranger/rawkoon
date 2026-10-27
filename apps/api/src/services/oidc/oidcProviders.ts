import { prisma } from "@rawkoon/api/db";
import { nowUtc } from "@rawkoon/api/utils";

export const listOidcProviders = () =>
  prisma.oidcProvider.findMany({ orderBy: { createdAt: "asc" } });

export const findOidcProviderBySlug = (slug: string) =>
  prisma.oidcProvider.findUnique({ where: { slug } });

export const findOidcProviderById = (id: string) =>
  prisma.oidcProvider.findUnique({ where: { id } });

export function createOidcProvider(data: {
  slug: string;
  name: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  enabled: boolean;
  iconUrl: string | null;
}) {
  const now = nowUtc();
  return prisma.oidcProvider.create({
    data: { ...data, createdAt: now, updatedAt: now },
  });
}

export function updateOidcProvider(
  id: string,
  data: {
    name: string;
    discoveryUrl: string;
    clientId: string;
    clientSecret: string;
    enabled: boolean;
    iconUrl?: string | null;
  },
) {
  return prisma.oidcProvider.update({
    where: { id },
    data: { ...data, updatedAt: nowUtc() },
  });
}

export const deleteOidcProvider = (id: string) =>
  prisma.oidcProvider.delete({ where: { id } });
