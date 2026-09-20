import type { PaymentGateway } from "./gateway";
import { stripeGateway } from "./stripe";

const g = globalThis as unknown as { __gatewayOverride?: PaymentGateway };
/** Real Stripe gateway, unless a test has installed a fake. */
export const getGateway = (): PaymentGateway => g.__gatewayOverride ?? stripeGateway;
export const __setGatewayForTests = (gw: PaymentGateway | undefined) => { g.__gatewayOverride = gw; };
