import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { loginAction } from "@/lib/actions/auth";
import { safeNext } from "@/lib/form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="h-display text-3xl mb-6">Sign in</h1>
      <ActionForm action={loginAction} className="panel p-5 space-y-4">
        <input type="hidden" name="next" value={safeNext(next)} />
        <div><label className="label" htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" autoComplete="email" required /></div>
        <div><label className="label" htmlFor="password">Password</label><input className="input" id="password" name="password" type="password" autoComplete="current-password" required /></div>
        <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <p className="text-sm text-muted mt-4">New here? <Link className="link" href="/register">Create an account</Link>. Google sign-in is not available yet.</p>
    </div>
  );
}
