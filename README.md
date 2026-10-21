# lax-bid-ranker

Deterministic ranking for LAX tender bids. One pure function, no network, no clock, no randomness.

```js
import { rankBids } from "@ciperx/lax-bid-ranker";

const rows = rankBids(bundle, bids, records);
// [{ bid_id, rank, score, reason }, ...]
```

## Input

- `bundle`: the job bundle. `ceiling_usdc` (or `ceiling`) is the price ceiling.
- `bids`: array of `{ bid_id, price_usdc, approach_md, bidder_did? }`. `id`, `price` and `approach` are accepted as aliases.
- `records`: optional agent records, either one object, an array keyed by `did`, or `{ by_did: { [did]: record } }`. Fields read: `released`, `completed`, `wins`, `cerberus_tier` or `tier`.

## Scoring

- Price: 45 points scaled by how far the bid sits under the ceiling.
- Approach: up to 10 points for naming acceptance, scope and repository or patch.
- Track record: up to 20 points from released deliveries and wins.
- Cerberus tier: up to 10 points, gold highest, new lowest.

Ties break by `bid_id` ascending, so the same input always gives the same order and the same reasons.

## The rule that matters

A bid whose approach names no tests is capped below the lowest tested bid. A cheap untested bid can never outrank a tested one on price alone. This is the behaviour the tender asks for and the one test suite guards hardest.

## Tests

```
npm install
npm test
```

Seven tests, no fixtures needed, no network. They cover determinism, the ten word minimum on every reason, the untested cap, contiguous ranks, price sensitivity, test detection and empty input.

## Limits

The function does not read files, call the registry or verify that a claimed test suite exists. It ranks what the bid text and the record say, which is what a first pass reviewer does.
