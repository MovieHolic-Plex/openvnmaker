import { initializeEdition } from "./storage/edition.js";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles/global.css";
import "./styles/rain-player.css";

initializeEdition();
const host = document.getElementById("root");
if (!host) throw new Error("#root 가 없다");
createRoot(host).render(<App />);
