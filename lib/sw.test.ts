import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Runs the real public/sw.js in a sandbox with fake caches, fetch and event listeners.

const ORIGIN = "https://ryuuji.example";
const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

type FakeRequest = { url: string; method: string; mode: string };
type Route = "navigate" | "static" | null;
type Listener = (event: unknown) => void;

const request = (path: string, init: Partial<FakeRequest> = {}): FakeRequest => ({
  url: new URL(path, ORIGIN).href,
  method: "GET",
  mode: "cors",
  ...init,
});
const keyOf = (key: string | FakeRequest) => new URL(typeof key === "string" ? key : key.url, ORIGIN).href;

function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (key: string | FakeRequest) => store.get(keyOf(key))?.clone(),
      put: async (key: string | FakeRequest, response: Response) => void store.set(keyOf(key), response),
      addAll: async (keys: string[]) => keys.forEach((key) => store.set(keyOf(key), new Response(`asset ${key}`))),
      keys: async () => [...store.keys()].map((url) => ({ url })),
      delete: async (key: FakeRequest) => store.delete(keyOf(key)),
    };
  };
  return { stores, open, keys: async () => [...stores.keys()], delete: async (name: string) => stores.delete(name) };
}

/** A same-origin 200 response, as `fetch` would return it (Node's Response has type "default"). */
const ok = (body: string) => Object.defineProperty(new Response(body), "type", { value: "basic" });

function load() {
  const listeners = new Map<string, Listener>();
  const caches = fakeCaches();
  const fetch = vi.fn<(input: string | FakeRequest) => Promise<Response>>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };
  const sandbox = runInNewContext(`${source}\n;({ swRoute, staticAssetsIn })`, { self, caches, fetch, URL }) as {
    swRoute: (request: FakeRequest, origin: string) => Route;
    staticAssetsIn: (html: string) => string[];
  };

  /** Dispatches a fetch event; returns the response promise, or null if the worker passed. */
  const dispatchFetch = (req: FakeRequest) => {
    let responded: Promise<Response> | null = null;
    listeners.get("fetch")!({ request: req, respondWith: (p: Promise<Response>) => void (responded = p) });
    return responded as Promise<Response> | null;
  };
  const dispatchLifecycle = async (type: "install" | "activate") => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => void (done = p) });
    await done;
  };
  return { ...sandbox, caches, fetch, self, dispatchFetch, dispatchLifecycle };
}

let sw: ReturnType<typeof load>;
beforeEach(() => {
  sw = load();
});

describe("swRoute", () => {
  it.each([
    ["/api/session", "navigate"],
    ["/api/session", "cors"],
    ["/api/tmdb/search/movie?query=dune", "cors"],
    ["/api/tmdb/movie/1", "navigate"],
    ["/api", "navigate"],
  ])("never handles %s (%s)", (path, mode) => {
    expect(sw.swRoute(request(path, { mode }), ORIGIN)).toBeNull();
  });

  it("serves navigations network first", () => {
    expect(sw.swRoute(request("/", { mode: "navigate" }), ORIGIN)).toBe("navigate");
    expect(sw.swRoute(request("/title/show/1396", { mode: "navigate" }), ORIGIN)).toBe("navigate");
    expect(sw.swRoute(request("/apiary", { mode: "navigate" }), ORIGIN)).toBe("navigate");
  });

  it("serves hashed static assets cache first", () => {
    expect(sw.swRoute(request("/_next/static/chunks/app-abc123.js"), ORIGIN)).toBe("static");
    expect(sw.swRoute(request("/_next/static/media/inter.woff2", { mode: "no-cors" }), ORIGIN)).toBe("static");
  });

  it("passes through non-GET, cross-origin and other requests", () => {
    expect(sw.swRoute(request("/", { method: "POST", mode: "navigate" }), ORIGIN)).toBeNull();
    expect(sw.swRoute(request("/_next/static/chunks/a.js", { method: "HEAD" }), ORIGIN)).toBeNull();
    expect(sw.swRoute(request("https://image.tmdb.org/t/p/w342/a.jpg"), ORIGIN)).toBeNull();
    expect(sw.swRoute(request("https://evil.example/_next/static/a.js"), ORIGIN)).toBeNull();
    expect(sw.swRoute(request("/manifest.webmanifest"), ORIGIN)).toBeNull();
    expect(sw.swRoute(request("/library?_rsc=1"), ORIGIN)).toBeNull();
  });
});

describe("fetch handler", () => {
  it("never responds to or caches /api requests", () => {
    expect(sw.dispatchFetch(request("/api/session", { method: "POST" }))).toBeNull();
    expect(sw.dispatchFetch(request("/api/tmdb/movie/1"))).toBeNull();
    expect(sw.fetch).not.toHaveBeenCalled();
    expect(sw.caches.stores.size).toBe(0);
  });

  it("caches successful navigations and falls back to them offline", async () => {
    sw.fetch.mockResolvedValueOnce(ok("library page"));
    expect(await (await sw.dispatchFetch(request("/library", { mode: "navigate" }))!).text()).toBe("library page");
    sw.fetch.mockRejectedValueOnce(new TypeError("offline"));
    expect(await (await sw.dispatchFetch(request("/library", { mode: "navigate" }))!).text()).toBe("library page");
  });

  it("falls back to the cached shell for pages never visited", async () => {
    sw.fetch.mockResolvedValueOnce(ok("shell"));
    await sw.dispatchFetch(request("/", { mode: "navigate" }));
    sw.fetch.mockRejectedValueOnce(new TypeError("offline"));
    expect(await (await sw.dispatchFetch(request("/title/show/1396", { mode: "navigate" }))!).text()).toBe("shell");
  });

  it("does not cache error pages", async () => {
    sw.fetch.mockResolvedValueOnce(Object.defineProperty(new Response("down", { status: 500 }), "type", { value: "basic" }));
    expect((await sw.dispatchFetch(request("/stats", { mode: "navigate" }))!).status).toBe(500);
    sw.fetch.mockRejectedValueOnce(new TypeError("offline"));
    await expect(sw.dispatchFetch(request("/stats", { mode: "navigate" }))!).rejects.toThrow("offline");
  });

  it("serves static assets from the cache once fetched", async () => {
    sw.fetch.mockResolvedValueOnce(ok("chunk"));
    await sw.dispatchFetch(request("/_next/static/chunks/a.js"));
    expect(await (await sw.dispatchFetch(request("/_next/static/chunks/a.js"))!).text()).toBe("chunk");
    expect(sw.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("install and activate", () => {
  it("precaches the shell pages and the static assets they reference", async () => {
    sw.fetch.mockImplementation(async (path) => ok(`<script src="/_next/static/chunks/${String(path).slice(1) || "home"}.js"></script>`));
    await sw.dispatchLifecycle("install");
    const [shell, assets] = [...sw.caches.stores.values()];
    expect([...shell.keys()].map((url) => new URL(url).pathname)).toEqual(expect.arrayContaining(["/", "/library", "/about"]));
    expect([...assets.keys()]).toContain(`${ORIGIN}/_next/static/chunks/home.js`);
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  it("finds static assets in HTML and escaped RSC payloads", () => {
    const html = `<link href="/_next/static/css/a.css"><script>self.__next_f.push([1,"\\"/_next/static/chunks/b.js\\""])</script>`;
    expect(sw.staticAssetsIn(html)).toEqual(["/_next/static/css/a.css", "/_next/static/chunks/b.js"]);
  });

  it("deletes caches from older versions", async () => {
    await sw.caches.open("ryuuji-shell-v0");
    await sw.caches.open("someone-else");
    await sw.dispatchLifecycle("activate");
    expect(await sw.caches.keys()).not.toContain("ryuuji-shell-v0");
    expect(await sw.caches.keys()).toContain("someone-else");
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });
});
