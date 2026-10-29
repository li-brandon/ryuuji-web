import { expect, it } from "vitest";
import { deepEqual } from "./deep-equal";

it("ignores nested object key order but respects array order and values", () => {
  expect(deepEqual({ a: 1, b: [{ x: 2, y: 3 }] }, { b: [{ y: 3, x: 2 }], a: 1 })).toBe(true);
  expect(deepEqual([1, 2], [2, 1])).toBe(false);
  expect(deepEqual({ a: null }, {})).toBe(false);
  expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  expect(deepEqual([], {})).toBe(false);
});
