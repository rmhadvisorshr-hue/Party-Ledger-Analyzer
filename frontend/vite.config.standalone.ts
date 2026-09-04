import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

// Used when the API is deployed separately (e.g. Vercel) -- unlike
// vite.config.ts, nothing here imports ./vite-plugin-api, so the backend
// (Express, tesseract.js, pdfjs-dist, @napi-rs/canvas, ...) never needs to be
// installed or resolvable just to build this config or the app itself.
//
// nitro() packages the SSR build for the target platform (reads Vercel's own
// env vars to detect it's running in a Vercel build) -- without it Vercel has
// no idea how to run server.standalone.ts and serves a platform-level 404 for
// every route, build succeeding or not.
const appBase = process.env.VITE_APP_BASE_PATH || "/";

export default defineConfig({
  base: appBase,
  plugins: [
    tanstackStart({ server: { entry: "server.standalone" } }),
    nitro(),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 4173,
  },
});
