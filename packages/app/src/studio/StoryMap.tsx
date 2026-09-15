import { memo, useMemo, useState } from "react";
import type { VnScript } from "@vnmaker/content";
import { backgroundSrc, sceneTitle } from "./project.js";

const NODE_W = 245, NODE_H = 178, PAD_X = 36, PAD_Y = 32, BAND_GAP = 90;

/**
 * 깊이(시작 씬에서의 거리) 순서로 아래로 흐르되, 장편에서는 깊이를 여러 띠로 감아 한 화면에 담는다.
 * 256개가 한 줄로 이어진 장편이 4만 px 세로 띠가 되던 것을 막는다. 띠 안에서는 같은 깊이의 형제를 가로로 편다.
 */
export function layoutStoryMap(script: VnScript): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  const depth = new Map<string, number>([[script.start, 0]]);
  const byId = new Map(script.scenes.map(scene => [scene.id, scene]));
  const queue = [script.start];
  for (let i = 0; i < queue.length; i++) {
    const scene = byId.get(queue[i]!);
    if (!scene) continue;
    const targets = scene.choices?.length ? scene.choices.map(choice => choice.next) : !scene.ending && scene.next ? [scene.next] : [];
    for (const target of targets) if (!depth.has(target) && byId.has(target)) { depth.set(target, depth.get(scene.id)! + 1); queue.push(target); }
  }
  let unreachable = 0;
  for (const scene of script.scenes) if (!depth.has(scene.id)) depth.set(scene.id, ++unreachable + Math.max(-1, ...depth.values()));
  const levels = Math.max(1, ...[...depth.values()].map(value => value + 1));
  const rowsPerBand = Math.max(4, Math.min(levels, Math.ceil(Math.sqrt(levels * 1.5))));
  const siblings = new Map<number, number>();
  for (const level of depth.values()) siblings.set(level, (siblings.get(level) ?? 0) + 1);
  const bandWidth: number[] = [];
  for (let level = 0; level < levels; level++) { const band = Math.floor(level / rowsPerBand); bandWidth[band] = Math.max(bandWidth[band] ?? 0, (siblings.get(level) ?? 0) * NODE_W); }
  const bandX: number[] = []; let x = PAD_X;
  for (const width of bandWidth) { bandX.push(x); x += Math.max(width, NODE_W) + BAND_GAP; }
  const counts = new Map<number, number>();
  const positions = new Map(script.scenes.map(scene => {
    const level = depth.get(scene.id) ?? 0;
    const column = counts.get(level) ?? 0;
    counts.set(level, column + 1);
    return [scene.id, { x: (bandX[Math.floor(level / rowsPerBand)] ?? PAD_X) + column * NODE_W, y: PAD_Y + (level % rowsPerBand) * NODE_H }];
  }));
  const width = Math.max(520, ...[...positions.values()].map(pos => pos.x + NODE_W));
  const height = Math.max(400, ...[...positions.values()].map(pos => pos.y + NODE_H - 3));
  return { positions, width, height };
}

export const StoryMap = memo(function StoryMap({ script, selected, onSelect }: { script: VnScript; selected: string; onSelect: (id: string) => void }) {
  const [zoom, setZoom] = useState(0.85);
  const { positions, width, height } = useMemo(() => layoutStoryMap(script), [script]);
  return <section className="graph-view"><div className="view-heading"><div><p className="eyebrow">EVERY CHOICE MATTERS</p><h2>이야기가 흐르는 길</h2><p>씬을 누르면 해당 장면으로 이동합니다.</p></div><div className="zoom-control"><button aria-label="스토리 맵 축소" onClick={() => setZoom(Math.max(0.45, zoom - 0.1))}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="스토리 맵 확대" onClick={() => setZoom(Math.min(1.25, zoom + 0.1))}>+</button></div></div><div className="graph-scroll"><div style={{ width: width * zoom, height: height * zoom }}><div className="graph-canvas" data-testid="graph-canvas" style={{ width, height, transform: `scale(${zoom})` }}><svg className="graph-edges" width={width} height={height} aria-hidden="true"><defs><marker id="edge-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="#9a83d8" /></marker></defs>{script.scenes.flatMap(scene => {
    const from = positions.get(scene.id)!;
    return (scene.choices?.length ? scene.choices.map(choice => choice.next) : !scene.ending && scene.next ? [scene.next] : []).map((id, index) => {
      const to = positions.get(id); if (!to) return null;
      return <path key={`${scene.id}-${id}-${index}`} d={`M${from.x + 105} ${from.y + 127} C${from.x + 105} ${from.y + 157}, ${to.x + 105} ${to.y - 30}, ${to.x + 105} ${to.y}`} fill="none" stroke={scene.choices?.length ? "#b497ed" : "#66557f"} strokeWidth="1.8" markerEnd="url(#edge-arrow)" />;
    });
  })}</svg>{script.scenes.map((scene, index) => { const pos = positions.get(scene.id)!; return <button key={scene.id} className={`graph-node ${selected === scene.id ? "is-selected" : ""}`} style={{ left: pos.x, top: pos.y }} onClick={() => onSelect(scene.id)} data-testid={`graph-node-${scene.id}`}><img src={backgroundSrc(scene)} alt="" loading="lazy" /><div><span>{String(index + 1).padStart(2, "0")} / {scene.id === script.start ? "START" : scene.ending ? "ENDING" : scene.choices?.length ? "BRANCH" : "SCENE"}</span><strong>{sceneTitle(scene)}</strong><small>{scene.lines.length}줄 {scene.choices?.length ? `· 선택지 ${scene.choices.length}개` : ""}</small></div></button>; })}</div></div></div></section>;
});
