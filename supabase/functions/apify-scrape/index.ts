import { svc, json, cors, useStubs, readCredential, audit, agentEvent } from "../_shared/aa.ts";

type Lead = { business_name: string; niche: string; city: string; contact_email?: string; contact_phone?: string; signals?: Record<string, unknown>; };

const STUB_LEADS: Lead[] = [
  { business_name: "Kalk Bay Roofing Co", niche: "roofing", city: "Cape Town", contact_phone: "+27210000001", signals: { has_website: true, review_count: 23, owner_operated: true } },
  { business_name: "Woodstock Custom Joinery", niche: "joinery", city: "Cape Town", contact_phone: "+27210000002", signals: { has_website: true, review_count: 8, owner_operated: true } },
  { business_name: "Generic National Plumbing Ltd", niche: "plumbing", city: "Johannesburg", contact_phone: "+27110000003", signals: { has_website: true, review_count: 400, owner_operated: false } },
];

async function fetchFromApify(token: string, niche: string, locationQuery: string, maxResults: number): Promise<{ leads: Lead[]; status: number }> {
  const actor = Deno.env.get("AA_APIFY_ACTOR") ?? "compass~crawler-google-places";
  const res = await fetch(
    `https://api.apify.com/v2/actors/${actor}/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchStringsArray: [niche],
        locationQuery,
        maxCrawledPlacesPerSearch: maxResults,
        language: "en",
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`apify_${res.status}: ${text.slice(0, 300)}`);
  }

  const items = await res.json();
  const leads = (Array.isArray(items) ? items : [])
    .filter((i: Record<string, unknown>) => {
      // Exclude obvious chains/franchises: >300 reviews is a strong signal of non-owner-operated
      const reviews = Number(i.reviewsCount ?? 0);
      return reviews < 300;
    })
    .map((i: Record<string, unknown>) => {
      const reviews = Number(i.reviewsCount ?? 0);
      return {
        business_name: String(i.title ?? ""),
        niche: String(i.categoryName ?? niche).toLowerCase(),
        city: "Cape Town",
        contact_phone: i.phone as string | undefined,
        signals: { has_website: !!i.website, review_count: reviews, owner_operated: reviews < 300 },
      };
    })
    .filter((l: Lead) => l.business_name.length > 0);

  return { leads, status: res.status };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = svc();
    const body = await req.json().catch(() => ({}));
    const niches: string[] = body.niches ?? ["roofing", "plumbing", "electrical", "tiling"];
    // Nominatim-valid Cape Town locations (validated against openstreetmap.org)
    const locations: string[] = body.locations ?? [
      "Cape Town, Western Cape, South Africa",
      "Claremont, Cape Town, South Africa",
      "Bellville, Cape Town, South Africa",
      "Sea Point, Cape Town, South Africa",
    ];
    const maxPerSearch: number = body.maxCrawledPlacesPerSearch ?? 50;

    const token = await readCredential(sb, "_global", "apify", "api_token");
    let leads: Lead[] = [];

    if (useStubs() || !token) {
      leads = STUB_LEADS;
    } else {
      for (const niche of niches) {
        for (const loc of locations) {
          const { leads: batch } = await fetchFromApify(token, niche, loc, maxPerSearch);
          leads = leads.concat(batch);
        }
      }
    }

    const names = leads.map((l) => l.business_name);
    const { data: existing } = await sb.from("entities").select("business_name").in("business_name", names);
    const seen = new Set((existing ?? []).map((e) => e.business_name.toLowerCase()));

    const fresh = leads.filter((l) => !seen.has(l.business_name.toLowerCase()));
    let inserted = 0;
    for (const l of fresh) {
      const { error } = await sb.from("entities").insert({ kind: "prospect", stage: "source", business_name: l.business_name, niche: l.niche, city: l.city, contact_email: l.contact_email, contact_phone: l.contact_phone, notes_signals: l.signals ?? {} });
      if (!error) inserted++;
    }

    await agentEvent(sb, null, "apify-scrape", "scrape_complete", { niches, locations, found: leads.length, fresh: fresh.length, inserted, stub: useStubs() || !token });
    await audit(sb, "apify_scrape", "entities", null, { found: leads.length, inserted });

    return json({ ok: true, found: leads.length, deduped: leads.length - fresh.length, inserted });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
