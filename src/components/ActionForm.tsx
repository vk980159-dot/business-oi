"use client";
import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/form";

export function SubmitButton({ children, className = "btn-primary", pendingLabel }: { children: ReactNode; className?: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}

/** Form bound to a server action with inline success / error feedback. The button disables while submitting, so a double click can't double-submit. */
export function ActionForm({
  action, children, className, inline = false,
}: { action: (prev: FormState, fd: FormData) => Promise<FormState>; children: ReactNode; className?: string; inline?: boolean }) {
  const [state, formAction] = useActionState(action, {} as FormState);
  return (
    <form action={formAction} className={className}>
      {children}
      <div aria-live="polite" className={inline ? "inline-block ml-2 align-middle" : "mt-3"}>
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        {state.ok && <p className="text-sm text-ok">{state.ok}</p>}
      </div>
    </form>
  );
}
