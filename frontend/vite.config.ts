import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { apiServerPlugin } from "./vite-plugin-api";

const appBase = process.env.VITE_APP_BASE_PATH || "/";

export default defineConfig({
  base: appBase,
  plugins: [
    tanstackStart({ server: { entry: "server" } }),
    apiServerPlugin(),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  ssr: {
    external: ["exceljs", "pdfjs-dist"],
  },
  server: {
    // The API now lives in a sibling ../backend, outside this Vite project's root.
    fs: { allow: [".."] },
  },
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 4173,
    allowedHosts: [
      "bank-statement-analyzer-ws8z.onrender.com",
      process.env.RENDER_EXTERNAL_HOSTNAME,
    ].filter(Boolean) as string[],
  },
});
