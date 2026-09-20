import { pool } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { listCategories, listCountries } from "@/lib/services/catalog";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { addCategoryAction, addCountryAction, settingsAction, toggleCategoryAction, toggleCountryAction } from "@/lib/actions/admin";
import { PageTitle, Notice } from "@/components/ui";

const d = (c: number) => (c / 100).toFixed(2);

export default async function AdminSettings() {
  await requirePermission("settings.manage");
  const [s, cats, countries] = await Promise.all([getSettings(pool()), listCategories(true), listCountries(true)]);
  return (
    <div className="space-y-10 max-w-3xl">
      <PageTitle>Ranking and catalog settings</PageTitle>
      <Notice tone="warn">Changes apply immediately to new checkouts and bids. Existing active bids keep their amount and expiry. Every change is written to the audit log. Currency is fixed at <b>{s.currency.toUpperCase()}</b> in this MVP.</Notice>
      <ActionForm action={settingsAction} className="panel p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label" htmlFor="listingFee">Listing fee</label><input id="listingFee" className="input num" name="listingFee" defaultValue={d(s.listingFeeCents)} required /></div>
          <div><label className="label" htmlFor="startingBid">Starting bid</label><input id="startingBid" className="input num" name="startingBid" defaultValue={d(s.startingBidCents)} required /></div>
          <div><label className="label" htmlFor="minIncrement">Minimum bid increment</label><input id="minIncrement" className="input num" name="minIncrement" defaultValue={d(s.minIncrementCents)} required /></div>
          <div><label className="label" htmlFor="maxBid">Maximum single bid</label><input id="maxBid" className="input num" name="maxBid" defaultValue={d(s.maxBidCents)} required /></div>
          <div><label className="label" htmlFor="bidDurationDays">Bid duration (days)</label><input id="bidDurationDays" className="input num" name="bidDurationDays" defaultValue={s.bidDurationDays} required /></div>
          <div><label className="label" htmlFor="checkoutHoldMinutes">Checkout window (minutes, 30–1440)</label><input id="checkoutHoldMinutes" className="input num" name="checkoutHoldMinutes" defaultValue={s.checkoutHoldMinutes} required /></div>
        </div>
        <div><label className="label" htmlFor="refundPolicy">Refund policy text (shown on the Refund Policy page)</label><textarea id="refundPolicy" className="input" name="refundPolicy" rows={5} defaultValue={s.refundPolicy} /></div>
        <p className="hint">Ranking rule (fixed): highest active bid, then earliest-activated bid, then earliest approval. Payment provider keys come from environment variables, not this page.</p>
        <SubmitButton>Save settings</SubmitButton>
      </ActionForm>

      <section><h2 className="h-display text-xl mb-2">Categories</h2>
        <ActionForm action={addCategoryAction} className="flex gap-2 mb-3"><input className="input max-w-xs" name="name" placeholder="New category" required aria-label="New category" /><SubmitButton className="btn-quiet">Add</SubmitButton></ActionForm>
        <div className="panel divide-y divide-line">{cats.map((c) => (
          <div key={c.id} className="flex items-center justify-between px-4 py-2"><span className={c.active ? "" : "text-muted line-through"}>{c.name}</span>
            <ActionForm action={toggleCategoryAction.bind(null, c.id, !c.active)} inline><SubmitButton className="btn-quiet">{c.active ? "Disable" : "Enable"}</SubmitButton></ActionForm></div>))}</div></section>

      <section><h2 className="h-display text-xl mb-2">Countries</h2>
        <ActionForm action={addCountryAction} className="flex gap-2 mb-3"><input className="input w-24" name="code" placeholder="Code" maxLength={2} required aria-label="Country code" /><input className="input max-w-xs" name="name" placeholder="Country name" required aria-label="Country name" /><SubmitButton className="btn-quiet">Add or rename</SubmitButton></ActionForm>
        <div className="panel max-h-96 overflow-y-auto divide-y divide-line">{countries.map((c) => (
          <div key={c.code} className="flex items-center justify-between px-4 py-1.5"><span className={c.active ? "" : "text-muted line-through"}>{c.name} <span className="text-xs text-muted">{c.code}</span></span>
            <ActionForm action={toggleCountryAction.bind(null, c.code, !c.active)} inline><SubmitButton className="btn-quiet">{c.active ? "Disable" : "Enable"}</SubmitButton></ActionForm></div>))}</div></section>
    </div>
  );
}
