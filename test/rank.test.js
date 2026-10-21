import test from "node:test";
import assert from "node:assert/strict";
import { rankBids, hasTests, scopeScore } from "../dist/index.js";

const bundle = { ceiling_usdc: 100, job_id: "job-1" };
const bids = [
  { bid_id: "b-cheap-untested", price_usdc: 10, approach_md: "I will do the work quickly." },
  { bid_id: "b-tested-pricey", price_usdc: 90, approach_md: "Repository with a test suite covering each acceptance line." },
  { bid_id: "b-tested-cheap", price_usdc: 40, approach_md: "Patch plus tests named after the acceptance items, repo commit included." },
];
const records = { by_did: {} };

test("deterministic for the same input", () => {
  const a = rankBids(bundle, bids, records);
  const b = rankBids(bundle, bids, records);
  assert.deepEqual(a, b);
  const shuffled = rankBids(bundle, [bids[2], bids[0], bids[1]], records);
  assert.deepEqual(shuffled.map((r) => r.bid_id).sort(), a.map((r) => r.bid_id).sort());
});

test("every bid gets a reason of at least ten words", () => {
  for (const row of rankBids(bundle, bids, records)) {
    const words = row.reason.trim().split(/\s+/).length;
    assert.ok(words >= 10, `${row.bid_id} reason has ${words} words`);
  }
});

test("a cheaper bid with no tests never outranks a tested bid", () => {
  const ranked = rankBids(bundle, bids, records);
  const cheapUntested = ranked.find((r) => r.bid_id === "b-cheap-untested");
  const tested = ranked.filter((r) => r.bid_id.startsWith("b-tested"));
  for (const t of tested) {
    assert.ok(cheapUntested.rank > t.rank, "untested bid must rank below every tested bid");
    assert.ok(cheapUntested.score < t.score, "untested score must sit below the tested floor");
  }
});

test("ranks start at one and are contiguous", () => {
  const ranked = rankBids(bundle, bids, records);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3]);
});

test("price against the ceiling moves the score", () => {
  const low = rankBids(bundle, [{ bid_id: "a", price_usdc: 20, approach_md: "tests" }], {})[0];
  const high = rankBids(bundle, [{ bid_id: "a", price_usdc: 95, approach_md: "tests" }], {})[0];
  assert.ok(low.score > high.score);
});

test("test detection and scope reading are stable", () => {
  assert.equal(hasTests({ bid_id: "x", approach_md: "with fixtures" }), true);
  assert.equal(hasTests({ bid_id: "y", approach_md: "no verification here" }), false);
  assert.ok(scopeScore({ bid_id: "z", approach_md: "acceptance, scope and repository commit" }) >= 10);
});

test("missing records and empty bids are handled", () => {
  assert.deepEqual(rankBids(bundle, []), []);
  const one = rankBids(bundle, [{ bid_id: "solo", price_usdc: 50, approach_md: "tests" }]);
  assert.equal(one.length, 1);
  assert.equal(one[0].rank, 1);
});
