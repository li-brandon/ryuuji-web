// A minimal stand-in for the macOS UndoManager: each logging action registers one named step.

type UndoStep = { name: string; undo: () => Promise<void> };

/** One registered step, so a toast can undo exactly the action it names. */
export type UndoHandle = {
  readonly name: string;
  /** False once the step has been undone, by this handle or by `UndoStack.undo()`. */
  readonly canUndo: boolean;
  /** Removes this step from wherever it sits in the stack and reverts it; does nothing if already undone. */
  undo(): Promise<void>;
};

export class UndoStack {
  private readonly steps: UndoStep[] = [];

  register(name: string, undo: () => Promise<void>): UndoHandle {
    const step = { name, undo };
    this.steps.push(step);
    return this.handle(step);
  }

  /** How many steps are registered; compare before and after an action to see if it registered one. */
  get size(): number {
    return this.steps.length;
  }

  get canUndo(): boolean {
    return this.steps.length > 0;
  }

  /** The name of the step `undo()` would revert, e.g. "Log Episode". */
  get undoActionName(): string | undefined {
    return this.steps.at(-1)?.name;
  }

  /** A handle to the most recent step, e.g. the one an action just registered. */
  get top(): UndoHandle | undefined {
    const step = this.steps.at(-1);
    return step && this.handle(step);
  }

  /** Reverts the most recent step. Does nothing when the stack is empty. */
  async undo(): Promise<void> {
    await this.steps.pop()?.undo();
  }

  clear(): void {
    this.steps.length = 0;
  }

  private handle(step: UndoStep): UndoHandle {
    const steps = this.steps;
    return {
      name: step.name,
      get canUndo() {
        return steps.includes(step);
      },
      async undo() {
        const index = steps.indexOf(step);
        if (index === -1) return;
        steps.splice(index, 1);
        await step.undo();
      },
    };
  }
}
