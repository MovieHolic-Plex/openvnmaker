import { initializeEdition } from "./storage/edition.js";
import { createRoot } from "react-dom/client";
import { StudioApp } from "./StudioApp.js";
import "./styles/global.css";
import "./styles/studio.css";
import "./styles/studio-modern.css";

initializeEdition();
const host = document.getElementById("root");
if (!host) throw new Error("#root 가 없다");
createRoot(host).render(<StudioApp />);
