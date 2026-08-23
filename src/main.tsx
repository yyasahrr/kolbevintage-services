import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { applyStorefrontTheme, readStorefrontTheme } from "./theme";

applyStorefrontTheme(readStorefrontTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
