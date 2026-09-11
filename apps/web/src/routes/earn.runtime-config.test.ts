import { describe, expect, it } from "vitest";
import { ARC_TESTNET, ETHEREUM_SEPOLIA, type Address } from "@/lib/arcaidia/types";
import { runtimeConfigText } from "./earn";

const VAULT: Address = "0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1";

describe("runtimeConfigText (WP-19.1)", () => {
  it("emits the per-chain liquidity vault variable, using the real vault address", () => {
    const text = runtimeConfigText(ETHEREUM_SEPOLIA, VAULT, null);
    expect(text).toContain(`ETHEREUM_SEPOLIA_LIQUIDITY_VAULT=${VAULT}`);
  });

  it("uses the correct prefix per chain", () => {
    expect(runtimeConfigText(ARC_TESTNET, VAULT, null)).toContain("ARC_TESTNET_LIQUIDITY_VAULT=");
    expect(runtimeConfigText(ETHEREUM_SEPOLIA, VAULT, null)).not.toContain("ARC_TESTNET_LIQUIDITY_VAULT=");
  });

  /// WP-22's whole point was removing the need for an operator's own Graph
  /// account — handing one back here by default would undo it.
  it("never emits a live SUBGRAPH_URL value — only a commented-out example", () => {
    const text = runtimeConfigText(ETHEREUM_SEPOLIA, VAULT, null);
    const activeLines = text.split("\n").filter((line) => !line.trim().startsWith("#"));

    expect(activeLines.some((line) => line.startsWith("SUBGRAPH_URL_"))).toBe(false);
    expect(text).toContain("# SUBGRAPH_URL_ETHEREUM_SEPOLIA=");
  });

  it("never emits an operator private key of any kind", () => {
    const text = runtimeConfigText(ETHEREUM_SEPOLIA, VAULT, null);
    expect(text).not.toMatch(/PRIVATE_KEY=0x/);
  });

  it("includes the configured telemetry URL when one is set", () => {
    const text = runtimeConfigText(ETHEREUM_SEPOLIA, VAULT, "https://relay.example");
    expect(text).toContain("ARCAIDIA_TELEMETRY_URL=https://relay.example");
  });

  it("is honest, not silent, when no telemetry URL is configured", () => {
    const text = runtimeConfigText(ETHEREUM_SEPOLIA, VAULT, null);
    expect(text).toContain("ARCAIDIA_TELEMETRY_URL=# not configured for this deployment yet");
  });
});
