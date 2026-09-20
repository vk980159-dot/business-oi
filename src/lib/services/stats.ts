import { pool } from "../db";

export async function adminStats() {
  const one = async (sql: string) => (await pool().query(sql)).rows[0];
  const counts = await one(`select
      (select count(*)::int from users) as users,
      (select count(*)::int from businesses) as businesses,
      (select count(*)::int from businesses where status = 'pending_approval') as pending_approval,
      (select count(*)::int from businesses where status = 'approved') as approved,
      (select count(*)::int from bids where status = 'active' and expires_at > now()) as active_bids,
      (select count(*)::int from refunds where status in ('pending','failed')) as refunds_needing_attention`);
  const revenue = (
    await pool().query(`
      select p.kind::text as kind,
        coalesce(sum(case when l.entry_type = 'charge' then l.amount_cents end), 0)::int as gross_cents,
        coalesce(sum(case when l.entry_type = 'refund' then -l.amount_cents end), 0)::int as refunded_cents,
        coalesce(sum(case when l.entry_type in ('dispute_opened','dispute_won') then l.amount_cents end), 0)::int as disputed_net_cents
      from payments p left join ledger_entries l on l.payment_id = p.id
      group by p.kind`)
  ).rows as { kind: "listing" | "bid"; gross_cents: number; refunded_cents: number; disputed_net_cents: number }[];
  const by = (k: "listing" | "bid") => revenue.find((r) => r.kind === k) ?? { kind: k, gross_cents: 0, refunded_cents: 0, disputed_net_cents: 0 };
  const net = (r: { gross_cents: number; refunded_cents: number; disputed_net_cents: number }) => r.gross_cents - r.refunded_cents + r.disputed_net_cents;
  return {
    ...counts,
    listingGrossCents: by("listing").gross_cents,
    bidGrossCents: by("bid").gross_cents,
    refundedCents: by("listing").refunded_cents + by("bid").refunded_cents,
    netRevenueCents: net(by("listing")) + net(by("bid")),
  } as {
    users: number; businesses: number; pending_approval: number; approved: number; active_bids: number; refunds_needing_attention: number;
    listingGrossCents: number; bidGrossCents: number; refundedCents: number; netRevenueCents: number;
  };
}
