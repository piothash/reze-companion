/**
 * ARC — M7.6: VPS authority registration, heartbeat and configuration dispatch.
 *
 * Exercises the control-plane side of the handshake against an in-memory
 * backend. Signature, timestamp and replay checks are real; only storage is
 * simulated.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  canonicalAuthorityMessage,
  constantTimeEquals,
  signAuthorityMessage,
  verifyAuthorityMessage,
  verifyAuthorityTimestamp,
} from "@/core/platform/authority-signature";
import {
  deriveAuthorityLiveness,
  heartbeatDeadlineMillis,
} from "@/core/platform/authority-registration";
import {
  handleAuthorityHeartbeat,
  handleAuthorityRegistration,
  handleConfigurationPull,
  handleConfigurationVerdict,
} from "@/lib/authority-gateway.server";

const KEY = "arc-test-authority-signing-key-0123456789";
const OWNER = "00000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-06-01T12:00:00.000Z");

// ---------------------------------------------------------------------------
// In-memory backend
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function matches(row: Row, filters: [string, unknown][], inFilters: [string, unknown[]][]) {
  return (
    filters.every(([column, value]) => row[column] === value) &&
    inFilters.every(([column, values]) => values.includes(row[column]))
  );
}

class FakeBackend {
  readonly tables: Record<string, Row[]> = {
    authority_registry: [],
    authority_replay_guard: [],
    operator_ownership: [{ id: true, owner_user_id: OWNER, finalized: false }],
    configuration_versions: [],
    runtime_configuration_state: [],
    audit_log: [],
  };

  from(table: string) {
    const rows = (this.tables[table] ??= []);
    const filters: [string, unknown][] = [];
    const inFilters: [string, unknown[]][] = [];
    let pending: Row[] = [];

    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        inFilters.push([column, values]);
        return builder;
      },
      lt: () => builder,
      maybeSingle: async () => {
        if (pending.length > 0) return { data: pending[0] ?? null, error: null };
        const found = rows.filter((row) => matches(row, filters, inFilters));
        return { data: found[found.length - 1] ?? null, error: null };
      },
      insert: async (row: Row) => {
        if (table === "authority_replay_guard") {
          const clash = rows.some(
            (existing) =>
              existing["authority_id"] === row["authority_id"] &&
              existing["signature_digest"] === row["signature_digest"],
          );
          if (clash) return { data: null, error: { message: "duplicate key value" } };
        }
        rows.push({ ...row, seen_at: new Date(NOW).toISOString() });
        return { data: null, error: null };
      },
      upsert: (row: Row, options?: { onConflict?: string }) => {
        const keys = (options?.onConflict ?? "id").split(",").map((key) => key.trim());
        const index = rows.findIndex((existing) => keys.every((key) => existing[key] === row[key]));
        const merged =
          index >= 0
            ? { ...rows[index], ...row }
            : { ...row, registered_at: new Date(NOW).toISOString(), id: `row-${rows.length + 1}` };
        if (index >= 0) rows[index] = merged;
        else rows.push(merged);
        pending = [merged];
        return builder;
      },
      update: (patch: Row) => {
        // `update()` is awaited directly after `.eq()`, so filters are applied here.
        const apply = () => {
          for (const row of rows) {
            if (matches(row, filters, inFilters)) Object.assign(row, patch);
          }
        };
        return {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            apply();
            return Promise.resolve({ data: null, error: null });
          },
          then: (resolve: (result: { data: null; error: null }) => void) => {
            apply();
            resolve({ data: null, error: null });
          },
        };
      },
      delete: () => ({ lt: async () => ({ data: null, error: null }) }),
    };
    return builder;
  }
}

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

async function signed<T extends Record<string, unknown>>(payload: T, key = KEY) {
  return { ...payload, signature: await signAuthorityMessage(key, payload) };
}

const registrationBase = {
  authorityId: "arc-vps-authority-01",
  name: "ARC VPS Authority",
  environment: "testnet" as const,
  engineVersion: "1.4.2",
  platformVersion: "1.0.0",
  capabilities: ["decision", "risk", "execution"] as const,
};

function registration(timestampMillis = NOW) {
  return signed({
    ...registrationBase,
    capabilities: [...registrationBase.capabilities],
    timestamp: new Date(timestampMillis).toISOString(),
  });
}

function heartbeat(overrides: Record<string, unknown> = {}, timestampMillis = NOW) {
  return signed({
    authorityId: registrationBase.authorityId,
    environment: "testnet",
    engineVersion: "1.4.2",
    platformVersion: "1.0.0",
    status: "healthy",
    uptimeSeconds: 120,
    activeMarket: "BTC-UP-2026-06-01T12",
    activeWindows: 5,
    eventSequence: 4210,
    runtimeIdentity: "pm2-run-1",
    heartbeatIntervalMillis: 15_000,
    timestamp: new Date(timestampMillis).toISOString(),
    ...overrides,
  });
}

let backend: FakeBackend;

beforeEach(() => {
  backend = new FakeBackend();
  process.env["ARC_AUTHORITY_SIGNING_KEY"] = KEY;
});

// ---------------------------------------------------------------------------

describe("M7.6 — message authentication", () => {
  it("signs a canonical payload independent of key order", async () => {
    const a = canonicalAuthorityMessage({ b: 2, a: 1, signature: "ignored" });
    const b = canonicalAuthorityMessage({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("accepts a correctly signed, fresh message", async () => {
    const payload = await signed({ authorityId: "x", timestamp: new Date(NOW).toISOString() });
    const result = await verifyAuthorityMessage({
      payload,
      signature: payload.signature,
      timestamp: payload.timestamp,
      key: KEY,
      nowMillis: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.signatureDigest).toBeTruthy();
  });

  it("rejects a tampered payload", async () => {
    const payload = await signed({ authorityId: "x", timestamp: new Date(NOW).toISOString() });
    const result = await verifyAuthorityMessage({
      payload: { ...payload, authorityId: "y" },
      signature: payload.signature,
      timestamp: payload.timestamp,
      key: KEY,
      nowMillis: NOW,
    });
    expect(result.reasonCode).toBe("SIGNATURE_INVALID");
  });

  it("never accepts unsigned messages when no key is configured", async () => {
    const result = await verifyAuthorityMessage({
      payload: { authorityId: "x" },
      signature: "whatever-signature-value",
      timestamp: new Date(NOW).toISOString(),
      key: undefined,
      nowMillis: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("KEY_UNCONFIGURED");
  });

  it("enforces the timestamp window in both directions", () => {
    expect(verifyAuthorityTimestamp(new Date(NOW - 5_000).toISOString(), NOW).ok).toBe(true);
    expect(verifyAuthorityTimestamp(new Date(NOW - 600_000).toISOString(), NOW).reasonCode).toBe(
      "TIMESTAMP_EXPIRED",
    );
    expect(verifyAuthorityTimestamp(new Date(NOW + 600_000).toISOString(), NOW).reasonCode).toBe(
      "TIMESTAMP_FUTURE",
    );
    expect(verifyAuthorityTimestamp("not-a-date", NOW).reasonCode).toBe("TIMESTAMP_INVALID");
  });

  it("compares signatures without short-circuiting on length-equal inputs", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
    expect(constantTimeEquals("abc", "abd")).toBe(false);
    expect(constantTimeEquals("abc", "abcd")).toBe(false);
  });
});

describe("M7.6 — authority registration", () => {
  it("accepts a signed registration and records public identity only", async () => {
    const result = await handleAuthorityRegistration(backend, await registration(), NOW);
    expect(result.status).toBe(200);
    expect(result.body["accepted"]).toBe(true);
    expect(result.body["status"]).toBe("registered");

    const row = backend.tables["authority_registry"]![0]!;
    expect(row["user_id"]).toBe(OWNER);
    expect(row["registration_count"]).toBe(1);
    expect(Object.keys(row)).not.toContain("private_key");
  });

  it("rejects an unsigned registration", async () => {
    const { signature: _signature, ...unsigned } = await registration();
    const result = await handleAuthorityRegistration(backend, unsigned, NOW);
    expect(result.status).toBe(400);
    expect(result.body["accepted"]).toBe(false);
  });

  it("rejects a registration signed with the wrong key", async () => {
    const forged = await signed(
      {
        ...registrationBase,
        capabilities: [...registrationBase.capabilities],
        timestamp: new Date(NOW).toISOString(),
      },
      "an-attacker-controlled-key-value",
    );
    const result = await handleAuthorityRegistration(backend, forged, NOW);
    expect(result.status).toBe(401);
    expect(result.body["reasonCode"]).toBe("SIGNATURE_INVALID");
  });

  it("rejects a stale registration timestamp", async () => {
    const result = await handleAuthorityRegistration(
      backend,
      await registration(NOW - 10 * 60_000),
      NOW,
    );
    expect(result.status).toBe(401);
    expect(result.body["reasonCode"]).toBe("TIMESTAMP_EXPIRED");
  });

  it("rejects a replayed registration", async () => {
    const payload = await registration();
    expect((await handleAuthorityRegistration(backend, payload, NOW)).status).toBe(200);
    const replay = await handleAuthorityRegistration(backend, payload, NOW);
    expect(replay.status).toBe(409);
    expect(replay.body["reasonCode"]).toBe("SIGNATURE_REPLAYED");
  });

  it("rejects secret material offered as identity", async () => {
    const payload = await signed({
      ...registrationBase,
      capabilities: [...registrationBase.capabilities],
      publicKey: `0x${"b".repeat(64)}`,
      timestamp: new Date(NOW).toISOString(),
    });
    const result = await handleAuthorityRegistration(backend, payload, NOW);
    expect(result.status).toBe(400);
    expect(String(result.body["detail"])).toMatch(/public identity only/);
  });

  it("refuses registration before the operator is bootstrapped", async () => {
    backend.tables["operator_ownership"] = [{ id: true, owner_user_id: null }];
    const result = await handleAuthorityRegistration(backend, await registration(), NOW);
    expect(result.status).toBe(409);
    expect(result.body["reasonCode"]).toBe("OPERATOR_NOT_BOOTSTRAPPED");
  });
});

describe("M7.6 — heartbeat lifecycle", () => {
  beforeEach(async () => {
    await handleAuthorityRegistration(backend, await registration(), NOW);
  });

  it("accepts a signed heartbeat and mirrors reported runtime state", async () => {
    const result = await handleAuthorityHeartbeat(backend, await heartbeat(), NOW, NOW);
    expect(result.status).toBe(200);
    expect(result.body["status"]).toBe("active");

    const row = backend.tables["authority_registry"]![0]!;
    expect(row["runtime_status"]).toBe("healthy");
    expect(row["active_windows"]).toBe(5);
    expect(row["event_sequence"]).toBe(4210);
  });

  it("rejects a heartbeat for an unknown authority", async () => {
    const result = await handleAuthorityHeartbeat(
      backend,
      await heartbeat({ authorityId: "arc-vps-authority-ghost" }),
      NOW,
      NOW,
    );
    expect(result.status).toBe(404);
    expect(result.body["reasonCode"]).toBe("AUTHORITY_NOT_REGISTERED");
  });

  it("rejects a replayed heartbeat", async () => {
    const payload = await heartbeat();
    expect((await handleAuthorityHeartbeat(backend, payload, NOW, NOW)).status).toBe(200);
    const replay = await handleAuthorityHeartbeat(backend, payload, NOW, NOW);
    expect(replay.status).toBe(409);
  });

  it("rejects heartbeats from a revoked authority", async () => {
    backend.tables["authority_registry"]![0]!["status"] = "revoked";
    const result = await handleAuthorityHeartbeat(backend, await heartbeat(), NOW, NOW);
    expect(result.status).toBe(403);
    expect(result.body["reasonCode"]).toBe("AUTHORITY_REVOKED");
  });

  it("keeps a revoked authority revoked across re-registration", async () => {
    backend.tables["authority_registry"]![0]!["status"] = "revoked";
    const result = await handleAuthorityRegistration(
      backend,
      await registration(NOW + 1_000),
      NOW + 1_000,
    );
    expect(result.status).toBe(403);
    expect(backend.tables["authority_registry"]![0]!["status"]).toBe("revoked");
  });

  it("detects a PM2 restart through a changed runtime identity", async () => {
    await handleAuthorityHeartbeat(backend, await heartbeat(), NOW, NOW);
    const after = await handleAuthorityHeartbeat(
      backend,
      await heartbeat({ runtimeIdentity: "pm2-run-2", uptimeSeconds: 3 }, NOW + 1_000),
      NOW + 1_000,
      NOW + 1_000,
    );
    expect(after.body["restartDetected"]).toBe(true);
    expect(
      backend.tables["audit_log"]!.some((row) => row["action"] === "authority.restarted"),
    ).toBe(true);
  });

  it("keeps one registry row and one identity across a restart", async () => {
    await handleAuthorityHeartbeat(backend, await heartbeat(), NOW, NOW);
    await handleAuthorityRegistration(backend, await registration(NOW + 1_000), NOW + 1_000);
    await handleAuthorityHeartbeat(
      backend,
      await heartbeat({ runtimeIdentity: "pm2-run-2" }, NOW + 2_000),
      NOW + 2_000,
      NOW + 2_000,
    );
    expect(backend.tables["authority_registry"]).toHaveLength(1);
    expect(backend.tables["authority_registry"]![0]!["registration_count"]).toBe(2);
  });
});

describe("M7.6 — derived liveness", () => {
  it("goes stale relative to the engine's own interval, never sooner than 90s", () => {
    expect(heartbeatDeadlineMillis(5_000)).toBe(90_000);
    expect(heartbeatDeadlineMillis(60_000)).toBe(180_000);
    const last = new Date(NOW - 120_000).toISOString();
    expect(deriveAuthorityLiveness("registered", last, 15_000, NOW)).toBe("stale");
    expect(deriveAuthorityLiveness("registered", last, 60_000, NOW)).toBe("active");
  });

  it("reports REGISTERED until the first heartbeat and REVOKED regardless of freshness", () => {
    expect(deriveAuthorityLiveness("registered", null, 15_000, NOW)).toBe("registered");
    expect(deriveAuthorityLiveness("revoked", new Date(NOW).toISOString(), 15_000, NOW)).toBe(
      "revoked",
    );
  });
});

describe("M7.6 — configuration dispatch", () => {
  beforeEach(async () => {
    await handleAuthorityRegistration(backend, await registration(), NOW);
    backend.tables["configuration_versions"] = [
      {
        id: "cfg-1",
        user_id: OWNER,
        version: 7,
        config: { executionProfileId: "arc-default" },
        config_hash: "hash-7",
        execution_profile_id: "arc-default",
        correlation_id: "corr-7",
        profile_name: "arc-execution-profile",
        status: "PENDING",
        created_at: new Date(NOW).toISOString(),
      },
    ];
  });

  async function verdict(overrides: Record<string, unknown> = {}) {
    return signed({
      authorityId: registrationBase.authorityId,
      version: 7,
      configHash: "hash-7",
      verdict: "ACCEPTED",
      snapshotId: "snap-7",
      timestamp: new Date(NOW).toISOString(),
      ...overrides,
    });
  }

  it("hands the pending version to the registered engine", async () => {
    const result = await handleConfigurationPull(backend, registrationBase.authorityId, NOW);
    expect(result.body["pending"]).toBe(true);
    expect(result.body["version"]).toBe(7);
    expect(result.body["configHash"]).toBe("hash-7");
  });

  it("activates only after a signed ACCEPTED verdict", async () => {
    expect(backend.tables["configuration_versions"]![0]!["status"]).toBe("PENDING");
    const result = await handleConfigurationVerdict(backend, await verdict(), NOW);
    expect(result.status).toBe(200);
    expect(backend.tables["configuration_versions"]![0]!["status"]).toBe("ACTIVE");
    expect(backend.tables["runtime_configuration_state"]![0]!["runtime_status"]).toBe("LIVE");
  });

  it("records a rejection without activating anything", async () => {
    const result = await handleConfigurationVerdict(
      backend,
      await verdict({ verdict: "REJECTED", detail: "window offset below engine minimum" }),
      NOW,
    );
    expect(result.body["runtimeStatus"]).toBe("REJECTED");
    expect(backend.tables["configuration_versions"]![0]!["status"]).toBe("REJECTED");
    expect(backend.tables["runtime_configuration_state"]).toHaveLength(0);
  });

  it("never activates on an unsigned or forged verdict", async () => {
    const { signature: _s, ...unsigned } = await verdict();
    expect((await handleConfigurationVerdict(backend, unsigned, NOW)).status).toBe(401);

    const forged = { ...(await verdict()), signature: "f".repeat(64) };
    expect((await handleConfigurationVerdict(backend, forged, NOW)).status).toBe(401);
    expect(backend.tables["configuration_versions"]![0]!["status"]).toBe("PENDING");
  });

  it("refuses a verdict whose hash does not match the published version", async () => {
    const result = await handleConfigurationVerdict(
      backend,
      await verdict({ configHash: "hash-tampered" }),
      NOW,
    );
    expect(result.status).toBe(409);
    expect(result.body["reasonCode"]).toBe("CFG_HASH_MISMATCH");
    expect(backend.tables["configuration_versions"]![0]!["status"]).toBe("PENDING");
  });

  it("refuses configuration traffic from a revoked authority", async () => {
    backend.tables["authority_registry"]![0]!["status"] = "revoked";
    expect((await handleConfigurationPull(backend, registrationBase.authorityId, NOW)).status).toBe(
      403,
    );
    expect((await handleConfigurationVerdict(backend, await verdict(), NOW)).status).toBe(403);
  });
});
