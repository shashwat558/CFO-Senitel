// Verification types (Phase 3+). Every executed action must be verified
// against fresh evidence. No verification runs in Phase 1.

export interface VerificationResult {
  actionId: string;
  verified: boolean;
  checkedAt: string;
  detail: string;
}
