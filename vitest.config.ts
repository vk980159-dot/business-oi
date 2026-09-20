import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    env: {
      DATABASE_URL: "postgres://bizoi:bizoi@localhost:5432/bizoi_test",
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_PUBLISHABLE_KEY: "pk_test_dummy",
      STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
      APP_URL: "http://localhost:3000",
    },
  },
});
