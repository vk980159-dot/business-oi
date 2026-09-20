/** Everything the app needs from a payment provider. Stripe implements it; tests fake it. */
export interface PaymentGateway {
  createCheckout(input: {
    paymentId: string;
    amountCents: number;
    currency: string;
    productName: string;
    description: string;
    customerEmail: string;
    successUrl: string;
    cancelUrl: string;
    expiresAt: Date;
  }): Promise<{ sessionId: string; url: string }>;
  expireCheckout(sessionId: string): Promise<void>;
  refund(input: { paymentIntentId: string; amountCents: number; refundId: string }): Promise<{ stripeRefundId: string }>;
}
