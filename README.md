# CFO Sentinel — foundation (Phase 1)

Agentic financial incident investigation and response platform.
This phase establishes a working TypeScript modular monolith: Next.js + PostgreSQL + Prisma,
deterministic financial services, the first 8 financial tools, thin APIs, and a basic UI shell.

> Rule: the LLM never computes authoritative financial numbers. Agent → Tool → Financial
> Service → Prisma → PostgreSQL. The agent may decide *what* to investigate; only
> deterministic services calculate truth.

## Stack

Next.js 14 · React 18 · TypeScript · PostgreSQL 16 · Prisma 5 · Zod · OpenAI API (Phase 2+) ·
Vitest · Docker Compose

## Quickstart

```bash
cp .env.example .env        # fill in OPENAI_API_KEY later; DB URL works as-is
docker compose up -d
npx prisma migrate dev      # creates DB schema
npx prisma db seed          # deterministic Acme Industries dataset (12 months)
npm run dev                 # http://localhost:3000
```

| Step | Check |
|---|---|
| DB up | `docker compose ps`, `pg_isready` |
| API | `curl localhost:3000/api/health` → `{"status":"ok","db":"up",…}` |
| Dashboard | `curl localhost:3000/api/dashboard` → trend, August-vs-July, top vendors |
| Incidents | `curl localhost:3000/api/incidents` → seeded August margin incident |
| UI | `/dashboard`, `/incidents`, `/incidents/[id]`, `/approvals` |

## Scripts

- `npm run dev` — Next.js dev server
- `npm run build` — production build
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Vitest suite (seed integrity, calculations, tools, validation)
- `npx prisma migrate dev` / `npx prisma db seed` / `npx prisma studio`

## Architecture

```
app/                      Next.js routes (UI + thin /api/* handlers)
components/               React UI (SiteNav, KpiCard)
lib/
  financial/              DETERMINISTIC services (calculations.ts pure math,
                          pnl.ts GL aggregation). No LLM, no network.
  tools/                  Agent-only DB surface: 8 validated tools + registry.
                          Agent never touches Prisma directly.
  services/               API business logic (dashboard, incidents, org).
  db/                     Prisma singleton. Only services/tools import it.
  validation/             Zod schemas (transport + tool inputs).
  evidence/               recordEvidence() — every conclusion traces here.
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

## Environment

See `.env.example`: `DATABASE_URL`, `OPENAI_API_KEY` (Phase 2+), `MODEL_NAME`.
Never hardcode secrets.

## Definition of done (Phase 1)

`docker compose up -d` → `prisma migrate dev` → `prisma db seed` → `npm run dev`
yields a working app on seeded Acme data, with passing tests + clean build.

## Next step → Phase 2: Investigator Agent

Build the read-only Investigator Agent loop (no approvals/execution yet):
`POST /api/incidents/[id]/investigate` → persistent `AgentRun` + `AgentStep`
rows → model picks tools from `TOOL_REGISTRY` → each call recorded via
`recordEvidence()` → hypotheses tested (`compareVendorPrices` for August Apex) →
`IncidentFinding` rows with confidence + the "August gross margin" answer
traced to invoice/contract evidence. Suggested first test: *"August margin fell
Xpp; Apex Steel overcharge ≈ $Y"* derived live from tools, never asserted strings.
