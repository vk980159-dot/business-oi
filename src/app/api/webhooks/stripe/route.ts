import Stripe from "stripe";
import { NextResponse } from "next/server";
import { processProviderEvent } from "@/lib/services/webhook";
import { processRefund } from "@/lib/services/refunds";
import { getGateway } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook. The raw body is verified against STRIPE_WEBHOOK_SECRET before anything is read.
 * Payments only become "paid" (and bids only become active) through this route, never from the browser redirect.
 */
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(raw, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let result;
  try {
    result = await processProviderEvent(event);
  } catch (e) {
    console.error("webhook processing failed", event.id, event.type, e);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 }); // Stripe will retry
  }

  // Refunds created during processing (e.g. a bid that lost a race) go to the provider only after commit.
  for (const id of result.refundIds) {
    try {
      await processRefund(getGateway(), id);
    } catch (e) {
      console.error("auto-refund failed", id, e);
    }
  }
  return NextResponse.json({ received: true, duplicate: result.duplicate });
}
