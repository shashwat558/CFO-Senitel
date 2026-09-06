// Typed service errors — routes map `status` to HTTP codes instead of
// regex-matching message strings.
export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
  }
}

export class NotFoundError extends ServiceError {
  constructor(message = "not found") {
    super("NOT_FOUND", message, 404);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends ServiceError {
  constructor(message: string) {
    super("VALIDATION", message, 400);
    this.name = "ValidationError";
  }
}

export class ConflictError extends ServiceError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
    this.name = "ConflictError";
  }
}

export class ForbiddenError extends ServiceError {
  constructor(message: string) {
    super("FORBIDDEN", message, 403);
    this.name = "ForbiddenError";
  }
}

export class MissingOrgError extends ServiceError {
  constructor() {
    super("NO_ORG", "no organization found — run `npx prisma db seed` first", 503);
    this.name = "MissingOrgError";
  }
}

export function toStatus(e: unknown, fallback = 500): number {
  if (e instanceof ServiceError) return e.status;
  const s = (e as { status?: unknown }).status;
  return typeof s === "number" && Number.isFinite(s) ? s : fallback;
}
