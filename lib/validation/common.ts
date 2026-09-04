import { z } from "zod";

export const cuidSchema = z.string().min(1, "id is required");

export const orgIdSchema = z.string().min(1, "orgId is required");

export const isoDateSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "must be an ISO date string" });

export const yearSchema = z.number().int().min(2000).max(2100);

export const monthSchema = z.number().int().min(1).max(12);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;
