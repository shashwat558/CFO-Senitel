# CFO Sentinel — foundation (Phase 1)

![CI](https://github.com/shashwat558/CFO-Senitel/actions/workflows/ci.yml/badge.svg)

Agentic financial incident investigation and response platform.
This phase establishes a working TypeScript modular monolith: Next.js + PostgreSQL + Prisma,
deterministic financial services, 17 financial tools, thin APIs, and a basic UI shell.

> Rule: the LLM never computes authoritative financial numbers. Agent → Tool → Financial
> Service → Prisma → PostgreSQL. The agent may decide *what* to investigate; only
> deterministic services calculate truth.

## Stack

Next.js 14 · React 18 · TypeScript · PostgreSQL 16 · Prisma 5 · Zod · OpenAI API (Phase 2+) ·
Vitest · Docker Compose

## Quickstart

The fastest path is the production Docker stack: on a fresh clone, one command
builds the app image, boots PostgreSQL, applies migrations, and seeds the
deterministic dataset — leaving a working, seeded app on `:3000`.

```bash
cp .env.example .env        # fill in OPENAI_API_KEY to use the Investigator Agent
docker compose up --build   # db → migrate → seed → app (http://localhost:3000)
```

| Step | Check |
|---|---|
| Stack up | `docker compose ps` → `app` running, `migrate` exited 0 |
| App boots | `docker compose logs app` → `Ready` |
| Health | `curl localhost:3000/api/health` → `{"status":"ok","db":"up",…}` |
| Dashboard | `curl localhost:3000/api/dashboard` → trend, August-vs-July, top vendors |
| Incidents | `curl localhost:3000/api/incidents` → seeded August margin incident |
| Audit trail | `curl localhost:3000/api/audit-logs` → org-scoped activity ledger |
| UI | `/dashboard`, `/incidents`, `/incidents/[id]`, `/approvals`, `/audit` |

For local development (hot reload) without Docker, run against the compose DB:

```bash
cp .env.example .env        # fill in OPENAI_API_KEY later; DB URL works as-is
docker compose up -d db     # only the PostgreSQL service
npx prisma migrate dev      # creates DB schema
npx prisma db seed          # deterministic Acme Industries dataset (12 months)
npm run dev                 # http://localhost:3000
```

## Scripts

- `npm run dev` — Next.js dev server
- `npm run build` — production build (standalone output)
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Vitest suite (seed integrity, calculations, tools, validation)
- `npx prisma migrate deploy` / `npx prisma db seed` / `npx prisma studio`
- `docker compose up --build` — full prod stack (db + migrate + seed + app)

## CI

`.github/workflows/ci.yml` runs on every push/PR: `prisma generate` →
`prisma validate` → `typecheck` → `test` → `build`.

## Rate limiting (Investigations)

`POST /api/incidents/[id]/investigate` is rate-limited **per org** to
**10 requests/minute** (sliding window) by default, because each call spins up
the expensive LLM investigation loop. Knobs (see `.env.example`):

- `RATE_LIMIT_MAX_REQUESTS` — window budget (default `10`; `0` disables)
- `RATE_LIMIT_WINDOW_MS` — window length in ms (default `60000`)

Exceeding the limit returns `429` with a `Retry-After` header. The limiter is
in-process (good for the single-instance Docker deploy); swap `lib/ratelimit.ts`
for a shared store if you scale horizontally.

## Run event stream (SSE)

`GET /api/incidents/[id]/runs/[runId]/stream` replays a run as Server-Sent
Events (`agent_started → agent_step → tool_started/tool_completed →
evidence_added → agent_finished`), projected deterministically from persisted
`AgentRun`/`AgentStep`/`IncidentEvidence` rows (`lib/agent/runEvents.ts`).
`?follow=1` (default) holds the stream while the run is `RUNNING`, polling and
emitting only new ids; `?follow=0` sends one snapshot. `?cursor=<lastId>`
resumes after a reconnect; `pollMs` (250–5000) and `maxWaitMs` (≤600000) bound
a forgotten tab. Evidence attribution is approximate: rows carry no run id, so
incident evidence at/after run start is attributed to the run.

## Architecture

```
app/                      Next.js routes (UI + thin /api/* handlers)
components/               React UI (SiteNav, KpiCard)
lib/
  financial/              DETERMINISTIC services (calculations.ts pure math,
                          pnl.ts GL aggregation). No LLM, no network.
  tools/                  Agent-only DB surface: 17 validated tools + registry.
                          Agent never touches Prisma directly.
                          (P&L, spend, contracts, invoices, banks, budgets,
                          forecasts, reconciliation, cash forecast, aging,
                          billing comparison.)
  connectors/             Real-app import surface — read-only by design:
                          Dodo Payments pull (payments/payouts/refunds) →
                          StagedRecord → FX + promote into Invoice/Customer/
                          BankTransaction. The agent reads promoted rows only.
  services/               API business logic (dashboard, incidents, org).
  db/                     Prisma singleton. Only services/tools import it.
  validation/             Zod schemas (transport + tool inputs).
  evidence/               recordEvidence() + lineage service — every conclusion
                          traces here with sourceType/sourceId (see below).
  ai/                     Lazy OpenAI client (Phase 2+ reasoning only).
  agent/ actions/ approvals/ verification/
                          Phase 2/3 vocabularies (types only, no fake logic).
  seed/                   Deterministic Acme dataset builder (pure) + constants.
prisma/                   schema.prisma + seed.ts (persists builder output)
tests/                    vitest: calculations, seed, tools (mocked DB), validation
```

### Data model

`Organization → User/Vendor/Customer/Account/Contract/PurchaseOrder/Invoice/
JournalEntry/Transaction` (Transaction = balanced journal line; every entry's
debits equal credits) plus `FinancialIncident → Finding/Evidence/Action`,
`AgentRun → AgentStep`, `Approval`, `AuditLog`. All tenant tables carry `orgId`.

### Procure-to-pay chain (seeded, queryable)

`Vendor → Contract → PurchaseOrder → Invoice → Transaction → JournalEntry`.
August 2024: Apex Steel invoices bill ~28% above contract — stored as data,
never hardcoded as a conclusion. The demo question *"Why did gross margin fall
in August?"* is answerable via `getPnl → comparePeriods → breakDownMetric →
getVendorSpend → compareVendorPrices → calculateFinancialImpact`.

### Cash, budgets, forecasts (seeded, queryable)

Every `PAID` invoice settles through exactly one `BankTransaction` (amounts
match invoice totals to the cent; pre-September legs ship `RECONCILED`, later
legs stay `PENDING` for the reconciliation demo). Monthly `Budget` rows per
account and `BASE` `Forecast` rows (revenue/COGS/opex) come from the same
constants, so `getBudgetVsActual` shows the August COGS blowout and
`reconcileBankTransaction` links pending legs with exact-cents + direction
checks.

### Cash crisis + revenue leakage (seeded, queryable)

AUTOFAB (28% of revenue) stops paying in H2 — all twelve Jul–Dec invoices go
`OVERDUE` — September collections stall book-wide, and a $600k December GLC
inventory build lands due 2025-01-15. From 2025-01-01 the 13-week forecast
(`getCashForecast`: haircut-adjusted collections trickling over leading weeks,
firm AP, payroll/opex/COGS run-rates from trailing GL, forward BASE sales)
dips to ~$144k against the $1M floor: shortfall ≈ $856k with the GLC
commitment and concentrated Apex payables as top drivers. November LAKESIDE
ships one split instead of two (`compareCustomerBilling` → `MISSING_INVOICE`,
−37% vs trailing), while December NORTHSTAR's 3-way re-split at the same total
reads `TIMING` — the legitimate counterexample. Three incidents ship:
`incident_gm_aug2024`, `incident_cash_q1_2025` (`CRITICAL`), and
`incident_leakage_nov2024`.

### Audit log

Every user-driven mutation (incident status, assignment, approval decisions,
investigation cancellation, verification runs) appends an `AuditLog` row scoped
to `orgId` with actor, entity, and a JSON `metadata` payload. New `JournalEntry`
rows default to `DRAFT` in Prisma; the migration
`20260906140000_align_journal_status_default_draft` aligns the PostgreSQL column
default with the schema (seeded entries still write an explicit `POSTED`).

### Evidence lineage

`GET /api/incidents/[id]/evidence` lists the ledger (`?findingId=&toolName=&
sourceType=`, paginated); `GET .../evidence/[evidenceId]?expand=source`
resolves the lineage source row org-scoped (`INVOICE`, `CONTRACT`,
`PURCHASE_ORDER`, `TRANSACTION`, `JOURNAL_ENTRY`, `BANK_TRANSACTION`,
`FORECAST`, `BUDGET`; only `CALCULATION`/`AGENT_OBSERVATION`/`DOCUMENT` still
resolve to null — documents land with the connector file pipeline).
Missing rows resolve to `{ row: null, reason }` — never fabricated.

### Real-app connectors (Dodo Payments, read-only)

`lib/connectors/` pulls external money events without ever writing back:
`DodoConnector.pull(since)` (payments/payouts/refunds, watermarked, capped) →
`StagedRecord` rows (unique on org+provider+kind+externalId, raw payload kept) →
`promoteStagedRecords()` maps payments to `Customer` + `SENT` AR invoices with
balanced `POSTED` entries, payouts/refunds to `PENDING` bank legs, all amounts
converted by dated `lib/fx.ts` rates (INR→USD snapshot) with both figures
stored. `POST /api/connect/dodo/webhook` verifies the SDK signature first,
then stages (redelivery-safe) and audits; lifecycle noise acknowledges without
staging. Promotion stays out of the webhook path (C5 scheduler owns it).
`POST /api/connect/sync` runs one audited tick (pull → stage → promote) for
cron-style schedulers; `GET /api/connect/sync` lists recent `SyncRun` rows so
silent sync death is visible. `getBankTransactions` accepts
`source=DODO_IMPORT`, so *"yesterday's Dodo collections and their invoice
lineage"* is one tool call plus `?expand=source` on each `invoiceId`. One bad row → `REJECTED` with reason; the batch continues. Needs
`DODO_PAYMENTS_API_KEY` (test mode works); payouts land on
`DODO_PAYOUT_BANK_NAME` (default `Operating Checking`). Webhooks verify via the
SDK `unwrap` before parsing.

## Environment

See `.env.example`: `DATABASE_URL`, `OPENAI_API_KEY`, `MODEL_NAME`, and optional
`RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW_MS`. Never hardcode secrets.

## Definition of done (Phase 1)

`docker compose up --build` on a fresh clone → migrate + seed + app runs on
seeded Acme data with `GET /api/health` → `{status:ok, db:up}`, passing tests
and a clean build, and a green CI badge.

## Next step → Phase 2: Investigator Agent

Build the read-only Investigator Agent loop (no approvals/execution yet):
`POST /api/incidents/[id]/investigate` → persistent `AgentRun` + `AgentStep`
rows → model picks tools from `TOOL_REGISTRY` → each call recorded via
`recordEvidence()` → hypotheses tested (`compareVendorPrices` for August Apex) →
`IncidentFinding` rows with confidence + the "August gross margin" answer
traced to invoice/contract evidence. Suggested first test: *"August margin fell
Xpp; Apex Steel overcharge ≈ $Y"* derived live from tools, never asserted strings.
