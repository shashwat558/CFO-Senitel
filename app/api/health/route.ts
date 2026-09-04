import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let db: "up" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch {
    db = "down";
  }
  const body = {
    status: db === "up" ? "ok" : "degraded",
    db,
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - started,
  };
  return NextResponse.json(body, { status: db === "up" ? 200 : 503 });
}
