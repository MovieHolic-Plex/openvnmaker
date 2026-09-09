import { useState } from "react";
import {
  assertNever, parseProductionDocument, type CanonEntry, type ProductionDocument,
} from "@vnmaker/harness";

const CATEGORIES: readonly CanonEntry["category"][] = [
  "voice", "motivation", "world-fact", "timeline-event", "branch-fact", "foreshadow", "payoff", "visual-rule",
];
const TRUTHS = ["world", "belief", "rumour"] as const;
type TruthKind = (typeof TRUTHS)[number];

function sectionFor(category: CanonEntry["category"]): "castCanon" | "worldTimeline" | "branchFacts" | "artDirection" {
  switch (category) {
    case "voice": case "motivation": return "castCanon";
    case "branch-fact": return "branchFacts";
    case "visual-rule": return "artDirection";
    case "world-fact": case "timeline-event": case "foreshadow": case "payoff": return "worldTimeline";
    default: return assertNever(category);
  }
}

function appendEntry(document: ProductionDocument, entry: {
  readonly id: string; readonly category: CanonEntry["category"]; readonly text: string;
  readonly characterIds: readonly string[]; readonly sceneIds: readonly string[];
  readonly relatedEntryIds: readonly string[];
  readonly truth: { readonly kind: TruthKind; readonly holderCharacterId?: string };
  readonly applicability?: { readonly anyOf: readonly { readonly all: readonly string[] }[] };
}): ProductionDocument {
  const section = sectionFor(entry.category);
  const payload: unknown = {
    version: 1, brief: document.brief, outline: document.outline, referenceBindings: document.referenceBindings,
    castCanon: section === "castCanon" ? [...document.castCanon, entry] : document.castCanon,
    worldTimeline: section === "worldTimeline" ? [...document.worldTimeline, entry] : document.worldTimeline,
    branchFacts: section === "branchFacts" ? [...document.branchFacts, entry] : document.branchFacts,
    artDirection: section === "artDirection" ? [...document.artDirection, entry] : document.artDirection,
  };
  return parseProductionDocument(payload);
}

export function PlanCanonFields({
  document, onChange, onError,
}: {
  readonly document: ProductionDocument;
  readonly onChange: (document: ProductionDocument) => void;
  readonly onError: (message: string) => void;
}) {
  const [id, setId] = useState("");
  const [category, setCategory] = useState<CanonEntry["category"]>("world-fact");
  const [text, setText] = useState("");
  const [truth, setTruth] = useState<TruthKind>("world");
  const [holder, setHolder] = useState("");
  const [scenes, setScenes] = useState("");
  const [flag, setFlag] = useState("");
  const entries = [...document.castCanon, ...document.worldTimeline, ...document.branchFacts, ...document.artDirection];
  function add(): void {
    if (!id.trim() || !text.trim()) { onError("설정 ID와 본문이 필요합니다."); return; }
    if (truth === "belief" && !holder.trim()) { onError("믿음(belief)에는 주체 인물이 필요합니다."); return; }
    const sceneIds = scenes.split(",").map(value => value.trim()).filter(value => value.length > 0);
    const holderId = holder.trim();
    const truthValue = truth === "belief"
      ? { kind: "belief" as const, holderCharacterId: holderId }
      : { kind: truth, ...(holderId ? { holderCharacterId: holderId } : {}) };
    try {
      onChange(appendEntry(document, {
        id: id.trim(), category, text: text.trim(),
        characterIds: holderId ? [holderId] : [], sceneIds, relatedEntryIds: [],
        truth: truthValue,
        ...(flag.trim() ? { applicability: { anyOf: [{ all: [flag.trim()] }] } } : {}),
      }));
      setId(""); setText(""); setHolder(""); setScenes(""); setFlag("");
    } catch { onError("설정 항목을 저장하지 못했습니다."); }
  }
  return <div className="harness-plan-canon">
    <ul data-testid="harness-plan-canon-list">{entries.map(entry => <li
      key={entry.id} data-testid={`harness-plan-canon-${entry.id}`}
      data-truth={entry.truth?.kind ?? "world"} data-applicability={entry.applicability ? "branch" : "global"}
    >{entry.id}: {entry.text}</li>)}</ul>
    <ul data-testid="harness-plan-branch-facts">{document.branchFacts.map(entry => <li key={entry.id}>{entry.id}</li>)}</ul>
    <ul data-testid="harness-plan-art-direction">{document.artDirection.map(entry => <li key={entry.id}>{entry.id}</li>)}</ul>
    <div className="harness-plan-grid">
      <label>설정 ID<input data-testid="harness-plan-canon-id" value={id} maxLength={80} onChange={event => setId(event.target.value)} /></label>
      <label>분류<select data-testid="harness-plan-canon-category" value={category} onChange={event => { const next = CATEGORIES.find(item => item === event.target.value); if (next !== undefined) setCategory(next); }}>{CATEGORIES.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      <label>본문<textarea data-testid="harness-plan-canon-text" value={text} maxLength={2000} onChange={event => setText(event.target.value)} /></label>
      <label>진실 종류<select data-testid="harness-plan-canon-truth" value={truth} onChange={event => { const next = TRUTHS.find(item => item === event.target.value); if (next !== undefined) setTruth(next); }}>{TRUTHS.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      <label>주체 인물<input data-testid="harness-plan-canon-holder" value={holder} maxLength={80} onChange={event => setHolder(event.target.value)} /></label>
      <label>장면 ID<input data-testid="harness-plan-canon-scenes" value={scenes} onChange={event => setScenes(event.target.value)} /></label>
      <label>분기 조건<input data-testid="harness-plan-canon-applicability" value={flag} onChange={event => setFlag(event.target.value)} placeholder="flag" /></label>
      <button type="button" data-testid="harness-plan-canon-add" onClick={add}>설정 추가</button>
    </div>
  </div>;
}
