export type ProductionClock = { readonly now: () => number };

export type JsonFragmentState =
  | { readonly kind: "complete"; readonly value: unknown }
  | { readonly kind: "incomplete" }
  | { readonly kind: "invalid" };

export type SseRemainder = "empty" | "incomplete" | "invalid";

export type SsePushResult = {
  readonly events: readonly unknown[];
  readonly progressed: boolean;
};

export type SseFinish = {
  readonly events: readonly unknown[];
  readonly remainder: SseRemainder;
};

export type CompleteFunctionCall = {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly id?: string;
  readonly thoughtSignature?: string;
};

export type ProductionCounterIncludes = {
  readonly text: boolean;
  readonly tools: boolean;
  readonly history: boolean;
  readonly opaque: boolean;
  readonly images: boolean;
};

export type ProductionRequestInput = {
  readonly projectId: string;
  readonly model: string;
  readonly contents: readonly unknown[];
  readonly tools?: unknown;
  readonly requestId: string;
  readonly kind: "text" | "image";
  readonly maxOutputTokens?: number;
};

export type ProductionEnvelope = {
  readonly project: string;
  readonly model: string;
  readonly request: {
    readonly contents: readonly unknown[];
    readonly generationConfig: Readonly<Record<string, unknown>>;
    readonly tools?: unknown;
    readonly toolConfig?: unknown;
    readonly systemInstruction?: unknown;
    readonly safetySettings?: unknown;
  };
  readonly requestType: "agent";
  readonly requestId: string;
  readonly userAgent: "antigravity";
};

export type ProductionRequestBuild =
  | { readonly kind: "ok"; readonly envelope: ProductionEnvelope; readonly includes: ProductionCounterIncludes; readonly wireBody: string }
  | { readonly kind: "capability"; readonly reason: "MODEL_MISMATCH" | "REQUEST_SIGNATURE" };

export type ProductionUsage = {
  readonly knownInputUsage: number;
  readonly knownOutputUsage: number;
};

export type ProductionTurnResult =
  | {
      readonly kind: "succeeded";
      readonly text: string;
      readonly calls: readonly CompleteFunctionCall[];
      readonly replayParts: readonly unknown[];
      readonly usage: ProductionUsage;
      readonly finishReason: string;
    }
  | {
      readonly kind: "missing-usage";
      readonly text: string;
      readonly calls: readonly CompleteFunctionCall[];
      readonly replayParts: readonly unknown[];
      readonly finishReason: string;
    }
  | { readonly kind: "incomplete"; readonly dispatchCount: 0 }
  | { readonly kind: "unknown"; readonly dispatchCount: 0 }
  | { readonly kind: "provider-context-exceeded" }
  | { readonly kind: "auth" }
  | { readonly kind: "quota" }
  | { readonly kind: "capability"; readonly reason: string }
  | { readonly kind: "cancelled" };

export type TokenRefreshResponse = {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_in: number;
};
