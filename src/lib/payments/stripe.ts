import Stripe from "stripe";
import type { PaymentGateway } from "./gateway";

let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    // Guard rail: this MVP is test-mode only until legal / merchant verification is complete.
    if (key.startsWith("sk_live_") && process.env.ALLOW_LIVE_PAYMENTS !== "true") {
      throw new Error("Live Stripe key detected but ALLOW_LIVE_PAYMENTS is not 'true'. Live payments are disabled.");
    }
    client = new Stripe(key);
  }
  return client;
}

export const stripeGateway: PaymentGateway = {
  async createCheckout(i) {
    const session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: i.paymentId,
        customer_email: i.customerEmail,
        success_url: i.successUrl,
        cancel_url: i.cancelUrl,
        expires_at: Math.floor(i.expiresAt.getTime() / 1000),
        metadata: { payment_id: i.paymentId },
        payment_intent_data: { metadata: { payment_id: i.paymentId }, description: i.description },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: i.currency,
              unit_amount: i.amountCents,
              product_data: { name: i.productName, description: i.description },
            },
          },
        ],
      },
      { idempotencyKey: `checkout:${i.paymentId}` },
    );
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { sessionId: session.id, url: session.url };
  },
  async expireCheckout(sessionId) {
    try {
      await stripe().checkout.sessions.expire(sessionId);
    } catch {
      /* already expired / completed: nothing to do */
    }
  },
  async refund(i) {
    const r = await stripe().refunds.create(
      { payment_intent: i.paymentIntentId, amount: i.amountCents, metadata: { refund_id: i.refundId } },
      { idempotencyKey: `refund:${i.refundId}` },
    );
    return { stripeRefundId: r.id };
  },
};
