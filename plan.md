# plan.md — Executable Transition Specification: Hexagonal Architecture and DDD

**Revision:** 5 (English, assignment format)
**Date:** 2026-11-12
**Stack:** PostgreSQL 18 · Go 1.27 (`backend/`) · Vue 3 + Pinia PWA (`pwa/`) · OpenAPI 3.0.3 · AsyncAPI 3.0
**Audit inputs (source of truth):**

| Document | Role |
|---|---|
| [done.md](done.md) | What is already implemented, with `file:line` evidence |
| [todo.md](todo.md) | What must be completed, prioritized P0–P3 |
| [docs/migration/ddd/](docs/migration/ddd/) | Bounded contexts, tactical design, generated model |
| [api/openapi.yaml](api/openapi.yaml) | Current REST contract (3 337 lines, 76 operations) |
| [api/asyncapi.yaml](api/asyncapi.yaml) | Current WebSocket contract (`Ping`/`Pong`/`Change`/`Resync`/`Notice`) |

No requirement in this plan is invented. Every architectural claim resolves to a `file:line`
reference in the audit or to the contract.

---

## Change summary by revision

| Rev | Language | Change |
|---|---|---|
| 1 | ru | Initial plan: 15 steps, ≈272 h |
| 2 | ru | Added steps 1a, 2d, 2e, 4a, 5a, 9a, 10a, 11a, 12a, 13a; `UnitOfWork` moved to `application`; `Save(ctx, l, expectedVersion)`; `EventDispatcher` moved to `application` |
| 3 | ru | Decisions Q1–Q15; `authorize` split into `guards`+`checkField`; explicit rules for `Mark`/`Strike`/`SetSelfPickup`; `Dispatch` inside transaction; three-phase `arm.line` split; 4-field parity; step 13.0 |
| 4 | ru | Decisions Q16–Q20; advisory lock instead of unique index (R7); `DenyReason` takes `Status` (R9); resolved 2d/2e overlap (NR3); `ДокументПодписанОригинал` exception; lock verified on DB only (NR5); fake UoW snapshots (NR6) |
| **5** | **en** | **Restructured to the assignment template: mandatory step template, per-step OpenAPI-update and Database-as-test-data subsections, P3 contract ordering, G1–G6 gates, verified-fact discipline** |

---

## 0. Working rules

### 0.1 Three verification levels

| Level | Scope | When |
|---|---|---|
| **L1** — step test | New behavior in isolation | Written with the code; red first, then green |
| **L2** — package regression | Neighboring packages | After the change, before commit |
| **L3** — full run | Whole repository | Before every commit |

L2 scope rule: a step touching `arm` runs `./internal/arm/...` and `./internal/api/...`;
a step touching `domain` runs `./internal/domain/...`, `./internal/application/...`,
`./internal/adapters/...`.

### 0.2 Mandatory full run (L3)

```powershell
# from repository root
task lint
task arch          # from Step 7 onward
task test          # go test ./... + node --test tools/migration/tests/*.test.mjs + vitest
task gen
git diff --exit-code
```

### 0.3 The "green run" trap

DB-dependent tests **silently skip** when no stand is reachable:
`teststand.Connect` → `t.Skipf` (arm/partial_ordered_test.go:17-21);
`VITAUTO_DB` → `t.Skipf` (arm/delete_audit_test.go:57-68).
`go test ./...` can therefore be green while running zero database checks.

**Rule 1.** Inspect the skip list on every step:

```powershell
cd backend
go test ./... -count=1 -v 2>&1 | Select-String '^\s*--- SKIP'
```

**Rule 2.** Any step touching `domain`/`application`/`adapters` runs **with a mandatory database**
(`VITAUTO_DB` or `TESTCONTAINERS=1`). A skipped repository contract test means the step failed.

### 0.3a Known pre-existing L3 failures (measured 2026-11-12, before Step 1)

The L3 gate is **not green on the untouched repository**. These three failures exist at `cd45a2c`
and are environmental, not defects introduced by this plan. Fixing them is out of scope; each step
must only prove it adds no **new** failures and no new skips.

| Failure | Cause | Evidence |
|---|---|---|
| `go test ./internal/migrate/` → `TestGeneratedSQLFresh` | Requires the 1C metadata dump `docs/migration/source/meta-vitauto_dev.jsonl`, generated from the live 1C base by `tools/migration/onec-meta-full.js`. The file is absent and not committed | `gen_test.go:29` |
| `node --test tools/migration/tests/*.test.mjs` | `tools/migration/extract-domain.mjs:17` reads `column-codes.js` at the repository root; the file is **missing** (`Test-Path column-codes.js` = False), although README.md:60 references it as the shared source for matrix and questionnaire | `extract-domain.mjs:17` |
| `task gen` + `git diff --exit-code` | Regeneration changes `backend/internal/api/types.gen.go` (+192) and `pwa/src/http/schema.d.ts` (+369): the committed generated code is **stale** relative to `api/openapi.yaml`. CI runs this check (ci.yml:39-44), so CI is currently red for the same reason | `git diff` after `task gen` |

Consequences for this plan:

1. After running `task gen` for contract steps, **revert** unrelated regenerated files, or the step's
   commit silently includes a large unrelated regeneration. Revert only the files the step did not
   intend to change:

   ```powershell
   git checkout -- backend/internal/api/types.gen.go pwa/src/http/schema.d.ts
   ```

2. The `git diff --exit-code` criterion in each step's "Done when" is evaluated **against the step's
   own diff**: a pre-existing diff in the generated contract is not a step failure, but a **new**
   diff caused by the step is.
3. Step 15 should decide whether repairing these three is in scope (a separate PR, per the rule that
   cosmetic/unrelated changes stay outside this plan).

### 0.4 Environment variables

```powershell
$env:VITAUTO_DB      = "postgres://postgres:postgres@127.0.0.1:5434/vitauto_app"
$env:VITAUTO_SO_DSN  = "postgres://postgres:postgres@127.0.0.1:5432/vitauto_so_stand"
$env:ODATA_URL       = "http://127.0.0.1:8090/odata215/odata/standard.odata"
$env:TESTCONTAINERS  = "1"   # optional: start postgres:18 automatically
```

- `VITAUTO_DB` — schema tests (arm/delete_audit_test.go:57)
- `VITAUTO_SO_DSN` — seed stand (teststand/stand.go:18-23)
- `ODATA_URL` — live 1C OData for PWA tests (pwa/vitest.config.js:7); without it PWA tests skip (pwa/test/app.test.js:26-34)
- `TESTCONTAINERS` — `testdb.Open(t)` starts `postgres:18` itself (Step 1)

All three paths use **the same PostgreSQL major version (`postgres:18`)** as CI (ci.yml:24-30).

### 0.5 Conventions

- One step = one branch `arch/<number>-<slug>`, one PR.
- New behavior: failing test first. Refactoring: watchdog test on current behavior first.
  Deletion: only after a test proves behavior is preserved or intentionally removed.
- Update `todo.md` at the end of each step (item → done).
- Cosmetic changes (renames, formatting) belong outside this plan.

---

## 1. Decisions on open questions

All 20 questions were raised by the three review rounds. **No question remains open.**

| # | Question | Decision | Rationale | Affected step |
|---|---|---|---|---|
| **Q1** | Are domain events delivered inside the transaction or via outbox? | **Synchronously inside the transaction** | 02-tactical.md:98 requires it: "Command runs in one transaction: aggregate, `sys.change_log`, outbox, notifications. Commit happens before the client response." Async would contradict the model. The existing DB trigger also works in-transaction | 9 |
| **Q2** | Does `UnitOfWork`/`Repositories` live in `domain` or `application`? | **`application/ports.go`** | An aggregate does not manage transactions. `UnitOfWork` promises PostgreSQL semantics (`set_config`, `set constraints deferred`) — not a domain concept. `domain` declares only `LineRepository`, `NoticeRepository` | 1 |
| **Q3** | Does `Save` take `expectedVersion`, or does the aggregate carry `loadedVersion`? | **`Save(ctx, l, expectedVersion)`** plus a separate `Create` | `loadedVersion` is a persistence concern inside the aggregate, violating "core without infrastructure". The application layer knows the version (from `If-Match`) | 1, 4 |
| **Q4** | Is `Transitions` keyed by 1C statuses or API codes? | **By 1C statuses**; the command code is a separate `Code` field | Today `To: "reserve"` (API code) and `From: []Status{StatusDraft}` (1C) sit in one struct — mixed languages. Rename `To`→`Code`, `Status`→`To` | 5a |
| **Q5** | Does `arm.line_api` stay a SQL read model? | **Yes — CQRS**: view = query side, `domain.Line` = write side | The view is a legitimate projection. Rewriting it in Go buys nothing. What is missing is a parity test, not a port | 11, 11a |
| **Q6** | Is `OutboxMessage` an aggregate or infrastructure? | **Infrastructure entity**; reclassified in the model as `infrastructure` | It **is** listed in 02-tactical.md:62 (see §2.1). It is not implemented as a domain aggregate, but its invariants must not disappear from the model | 12, 15 |
| **Q7** | When is `partial_ordered_sync` dropped — Step 9 or 10? | **Rule into domain at 9a; trigger dropped at 10a** | The trigger catches writes that bypass the application (seeds, migration). It cannot be dropped before the single write path is closed | 9a, 10a |
| **Q8** | Local DB tests: `testcontainers` or `VITAUTO_DB`? | **Both**, without a new Go dependency: `docker-compose.test.yml` + `VITAUTO_DB`; on unavailability — SKIP with a hint | CI already uses a service container (ci.yml:24-30). `testcontainers-go` would add the Docker SDK to `go.mod` and diverge CI from local runs | 1 |
| **Q9** | Is `Fields` domain fields or SQL columns? | **`domain.Field`** (typed string + constants) + `adapters/postgres/field_map.go` | `Fields` is a DB-column map (arm/fields_gen.go). The domain needs the ubiquitous-language field name; the mapping belongs to the adapter | 2a |
| **Q10** | Is `If-Match` required in PWA OData mode? | **No** — record as a known limitation (ADR 0006) | OData is legacy; 1C does not support `If-Match`. REST is the new mode | 4, 15 |
| **Q11** | `Create`/`Insert`: separate method or does `Save` distinguish? | **Separate `Create`** | `Save` with `expectedVersion = 0` is ambiguous: "do not check" versus "insert" are different operations | 1 |
| **Q12** | Is `Clock` a port or a service field? | **Port `domain.Clock`**, implementation `platform/clock` | Two mechanisms coexist today: `Service.Now func()` and a `now time.Time` parameter. `NoticePolicy` (Step 9) cannot be assembled without a port | 1a |
| **Q13** | Should domain events be added to `asyncapi.yaml`? | **No.** AsyncAPI describes the external WS surface (`Change`/`Notice`/`Resync`), not internal events | See §2.2. Instead: a parity test "policy → node → `Notice.topic`" | 12a |
| **Q14** | Should the 82-column `arm.line` be split? | **Yes, as a separate step 10a** with migration, backfill and view reassembly | Step 10 splits the Go package but not the god table — that is half of P1-6 | 10a |
| **Q15** | Who populates the `line_status` reference table? | **A migration** (SQL seed); the Go migrator only verifies | Today `migrate/steps.go:490-507` populates it, so data depends on running the migrator rather than on the schema | 5 |
| **Q16** | How are commands authorized when the field is **absent from the matrix** (`Mark`, `Strike`, `SetSelfPickup`)? | **Split `authorize` into `guards()` + `checkField()`.** Commands without a matrix field call `guards()` plus their own explicit rule | The matrix marks `ОтметкаСтроки` and `СтатусСтроки` as `writable=false`, and `Удаление`/`Самовывоз` are **absent entirely**. `authorize(a, FieldMarked, …)` would return `ErrFieldReadonly` and break the command | 2a, 2d, 3 |
| **Q17** | Does `ListMarked` lock rows? | **Yes, `FOR UPDATE`** — the port contract states it | The current transition code locks (`for update`, arm/lines.go:722). Without it a batch transition loses concurrent edits | 1, 4a |
| **Q18** | What happens when a notification policy fails under sync-in-tx? | **Stay sync-in-tx** (model, 02-tactical.md:98); make deduplication race-safe via `pg_advisory_xact_lock` **before** the read — no unique index, no data cleanup | `arm.notice_add` is read-then-write (0005_notify.sql:31-44); under a race two INSERTs duplicate. A unique index would force merging existing duplicates and would raise "overwrite or accumulate text". The advisory lock removes both problems and preserves current append semantics | 9 |
| **Q19** | Do `requireActor` and `authorize` duplicate the session check? | **`requireActor` only for an empty session → 401**; all business rules live in `guards()`/`checkField()` | Separation of concerns: authentication in the application layer, authorization in the domain | 2b, 2d |
| **Q20** | Model conflict: "closed line" (02-tactical.md:38) versus `Выполнено → Возврат` (domain.go:41, role `manager`) | **The closed-line guard applies to field edits only**; transitions are governed by the FSM table | Applying the closed guard to transitions would make `Возврат` from `Выполнено` impossible for a manager, although the FSM allows it. Requires customer confirmation, like the already-known M7 divergence | 3 |

---

## 2. Clarifications to reviews

Where a review premise is factually wrong, the fact is stated with `file:line` and the decision corrected.

### 2.1 `OutboxMessage` **is** in the model

Review claim: "it is probably absent from `02-tactical.md:48-62`".
Fact: `02-tactical.md:62` — `| OutboxMessage | accounting | integration.outbox | в транзакции с изменением; идемпотентная отправка |`.
Therefore "remove from Step 12" is right, but "it is not in the model" is not. Decision Q6: do not
implement it as a domain aggregate; in Step 15 **reclassify** the model row as `infrastructure`
and add an "Infrastructure patterns" section — a documentation edit, not a deletion.

### 2.2 `asyncapi.yaml` already describes the external surface

Review claim: "add the 10 events from `events.go` to `asyncapi.yaml`".
Fact: `api/asyncapi.yaml` already defines `Ping`, `Pong`, `Change`, `Resync`, `Notice`
(asyncapi.yaml:55-126), and `Notice.topic` enumerates `M8, M9, M10, M11, K9, M17, A3`
(asyncapi.yaml:118) — exactly the nodes the policies emit.
Domain events are internal; publishing them into the transport contract would leak across the
context boundary. Decision Q13: **do not add**; Step 12a adds a parity test instead.

### 2.3 In SQL it is `numeric`, not `float`

Review claim: "the view keeps computing `saleSum` in SQL as `float`".
Fact: `sale_price numeric(15,1)`, `cost_sum numeric(15,2)`, `quantity numeric(10,2)`,
`norm_hours numeric(15,3)` (0002_typed.sql:1412-1450). SQL is exact.
The divergence is on the **Go** side: `domain.Line` holds `float64` (line.go:60-66).
Step 11a therefore compares `Money` (Go) with `numeric` (SQL) and `mapping.js` (PWA) —
it does not "fix a float in SQL".

### 2.4 Five version-less updates — corrected to one production path

A review proposed a trigger `NEW.version != OLD.version + 1 → error`, and revision 2 listed five
`arm.line` updates without the increment. **That list was wrong**: the grep matched only the first
line of multi-line SQL strings and missed `version = version + 1` on the continuation.

Full check of all 11 `arm.line` updates:

| File:line | Increment |
|---|---|
| `application/access.go:176` (self_pickup) | **no** ← removed by Step 2d anyway |
| `application/placement.go:112` | yes |
| `application/returns.go:190` | yes |
| `arm/arm.go:173` | yes |
| `arm/docs.go:254` (deleted) | yes |
| `arm/jobs.go:211` | yes |
| `arm/jobs.go:368` (customer_order_id) | yes |
| `arm/supply.go:118` | yes |
| `migrate/steps.go:483` (cell_id) | **no** ← maintenance path |
| `migrate/steps.go:489` | **no** ← maintenance path |
| `teststand/stand.go:79` | **no** ← test helper |

Result: exactly **one** production omission — and that one disappears in Step 2d.
Step 2e therefore reduces to the trigger plus maintenance-path flags.

### 2.5 The proposed fix for R2 would break every transition

Review proposal: call `authorize(a, FieldStatus, a.IfMatch)` first in `TransitionTo`.
Fact: `СтатусСтроки` **is** in the matrix (code `Н5`) but with `writable=false` (all 7 roles).
`DenyReason` returns "read-only field" as its first check when `writable == false`
(matrix.go:68-70) — so this fix would return `ErrFieldReadonly` on **every** transition.

The observation is valid (transitions indeed skip the closed-line and background-lock checks),
but the cure is splitting `authorize` into `guards()` + `checkField()` (Q16).

### 2.6 R3: right conclusion, wrong reason, and wider than reported

Review claim: "`FieldMarked` is probably not in the matrix".
Fact: `ОтметкаСтроки` **is** in the matrix (code `А1`) but `writable=false`.
Additionally verified: `Удаление` (`FieldDeleted`) and `Самовывоз` (`FieldSelfPickup`) are
**absent from the matrix entirely** across all 7 roles (58 columns each).

So **three of four** authorization keys in revision 2's Step 2d were wrong. Ground truth from code:

| Command | How it is authorized today |
|---|---|
| `Mark` / `ToggleMark` | only "marked by another user" → 409 `not_author` (arm/lines.go:523-527); the matrix does not participate |
| `Strike` / `StrikeLine` | only `admin` + status `new`/`in_work` + mark ownership (arm/lines.go:929-947). Code comment: "ТЗ п.15: the «Удаление» right was removed from all profiles except administrator" |
| `SetSelfPickup` | only status `Отгружено` (application/access.go:173-176) — **no role check at all** |
| `RejectAssembly` | role `storekeeper`/`admin` + status `Собран`/`Подготовлено` (domain/line.go:178-192) |

Revision 5 therefore uses `guards()` plus an explicit rule per command.

### 2.7 NR7 rejected: `IsClosedSale()` is a different concept

Review claim: "v3 lost two statuses: it was `IsClosedSale()`, now it is `StatusDone`".
Fact: `IsClosedSale()` is the **stock** concept "sales that do not hold stock"
(`ЗакрытыеСтатусыПродаж`, status.go:40-43), used only for balance computation:
`fifo.go:48`, `fifo.go:105`, `fifo.go:195`. It has nothing to do with field editing.

The closed-line guard — `StatusDone` — is **identical in both layers**:

| Layer | Location | Condition |
|---|---|---|
| Domain (intent) | `domain/line.go:111` | `l.Status == StatusDone && a.Role != "admin"` |
| Production (fact) | `arm/lines.go:409` | `l.Status == stDone && a.Role != "admin" && field != "ДокументПодписанОригинал"` |

Widening the guard to `IsClosedSale()` would forbid editing **shipped** lines — a new regression
that does not exist today. Step 2a pins the distinction with `TestGuards_ClosedOnlyDone`.

### 2.8 The `ДокументПодписанОригинал` exception is dead code — **my claim was wrong**

Revision 4 asserted that `arm/lines.go:409`'s exception `field != "ДокументПодписанОригинал"`,
which `domain/line.go:111` lacks, was a real regression that Step 2c would introduce.
**That was wrong.** Verified against the matrix (all 7 roles × 15 statuses):

| Role | `writable` | `rights` | Statuses with `+` |
|---|---|---|---|
| `manager` | true | `............cc.` | **none** |
| `storekeeper` | true | `............cc.` | **none** |
| `chief_mechanic` | true | `............cc.` | **none** |
| `supply` | true | `............cc.` | **none** |
| `supplier`, `client` | true | `...............` | **none** |
| `admin` | true | `+++++++++++++++` | all 15 |

`arm.PatchLine` checks the matrix **first** (arm/lines.go:400-408) and the closed line **second**
(arm/lines.go:409). For a manager at status `Выполнено` (`closed`, index 14) the matrix right is `.`,
so `denyReason` already returns `403 matrix_denied` and the closed-line line is never reached.
The exception is therefore **unreachable for non-admins**, and admins are excluded from the closed
check anyway.

Consequence: switching `PatchLine` to the domain does **not** break signing a closed line — the same
`403 matrix_denied` comes back from `checkField`. Step 2a still passes `allowClosed = true` for this
field, but as **fidelity to arm's check order**, not as a functional fix: it makes the returned
message come from the matrix rather than from the closed guard.

Pinned by two tests instead of one:
`TestChangeField_SignedOriginalOnClosed` (manager, `Выполнено` → `ErrMatrixDenied`) and
`TestChangeField_SignedOriginalAsAdmin` (admin → allowed).

---

## 3. Phases

| Phase | Steps | Content |
|---|---|---|
| **Preparation** | 0.1 – 0.3 | Baseline, `task arch`, `internal/arch` skeleton |
| **A — Foundation** | 1 – 6 | Ports and UoW → domain commands and FSM → `If-Match` → duplicate removal → ACL → dependency direction |
| **B — Regression protection** | 7 | Architecture tests in CI |
| **C — Application layer** | 8 – 10a | SQL out of `application` → events and policies → `arm` split → `arm.line` split |
| **D — Domain model** | 11 – 13a | Value objects → parity → remaining aggregates → strict-server → infrastructure errors |
| **E — Client and documentation** | 14 – 15 | Client domain layer, ADRs, model alignment |

---

## 4. Steps

### Step 0.1. Baseline measurement

**Goal.** Record the current test counts and skip count so regressions and "silent skips" become visible.

**Files.**

| Action | File |
|---|---|
| create | `logs/baseline.md` |

**Implementation.**

```powershell
cd backend
go test ./... -count=1 -v 2>&1 | Tee-Object ..\logs\baseline-go.txt
cd ..
node --test "tools/migration/tests/*.test.mjs" 2>&1 | Tee-Object logs\baseline-docs.txt
cd pwa; npx vitest run 2>&1 | Tee-Object ..\logs\baseline-pwa.txt
```

Record in `logs/baseline.md`: package count, test count, **skip count**, wall time.

**Step tests.** None — read-only measurement.

**Commands.**

```powershell
# L3
task test
```

**Done when.**
- `logs/baseline.md` holds three test counts and a separate SKIP count.
- No new SKIPs.

**Rollback.** Not required (read-only).

---

### Step 0.2. Add the `task arch` entry point

**Goal.** Give architecture checks a dedicated command before Step 7 needs it.

**Files.**

| Action | File |
|---|---|
| modify | `Taskfile.yml` |

**Implementation.**

```yaml
  arch:
    desc: Architecture checks (dependency direction, SQL in domain, file size)
    cmds:
      - cd backend && go test ./internal/arch/... -count=1
```

**Step tests.** None yet — the package arrives in Step 0.3. `task arch` must parse without error.

**Commands.**

```powershell
# L3
task arch
task test
```

**Done when.**
- `task arch` runs without a Taskfile parse error.
- No new SKIPs.

**Rollback.** Remove the task from `Taskfile.yml`.

---

### Step 0.3. Architecture test package skeleton

**Goal.** Provide an empty package so Step 7 only adds checks.

**Files.**

| Action | File |
|---|---|
| create | `backend/internal/arch/arch_test.go` |

**Implementation.**

```go
// Package arch — architecture tests: dependency direction, absence of SQL in the domain,
// file-size limits. Checks are added in Step 7 (see plan.md).
package arch

import "testing"

func TestPlaceholder(t *testing.T) {
	t.Skip("checks are added in Step 7")
}
```

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `arch/arch_test.go` | `TestPlaceholder` | package compiles and `task arch` is wired |

**Commands.**

```powershell
# L1
cd backend; go test ./internal/arch/... -count=1 -v
# L3
cd ..; task arch; task test
```

**Done when.**
- Package compiles, `task arch` is green.
- No new SKIPs beyond `TestPlaceholder`, which is justified here and removed in Step 7.

**Rollback.** Delete `backend/internal/arch`.

---

### Step 1. Repository ports, unit of work, test database

**Goal.** Introduce a boundary between the domain and PostgreSQL, and remove `*pgxpool.Pool` from the application layer.

**Files.**

| Action | File |
|---|---|
| create | `backend/internal/domain/ports.go` (`LineRepository`, `NoticeRepository`) |
| create | `backend/internal/application/ports.go` (`UnitOfWork`, `Repositories`) |
| create | `backend/internal/domain/linerepotest/suite.go` |
| create | `backend/internal/domain/fakes/line_repo.go` |
| create | `backend/internal/domain/fakes/uow.go` |
| create | `backend/internal/adapters/postgres/uow.go` |
| create | `backend/internal/adapters/postgres/line_repo.go` |
| create | `backend/internal/testdb/testdb.go` |
| create | `docker-compose.test.yml` |
| modify | `backend/cmd/api/main.go` |

**Implementation.**

`domain/ports.go` — storage ports only, no transactions (Q2):

```go
type LineRepository interface {
	Get(ctx context.Context, id uuid.UUID) (*Line, error)
	GetForUpdate(ctx context.Context, id uuid.UUID) (*Line, error)
	Create(ctx context.Context, l *Line) error
	// Save updates only when the stored version equals expectedVersion.
	// expectedVersion == 0 skips the check.
	Save(ctx context.Context, l *Line, expectedVersion int64) error
	// ListMarked returns rows marked by the actor, LOCKED until end of transaction
	// (SELECT … FOR UPDATE): a batch transition must not lose concurrent edits (Q17).
	ListMarked(ctx context.Context, a Actor) ([]*Line, error)
}
```

`application/ports.go` — transaction plus the port bundle (Q2):

```go
type Repositories interface {
	Lines() domain.LineRepository
	Notices() domain.NoticeRepository
}

// UnitOfWork is the transaction boundary. The implementation sets the actor for triggers
// (set_config('vitauto.user_id')) and deferred constraints — PostgreSQL specifics,
// which is why this port lives in the application layer, not the domain.
type UnitOfWork interface {
	Do(ctx context.Context, a domain.Actor, fn func(ctx context.Context, r Repositories) error) error
}
```

The fake **must roll back (NR6)**, otherwise the Step 9 rollback test is green while proving nothing:

```go
func (u *fakeUoW) Do(ctx context.Context, a domain.Actor, fn func(context.Context, Repositories) error) error {
	snap := u.repo.Snapshot() // deep copy of rows and notices
	if err := fn(ctx, u.repos()); err != nil {
		u.repo.Restore(snap) // rollback
		return err
	}
	u.repo.Commit(snap)
	return nil
}
```

`linerepotest/suite.go` — one contract run against **both** implementations:

```go
func Run(t *testing.T, newRepo func(t *testing.T) domain.LineRepository) {
	t.Run("Get_NotFound", ...)
	t.Run("Create_SetsVersionOne", ...)
	t.Run("Save_IncrementsVersion", ...)
	t.Run("Save_StaleVersion", ...)          // → ErrVersion
	t.Run("Save_ZeroVersionSkipsCheck", ...)
	t.Run("GetForUpdate_SeesOwnWrites", ...)
	t.Run("ListMarked_OnlyMarkedByActor", ...)
	// NOTE (NR5): row locking is NOT verified here. FOR UPDATE is PostgreSQL
	// inter-transaction locking; an in-memory fake with a mutex locks goroutines,
	// not transactions, and would create false confidence. Locking is verified only in
	// adapters/postgres/line_repo_test.go.
}
```

`testdb/testdb.go` (Q8) — no new Go dependency:

```go
// Open returns a pool for tests: TESTCONTAINERS=1 → docker compose up postgres:18;
// else VITAUTO_DB; else t.Skip with a hint pointing at docker-compose.test.yml.
func Open(t *testing.T) *pgxpool.Pool
```

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `domain/fakes/line_repo_test.go` | `TestFakeLineRepo` | contract on memory |
| `domain/fakes/uow_test.go` | `TestFakeUoW_RollsBack` | failed `fn` restores state (NR6) |
| `adapters/postgres/line_repo_test.go` | `TestPostgresLineRepo` | same contract on PostgreSQL |
| | `TestUoW_Rollback` | failed `fn` rolls the transaction back |
| | `TestUoW_SetsActor` | `current_setting('vitauto.user_id')` equals the actor |
| `testdb/testdb_test.go` | `TestOpen` | connection, or explicit failure with a hint |

**Database as test data.**

- No schema change. `docker-compose.test.yml` starts `postgres:18` on port 5434.
- Tests create their own rows through `repo.Seed(l)` inside a transaction and roll back.
- Repository contract tests **must not skip** (G5): `VITAUTO_DB` or `TESTCONTAINERS=1`.
- No bypass flags are used in this step.

**Commands.**

```powershell
# L1
cd backend
go test ./internal/domain/... ./internal/application/... ./internal/adapters/... ./internal/testdb/... -count=1 -v
# L2
go test ./internal/arm/... ./internal/api/... -count=1
# L3
cd ..; task lint; task test; task gen; git diff --exit-code
```

**Done when.**
- The contract suite passes on both implementations; the repository contract test is **not skipped**.
- `domain` does not import `pgx`.
- `cmd/api/main.go` assembles `UoW` and injects it.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Delete `adapters/`, `ports.go`, `fakes/`, `linerepotest/`, `testdb/`, `docker-compose.test.yml`; restore `inTx` in `arm` and `application`.

---

### Step 1a. Clock and ID generator ports

**Goal.** Provide one way to obtain time and identifiers (Q12).

**Files.**

| Action | File |
|---|---|
| create | `backend/internal/domain/clock.go` |
| create | `backend/internal/platform/clock/clock.go` |
| create | `backend/internal/platform/id/uuid.go` |
| modify | `backend/internal/application/service.go` (remove `Now func()`) |

**Implementation.**

```go
// domain/clock.go
type Clock interface{ Now() time.Time }
type IDGenerator interface{ New() uuid.UUID }
```

```go
// platform/clock/clock.go
type System struct{}
func (System) Now() time.Time { return time.Now() }

type Fixed struct{ T time.Time }
func (f Fixed) Now() time.Time { return f.T }
```

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `platform/clock/clock_test.go` | `TestFixedClock` | returns the injected instant |
| | `TestSystemClock_Monotonic` | time does not go backwards |
| `platform/id/uuid_test.go` | `TestUUIDGenerator_Unique` | 10 000 ids without collision |
| | `TestUUIDGenerator_Version7` | UUID version 7 |

**Commands.**

```powershell
# L1
cd backend; go test ./internal/platform/... ./internal/domain/... -count=1 -v
# L2
go test ./internal/application/... -count=1
# L3
cd ..; task test
```

**Done when.**
- `Service.Now` is gone; every service takes `domain.Clock`.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Restore `Now func()` in `application/service.go`; delete the new packages.

---

### Step 2a. Fields, formulas, and the `authorize` split into the domain

**Goal.** Let the aggregate change a field without knowing about SQL, and split `authorize` into reusable invariants plus the per-field matrix check (Q9, Q16).

**Watchdog first (P2).** See "Watchdog approach actually used" below the test table: golden rounding
values asserted on both sides of the duplication, plus per-branch formula tests transcribed from
`arm/lines.go:428-457`.

**Files.**

| Action | File |
|---|---|
| create | `backend/internal/domain/field.go` (`Field`, `FieldInfo`, constants, `setters`, converters, `round2`) |
| create | `backend/internal/domain/fields_gen.go` (generated) |
| create | `backend/internal/adapters/postgres/field_map_gen.go` (generated) |
| create | `backend/internal/domain/line_test.go` (43 tests: guards, checkField, formulas, rounding) |
| create | `backend/internal/arm/round2_test.go` (write-side rounding golden values) |
| create | `backend/internal/migrate/fields_parity_test.go` (generator parity) |
| create | `backend/internal/adapters/postgres/field_map_test.go` (`TestFieldMap_Complete`) |
| modify | `backend/internal/migrate/gen.go` (`GenerateDomainFields`, `GenerateArmFields`, `GenerateFieldMap`, `gofmtSource`) |
| modify | `backend/internal/migrate/migrator.go` (writes three files) |
| modify | `backend/internal/domain/line.go` (`guards`, `checkField`, `ChangeField`, `recalcSums`, `PriceChangeType`, `RejectAssembly` gains `guards`) |
| modify | `backend/internal/domain/status.go` (`type Role` + 7 constants, `RoleByEnum` retyped) |
| modify | `backend/internal/domain/matrix.go` (`MatrixFor`, `DenyReason`, `ColumnFor` take `Role`/`Field`) |

**Consequence files (introducing `domain.Role`).** These change only because `Role` is a named type
rather than `string`. They are part of Step 2a, not of Step 5a:

| File | Change |
|---|---|
| `backend/internal/domain/domain.go` | `AllowTransition(to string, from Status, role Role)`; callers verified: only `domain/line.go` and `domain_test.go` |
| `backend/internal/api/handlers_v2.go` | `domainActor`: `Role: domain.Role(x.Role)` |
| `backend/internal/platform/ws/hub.go` | `role = string(api)` for the `RoleByEnum` lookup |

`RoleByEnum` (1C enum name → API role) **stays in `domain` until Step 5a** — it is the ACL boundary,
and Step 5a states that explicitly. Introducing `Role` in 2a is deliberate ordering: otherwise
`RoleByEnum` would have to be rewritten twice.

**`arm/fields_gen.go`: stop generating in 2c, delete in 2c.** It is **not** deleted in 2a, and the
generator **keeps emitting it** during the transition. If generation stopped here, the file would
freeze: a change to `docs/migration/storage-map.json` would update `domain.Fields` but not
`arm.Fields`, and `arm.PatchLine` would write to stale columns. Both copies come from one generator
until Step 2c, and `TestFieldsGenParity` fails if they diverge.

**`RejectAssembly` gains `guards()` here, not in Step 2d.** The command already existed in
`domain/line.go` and checked only role and status, so a deleted or background-locked line could be
rejected. Step 2d therefore covers the remaining three commands (`Mark`, `Strike`, `SetSelfPickup`)
plus endpoint wiring.

**Implementation.**

```go
// domain/field.go — Field is the ubiquitous-language name, NOT a DB column.
type Field string

const (
	FieldSalePrice      Field = "ЦенаПродажи"
	FieldQuantity       Field = "Количество"
	FieldSignedOriginal Field = "ДокументПодписанОригинал"
	// remaining constants are generated into fields_gen.go
)

// setters is an explicit application table, no reflection. Generated alongside the constants.
var setters = map[Field]func(*Line, any) error{ /* … */ }
```

**Signature ownership (do not duplicate in Step 5a).** This step introduces the `Role` type and
**changes the matrix signatures here**; Step 5a introduces only `StatusCode`.

| Symbol | Before this step | After this step | After Step 5a |
|---|---|---|---|
| `Role` | — (roles are bare `string`) | **`type Role string` + 7 constants introduced here** | unchanged |
| `Actor.Role` | `string` (line.go:30) | **`Role`** | unchanged |
| `DenyReason` | `(role string, col MatrixColumn, status Status, markedByMe bool) string` (matrix.go:67) | **`(role Role, …)` — changed here** | unchanged |
| `ColumnFor` | `(role, field string) (MatrixColumn, bool)` (matrix.go:98) | **`(role Role, field Field)` — changed here** | unchanged |
| `Status.APICode()` | `string` (status.go:46) | `string` (unchanged) | **`StatusCode`** — changed in Step 5a |
| `Transition.Roles` | `[]string` (domain.go:29) | `[]string` (unchanged) | **`[]Role`** — changed in Step 5a |
| `Actor.IfMatch` | — | **`int64` — added here** (needed by `guards` in 2a and by `Save` in 2b) | unchanged; Step 4 only reads the HTTP header |

So `checkField` below compiles only because this step already changed `DenyReason` and `ColumnFor`
to take `Role`/`Field`. Step 5a must **not** re-declare these changes — it adds `StatusCode`,
moves `RoleByEnum`/`StatusFromAPICode` to `adapters/onec`, and retypes `Transition.Roles`.

`DenyReason` continues to take a domain `Status` (it already does) and calls `status.APICode()`
internally; the return type of `APICode()` changes in Step 5a without touching `DenyReason`'s
parameter list.

```go
// domain/line.go

// guards — invariants independent of the field.
func (l *Line) guards(a Actor, expectedVersion int64, allowClosed bool) error {
	if l.Deleted { return ErrDeleted }
	if expectedVersion != 0 && l.Version != expectedVersion { return ErrVersion }
	if l.Status == StatusLockedBgJob { return ErrLocked }
	if l.Status == StatusDone && a.Role != RoleAdmin && !allowClosed { return ErrClosed }
	return nil
}

// checkField — the matrix invariant for one field (step 4 of authorize, 02-tactical.md:39).
func (l *Line) checkField(a Actor, f Field) error {
	col, ok := ColumnFor(a.Role, f)
	if !ok { return ErrFieldReadonly }
	switch why := DenyReason(a.Role, col, l.Status, l.MarkedByMe(a)); why {
	case "": return nil
	case "меняет только автор строки": return ErrNotAuthor
	case "поле только для чтения", "строка заблокирована фоном": return ErrFieldReadonly
	default: return ErrMatrixDenied
	}
}

func (l *Line) ChangeField(a Actor, field Field, value any) error {
	// "ДокументПодписанОригинал" is excluded from the closed-line check, as in arm/lines.go:409.
	// This preserves arm's CHECK ORDER, it is not a functional fix: the matrix denies the field
	// to every non-admin in every status (manager rights = "............cc.", "." at closed),
	// so the result is 403 matrix_denied either way. With the exception the message comes from
	// the matrix, without it from the closed guard. Verified for all 7 roles by
	// TestChangeField_SignedOriginalOnClosed.
	allowClosed := field == FieldSignedOriginal
	if err := l.guards(a, a.IfMatch, allowClosed); err != nil { return err }
	if err := l.checkField(a, field); err != nil { return err }
	set, ok := setters[field]
	if !ok { return ErrFieldReadonly }
	if err := set(l, value); err != nil { return err }
	l.recalcSums(field)
	l.Version++
	return nil
}

// recalcSums takes the changed field: formulas are applied by BRANCH, not all at once,
// exactly as in arm/lines.go:428-457.
func (l *Line) recalcSums(f Field) {
	if f == FieldQuantity || f == FieldCostPrice {
		l.CostSum = round2(l.Quantity * l.CostPrice)
	}
	if l.Operation != OpSale || l.CostPrice == 0 {
		return
	}
	switch f {
	case FieldSalePrice: // a manual price recalculates the coefficient (NOT rounded)
		l.Coeff = (l.SalePrice/l.CostPrice - 1) * 100
		l.PriceChangeType = 1
	case FieldCoeff:
		if l.Coeff != 0 {
			l.SalePrice = round2(l.CostPrice * (1 + l.Coeff/100))
			l.PriceChangeType = 2
		}
	case FieldCostPrice: // with a non-zero coefficient the price is recomputed, change_type is not
		if l.Coeff != 0 {
			l.SalePrice = round2(l.CostPrice * (1 + l.Coeff/100))
		}
	}
}
```

**Three corrections to earlier revisions of this step, all verified against the code:**

1. **`recalcSums` takes `Field`.** Revision 4 showed a parameterless `recalcSums()`. The formulas are
   branch-dependent, so the changed field is an input.
2. **`PriceChangeType` is a new `Line` field** (column `price_change_type`, fields_gen.go:50), written
   by these formulas: `1` for a manual price, `2` for a coefficient recalculation. Revision 4 did not
   mention it.
3. **The `norm_hours` claim in revision 4 was wrong.** It stated "with `norm_hours > 0` the coefficient
   is ignored" inside `recalcSums`. `arm.PatchLine` has **no** such branch: `norm_hours` affects only
   the *computed* sale sum — `Line.SaleSum()` (line.go:97-102) and the view expression at
   `0004_app.sql:115` — never the stored `sale_price`. The planned test `TestRecalcSums_NormHoursWins`
   asserted behaviour that does not exist; it is replaced by `TestRecalcSums_NormHoursIrrelevant`,
   which pins the real behaviour.

**`round2` is intentionally duplicated in this step** (`domain.round2` and `arm.round2`). Both are
pinned to the same golden values by `TestRound2_Golden` (domain) and `TestRound2_GoldenArm` (arm), so
they cannot silently diverge; Step 11 reduces this to one implementation in `money.go`.

**`RejectAssembly` gains `guards()` in this step**, not in Step 2d — see the note in Files above.

**Why the closed guard is `StatusDone`, not `IsClosedSale()` (§2.7).**

| Concept | Location | Value |
|---|---|---|
| Closed-line edit guard | `domain/line.go:111`, `arm/lines.go:409` | `StatusDone` only |
| `IsClosedSale()` | `status.go:41`, `arm/arm.go:43` | `{Отгружено, Выполнено, Завершено}` — stock concept, used only in `fifo.go:48,105,195` |

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `domain/line_test.go` | `TestChangeField_Text` | text changes, version +1 |
| | `TestChangeField_UnknownField` | `ErrFieldReadonly` |
| | `TestChangeField_WrongType` | a string into a numeric field errors instead of silently zeroing |
| | `TestChangeField_GuardsRunFirst` | on failure nothing is mutated |
| | `TestRecalcSums_CostSum` | `cost_sum = qty × cost` |
| | `TestRecalcSums_SalePriceFromCoeff` | `sale = cost × (1 + coeff/100)`, `price_change_type = 2` |
| | `TestRecalcSums_SalePriceOnCostChange` | cost change recomputes the price but not `price_change_type` |
| | `TestRecalcSums_ManualPriceSetsCoeff` | manual price sets the coefficient unrounded, `price_change_type = 1` |
| | `TestRecalcSums_ZeroCostPrice` | `cost_price = 0` is a no-op — guards against `±Inf`, since Go floats do not panic on division by zero |
| | `TestRecalcSums_PriceChangeType` | `1` for a manual price, `2` for a coefficient, unchanged otherwise |
| | `TestRecalcSums_PurchaseHasNoSaleFormula` | purchase lines are untouched by sale formulas |
| | `TestRecalcSums_NormHoursIrrelevant` | `norm_hours` does **not** affect the stored price (fixes the Rev-4 error) |
| | `TestRecalcSums_TableDriven` | **all branches** of `recalcSums`, including "no formula fires" |
| | `TestGuards_Deleted` / `_Version` / `_Locked` / `_Closed` | the four shared invariants |
| | `TestGuards_ClosedOnlyDone` | closed means `Выполнено`, **not** `IsClosedSale()` (§2.7) |
| | `TestChangeField_SignedOriginalOnClosed` | **all 7 roles** at `Выполнено` — makes the check-order note verifiable, not declarative |
| | `TestChangeField_SignedOriginalNotClosed` | the same field at `shipped` → `ErrNotAuthor` (matrix right `c`) |
| | `TestChangeField_SignedOriginalAsAdmin` | admin may sign a closed line |
| | `TestChangeField_OtherFieldOnClosed` | other fields on `Выполнено` → `ErrClosed` |
| | `TestRejectAssembly_Guards` | deleted / background-locked / stale version → refused (review §6.4) |
| | `TestRejectAssembly_OK` | role + status path still works, event raised |
| | `TestCheckField_WritableFalse` | `ОтметкаСтроки` → `ErrFieldReadonly` (watchdog on the Rev-2 error) |
| | `TestRound2_Golden` | rounding golden values — write/read parity |
| | `TestFields_Generated` / `TestFields_SetterCoverage` | registry has 67 entries; setters cover it and never name a non-registry field |
| `arm/round2_test.go` | `TestRound2_GoldenArm` | the same golden values on the arm side |
| `adapters/postgres/field_map_test.go` | `TestFieldMap_Complete` | every mapped column exists in `arm.line` (DB) |
| | `TestFieldMap_ReverseComplete` | both maps are the same length and mutually inverse (no DB) |
| `migrate/fields_parity_test.go` | `TestFieldsGenParity` | `domain/fields_gen.go` equals `arm/fields_gen.go` modulo 2 substitutions |
| | `TestFieldMapGenParity` | the postgres map matches the registry, both directions |
| | `TestGeneratedArtifactsExist` | all three generated files present |

**Database as test data.**

- No schema change. The field map is generated from `docs/migration/storage-map.json`.
- `TestFieldMap_Complete` compares the generated map with `information_schema.columns` for `arm.line`.
  It connects via `VITAUTO_DB` (default `…@127.0.0.1:5434/vitauto_app`) and skips **with a hint**
  when the database is absent. On the reference environment the database is present and the test
  ran: all 67 mapped columns exist in the real `arm.line`. `TestFieldMap_ReverseComplete` needs no
  database and always runs.
- `testdb.Open(t)` from Step 1 is **not** used here — Step 1 is not implemented yet. When it lands,
  this test switches to it.

**Watchdog approach actually used (P2).** The plan originally said "capture the current formulas in
tests against `arm.PatchLine` before moving them". A DB-backed test of `arm.PatchLine` would need the
seed stand, so the watchdog was built differently but with the same purpose:

1. **Golden rounding values on both sides.** `TestRound2_Golden` (domain) and `TestRound2_GoldenArm`
   (arm) assert the *same literal expectations*. `round2` is duplicated in this step, and either copy
   drifting breaks its own test — so the write side and the read side cannot diverge silently.
2. **Formulas transcribed with line references.** `recalcSums` is a literal port of
   `arm/lines.go:428-457`, and each branch is pinned by a named test (`_CostSum`,
   `_SalePriceFromCoeff`, `_SalePriceOnCostChange`, `_ManualPriceSetsCoeff`, `_ZeroCostIsSafe`,
   `_PurchaseHasNoSaleFormula`, `_TableDriven`).
3. **Corrections found while transcribing** (§Implementation above): the `norm_hours` branch claimed
   by revision 4 does not exist, and `price_change_type` had been omitted. Both are now pinned by
   tests asserting the real behaviour.

**Commands.**

```powershell
# L1
cd backend; go test ./internal/domain/... ./internal/adapters/... -count=1 -v
# L2
go test ./internal/arm/... ./internal/application/... -count=1
# L3
cd ..; task gen; git diff --exit-code
task lint; task test
```

**Done when.**
- Formulas are covered by a table-driven test over all branches; the rounding watchdog is green on
  **both** sides (domain and arm).
- `TestFieldsGenParity` is green: `domain/fields_gen.go` matches `arm/fields_gen.go` modulo the two
  documented substitutions, and both reproduce the generator's header.
- `TestFieldMap_Complete` is green against the real schema (67/67 columns).
- `RejectAssembly` calls `guards()` and `TestRejectAssembly_Guards` fails if that call is removed
  (verified by removing it once).
- `arm/fields_gen.go` is still generated by `migrator gen` (it must not freeze before Step 2c).
- `git diff --exit-code` shows **no new** diff beyond the pre-existing stale contract artifacts
  listed in §0.3a (`types.gen.go`, `schema.d.ts`). Revert those before committing:
  `git checkout -- backend/internal/api/types.gen.go pwa/src/http/schema.d.ts`
- No new SKIPs beyond the four pre-existing stand-dependent ones (§0.3a).

**Rollback.** Restore the previous `GenerateArmFields` target and the `Status`/`matrix.go` signatures;
delete `domain/field.go`, `domain/fields_gen.go`, `domain/line_test.go`,
`adapters/postgres/field_map_gen.go`, `arm/round2_test.go`, `migrate/fields_parity_test.go`.
`arm/fields_gen.go` is **not** deleted in this step, so it needs no restoration.

---

### Step 2b. `ChangeField` use case — no permission checks

**Goal.** Make the application layer load, call the command, save — nothing else (Q19).

**Files.**

| Action | File |
|---|---|
| create | `backend/internal/application/lines.go` |
| modify | `backend/internal/application/service.go` (`UoW`, `Clock` fields) |

**Implementation.**

```go
// ChangeField — PATCH /lines/{lineId} scenario.
// Guards and invariants live inside domain.Line.ChangeField; this function only owns
// the transaction and the 401 session check (Q19).
func (s *Service) ChangeField(ctx context.Context, a domain.Actor, lineID string, field domain.Field, value any) (*domain.Line, error) {
	if err := requireActor(a); err != nil { return nil, err }
	id, err := parseID(lineID)
	if err != nil { return nil, err }

	var out *domain.Line
	err = s.UoW.Do(ctx, a, func(ctx context.Context, r Repositories) error {
		l, err := r.Lines().GetForUpdate(ctx, id)
		if err != nil { return err }
		if err := l.ChangeField(a, field, value); err != nil { return err }
		if err := r.Lines().Save(ctx, l, a.IfMatch); err != nil { return err }
		out = l
		return nil
	})
	return out, err
}
```

**Step tests** — scenario only; permissions are tested in `domain/line_test.go`:

| File | Test | Verifies |
|---|---|---|
| `application/lines_test.go` | `TestChangeField_OK` | field changed, version +1 |
| | `TestChangeField_NotFound` | 404 |
| | `TestChangeField_NoSession` | empty `Actor` → 401 |
| | `TestChangeField_SaveConflict` | `Save` returned `ErrVersion` → 409 |

**OpenAPI update.** Not applicable — the use case is not yet wired to any route (Step 2c does that).
Run `task gen` only to confirm no diff.

**Database as test data.** Not applicable — no schema change; the use case runs against the in-memory
repository in L1 and against `testdb.Open(t)` in the contract suite from Step 1.

**Commands.**

```powershell
# L1
cd backend; go test ./internal/application/... -count=1 -v
# L2
go test ./internal/domain/... ./internal/arm/... -count=1
# L3
cd ..; task test
```

**Done when.**
- The scenario contains no permission check (`grep -c 'ErrMatrixDenied\|ErrNotAuthor' application/lines.go` = 0).
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Delete `application/lines.go` and its test.

---

### Step 2c. Switch the HTTP handler to the use case

**Goal.** Remove the duplicated checks from `arm.PatchLine`.

**Files.**

| Action | File |
|---|---|
| modify | `backend/internal/api/handlers.go` (PATCH `/lines/{lineId}` → `Apps.ChangeField`) |
| modify | `backend/internal/arm/lines.go` (delete `PatchLine`, from line 380) |
| delete | `backend/internal/arm/fields_gen.go` (moved here from Step 2a: its only consumer, `arm.PatchLine`, is deleted in this step) |
| modify | `backend/internal/arm/lines_quick_test.go` (follow the new path) |

**Implementation.** The handler calls `a.Apps.ChangeField(...)`. The matrix and closed-line checks
at arm/lines.go:395-411 are deleted — they now live in `guards`/`checkField`.

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `api/handlers_test.go` | `TestPatchLine_Forbidden` | 403 without the right |
| | `TestPatchLine_Conflict` | 409 on a foreign mark |
| | `TestPatchLine_OK` | 200, field changed |
| `arm/lines_quick_test.go` | existing tests | unchanged behaviour |

**OpenAPI update.** Operation `patch:` under `/lines/{lineId}` (openapi.yaml:409).
Expected: **no schema change** — request/response shapes are unchanged; only the implementation moves.
Confirm this explicitly: if `task gen` produces a diff, the behaviour changed and must be revisited.

Order (P3): code → L1 → L2 → L3 green → inspect `openapi.yaml` → `task gen` → `git diff --exit-code` → L3 again.

**Commands.**

```powershell
# L1
cd backend; go test ./internal/api/... -count=1 -v
# L2
go test ./internal/arm/... ./internal/application/... -count=1
# L3
cd ..; task lint; task test; task gen; git diff --exit-code
```

**Done when.**
- `arm.PatchLine` is deleted; `domain.Line.ChangeField` is invoked from production code.
- `git diff --exit-code` is empty (no unintended contract drift).
- No new SKIPs.

**Rollback.** Restore `PatchLine` from git and revert the handler call.

---

### Step 2d. `Mark`, `Strike`, `SetSelfPickup` commands, endpoint wiring

**Goal.** Close the remaining manual write paths with rules transcribed from ground truth (Q16).

**Scope change from Step 2a.** `RejectAssembly` already existed in `domain/line.go` and gained its
`guards()` call in **Step 2a** (it checked only role and status, so a deleted or background-locked
line could be rejected). What remains here: `Mark`, `Strike`, `SetSelfPickup`, plus the endpoint
wiring for all four commands. The `RejectAssembly` test rows below therefore move to Step 2a.
`Mark` needs no matrix column at all (the rule is mark ownership), and `Strike`/`SetSelfPickup`
have no matrix columns whatsoever — see the table below.

**Problem with revision 2.** It called `authorize(a, FieldMarked/FieldDeleted/FieldSelfPickup, …)`.
Matrix verification showed:

| Field | In matrix? | `writable` |
|---|---|---|
| `ОтметкаСтроки` (marked) | yes, code `А1` | **false** |
| `СтатусСтроки` (status) | yes, code `Н5` | **false** |
| `Удаление` (deleted) | **absent** in all 7 roles | — |
| `Самовывоз` (self_pickup) | **absent** in all 7 roles | — |

**Files.**

| Action | File |
|---|---|
| modify | `backend/internal/domain/line.go` (four commands) |
| modify | `backend/internal/application/lines.go` (four scenarios) |
| modify | `backend/internal/api/handlers.go` (four endpoints) |
| modify | `backend/internal/arm/lines.go` (delete inline logic) |
| modify | `backend/internal/application/access.go` (delete `SelfPickupSet`) |

**Implementation.** Each command calls `guards()` plus its own explicit rule:

```go
// Mark — the only rule: another user's mark cannot be reassigned (arm/lines.go:523-527).
func (l *Line) Mark(a Actor, on bool) error {
	if err := l.guards(a, a.IfMatch, false); err != nil { return err }
	if l.Marked && !l.MarkedByMe(a) { return ErrNotAuthor }
	l.Marked = on
	if on { mb := a.UserID; l.MarkedBy = &mb } else { l.MarkedBy = nil }
	l.Version++
	return nil
}

// Strike — administrator only (ТЗ п.15) and only from Черновик/В работе (arm/lines.go:929-947).
func (l *Line) Strike(a Actor) error {
	if err := l.guards(a, a.IfMatch, false); err != nil { return err }
	if a.Role != RoleAdmin { return ErrMatrixDenied }
	if l.Status != StatusDraft && l.Status != StatusInWork {
		return &StateError{Msg: "вычеркнуть можно только строку в статусе «Черновик» или «В работе»", Status: l.Status}
	}
	if l.MarkedBy != nil && !l.MarkedByMe(a) { return ErrNotAuthor }
	l.Deleted, l.Marked, l.MarkedBy = true, false, nil
	l.Version++
	l.raise(LineDeleted{LineID: l.ID, Actor: a.UserID})
	return nil
}

// RejectAssembly — MOVED TO STEP 2a: the command already existed and now calls guards().
// No change here; listed only to show the full command set.
// func (l *Line) RejectAssembly(a Actor, reason string) error { /* guards + role + status */ }

// SetSelfPickup — N4: status "Отгружено" only.
// WARNING: no role check — matching current code (application/access.go:173-176).
// The missing rule must be confirmed with the customer; raised as an ADR question in Step 15.
func (l *Line) SetSelfPickup(a Actor, on bool) error { /* guards + status */ }
```

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `domain/line_test.go` | `TestMark_OK` / `TestMark_ForeignMark` | marking and foreign-mark rejection |
| | `TestMark_NotAMatrixField` | `Mark` works although `ОтметкаСтроки` is `writable=false` |
| | `TestStrike_OK` / `TestStrike_NotAdmin` / `TestStrike_WrongStatus` | admin + status |
| | `TestSetSelfPickup_OK` / `_WrongStatus` | N4 |
| | `TestCommands_RaiseEvents` | each command raises its event |

**OpenAPI update.** Operations affected: `post:` `/lines/{lineId}/mark` (openapi.yaml:456),
`delete:` `/lines/{lineId}` (439), `post:` `/lines/reject-assembly` (1049),
`post:` `/lines/{lineId}/self-pickup` (1646).

Changes: document the exact error set per operation — `403 matrix_denied` (Strike by non-admin),
`409 bad_state` (wrong status), `409 not_author` (foreign mark). Today these are undocumented.

Order (P3): code → L1 → L2 → L3 green → edit `openapi.yaml` → `task gen` → `git diff --exit-code` → L3 again.
Not breaking: only error responses are documented more precisely.

**Database as test data.**

- No schema change in this step.
- `SelfPickupSet` deletion removes the last version-less production `UPDATE`
  (`application/access.go:176`, §2.4). Verify with:
  `Select-String -Path backend\internal\application\access.go -Pattern 'self_pickup'` → must be empty.
  This check is a precondition for Step 2e.
- Tests create their own lines via `repo.Seed(l)`; no shared state, no bypass flags.

**Commands.**

```powershell
# L1
cd backend; go test ./internal/domain/... ./internal/application/... ./internal/api/... -count=1 -v
# L2
go test ./internal/arm/... -count=1
# L3
cd ..; task lint; task test; task gen; git diff --exit-code
```

**Done when.**
- No manual `marked`/`deleted` writes remain in `arm` for these commands.
- `grep self_pickup application/access.go` is empty.
- `TestMark_NotAMatrixField` is green and `TestCheckField_WritableFalse` proves the Rev-2 call was broken.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Per command: restore from git and revert the handler.

---

### Step 2e. Single version write path and version guard

**Goal.** Guarantee that every `arm.line` write advances the version exactly once (A5).

**Files.**

| Action | File |
|---|---|
| verify | `backend/internal/application/access.go` (must be empty after Step 2d) |
| modify | `backend/internal/migrate/steps.go` (bypass flag during load) |
| modify | `backend/internal/teststand/stand.go:79` (bypass flag) |
| create | `db/migrations/0020_line_version_guard.sql` |
| create | `backend/internal/arm/version_guard_test.go` |

**Precondition check (NR3).** `access.go:176` was the only production path without the increment —
and Step 2d deletes it. Verify before doing anything:

```powershell
Select-String -Path backend\internal\application\access.go -Pattern 'self_pickup'
```

- **empty** → exclude `access.go` from this step; no production path lacks the increment and the
  guard acts purely as a safety net;
- **non-empty** → a second self-pickup write path exists that Step 2d missed; move it into Step 2d
  rather than patching it with a version increment.

**Implementation.**

```sql
-- 0020_line_version_guard.sql
-- Every arm.line write must advance version by exactly one.
-- Catches direct SQL writes that bypass the application (seeds, manual edits, future adapters).
create function arm.line_version_guard() returns trigger language plpgsql as $$
begin
  if current_setting('vitauto.skip_version_guard', true) = 'on' then
    return new;
  end if;
  if new.version is distinct from old.version + 1 then
    raise exception 'arm.line.version: expected %, got % (id=%)',
      old.version + 1, new.version, new.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger line_version_guard before update on arm.line
  for each row execute function arm.line_version_guard();
```

**Effect on users (R1).** The guard itself adds no new behaviour: it forbids writes that should not
happen anyway. The real behaviour change comes from Step 4, where `If-Match` becomes enforceable.
The scenario "a user read a row, a background job changed it, saving returns 409" is **correct**
optimistic-locking behaviour — before Step 4 the user's edit silently overwrote the job's work.

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `arm/version_guard_test.go` | `TestVersionGuard_RejectsDirectUpdate` | `update … set status` without version → error |
| | `TestVersionGuard_AllowsIncrement` | `version = version + 1` passes |
| | `TestVersionGuard_SkipFlag` | `skip_version_guard` disables the check |
| `application/access_test.go` | `TestSelfPickup_BumpsVersion` | version grows (through the domain, not SQL) |
| `arch/arch_test.go` | `TestNoVersionlessLineUpdate` | no production `update arm.line` without the increment or the flag |

**OpenAPI update.** Not applicable — the guard changes no wire format. It does make the `If-Match`
contract element (Step 4) meaningful, but that element is introduced in Step 4.

**Database as test data.**

- Migration `0020_line_version_guard.sql`, with a `down` that drops trigger and function.
- Verified on DB: `TestVersionGuard_*` require `testdb.Open(t)` and must not skip.
- **Bypass flags:** `migrate/steps.go:483,489` and `teststand/stand.go:79` only. Both are
  non-business paths: data transfer and test-stand reset (P4.6).
  Production code never sets `vitauto.skip_version_guard`; enforced by `TestNoVersionlessLineUpdate`.
- No backfill, so no backup/reconciliation needed.
- Run the migration `down` locally once (G6).

**Commands.**

```powershell
# L1
cd backend; go run ./cmd/migrator schema-up
go test ./internal/arm/... ./internal/application/... -count=1 -v
# L2
go test ./internal/migrate/... ./internal/adapters/... -count=1
# L3
cd ..; task test; git diff --exit-code
# rollback rehearsal
cd backend; go run ./cmd/migrator schema-down
go run ./cmd/migrator schema-up
```

**Done when.**
- The guard is enabled, maintenance paths use the flag, and no production path lacks the increment.
- `git diff --exit-code` after `task gen` is empty.
- The `down` migration was executed locally at least once.
- No new SKIPs.

**Rollback.** `drop trigger line_version_guard on arm.line; drop function arm.line_version_guard();`

---

### Step 3. Wire the status FSM into transitions

**Goal.** Make `domain.Transitions` the single source of truth for transitions (R2, Q20).

**Files.**

| Action | File |
|---|---|
| modify | `backend/internal/domain/line.go` (`TransitionTo` via `guards`) |
| modify | `backend/internal/application/lines.go` (`Transition` scenario) |
| modify | `backend/internal/api/handlers.go` (`POST /lines/transition`) |
| delete | `backend/internal/arm/matrix.go:441-461` (`Transition`, `Transitions`) |
| modify | `backend/internal/arm/lines.go:680-703` |

**Implementation.**

```go
// domain/line.go — a transition passes the same shared invariants as a field edit (R2),
// but WITHOUT the per-field matrix lookup: status is not a matrix field (Q16),
// and with allowClosed=true because the FSM explicitly allows Возврат from Выполнено (Q20).
func (l *Line) TransitionTo(a Actor, to Status, now time.Time) error {
	if err := l.guards(a, a.IfMatch, true); err != nil { return err }
	if !allowedTransition(l.Status, to, a.Role) { return ErrFSM }
	from := l.Status
	l.Status = to
	if to == StatusAssembly && l.AssemblySent == nil {
		d := dayStart(now)
		l.AssemblySent = &d
	}
	l.Version++
	l.raise(LineStatusChanged{LineID: l.ID, OrderID: l.Order, From: from, To: to, Operation: l.Operation, Actor: a.UserID})
	return nil
}
```

This gives transitions the invariants revision 2 was missing: deleted rows cannot transition,
and background-locked rows are rejected.

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `domain/line_test.go` | `TestTransition_OK` | status changes, event raised |
| | `TestTransition_WrongRole` | `storekeeper` cannot `reserve` → `ErrFSM` |
| | `TestTransition_WrongFrom` | `Отгружено` → `Резервирование` → `ErrFSM` |
| | `TestTransition_Deleted` | deleted row → `ErrDeleted` **(R2)** |
| | `TestTransition_Locked` | `ЗаблокированоФоном` → `ErrLocked` **(R2)** |
| | `TestTransition_DoneToReturnAllowed` | `Выполнено → Возврат` by manager is allowed **(Q20)** |
| | `TestTransitionsMatchModel` | Go table equals `domain-model.json` |
| `application/lines_test.go` | `TestTransition_NothingMarked` | `ErrNothingMarked` |

**OpenAPI update.** Operation `post:` `/lines/transition` (openapi.yaml:964).
Changes: add `409 conflict` for a stale version (Step 4a) and `409 fsm_denied` for an illegal
transition; `403 matrix_denied` when the role is not in the FSM row.
Order (P3): code → L1 → L2 → L3 green → `openapi.yaml` → `task gen` → `git diff --exit-code` → L3 again.
Not breaking.

**Commands.**

```powershell
# L1
cd backend; go test ./internal/domain/... ./internal/application/... ./internal/api/... -count=1 -v
# L2
go test ./internal/arm/... -count=1
# L3
cd ..; node --test "tools/migration/tests/*.test.mjs"
task lint; task test; task gen; git diff --exit-code
```

**Done when.**
- `arm.Transitions` is deleted; `TestTransitionsMatchModel` is green.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Restore `arm.Transitions` and the previous handler from git.

---

### Step 4. Optimistic locking via `If-Match`

**Goal.** Enforce the version invariant that is currently declared but never checked (Q3).

**Files.**

| Action | File |
|---|---|
| modify | `backend/internal/domain/line.go` (**no** `Actor.IfMatch` — it already exists from Step 2a; this step only consumes it) |
| modify | `backend/internal/api/handlers.go` (read the header) |
| modify | `api/openapi.yaml` (add the `If-Match` parameter) |
| modify | `pwa/src/api.js`, `pwa/src/stores/lines.js` (send the version) |
| modify | `pwa/src/views/LinesView.vue` (handle 409) |

**Current state.** `If-Match` appears **only in prose**: openapi.yaml:15 says
"changes to rows require the current version (`If-Match`, plan stage 6) — otherwise `409 conflict`".
There is no `components.parameters.IfMatch` entry (the section exists at openapi.yaml:2085 with
`CatalogKind`, `ItemId`, `DirectoryName`, `BrandId`). In Go: zero `If-Match` handling and zero
`where version = $` comparisons outside the dead `domain/line.go:105`.

**Implementation.**

```go
// domain/line.go
type Actor struct {
	UserID   uuid.UUID
	UserName string
	Login    string
	Role     Role
	IfMatch  int64 // expected row version; 0 means "do not check"
}
```

```go
// api/handlers.go
func ifMatch(r *http.Request) int64 {
	v, err := strconv.ParseInt(strings.Trim(r.Header.Get("If-Match"), `"`), 10, 64)
	if err != nil { return 0 }
	return v
}
```

`Save` already takes `expectedVersion` (Step 1) — no `loadedVersion` field in the aggregate.

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `domain/line_test.go` | `TestAuthorize_VersionMismatch` | `ErrVersion` |
| | `TestAuthorize_VersionZeroSkips` | `0` skips the check |
| `adapters/postgres/line_repo_test.go` | `TestSave_Concurrent` | two goroutines: one succeeds, the other gets `ErrVersion` |
| `api/handlers_test.go` | `TestPatchLine_IfMatchConflict` | 409 on a stale version |
| | `TestPatchLine_IfMatchMissing` | works without the header (backward compatible) |
| `pwa/test/lines-ifmatch.test.js` | `sends If-Match` | header is sent |
| | `shows 409` | message "row changed by another user" |

**OpenAPI update.** This step **adds a contract element**:

- new `components.parameters.IfMatch` (`in: header`, `required: false`, `schema: {type: integer}`,
  description "row version from GET /lines/{lineId}; stale version → 409");
- `$ref` it on `patch:` `/lines/{lineId}` (openapi.yaml:409);
- document `409 conflict` on that operation.

Order (P3): code → L1 → L2 → L3 green → **only now** edit `openapi.yaml` → `task gen` →
`git diff --exit-code` → L3 again → commit.

**Backward compatibility (P3 exception clause).** The parameter is **optional**: absent header means
"do not check". Existing clients — including the OData-driven PWA path and the 1C side — keep working
unchanged. That is the deprecation-free path; no removal step is required because nothing is removed.
The OData limitation is recorded in ADR 0006 (Step 15, Q10).

**Commands.**

```powershell
# L1
cd backend; go test ./internal/domain/... ./internal/adapters/... ./internal/api/... -count=1 -v
# L2
go test ./internal/application/... ./internal/arm/... -count=1
# L3 (before the contract edit)
cd ..; task test; git diff --exit-code
# contract, after L3 is green
task lint; task gen; git diff --exit-code
# L3 again after generation
task test
cd pwa; npx vitest run
```

**Done when.**
- Concurrent writes to one row produce 409 for the second client.
- `If-Match` is described in `components.parameters` and referenced by the operation.
- `task gen` produces no diff and `task lint` (spectral) passes.
- L3 was run both before and after contract generation.
- No new SKIPs.

**Rollback.** Remove `IfMatch` from `Actor`; drop the parameter from `openapi.yaml`; run `task gen`.

---

### Step 4a. `If-Match` for transitions, and locking for batch transitions

**Goal.** Stop `POST /lines/transition` from bypassing optimistic locking, and stop batch transitions from losing concurrent edits (R5, Q17).

**Files.**

| Action | File |
|---|---|
| modify | `backend/internal/application/lines.go` (pass `a.IfMatch`) |
| modify | `backend/internal/api/handlers.go` (`ifMatch(r)`) |
| modify | `backend/internal/adapters/postgres/line_repo.go` (`ListMarked` uses `FOR UPDATE`) |
| modify | `api/openapi.yaml` (`If-Match` on the transition operation) |

**Implementation.**

```go
// application/lines.go — only the loop; guards live in TransitionTo.
func (s *Service) Transition(ctx context.Context, a domain.Actor, to domain.Status) (int, error) {
	var n int
	err := s.UoW.Do(ctx, a, func(ctx context.Context, r Repositories) error {
		lines, err := r.Lines().ListMarked(ctx, a) // FOR UPDATE
		if err != nil { return err }
		if len(lines) == 0 { return domain.ErrNothingMarked }
		for _, l := range lines {
			if err := l.TransitionTo(a, to, s.Clock.Now()); err != nil { return err }
			if err := r.Lines().Save(ctx, l, 0); err != nil { return err }
			n++
		}
		return nil
	})
	return n, err
}
```

Single-row transitions honour `If-Match`; batch transitions pass `0` because each row has its own
version — but they are protected by `FOR UPDATE`, matching current behaviour
(arm/lines.go:722: `… marked and marked_by_id = $1 … for update`).

Without locking the failure is concrete: user A marks 20 rows, user B edits row #5, A's batch
transition overwrites B's edit.

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `domain/line_test.go` | `TestTransition_IfMatchConflict` | stale version → `ErrVersion` |
| `api/handlers_test.go` | `TestTransition_BatchIgnoresIfMatch` | batch works without the header |
| `adapters/postgres/line_repo_test.go` | `TestListMarked_LocksRows` | `FOR UPDATE` — **PostgreSQL only, never in the shared suite (NR5)** |
| | `TestTransition_BatchBlocksConcurrent` | the second transaction waits; no update is lost |

**OpenAPI update.** `$ref` `components.parameters.IfMatch` on `post:` `/lines/transition`
(openapi.yaml:964); document that batch transitions ignore the header (per-row versions) and that
rows are locked for the duration of the transaction.

Order (P3): code → L1 → L2 → L3 green → `openapi.yaml` → `task gen` → `git diff --exit-code` → L3 again.
Not breaking (parameter optional).

**Database as test data.**
- No schema change.
- `TestListMarked_LocksRows` needs two concurrent transactions → `testdb.Open(t)`; must not skip.
- `TestTransition_BatchBlocksConcurrent` creates its own rows and rolls back.

**Commands.**

```powershell
# L1
cd backend; go test ./internal/domain/... ./internal/adapters/... ./internal/api/... -count=1 -v
# L2
go test ./internal/application/... -count=1
# L3
cd ..; task lint; task test; task gen; git diff --exit-code
```

**Done when.**
- A single-row transition with a stale version returns 409.
- `ListMarked` locks rows; a concurrent batch does not lose data.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Remove the header read from the transition handler; revert `ListMarked` to a non-locking query; `task gen`.

---

### Step 5. Remove duplicated rules; seed `line_status` by migration

**Goal.** One copy of the FSM and the matrix on the backend, and a reference table owned by the schema (Q15).

**Files.**

| Action | File |
|---|---|
| delete | `backend/internal/arm/matrix.go:25-33, 401-430, 432-439, 441-461, 463-471` |
| delete | `backend/internal/arm/arm.go:20-40` (`st*` constants) |
| modify | `backend/internal/arm/*.go` (use `domain.*`) |
| modify | `Taskfile.yml` (`matrix.json` copied once, into `domain`) |
| delete | `backend/internal/arm/matrix.json` |
| create | `db/migrations/0021_line_status_seed.sql` |
| modify | `backend/internal/migrate/steps.go:490-507` (verification only) |

**Implementation.** Mechanical substitution: `stDraft` → `domain.StatusDraft`,
`denyReason(...)` → `domain.DenyReason(...)`, `Transitions` → `domain.Transitions`.
`arm.MatrixFor`/`MatrixETag` remain but delegate to the domain.

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `arm/matrix_test.go` | `TestMatrixPatchNoop` | patching the matrix does not rewrite the file |
| `domain/domain_test.go` | `TestDenyReason` | `+`/`c`/`.` rule |
| `api/parity_test.go` | existing | no routes lost |
| `arch/arch_test.go` | `TestNoDuplicateStatusConstants` | no `st*` constants left in `arm` |
| `arm/line_status_test.go` | `TestLineStatusSeeded` | 17 statuses present after migration |

**OpenAPI update.** Not applicable — `line_status` is internal reference data and is not exposed as a
schema. `GET /matrix` (openapi.yaml:103) returns the same `statuses` array as before.

**Database as test data.**
- New migration `0021_line_status_seed.sql` inserts the 17 statuses (`name`, `api_status`, `title`, `ord`)
  with `on conflict (name) do update`; `down` deletes the seeded rows.
- Previously `migrate/steps.go:490-507` populated the table — data depended on running the migrator.
  After this step the migration owns it and the Go code only verifies counts.
- `TestLineStatusSeeded` requires `VITAUTO_DB`; must not skip.

**Commands.**

```powershell
# L1
cd backend; go run ./cmd/migrator schema-up
go build ./...; go test ./internal/arm/... ./internal/domain/... -count=1
# L2
go test ./internal/api/... ./internal/migrate/... -count=1
# L3
cd ..; task gen; git diff --exit-code
task lint; task test
# rollback rehearsal
cd backend; go run ./cmd/migrator schema-down; go run ./cmd/migrator schema-up
```

**Done when.**
- `grep -r "stDraft\|arm.Transitions\|arm.denyReason" backend/` returns nothing.
- `matrix.json` exists in exactly one location.
- The `down` migration was executed locally at least once.
- No new SKIPs.

**Rollback.** Restore files from git; run the migration `down`.

---

### Step 5a. ACL between 1C and the API

**Goal.** Remove cross-language translation from the domain (Q4, §2.6).

**Files.**

| Action | File |
|---|---|
| create | `backend/internal/adapters/onec/roles.go` (`RoleByEnum`, `EnumByRole`) |
| create | `backend/internal/adapters/onec/status.go` (`StatusFromAPICode`) |
| modify | `backend/internal/domain/status.go` (`Status`, `Role`, `StatusCode`; `APICode()` stays) |
| modify | `backend/internal/domain/matrix.go` (`DenyReason` takes `Status`) |
| modify | `backend/internal/domain/domain.go` (`Transition`: `Code`, `From`, `To`, `Roles`) |
| modify | `backend/internal/platform/ws/hub.go:181`, `backend/internal/auth/auth.go` (import ACL) |

**Implementation.** The boundary is drawn by **translation direction**, not by function name:

| Function | Direction | Location | Why |
|---|---|---|---|
| `Status.APICode() StatusCode` | domain → published language | **`domain`** | the domain publishes its own identifier; the matrix is a domain policy keyed by it |
| `StatusFromAPICode(string) (Status, bool)` | external input → domain | **`adapters/onec`** | parsing an external value, ACL |
| `RoleByEnum` / `EnumByRole` | 1C enum name ↔ role | **`adapters/onec`** | a 1C enumeration name is an external language |

```go
// domain/domain.go — no mixed languages.
type Transition struct {
	Code  string   // command name in the published language: reserve, assembly, shipped, …
	From  Status   // 1C value
	To    Status   // 1C value
	Roles []Role
}
```

```go
// domain/matrix.go — typed key; no bare string escapes (R9).
type StatusCode string

func (s Status) APICode() StatusCode { /* new, in_work, ready_to_ship, … */ }

// DenyReason takes a domain Status — not a string, not an API code.
// Callers cannot accidentally pass a 1C value or an API code: the compiler forbids it.
func DenyReason(role Role, col MatrixColumn, status Status, markedByMe bool) string
```

The review's concern about the `view` does not arise: `DenyReason` is called only from
`Line.checkField` with `l.Status`. `arm.line_api` is read-only (`LineJSON`, arm/lines.go:108-115).

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `domain/status_test.go` | `TestAPICode_RoundTrip` | all 17 statuses round-trip |
| | `TestAPICode_Groups` | `Подготовлено`/`Собран` → `ready_to_ship` |
| `domain/matrix_test.go` | `TestDenyReason_Signature` | takes `Status`, not `string` **(R9)** |
| `adapters/onec/status_test.go` | `TestStatusFromAPICode` | external code → `Status` |
| `adapters/onec/roles_test.go` | `TestRoleByEnum` | 7 roles |
| `domain/domain_test.go` | `TestTransitionsMatchModel` | table equals `domain-model.json` |
| `arch/arch_test.go` | `TestDomainHasNoOnecVocabulary` | no `Менеджер`/`Кладовщик` in `domain` |

**OpenAPI update.** Not applicable — this step moves translation code, it does not change any status
code or field name on the wire. `Status.APICode()` values are asserted unchanged by
`TestAPICode_RoundTrip`.

**Database as test data.** Not applicable — no schema change; the translation is pure functions.

**Commands.**

```powershell
# L1
cd backend; go test ./internal/adapters/onec/... ./internal/domain/... -count=1 -v
# L2
go test ./internal/api/... ./internal/auth/... ./internal/platform/... -count=1
# L3
cd ..; task arch; task test; git diff --exit-code
```

**Done when.**
- `domain` contains no 1C role names; `Transitions` does not mix languages.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Restore `RoleByEnum`/`APICode` into the domain from git.

---

### Step 6. Correct the dependency direction

**Goal.** `application` and `auth` no longer depend on `arm`.

**Files.**

| Action | File |
|---|---|
| create | `backend/internal/platform/problem/problem.go` |
| modify | `backend/internal/application/*.go` (drop `arm.ImportRow`) |
| modify | `backend/internal/auth/auth.go` (`arm.Problem` → `problem.Problem`) |
| modify | `backend/internal/api/handlers.go` (single `writeProblem`) |
| delete | `backend/internal/arm/arm.go:58-83` |

**Implementation.**

```go
// platform/problem/problem.go
type Problem struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
}

func (p *Problem) Error() string { return p.Message }
func New(status int, code, msg string, field ...string) error { /* … */ }
func From(err error) *Problem { /* domain errors; infrastructure errors added in Step 13a */ }
```

`application.ImportRow` becomes an application-owned type (currently `arm.ImportRow`,
application/impex.go:23, 93).

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `platform/problem/problem_test.go` | `TestFrom_DomainErrors` | table: 404 / 409 / 403 / 409 / 403 / 409 |
| `arch/arch_test.go` | `TestApplicationDoesNotImportArm` | import graph |
| | `TestAuthDoesNotImportArm` | import graph |
| `application/impex_test.go` | existing | sheet parser unchanged |

**OpenAPI update.** Not applicable — the error **code table is preserved**, only its location moves
(`application.AsProblem` → `platform/problem.From`). Status codes and `code` values are asserted
identical by `TestFrom_DomainErrors`. Infrastructure errors gain mappings only in Step 13a.

**Database as test data.** Not applicable — no schema change.

**Commands.**

```powershell
# L1
cd backend; go build ./...; go test ./internal/platform/... ./internal/application/... ./internal/auth/... -count=1 -v
# L2
go test ./internal/api/... ./internal/arm/... -count=1
# L3
cd ..; task test; git diff --exit-code
```

**Done when.**
- `go list -deps ./internal/application` and `./internal/auth` contain no `internal/arm`.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Restore `arm.Problem` and the previous imports.

---

### Step 7. Architecture tests and CI

**Goal.** Make architecture violations break the build.

**Files.**

| Action | File |
|---|---|
| modify | `backend/internal/arch/arch_test.go` (replace the placeholder) |
| modify | `.github/workflows/ci.yml` |
| modify | `docs/migration/gates/stage-4.md` |

**Implementation.** No external dependency — `go/parser` + `go/ast`.

```go
func TestDomainIsPure(t *testing.T)                 // no internal imports, no pgx/net/http
func TestApplicationHasNoSQL(t *testing.T)          // regexp over ../application/*.go
func TestNoFloatMoney(t *testing.T)                 // monetary fields of Line
func TestFileSize(t *testing.T)                     // ≤ 400 lines
func TestNoDuplicateStatusConstants(t *testing.T)
func TestApplicationDoesNotImportArm(t *testing.T)
func TestAuthDoesNotImportArm(t *testing.T)
func TestDomainHasNoOnecVocabulary(t *testing.T)
func TestNoVersionlessLineUpdate(t *testing.T)      // Step 2e
func TestContextDependencies(t *testing.T)          // no cyclic context deps
```

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `arch/arch_test.go` | `TestArchTestsCatchViolation` | an injected `import "github.com/jackc/pgx/v5"` in `domain` fails the run |

**Commands.**

```powershell
# L1
cd backend; go test ./internal/arch/... -count=1 -v
# L3
cd ..; task arch; task lint; task test; task gen; git diff --exit-code
```

**Done when.**
- `task arch` runs in CI and an intentional violation breaks the build.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Remove the checks; restore the placeholder.

---

### Step 8. Application layer without SQL

**Goal.** `internal/application` contains no SQL and never writes `arm.line` directly.

**Files.**

| Action | File |
|---|---|
| modify | `backend/internal/application/returns.go` (50-53, 64-79, 190) |
| modify | `backend/internal/application/access.go` (166, 176) |
| modify | `backend/internal/application/placement.go` (84, 112) |
| modify | `backend/internal/application/workshop.go` (160) |
| create | `backend/internal/domain/return.go` (`ReturnRequest` aggregate) |
| create | `backend/internal/adapters/postgres/return_repo.go` |

**Implementation.** Every scenario: load aggregate → command → save → events.
`update arm.line set status = 'Возврат'` (returns.go:190) becomes
`l.TransitionTo(a, StatusReturn, s.Clock.Now())`.

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `application/returns_test.go` | `TestReturnCreate_OK` | header + lines, totals |
| | `TestReturnCreate_EmptyLines` | 400 |
| | `TestReturnPost_TransitionsLines` | lines move to `Возврат` through the FSM |
| | `TestReturnPost_AlreadyPosted` | 409 |
| `application/access_test.go` | `TestSelfPickup_OnlyShipped` | 409 |
| | `TestSelfPickup_SetsFlag` | through the aggregate |
| `application/placement_test.go` | `TestPlaceCell_OK` / `TestPlaceCell_WrongWarehouse` | K2 |
| `arch/arch_test.go` | `TestApplicationHasNoSQL` | zero SQL |

**OpenAPI update.** Operations `post:` `/returns`, `/returns/{returnId}/post`,
`post:` `/lines/{lineId}/cell`, `post:` `/lines/{lineId}/self-pickup`.
Changes: document `409 bad_state` where the FSM now rejects a transition that previously bypassed it.
Order (P3): code → L1 → L2 → L3 green → `openapi.yaml` → `task gen` → `git diff --exit-code` → L3 again.

**Database as test data.**
- No schema change. `doc.return_order` already exists (0006_returns.sql).
- Tests create returns in their own transaction and roll back; `cleanTx(t, pool)`.
- Repository contract tests run against `testdb.Open(t)` and must not skip.

**Commands.**

```powershell
# L1
cd backend; go test ./internal/application/... ./internal/adapters/... -count=1 -v
# L2
go test ./internal/api/... ./internal/arm/... -count=1
# L3
cd ..; task arch; task lint; task test; task gen; git diff --exit-code
```

**Done when.**
- `TestApplicationHasNoSQL` is green.
- Scenarios are covered both without a DB (in-memory) and with a DB (contract tests).
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Per scenario: restore SQL from git.

---

### Step 9. Domain events and policies

**Goal.** Notification policies execute in Go, inside the same transaction (Q1, Q18).

**Files.**

| Action | File |
|---|---|
| modify | `backend/internal/domain/line.go` (`ClearEvents`) |
| create | `backend/internal/application/dispatch.go` (`EventDispatcher`) |
| create | `backend/internal/application/policies.go` |
| create | `backend/internal/domain/notice.go` (`Notice` aggregate) |
| create | `backend/internal/adapters/postgres/notice_repo.go` |
| modify | `backend/internal/application/lines.go` (publish after `Save`) |
| create | `db/migrations/0022_notice_dedup.sql` |
| create | `db/migrations/0023_drop_line_status_notice.sql` |

**Implementation.**

```go
// domain/line.go — mandatory clearing, otherwise a second Dispatch duplicates notices.
func (l *Line) ClearEvents() []Event {
	ev := l.events
	l.events = nil
	return ev
}
```

```go
// application/dispatch.go — dispatching is an application concern, not a domain one (A4).
func (d *EventDispatcher) Dispatch(ctx context.Context, r Repositories, events []domain.Event) error {
	for _, e := range events {
		for _, h := range d.handlers[reflect.TypeOf(e)] {
			if err := h.Handle(ctx, r, e); err != nil { return err }
		}
	}
	return nil
}
```

**Dispatch must be inside `UoW.Do`, after `Save` (R4).** Outside the transaction the sequence is:
`Save` committed → policy failed → no notice → the user retries → duplicate notice.

```go
err = s.UoW.Do(ctx, a, func(ctx context.Context, r Repositories) error {
	l, err := r.Lines().GetForUpdate(ctx, id)
	if err != nil { return err }
	if err := l.ChangeField(a, field, value); err != nil { return err }
	if err := r.Lines().Save(ctx, l, a.IfMatch); err != nil { return err }
	// here, not after UoW.Do: a failing policy rolls the change back
	return s.Dispatcher.Dispatch(ctx, r, l.ClearEvents())
})
```

**Race-safe deduplication via advisory lock (Q18/R7).** `arm.notice_add` is read-then-write
(0005_notify.sql:31-44); under a race two INSERTs duplicate. Revision 3 proposed `dedup_key` with a
unique index and `on conflict`, which raises two problems: `create unique index` fails on existing
duplicates, and `do update set text = …` overwrites instead of accumulating. The lock removes both:

```sql
-- 0022_notice_dedup.sql
-- Serializes deduplication per "node | role | order | day".
-- The advisory lock is taken BEFORE the read, so "read → not found → insert" stops being a race.
-- The pattern already exists in this project: application/service.go:128, arm/arm.go:280.
create or replace function arm.notice_add(p_node text, p_kind text, p_role text, l arm.line, p_note text)
returns void language plpgsql as $$
begin
  if l.customer_order_id is not null then
    perform pg_advisory_xact_lock(hashtext(
      p_node || '|' || p_role || '|' || l.customer_order_id::text || '|' || current_date::text));
  end if;
  -- existing body unchanged (0005_notify.sql:22-45): find today's unread notice,
  -- append text if absent, otherwise INSERT
end $$;
```

**Why the lock is guarded by `customer_order_id is not null`.** Deduplication applies only to
order-bound notices: the dedup `SELECT` already sits inside the `if l.customer_order_id is not null`
branch (0005_notify.sql:24-35), so a notice with no order is never merged and always inserts a new
row. The lock mirrors that exact condition — taking a lock for a key that is never used for
deduplication would serialise unrelated inserts for no benefit.

| Review problem | How it is removed |
|---|---|
| Index fails on existing duplicates | No index is created; no data cleanup required |
| `on conflict` overwrites text | Append semantics preserved: `position(v_line in v_text) = 0` → `text \|\| '; ' \|\| v_line` (0005_notify.sql:36-40) |
| Duplicates already in production | They remain, but no new ones appear. Cleanup is a separate task, not a blocker |
| Race between parallel notices | Two transactions with the same key run sequentially |

The advisory lock also protects the **trigger** path: `line_status_notice` still calls `notice_add`
until the end of this step, so no duplicates appear even during the transition when both the trigger
and the Go policy write.

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `domain/line_test.go` | `TestClearEvents_Empties` | a second call returns nothing |
| `application/dispatch_test.go` | `TestDispatch_RoutesByType` | handler receives its event |
| | `TestDispatch_NoHandler` | an event without a handler does not fail |
| `application/policies_test.go` | `TestPolicy_GoodsPlaced` | M8 to the manager |
| | `TestPolicy_AssemblyRejected` | M10 with reason |
| | `TestPolicy_SelfPickup` | M17 and K9 together |
| | `TestPolicy_Dedup` | one unread per node+role+order |
| | `TestPolicy_DedupConcurrent` | two parallel transactions → one notice **(R7)** |
| | `TestPolicy_SameTransaction` | a failing policy rolls the change back **(R4)** |

**OpenAPI update.** No contract change: notices remain readable via `GET /notifications`
(openapi.yaml:1120) with the same shape. Re-run `task gen` only to confirm no diff.

**Database as test data.**
- Migrations `0022_notice_dedup.sql` (function replacement) and `0023_drop_line_status_notice.sql`
  (drop trigger + function), both with `down`.
- `TestPolicy_DedupConcurrent` needs two real transactions → `testdb.Open(t)`, must not skip.
- The `down` migration restores the trigger, returning behaviour to the current state.
- Run both `down` migrations locally once (G6).

**Commands.**

```powershell
# L1
cd backend; go run ./cmd/migrator schema-up
go test ./internal/domain/... ./internal/application/... -count=1 -v
# L2
go test ./internal/adapters/... ./internal/arm/... -count=1
# L3
cd ..; task test; task gen; git diff --exit-code
# rollback rehearsal
cd backend; go run ./cmd/migrator schema-down; go run ./cmd/migrator schema-up
```

**Done when.**
- Every event in `events.go` has a handler; notices are created from Go.
- The `line_status_notice` trigger is dropped by migration.
- `git diff --exit-code` after `task gen` is empty.
- Both `down` migrations were executed locally.
- No new SKIPs.

**Rollback.** Run `0023` and `0022` down per migration; delete `dispatch.go`, `policies.go`.

---

### Step 9a. `PartialOrder` rule into the domain

**Goal.** Move the procurement-coverage invariant into the domain while the trigger remains a guard (Q7).

**Files.**

| Action | File |
|---|---|
| create | `backend/internal/domain/partial_order.go` |
| modify | `backend/internal/application/lines.go` (call after a purchase change) |
| move | `backend/internal/arm/partial_ordered_test.go` → `backend/internal/application/partial_order_test.go` |

**Implementation.**

```go
// domain/partial_order.go — pure function, no DB.
// Coverage = sum of quantities of linked purchases in "Заказано" and later statuses.
func (l *Line) RecalculatePartialOrder(coverage float64) {
	if l.Operation != OpSale || l.Batch != nil { return }
	switch {
	case coverage <= 1e-9:
		if l.Status == StatusPartiallyOrdered { l.Status = StatusInWork }
	case coverage+1e-9 < l.Quantity:
		l.Status = StatusPartiallyOrdered
	case l.Status == StatusPartiallyOrdered:
		l.Status = StatusOrdered
	}
}
```

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `application/partial_order_test.go` | `TestPartialOrder_ZeroCoverage` | `ЧастичноЗаказано` → `ВРаботе` |
| | `TestPartialOrder_Partial` | → `ЧастичноЗаказано` |
| | `TestPartialOrder_Full` | `ЧастичноЗаказано` → `Заказано` |
| | `TestPartialOrder_PurchaseIgnored` | a purchase line is not changed |
| | `TestPartialOrder_BatchedIgnored` | a line with a batch is not changed |
| | `TestPartialOrder_TableDriven` | table from the rule comment in 0015_partially_ordered.sql:8-13 |

**Database as test data.**
- No schema change in this step. The trigger `arm.line_partial_ordered`
  (0015_partially_ordered.sql:94) **stays** as the guard until Step 10a, because it catches writes
  that bypass the application (seeds, migration, manual edits).
- `TestPartialOrder_*` are pure unit tests — no DB required.
- The existing `TestPartialOrderedTrigger` (arm/partial_ordered_test.go) keeps running until Step 10a
  and requires `VITAUTO_SO_DSN`; it must not skip.

**Commands.**

```powershell
# L1
cd backend; go test ./internal/domain/... ./internal/application/... -count=1 -v
# L2
go test ./internal/arm/... -count=1
# L3
cd ..; task test; git diff --exit-code
```

**Done when.**
- The rule is covered by a table-driven test.
- The trigger still works; both paths agree on all table cases.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Delete `partial_order.go` and its test.

---

### Step 10. Split `arm` by bounded contexts

**Goal.** Remove the god package.

**Files.** One context per commit, starting with `lines`:

| Context | From `arm` | To |
|---|---|---|
| lines | `lines.go`, `reserve.go`, `fifo.go` | `internal/lines/` |
| procurement | `supplier_order.go`, `supply.go`, `supply_options.go` | `internal/procurement/` |
| warehouse | `docs.go` (receipt/transfer) | `internal/warehouse/` |
| shipping | `docs.go` (shipment), `print.go` | `internal/shipping/` |
| catalog | `catalog.go`, `brands.go`, `attachments.go` | `internal/catalog/` |
| access | `matrix.go`, `settings.go` | `internal/access/` |
| notifications | `notices.go` | `internal/notifications/` |
| — | `directories.go`, `jobs.go`, `extra_fields.go` | by ownership |

**Implementation.** Inside each context: `domain/`, `app/`, `adapters/`.
Rule: a context writes only its own tables (01-strategic.md:38-41).

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| moved tests | existing tests travel with the code | behaviour preserved |
| `arch/arch_test.go` | `TestFileSize` | ≤ 400 lines per file |
| | `TestContextDependencies` | no cyclic context dependencies |

**OpenAPI update.** No contract change — pure code movement. Run `task gen` and confirm no diff;
**any** diff here means the move changed behaviour and must be investigated.

**Database as test data.**
- No schema change.
- `matrix.json` file access (arm/matrix.go:59-80) moves to `internal/access/adapters`;
  `TestMatrixPatchNoop` uses a temp copy so the real `matrix.json` is never mutated by tests.

**Commands.**

```powershell
# L1 (after each context)
cd backend; go build ./...; go test ./internal/<context>/... -count=1 -v
# L2
go test ./... -count=1
# L3
cd ..; task arch; task test; task gen; git diff --exit-code
```

**Done when.**
- `internal/arm` is gone; `TestFileSize` is green.
- All tests moved and passing.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Per context: restore files from git.

---

### Step 10a. Split `arm.line` by aggregates

**Goal.** Remove the god table (Q14). High risk — dedicated branch, backup first.

**Files.**

| Action | File |
|---|---|
| create | `db/migrations/0024_line_split.sql` |
| create | `db/migrations/0025_line_split_backfill.sql` |
| create | `db/migrations/0026_drop_partial_ordered_trigger.sql` |
| modify | `backend/internal/adapters/postgres/line_repo.go` |
| modify | view `arm.line_api` reassembly |

**Strategy: dual-write, not big bang (R6).** Rollback "through the view" is impossible: the view
stores only current state and **does not restore `version`** — after the split, versions in the new
tables and the old `arm.line` diverge and a view-based rollback would return wrong values.
Hence three phases:

| Phase | Write | Read | Rollback |
|---|---|---|---|
| 1. Dual-write | old `arm.line` **and** new tables (one transaction) | old | trivial: disable the new write |
| 2. Read switch | both | new (view assembles from new) | disable reading from new |
| 3. Retire old | new only | new | — |

**Backfill window.** The load runs under an advisory lock with application writes stopped
(`set default_transaction_read_only` on the application pool, or a maintenance window). Without this,
concurrent writes during a two-hour load diverge.

**Implementation.**
1. New per-aggregate tables: `doc.customer_order_line`, `doc.supplier_order_line`,
   `arm.line` (working area only: mark, status, lock, version).
2. Backfill preserving `id` (15 foreign keys stay intact).
3. View `arm.line_api` reassembles the row — the REST contract is unchanged.
4. The version guard from Step 2e moves to the new working-area table.

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `migrate/line_split_test.go` | `TestLineSplit_Backfill` | row counts, checksums and **`version`** match before/after |
| | `TestLineSplit_DualWrite` | phase 1: both schemas written, values agree |
| | `TestLineSplit_ViewParity` | the view returns the same **values**, not just the same fields |
| | `TestLineSplit_ViewParityNulls` | 16 LEFT JOINs: NULL cases produce the same result **(R6)** |
| | `TestLineSplit_ForeignKeys` | all 15 foreign keys survive |
| | `TestLineSplit_ReadSwitch` | phase 2: new reads return the same response as old |
| | `TestLineSplit_ReconcileR5` | stock reconciliation |

**OpenAPI update.** No contract change: `arm.line_api` keeps the same field set and values.
This is exactly what `TestLineSplit_ViewParity` proves. Run `task gen`; a diff is a failure.

**Database as test data.**
- Three migrations, each with a `down`.
- **Backfill is a separate migration** (`0025`) with: full backup before phase 1, advisory-lock
  window, reconciliation afterwards.
- Tests create and delete their own rows; the split is verified on a disposable stand.
- After phase 3, rollback is only from the full backup.

**Reconciliation checks: which are affected.** The gates run four check groups —
`reconcile --checks R1,R2,R3,R4,R7` (gate.ps1:167) and `--checks R5,R6,R8` (gate.ps1:172), plus `UUID`
and `COMMENTS` (gate.ps1:168-169). Stating the impact explicitly rather than assuming:

| Check | Definition (verified) | Affected? | Why |
|---|---|---|---|
| **R1** | 1C object record counts = `legacy.object` (reconcile.go:151) | **No** | Compares the 1C source with the archive table. `arm.line` is not involved |
| **R2** | Typed-table record counts = 1C source per storage-map (reconcile.go:185) | **No** | Compares row **counts**, not columns. The split preserves exactly one `arm.line` row per 1C record, so the count is unchanged. Verifying this is `TestLineSplit_Backfill` |
| **R3** | Archive record hash rebuilt from the 1C source = `legacy.object.hash` (reconcile.go:223) | **No** | Rebuilds archive hashes from the 1C source. `arm.line` is not involved |
| **R4** | Foreign keys valid; composite references (`<field>_type` + `<field>_id`) resolve (reconcile.go:266) | **Yes — must stay green** | The 15 FKs and composite references move with their columns. Guarded by `TestLineSplit_ForeignKeys`; re-run `reconcile --checks R4` after phase 1 |
| **R5** | Stock balances = 1C `Запасы` register movements (reconcile.go:424) | **Yes** | The split relocates `cell_id`/`warehouse_id`, which feed `stock.balance`. Re-run |
| **R6** | Per document: rows, quantity and sum of 1C tabular sections = `vitauto_app` (reconcile.go:508) | **No** | Compares 1C tabular sections with `doc.*` document tables. `arm.line` is not involved |
| **R7** | Every 1C field = an `arm.line` column (reconcile.go:578) | **Yes — requires a code change** | `reconcile.go:592` executes `select onec_record_id, to_jsonb(l)::text from arm.line l`. After the split `arm.line` no longer holds every column, so R7 would fail with mass field mismatches. R7 must read the reassembled `arm.line_api` view instead. **This is a code change inside Step 10a, not a follow-up** |
| **R8** | 50 documents and 50 references: 1C (COM) representation = `vitauto_app` (r8.go:19-22) | **No** | Compares 1C COM representations of documents and references, not ARM lines |
| **UUID** | 1C object id = `Ref_Key` (reconcile.go:336) | **No** | Identifier mapping, unrelated to the column split |
| **COMMENTS** | Comment on every column (reconcile.go:384) | **Yes** | Every new column in the split tables needs `COMMENT ON COLUMN`, otherwise gate G2.4 fails |

Note the asymmetry: `task gate STAGE=2` verifies that checks **run and pass**, but it does not itself
protect row data. Data protection for this step rests on `TestLineSplit_*`, and R7 requires the code
change above before the gate can pass at all.

**Commands.**

```powershell
# L1
cd backend; go run ./cmd/migrator schema-up
go test ./internal/adapters/... ./internal/migrate/... -count=1 -v
# L2
go test ./internal/lines/... ./internal/application/... -count=1
# L3
cd ..; task test; task gen; git diff --exit-code
task gate STAGE=2
```

**Done when.**
- Phase 3 complete; `arm.line` holds working-area fields only, the view assembles the full row.
- Row counts, checksums and versions match; R5 reconciliation is green.
- The `partial_ordered_sync` trigger is dropped (its rule now lives in the domain, Step 9a).
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Phases 1–2: disable the dual-write/read flag. After phase 3: restore from the full
backup taken before phase 1.

---

### Step 11. Value objects instead of `float64`

**Goal.** Exact money arithmetic and a single rounding function.

**Files.**

| Action | File |
|---|---|
| create | `backend/internal/domain/money.go` (`Money`, `Quantity`, `LinkKey`) |
| modify | `backend/internal/domain/line.go` (fields → `Money`) |
| modify | `backend/internal/domain/domain.go` (`SaleSum`) |
| delete | `backend/internal/arm/arm.go:299-304` (`round2`) |
| delete | `backend/internal/application/service.go:119-124` (`round2`) |

**Implementation.**

```go
// Money — an amount in minor units. No float (02-tactical.md:68).
type Money int64

func (m Money) Rub() float64   { return float64(m) / 100 }
func (m Money) String() string { return fmt.Sprintf("%d.%02d", m/100, m%100) }
func (m Money) MulQty(q Quantity) Money { /* banker's rounding */ }

// Quantity — amount with a unit of measure.
type Quantity struct {
	Value  float64
	UnitID *uuid.UUID
}
```

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `domain/money_test.go` | `TestMoney_AddSub` | exact arithmetic |
| | `TestMoney_MulQty` | rounding |
| | `TestMoney_NoFloatDrift` | 0.1 + 0.2 = 0.3 |
| | `TestMoney_JSON` | serialisation to rubles |
| `domain/line_test.go` | `TestSaleSum_Money` | the formula on `Money` |
| `arch/arch_test.go` | `TestNoFloatMoney` | no `float64` in monetary fields |

**OpenAPI update (material).** `Money` serialises as a number in rubles, so the wire format does not
change — but the **precision** does: `sale_price numeric(15,1)` and `cost_sum numeric(15,2)`.
Verify that the OpenAPI schemas for `Line.saleSum`, `costSum`, `salePrice` state the same precision
(step 11a proves value parity). Order (P3): code → L1 → L2 → L3 green → `openapi.yaml` (if precision
documentation is added) → `task gen` → `git diff --exit-code` → L3 again.

**Database as test data.** No schema change in this step. SQL stays `numeric` — only the Go side changes.

**Commands.**

```powershell
# L1
cd backend; go test ./internal/domain/... -count=1 -v
# L2
go test ./internal/application/... ./internal/adapters/... -count=1
# L3
cd ..; task arch; task test; task gen; git diff --exit-code
```

**Done when.**
- `TestNoFloatMoney` is green; `round2` exists in exactly one place.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Restore `float64` fields (the change is confined to the domain).

---

### Step 11a. Read/write parity: Go ↔ SQL ↔ PWA

**Goal.** Prevent write-side and read-side divergence (Q5, §2.3).

**Files.**

| Action | File |
|---|---|
| create | `backend/internal/domain/parity_test.go` |
| create | `db/queries/line_api_parity.sql` |
| create | `pwa/test/parity.test.js` |

**Implementation.** The view computes **four** derived values (R11):

| Field | SQL | Go | PWA |
|---|---|---|---|
| `saleSum` | 0004_app.sql:115 / 0019:41 | `Line.SaleSum()` | `domain/pricing.js` |
| `status` (API code) | `coalesce(s.api_status, l.status)` (0004:123, 88) | `Status.APICode()` | — |
| `locked` | `l.status = 'ЗаблокированоФоном'` (0004:88) | `Line.Locked()` | — |
| `operation` | `Закупка` → `purchase` (0004:88) | `Line.Operation` | `mapping.js` |

The case table runs through all three implementations; divergence in any field fails the test.
This matters especially after Step 10a, where the view is reassembled from new tables.

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `domain/parity_test.go` | `TestSaleSumParity_GoVsSQL` | Go equals SQL on 20 cases |
| | `TestSaleSumParity_GoVsPWA` | Go equals JS on the same cases |
| | `TestStatusParity_GoVsSQL` | API status code |
| | `TestLockedParity_GoVsSQL` | lock flag |
| | `TestOperationParity_GoVsSQL` | `Продажа`/`Закупка` → `sales`/`purchases` |
| | `TestParity_EdgeCases` | 0, negative, `norm_hours = 0`, NULL |

**OpenAPI update.** No contract change: the parity test proves the contract keeps describing reality.
Run `task gen`; a diff is a failure.

**Database as test data.**
- No schema change.
- `TestSaleSumParity_GoVsSQL` runs the SQL expression against `testdb.Open(t)`; must not skip.
- The case table is stored once (`db/queries/line_api_parity.sql`) and read by both the Go and JS tests
  so the three implementations cannot drift onto different inputs.

**Commands.**

```powershell
# L1
cd backend; go test ./internal/domain/... -count=1 -v
# L2
go test ./internal/adapters/... -count=1
# L3
cd ..; task test; cd pwa; npx vitest run; cd ..; git diff --exit-code
```

**Done when.**
- All three implementations agree on the shared case table.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Delete the tests (they change no production code).

---

### Step 12. Remaining aggregates

**Goal.** The aggregates from 02-tactical.md:48-62 exist as types with invariants.

**Files.** `backend/internal/domain/<aggregate>.go` plus `_test.go` for each.

**Implementation.** Order by rule readiness:

1. `Notice` — deduplication (0005_notify.sql:13-46)
2. `AccessRequest` — M13→A3
3. `ReturnRequest` — "customer return only after shipment"
4. `StockMove` — "stock never goes negative" (arm/fifo.go:recalcStock)
5. `SupplierOrder`, `CustomerOrder`, `Nomenclature`, `PricePolicy`, `Receipt`, `Transfer`, `Shipment`, `MatrixPolicy`

**`OutboxMessage` is not implemented as a domain aggregate** (Q6, §2.1): it is an infrastructure
entity. Step 15 reclassifies its model row and documents its invariants.

**Step tests.** Per aggregate: invariant (positive and negative case), command, event.

| File | Test | Verifies |
|---|---|---|
| `domain/notice_test.go` | `TestNotice_Dedup` | one unread per node+role+order+day |
| `domain/access_request_test.go` | `TestAccessRequest_Decide` | only admin, single decision |
| `domain/return_test.go` | `TestReturn_RequiresShipped` | invariant |
| `domain/stock_move_test.go` | `TestStockMove_NeverNegative` | invariant |

**OpenAPI update.** Only if an aggregate introduces a new error code that reaches the API
(for example `409 bad_state` for a violated invariant). Order (P3) applies as usual.

**Database as test data.**
- No new migrations: all tables already exist (0006, 0007, 0008, 0009, 0004_app).
- Each aggregate gets a repository contract test in `linerepotest`-style, run against
  `testdb.Open(t)`; must not skip.

**Commands.**

```powershell
# L1
cd backend; go test ./internal/domain/... -count=1 -v
# L2
go test ./internal/application/... ./internal/adapters/... -count=1
# L3
cd ..; task arch; task test; git diff --exit-code
```

**Done when.**
- Every aggregate from the model table (except `OutboxMessage`) has a type, commands and invariant tests.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Per aggregate.

---

### Step 12a. Policy and WS contract parity

**Goal.** Force agreement between emitting policies and the WS contract (Q13, §2.2).

**Files.**

| Action | File |
|---|---|
| create | `backend/internal/application/policies_parity_test.go` |
| modify | `backend/internal/api/parity_test.go` |

**Implementation.** The test reads `api/asyncapi.yaml`, extracts the `Notice.topic` enum
(asyncapi.yaml:118) and compares it with the nodes the policies return
(`M8, M9, M10, M11, K9, M17, A3`). Additionally, each `Change.e` entity (asyncapi.yaml:93) must be
produced by a trigger in `db/migrations/0011_ws_changes.sql`.

Domain events are **not** added to `asyncapi.yaml` (§2.2): the contract describes the external
surface, and internal events must not leak across the context boundary.

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `application/policies_parity_test.go` | `TestNoticeTopicsMatchPolicies` | policy nodes ⊆ `Notice.topic` |
| `api/parity_test.go` | `TestChangeEntitiesMatchTriggers` | `Change.e` ⊆ triggers in 0011 |
| | `TestAsyncAPILint` | spectral passes |

**OpenAPI update.** `asyncapi.yaml` is intentionally **not** modified. `task lint` must still pass.

**Commands.**

```powershell
# L1
cd backend; go test ./internal/application/... ./internal/api/... -count=1 -v
# L2
go test ./internal/platform/... -count=1
# L3
cd ..; task lint; task test; git diff --exit-code
```

**Done when.**
- Divergence between policies and the WS contract breaks the build.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Delete the tests.

---

### Step 13.0. Audit handlers for dynamic responses

**Goal.** Validate the 12 h estimate for Step 13 before starting it (R12).

**Files.**

| Action | File |
|---|---|
| create | `docs/architecture/handler-audit.md` |

**Implementation.**

```powershell
cd backend
Select-String -Path internal\api\handlers*.go -Pattern 'reply\(w, \d+, (map\[string\]any|.*RawMessage)' |
  ForEach-Object { "$($_.Filename):$($_.LineNumber): $($_.Line.Trim())" }
```

Produce a table: handler → response type → manual mapping needed. Known dynamic responses today:
`handlers_v2.go:125, 142, 164, 199`; `handlers.go:47`.

**Step tests.** None — an investigation step. Its output is the estimate.

**Commands.**

```powershell
# L3
task test; git diff --exit-code
```

**Done when.**
- The table is complete.
- If dynamic responses exceed ~10, or any handler returns a different shape conditionally, Step 13 is
  split into two PRs (read / write) and the estimate is revised upward (up to ≈355 h total).
- No new SKIPs.

**Rollback.** Not required.

---

### Step 13. Contract enforcement: strict-server

**Goal.** Handlers implement a generated interface; responses are typed.

**Files.**

| Action | File |
|---|---|
| modify | `backend/internal/api/oapi-codegen.yaml` (`strict-server: true`) |
| modify | `backend/internal/api/handlers*.go` |
| modify | `pwa/src/http/schema.d.ts` (import the types) |

**Implementation.**

```yaml
generate:
  models: true
  strict-server: true
  std-http-server: true
```

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `api/contract_test.go` | `TestHandlersImplementContract` | the interface compiles as implemented |
| | `TestResponsesMatchSchema` | responses validate against the schema |
| `api/parity_test.go` | existing | no routes lost |

**OpenAPI update.** The contract is the **input** here, not the output. Order (P3) still holds:
code → L1 → L2 → L3 green → (no `openapi.yaml` edit) → `task gen` → `git diff --exit-code` → L3 again.
If generation changes `types.gen.go` incompatibly, that reveals a pre-existing contract/code
divergence that must be fixed in code, never by bending the contract.

**Commands.**

```powershell
# L1
cd backend; go build ./...; go test ./internal/api/... -count=1 -v
# L2
go test ./internal/application/... ./internal/domain/... -count=1
# L3
cd ..; task gen; git diff --exit-code
task lint; task test
```

**Done when.**
- `types.gen.go` contains a server interface and handlers implement it.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Revert `oapi-codegen.yaml` to `models: true`; restore handlers.

---

### Step 13a. `problem.From` for infrastructure errors

**Goal.** Map `pgx` and context errors to `problem+json` instead of a bare 500.

**Files.**

| Action | File |
|---|---|
| modify | `backend/internal/platform/problem/problem.go` |
| modify | `backend/internal/platform/problem/problem_test.go` |

**Implementation.**

```go
func From(err error) *Problem {
	// domain errors as in Step 6, then:
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return &Problem{Status: 404, Code: "not_found", Message: "Запись не найдена"}
	case errors.Is(err, pgx.ErrTxClosed), errors.Is(err, context.Canceled):
		return &Problem{Status: 503, Code: "unavailable", Message: "Операция прервана"}
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return &Problem{Status: 409, Code: "conflict", Message: "Запись уже существует"}
		case "23503":
			return &Problem{Status: 409, Code: "conflict", Message: "Ссылка на несуществующую запись"}
		case "23514":
			return &Problem{Status: 409, Code: "bad_state", Message: pgErr.Message}
		}
	}
	return &Problem{Status: 500, Code: "server_error", Message: err.Error()}
}
```

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `problem_test.go` | `TestFrom_InfrastructureErrors` | table: `ErrNoRows`→404, `ErrTxClosed`→503, `23505`→409, `23503`→409, `23514`→409 |
| | `TestFrom_UnknownError` | 500 |

**OpenAPI update.** `503 unavailable` becomes a documented response for operations touching the
database; `409 conflict` gains the unique/FK/check violation cases.
Order (P3): code → L1 → L2 → L3 green → `openapi.yaml` → `task gen` → `git diff --exit-code` → L3 again.
Not breaking (additional documented responses).

**Commands.**

```powershell
# L1
cd backend; go test ./internal/platform/problem/... -count=1 -v
# L2
go test ./internal/api/... -count=1
# L3
cd ..; task lint; task test; task gen; git diff --exit-code
```

**Done when.**
- Infrastructure errors are mapped and covered by a table-driven test.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Remove the added branches.

---

### Step 14. Client domain layer

**Goal.** Move business rules out of views and adapters.

**Files.**

| Action | File |
|---|---|
| create | `pwa/src/domain/pricing.js` (from `odata/mapping.js:72, 174-189`) |
| create | `pwa/src/domain/access.js` (from `stores/matrix.js:26-34`) |
| create | `pwa/src/domain/transitions.js` (from `views/LinesView.vue:528-550`) |
| create | `pwa/src/domain/validation.js` (VIN, price, supplier-order fields) |
| modify | `pwa/src/api.js` (inject the transport) |
| modify | `pwa/src/views/ImportView.vue:63` (remove raw `fetch`) |
| modify | `pwa/src/views/LinesView.vue` (split into components) |

**Implementation.**

```js
// pwa/src/domain/pricing.js
export function salePrice(cost, coeff) { return cost * (1 + coeff / 100); }
export function saleSum({ normHours, quantity, salePrice }) {
  return (normHours > 0 ? normHours : quantity) * salePrice;
}
```

```js
// pwa/src/api.js — transport as a parameter
export function createApi(transport) {
  return async function api(method, path, opts = {}) { /* … */ };
}
```

**Step tests.** New tests must not require a live 1C:

| File | Test | Verifies |
|---|---|---|
| `pwa/test/domain-pricing.test.js` | `salePrice`, `saleSum` | formulas, edge cases |
| `pwa/test/domain-access.test.js` | `denyReason` | `+`/`c`/`.` |
| `pwa/test/domain-transitions.test.js` | `allowed` | transition table |
| `pwa/test/domain-validation.test.js` | VIN, price | rules |
| `pwa/test/api-transport.test.js` | `createApi` | mock transport, no network |

**OpenAPI update.** No contract change. `pwa/src/http/schema.d.ts` (4 135 lines, currently imported
nowhere) starts being imported for the typed `api` calls — confirm `task gen` produces no diff.

**Database as test data.** Not applicable — the client has no database. Tests use a mock transport
instead of the live OData stand, which is what removes the `ODATA_URL` dependency for unit tests.

**Commands.**

```powershell
# L1
cd pwa; npx vitest run
# L3
cd ..; task test; git diff --exit-code
```

**Done when.**
- New tests pass without a live 1C.
- `LinesView.vue` is under 400 lines.
- `grep -r "fetch(" pwa/src` matches only `api.js` and `odata/client.js`.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Per file.

---

### Step 15. Documentation and ADRs

**Goal.** Fix architectural decisions in writing and align the model with reality.

**Files.**

| Action | File |
|---|---|
| modify | `docs/migration/ddd/02-tactical.md` (port signatures) |
| modify | `docs/migration/ddd/02-tactical.md` (new "Infrastructure patterns" section, R13) |
| create | `docs/adr/0001-postgres-as-store.md` |
| create | `docs/adr/0002-no-sqlc.md` |
| create | `docs/adr/0003-outbox-pattern.md` |
| create | `docs/adr/0004-signal-websocket.md` |
| create | `docs/adr/0005-matrix-hot-reload.md` |
| create | `docs/adr/0006-ifmatch-rest-only.md` (Q10) |
| create | `docs/adr/0007-self-pickup-no-role-check.md` (open rule from Step 2d) |
| create | `docs/adr/0008-closed-line-vs-fsm.md` (Q20 conflict) |
| modify | `docs/TODO.md` (reconcile 208/276 vs 224/264 h) |
| modify | `todo.md` (mark completed items) |

**Implementation.** `OutboxMessage` is not merely reclassified (R13) — its invariants are recorded,
otherwise they vanish from the model while remaining real:

- idempotency by `entity_id` (resend is safe);
- at-least-once delivery, drained under `FOR UPDATE SKIP LOCKED` (integration/outbox.go:96-138);
- statuses `new` → `sent` / `dead`, with `attempts` and `error`;
- written **in the same transaction** as the change (arm/docs.go:31).

The model table row links to this section.

**Step tests.**

| File | Test | Verifies |
|---|---|---|
| `tools/migration/tests/ddd.test.mjs` | `TestADRsExist` | every ADR referenced by a decision exists |
| | `TestInfrastructurePatternsPresent` | the section exists and names 4 invariants |

**OpenAPI update.** Not applicable — documentation only. `openapi.yaml` and `asyncapi.yaml` are
unchanged; `task lint` confirms they still validate.

**Database as test data.** Not applicable — no migration, no seed, no data change.

**Commands.**

```powershell
# L1
node --test "tools/migration/tests/*.test.mjs"
# L3
task test; git diff --exit-code
```

**Done when.**
- Documentation tests are green; ADRs exist; `todo.md` is updated.
- `git diff --exit-code` after `task gen` is empty.
- No new SKIPs.

**Rollback.** Not required.

---

## 5. Summary table

| Step | Name | Phase | Est. | Key test |
|---|---|---|---|---|
| 0.1 | Baseline measurement | Prep | 0.5 h | — |
| 0.2 | `task arch` entry point | Prep | 0.5 h | — |
| 0.3 | `internal/arch` skeleton | Prep | 0.5 h | `TestPlaceholder` |
| 1 | Repository ports, UoW, test DB | A | 20 h | `linerepotest.Run` |
| 1a | `Clock`, `IDGenerator` ports | A | 4 h | `TestFixedClock` |
| 2a | Fields, formulas, `guards`+`checkField` | A | 14 h | `TestGuards_ClosedOnlyDone` |
| 2b | `ChangeField` use case | A | 6 h | `TestChangeField_OK` |
| 2c | Switch the HTTP handler | A | 6 h | `TestPatchLine_OK` |
| 2d | `Mark`/`Strike`/`RejectAssembly`/`SetSelfPickup` | A | 6 h | `TestMark_NotAMatrixField` |
| 2e | Version guard | A | 4 h | `TestVersionGuard_RejectsDirectUpdate` |
| 3 | FSM into transitions | A | 8 h | `TestTransition_Locked` |
| 4 | `If-Match` | A | 10 h | `TestSave_Concurrent` |
| 4a | `If-Match` for transitions, batch locking | A | 4 h | `TestListMarked_LocksRows` |
| 5 | Remove duplicates, seed `line_status` | A | 8 h | `TestNoDuplicateStatusConstants` |
| 5a | 1C ↔ API ACL | A | 6 h | `TestDenyReason_Signature` |
| 6 | Dependency direction | A | 8 h | `TestApplicationDoesNotImportArm` |
| 7 | Architecture tests in CI | B | 8 h | `TestDomainIsPure` |
| 8 | Application layer without SQL | C | 24 h | `TestApplicationHasNoSQL` |
| 9 | Events and policies, race-safe dedup | C | 20 h | `TestPolicy_DedupConcurrent` |
| 9a | `PartialOrder` into the domain | C | 8 h | `TestPartialOrder_TableDriven` |
| 10 | Split `arm` by contexts | C | 40 h | `TestFileSize` |
| 10a | Split `arm.line` by aggregates | C | 24 h | `TestLineSplit_Backfill` |
| 11 | Value objects | D | 16 h | `TestNoFloatMoney` |
| 11a | Parity Go ↔ SQL ↔ PWA | D | 6 h | `TestSaleSumParity_GoVsSQL` |
| 12 | Remaining aggregates | D | 40 h | `TestStockMove_NeverNegative` |
| 12a | Policy/WS parity | D | 3 h | `TestNoticeTopicsMatchPolicies` |
| 13.0 | Handler audit | D | 2 h | audit table |
| 13 | strict-server | D | 12 h\* | `TestHandlersImplementContract` |
| 13a | Infrastructure error mapping | D | 4 h | `TestFrom_InfrastructureErrors` |
| 14 | Client domain layer | E | 24 h | `domain-*.test.js` |
| 15 | Documentation and ADRs | E | 8 h | `TestADRsExist` |

\* Revised by Step 13.0; the total becomes up to ≈355 h if many dynamic responses are found.

**Total: ≈345 h** (up to ≈355 h).
Phase A — 104 h; B — 8 h; C — 116 h; D — 83 h; E — 32 h; Prep — 1.5 h.

---

## 6. Final acceptance

### 6.1 Full run

```powershell
$env:VITAUTO_DB     = "postgres://postgres:postgres@127.0.0.1:5434/vitauto_app"
$env:VITAUTO_SO_DSN = "postgres://postgres:postgres@127.0.0.1:5432/vitauto_so_stand"
$env:ODATA_URL      = "http://127.0.0.1:8090/odata215/odata/standard.odata"

task lint
task arch
task test
task gen
git diff --exit-code
task gate STAGE=1
```

### 6.2 Skip check

```powershell
cd backend
go test ./... -count=1 -v 2>&1 | Select-String '^\s*--- SKIP'
```

Expected: empty.

### 6.3 Criteria checklist

| # | Criterion | Test / command |
|---|---|---|
| 1 | `domain` imports no internal packages; `application` imports neither `arm` nor `pgx` | `TestDomainIsPure`, `TestApplicationDoesNotImportArm` |
| 2 | No SQL in `application`; no `float64` money in `domain` | `TestApplicationHasNoSQL`, `TestNoFloatMoney` |
| 3 | Aggregates are invoked from production code | `grep -r "domain.Line" backend/internal --include=*.go` outside `domain/` |
| 4 | FSM and matrix exist in one copy | `TestNoDuplicateStatusConstants` |
| 5 | Every event has a handler | `TestAllEventsHandled` |
| 6 | `arm` is gone; files under 400 lines | `TestFileSize`, `ls backend/internal/arm` |
| 7 | Architecture checks run in CI | `.github/workflows/ci.yml` |
| 8 | `types.gen.go` contains the server interface | `grep "StrictServerInterface" types.gen.go` |
| 9 | `If-Match` is enforced | `TestSave_Concurrent`, `TestTransition_IfMatchConflict` |
| 10 | `arm.line.status` is constrained | `\d arm.line` in psql |
| 11 | `arm.line` is split by aggregates | `TestLineSplit_Backfill` |
| 12 | `saleSum` agrees across Go, SQL, PWA | `TestSaleSumParity_*` |
| 13 | Policies and the WS contract agree | `TestNoticeTopicsMatchPolicies` |
| 14 | Infrastructure errors are mapped | `TestFrom_InfrastructureErrors` |
| 15 | Transitions pass the same shared invariants as field edits | `TestTransition_Deleted`, `TestTransition_Locked` |
| 16 | Commands without a matrix field work | `TestMark_NotAMatrixField`, `TestStrike_OK`, `TestSetSelfPickup_OK` |
| 17 | Batch transitions lose no concurrent edits | `TestListMarked_LocksRows` |
| 18 | Notice deduplication is race-safe | `TestPolicy_DedupConcurrent` |
| 19 | `DenyReason` takes a domain `Status` | `TestDenyReason_Signature` (compilation) |
| 20 | Signing a closed line works | `TestChangeField_SignedOriginalOnClosed` |
| 21 | No production `arm.line` write lacks a version increment | `TestNoVersionlessLineUpdate` |
| 22 | Fake UoW really rolls back | `TestFakeUoW_RollsBack` |

### 6.4 Final commit message

```
arch: hexagonal architecture and DDD — completion (plan.md steps 1–15)

- domain wired into the production path (ports, UoW, Clock, aggregates)
- FSM and matrix duplication removed; 1C ACL extracted from the domain
- policies moved from DB triggers into event handlers
- arm split by bounded contexts; arm.line split by aggregates
- saleSum parity (Go/SQL/PWA) and policy/WS parity
- architecture checks enforced in CI
```

---

## 7. Appendices

### 7.1 Step test template (Go, no DB)

```go
func TestChangeField_MatrixDenied(t *testing.T) {
	repo := fakes.NewLineRepo()
	l := domain.NewLineForTest(domain.StatusDraft)
	repo.Seed(l)
	svc := application.NewService(fakes.NewUoW(repo), clock.Fixed{T: time.Unix(0, 0)})

	_, err := svc.ChangeField(context.Background(),
		domain.Actor{UserID: uuid.New(), Role: domain.RoleStorekeeper},
		l.ID.String(), domain.FieldSalePrice, domain.Money(10000))

	if p := problem.From(err); p.Status != 403 {
		t.Fatalf("expected 403, got %d (%v)", p.Status, err)
	}
}
```

### 7.2 Repository contract test template

```go
func TestPostgresLineRepo(t *testing.T) {
	pool := testdb.Open(t) // TESTCONTAINERS=1 | VITAUTO_DB | explicit failure with a hint
	linerepotest.Run(t, func(t *testing.T) domain.LineRepository {
		return postgres.NewLineRepo(cleanTx(t, pool))
	})
}
```

### 7.3 Architecture test template

```go
func TestDomainIsPure(t *testing.T) {
	for _, imp := range imports(t, "../domain") {
		if strings.HasPrefix(imp, "vitauto/backend/internal/") {
			t.Errorf("domain imports an internal package: %s", imp)
		}
	}
}
```

### 7.4 Commands by level

| Level | Command |
|---|---|
| L1 | `cd backend && go test ./internal/<package>/... -count=1 -v` |
| L2 | `cd backend && go test ./internal/<neighbors>/... -count=1` |
| L3 | `task lint && task arch && task test && task gen && git diff --exit-code` |
| Skip check | `cd backend && go test ./... -count=1 -v 2>&1 \| Select-String '--- SKIP'` |
| Gate | `task gate STAGE=1` |

### 7.5 Risks and controls

| Risk | Control |
|---|---|
| Two sources of truth during transition | Parity test per switched endpoint; version guard (Step 2e) |
| "Green run" with skipped tests | §0.3: inspect SKIPs; mandatory DB for `domain`/`application`/`adapters` steps |
| Transitions skipping shared invariants (R2) | `TransitionTo` calls `guards()`; `TestTransition_Deleted`, `_Locked`, `_DoneToReturnAllowed` |
| Wrong matrix key for commands (R3) | `guards()` + an explicit rule per command; `TestMark_NotAMatrixField`, `TestCheckField_WritableFalse` |
| Policy outside the transaction (R4) | `Dispatch` inside `UoW.Do`; `TestPolicy_SameTransaction` asserts rollback |
| Lost update in batch transitions (R5) | `ListMarked` uses `FOR UPDATE`; `TestListMarked_LocksRows`, `TestTransition_BatchBlocksConcurrent` |
| Rollback after `arm.line` split (R6) | Three-phase dual-write; after phase 3 rollback only from backup; NULL parity cases |
| Notice deduplication race (R7) | `pg_advisory_xact_lock` before the read; existing append semantics kept; `TestPolicy_DedupConcurrent` |
| Step 2d/2e overlap (NR3) | Step 2e starts with `grep self_pickup access.go`; the file is excluded when empty |
| Locking tested on a fake (NR5) | `ListMarked_LocksRows` only in `adapters/postgres`; the shared suite states why |
| False rollback in fake UoW (NR6) | `fakeUoW` snapshots and restores; `TestFakeUoW_RollsBack` |
| CI/local DB divergence (R8) | One PostgreSQL version (`postgres:18`) everywhere; `testdb` skips with a hint, never crashes |
| Dropping a trigger breaks out-of-band writes | `partial_ordered_sync` is dropped only in Step 10a, after the write path is closed |
| `strict-server` underestimated (R12) | Step 13.0 audits handlers before committing to 12 h |
| OData mode in PWA | Do not touch `pwa/src/odata/backend.js`; `If-Match` is REST-only (ADR 0006) |
| Scope competing with the functional roadmap | Every new scenario is written through ports from the start |

### 7.6 What not to do

- **Do not rewrite `docs/migration/ddd/*`.** The model is well developed — the problem is the code.
- **Do not break the generators.** `extract-domain.mjs` / `ddd-gen.mjs` and model tests are a strength;
  extend them (Steps 7, 12a, 15), do not replace them.
- **Do not start with the frontend.** Client duplication follows from the missing server-side source
  of truth.
- **Do not add domain events to `asyncapi.yaml`.** The contract describes the external surface (§2.2).
- **Do not port `arm.line_api` to Go.** The view stays the query side (Q5).
- **Do not widen the closed-line guard to `IsClosedSale()`.** It is a stock concept, not an edit rule (§2.7).
- **Do not remove the `If-Match` backward-compatibility path.** The parameter stays optional —
  a required header would break 1C and OData clients mid-migration (Step 4).
- **Do not put `skip_version_guard` in production code.** Migration and test-stand paths only (P4.6).
- **Do not estimate Step 13 before Step 13.0.** An estimate without an audit is 2–3× too low.
