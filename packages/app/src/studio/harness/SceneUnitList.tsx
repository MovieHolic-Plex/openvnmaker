import type { VnScript } from "@vnmaker/content";
import type { AuthorUnitView } from "../../api/harness.js";
import { StatusBadge, type QualityTone } from "./QualityReport.js";

function unitTone(status: string): QualityTone {
  switch (status) {
    case "ready": return "success";
    case "running": return "info";
    case "pending": return "incomplete";
    case "blocked": return "warning";
    case "failed": return "error";
    case "cancelled": return "limit";
    default: return "incomplete";
  }
}

export function SceneUnitList({
  script, units, onSelect,
}: {
  readonly script: VnScript;
  readonly units: readonly AuthorUnitView[];
  readonly onSelect?: (sceneId: string) => void;
}) {
  return <div className="harness-lists" data-testid="harness-scene-unit-list">
    <section>
      <h3>장면</h3>
      <ul>{script.scenes.map(scene => <li key={scene.id}>
        <button type="button" data-testid={`harness-scene-${scene.id}`} onClick={() => onSelect?.(scene.id)}>
          {scene.id}<small>{scene.lines.length}</small>
        </button>
      </li>)}</ul>
    </section>
    <section>
      <h3>작업 단위</h3>
      {units.length === 0 ? <p data-testid="harness-units-empty">pending units 0</p> : <ul>
        {units.map(unit => <li key={unit.id} data-testid={`harness-unit-${unit.id}`} data-status={unit.status}>
          <StatusBadge kind={unitTone(unit.status)} label={`${unit.kind}:${unit.status}`} testId={`harness-unit-status-${unit.id}`} />
          {unit.reason ?? unit.code ?? unit.id}
        </li>)}
      </ul>}
    </section>
  </div>;
}
