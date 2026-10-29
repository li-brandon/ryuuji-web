// A minimal stand-in for the macOS UndoManager: each logging action registers one named step.

type UndoStep = { name: string; undo: () => Promise<void> };

export class UndoStack {
  private readonly steps: UndoStep[] = [];

  register(name: string, undo: () => Promise<void>): void {
    this.steps.push({ name, undo });
  }

  get canUndo(): boolean {
    return this.steps.length > 0;
  }

  /** The name of the step `undo()` would revert, e.g. "Log Episode". */
  get undoActionName(): string | undefined {
    return this.steps.at(-1)?.name;
  }

  /** Reverts the most recent step. Does nothing when the stack is empty. */
  async undo(): Promise<void> {
    await this.steps.pop()?.undo();
  }

  clear(): void {
    this.steps.length = 0;
  }
}
