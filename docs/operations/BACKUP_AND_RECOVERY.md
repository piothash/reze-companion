# ARC — Backup & Recovery

**Scope:** ARC Companion control plane (Supabase-backed) and the VPS trading
authority it observes. The VPS remains the sole trading authority; nothing in
this document authorises the companion to resume, replay, or place trades.

---

## 1. What must be backed up

| Asset | Location | Criticality | Owner |
| --- | --- | --- | --- |
| Canonical event log | `platform_events` | **Critical** — replay source of truth | Supabase |
| Ledger records | `ledger_records` | **Critical** — financial record | Supabase |
| Configuration versions | `configuration_versions` | **Critical** — immutable config history | Supabase |
| Runtime configuration state | `runtime_configuration_state` | High | Supabase |
| Authority registry | `authority_registry`, `engine_endpoints` | High | Supabase |
| Audit trail | `audit_log` | High — compliance | Supabase |
| Ownership record | `operator_ownership`, `user_roles` | **Critical** — access control | Supabase |
| Analytics summaries | `analytics_summaries` | Medium — derivable by replay | Supabase |
| Engine snapshots | `engine_snapshots` | Medium | Supabase |
| VPS engine SQLite state | VPS filesystem | **Critical** | VPS operator |
| VPS `.env` / signing keys | VPS filesystem (never in git) | **Critical** | VPS operator |
| PM2 process definition | VPS `ecosystem.config.*` | Medium | VPS operator |

**Never backed up into this repository:** `*.db`, `*.db-wal`, `*.db-shm`,
`*.sqlite*`, real `.env` values, wallet keys, exchange credentials. These are
excluded by the project charter and by `.gitignore`.

---

## 2. Backup schedule

| Asset | Frequency | Retention | Method |
| --- | --- | --- | --- |
| Supabase database | Daily automated | 7 days rolling | Managed backend snapshot |
| Supabase database | Weekly manual export | 90 days | `pg_dump` to encrypted offsite storage |
| VPS engine SQLite | Hourly | 48 hours | Filesystem snapshot with the engine quiesced or via SQLite online backup |
| VPS engine SQLite | Daily | 30 days | Offsite encrypted copy |
| VPS secrets | On change only | Indefinite | Password manager / secret vault — never on disk unencrypted |
| PM2 definition | On change only | Indefinite | Version-controlled in the VPS deployment repo |

**Rule:** never copy a live SQLite file with `cp` while the engine is writing.
Use the SQLite online backup API or stop the process first — a torn copy
restores as a corrupt database and is worse than no backup.

---

## 3. Recovery objectives

| Scenario | RPO (max data loss) | RTO (max downtime) |
| --- | --- | --- |
| VPS process crash (PM2 restart) | 0 | < 1 minute (automatic) |
| VPS host loss | 1 hour | < 4 hours |
| Supabase data corruption | 24 hours | < 2 hours |
| Full control-plane loss | 24 hours | < 4 hours |
| Signing key compromise | 0 | < 30 minutes (revoke immediately) |

---

## 4. Recovery procedures

### 4.1 VPS process crash

PM2 restarts the engine automatically. Recovery is complete when the companion
shows the authority as `ACTIVE` and the startup chain fully `PASS` on
`/operations`.

1. Confirm PM2 reports the process online.
2. Watch `/operations` → Authority. Heartbeat age must fall back under the
   stale deadline.
3. Watch `/operations` → Startup Chain. All steps must reach `PASS`.
4. Check `/operations` → Configuration. State must return to `ACTIVE` with no
   drift.
5. If `registrationCount` increased, that is the expected PM2 restart signal —
   not an incident.

**Do not** re-publish configuration to "kick" a stuck engine. Publishing
creates a new immutable version and obscures the fault.

### 4.2 VPS host loss

1. Provision a replacement host and deploy the engine per
   `docs/deployment/`.
2. Restore the latest verified SQLite backup **before** first start.
3. Restore secrets from the vault. Do not reuse a key that was on a
   compromised host.
4. Start under PM2 with the engine in a non-trading mode if the deployment
   supports it, and confirm registration and heartbeat in the companion first.
5. Verify `/deployment` reaches `READY TO DEPLOY` before enabling trading.
6. Run `/qualification` and confirm the replay gate is deterministic against
   the restored event history.

### 4.3 Supabase data corruption or loss

1. Stop configuration publishing. The engine keeps running on its last
   activated configuration; the control plane being down does not stop trading
   and must not be used as an emergency stop.
2. Restore the most recent good database snapshot.
3. Re-run the migrations if the restore predates a schema change.
4. Verify integrity in this order:
   - `operator_ownership` — exactly one owner, finalization flag intact.
   - `configuration_versions` — version numbers contiguous, hashes intact.
   - `platform_events` — sequence numbers strictly increasing with no gaps.
   - `ledger_records` — record count and realized PnL match the pre-incident
     figures.
5. Confirm the engine re-registers and heartbeats.
6. Confirm `/operations` reports no configuration drift. If it reports
   `DRIFTED`, the restore predates the active runtime configuration —
   re-publish the exact active configuration, do not edit it.

### 4.4 Event sequence regression

A decreasing event sequence means the engine restarted from stale state or a
restore rolled the history back.

1. Treat as **critical**. Do not publish configuration.
2. Identify the last known good sequence from `platform_events`.
3. Determine whether the VPS or the control plane regressed. The VPS is
   authoritative for sequence.
4. If the VPS regressed, restore the correct engine state and restart.
5. If the control plane regressed, re-sync from VPS-reported events.
6. Run the replay gate on `/qualification` before resuming.

### 4.5 Signing key compromise

1. Revoke the authority immediately from the Engine Registry.
2. Rotate the signing secret on the VPS.
3. Re-register the authority with the new key.
4. Review `audit_log` for any `authority.*.rejected` records — these indicate
   rejected handshake attempts.
5. Review `authority_replay_guard` for replayed signatures.

### 4.6 Ownership record loss

Ownership is bootstrap-once and finalized. If the ownership record is lost and
finalization was already applied, restore from backup — do **not** attempt to
re-bootstrap. Re-bootstrapping would grant owner rights to whoever registers
next.

---

## 5. Backup verification

A backup that has never been restored is not a backup.

| Check | Frequency |
| --- | --- |
| Restore Supabase snapshot into a scratch project and run the schema report | Monthly |
| Restore the VPS SQLite backup into a scratch instance and run an integrity check | Monthly |
| Confirm replay determinism against restored event history | Monthly |
| Confirm the secret vault entries decrypt | Quarterly |
| Full disaster-recovery rehearsal | Quarterly |

Record every verification in `audit_log` via an operator note so the evidence
trail shows when recovery was last proven.

---

## 6. What recovery does not cover

- **Recovering trades.** Fills are final on-venue. No restore reverses them.
- **Reconstructing VPS decisions.** The companion mirrors decisions; it never
  re-derives them. A gap in mirrored history is a gap, not something to
  synthesise.
- **Restarting trading.** Every procedure above ends at "the authority is
  healthy". Enabling trading is an explicit VPS-side operator action.
