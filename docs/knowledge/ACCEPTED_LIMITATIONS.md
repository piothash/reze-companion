# Accepted Limitations — Expanded Reference

**Status:** Authoritative expansion of the shorthand identifiers
(`T-1..T-6`, `F-5`, `F-6`) referenced by the Phase 7 certification
(`FINAL_PRODUCTION_AUDIT.md`, `FINAL_DEPLOYMENT_CHECKLIST.md`,
`CHANGELOG.md`).

This document replaces the shorthand tags with full, self-contained
descriptions. Each item states impact against the four production
dimensions the operator cares about: **Trading**, **PnL / Accounting**,
**Standing Limit Orders**, and **LIVE trading**.

Source certifications:
- Phase 3 technical-debt review — `docs/knowledge/PHASE3_FINAL_CERTIFICATION.md`
- Phase 6A investigation — `docs/knowledge/PHASE6_INVESTIGATION.md`
- Phase 6B implementation — `docs/knowledge/PHASE6_IMPLEMENTATION.md`

Legend for the impact rows: **None** = no observable effect;
**Indirect** = affects surrounding tooling but not the execution path;
**Direct** = execution path is affected.

---

## 1. No dedicated "kill-mid-write" database regression test  *(formerly T-1)*

- **Title:** Absence of a bespoke SIGKILL-during-write regression test for the SQLite ledger.
- **Description:** The engine serialises all writes through the queue in
  `reference/p4/lib/v2/engine/db.ts` and runs SQLite in WAL mode, which
  guarantees atomic commit / rollback on crash via WAL replay. The
  repository does not carry a dedicated Vitest that force-kills the
  process between a `BEGIN` and `COMMIT` and then re-opens the DB.
- **Why accepted:** WAL crash-safety is a SQLite invariant, not a P4
  invariant. A test that killed the process would exercise SQLite's own
  code path, not ours, and would fail flakily under CI. The engine-level
  guarantee (serialised writer + WAL) is already covered by the recovery
  tests in `reference/p4/tests/`.
- **Production impact:** None observable. WAL replay handles unclean
  shutdown; the write queue prevents interleaved writers.
- **Severity:** LOW.
- **Affects Trading:** No.
- **Affects PnL / Accounting:** No — WAL guarantees atomic ledger commit.
- **Affects Standing Limit Orders:** No.
- **Affects LIVE trading:** No.
- **Recommended future fix:** Add a Node child-process harness that
  spawns the engine, injects a synthetic fill, sends `SIGKILL` between
  the ledger `OPEN` and settlement rows, then re-opens the DB and
  asserts the accounting invariant holds. Track under a new `T-1-followup`
  ticket if a regression is ever suspected in this area.

---

## 2. `.env.example` and `.env.template` coexist  *(formerly T-2)*

- **Title:** Two environment reference files ship in the repository
  without a machine-checked diff.
- **Description:** Both `reference/p4/.env.example` and
  `reference/p4/.env.template` are present. They are enumerated in
  `PHASE0_COMPLETION_REPORT.md`, but nothing in CI verifies they stay in
  sync.
- **Why accepted:** Operator-facing only. The deployment runbook
  (`OPERATOR_RUNTIME_CHECKLIST.md`) tells the operator which file to
  copy. Consolidating them is a cosmetic cleanup, not a correctness fix.
- **Production impact:** Onboarding friction only.
- **Severity:** LOW (cosmetic).
- **Affects Trading:** No.
- **Affects PnL / Accounting:** No.
- **Affects Standing Limit Orders:** No.
- **Affects LIVE trading:** No.
- **Recommended future fix:** Delete `.env.template`, keep
  `.env.example` as the single source of truth, and add a CI check that
  fails if a new required key in `config.ts` is missing from
  `.env.example`.

---

## 3. External alerting (PagerDuty / Slack webhook) not wired  *(formerly T-3)*

- **Title:** No first-class PagerDuty / Slack alert adapter; alerting
  relies on Telegram + `scripts/soak-monitor.sh`.
- **Description:** The engine emits CRITICAL rows to `order_log` and the
  operator scripts (`scripts/soak-monitor.sh`, `scripts/monitor-15m.sh`)
  can page via Telegram. No adapter exists that fans these out to
  PagerDuty or a Slack webhook.
- **Why accepted:** Adding a new alerting channel is a feature, not
  debt. The existing Telegram path is exercised in production; the
  console + `order_log` provide the compliance trail.
- **Production impact:** Slower operator notification for
  Telegram-outage scenarios only.
- **Severity:** LOW.
- **Affects Trading:** No — alerting is out-of-band.
- **Affects PnL / Accounting:** No.
- **Affects Standing Limit Orders:** No.
- **Affects LIVE trading:** Indirect — an outage would still be detected
  by the dashboard `startup-error-panel` and CRITICAL log rows.
- **Recommended future fix:** Add a `notifier/webhook.ts` adapter that
  reads `ALERT_WEBHOOK_URL` from env and posts CRITICAL rows as JSON.
  Keep Telegram as the default.

---

## 4. Live executor retry-ladder magic numbers inline  *(formerly T-4)*

- **Title:** Retry delays and jitter values in the live executor are
  inline literals rather than named constants.
- **Description:** `reference/p4/lib/v2/engine/execution/live.ts`
  contains the retry ladder (base delay, jitter, max attempts) as
  numeric literals. They match production tuning and are documented in
  `docs/knowledge/05-execution.md`.
- **Why accepted:** Extracting constants without a tuning need is
  speculative. Values are correct, documented, and covered by the paper
  executor chaos tests.
- **Production impact:** None.
- **Severity:** LOW (cosmetic).
- **Affects Trading:** No.
- **Affects PnL / Accounting:** No.
- **Affects Standing Limit Orders:** No.
- **Affects LIVE trading:** No — values are the ones exercised in
  production.
- **Recommended future fix:** When a real tuning change lands, extract
  the ladder into `execution/retry-config.ts` with named exports and add
  a Vitest that asserts the shape.

---

## 5. Operator scripts lack `--help` and Vitest coverage  *(formerly T-5)*

- **Title:** `scripts/*.sh` operator tools do not expose `--help` and
  are not covered by Vitest.
- **Description:** The read-only diagnostic and monitor scripts under
  `reference/p4/scripts/` are usable but self-documenting only via the
  runbooks in `docs/knowledge/_appendix/operator-runbooks.md`.
- **Why accepted:** They are read-only and non-destructive. Adding
  Vitest coverage for shell scripts is low value.
- **Production impact:** None on the engine; minor operator UX.
- **Severity:** LOW (cosmetic).
- **Affects Trading:** No.
- **Affects PnL / Accounting:** No.
- **Affects Standing Limit Orders:** No.
- **Affects LIVE trading:** No.
- **Recommended future fix:** Add a `--help` block to each script that
  prints the corresponding runbook section, and a smoke test that runs
  each script with `--help` and asserts exit code 0.

---

## 6. OpenTelemetry env keys absent from `.env.example`  *(formerly T-6)*

- **Title:** The optional OTEL exporter env variables are not listed in
  `.env.example`.
- **Description:** `reference/p4/instrumentation.ts` reads
  `OTEL_EXPORTER_*` variables when present. They are omitted from
  `.env.example` because the exporter is off by default.
- **Why accepted:** Env-gated feature; enabling it is an explicit
  operator action documented in `RUNTIME_INSTRUMENTATION.md`.
- **Production impact:** None unless the operator wants to enable OTEL.
- **Severity:** LOW (cosmetic / documentation).
- **Affects Trading:** No.
- **Affects PnL / Accounting:** No.
- **Affects Standing Limit Orders:** No.
- **Affects LIVE trading:** No.
- **Recommended future fix:** Add a commented `# OTEL_EXPORTER_OTLP_ENDPOINT=`
  block at the bottom of `.env.example` referencing
  `RUNTIME_INSTRUMENTATION.md`.

---

## 7. First `AccountSync.refresh("start", true)` runs synchronously at ignition  *(formerly F-5)*

- **Title:** The initial account-sync call fires inline during engine
  ignition instead of being deferred to the next tick.
- **Description:** `reference/p4/lib/v2/engine/engine.ts` invokes
  `AccountSync.refresh("start", true)` on the same tick as the first
  CLOB subscription. Under network jitter this contributes to the
  ignition-time HTTP burst.
- **Why accepted:** Phase 6B (F-1..F-4) already added backoff and
  credential prechecks that eliminate the failure mode; the remaining
  burst is a performance polish, not a correctness issue, and no
  runtime signal indicates it is a problem.
- **Production impact:** Slight (sub-second) ignition latency at engine
  start. Steady-state behaviour is unaffected.
- **Severity:** LOW (performance polish).
- **Affects Trading:** No — trading has not yet started at this point.
- **Affects PnL / Accounting:** No.
- **Affects Standing Limit Orders:** No — SLO evaluation starts after
  ignition.
- **Affects LIVE trading:** Indirect — only the ignition window; steady
  state is unaffected.
- **Recommended future fix:** Wrap the first `refresh("start", true)`
  in `queueMicrotask(...)` or defer it until the first CLOB book
  snapshot arrives, so it does not contend with subscription setup.

---

## 8. `syncLiveBalance()` runs as a separate CLOB call at ignition  *(formerly F-6)*

- **Title:** `syncLiveBalance()` issues a redundant CLOB request at
  engine start that could be folded into the first `AccountSync` pass.
- **Description:** `engine.ts` calls `syncLiveBalance()` at ignition in
  addition to the first `AccountSync.refresh`. Both fetches touch the
  same upstream data.
- **Why accepted:** The redundant call is measured in tens of
  milliseconds and only fires once per engine start. Same rationale as
  item 7 — no runtime signal shows it hurts.
- **Production impact:** One extra CLOB request per engine ignition.
- **Severity:** LOW (performance polish).
- **Affects Trading:** No.
- **Affects PnL / Accounting:** No — the number reconciled is the same
  either way.
- **Affects Standing Limit Orders:** No.
- **Affects LIVE trading:** Indirect — ignition window only.
- **Recommended future fix:** Extend `AccountSync.refresh` to return
  the balance snapshot and remove the standalone `syncLiveBalance()`
  call from `engine.ts` ignition, keeping it available as a manual
  operator command.

---

## Summary matrix

| # | Short name (deprecated) | Severity | Trading | PnL | SLO | LIVE |
|---|--------------------------|----------|---------|-----|-----|------|
| 1 | Kill-mid-write DB test (T-1)               | LOW | No | No | No | No |
| 2 | `.env.example` / `.env.template` (T-2)     | LOW | No | No | No | No |
| 3 | External alerting adapter (T-3)            | LOW | No | No | No | Indirect |
| 4 | Retry-ladder magic numbers (T-4)           | LOW | No | No | No | No |
| 5 | Operator script `--help` / tests (T-5)     | LOW | No | No | No | No |
| 6 | OTEL keys in `.env.example` (T-6)          | LOW | No | No | No | No |
| 7 | Deferred first account-sync (F-5)          | LOW | No | No | No | Indirect (ignition) |
| 8 | Fold `syncLiveBalance` into sync (F-6)     | LOW | No | No | No | Indirect (ignition) |

**No accepted limitation affects Trading correctness, PnL correctness,
Standing Limit Order semantics, or steady-state LIVE trading behaviour.**
Items 3, 7, and 8 have indirect ignition-window or out-of-band effects
only.
