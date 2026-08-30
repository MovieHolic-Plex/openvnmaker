import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createFileStore } from "./auth/credentials.js";
import { AUTH_FILE, GATEWAY_HOST, GATEWAY_PORT } from "./config.js";

const app = createApp({ store: createFileStore() });

serve({ fetch: app.fetch, hostname: GATEWAY_HOST, port: GATEWAY_PORT }, (info) => {
  // 127.0.0.1 전용이다. 이 프로세스는 OAuth 토큰을 프록시한다 — 절대 0.0.0.0 에 묶지 마라.
  console.log(`[gateway] http://${GATEWAY_HOST}:${info.port} (자격증명 ${AUTH_FILE})`);
});
