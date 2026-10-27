import { describe, expect, it, vi } from "vitest";
import type { Http } from "../src/net/http";
import {
  createDblpPool,
  DEFAULT_HOST,
  PUBLIC_HOSTS,
  RETRY_PAUSE_MS,
} from "../src/sources/dblp";

const OK = { result: { hits: { hit: [] } } };

function setup(
  handler: (url: string) => unknown,
  userHost: string | null = null,
) {
  const calls: string[] = [];
  const http = {
    getJson: async (url: string) => {
      calls.push(url);
      const value = await handler(url);
      if (value instanceof Error) throw value;
      return value;
    },
  } as unknown as Http;
  const state = { userHost, time: 0 };
  const pool = createDblpPool({
    http,
    readUserHost: () => state.userHost,
    now: () => state.time,
    log: vi.fn(),
  });
  const hosts = () => calls.map((url) => new URL(url).origin);
  return { pool, state, calls, hosts };
}

const down =
  (...bad: string[]) =>
  (url: string) =>
    bad.some((host) => url.startsWith(host)) ? new Error("down") : OK;

describe("createDblpPool", () => {
  it("uses the default host when it is healthy and keeps it", async () => {
    const { pool, hosts } = setup(() => OK);
    await pool.search("a");
    await pool.search("b");
    expect(hosts()).toEqual([DEFAULT_HOST, DEFAULT_HOST, DEFAULT_HOST]);
  });

  it("checks the user host before the default host", async () => {
    const user = "https://dblp.mine.org";
    const { pool, hosts } = setup(() => OK, user);
    await pool.search("a");
    expect(hosts()[0]).toBe(user);
    expect(hosts()).not.toContain(DEFAULT_HOST);
  });

  it("moves from a failing user host to the default host", async () => {
    const user = "https://dblp.mine.org";
    const { pool, hosts } = setup(down(user), user);
    await pool.search("a");
    expect(hosts()).toEqual([user, DEFAULT_HOST, DEFAULT_HOST]);
  });

  it("races the public hosts when the preferred ones fail", async () => {
    const { pool, hosts } = setup(down(DEFAULT_HOST));
    await pool.search("a");
    const checked = hosts().slice(1, 4);
    expect(new Set(checked)).toEqual(new Set(PUBLIC_HOSTS));
  });

  it("sets a host aside after a query error and takes the next one", async () => {
    let queries = 0;
    const { pool, hosts } = setup((url) =>
      url.includes("h=5") && queries++ === 0 ? new Error("500") : OK,
    );
    await pool.search("a");
    await pool.search("b");
    const [first, second, third] = ["org", "dagstuhl.de", "uni-trier.de"].map(
      (suffix) => `https://dblp.${suffix}`,
    );
    // Default host checked and failed on its query, then the three public hosts
    // are checked together, and the next queries stay on whichever answered first.
    expect(hosts().slice(0, 2)).toEqual([DEFAULT_HOST, DEFAULT_HOST]);
    expect(hosts().slice(2, 5).sort()).toEqual([first, second, third].sort());
    const chosen = hosts()[5];
    expect(PUBLIC_HOSTS).toContain(chosen);
    expect(hosts().slice(5)).toEqual([chosen, chosen]);
  });

  it("pauses for a minute once every host is down, then tries again", async () => {
    const { pool, state, calls } = setup(() => new Error("down"));
    await expect(pool.search("a")).rejects.toThrow("no DBLP host is reachable");
    const afterFirst = calls.length;
    await expect(pool.search("b")).rejects.toThrow(
      "waiting before the next attempt",
    );
    expect(calls).toHaveLength(afterFirst);

    state.time += RETRY_PAUSE_MS;
    await expect(pool.search("c")).rejects.toThrow("no DBLP host is reachable");
    expect(calls.length).toBeGreaterThan(afterFirst);
  });

  it("starts over when the preferences host changes", async () => {
    const { pool, state, hosts } = setup(() => OK);
    await pool.search("a");
    state.userHost = "https://dblp.mine.org";
    await pool.search("b");
    expect(hosts()).toContain("https://dblp.mine.org");
    expect(hosts().at(-1)).toBe("https://dblp.mine.org");
  });

  it("shares one health check between concurrent searches", async () => {
    const { pool, calls } = setup(() => OK);
    await Promise.all([pool.search("a"), pool.search("b"), pool.search("c")]);
    const checks = calls.filter((url) => url.includes("h=1"));
    expect(checks).toHaveLength(1);
  });

  it("rejects a host that answers without a result block", async () => {
    const { pool, hosts } = setup((url) =>
      url.startsWith(DEFAULT_HOST) ? { html: true } : OK,
    );
    await pool.search("a");
    expect(hosts()[0]).toBe(DEFAULT_HOST);
    expect(hosts().at(-1)).not.toBe(DEFAULT_HOST);
  });

  it("ignores a health check that a preference edit outdated", async () => {
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => (release = resolve));
    const { pool, state, hosts } = setup((url) =>
      url.startsWith(DEFAULT_HOST) && url.includes("h=1") ? gate : OK,
    );
    const first = pool.search("a");
    state.userHost = "https://dblp.mine.org";
    const second = pool.search("b");
    await second;
    release(OK);
    await first;
    expect(
      hosts().filter((h) => h === "https://dblp.mine.org").length,
    ).toBeGreaterThan(1);
    await pool.search("c");
    expect(hosts().at(-1)).toBe("https://dblp.mine.org");
  });
});
