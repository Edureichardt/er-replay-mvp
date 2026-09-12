import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./saas.css";
import "./cameras.css";
import "./capture.css";
import "./preview.css";
import "./overview.css";
import "./polish.css";
import "./admin-tools.css";
import "./responsive.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
