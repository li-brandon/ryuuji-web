import { expect, it } from "vitest";
import { deepEqual } from "./deep-equal";

it("ignores nested object key order but respects array order and values", () => {
  expect(deepEqual({ a: 1, b: [{ x: 2, y: 3 }] }, { b: [{ y: 3, x: 2 }], a: 1 })).toBe(true);
  expect(deepEqual([1, 2], [2, 1])).toBe(false);
  expect(deepEqual({ a: null }, {})).toBe(false);
  expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  expect(deepEqual([], {})).toBe(false);
});

it("ignores top-level and nested key order", () => {
  expect(deepEqual({ a: 1, b: 2, c: 3 }, { c: 3, a: 1, b: 2 })).toBe(true);
  expect(deepEqual({ x: { p: 1, q: { r: 2, s: 3 } }, y: [{ m: 1, n: 2 }] }, { y: [{ n: 2, m: 1 }], x: { q: { s: 3, r: 2 }, p: 1 } })).toBe(true);
  expect(deepEqual({ x: { p: 1, q: 2 } }, { x: { q: 2, p: 3 } })).toBe(false);
});

it.each([
  [{ a: 1 }, { a: 1, b: undefined }],
  [{ a: 1 }, { a: 1, b: 2 }],
  [{ x: { a: 1 } }, { x: { a: 1, b: undefined } }],
])("requires equal key counts: %o vs %o, both orders", (a, b) => {
  expect(deepEqual(a, b)).toBe(false);
  expect(deepEqual(b, a)).toBe(false);
});
