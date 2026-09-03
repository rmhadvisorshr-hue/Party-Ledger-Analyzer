import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

// Used when the API is deployed separately (e.g. Vercel) -- unlike
// vite.config.ts, nothing here imports ./vite-plugin-api, so the backend
// (Express, tesseract.js, pdfjs-dist, @napi-rs/canvas, ...) never needs to be
// installed or resolvable just to build this config or the app itself.
const appBase = process.env.VITE_APP_BASE_PATH || "/";

export default defineConfig({
  base: appBase,
  plugins: [
    tanstackStart({ server: { entry: "server.standalone" } }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 4173,
  },
});
