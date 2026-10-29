import "server-only";

// Allow-listed, validated pass-through to TMDB v3. The token never leaves the server.

const BASE_URL = "https://api.themoviedb.org/3";
const DAY = 24 * 60 * 60;
const TEN_MINUTES = 10 * 60;

const page = /^[1-9]\d{0,2}$/;
const language = /^[a-z]{2}(-[A-Z]{2})?$/;
const bool = /^(true|false)$/;
const year = /^\d{4}$/;
const date = /^\d{4}-\d{2}-\d{2}$/;
const ids = /^\d{1,6}([,|]\d{1,6}){0,9}$/;

type Endpoint = { path: RegExp; params: Record<string, RegExp>; revalidate: number };

const ENDPOINTS: Endpoint[] = [
  {
    path: /^search\/(movie|tv)$/,
    revalidate: TEN_MINUTES,
    params: {
      query: /^[^\0]{1,200}$/,
      page,
      language,
      include_adult: bool,
      year,
      primary_release_year: year,
      first_air_date_year: year,
    },
  },
  { path: /^movie\/\d{1,9}$/, revalidate: DAY, params: { language } },
  {
    path: /^tv\/\d{1,9}$/,
    revalidate: DAY,
    // TMDB caps append_to_response at 20 sub-requests.
    params: { language, append_to_response: /^season\/\d{1,3}(,season\/\d{1,3}){0,19}$/ },
  },
  { path: /^tv\/\d{1,9}\/season\/\d{1,3}$/, revalidate: DAY, params: { language } },
  {
    path: /^discover\/tv$/,
    revalidate: TEN_MINUTES,
    params: {
      page,
      language,
      include_adult: bool,
      sort_by: /^(popularity|first_air_date|vote_average|vote_count)\.(asc|desc)$/,
      "first_air_date.gte": date,
      "first_air_date.lte": date,
      with_genres: ids,
      without_genres: ids,
      with_origin_country: /^[A-Z]{2}([,|][A-Z]{2}){0,9}$/,
      with_original_language: /^[a-z]{2}$/,
    },
  },
  { path: /^(movie|tv)\/\d{1,9}\/watch\/providers$/, revalidate: DAY, params: {} },
  { path: /^watch\/providers\/regions$/, revalidate: DAY, params: { language } },
  { path: /^watch\/providers\/(movie|tv)$/, revalidate: DAY, params: { language, watch_region: /^[A-Z]{2}$/ } },
  { path: /^configuration$/, revalidate: DAY, params: {} },
];

const json = (status: number, error: string, headers?: HeadersInit) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });

export async function proxyTMDB(segments: string[], search: URLSearchParams): Promise<Response> {
  const path = segments.join("/");
  const endpoint = ENDPOINTS.find((e) => e.path.test(path));
  if (!endpoint) return json(404, "Not found");

  const query = new URLSearchParams({ language: "en-US" });
  const seen = new Set<string>();
  for (const [key, value] of search) {
    const pattern = Object.hasOwn(endpoint.params, key) ? endpoint.params[key] : undefined;
    if (!pattern || seen.has(key) || !pattern.test(value)) return json(400, `Invalid query parameter: ${key}`);
    seen.add(key);
    query.set(key, value);
  }
  query.sort();

  const token = process.env.TMDB_TOKEN;
  if (!token) return json(503, "TMDB not configured");

  let upstream: Response;
  try {
    upstream = await fetch(`${BASE_URL}/${path}?${query}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      next: { revalidate: endpoint.revalidate },
    });
  } catch {
    return json(502, "Could not reach TMDB");
  }
  if (upstream.status === 404) return json(404, "Not found");
  if (!upstream.ok) return json(502, `TMDB returned an error (HTTP ${upstream.status})`);

  return new Response(await upstream.text(), {
    headers: {
      "Content-Type": "application/json",
      // Private: responses sit behind the passcode. Well under TMDB's 6-month caching limit.
      "Cache-Control": `private, max-age=${endpoint.revalidate}`,
    },
  });
}
