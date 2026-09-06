import {test} from "node:test";
import assert from "node:assert/strict";
import {compareNativeManuscripts} from "../src/studio/nativeCompatibility.js";
import {arithmeticStory as story} from "./fixtures/arithmetic-story.js";
import type {Choice, Line, VnScript} from "@vnmaker/content";
import type {CompatibilityAnalysis, CompatibilityIssue} from "../src/studio/nativeCompatibility.js";

test("music fade is a playback review with equivalent omitted/default values normalized",()=>{
  assert.equal(compareNativeManuscripts(story,{...story,musicFadeSeconds:1.2}).status,"no-detected-changes");
  const result=compareNativeManuscripts(story,{...story,musicFadeSeconds:0});assert.equal(result.status,"requires-review");assert.deepEqual(result.issues.map(issue=>issue.code),["music-fade"]);assert.match(result.issues[0]!.message,/1.2초에서 0초/);
});

test("reordered or shortened menus still report changed surviving choice logic",()=>{
  const original=story.scenes[0]!,choices=original.choices!;
  const source={...story,scenes:[{...original,choices:[{...choices[0]!,text:"A"},{...choices[1]!,text:"B"}]},...story.scenes.slice(1)]};
  const mutate=(rows:typeof choices)=>({...source,scenes:[{...source.scenes[0]!,choices:rows},...source.scenes.slice(1)]});
  const reversed=[...source.scenes[0]!.choices!].reverse();
  assert.deepEqual(compareNativeManuscripts(source,mutate(reversed)).issues.map(issue=>issue.code),["choice-order"]);
  const changed=[{...reversed[0]!,add:{trust:99}},reversed[1]!];
  const reordered=compareNativeManuscripts(source,mutate(changed));assert.ok(reordered.issues.some(issue=>issue.code==="choice-order"));assert.ok(reordered.issues.some(issue=>issue.code==="choice-logic"&&issue.scope.endsWith("선택 1")));
  const shortened=compareNativeManuscripts(source,mutate([changed[0]!]));assert.ok(shortened.issues.some(issue=>issue.code==="choice-count"));assert.ok(shortened.issues.some(issue=>issue.code==="choice-logic"));
});

test("unchanged manuscripts and object key ordering never claim runtime compatibility",()=>{
  const result=compareNativeManuscripts(story,structuredClone(story));assert.equal(result.status,"no-detected-changes");assert.deepEqual(result.counts,{high:0,review:0,info:0});assert.match(result.limitations[0]!,/보장하지/);assert.equal("compatible" in result,false);
  const first={...story,flags:{a:1,b:true}},second={...story,flags:{b:true,a:1}};assert.equal(compareNativeManuscripts(first,second).issues.length,0);
});
test("state deletion, type changes and defaults explain how old earned values behave",()=>{
  const before={...story,flags:{removed:true,trust:2,label:"old"}},after={...story,flags:{trust:"two",label:"new",bonus:7}};
  const result=compareNativeManuscripts(before,after),codes=result.issues.map(issue=>issue.code);
  assert.deepEqual(new Set(codes),new Set(["flag-removed","flag-type","flag-default","flag-added"]));assert.deepEqual(result.counts,{high:2,review:1,info:1});assert.equal(result.status,"requires-review");
});
test("scene deletion and dialogue/choice reordering are distinguished from pure text edits",()=>{
  const before:VnScript={...story,scenes:story.scenes.map((scene,index)=>index?scene:{...scene,lines:[{speaker:null,text:"A"},{speaker:null,text:"B"},{speaker:null,text:"A"}]})};
  const reordered:VnScript={...before,scenes:before.scenes.filter(scene=>scene.id!=="ordinary").map((scene,index)=>index?scene:{...scene,lines:[scene.lines[1]!,scene.lines[0]!,scene.lines[2]!],choices:[...scene.choices!].reverse()})};
  const codes=compareNativeManuscripts(before,reordered).issues.map(issue=>issue.code);for(const code of ["scene-removed","line-order","choice-order"])assert.ok(codes.includes(code));
  const edited={...before,scenes:before.scenes.map((scene,index)=>index?scene:{...scene,lines:scene.lines.map(line=>({...line,text:line.text+" revised"}))})};
  const text=compareNativeManuscripts(before,edited);assert.equal(text.counts.high,0);assert.ok(text.issues.some(issue=>issue.code==="dialogue-changed"));
  const inserted={...before,scenes:before.scenes.map((scene,index)=>index?scene:{...scene,lines:[{speaker:null,text:"new"},...scene.lines]})};assert.ok(compareNativeManuscripts(before,inserted).issues.some(issue=>issue.code==="line-count"));
});
test("branch effects, exit changes and actor ordinal changes require review",()=>{
  const actors=[{id:"a",name:"A",bio:"",color:"#ffffff"},{id:"b",name:"B",bio:"",color:"#ffffff"}];
  const before={...story,characters:actors},after={...before,characters:[...actors].reverse(),scenes:before.scenes.map((scene,index)=>index?scene:{...scene,choices:scene.choices!.map(choice=>({...choice,add:{trust:10}})),next:"secret"})};
  const codes=compareNativeManuscripts(before,after).issues.map(issue=>issue.code);for(const code of ["choice-logic","scene-exit","actor-order"])assert.ok(codes.includes(code));
});
test("bounded reports retain high-priority findings and count omissions without claiming success",()=>{
  const original=story.scenes[0];assert.ok(original);
  const base:VnScript={...story,scenes:Array.from({length:800},(_,index)=>({...original,id:`scene-${index}`,choices:[]}))};
  const changed={...base,scenes:base.scenes.filter((_,index)=>index>=450)};
  const result=compareNativeManuscripts(base,changed);assert.equal(result.counts.high,450);assert.equal(result.issues.length,400);assert.equal(result.omitted,50);assert.ok(result.issues.every(issue=>issue.severity==="high"));
  const arrayOrder=compareNativeManuscripts(story,{...story,scenes:[...story.scenes].reverse()});assert.equal(arrayOrder.counts.high,0);assert.deepEqual(arrayOrder.issues.map(issue=>issue.code),["scene-order"]);
});

type Finding = Pick<CompatibilityIssue, "code" | "severity" | "scope">;
const sceneScope = "장면 identity";
function finding(code: string, severity: Finding["severity"], scope = sceneScope): Finding {
  return {code, severity, scope};
}
function assertFindings(result: CompatibilityAnalysis, expected: readonly Finding[], label: string): void {
  const ordered = (rows: readonly Finding[]) => rows.map(row => JSON.stringify(row)).sort();
  assert.deepEqual(ordered(result.issues.map(({code, severity, scope}) => ({code, severity, scope}))),
    ordered(expected), `${label}: exact findings (code, severity, multiplicity, scope)`);
  const counts = {high: 0, review: 0, info: 0};
  for (const issue of expected) counts[issue.severity]++;
  assert.deepEqual(result.counts, counts, `${label}: severity counts`);
  assert.equal(result.omitted, 0, `${label}: no omitted findings`);
  assert.equal(result.status, counts.high || counts.review ? "requires-review" : counts.info ? "informational" : "no-detected-changes", `${label}: status`);
}
function line(id?: string, text = "Same", bgm = "daily"): Line {
  return {...(id === undefined ? {} : {id}), speaker: null, text, bgm};
}
function choice(id?: string, text = "Same", trust = 1): Choice {
  return {...(id === undefined ? {} : {id}), text, next: "identity", add: {trust}};
}
function manuscript(lines: readonly Line[], choices?: readonly Choice[]): VnScript {
  return {title: "Identity boundaries", subtitle: "", start: "identity", characters: [], flags: {trust: 0},
    scenes: [{id: "identity", background: "title", lines, ...(choices === undefined ? {} : {choices})}]};
}
const lineA = line("a"), lineB = line("b", "Same", "rain"), lineC = line("c", "New", "ending");
const choiceA = choice("a"), choiceB = choice("b", "Same", 2), choiceC = choice("c", "New", 3);
const beforeIdentified = manuscript([lineA, lineB], [choiceA, choiceB]);
const lineRemoved = (id: string) => finding("line-removed", "high", `${sceneScope} · 대사 ${id}`);
const lineAdded = (id: string) => finding("line-added", "review", `${sceneScope} · 대사 ${id}`);
const choiceRemoved = (id: string) => finding("choice-removed", "high", `${sceneScope} · 선택 ${id}`);
const choiceAdded = (id: string) => finding("choice-added", "review", `${sceneScope} · 선택 ${id}`);

for (const edited of [false, true]) {
  test(`stable identities: duplicate-caption reorder${edited ? " plus edit" : " only"}`, () => {
    const after = manuscript([edited ? {...lineB, text: "Revised", bgm: "ending"} : lineB, lineA],
      [edited ? {...choiceB, text: "Revised", add: {trust: 99}} : choiceB, choiceA]);
    const expected = [finding("line-order", "high"), finding("choice-order", "high")];
    if (edited) expected.push(finding("dialogue-changed", "review"), finding("line-cues", "review"),
      finding("choice-logic", "high", `${sceneScope} · 선택 1`), finding("choice-caption", "review", `${sceneScope} · 선택 1`));
    assertFindings(compareNativeManuscripts(beforeIdentified, after), expected, "duplicate-caption identity matching");
  });
}

interface ComparisonCase {name: string; before: VnScript; after: VnScript; expected: readonly Finding[]}
const identifiedCases: readonly ComparisonCase[] = [
  {name: "unchanged", before: beforeIdentified, after: structuredClone(beforeIdentified), expected: []},
  {name: "front insertion", before: beforeIdentified, after: manuscript([lineC, lineA, lineB], [choiceC, choiceA, choiceB]),
    expected: [finding("line-count", "high"), lineAdded("c"), finding("choice-count", "high"), choiceAdded("c")]},
  {name: "front deletion", before: beforeIdentified, after: manuscript([lineB], [choiceB]),
    expected: [finding("line-count", "high"), lineRemoved("a"), finding("choice-count", "high"), choiceRemoved("a")]},
  {name: "equal-count complete replacement", before: beforeIdentified,
    after: manuscript([{...lineA, id: "c"}, {...lineB, id: "d"}], [{...choiceA, id: "c"}, {...choiceB, id: "d"}]),
    expected: [lineRemoved("a"), lineRemoved("b"), lineAdded("c"), lineAdded("d"),
      choiceRemoved("a"), choiceRemoved("b"), choiceAdded("c"), choiceAdded("d")]},
  {name: "equal-count replacement with surviving edits", before: beforeIdentified,
    after: manuscript([lineC, {...lineB, text: "Revised", bgm: "ending"}], [choiceC, {...choiceB, text: "Revised", add: {trust: 99}}]),
    expected: [lineRemoved("a"), lineAdded("c"), finding("dialogue-changed", "review"), finding("line-cues", "review"),
      choiceRemoved("a"), choiceAdded("c"), finding("choice-logic", "high", `${sceneScope} · 선택 2`),
      finding("choice-caption", "review", `${sceneScope} · 선택 2`)]},
];
for (const row of identifiedCases) {
  test(`identified lists: ${row.name}`, () => {
    assertFindings(compareNativeManuscripts(row.before, row.after), row.expected, row.name);
  });
}

type Domain = "lines" | "choices";
const domains: readonly Domain[] = ["lines", "choices"];
function domainManuscript(domain: Domain, ids: readonly (string | undefined)[]): VnScript {
  return domain === "lines" ? manuscript(ids.map(id => line(id))) : manuscript([lineA], ids.map(id => choice(id)));
}
// Empty/duplicate IDs and empty line arrays exercise the comparator directly;
// the manuscript parser rejects them. Omitted IDs and empty choices are valid.
const gates: readonly {name: string; ids: readonly (string | undefined)[]}[] = [
  {name: "partial IDs", ids: ["a", undefined]},
  {name: "absent IDs", ids: [undefined, undefined]},
  {name: "empty IDs", ids: ["a", ""]},
  {name: "duplicate IDs", ids: ["a", "a"]},
];
for (const domain of domains) {
  for (const gate of gates) {
    const incomplete = domainManuscript(domain, gate.ids), complete = domainManuscript(domain, ["a", "b"]);
    for (const direction of ["before", "after"]) {
      test(`identity gate: ${domain}, ${gate.name} on ${direction}`, () => {
        const result = direction === "before" ? compareNativeManuscripts(incomplete, complete) : compareNativeManuscripts(complete, incomplete);
        assertFindings(result, [], `${domain} ${gate.name} on ${direction} uses fallback`);
      });
    }
    test(`identity gate: ${domain}, ${gate.name} reorder uses fallback`, () => {
      const lines = gate.ids.map((id, index) => line(id, String(index)));
      const choices = gate.ids.map((id, index) => choice(id, String(index)));
      const before = domain === "lines" ? manuscript(lines) : manuscript([lineA], choices);
      const after = domain === "lines" ? manuscript([...lines].reverse()) : manuscript([lineA], [...choices].reverse());
      assertFindings(compareNativeManuscripts(before, after), domain === "lines"
        ? [finding("line-order", "high"), finding("dialogue-changed", "review")]
        : [finding("choice-order", "high")], `${domain} fallback reorder`);
    });
  }
  test(`independent identity domains: only ${domain} fully identified`, () => {
    const lines = domain === "lines" ? [lineA, lineB] : [lineA, line(undefined, "Same", "rain")];
    const choices = domain === "choices" ? [choiceA, choiceB] : [choiceA, choice(undefined, "Same", 2)];
    const result = compareNativeManuscripts(manuscript(lines, choices), manuscript([...lines].reverse(), [...choices].reverse()));
    assertFindings(result, domain === "lines"
      ? [finding("line-order", "high"), finding("choice-logic", "high", `${sceneScope} · 선택 1`), finding("choice-logic", "high", `${sceneScope} · 선택 2`)]
      : [finding("choice-order", "high"), finding("line-cues", "review")], `${domain} identity gate is independent`);
  });
}

const emptyCases: ComparisonCase[] = [
  {name: "both arrays empty", before: manuscript([], []), after: manuscript([], []), expected: []},
  {name: "identified lines to empty", before: manuscript([lineA]), after: manuscript([]), expected: [finding("line-count", "high"), lineRemoved("a")]},
  {name: "empty lines to identified", before: manuscript([]), after: manuscript([lineA]), expected: [finding("line-count", "high"), lineAdded("a")]},
  {name: "unidentified lines to empty", before: manuscript([line()]), after: manuscript([]), expected: [finding("line-count", "high")]},
  {name: "empty lines to unidentified", before: manuscript([]), after: manuscript([line()]), expected: [finding("line-count", "high")]},
  {name: "absent choices to empty", before: manuscript([lineA]), after: manuscript([lineA], []), expected: []},
  {name: "empty choices to absent", before: manuscript([lineA], []), after: manuscript([lineA]), expected: []},
];
const emptyMenus: readonly {name: string; choices: readonly Choice[] | undefined}[] = [
  {name: "absent", choices: undefined}, {name: "empty", choices: []},
];
for (const empty of emptyMenus) {
  emptyCases.push(
    {name: `${empty.name} choices unchanged`, before: manuscript([lineA], empty.choices), after: manuscript([lineA], empty.choices), expected: []},
    {name: `${empty.name} choices to identified`, before: manuscript([lineA], empty.choices), after: manuscript([lineA], [choiceA]), expected: [finding("choice-count", "high"), choiceAdded("a")]},
    {name: `identified choices to ${empty.name}`, before: manuscript([lineA], [choiceA]), after: manuscript([lineA], empty.choices), expected: [finding("choice-count", "high"), choiceRemoved("a")]},
    {name: `${empty.name} choices to unidentified`, before: manuscript([lineA], empty.choices), after: manuscript([lineA], [choice()]), expected: [finding("choice-count", "high")]},
    {name: `unidentified choices to ${empty.name}`, before: manuscript([lineA], [choice()]), after: manuscript([lineA], empty.choices), expected: [finding("choice-count", "high")]},
  );
}
for (const row of emptyCases) {
  test(`empty boundaries: ${row.name}`, () => {
    assertFindings(compareNativeManuscripts(row.before, row.after), row.expected, row.name);
  });
}
