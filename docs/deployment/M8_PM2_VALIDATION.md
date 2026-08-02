# M8 — PM2 Production Validation

Applies to the **VPS trading authority**. The companion validates nothing here
itself: it records what the engine reports and shows it on `/qualification` and
`/system`. Every check below is run on the VPS and leaves evidence in
telemetry or the audit trail.

## 1. Process running

```bash
pm2 status arc-engine
pm2 describe arc-engine | grep -E 'status|uptime|restarts'
```

Expected: `online`, a growing uptime, and a restart count that matches the
`registration_count` the control plane shows for the authority.

Evidence in the console: **Engine Registry → uptime, registrations.**

## 2. Engine starts after reboot

```bash
pm2 startup            # once, prints the systemd command to run as root
pm2 save               # persist the current process list
sudo reboot
# after the host is back:
pm2 status arc-engine
```

Expected: the engine is `online` without manual intervention, re-registers with
the control plane, and the authority returns to `ACTIVE` within two heartbeat
intervals.

## 3. Environment validation passes

The engine runs its startup validator before it arms any window. A failed gate
must abort startup — never degrade into partial trading.

```bash
pm2 logs arc-engine --lines 200 | grep -i 'startup gate'
```

Expected: every gate `ok`, then the nine-step startup chain reported to the
control plane.

## 4. Secrets loaded correctly

```bash
pm2 env 0 | grep -c 'ARC_AUTHORITY_SIGNING_KEY'   # expect 1
```

Never print the value. The control plane shows only *metadata* — configured
yes/no and strength — on **System → Authority Signing**. If the key is absent
the gateway fails closed with `503 KEY_UNCONFIGURED` and no registration is
accepted.

## 5. Health endpoint responds

```bash
curl -fsS localhost:<port>/health | jq '.status, .engineVersion, .runtimeIdentity'
```

Expected: `ok`, a version and a runtime identity. The same identity must appear
in the registry, otherwise the authority stays `STALE`.

## 6. Shutdown is graceful

```bash
pm2 stop arc-engine
```

Expected, in order: new intents stop being produced, in-flight orders are
cancelled or allowed to settle, exposure reservations are released, the final
event sequence is flushed, and the process exits with code 0. `SIGKILL` should
never be required.

## 7. Restart does not duplicate events

```bash
pm2 restart arc-engine
```

Expected: the canonical event sequence continues forward — it never repeats or
regresses. The control plane checks exactly this: the reported
`event_sequence` is compared to the highest sequence it has durably recorded,
and a regression fails the **OPERATIONS** domain of the mainnet gate with
"duplicate events are possible".

Idempotency keys on the event envelope suppress duplicate intents, orders,
settlements and ledger records if a restart does replay work.

## Sign-off

| Check | Evidence surface |
| --- | --- |
| Process running | Engine Registry — status, uptime |
| Reboot persistence | Registry — registration count increments, status returns to ACTIVE |
| Environment validation | Qualification — VPS Startup Evidence, 9/9 reported |
| Secrets loaded | System — Authority Signing: configured, ENFORCED |
| Health endpoint | Registry — runtime identity, latency |
| Graceful shutdown | Audit trail — shutdown entry, exposure released |
| Restart integrity | Qualification — OPERATIONS domain PASS |

All seven must hold before the mainnet gate's **OPERATIONS** domain can report
PASS. No item can be ticked in the console — each closes on reported evidence.
