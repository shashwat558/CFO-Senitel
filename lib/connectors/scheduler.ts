// Scheduled sync — one cron tick pulls new provider events, stages them,
// and promotes the staged queue into the books in a single audited pass.
//
// Pull failures abort before promotion (nothing half-synced); promotion is
// per-row isolated, so one bad row never fails the tick. Designed for an
// external scheduler (cron/Vercel) POSTing /api/connect/sync.

import type { PrismaClient } from "@prisma/client";
import { DodoConnector } from "./dodo";
import { promoteStagedRecords, type PromoteResult } from "./promote";
import { runConnectorPull, type RunPullResult } from "./sync";
import { ConnectorError, type Connector } from "./types";

export const CONNECTOR_IDS = ["dodo"] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export function isConnectorId(id: string): id is ConnectorId {
  return (CONNECTOR_IDS as readonly string[]).includes(id);
}

/** Resolve a provider to its connector. Xero slots in as a second branch. */
export function resolveConnector(id: string): Connector {
  if (id === "dodo") return new DodoConnector();
  throw new ConnectorError("CONFIG", `unknown connector: ${id}`, false);
}

export interface ScheduledSyncOpts {
  provider?: string;
  actorId?: string;
  /** Injected connector (tests, local runs). Defaults to the provider client. */
  connector?: Connector;
}

export interface ScheduledSyncResult {
  provider: string;
  pull: RunPullResult;
  promote: PromoteResult;
}

export async function runScheduledSync(
  db: PrismaClient,
  orgId: string,
  opts: ScheduledSyncOpts = {}
): Promise<ScheduledSyncResult> {
  if (!orgId) throw new ConnectorError("CONFIG", "orgId is required", false);
  const provider = opts.provider ?? "dodo";
  const connector = opts.connector ?? resolveConnector(provider);
  // Pull throws on provider failure — promotion never runs on a dead pull.
  const pull = await runConnectorPull(db, orgId, connector, { actorId: opts.actorId });
  const promote = await promoteStagedRecords(db, orgId, { actorId: opts.actorId });
  return { provider: connector.id, pull, promote };
}
