import { initializeEdition } from "./storage/edition.js";
import { ensureAssetServer } from "./storage/projectAssets.js";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles/global.css";
import "./styles/rain-player.css";

initializeEdition();
void ensureAssetServer().catch(()=>{/* Import controls report storage availability. */});
const host = document.getElementById("root");
if (!host) throw new Error("#root 가 없다");
createRoot(host).render(<App />);
