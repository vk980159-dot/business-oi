# Google Search Console setup

Business.oi generates: per-page titles and meta descriptions, canonical URLs, Open Graph tags, `LocalBusiness` JSON-LD (ratings only when real reviews exist), `/sitemap.xml` (approved businesses only) and `/robots.txt`. Nothing here guarantees Google indexing or ranking; ranking *inside Business.oi* is the paid ladder.

1. Search Console → Add property → **Domain** → add the DNS TXT record at your registrar.
2. Sitemaps → submit `https://<your-domain>/sitemap.xml`.
3. URL Inspection → test a business page → Request indexing (optional; Google will also discover via sitemap).
4. Validate structured data with Google's Rich Results Test on a live business URL.
5. Monitor Pages → indexing status and Enhancements. Only `approved` businesses are in the sitemap; others 404 and are never indexed.
6. Do not create fake reviews or Business Profiles. Paid links on listings use `rel="nofollow noopener noreferrer sponsored"`.
