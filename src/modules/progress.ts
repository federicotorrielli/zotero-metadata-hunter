// Cards injected into the main Zotero window, bottom-right: a live progress
// panel and an auto-dismissing result toast. Only one card exists at a time.

const XHTML = "http://www.w3.org/1999/xhtml";
const STYLE_ID = "metadatahunter-card-style";

// Auto-dismiss durations (ms); errors linger longer. Hover/focus pauses both.
const RESULT_TIMEOUT_OK = 6000;
const RESULT_TIMEOUT_ERROR = 9000;
const EXIT_MS = 280;

export interface ProgressPanel {
  update(percent: number, summary: string): void;
  close(): void;
}

function el(
  doc: any,
  tag: string,
  options: { className?: string; text?: string } = {},
): HTMLElement {
  const node = doc.createElementNS(XHTML, tag) as HTMLElement;
  if (options.className) node.className = options.className;
  if (options.text != null) node.textContent = options.text;
  return node;
}

function ensureStyle(doc: any): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = el(doc, "style");
  style.id = STYLE_ID;
  style.textContent = `
.mh-card{position:fixed;right:18px;bottom:18px;width:340px;max-width:calc(100vw - 36px);z-index:2147483647;background:rgba(250,250,250,.96);border:1px solid rgba(0,0,0,.16);border-radius:10px;box-shadow:0 18px 44px rgba(0,0,0,.24),0 2px 8px rgba(0,0,0,.12);font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2328;overflow:hidden;backdrop-filter:saturate(1.2) blur(18px);opacity:0;transform:translateY(12px) scale(.98);transition:opacity .22s cubic-bezier(.4,0,.2,1),transform .22s cubic-bezier(.4,0,.2,1)}
.mh-card.is-in{opacity:1;transform:none}
.mh-card.is-out{opacity:0;transform:translateY(12px) scale(.98)}
.mh-card-header{display:flex;align-items:flex-start;gap:10px;padding:12px}
.mh-card-progress .mh-card-header{padding-bottom:8px}
.mh-card-mark{width:20px;height:20px;border-radius:50%;background:#2563eb;box-shadow:inset 0 0 0 5px rgba(255,255,255,.72);flex:0 0 auto;margin-top:1px}
.mh-card.is-done .mh-card-mark{background:#16a34a}
.mh-card.is-error .mh-card-mark{background:#dc2626}
.mh-card-copy{min-width:0}
.mh-card-title{font-weight:650;font-size:13px;line-height:1.25;margin:0 0 3px}
.mh-card-body{font-size:12px;line-height:1.4;color:#5f6672;overflow-wrap:anywhere}
.mh-card-result .mh-card-body{white-space:pre-wrap;max-height:260px;overflow:auto}
.mh-card-close{appearance:none;border:0;background:transparent;color:#6b7280;font-size:17px;line-height:1;padding:0 2px;cursor:pointer;margin-left:auto;border-radius:4px}
.mh-card-close:hover{color:#111827}
.mh-progress-track{height:6px;background:#e7eaf0;border-radius:999px;overflow:hidden;margin:0 12px 12px}
.mh-progress-fill{height:100%;width:0%;background:linear-gradient(90deg,#2563eb,#14b8a6);border-radius:999px;transition:width .22s ease}
.mh-timeout-track{height:3px;background:rgba(0,0,0,.06)}
.mh-timeout-fill{height:100%;width:100%;background:#16a34a;opacity:.55}
.mh-card.is-error .mh-timeout-fill{background:#dc2626}
@media (prefers-reduced-motion: reduce){.mh-card{transition:none;opacity:1;transform:none}.mh-card.is-out{opacity:0}}
`;
  doc.documentElement.appendChild(style);
}

const clamp = (n: number): number => Math.min(Math.max(n, 0), 100);

// Plays the exit transition, then removes. Idempotent; falls back to a timer
// when no transition fires (reduced motion).
function dismiss(win: any, panel: HTMLElement): void {
  if (panel.dataset.mhClosing) return;
  panel.dataset.mhClosing = "1";
  panel.classList.remove("is-in");
  panel.classList.add("is-out");
  const remove = () => panel.remove();
  panel.addEventListener("transitionend", remove, { once: true });
  win.setTimeout(remove, EXIT_MS);
}

interface CardContent {
  title: string;
  body: string;
  dismissLabel: string;
}

interface Card {
  win: any;
  doc: any;
  panel: HTMLElement;
  bodyEl: HTMLElement;
}

// Mounts the shared shell, removing any existing card first. Null when there's
// no window to mount into.
function createCard(
  win: any,
  content: CardContent,
  variant: string,
): Card | null {
  const { title, body, dismissLabel } = content;
  const doc: any = win?.document;
  if (!doc?.documentElement) return null;

  ensureStyle(doc);
  for (const old of doc.querySelectorAll(".mh-card")) old.remove();

  const panel = el(doc, "div", { className: `mh-card ${variant}` });
  const header = el(doc, "div", { className: "mh-card-header" });
  const copy = el(doc, "div", { className: "mh-card-copy" });
  const bodyEl = el(doc, "div", { className: "mh-card-body", text: body });
  const closeBtn = el(doc, "button", { className: "mh-card-close", text: "×" });
  closeBtn.setAttribute("aria-label", dismissLabel);

  copy.appendChild(el(doc, "div", { className: "mh-card-title", text: title }));
  copy.appendChild(bodyEl);
  header.appendChild(el(doc, "div", { className: "mh-card-mark" }));
  header.appendChild(copy);
  header.appendChild(closeBtn);
  panel.appendChild(header);
  (doc.body || doc.documentElement).appendChild(panel);

  closeBtn.addEventListener("click", () => dismiss(win, panel));
  win.requestAnimationFrame(() => panel.classList.add("is-in"));
  return { win, doc, panel, bodyEl };
}

function createProgressPanel(win: any, content: CardContent): ProgressPanel {
  const card = createCard(win, content, "mh-card-progress");
  if (!card) return { update() {}, close() {} };

  const fill = el(card.doc, "div", { className: "mh-progress-fill" });
  const track = el(card.doc, "div", { className: "mh-progress-track" });
  track.appendChild(fill);
  card.panel.appendChild(track);

  return {
    update(percent: number, summary: string) {
      fill.style.width = clamp(percent) + "%";
      card.bodyEl.textContent = summary;
    },
    // Instant: the result card replaces this one in the same tick.
    close: () => card.panel.remove(),
  };
}

// Non-blocking result toast. Auto-dismisses after a countdown shown as a
// shrinking bar; hovering or focusing the card pauses it so it can be read.
function showResultPanel(
  win: any,
  content: CardContent,
  isError: boolean,
): void {
  const card = createCard(win, content, "mh-card-result");
  if (!card) return;
  const { doc, panel } = card;

  panel.classList.add(isError ? "is-error" : "is-done");
  panel.setAttribute("role", isError ? "alert" : "status");
  panel.setAttribute("aria-live", isError ? "assertive" : "polite");

  const fill = el(doc, "div", { className: "mh-timeout-fill" });
  const track = el(doc, "div", { className: "mh-timeout-track" });
  track.appendChild(fill);
  panel.appendChild(track);

  startCountdown(
    win,
    { panel, fill },
    isError ? RESULT_TIMEOUT_ERROR : RESULT_TIMEOUT_OK,
  );
}

// The bar shrinks over `duration` and the card dismisses itself at zero. Hovering
// or focusing the card pauses the countdown so the message can be read.
function startCountdown(
  win: any,
  { panel, fill }: { panel: HTMLElement; fill: HTMLElement },
  duration: number,
): void {
  let remaining = duration;
  let last = 0;
  let paused = false;

  const tick = (now: number) => {
    if (!panel.isConnected) return; // removed manually; stop the loop
    if (last === 0) last = now;
    if (!paused) {
      remaining -= now - last;
      fill.style.width = clamp((remaining / duration) * 100) + "%";
      if (remaining <= 0) return dismiss(win, panel);
    }
    last = now;
    win.requestAnimationFrame(tick);
  };
  win.requestAnimationFrame(tick);

  panel.addEventListener("mouseenter", () => (paused = true));
  panel.addEventListener("mouseleave", () => (paused = false));
  panel.addEventListener("focusin", () => (paused = true));
  panel.addEventListener("focusout", () => (paused = false));
}

export interface CardHost {
  createProgressPanel(title: string, hint: string): ProgressPanel;
  showResult(title: string, message: string, isError?: boolean): void;
}

// The cards mount into whatever window `getWindow` returns at the time, which may
// be none. `dismissLabel` is the translated accessible name of the close button.
export function createCardHost(
  getWindow: () => any,
  dismissLabel: string,
): CardHost {
  return {
    createProgressPanel: (title, hint) =>
      createProgressPanel(getWindow(), { title, body: hint, dismissLabel }),
    showResult: (title, message, isError = false) =>
      showResultPanel(
        getWindow(),
        { title, body: message, dismissLabel },
        isError,
      ),
  };
}
