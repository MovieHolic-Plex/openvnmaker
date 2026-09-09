import { DEFAULT_BUDGET_LIMITS } from "@vnmaker/harness";
import type { HarnessCapabilityView } from "../../api/harness.js";
import type { BudgetMeter } from "./candidateStore.js";
import { StatusBadge } from "./QualityReport.js";

function tokenTone(check: string): "success" | "error" | "incomplete" {
  switch (check) {
    case "pass": return "success";
    case "fail": return "error";
    default: return "incomplete";
  }
}

export function RunEnvironment({
  capabilities, meter, policy, boundedConfirmed, usedText, onPolicy, onConfirmBounded, onIncrease,
}: {
  readonly capabilities: HarnessCapabilityView | null;
  readonly meter: BudgetMeter | null;
  readonly policy: "exact-only" | "bounded-payload";
  readonly boundedConfirmed: boolean;
  readonly usedText: number;
  readonly onPolicy: (policy: "exact-only" | "bounded-payload") => void;
  readonly onConfirmBounded: (value: boolean) => void;
  readonly onIncrease: () => void;
}) {
  const ready = capabilities?.productionReady === true;
  const tokenCheck = meter?.tokenCheck ?? "unknown";
  return <section className="harness-env" data-testid="harness-environment">
    <h3>실행 환경</h3>
    <p data-testid="harness-text-model">{capabilities?.textModelId ?? "gemini-3.8-flash-high"}</p>
    <p data-testid="harness-image-model">{capabilities?.imageModelId ?? "gemini-3.1-flash-image"}</p>
    <StatusBadge kind={ready ? "success" : "incomplete"} label={ready ? "production-ready" : "production-not-ready"} testId="harness-production-ready" />
    <span hidden data-production-ready={String(ready)} data-testid="harness-production-ready-flag" />
    <p data-testid="harness-live-verification">{capabilities?.liveVerification ?? "not-performed"}</p>
    <p data-testid="harness-token-window" data-mode={capabilities?.tokenWindowMode ?? "unknown"}>{capabilities?.tokenWindowMode ?? "unknown"}</p>
    <p data-testid="harness-input-token-limit" data-value={capabilities?.inputTokenLimit === null || capabilities?.inputTokenLimit === undefined ? "null" : String(capabilities.inputTokenLimit)}>
      {capabilities?.inputTokenLimit === null || capabilities?.inputTokenLimit === undefined ? "null" : capabilities.inputTokenLimit}
    </p>
    <label>tokenPolicy
      <select data-testid="harness-token-policy" value={policy} onChange={event => onPolicy(event.target.value === "bounded-payload" ? "bounded-payload" : "exact-only")}>
        <option value="exact-only">exact-only</option>
        <option value="bounded-payload">bounded-payload</option>
      </select>
    </label>
    {policy === "bounded-payload" ? <label>
      <input type="checkbox" data-testid="harness-bounded-confirm" checked={boundedConfirmed} onChange={event => onConfirmBounded(event.target.checked)} />
      bounded-payload
    </label> : null}
    <dl>
      <dt>run.textAttempts</dt><dd data-testid="harness-limit-text">{DEFAULT_BUDGET_LIMITS.run.textAttempts}</dd>
      <dt>run.imageAttempts</dt><dd data-testid="harness-limit-image">{DEFAULT_BUDGET_LIMITS.run.imageAttempts}</dd>
      <dt>used.textAttempts</dt><dd data-testid="harness-used-text">{usedText}</dd>
      <dt>textContextBytes</dt><dd data-testid="harness-text-context-bytes">{meter?.textContextBytes ?? DEFAULT_BUDGET_LIMITS.request.textContextBytes}</dd>
      <dt>countedInputTokens</dt><dd data-testid="harness-counted-input-tokens">{meter?.countedInputTokens === null || meter?.countedInputTokens === undefined ? "null" : meter.countedInputTokens}</dd>
      <dt>tokenCheck</dt><dd data-testid="harness-token-check" data-token-check={tokenCheck}><StatusBadge kind={tokenTone(tokenCheck)} label={tokenCheck} testId="harness-token-check-badge" /></dd>
      <dt>knownInputUsage</dt><dd data-testid="harness-known-input-usage">{meter?.knownInputUsage === null || meter?.knownInputUsage === undefined ? "null" : meter.knownInputUsage}</dd>
      <dt>knownOutputUsage</dt><dd data-testid="harness-known-output-usage">{meter?.knownOutputUsage === null || meter?.knownOutputUsage === undefined ? "null" : meter.knownOutputUsage}</dd>
    </dl>
    <p data-testid="harness-cancel-refund" data-refund="false">cancel-does-not-refund</p>
    <button type="button" className="studio-button" data-testid="harness-budget-increase" onClick={onIncrease}>한도 늘리기</button>
  </section>;
}
