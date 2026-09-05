import { describe, expect, it } from "vitest";
import {
  advancePhase,
  canTransitionInvestigation,
  canTransitionRun,
  canTransitionStep,
  createInvestigation,
  deserializeContext,
  failInvestigation,
  fromPrismaRunStatus,
  pauseInvestigation,
  pauseRun,
  resumeInvestigation,
  resumeRun,
  roundTripContext,
  toPrismaRunStatus,
  toPrismaStepStatus,
} from "../lib/agent/investigation-state";

function base() {
  return createInvestigation({ investigationId: "inv1", orgId: "org1", incidentId: "inc1" });
}

describe("investigation state model", () => {
  it("creates with DETECT/QUEUED defaults", () => {
    const ctx = base();
    expect(ctx.phase).toBe("DETECT");
    expect(ctx.runState).toBe("QUEUED");
  });

  it("allows the linear pipeline", () => {
    let ctx = base();
    for (const next of ["UNDERSTAND", "PLAN", "INVESTIGATE", "VALIDATE", "QUANTIFY", "RECOMMEND", "APPROVAL", "EXECUTE", "VERIFY", "RESOLVE"] as const) {
      expect(canTransitionInvestigation(ctx.phase, next)).toBe(true);
      ctx = advancePhase(ctx, next);
    }
    expect(ctx.phase).toBe("RESOLVE");
  });

  it("rejects invalid transitions", () => {
    expect(canTransitionInvestigation("DETECT", "RESOLVE")).toBe(false);
    expect(canTransitionInvestigation("RESOLVE", "DETECT")).toBe(false);
    expect(() => advancePhase(base(), "RESOLVE")).toThrow();
  });

  it("supports re-plan / re-validate loops", () => {
    expect(canTransitionInvestigation("VALIDATE", "INVESTIGATE")).toBe(true);
    expect(canTransitionInvestigation("APPROVAL", "RECOMMEND")).toBe(true);
    expect(canTransitionInvestigation("VERIFY", "EXECUTE")).toBe(true);
  });

  it("pauses and resumes", () => {
    const running = { ...base(), runState: "RUNNING" as const };
    const paused = pauseInvestigation(running);
    expect(paused.runState).toBe("PAUSED");
    expect(paused.pausedAt).not.toBeNull();
    const resumed = resumeInvestigation(paused);
    expect(resumed.runState).toBe("RUNNING");
    expect(resumed.pausedAt).toBeNull();
  });

  it("rejects invalid pause/resume", () => {
    expect(() => pauseRun("QUEUED")).toThrow();
    expect(() => pauseRun("COMPLETED")).toThrow();
    expect(() => resumeRun("RUNNING")).toThrow();
    expect(canTransitionRun("RUNNING", "PAUSED")).toBe(true);
    expect(canTransitionRun("PAUSED", "RUNNING")).toBe(true);
    expect(canTransitionRun("COMPLETED", "RUNNING")).toBe(false);
  });

  it("records failure state", () => {
    const failed = failInvestigation({ ...base(), runState: "RUNNING" }, {
      code: "TOOL_TIMEOUT",
      message: "vendor spend timed out",
      phase: "INVESTIGATE",
      retryable: true,
    });
    expect(failed.runState).toBe("FAILED");
    expect(failed.failure?.code).toBe("TOOL_TIMEOUT");
    expect(canTransitionRun("FAILED", "QUEUED")).toBe(true); // retry
  });

  it("validates step transitions", () => {
    expect(canTransitionStep("PENDING", "RUNNING")).toBe(true);
    expect(canTransitionStep("RUNNING", "SUCCEEDED")).toBe(true);
    expect(canTransitionStep("FAILED", "RETRYING")).toBe(true);
    expect(canTransitionStep("SUCCEEDED", "RUNNING")).toBe(false);
    expect(canTransitionStep("PENDING", "SUCCEEDED")).toBe(false);
  });

  it("round-trips through JSON (persistable)", () => {
    const ctx = pauseInvestigation({ ...base(), runState: "RUNNING" });
    expect(roundTripContext(ctx)).toEqual(ctx);
  });

  it("rejects invalid persisted snapshots", () => {
    expect(() => deserializeContext({ phase: "NOPE", runState: "RUNNING" })).toThrow();
    expect(() => deserializeContext(null)).toThrow();
  });

  it("maps to existing Prisma statuses", () => {
    expect(toPrismaRunStatus("PAUSED")).toBe("RUNNING");
    expect(toPrismaRunStatus("WAITING_APPROVAL")).toBe("RUNNING");
    expect(toPrismaRunStatus("COMPLETED")).toBe("COMPLETED");
    expect(fromPrismaRunStatus("RUNNING", { runState: "PAUSED" })).toBe("PAUSED");
    expect(fromPrismaRunStatus("COMPLETED")).toBe("COMPLETED");
    expect(toPrismaStepStatus("SUCCEEDED")).toBe("OK");
    expect(toPrismaStepStatus("FAILED")).toBe("ERROR");
  });
});
