import {test} from "node:test";
import assert from "node:assert/strict";
import {parseScript} from "@vnmaker/content";
import {canonicalHash,parseProductionDocument,parseProjectHead} from "@vnmaker/harness";
import {ProjectRepository,StaleGenerationError} from "../src/studio/projectRepository.js";
import {ProjectStorageError,sameHead} from "../src/studio/projects.js";

const script=parseScript({title:"Source",subtitle:"",start:"start",characters:[],scenes:[{id:"start",background:"title",lines:[{speaker:null,text:"Original"}],ending:"End"}]});
const productionDocument=parseProductionDocument({version:1,brief:"",castCanon:[],worldTimeline:[],branchFacts:[],outline:{title:"Source",subtitle:"",bible:"",start:"start",scenes:[]},artDirection:[],referenceBindings:[]});
const head=parseProjectHead({projectId:"legacy",lineageId:"00000000-0000-4000-8000-000000000001",revision:0,scriptHash:await canonicalHash(script),productionHash:await canonicalHash(productionDocument)});

test("assigns distinct increasing revisions when manuscript bytes repeat",()=>{
  // Given a source snapshot.
  const repository=new ProjectRepository({head,script,productionDocument});
  // When edit/undo/redo returns to the same manuscript bytes.
  const drafts=[repository.stage(script),repository.stage({...script,title:"Edit"}),repository.stage(script)];
  // Then each edit has a distinct revision while the source is still unmodified.
  assert.deepEqual(drafts.map(draft=>draft.revision),[1,2,3]);
  assert.equal(repository.snapshot.head.revision,0);
  assert.deepEqual(drafts[2]?.script,script);
});

test("rejects an originating request when its generation is invalidated",async()=>{
  // Given a captured edit request.
  const repository=new ProjectRepository({head,script,productionDocument});
  const old=repository.stage(script);repository.invalidate();
  // When the obsolete caller tries to save, no IndexedDB adapter is available in this unit test.
  const result=repository.save(old);
  // Then fencing rejects before storage is accessed.
  await assert.rejects(result,StaleGenerationError);
});

for(const replacement of [
  {projectId:"another"},{lineageId:"00000000-0000-4000-8000-000000000002"},
  {revision:1},{scriptHash:"a".repeat(64)},{productionHash:"b".repeat(64)},
])test(`rejects stale ${Object.keys(replacement)[0]} when a commit carries a different base`,async()=>{
  // Given a source and an independently altered base field.
  const repository=new ProjectRepository({head,script,productionDocument});
  const expectedHead=parseProjectHead({...head,...replacement});
  // When a caller attempts compare-and-swap.
  const result=repository.commit({expectedHead,generation:repository.current.generation,script,productionDocument});
  // Then every authority-bearing field participates in the comparison.
  await assert.rejects(result,(error:unknown)=>error instanceof ProjectStorageError&&error.code==="stale-head");
});

test("compares canonical heads when object key ordering differs",()=>{
  // Given the same parsed fields in a different object order.
  const reordered=parseProjectHead({productionHash:head.productionHash,scriptHash:head.scriptHash,revision:0,lineageId:head.lineageId,projectId:head.projectId});
  // When the head is compared.
  const equal=sameHead(head,reordered);
  // Then serialization key order does not create a false conflict.
  assert.equal(equal,true);
});
