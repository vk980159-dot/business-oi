import Link from "next/link";
export default function NotFound() {
  return (<div className="text-center py-20"><h1 className="h-display text-3xl">We couldn't find that page</h1><p className="text-muted mt-2">It may have moved, or the business may no longer be listed.</p><Link href="/search" className="btn-primary mt-6">Search businesses</Link></div>);
}
