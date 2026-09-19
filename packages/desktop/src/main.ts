/**
 * VN Maker 데스크톱(Electron) 진입점.
 *
 * 창은 하나다. 스튜디오(`/studio.html`)와 플레이어(`/`)는 같은 오리진이라 창 안에서 서로 오간다.
 *
 * 포트를 고정하는 이유 — 작품·저장·보관함이 전부 localStorage/IndexedDB 에 있고, 그 저장소는
 * **오리진(호스트+포트)** 로 격리된다. 포트를 매번 새로 고르면 실행할 때마다 빈 편집기가 열린다.
 * 그래서 임의 포트가 아니라 고정 포트를 쓰고, 이미 쓰는 프로세스가 있으면 조용히 넘어가지 않고 알린다.
 */
import { app, BrowserWindow, Menu, dialog, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startDesktopServer, type DesktopServer } from "./server.js";
import { createApp } from "../../gateway/src/app.js";
import { createFileStore } from "../../gateway/src/auth/credentials.js";
import { API_BODY_MAX } from "../../gateway/src/config.js";
import { nativeBuildService, type NativeBuildService } from "../../app/native-build-plugin.js";

const here = dirname(fileURLToPath(import.meta.url));
/** 사용자가 바꿀 일은 거의 없지만, 포트가 이미 쓰이는 환경을 위해 열어 둔다. */
const PORT = Number(process.env["VNMAKER_DESKTOP_PORT"] ?? 47831);
/** 개발 중에는 Vite 개발 서버(핫 리로드 + /api 마운트)를 그대로 쓴다. */
const DEV_URL = process.env["VNMAKER_DESKTOP_DEV_URL"];

let server: DesktopServer | undefined;
let native: NativeBuildService | undefined;
let origin = DEV_URL ?? "";
/** 창이 아직 없을 때 도착한 딥링크의 목적지 — createWindow가 첫 로드에 쓴다. */
let pendingDeepLink: string | undefined;

const PROTOCOL = "openvnmaker";

/**
 * losia 의 "로컬 앱에서 열기" 링크. `openvnmaker://install/<assetId>` 는
 * 스튜디오를 띄워 그 자산 설치를 바로 시작한다 — 스튜디오는 `?store-install=<id>`
 * 쿼리를 읽어 아트 디렉션의 스토어 설치를 돌린다.
 */
function deepLinkTarget(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== `${PROTOCOL}:`) return undefined;
    if (u.hostname === "install") {
      const id = u.pathname.replace(/^\//, "") || u.searchParams.get("id") || "";
      return `/studio.html${id ? `?store-install=${encodeURIComponent(id)}` : ""}`;
    }
    return "/studio.html";
  } catch {
    return undefined;
  }
}

function focusWindow(): void {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}

function openDeepLink(url: string): void {
  const target = deepLinkTarget(url);
  if (!target) return;
  const window = BrowserWindow.getAllWindows()[0];
  if (!window || !origin) {
    pendingDeepLink = target;
    // macOS는 창을 닫아도 앱이 산다 — 닫힌 상태로 딥링크가 오면 창을 새로 만든다(서버가 뜬 뒤에만).
    if (!window && origin && app.isReady()) createWindow();
    return;
  }
  focusWindow();
  void window.loadURL(`${origin}${target}`);
}

// 사이트 링크로 앱이 열리게 한다. 등록은 whenReady 전에 해야 한다.
app.setAsDefaultProtocolClient(PROTOCOL);

function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const go = (path: string) => () => { BrowserWindow.getAllWindows()[0]?.loadURL(`${origin}${path}`).catch(() => undefined); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "작품",
      submenu: [
        { label: "스튜디오", accelerator: "CmdOrCtrl+1", click: go("/studio.html") },
        { label: "플레이어", accelerator: "CmdOrCtrl+2", click: go("/") },
        { type: "separator" as const },
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },
    { role: "editMenu" },
    {
      label: "보기",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        { role: "toggleDevTools" as const },
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    {
      label: "도움말",
      submenu: [
        { label: "저장 위치 열기", click: () => { void shell.openPath(app.getPath("userData")); } },
        { label: "AI 자격증명 폴더 열기", click: () => { void shell.openPath(join(app.getPath("home"), ".vnmaker")); } },
      ],
    },
  ]));
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    // Windows·macOS 는 패키징된 아이콘을 쓰지만 리눅스는 창 아이콘을 직접 줘야 한다.
    ...(process.platform === "linux" ? { icon: join(here, "icon.png") } : {}),
    backgroundColor: "#15131d",
    show: false,
    title: "VN Maker 스튜디오",
    webPreferences: {
      // 렌더러는 그냥 로컬 웹페이지다. Node 접근이 필요 없으므로 전부 잠근다.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  window.once("ready-to-show", () => window.show());

  // 바깥 링크(losia 스토어, 라이선스 표기 등)는 앱 창이 아니라 기본 브라우저로 보낸다.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(origin)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });

  void window.loadURL(`${origin}${pendingDeepLink ?? "/studio.html"}`);
  pendingDeepLink = undefined;
  return window;
}

async function boot(): Promise<void> {
  if (!DEV_URL) {
    const gateway = createApp({ store: createFileStore() });
    // Ren'Py 빌드 산출물은 앱 폴더가 아니라 사용자 데이터 아래에 쌓는다.
    // nativeBuildService 는 appRoot 기준 `../../output/...` 에 쓰므로 그에 맞춘 경로를 준다.
    native = nativeBuildService(join(app.getPath("userData"), "native", "app"), process.env["VNMAKER_RENPY_SDK"]);
    server = await startDesktopServer({
      webRoot: join(here, "web"),
      gateway,
      bodyMax: API_BODY_MAX,
      nativeBuild: native.middleware,
      port: PORT,
    });
    origin = server.url;
  }
  // Windows·Linux 콜드 스타트 — 딥링크가 argv로 들어온다. macOS는 open-url 이벤트.
  const argLink = process.argv.find(a => a.startsWith(`${PROTOCOL}:`));
  if (argLink) pendingDeepLink = deepLinkTarget(argLink) ?? pendingDeepLink;
  buildMenu();
  createWindow();
}

if (!app.requestSingleInstanceLock()) {
  // 두 인스턴스가 같은 사용자 데이터와 포트를 두고 싸우면 원고가 위험하다.
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    // 실행 중인 앱에 도착한 딥링크(Windows·Linux는 argv로 온다).
    const link = argv.find(a => a.startsWith(`${PROTOCOL}:`));
    if (link) { openDeepLink(link); return; }
    focusWindow();
  });
  // macOS — 실행 중이든 아니든 open-url 로 도착한다.
  app.on("open-url", (event, url) => { event.preventDefault(); openDeepLink(url); });

  app.whenReady().then(boot).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    const busy = /EADDRINUSE/.test(detail);
    dialog.showErrorBox(
      "VN Maker 를 시작하지 못했습니다",
      busy
        ? `로컬 포트 ${PORT} 를 다른 프로그램이 쓰고 있습니다.\n그 프로그램을 끄거나, VNMAKER_DESKTOP_PORT 환경변수로 다른 포트를 지정해 주세요.\n(포트를 바꾸면 이전 포트에 저장한 작품은 보이지 않습니다. 먼저 작품을 JSON 으로 내보내세요.)`
        : detail,
    );
    app.quit();
  });

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("before-quit", () => {
    native?.stop();
    void server?.close();
  });
}
