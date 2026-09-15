/**
 * 데스크톱 셸의 로컬 HTTP 서버.
 *
 * 왜 파일(file://)이 아니라 HTTP 인가 —
 *  1) 스튜디오는 `/project-assets-sw.js` 서비스 워커로 `/assets/user/**` 를 IndexedDB 에서 돌려준다.
 *     서비스 워커는 file:// 에서 아예 등록되지 않는다(localhost 또는 HTTPS 만 허용).
 *  2) 원고가 `/assets/...` 루트 절대 경로를 쓰고, 게이트웨이가 `/api/*` 를 같은 오리진으로 기대한다.
 *
 * 그래서 개발 서버(Vite)가 하던 일 — 정적 파일 + `/api/*` + `/api/native-build/*` 를
 * 한 오리진에 묶는 것 — 을 그대로 재현한다. 127.0.0.1 에만 바인딩하고 임의 포트를 쓴다.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Socket } from "node:net";
import { extname, resolve, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".zip": "application/zip",
};

/** DNS 리바인딩 방어 — 브라우저가 우리 포트로 보내는 Host 는 항상 로컬이어야 한다. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

export interface HonoLike {
  fetch(request: Request): Response | Promise<Response>;
}
export type NodeMiddleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

export interface DesktopServerOptions {
  /** 정적 파일 루트. 개발에서는 packages/app/dist, 배포에서는 번들 안의 web/ 이다. */
  readonly webRoot: string;
  /** `/api/*` 를 처리할 게이트웨이. 없으면 API 없이 정적 파일만 서빙한다. */
  readonly gateway?: HonoLike | undefined;
  /** POST 본문 상한. 게이트웨이의 API_BODY_MAX 를 그대로 넘긴다. */
  readonly bodyMax?: number | undefined;
  /** `/api/native-build/*` 미들웨어(Ren'Py 패키징). 없으면 마운트하지 않는다. */
  readonly nativeBuild?: NodeMiddleware | undefined;
  readonly host?: string | undefined;
  /** 0 이면 빈 포트를 OS 가 고른다. 고정 포트는 충돌하므로 기본값을 쓴다. */
  readonly port?: number | undefined;
}

export interface DesktopServer {
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, message: string): void {
  const body = Buffer.from(JSON.stringify({ error: message }), "utf8");
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

/** 루트 밖으로 나가지 않는 경로만 돌려준다. 못 쓰는 경로는 null. */
export function resolveWithinRoot(root: string, pathname: string): string | null {
  if (pathname.includes("\0")) return null;
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const rootPath = resolve(root);
  const target = resolve(rootPath, relative);
  return target === rootPath || target.startsWith(rootPath + sep) ? target : null;
}

/** Range 헤더를 파일 크기에 맞춰 해석한다. 잘못된 범위는 null(=416). */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(size - 1, Number(match[2])) : size - 1) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}

async function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  } catch {
    send(res, 400, "잘못된 주소다");
    return true;
  }
  const target = resolveWithinRoot(root, pathname);
  if (!target) {
    send(res, 403, "허용하지 않는 경로다");
    return true;
  }
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(target);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  const type = MIME[extname(target).toLowerCase()] ?? "application/octet-stream";
  // 로컬 디스크라 캐시 이득이 없고, 업데이트 직후 옛 파일이 남는 쪽이 더 위험하다.
  const base = { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Accept-Ranges": "bytes" };

  if (req.headers.range !== undefined) {
    const range = parseRange(req.headers.range, info.size);
    if (!range) {
      res.writeHead(416, { ...base, "Content-Range": `bytes */${info.size}` });
      res.end();
      return true;
    }
    res.writeHead(206, { ...base, "Content-Range": `bytes ${range.start}-${range.end}/${info.size}`, "Content-Length": range.end - range.start + 1 });
    if (req.method === "HEAD") { res.end(); return true; }
    createReadStream(target, { start: range.start, end: range.end }).on("error", () => res.destroy()).pipe(res);
    return true;
  }

  res.writeHead(200, { ...base, "Content-Length": info.size });
  if (req.method === "HEAD") { res.end(); return true; }
  createReadStream(target).on("error", () => res.destroy()).pipe(res);
  return true;
}

/** Node 요청을 Hono 의 fetch 로 넘긴다. Vite 개발 서버의 mountGateway 와 같은 동작이다. */
async function serveGateway(gateway: HonoLike, bodyMax: number, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  if (req.method !== "GET" && req.method !== "HEAD") {
    // 버퍼링 단계에서도 같은 상한을 둔다 — 다 읽고 나서 자르면 이미 늦다.
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > bodyMax) {
        send(res, 413, "본문이 너무 크다");
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk as Buffer));
    }
  }
  const host = req.headers.host ?? "127.0.0.1";
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const request = new Request(`http://${host}${req.url ?? "/"}`, {
    method: req.method ?? "GET",
    headers,
    ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
  });
  const response = await gateway.fetch(request);
  const body = Buffer.from(await response.arrayBuffer());
  const out: Record<string, string> = {};
  response.headers.forEach((value, key) => { out[key] = value; });
  res.writeHead(response.status, { ...out, "Content-Length": body.length });
  res.end(body);
}

export async function startDesktopServer(options: DesktopServerOptions): Promise<DesktopServer> {
  const webRoot = resolve(options.webRoot);
  const host = options.host ?? "127.0.0.1";
  const bodyMax = options.bodyMax ?? 4 * 1024 * 1024;
  const sockets = new Set<Socket>();

  const server: Server = createServer((req, res) => {
    void (async () => {
      const host = req.headers.host;
      if (host !== undefined && !LOCAL_HOST.test(host)) {
        send(res, 403, "로컬 주소에서만 열 수 있다");
        return;
      }
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      if (options.nativeBuild && path.startsWith("/api/native-build")) {
        options.nativeBuild(req, res, () => send(res, 404, "없는 주소다"));
        return;
      }
      if (path.startsWith("/api/")) {
        if (!options.gateway) { send(res, 503, "게이트웨이가 준비되지 않았다"); return; }
        await serveGateway(options.gateway, bodyMax, req, res);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") { send(res, 405, "허용하지 않는 메서드다"); return; }
      if (await serveStatic(webRoot, req, res)) return;
      send(res, 404, "없는 파일이다");
    })().catch((error: unknown) => {
      if (res.headersSent) { res.destroy(); return; }
      send(res, 500, error instanceof Error ? error.message : String(error));
    });
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(options.port ?? 0, host, () => { server.removeListener("error", fail); done(); });
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://${host}:${address.port}`,
    port: address.port,
    close: () =>
      new Promise<void>((done) => {
        // keep-alive 소켓이 남으면 close 가 영원히 안 끝난다.
        for (const socket of sockets) socket.destroy();
        server.close(() => done());
      }),
  };
}
