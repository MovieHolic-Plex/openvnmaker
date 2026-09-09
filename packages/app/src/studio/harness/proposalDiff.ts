import type { Line, Scene, VnScript } from "@vnmaker/content";

export type ProposalDiffRow = {
  readonly id: string;
  readonly scope: "source" | "candidate";
  readonly field: string;
  readonly before: string;
  readonly after: string;
};

export type DiffWork = {
  readonly rows: readonly ProposalDiffRow[];
  readonly scenesCompared: number;
  readonly linesCopied: number;
  readonly scenesCopied: number;
  readonly clonedWholeScript: boolean;
};

export type LineTextOperation = {
  readonly sceneId: string;
  readonly lineIndex: number;
  readonly text: string;
};

export type LinePatchWork = {
  readonly script: VnScript;
  readonly scenesCopied: number;
  readonly linesCopied: number;
  readonly clonedWholeScript: boolean;
};

function totalLines(script: VnScript): number {
  let count = 0;
  for (const scene of script.scenes) count += scene.lines.length;
  return count;
}

function rowId(scene: Scene, line: Line | undefined, index: number): string {
  if (line?.id !== undefined) return line.id;
  return `${scene.id}:${index}`;
}

export function applyLineOperations(
  script: VnScript,
  operations: readonly LineTextOperation[],
): LinePatchWork {
  if (operations.length === 0) {
    return { script, scenesCopied: 0, linesCopied: 0, clonedWholeScript: false };
  }
  const grouped = new Map<string, Map<number, string>>();
  for (const operation of operations) {
    const current = grouped.get(operation.sceneId) ?? new Map<number, string>();
    current.set(operation.lineIndex, operation.text);
    grouped.set(operation.sceneId, current);
  }
  let scenesCopied = 0;
  let linesCopied = 0;
  const scenes = script.scenes.map(scene => {
    const sceneOps = grouped.get(scene.id);
    if (sceneOps === undefined) return scene;
    scenesCopied += 1;
    const lines = scene.lines.map((line, index) => {
      const text = sceneOps.get(index);
      if (text === undefined) return line;
      linesCopied += 1;
      return { ...line, text };
    });
    return { ...scene, lines };
  });
  return {
    script: { ...script, scenes },
    scenesCopied,
    linesCopied,
    clonedWholeScript: scenesCopied === script.scenes.length && linesCopied === totalLines(script),
  };
}

export function collectProposalDiffWork(source: VnScript, candidate: VnScript): DiffWork {
  const rows: ProposalDiffRow[] = [];
  let scenesCompared = 0;
  let linesCopied = 0;
  let scenesCopied = 0;
  if (source.title !== candidate.title) {
    rows.push({ id: "title", scope: "candidate", field: "title", before: source.title, after: candidate.title });
  }
  const sourceById = new Map<string, Scene>();
  for (const scene of source.scenes) sourceById.set(scene.id, scene);
  const candidateIds = new Set<string>();
  for (const scene of candidate.scenes) {
    candidateIds.add(scene.id);
    const previous = sourceById.get(scene.id);
    if (previous === undefined) {
      scenesCopied += 1;
      rows.push({ id: scene.id, scope: "candidate", field: "scene", before: "", after: scene.id });
      continue;
    }
    if (previous === scene) continue;
    scenesCompared += 1;
    const max = Math.max(previous.lines.length, scene.lines.length);
    let changed = false;
    for (let index = 0; index < max; index++) {
      const beforeLine = previous.lines[index];
      const afterLine = scene.lines[index];
      if (beforeLine === afterLine) continue;
      const beforeText = beforeLine?.text ?? "";
      const afterText = afterLine?.text ?? "";
      if (beforeText === afterText) continue;
      if (beforeLine !== undefined) linesCopied += 1;
      if (afterLine !== undefined) linesCopied += 1;
      changed = true;
      rows.push({
        id: rowId(scene, afterLine ?? beforeLine, index),
        scope: "candidate", field: "lines", before: beforeText, after: afterText,
      });
    }
    if (changed) scenesCopied += 1;
  }
  for (const scene of source.scenes) {
    if (candidateIds.has(scene.id)) continue;
    scenesCopied += 1;
    rows.push({ id: scene.id, scope: "source", field: "scene", before: scene.id, after: "" });
  }
  return {
    rows, scenesCompared, linesCopied, scenesCopied,
    clonedWholeScript: scenesCopied === source.scenes.length && linesCopied >= totalLines(source),
  };
}

export function collectProposalDiffs(source: VnScript, candidate: VnScript): readonly ProposalDiffRow[] {
  return collectProposalDiffWork(source, candidate).rows;
}
