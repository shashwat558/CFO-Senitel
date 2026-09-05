import type { PrismaClient } from "@prisma/client";
import { MissingOrgError } from "./errors";

export async function getDefaultOrg(db: PrismaClient) {
  const acme =
    (await db.organization.findUnique({ where: { slug: "acme-industries" } })) ??
    (await db.organization.findFirst({ orderBy: { createdAt: "asc" } }));
  if (!acme) throw new MissingOrgError();
  return acme;
}
