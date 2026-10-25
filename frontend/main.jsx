import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ui";
import { LoadingIndicator } from "./components/LoadingIndicator";
import "./styles.css";

const Studio = lazy(() => import("./studio/Studio"));
const Console = lazy(() => import("./console/Console"));
const isStudio = location.pathname.startsWith("/studio");
document.title = isStudio
  ? "Flow Studio · OpenBridge"
  : "Regulatory console · OpenBridge";
// Preserve the existing demo role switch. This is a UI convention, not authentication.
document.cookie = `ob_role=${isStudio ? "tenant" : "nbg"}; Path=/; SameSite=Lax`;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="app-loading" role="status">
            <LoadingIndicator size={32} />
            <span>Opening OpenBridge…</span>
          </div>
        }
      >
        {isStudio ? <Studio /> : <Console />}
      </Suspense>
    </ErrorBoundary>
  </React.StrictMode>,
);
