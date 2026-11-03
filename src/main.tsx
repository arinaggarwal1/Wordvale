import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./themes.css";
import "./index.css";
import { applyTheme, getTheme } from "./themes";

applyTheme(getTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
