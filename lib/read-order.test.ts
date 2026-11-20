import { expect, it } from "vitest";
import { readOrder } from "./read-order";

it("lets a read started by a notice during the initial load win when the initial snapshot lands first", () => {
  const order = readOrder();
  let titles = "none";
  const initial = order.start();
  const notice = order.start();
  expect(order.apply(initial, () => { titles = "initial"; })).toBe(true);
  expect(order.apply(notice, () => { titles = "after notice"; })).toBe(true);
  expect(titles).toBe("after notice");
});

it("drops the older initial snapshot when the later-started read finishes first", () => {
  const order = readOrder();
  let titles = "none";
  const initial = order.start();
  const notice = order.start();
  expect(order.apply(notice, () => { titles = "after notice"; })).toBe(true);
  expect(order.apply(initial, () => { titles = "initial"; })).toBe(false);
  expect(titles).toBe("after notice");
});

it("keeps a local add over reads that started before it but lets later reads apply", () => {
  const order = readOrder();
  let titles: string[] = [];
  const before = order.start();
  // The add takes its sequence once its write has committed, as it applies.
  expect(order.apply(order.start(), () => { titles = [...titles, "added"]; })).toBe(true);
  expect(order.apply(before, () => { titles = []; })).toBe(false);
  expect(titles).toEqual(["added"]);
  const after = order.start();
  expect(order.apply(after, () => { titles = ["added", "other tab"]; })).toBe(true);
  expect(titles).toEqual(["added", "other tab"]);
});
