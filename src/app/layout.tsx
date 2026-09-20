import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/session";
import { logoutAction } from "@/lib/actions/auth";
import { can } from "@/lib/permissions";

const base = process.env.APP_URL ?? "http://localhost:3000";
export const metadata: Metadata = {
  metadataBase: new URL(base),
  title: { default: "Business.oi: List Your Business. Compete for Visibility. Go Global.", template: "%s | Business.oi" },
  description: "A worldwide business directory where placement is set by an open, public bidding ladder. Paid positions are always labelled.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="bg-white border-b border-line">
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-6">
            <Link href="/" className="h-display text-xl font-semibold tracking-tight">Business<span className="text-signal">.oi</span></Link>
            <nav className="flex items-center gap-4 text-sm flex-1">
              <Link href="/search" className="hover:underline">Search</Link>
              {user && <Link href="/dashboard" className="hover:underline">My businesses</Link>}
              {user && can(user.role, "admin.access") && <Link href="/admin" className="hover:underline">Admin</Link>}
            </nav>
            {user ? (
              <div className="flex items-center gap-3 text-sm">
                <Link href="/dashboard/account" className="hidden sm:inline text-muted hover:underline">{user.name}</Link>
                <form action={logoutAction}><button className="btn-quiet">Sign out</button></form>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <Link href="/login" className="btn-quiet">Sign in</Link>
                <Link href="/register" className="btn-primary">List your business</Link>
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
        <footer className="border-t border-line bg-white">
          <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-muted flex flex-wrap gap-x-6 gap-y-2 justify-between">
            <p>Business.oi. List Your Business. Compete for Visibility. Go Global.</p>
            <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legal">
              {[["terms", "Terms"], ["privacy", "Privacy"], ["refunds", "Refunds"], ["bidding", "Bidding terms"], ["verification", "Verification"], ["support", "Support"]].map(([s, l]) => (
                <Link key={s} href={`/legal/${s}`} className="hover:underline">{l}</Link>
              ))}
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
