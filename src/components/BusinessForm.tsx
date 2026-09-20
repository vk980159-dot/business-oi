import { SubmitButton, ActionForm } from "./ActionForm";
import type { FormState } from "@/lib/form";
import { DAYS, SOCIALS } from "@/lib/validation";

type Opt = { id?: number; code?: string; name: string };
const DAY_LABEL: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

export default function BusinessForm({
  action, categories, countries, timezones, values = {}, submitLabel,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  categories: Opt[]; countries: Opt[]; timezones: string[]; values?: Record<string, any>; submitLabel: string;
}) {
  const v = values;
  const hours = (v.opening_hours ?? {}) as Record<string, { open: string; close: string } | null>;
  const social = (v.social_links ?? {}) as Record<string, string>;
  return (
    <ActionForm action={action} className="space-y-8">
      <fieldset className="panel p-5 space-y-4">
        <legend className="h-display text-xl px-1">Business details</legend>
        <div><label className="label" htmlFor="name">Business name</label><input className="input" id="name" name="name" required maxLength={120} defaultValue={v.name} /></div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label" htmlFor="categoryId">Category</label>
            <select className="input" id="categoryId" name="categoryId" required defaultValue={v.category_id ?? ""}>
              <option value="" disabled>Choose a category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div><label className="label" htmlFor="website">Website (optional)</label><input className="input" id="website" name="website" type="url" placeholder="https://" defaultValue={v.website ?? ""} /></div>
        </div>
        <div><label className="label" htmlFor="description">Description</label><textarea className="input" id="description" name="description" required rows={5} maxLength={5000} defaultValue={v.description} />
          <p className="hint">Say what you do and who you serve. This becomes your page description in search results.</p></div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label" htmlFor="services">Services</label><textarea className="input" id="services" name="services" rows={3} placeholder="One per line or comma-separated" defaultValue={(v.services ?? []).join("\n")} /></div>
          <div><label className="label" htmlFor="keywords">Search keywords</label><textarea className="input" id="keywords" name="keywords" rows={3} placeholder="One per line or comma-separated" defaultValue={(v.keywords ?? []).join("\n")} /></div>
        </div>
      </fieldset>

      <fieldset className="panel p-5 space-y-4">
        <legend className="h-display text-xl px-1">Location and contact</legend>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label" htmlFor="countryCode">Country</label>
            <select className="input" id="countryCode" name="countryCode" required defaultValue={v.country_code?.trim() ?? ""}>
              <option value="" disabled>Choose a country</option>
              {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select></div>
          <div><label className="label" htmlFor="city">City</label><input className="input" id="city" name="city" required defaultValue={v.city} /></div>
        </div>
        <div><label className="label" htmlFor="address">Street address</label><input className="input" id="address" name="address" required defaultValue={v.address} /></div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label" htmlFor="phone">Phone</label><input className="input" id="phone" name="phone" type="tel" required placeholder="+1 512 555 0100" defaultValue={v.phone} />
            <p className="hint">Include the country code, or enter a local number for the country selected above.</p></div>
          <div><label className="label" htmlFor="email">Business email</label><input className="input" id="email" name="email" type="email" required defaultValue={v.email} /></div>
        </div>
        <div><label className="label" htmlFor="timezone">Time zone</label>
          <select className="input" id="timezone" name="timezone" defaultValue={v.timezone ?? "UTC"}>{timezones.map((t) => <option key={t}>{t}</option>)}</select></div>
      </fieldset>

      <fieldset className="panel p-5 space-y-3">
        <legend className="h-display text-xl px-1">Opening hours</legend>
        <p className="hint">Leave both times empty for a closed day.</p>
        {DAYS.map((d) => (
          <div key={d} className="grid grid-cols-[6rem_1fr_1fr] items-center gap-3">
            <span className="text-sm">{DAY_LABEL[d]}</span>
            <input aria-label={`${DAY_LABEL[d]} opens`} className="input" type="time" name={`hours_${d}_open`} defaultValue={hours[d]?.open ?? ""} />
            <input aria-label={`${DAY_LABEL[d]} closes`} className="input" type="time" name={`hours_${d}_close`} defaultValue={hours[d]?.close ?? ""} />
          </div>
        ))}
      </fieldset>

      <fieldset className="panel p-5 space-y-4">
        <legend className="h-display text-xl px-1">Images and social links</legend>
        <div><label className="label" htmlFor="logoUrl">Logo URL</label><input className="input" id="logoUrl" name="logoUrl" type="url" placeholder="https://" defaultValue={v.logo_url ?? ""} /></div>
        <div><label className="label" htmlFor="imageUrls">Image URLs (up to 8, one per line)</label><textarea className="input" id="imageUrls" name="imageUrls" rows={3} defaultValue={(v.image_urls ?? []).join("\n")} />
          <p className="hint">Images must be hosted at https:// addresses you control. File upload is not available yet.</p></div>
        <div className="grid sm:grid-cols-2 gap-4">
          {SOCIALS.map((s) => (
            <div key={s}><label className="label capitalize" htmlFor={`social_${s}`}>{s === "x" ? "X (Twitter)" : s}</label>
              <input className="input" id={`social_${s}`} name={`social_${s}`} type="url" placeholder="https://" defaultValue={social[s] ?? ""} /></div>
          ))}
        </div>
      </fieldset>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
