// Investigator Agent types (Phase 2). No agent logic ships in Phase 1 —
// this file only fixes the vocabulary the agent, tools, and evidence share.

import { z } from "zod";

export const agentRunInputSchema = z.object({
  orgId: z.string().min(1),
  incidentId: z.string().min(1),
  question: z.string().min(3).max(2000),
});

export type AgentRunInput = z.infer<typeof agentRunInputSchema>;

export interface AgentHypothesis {
  id: string;
  statement: string;
  status: "PROPOSED" | "INVESTIGATING" | "SUPPORTED" | "REJECTED";
  confidence: number;
}
