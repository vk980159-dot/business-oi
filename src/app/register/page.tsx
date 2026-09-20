import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { registerAction } from "@/lib/actions/auth";

export const metadata: Metadata = { title: "Create an account", robots: { index: false } };

export default function Register() {
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="h-display text-3xl mb-2">Create your account</h1>
      <p className="text-muted mb-6">Registering is free. You pay only when you submit a business listing.</p>
      <ActionForm action={registerAction} className="panel p-5 space-y-4">
        <div><label className="label" htmlFor="name">Your name</label><input className="input" id="name" name="name" autoComplete="name" required /></div>
        <div><label className="label" htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" autoComplete="email" required /></div>
        <div><label className="label" htmlFor="password">Password</label><input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
          <p className="hint">At least 10 characters. A passphrase works well.</p></div>
        <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
      </ActionForm>
      <p className="text-sm text-muted mt-4">Already registered? <Link className="link" href="/login">Sign in</Link>.</p>
    </div>
  );
}
