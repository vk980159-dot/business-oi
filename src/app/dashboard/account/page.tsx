import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { changePasswordAction, updateNameAction } from "@/lib/actions/auth";
import { PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Account", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function Account() {
  const user = await requireUser("/dashboard/account");
  return (
    <div className="max-w-lg space-y-8">
      <PageTitle sub={user.email}>Account</PageTitle>
      <ActionForm action={updateNameAction} className="panel p-5 space-y-3">
        <h2 className="h-display text-xl">Name</h2>
        <input className="input" name="name" defaultValue={user.name} required aria-label="Your name" />
        <SubmitButton>Save name</SubmitButton>
      </ActionForm>
      <ActionForm action={changePasswordAction} className="panel p-5 space-y-3">
        <h2 className="h-display text-xl">Change password</h2>
        <div><label className="label" htmlFor="current">Current password</label><input id="current" className="input" name="current" type="password" autoComplete="current-password" required /></div>
        <div><label className="label" htmlFor="next">New password</label><input id="next" className="input" name="next" type="password" autoComplete="new-password" minLength={10} required /></div>
        <SubmitButton>Change password</SubmitButton>
      </ActionForm>
    </div>
  );
}
