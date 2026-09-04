import type { PrismaClient } from "@prisma/client";

export async function getDefaultOrg(db: PrismaClient) {
  const acme =
    (await db.organization.findUnique({ where: { slug: "acme-industries" } })) ??
    (await db.organization.findFirst({ orderBy: { createdAt: "asc" } }));
  if (!acme) throw new Error("no organization found — run `npx prisma db seed` first");
  return acme;
}
