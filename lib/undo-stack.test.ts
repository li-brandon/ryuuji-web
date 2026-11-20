import { describe, expect, it } from "vitest";
import { UndoStack } from "./undo-stack";

function recording() {
  const undone: string[] = [];
  const stack = new UndoStack();
  const register = (name: string) => stack.register(name, async () => void undone.push(name));
  return { stack, undone, register };
}

describe("UndoStack", () => {
  it("undo() reverts the most recent step first", async () => {
    const { stack, undone, register } = recording();
    register("a");
    register("b");
    await stack.undo();
    expect(undone).toEqual(["b"]);
    expect(stack.undoActionName).toBe("a");
  });

  it("a handle undoes its own step from the middle of the stack and leaves the rest", async () => {
    const { stack, undone, register } = recording();
    register("a");
    const b = register("b");
    register("c");
    await b.undo();
    expect(undone).toEqual(["b"]);
    expect(b.canUndo).toBe(false);
    expect(stack.size).toBe(2);
    await stack.undo();
    await stack.undo();
    expect(undone).toEqual(["b", "c", "a"]);
  });

  it("a handle does nothing once its step was undone", async () => {
    const { stack, undone, register } = recording();
    const a = register("a");
    expect(a.canUndo).toBe(true);
    await stack.undo();
    await a.undo();
    expect(undone).toEqual(["a"]);
    expect(a.canUndo).toBe(false);
  });

  it("top is a handle to the latest step", async () => {
    const { stack, undone, register } = recording();
    expect(stack.top).toBeUndefined();
    register("a");
    register("b");
    const top = stack.top;
    register("c");
    expect(top?.name).toBe("b");
    await top?.undo();
    expect(undone).toEqual(["b"]);
    expect(stack.undoActionName).toBe("c");
  });
});
