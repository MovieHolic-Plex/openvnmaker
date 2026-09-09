export const HARNESS_UI_EVENT = {
  ready: "vnmaker:harness-workspace-ready",
  run: "vnmaker:harness-run",
  plan: "vnmaker:harness-plan",
  candidate: "vnmaker:harness-candidate",
  preview: "vnmaker:harness-preview",
  boundary: "vnmaker:harness-boundary",
  disconnected: "vnmaker:harness-disconnected",
  repropose: "vnmaker:harness-repropose",
  conflict: "vnmaker:harness-conflict",
  admission: "vnmaker:harness-admission",
} as const;

export type HarnessUiEvent = keyof typeof HARNESS_UI_EVENT;

export function emitHarnessUi(type: HarnessUiEvent, detail: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(HARNESS_UI_EVENT[type], { detail }));
}

const RUN_KEY = "vnmaker.harness.active-run.v1";

export function persistActiveRun(projectId: string, runId: string): void {
  try { localStorage.setItem(RUN_KEY, JSON.stringify({ projectId, runId })); } catch { /* storage is reported by studio save */ }
}

export function readActiveRun(projectId: string): string | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RUN_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return null;
    const row = raw as { readonly projectId?: unknown; readonly runId?: unknown };
    return row.projectId === projectId && typeof row.runId === "string" ? row.runId : null;
  } catch { return null; }
}

export function candidateStorageKey(runId: string): string {
  return `vnmaker.harness.candidate.${runId}`;
}
