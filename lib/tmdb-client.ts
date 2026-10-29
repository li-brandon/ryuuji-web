// Browser-side helper for the /api/tmdb proxy. Holds no secrets; the server adds the token.

export class TMDBRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TMDBRequestError";
  }
}

/** GETs `/api/tmdb/<path>`. Throws `TMDBRequestError` carrying the proxy's error message. */
export async function tmdbFetch<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const response = await fetch(`/api/tmdb/${path}${query.size ? `?${query}` : ""}`, { credentials: "same-origin" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: unknown } | null)?.error;
    throw new TMDBRequestError(typeof error === "string" ? error : `Request failed (HTTP ${response.status})`, response.status);
  }
  return body as T;
}
