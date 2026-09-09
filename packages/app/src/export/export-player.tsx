import { createRoot } from "react-dom/client";
import { parseScript, setExportedScript } from "./export-content.js";
import { App } from "../App.js";
import { configureRuntimeBase } from "../storage/runtimeBase.js";
import "../styles/global.css";
import "../styles/rain-player.css";

async function boot() {
  const entryUrl = import.meta.url;
  configureRuntimeBase(entryUrl);
  const response = await fetch(new URL("./project.json", entryUrl), { cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error(`원고를 읽을 수 없습니다 (${response.status}).`);
  const script = parseScript(await response.json());
  const manifestResponse = await fetch(new URL("./bundle.json", entryUrl), { cache: "no-store", redirect: "error" });
  if (!manifestResponse.ok) throw new Error("배포 정보가 없습니다. ZIP의 모든 파일을 함께 올려주세요.");
  const manifest = await manifestResponse.json() as { projectNamespace?: unknown };
  if (typeof manifest.projectNamespace !== "string" || !/^(?:bundle|release)-[a-f0-9]{16}$/.test(manifest.projectNamespace)) throw new Error("배포 정보가 올바르지 않습니다.");
  setExportedScript(script);
  document.title = script.title;
  createRoot(document.getElementById("root")!).render(<App initialScript={script} standalone projectNamespace={manifest.projectNamespace} />);
}

void boot().catch((error: unknown) => {
  const root = document.getElementById("root")!;
  root.textContent = "";
  root.style.cssText = "padding:12vh 8vw;color:#eee;background:#15131d;min-height:100vh;font:18px/1.8 system-ui";
  const title = document.createElement("h1"); title.textContent = "작품을 열 수 없습니다";
  const detail = document.createElement("p"); detail.textContent = error instanceof Error ? error.message : String(error);
  const help = document.createElement("p"); help.textContent = "파일을 더블클릭하는 대신 README.txt의 안내대로 폴더 전체를 정적 웹 서버에서 열어주세요.";
  root.append(title, detail, help);
});
