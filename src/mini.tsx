import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import MiniView from "./components/MiniView";
import "./mini.css";

createRoot(document.getElementById("root")!).render(<StrictMode><MiniView /></StrictMode>);
