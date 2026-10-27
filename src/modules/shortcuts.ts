// Ctrl or Cmd plus Alt plus a letter. Returns the function that removes them.
export function installShortcuts(
  win: Window,
  bindings: Record<string, () => void>,
): () => void {
  const handler = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || !event.altKey) return;
    const run = bindings[event.key.toLowerCase()];
    if (!run) return;
    event.preventDefault();
    run();
  };
  win.addEventListener("keydown", handler);
  return () => win.removeEventListener("keydown", handler);
}
