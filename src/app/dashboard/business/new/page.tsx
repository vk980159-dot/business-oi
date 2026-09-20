import type { Metadata } from "next";
import { requireUser } from "@/lib/session";
import { listCategories, listCountries } from "@/lib/services/catalog";
import BusinessForm from "@/components/BusinessForm";
import { createBusinessAction } from "@/lib/actions/owner";
import { PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Add a business", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function NewBusiness() {
  await requireUser("/dashboard/business/new");
  const [categories, countries] = await Promise.all([listCategories(), listCountries()]);
  return (
    <div className="max-w-3xl">
      <PageTitle sub="Save your details first. Nothing is charged until you review the fee and terms on the next screen.">Add a business</PageTitle>
      <BusinessForm action={createBusinessAction} categories={categories} countries={countries} timezones={Intl.supportedValuesOf("timeZone")} submitLabel="Save and continue" />
    </div>
  );
}
