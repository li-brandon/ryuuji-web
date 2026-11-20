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

type Fetch = (input: string | FakeRequest) => Promise<Response>;

/** Like the Cache API's: fetches every key from the network, and stores none unless all are OK. */
function fakeCaches(fetch: Fetch) {
  const stores = new Map<string, Map<string, Response>>();
  const keysCalls = vi.fn<(name: string) => void>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (key: string | FakeRequest) => store.get(keyOf(key))?.clone(),
      put: async (key: string | FakeRequest, response: Response) => void store.set(keyOf(key), response),
      addAll: async (keys: string[]) => {
        const responses = await Promise.all(keys.map((key) => fetch(key)));
        const failed = responses.findIndex((response) => !response.ok);
        if (failed >= 0) throw new TypeError(`addAll: ${keys[failed]} failed`);
        responses.forEach((response, i) => store.set(keyOf(keys[i]), response));
      },
      keys: async () => {
        keysCalls(name);
        return [...store.keys()].map((url) => ({ url }));
      },
      delete: async (key: FakeRequest) => store.delete(keyOf(key)),
    };
  };
  return { stores, keysCalls, open, keys: async () => [...stores.keys()], delete: async (name: string) => stores.delete(name) };
}

/** A same-origin 200 response, as `fetch` would return it (Node's Response has type "default"). */
const ok = (body: string) => Object.defineProperty(new Response(body), "type", { value: "basic" });
/** A 200 that followed a redirect. */
const redirected = (body: string) => Object.defineProperty(ok(body), "redirected", { value: true });
/** A no-cors ("opaque") or manual-redirect ("opaqueredirect") response: status 0, unreadable. */
const opaque = (type: "opaque" | "opaqueredirect") =>
  Object.defineProperties(new Response(null), { type: { value: type }, status: { value: 0 }, ok: { value: false } });

function load() {
  const listeners = new Map<string, Listener>();
  const fetch = vi.fn<Fetch>();
  const caches = fakeCaches(fetch);
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };
  const sandbox = runInNewContext(`${source}\n;({ swRoute, staticAssetsIn, MAX_STATIC_ENTRIES, STATIC_CACHE })`, {
    self,
    caches,
    fetch,
    URL,
  }) as {
    swRoute: (request: FakeRequest, origin: string) => Route;
    staticAssetsIn: (html: string) => string[];
    MAX_STATIC_ENTRIES: number;
    STATIC_CACHE: string;
  };

  // Promises passed to fetch events' waitUntil, so tests can wait for background work.
  const extended: Promise<unknown>[] = [];
  /** Dispatches a fetch event; returns the response promise, or null if the worker passed. */
  const dispatchFetch = (req: FakeRequest) => {
    let responded: Promise<Response> | null = null;
    listeners.get("fetch")!({
      request: req,
      respondWith: (p: Promise<Response>) => void (responded = p),
      waitUntil: (p: Promise<unknown>) => void extended.push(p),
    });
    return responded as Promise<Response> | null;
  };
  /** Waits for every fetch event's response and background work so far. */
  const settled = async (responses: (Promise<Response> | null)[] = []) => {
    await Promise.all(responses);
    await Promise.all(extended);
  };
  /** Paths in the static cache, oldest first. */
  const staticPaths = () => [...(caches.stores.get(sandbox.STATIC_CACHE)?.keys() ?? [])].map((url) => new URL(url).pathname);
  const dispatchLifecycle = async (type: "install" | "activate") => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => void (done = p) });
    await done;
  };
  return { ...sandbox, caches, fetch, self, dispatchFetch, dispatchLifecycle, settled, staticPaths };
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

  it.each([
    ["redirected", () => redirected("login page")],
    ["opaqueredirect", () => opaque("opaqueredirect")],
  ])("does not cache %s navigations", async (_, response) => {
    sw.fetch.mockResolvedValueOnce(response());
    await sw.settled([sw.dispatchFetch(request("/library", { mode: "navigate" }))]);
    expect([...sw.caches.stores.values()].every((store) => store.size === 0)).toBe(true);
    sw.fetch.mockRejectedValueOnce(new TypeError("offline"));
    await expect(sw.dispatchFetch(request("/library", { mode: "navigate" }))!).rejects.toThrow("offline");
  });

  it.each([
    ["redirected", () => redirected("chunk")],
    ["opaque", () => opaque("opaque")],
    ["opaqueredirect", () => opaque("opaqueredirect")],
    ["cross-origin (cors)", () => Object.defineProperty(new Response("chunk"), "type", { value: "cors" })],
  ])("does not cache %s static assets", async (_, response) => {
    sw.fetch.mockResolvedValueOnce(response()).mockResolvedValueOnce(response());
    await sw.settled([sw.dispatchFetch(request("/_next/static/chunks/a.js"))]);
    await sw.settled([sw.dispatchFetch(request("/_next/static/chunks/a.js"))]);
    expect(sw.fetch).toHaveBeenCalledTimes(2);
    expect(sw.staticPaths()).toEqual([]);
  });
});

describe("static cache size", () => {
  const chunk = (i: number) => `/_next/static/chunks/${i}.js`;
  const fill = async (from: number, to: number) => {
    for (let i = from; i < to; i++) await sw.settled([sw.dispatchFetch(request(chunk(i)))]);
  };
  beforeEach(() => sw.fetch.mockImplementation(async (input) => ok(`chunk ${String(input)}`)));

  it("is trimmed oldest first as assets are fetched, without an activate", async () => {
    await fill(0, sw.MAX_STATIC_ENTRIES);
    expect(sw.staticPaths()).toHaveLength(sw.MAX_STATIC_ENTRIES);
    await sw.settled([0, 1, 2].map((i) => sw.dispatchFetch(request(chunk(sw.MAX_STATIC_ENTRIES + i)))));
    const paths = sw.staticPaths();
    expect(paths).toHaveLength(sw.MAX_STATIC_ENTRIES);
    expect(paths).not.toContain(chunk(2));
    expect(paths[0]).toBe(chunk(3));
    expect(paths.slice(-3)).toEqual([0, 1, 2].map((i) => chunk(sw.MAX_STATIC_ENTRIES + i)));
  });

  it("runs one trim for a burst of concurrent cache misses", async () => {
    await fill(0, sw.MAX_STATIC_ENTRIES);
    sw.caches.keysCalls.mockClear();
    await sw.settled(Array.from({ length: 10 }, (_, i) => sw.dispatchFetch(request(chunk(sw.MAX_STATIC_ENTRIES + i)))));
    expect(sw.staticPaths()).toHaveLength(sw.MAX_STATIC_ENTRIES);
    expect(sw.staticPaths()[0]).toBe(chunk(10));
    expect(sw.caches.keysCalls.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("is trimmed after precaching, without an activate", async () => {
    const assets = Array.from({ length: sw.MAX_STATIC_ENTRIES + 5 }, (_, i) => `<script src="${chunk(i)}"></script>`).join("");
    sw.fetch.mockImplementation(async (input) => ok(input === "/" ? assets : String(input)));
    await sw.dispatchLifecycle("install");
    expect(sw.staticPaths()).toHaveLength(sw.MAX_STATIC_ENTRIES);
    expect(sw.staticPaths()[0]).toBe(chunk(5));
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

  describe("fails, without skipping waiting, when precaching fails", () => {
    const shell = async (input: string | FakeRequest) => ok(`<script src="/_next/static/chunks/${String(input).slice(1) || "home"}.js"></script>`);

    it.each([
      ["an error page", () => Object.defineProperty(new Response("down", { status: 500 }), "type", { value: "basic" })],
      ["a redirect", () => redirected("login page")],
      ["an opaque redirect", () => opaque("opaqueredirect")],
    ])("a shell page is %s", async (_, response) => {
      sw.fetch.mockImplementation(async (input) => (input === "/library" ? response() : shell(input)));
      await expect(sw.dispatchLifecycle("install")).rejects.toThrow("Precache failed for /library");
      expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    });

    it("a static asset fails to load", async () => {
      sw.fetch.mockImplementation(async (input) =>
        input === "/_next/static/chunks/stats.js" ? new Response("gone", { status: 404 }) : shell(input),
      );
      await expect(sw.dispatchLifecycle("install")).rejects.toThrow("/_next/static/chunks/stats.js");
      expect(sw.self.skipWaiting).not.toHaveBeenCalled();
      expect(sw.staticPaths()).toEqual([]);
    });

    it("the network is down", async () => {
      sw.fetch.mockImplementation(async (input) => (input === "/settings" ? Promise.reject(new TypeError("offline")) : shell(input)));
      await expect(sw.dispatchLifecycle("install")).rejects.toThrow("offline");
      expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    });
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
