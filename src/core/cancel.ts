export class CancelToken {
  requested = false;

  cancel(): void {
    this.requested = true;
  }
}

// Holds the run in progress. Only one run exists at a time, and every entry point
// (menus, toolbar, shortcuts) starts or cancels it through here.
export class RunController {
  private active: CancelToken | null = null;

  constructor(private readonly onChange: () => void) {}

  get isProcessing(): boolean {
    return this.active !== null;
  }

  stop(): void {
    this.active?.cancel();
  }

  // Starts the action, or cancels the run in progress.
  toggle(start: () => void): void {
    if (this.active) {
      this.stop();
    } else {
      start();
    }
  }

  // Runs the job unless another one is active, and reports the change before and
  // after so the toolbar can follow.
  async run(job: (cancel: CancelToken) => Promise<void>): Promise<void> {
    if (this.active) return;
    const cancel = new CancelToken();
    this.active = cancel;
    this.onChange();
    try {
      await job(cancel);
    } finally {
      this.active = null;
      this.onChange();
    }
  }
}
