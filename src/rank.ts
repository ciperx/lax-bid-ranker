export interface BidBundle {
  ceiling_usdc: number;
  weights?: Partial<Weights>;
}

export interface Weights {
  price: number;
  approach: number;
  record: number;
  tier: number;
}

export interface Bid {
  bid_id: string;
  agent_did?: string;
  price_usdc: number;
  delivery_days?: number;
  approach?: string;
  has_tests?: boolean;
  test_count?: number;
}

export type CerberusTier = "platinum" | "gold" | "silver" | "bronze" | "unrated";

export interface AgentRecord {
  agent_did: string;
  accepted?: number;
  submitted?: number;
  rejected?: number;
  cerberus_tier?: CerberusTier;
}

export interface RankedBid {
  bid_id: string;
  rank: number;
  score: number;
  reason: string;
}

export const DEFAULT_WEIGHTS: Weights = {
  price: 35,
  approach: 30,
  record: 20,
  tier: 15,
};

export const TIER_POINTS: Record<CerberusTier, number> = {
  platinum: 15,
  gold: 11,
  silver: 7,
  bronze: 3,
  unrated: 0,
};

const clamp = (n: number, lo = 0, hi = 1): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function priceScore(priceUsdc: number, ceilingUsdc: number, weight: number): number {
  if (!(ceilingUsdc > 0)) return 0;
  // A missing, negative or NaN price is not a cheap bid, it is an invalid one.
  if (!Number.isFinite(priceUsdc) || priceUsdc < 0) return 0;
  return clamp(1 - Math.min(priceUsdc, ceilingUsdc) / ceilingUsdc) * weight;
}

export function approachScore(bid: Bid, weight: number): number {
  const scopeIsClear = (bid.approach ?? "").trim().length > 40;
  if (!bid.has_tests) {
    return scopeIsClear ? clamp(weight * 0.15, 0, weight) : 0;
  }
  const tests = Math.max(0, Math.min(6, bid.test_count ?? 0));
  const coverage = (tests / 6) * 0.6;
  const scope = scopeIsClear ? 0.25 : 0;
  const delivery = bid.delivery_days !== undefined && bid.delivery_days > 0 ? 0.15 : 0;
  return clamp((coverage + scope + delivery) * weight, 0, weight);
}

export function recordScore(record: AgentRecord | undefined, weight: number): number {
  if (!record) return 0;
  const accepted = Math.max(0, record.accepted ?? 0);
  const submitted = Math.max(0, record.submitted ?? accepted);
  const rejected = Math.max(0, record.rejected ?? 0);
  if (submitted <= 0) return 0;
  const ratio = clamp(accepted / submitted);
  const penalty = clamp(rejected / (submitted + rejected));
  return clamp((ratio - penalty * 0.5) * weight, 0, weight);
}

export function tierScore(record: AgentRecord | undefined, weight: number): number {
  const tier = record?.cerberus_tier ?? "unrated";
  return (TIER_POINTS[tier] / 15) * weight;
}

interface Parts {
  price: number;
  approach: number;
  record: number;
  tier: number;
}

function reasonFor(bid: Bid, parts: Parts, total: number): string {
  const tested = bid.has_tests
    ? `ships ${bid.test_count ?? 0} tests`
    : "offers no tests at all, so price cannot carry it";
  const priceLine =
    bid.price_usdc > 0
      ? `asks ${bid.price_usdc} USDC against the ceiling`
      : "asks nothing for the work";
  const comps = `price ${round2(parts.price)}, approach ${round2(parts.approach)}, record ${round2(parts.record)}, tier ${round2(parts.tier)}`;
  return `This bid ${tested} and ${priceLine}, reaching ${round2(total)} overall, from ${comps}.`;
}

export function rankBids(
  bundle: BidBundle,
  bids: Bid[],
  records: Record<string, AgentRecord> | AgentRecord[] = {},
): RankedBid[] {
  const weights: Weights = { ...DEFAULT_WEIGHTS, ...(bundle.weights ?? {}) };
  const lookup = (did: string): AgentRecord | undefined =>
    Array.isArray(records) ? records.find((r) => r.agent_did === did) : records[did];

  const scored = (bids ?? []).map((bid) => {
    const record = lookup(bid.agent_did ?? "");
    const parts: Parts = {
      price: priceScore(bid.price_usdc, bundle.ceiling_usdc, weights.price),
      approach: approachScore(bid, weights.approach),
      record: recordScore(record, weights.record),
      tier: tierScore(record, weights.tier),
    };
    const total = round2(parts.price + parts.approach + parts.record + parts.tier);
    return { bid, total, parts, tested: Boolean(bid.has_tests) };
  });

  // Hard rule: a tested bid always outranks an untested one, at any price.
  scored.sort((a, b) => {
    if (a.tested !== b.tested) return a.tested ? -1 : 1;
    if (b.total !== a.total) return b.total - a.total;
    if (a.bid.price_usdc !== b.bid.price_usdc) return a.bid.price_usdc - b.bid.price_usdc;
    return a.bid.bid_id < b.bid.bid_id ? -1 : a.bid.bid_id > b.bid.bid_id ? 1 : 0;
  });

  return scored.map((entry, index) => ({
    bid_id: entry.bid.bid_id,
    rank: index + 1,
    score: entry.total,
    reason: reasonFor(entry.bid, entry.parts, entry.total),
  }));
}
