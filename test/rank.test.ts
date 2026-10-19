import { describe, expect, it } from "vitest";
import {
  rankBids,
  priceScore,
  approachScore,
  recordScore,
  tierScore,
} from "../src/rank";
import type { AgentRecord, Bid, BidBundle } from "../src/rank";

const bundle: BidBundle = { ceiling_usdc: 50 };

const record = (over: Partial<AgentRecord> = {}): AgentRecord => ({
  agent_did: "did:pkh:eip155:8453:0xaaa",
  accepted: 4,
  submitted: 5,
  rejected: 0,
  cerberus_tier: "gold",
  ...over,
});

const bid = (over: Partial<Bid> = {}): Bid => ({
  bid_id: "b1",
  agent_did: "did:pkh:eip155:8453:0xaaa",
  price_usdc: 25,
  delivery_days: 5,
  approach: "A typed module with a vitest suite, one concern per file, plus a short README.",
  has_tests: true,
  test_count: 6,
  ...over,
});

describe("priceScore", () => {
  it("gives full weight at zero price and none at the ceiling", () => {
    expect(priceScore(0, 50, 35)).toBe(35);
    expect(priceScore(50, 50, 35)).toBe(0);
    expect(priceScore(25, 50, 35)).toBeCloseTo(17.5, 5);
  });

  it("never returns negative for a bid above the ceiling", () => {
    expect(priceScore(80, 50, 35)).toBe(0);
  });

  it("returns zero for a non positive ceiling", () => {
    expect(priceScore(10, 0, 35)).toBe(0);
  });
});

describe("approachScore", () => {
  it("rewards a tested bid with full coverage", () => {
    const scored = approachScore(bid({ test_count: 6 }), 30);
    expect(scored).toBeCloseTo(30, 5);
  });

  it("caps an untested bid at a small share of the weight", () => {
    const scored = approachScore(bid({ has_tests: false }), 30);
    expect(scored).toBeLessThanOrEqual(30 * 0.15);
    expect(scored).toBeGreaterThan(0);
  });

  it("gives zero to an untested bid with no scope", () => {
    expect(approachScore(bid({ has_tests: false, approach: "" }), 30)).toBe(0);
  });
});

describe("recordScore", () => {
  it("scales with the accepted ratio", () => {
    expect(recordScore(record({ accepted: 5, submitted: 5 }), 20)).toBeCloseTo(20, 5);
    expect(recordScore(record({ accepted: 0, submitted: 5 }), 20)).toBe(0);
  });

  it("penalises rejections", () => {
    const clean = recordScore(record({ accepted: 4, submitted: 5, rejected: 0 }), 20);
    const dirty = recordScore(record({ accepted: 4, submitted: 5, rejected: 3 }), 20);
    expect(dirty).toBeLessThan(clean);
  });

  it("returns zero when the agent has no record", () => {
    expect(recordScore(undefined, 20)).toBe(0);
  });
});

describe("tierScore", () => {
  it("orders the Cerberus tiers", () => {
    const p = tierScore(record({ cerberus_tier: "platinum" }), 15);
    const g = tierScore(record({ cerberus_tier: "gold" }), 15);
    const s = tierScore(record({ cerberus_tier: "silver" }), 15);
    const u = tierScore(record({ cerberus_tier: "unrated" }), 15);
    expect(p).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(s);
    expect(s).toBeGreaterThan(u);
  });
});

describe("rankBids", () => {
  it("is deterministic for the same input", () => {
    const bids = [bid({ bid_id: "a" }), bid({ bid_id: "b", price_usdc: 30 }), bid({ bid_id: "c", has_tests: false, price_usdc: 5 })];
    const first = rankBids(bundle, bids, [record()]);
    const second = rankBids(bundle, [...bids].reverse(), [record()]);
    expect(first.map((r) => r.bid_id)).toEqual(second.map((r) => r.bid_id));
    expect(first).toEqual(second);
  });

  it("never lets a cheaper untested bid outrank a tested one", () => {
    const tested = bid({ bid_id: "tested", price_usdc: 50, test_count: 1 });
    const cheap = bid({ bid_id: "cheap", price_usdc: 1, has_tests: false, test_count: 0 });
    const ranked = rankBids(bundle, [cheap, tested], [record()]);
    expect(ranked[0].bid_id).toBe("tested");
    expect(ranked[1].bid_id).toBe("cheap");
  });

  it("gives every bid a reason of at least ten words", () => {
    const bids = [bid({ bid_id: "a" }), bid({ bid_id: "b", has_tests: false })];
    for (const row of rankBids(bundle, bids, [record()])) {
      expect(row.reason.trim().split(/\s+/).length).toBeGreaterThanOrEqual(10);
    }
  });

  it("assigns contiguous ranks starting at one", () => {
    const bids = [bid({ bid_id: "a" }), bid({ bid_id: "b" }), bid({ bid_id: "c" })];
    const ranked = rankBids(bundle, bids, [record()]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("breaks a full tie by price then by bid id", () => {
    const a = bid({ bid_id: "a", price_usdc: 20 });
    const b = bid({ bid_id: "b", price_usdc: 20 });
    const ranked = rankBids(bundle, [b, a], [record()]);
    expect(ranked.map((r) => r.bid_id)).toEqual(["a", "b"]);
  });

  it("accepts records as a map keyed by did", () => {
    const rec = record();
    const ranked = rankBids(bundle, [bid({ bid_id: "a" })], { [rec.agent_did]: rec });
    expect(ranked[0].score).toBeGreaterThan(0);
  });

  it("uses custom weights when the bundle supplies them", () => {
    const priced = bid({ bid_id: "cheap", price_usdc: 1 });
    const heavy = rankBids({ ...bundle, weights: { price: 100, approach: 0, record: 0, tier: 0 } }, [priced], [record()]);
    const none = rankBids({ ...bundle, weights: { price: 0, approach: 0, record: 0, tier: 0 } }, [priced], [record()]);
    expect(heavy[0].score).toBeGreaterThan(none[0].score);
  });

  it("handles an empty bid list", () => {
    expect(rankBids(bundle, [], [])).toEqual([]);
  });
});

describe("has_tests truthiness and bad prices", () => {
  it("treats a truthy non boolean has_tests as tested in the hard rule", () => {
    const bundleWithCeiling = { ceiling_usdc: 100 };
    const bids = [
      { bid_id: "truthy-6", price_usdc: 60, approach: "x".repeat(60), has_tests: "yes" as unknown as boolean, test_count: 6 },
      { bid_id: "real-1", price_usdc: 20, approach: "x".repeat(60), has_tests: true, test_count: 1 },
    ];
    const ranked = rankBids(bundleWithCeiling, bids as never, []);
    expect(ranked[0].bid_id).toBe("truthy-6");
  });

  it("scores a negative or NaN price as zero rather than as the cheapest bid", () => {
    expect(priceScore(-5, 100, 40)).toBe(0);
    expect(priceScore(Number.NaN, 100, 40)).toBe(0);
    expect(priceScore(50, 100, 40)).toBeCloseTo(20, 5);
  });

  it("clamps a price above the ceiling to a zero price score", () => {
    expect(priceScore(150, 100, 40)).toBe(0);
  });
});
