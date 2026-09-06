// v1 session stub — the single place a "session" comes from until real auth
// lands. The plan is a NextAuth Credentials provider (email/password): swap
// this body for `getServerSession(authOptions)` and keep the return shape.
//
// Today every request resolves to the seeded default user (DEFAULT_USER), so:
//   - session.user.orgId scopes every route/service/tool query — routes no
//     longer look the org up by slug (getDefaultOrg is gone).
//   - session.user.id becomes the AuditLog.actorId for user-driven writes.
//   - session.user.role feeds the approve/execute role gates (403 otherwise).

import type { PrismaClient } from "@prisma/client";
import { DEFAULT_USER } from "../seed/constants";
import { UnauthenticatedError } from "../services/errors";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "CFO" | "CONTROLLER" | "VIEWER";
  orgId: string;
}

export interface Session {
  user: SessionUser;
}

/** Resolve the v1 session: the seed org's default user (and its org).
 *  Throws UnauthenticatedError (401) when the seed is missing. */
export async function getSession(db: PrismaClient): Promise<Session> {
  const user = await db.user.findFirst({
    where: { id: DEFAULT_USER.id },
    select: { id: true, email: true, name: true, role: true, orgId: true },
  });
  if (!user) {
    throw new UnauthenticatedError("no default user — run `npx prisma db seed` first");
  }
  return { user };
}