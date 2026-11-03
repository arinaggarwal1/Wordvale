import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AuthGate from "./components/AuthGate";
import "./themes.css";
import "./index.css";
import { applyTheme, getTheme } from "./themes";

applyTheme(getTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <AuthGate><App /></AuthGate>
    </React.StrictMode>
);
