import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";

function isApiRequest(url: string): boolean {
  return url === "/health" || url.startsWith("/api");
}

function mountApiMiddleware(
  middlewares: Connect.Server,
  apiApp: import("express").Express,
): void {
  middlewares.use((req, res, next) => {
    const url = req.url ?? "";
    if (!isApiRequest(url)) {
      next();
      return;
    }

    apiApp(req as IncomingMessage, res as ServerResponse, next);
  });
}

async function loadApiApp(server?: ViteDevServer): Promise<import("express").Express> {
  if (server) {
    const mod = (await server.ssrLoadModule("../backend/createApp.ts")) as {
      createApiApp: () => import("express").Express;
    };
    return mod.createApiApp();
  }

  const mod = await import("../backend/createApp");
  return mod.createApiApp();
}

export function apiServerPlugin(): Plugin {
  return {
    name: "integrated-api-server",
    async configureServer(server: ViteDevServer) {
      const syncFrontendOrigin = () => {
        const addr = server.httpServer?.address();
        if (addr && typeof addr === "object" && "port" in addr && typeof addr.port === "number") {
          process.env.FRONTEND_ORIGIN = `http://localhost:${addr.port}`;
        }
      };

      server.httpServer?.once("listening", syncFrontendOrigin);
      if (server.httpServer?.listening) syncFrontendOrigin();

      const apiApp = await loadApiApp(server);
      mountApiMiddleware(server.middlewares, apiApp);
    },
    async configurePreviewServer(server: PreviewServer) {
      const apiApp = await loadApiApp();
      mountApiMiddleware(server.middlewares, apiApp);
    },
  };
}
