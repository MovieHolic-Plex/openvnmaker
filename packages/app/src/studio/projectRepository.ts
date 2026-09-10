import {parseScript,type VnScript} from "@vnmaker/content";
import {canonicalHash,parseDecisionReceipt,parseProductionDocument,parseProjectHead,revisionSchema,type DecisionReceipt,type ProductionDocument,type ProjectHead,type Revision,type Sha256} from "@vnmaker/harness";
import {commitRejectedDecision,commitStoredProject,markProposalAcked,readProposalDecision,readStoredProject,sameHead,validatedProject,ProjectStorageError,type StoredDecision} from "./projects.js";

export class StaleGenerationError extends Error {override readonly name="StaleGenerationError";constructor(){super("이 저장 요청의 편집 세대가 만료되었습니다.");}}
export class CurrentRevisionChangedError extends Error {override readonly name="CurrentRevisionChangedError";constructor(){super("저장 중 현재 원고가 변경되었습니다. 최신 원고를 다시 저장하세요.");}}
type ProjectContent={readonly script:VnScript;readonly productionDocument:ProductionDocument};
export type ProjectSnapshot=ProjectContent & {readonly head:ProjectHead};
export type DraftRevision=ProjectContent & {readonly generation:AbortSignal;readonly revision:Revision};
export type AppliedDecisionDraft={readonly receiptId:string;readonly proposalId:string;readonly proposalDigest:Sha256;readonly createdAt:string};
export type ProjectCommit=ProjectContent & {readonly generation:AbortSignal;readonly expectedHead:ProjectHead;readonly appliedDecision?:AppliedDecisionDraft};

async function snapshotHead(base:ProjectHead,revision:Revision,content:ProjectContent):Promise<ProjectHead>{
  const [scriptHash,productionHash]=await Promise.all([canonicalHash(content.script),canonicalHash(content.productionDocument)]);
  return parseProjectHead({...base,revision,scriptHash,productionHash});
}

async function loadRepository(id:string,initial?:VnScript):Promise<ProjectRepository>{
  const stored=await readStoredProject(id);
  if(initial && (stored.record!==undefined||stored.head!==undefined||stored.production!==undefined))throw new ProjectStorageError("stale-head");
  const record=stored.record===undefined
    ? initial?{id,script:structuredClone(parseScript(initial)),updatedAt:Date.now()}:null
    : validatedProject(stored.record);
  if(!record)throw new ProjectStorageError("missing");
  if(record.id!==id)throw new ProjectStorageError("damaged");
  if(stored.head!==undefined){
    const head=parseProjectHead(stored.head);
    const row=stored.production;
    if(!row||typeof row!=="object"||!("projectId" in row)||row.projectId!==id||!("document" in row))throw new ProjectStorageError("damaged");
    const productionDocument=parseProductionDocument(row.document);
    const verified=await snapshotHead(head,head.revision,{script:record.script,productionDocument});
    if(head.projectId!==id||!sameHead(head,verified))throw new ProjectStorageError("damaged");
    return new ProjectRepository({head,script:record.script,productionDocument});
  }
  if(stored.production!==undefined)throw new ProjectStorageError("damaged");
  const productionDocument=parseProductionDocument({version:1,brief:"",castCanon:[],worldTimeline:[],branchFacts:[],outline:{title:record.script.title,subtitle:"",bible:"",start:record.script.start,scenes:[]},artDirection:[],referenceBindings:[]});
  const [scriptHash,productionHash]=await Promise.all([canonicalHash(record.script),canonicalHash(productionDocument)]);
  const head=parseProjectHead({projectId:id,lineageId:crypto.randomUUID(),revision:0,scriptHash,productionHash});
  await commitStoredProject({record,head,productionDocument,expectedHead:null,expectedRecord:stored.record,metadataOnly:stored.record!==undefined},()=>{});
  return new ProjectRepository({head,script:record.script,productionDocument});
}

// One active writer is additionally enforced by the document's Web Lock in studio.tsx.
const repositories=new Map<string,Promise<ProjectRepository>>();
let active:ProjectRepository|null=null;
export const projectRepository={
  async open(id:string):Promise<ProjectRepository>{
    const existing=repositories.get(id);if(existing)return existing;
    const loading=loadRepository(id).catch((error:unknown)=>{repositories.delete(id);throw error;});
    repositories.set(id,loading);return loading;
  },
  async create(id:string,script:VnScript):Promise<ProjectRepository>{
    if(repositories.has(id))throw new ProjectStorageError("stale-head");
    const loading=loadRepository(id,script).catch((error:unknown)=>{repositories.delete(id);throw error;});
    repositories.set(id,loading);return loading;
  },
  activate(repository:ProjectRepository):void{if(active&&active!==repository)active.invalidate();active=repository;},
  current():ProjectRepository{if(!active)throw new ProjectStorageError("missing");return active;},
};

/** Owns displayed revisions and their serial durable write order, not an AI admission UI. */
export class ProjectRepository {
  private durable:ProjectSnapshot;
  private displayed:DraftRevision;
  private pending:DraftRevision[]=[];
  private tail:Promise<unknown>=Promise.resolve();
  private generation=new AbortController();
  private replacement:AbortController|null=null;
  private revision:Revision;
  private readonly listeners=new Set<()=>void>();
  constructor(snapshot:ProjectSnapshot){
    this.durable=snapshot;this.revision=snapshot.head.revision;
    this.displayed={...snapshot,generation:this.generation.signal,revision:this.revision};
  }
  get snapshot():ProjectSnapshot{return this.durable;}
  get current():DraftRevision{return this.displayed;}
  get dirty():boolean{return this.pending.length>0;}
  subscribe(listener:()=>void):()=>void{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  private emit():void{for(const listener of this.listeners)listener();}
  stage(script:VnScript,productionDocument:ProductionDocument=this.displayed.productionDocument):DraftRevision{
    const draft={script:structuredClone(parseScript(script)),productionDocument:parseProductionDocument(productionDocument),generation:this.generation.signal,revision:revisionSchema.parse(this.revision+1)};
    this.replacement?.abort(new CurrentRevisionChangedError());
    this.revision=draft.revision;this.displayed=draft;this.pending.push(draft);this.emit();return draft;
  }
  /** Fence requests captured before a project replacement; never reuse their revision numbers. */
  invalidate():void{this.generation.abort(new StaleGenerationError());this.generation=new AbortController();this.pending=[];this.displayed={...this.durable,generation:this.generation.signal,revision:this.revision};this.emit();}
  private check(draft:DraftRevision):void{if(draft.generation!==this.generation.signal)throw new StaleGenerationError();}
  private serialize<T>(operation:()=>Promise<T>):Promise<T>{
    // Rejection is returned to its caller; a failed operation does not poison later explicit retries.
    const result=this.tail.then(operation,operation);this.tail=result;return result;
  }
  save(draft:DraftRevision=this.displayed):Promise<ProjectSnapshot>{
    return this.serialize(async()=>{
      this.check(draft);
      for(const next of [...this.pending]){
        if(next.revision>draft.revision)break;
        this.check(next);
        const expectedHead=this.durable.head;
        const head=await snapshotHead(expectedHead,next.revision,next);
        this.check(next);
        await commitStoredProject({record:{id:head.projectId,script:next.script,updatedAt:Date.now()},head,productionDocument:next.productionDocument,expectedHead,expectedRecord:null,metadataOnly:false},()=>this.check(next),next.generation);
        this.durable={head,script:next.script,productionDocument:next.productionDocument};
        this.pending=this.pending.filter(item=>item!==next);this.emit();
      }
      return this.durable;
    });
  }
  async flushCurrent():Promise<ProjectSnapshot>{
    const displayed=this.displayed;
    const snapshot=await this.save(displayed);
    const stored=await readStoredProject(snapshot.head.projectId);
    if(stored.head===undefined||!sameHead(parseProjectHead(stored.head),snapshot.head))throw new ProjectStorageError("stale-head");
    if(this.displayed!==displayed||snapshot.head.revision!==displayed.revision)throw new CurrentRevisionChangedError();
    return snapshot;
  }
  /** Compare-and-swap the flushed source, including production-only revisions. */
  commit(input:ProjectCommit):Promise<ProjectSnapshot>{
    return this.serialize(async()=>{
      if(input.generation!==this.generation.signal)throw new StaleGenerationError();
      if(this.dirty||!sameHead(input.expectedHead,this.durable.head))throw new ProjectStorageError("stale-head");
      this.replacement=new AbortController();
      try{
        const script=structuredClone(parseScript(input.script)),productionDocument=parseProductionDocument(input.productionDocument);
        const revision=revisionSchema.parse(this.revision+1),head=await snapshotHead(input.expectedHead,revision,{script,productionDocument});
        const check=()=>{if(input.generation!==this.generation.signal)throw new StaleGenerationError();if(this.dirty)throw new CurrentRevisionChangedError();};
        check();
        const applied=input.appliedDecision;
        const decision=applied===undefined?undefined:{
          projectId:head.projectId,lineageId:head.lineageId,proposalId:applied.proposalId,ackStatus:"pending" as const,
          receipt:parseDecisionReceipt({
            receiptId:applied.receiptId,projectId:head.projectId,lineageId:head.lineageId,proposalId:applied.proposalId,
            proposalDigest:applied.proposalDigest,kind:"applied",baseHead:input.expectedHead,resultHead:head,createdAt:applied.createdAt,
          }),
        };
        await commitStoredProject({record:{id:head.projectId,script,updatedAt:Date.now()},head,productionDocument,expectedHead:input.expectedHead,expectedRecord:null,metadataOnly:false,...(decision===undefined?{}:{decision})},check,AbortSignal.any([input.generation,this.replacement.signal]));
        this.revision=revision;this.durable={head,script,productionDocument};this.invalidate();return this.durable;
      }finally{this.replacement=null;}
    });
  }
  readDecision(proposalId:string):Promise<StoredDecision|null>{
    return readProposalDecision(this.durable.head.projectId,this.durable.head.lineageId,proposalId);
  }
  rejectDecision(receipt:DecisionReceipt):Promise<void>{
    return this.serialize(async()=>{
      await commitRejectedDecision({projectId:receipt.projectId,lineageId:receipt.lineageId,proposalId:receipt.proposalId,receipt,ackStatus:"pending"});
    });
  }
  markDecisionAcked(proposalId:string):Promise<void>{
    return this.serialize(async()=>{
      await markProposalAcked(this.durable.head.projectId,this.durable.head.lineageId,proposalId);
    });
  }
}
