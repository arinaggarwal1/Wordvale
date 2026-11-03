import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Tailwind's PostCSS instance caches its configuration. Restart Vite when it
// changes so a running desktop app never mixes old utilities with new tokens.
function reloadTailwindConfig(): Plugin {
  return {
    name: "reload-tailwind-config",
    configureServer(server) {
      server.watcher.on("change", (file) => {
        if (/[/\\]tailwind\.config\.[cm]?[jt]s$/.test(file)) {
          void server.restart();
        }
      });
    },
  };
}

export default defineConfig(async () => ({
  plugins: [react(), reloadTailwindConfig()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
