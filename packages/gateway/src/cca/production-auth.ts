import type { CredentialStore, Credentials } from "../auth/credentials.js";
import type { RefreshResult } from "../auth/tokens.js";
import type { ProductionClock, TokenRefreshResponse } from "./production-types.js";

function expiryFrom(expiresIn: number, now: number): number {
  return now + expiresIn * 1000 - 5 * 60 * 1000;
}

export function createSingleFlightAccess(deps: {
  readonly store: CredentialStore;
  readonly refresh: (refreshToken: string) => Promise<TokenRefreshResponse>;
  readonly clock: ProductionClock;
}): { readonly ensureFreshAccess: () => Promise<RefreshResult | null> } {
  let inflight: Promise<RefreshResult | null> | null = null;
  const ensureFreshAccess = (): Promise<RefreshResult | null> => {
    inflight ??= (async () => {
      try {
        const current = await deps.store.read();
        if (current === null) return null;
        if (deps.clock.now() < current.expires) return { refreshed: false, credentials: current };
        const data = await deps.refresh(current.refresh);
        const next: Credentials = {
          ...current,
          refresh: data.refresh_token ?? current.refresh,
          access: data.access_token,
          expires: expiryFrom(data.expires_in, deps.clock.now()),
        };
        await deps.store.write(next);
        return { refreshed: true, credentials: next };
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
  return { ensureFreshAccess };
}
