import { Pool } from "pg";
import { migrate } from "../scripts/migrate";
import { pool } from "../src/lib/db";
import { registerUser } from "../src/lib/auth";
import { createBusiness, type BusinessInput } from "../src/lib/services/business";
import type { PaymentGateway } from "../src/lib/payments/gateway";
import { settleCheckoutPaid } from "../src/lib/services/settlement";
import { tx } from "../src/lib/db";
import { approveBusiness } from "../src/lib/services/moderation";
import { startListingCheckout, startBidCheckout } from "../src/lib/services/checkout";

export async function resetDb() {
  const p = pool();
  await p.query("drop schema public cascade; create schema public;");
  await migrate(p as unknown as Pool);
  await p.query("insert into countries(code,name) values ('US','United States'),('DE','Germany'),('IN','India')");
  await p.query("insert into categories(slug,name) values ('restaurants','Restaurants'),('plumbing','Plumbing')");
}

let n = 0;
export async function makeUser(role: "user" | "support" | "admin" = "user") {
  const u = await registerUser(pool(), { email: `u${++n}-${Date.now()}@example.com`, password: "a-long-test-password", name: `User ${n}` });
  if (role !== "user") await pool().query("update users set role=$2 where id=$1", [u.id, role]);
  return { ...u, role };
}

export const bizInput = (over: Partial<BusinessInput> = {}): BusinessInput => ({
  name: "Acme Plumbing", categoryId: 2, countryCode: "US", city: "Austin", address: "1 Main St",
  phone: "+15125550100", email: "hello@acme.test", website: "https://acme.test",
  description: "Family plumbers serving Austin since 1999, with emergency callouts.",
  services: ["drain cleaning", "water heaters"], keywords: ["plumber", "leak"], logoUrl: null, imageUrls: [],
  openingHours: {}, socialLinks: {}, timezone: "America/Chicago", ...over,
});

/** Fake provider: records calls, can be told to fail. */
export class FakeGateway implements PaymentGateway {
  sessions = 0;
  refunds: { paymentIntentId: string; amountCents: number; refundId: string }[] = [];
  failRefunds = false;
  failCheckout = false;
  async createCheckout(i: Parameters<PaymentGateway["createCheckout"]>[0]) {
    if (this.failCheckout) throw new Error("stripe down");
    this.sessions++;
    return { sessionId: `cs_test_${i.paymentId}`, url: `https://checkout.test/${i.paymentId}` };
  }
  async expireCheckout() {}
  async refund(i: { paymentIntentId: string; amountCents: number; refundId: string }) {
    if (this.failRefunds) throw new Error("stripe refund failed");
    this.refunds.push(i);
    return { stripeRefundId: `re_${i.refundId}` };
  }
}

/** Simulates the verified webhook for a payment (what Stripe would send). */
export async function payViaWebhookLogic(paymentId: string, opts: { amount?: number } = {}) {
  const p = (await pool().query("select * from payments where id=$1", [paymentId])).rows[0];
  return tx((c) =>
    settleCheckoutPaid(c, { sessionId: p.stripe_session_id, paymentIntentId: `pi_${paymentId}`, amountTotal: opts.amount ?? p.amount_cents, currency: p.currency }),
  );
}

/** A user + approved, listing-paid business, using the real services end to end. */
export async function makeApprovedBusiness(gw: FakeGateway, nameSuffix = "", over: Partial<BusinessInput> = {}) {
  const owner = await makeUser("user");
  const admin = await makeUser("admin");
  const b = await createBusiness(pool(), owner.id, bizInput({ name: `Acme ${nameSuffix || n}`, ...over }));
  await startListingCheckout(gw, { userId: owner.id, userEmail: owner.email, businessId: b.id, acceptTerms: true });
  const pay = (await pool().query("select id from payments where business_id=$1 and kind='listing'", [b.id])).rows[0];
  await payViaWebhookLogic(pay.id);
  await approveBusiness(admin, b.id);
  return { owner, admin, business: b };
}

/** Places a bid through the real checkout path and "pays" it. Returns the settle result. */
export async function placeAndPayBid(gw: FakeGateway, owner: { id: string; email: string }, businessId: string, amountCents: number) {
  await startBidCheckout(gw, { userId: owner.id, userEmail: owner.email, businessId, amountCents });
  const pay = (await pool().query("select p.id from payments p join bids b on b.payment_id=p.id where p.business_id=$1 and b.status='pending_payment'", [businessId])).rows[0];
  return payViaWebhookLogic(pay.id);
}
