import { describe, expect, it } from "vitest";
import { deriveOnchainStage } from "./solver-stage";
import type { IntentOutcome } from "@/hooks/arcaidia/use-intent-outcome";
import type { DataState } from "./data-state";
import type { Address } from "./types";

const VAULT: Address = "0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1";
const OTHER_VAULT: Address = "0x0000000000000000000000000000000000dEaD";

function ready(data: IntentOutcome): DataState<IntentOutcome> {
  return { status: "ready", data };
}

describe("deriveOnchainStage (WP-19.3)", () => {
  it("returns null with no vault selected", () => {
    expect(deriveOnchainStage(null, ready({ filled: true, winningVault: VAULT, settled: false, settlementOutcome: null }))).toBeNull();
  });

  it("returns null while the outcome is still loading — telemetry's own stage applies meanwhile", () => {
    expect(deriveOnchainStage(VAULT, { status: "loading" })).toBeNull();
  });

  it("returns null when the intent has not been filled by anyone yet", () => {
    expect(
      deriveOnchainStage(VAULT, ready({ filled: false, winningVault: null, settled: false, settlementOutcome: null })),
    ).toBeNull();
  });

  it("returns AWAITING_CANONICAL_SETTLEMENT once this vault's own fill lands, before settlement", () => {
    expect(
      deriveOnchainStage(VAULT, ready({ filled: true, winningVault: VAULT, settled: false, settlementOutcome: null })),
    ).toBe("AWAITING_CANONICAL_SETTLEMENT");
  });

  it("returns SETTLED once canonical settlement is also confirmed", () => {
    expect(
      deriveOnchainStage(
        VAULT,
        ready({ filled: true, winningVault: VAULT, settled: true, settlementOutcome: "LP_REIMBURSED" }),
      ),
    ).toBe("SETTLED");
  });

  /// The exact case this hook exists for: another vault won the race.
  it("returns LOST_RACE when a different vault's fill is the one that landed", () => {
    expect(
      deriveOnchainStage(
        VAULT,
        ready({ filled: true, winningVault: OTHER_VAULT, settled: false, settlementOutcome: null }),
      ),
    ).toBe("LOST_RACE");
  });

  it("compares vault addresses case-insensitively", () => {
    expect(
      deriveOnchainStage(
        VAULT.toUpperCase() as Address,
        ready({ filled: true, winningVault: VAULT.toLowerCase() as Address, settled: false, settlementOutcome: null }),
      ),
    ).toBe("AWAITING_CANONICAL_SETTLEMENT");
  });
});
