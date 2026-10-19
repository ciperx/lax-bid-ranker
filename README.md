# lax-bid-ranker

Deterministic ranking of tender bids for LAX seats.

`rankBids(bundle, bids, records) -> [{ bid_id, rank, score, reason }]`

A pure function. Same input, same output, every time. Every bid gets a written reason of at least ten words. A cheaper bid that ships no tests can never outrank a bid that ships tests.

## Install

```bash
npm install
npm test
npm run build
```

## Use

```ts
import { rankBids } from "lax-bid-ranker";

const ranked = rankBids(
  { ceiling_usdc: 50 },
  [
    { bid_id: "a", price_usdc: 30, has_tests: true, test_count: 6, delivery_days: 4,
      approach: "Typed module, vitest suite, one concern per file." },
    { bid_id: "b", price_usdc: 5, has_tests: false },
  ],
  { "did:pkh:eip155:8453:0xaaa": { agent_did: "did:pkh:eip155:8453:0xaaa",
      accepted: 4, submitted: 5, rejected: 0, cerberus_tier: "gold" } },
);
```

## Scoring

Four components, weighted to 100 by default.

- **Price, 35.** Linear against the ceiling. A bid at the ceiling scores nothing, a bid at zero scores the full 35, a bid above the ceiling is clamped to zero rather than punished.
- **Approach, 30.** Test coverage carries 60 percent of it, a written scope 25, a stated delivery window 15. An untested bid keeps at most 15 percent of the weight for stating its scope, so it can never buy its way up.
- **Record, 20.** The accepted ratio, minus half the rejection ratio over the same agent.
- **Cerberus tier, 15.** Platinum 15, gold 11, silver 7, bronze 3, unrated 0.

## The hard rule

Sorting is by test presence first, then score, then price, then `bid_id`. That means price alone cannot promote an untested bid past a tested one, no matter how wide the gap. The rule lives in one comparator so it cannot be half applied.

## Ties

Score, then the cheaper bid, then `bid_id` in ascending order. The tiebreak is total, so the output order is stable under input permutation. The test suite asserts that by ranking a list and its reverse.

## Files

- `src/rank.ts`, the types and the pure rules.
- `test/rank.test.ts`, 21 tests including the permutation check, the hard rule, the reason length floor and the weight override.

## House rules honoured

Latin digits only. No long dashes in text people see. No secrets, no network calls, no clocks, no randomness. Tests fail without the change: removing the tested-first comparator fails the hard-rule test.

## Licence

MIT.
