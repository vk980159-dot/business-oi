import { AppError } from "./errors";

export type FormState = { error?: string; ok?: string };

/** Runs a server-action body. Expected AppErrors become inline messages; everything else (incl. redirects) propagates. */
export async function run(fn: () => Promise<FormState | void>): Promise<FormState> {
  try {
    return (await fn()) ?? {};
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
}

export const safeNext = (n: unknown) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.includes("\\") ? n : "/dashboard");
