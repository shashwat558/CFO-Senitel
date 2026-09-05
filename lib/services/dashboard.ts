// Dashboard service — aggregates read-only KPIs for the UI.
// Route handlers call this; they contain no business logic themselves.

import type { PrismaClient } from "@prisma/client";
import { fetchMonthlyPnl, fetchVendorSpend, getPeriodBounds } from "../financial/pnl";
import { calculateVariance, calculateVariancePercent } from "../financial/calculations";
import { SEED_YEAR } from "../seed/constants";

// Seed year is the default trend window for the Phase-1 demo dataset.
// Pass an explicit year to override (keeps UI from going stale in 2026+).
const DEFAULT_TREND_YEAR = SEED_YEAR;

export async function getDashboardData(db: PrismaClient, orgId: string, trendYear = DEFAULT_TREND_YEAR) {
  if (!orgId) throw new Error("orgId is required");
  // Parallelize the 12 monthly P&L fetches (was 12 sequential round-trips).
  const months = await Promise.all(
    Array.from({ length: 12 }, (_, i) => fetchMonthlyPnl(db, orgId, trendYear, i + 1))
  );
  const trend: Array<{
    year: number; month: number; revenue: number; cogs: number;
    grossProfit: number; grossMargin: number; netIncome: number;
  }> = months.map((p, i) => ({
    year: trendYear, month: i + 1, revenue: p.revenue, cogs: p.cogs,
    grossProfit: p.grossProfit, grossMargin: p.grossMargin, netIncome: p.netIncome,
  }));
  const latest = trend[trend.length - 1];
  const prior = trend[trend.length - 2];
  const august = trend.find((t) => t.month === 8) ?? null;
  const july = trend.find((t) => t.month === 7) ?? null;

  const { start, end } = getPeriodBounds(latest.year, latest.month);
  const spend = await fetchVendorSpend(db, orgId, start, end);
  const openIncidents = await db.financialIncident.count({
    where: { orgId, status: { in: ["OPEN", "INVESTIGATING", "PENDING_APPROVAL"] } },
  });

  return {
    orgId,
    latest,
    monthOverMonth: {
      grossMarginVariance: calculateVariance(latest.grossMargin, prior.grossMargin),
      grossMarginVariancePercent: calculateVariancePercent(latest.grossMargin, prior.grossMargin),
      revenueVariance: calculateVariance(latest.revenue, prior.revenue),
      cogsVariance: calculateVariance(latest.cogs, prior.cogs),
    },
    augustVsJuly: august && july ? {
      augustMargin: august.grossMargin,
      julyMargin: july.grossMargin,
      variance: calculateVariance(august.grossMargin, july.grossMargin),
    } : null,
    trend,
    topVendors: spend.rows.slice(0, 5),
    totalSpendLatestMonth: spend.total,
    openIncidents,
  };
}
