import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getIncident } from "@/lib/services/incidents";
import { getDefaultOrg } from "@/lib/services/org";
import { toStatus } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const org = await getDefaultOrg(prisma);
    const incident = await getIncident(prisma, org.id, params.id);
    return NextResponse.json(incident);
  } catch (e) {
    const message = e instanceof Error ? e.message : "fetch failed";
    return NextResponse.json({ error: message }, { status: toStatus(e, 500) });
  }
}
