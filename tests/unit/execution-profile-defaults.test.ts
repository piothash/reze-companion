/**
 * ARC — operator profile seed and per-window inheritance.
 *
 * The seed is a console starting point only: the engine never reads it, and
 * every value stays editable. Inheritance resolution stays deterministic.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROFILE_SEED,
  executionProfileSchema,
  parseExecutionProfileOrThrow,
  parseWindowsSpec,
} from "@/core/decision/configuration";
import { resolveWindowConfiguration } from "@/core/decision/window-manager";

const profileFrom = (windows: unknown[]) =>
  parseExecutionProfileOrThrow({ ...DEFAULT_PROFILE_SEED, windows });

describe("execution profile seed", () => {
  it("offers 15s, 10s, 7s, 5s, 3s as editable defaults", () => {
    const profile = profileFrom(DEFAULT_PROFILE_SEED.windows);
    expect(profile.windows.map((w) => `${w.offset}${w.unit}`)).toEqual([
      "15s",
      "10s",
      "7s",
      "5s",
      "3s",
    ]);
    expect(profile.bufferMode).toBe("PERCENT");
    expect(profile.windows.map((w) => Number((w.twapBuffer * 100).toFixed(2)))).toEqual([
      0.2, 0.15, 0.12, 0.08, 0.05,
    ]);
  });

  it("defaults an unspecified window unit to seconds", () => {
    const window = executionProfileSchema.shape.windows.element.parse({ offset: 4 });
    expect(window.unit).toBe("s");
    expect(window.timeoutMillisOverride).toBeNull();
    expect(window.maxSpreadOverride).toBeNull();
  });

  it("rejects duplicate offsets", () => {
    expect(() =>
      profileFrom([
        { offset: 5, unit: "s" },
        { offset: 5, unit: "s" },
      ]),
    ).toThrow(/duplicate window offset/);
  });
});

describe("per-window inheritance", () => {
  it("inherits global timeout and spread unless overridden", () => {
    const profile = profileFrom([
      { offset: 15, unit: "s" },
      { offset: 10, unit: "s", timeoutMillisOverride: 20_000, maxSpreadOverride: 0.25 },
    ]);
    const inherited = resolveWindowConfiguration(profile, profile.windows[0]!);
    const overridden = resolveWindowConfiguration(profile, profile.windows[1]!);

    expect(inherited.timeoutMillis).toBe(profile.timeoutMillis);
    expect(inherited.maxSpread).toBe(profile.maxSpread);
    expect(overridden.timeoutMillis).toBe(20_000);
    expect(overridden.maxSpread).toBe(0.25);
  });

  it("parses timeout and spread modifiers from the window DSL", () => {
    const [window] = parseWindowsSpec("15s@0.002|timeout=20000|spread=0.25");
    expect(window).toMatchObject({
      offset: 15,
      unit: "s",
      timeoutMillisOverride: 20_000,
      maxSpreadOverride: 0.25,
    });
  });
});
