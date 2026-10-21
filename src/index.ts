export interface Bundle {
  ceiling_usdc?: number;
  ceiling?: number;
  job_id?: string;
  [k: string]: unknown;
}

export interface Bid {
  bid_id?: string;
  id?: string;
  price_usdc?: number;
  price?: number;
  approach_md?: string;
  approach?: string;
  offer_id?: string;
  bidder_did?: string;
  agent_did?: string;
  [k: string]: unknown;
}

export interface AgentRecord {
  released?: number;
  wins?: number;
  completed?: number;
  cerberus_tier?: string | number;
  tier?: string | number;
  [k: string]: unknown;
}

export interface Ranked {
  bid_id: string;
  rank: number;
  score: number;
  reason: string;
}

const TIER_SCORE: Record<string, number> = {
  gold: 10,
  silver: 8,
  bronze: 6,
  verified: 5,
  probation: 2,
  new: 1,
};

function bidId(b: Bid): string {
  return String(b.bid_id ?? b.id ?? "");
}

function priceOf(b: Bid): number {
  const p = b.price_usdc ?? b.price ?? 0;
  const n = Number(p);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function textOf(b: Bid): string {
  return String(b.approach_md ?? b.approach ?? "");
}

function ceilingOf(bundle: Bundle): number {
  const c = Number(bundle?.ceiling_usdc ?? bundle?.ceiling ?? 0);
  return Number.isFinite(c) && c > 0 ? c : 0;
}

/** A bid is treated as tested only when its approach mentions a test, a suite or a fixture. */
export function hasTests(b: Bid): boolean {
  return /\b(test|tests|tested|suite|fixtures?)\b/i.test(textOf(b));
}

/** Deterministic clause count over the approach text. */
export function scopeScore(b: Bid): number {
  const t = textOf(b);
  let s = 0;
  if (/\bacceptance\b/i.test(t)) s += 4;
  if (/\b(scope|criteria|criterion)\b/i.test(t)) s += 3;
  if (/\b(repo|repository|commit|patch)\b/i.test(t)) s += 3;
  return s;
}

function recordFor(b: Bid, records: AgentRecord | AgentRecord[] | undefined): AgentRecord {
  if (!records) return {};
  if (Array.isArray(records)) {
    const key = String(b.bidder_did ?? b.offer_id ?? "");
    return records.find((r) => String(r.did ?? r.offer_id ?? "") === key) ?? {};
  }
  const rec = records as AgentRecord & { by_did?: Record<string, AgentRecord> };
  if (rec.by_did) {
    const key = String(b.bidder_did ?? b.offer_id ?? "");
    return rec.by_did[key] ?? {};
  }
  return rec;
}

function trackScore(r: AgentRecord): number {
  const rel = Number(r.released ?? r.completed ?? 0);
  const wins = Number(r.wins ?? 0);
  const raw = Math.min(15, rel * 3) + Math.min(5, wins);
  return Number.isFinite(raw) ? raw : 0;
}

function tierScore(r: AgentRecord): number {
  const raw = r.cerberus_tier ?? r.tier ?? "new";
  if (typeof raw === "number") return Math.max(0, Math.min(10, raw));
  const key = String(raw).toLowerCase();
  for (const [name, value] of Object.entries(TIER_SCORE)) {
    if (key.includes(name)) return value;
  }
  return 1;
}

function priceScore(price: number, ceiling: number): number {
  if (ceiling <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, price / ceiling));
  return Math.round((1 - ratio) * 45 * 100) / 100;
}

function reasonFor(price: number, ceiling: number, r: AgentRecord, tested: boolean, score: number): string {
  const pct = ceiling > 0 ? Math.round((price / ceiling) * 100) : 0;
  const tier = String(r.cerberus_tier ?? r.tier ?? "new");
  const rel = Number(r.released ?? r.completed ?? 0);
  const testWords = tested
    ? "the approach names tests, so the work can be checked without the buyer reading it"
    : "the approach names no tests, so the price cannot carry this bid on its own";
  return (
    `Priced at ${price} of a ${ceiling} ceiling (${pct} percent), ${testWords}; ` +
    `Cerberus tier ${tier} with ${rel} released deliveries, giving a score of ${score}.`
  );
}

/**
 * Rank bids deterministically: score descending, then bid id ascending, so the same
 * input always gives the same order. A bid whose approach names no tests is capped
 * below every tested bid, no matter how cheap it is.
 */
export function rankBids(bundle: Bundle, bids: Bid[], records?: AgentRecord | AgentRecord[]): Ranked[] {
  const ceiling = ceilingOf(bundle ?? {});
  const list = Array.isArray(bids) ? bids : [];
  const scored = list.map((b) => {
    const price = priceOf(b);
    const rec = recordFor(b, records);
    const tested = hasTests(b);
    const score =
      Math.round((priceScore(price, ceiling) + scopeScore(b) + trackScore(rec) + tierScore(rec)) * 100) / 100;
    return { b, price, rec, tested, score };
  });

  const testedScores = scored.filter((s) => s.tested).map((s) => s.score);
  const floor = testedScores.length > 0 ? Math.min(...testedScores) : Number.POSITIVE_INFINITY;
  for (const s of scored) {
    if (!s.tested && s.score >= floor) {
      s.score = Math.round((floor - 1) * 100) / 100;
      if (s.score < 0) s.score = 0;
    }
  }

  scored.sort((a, b) =>
    a.score === b.score
      ? bidId(a.b) < bidId(b.b)
        ? -1
        : bidId(a.b) > bidId(b.b)
          ? 1
          : 0
      : b.score - a.score,
  );

  return scored.map((s, i) => ({
    bid_id: bidId(s.b),
    rank: i + 1,
    score: s.score,
    reason: reasonFor(s.price, ceiling, s.rec, s.tested, s.score),
  }));
}
