import { fromNodeMiddleware } from "h3";
import type { Express } from "express";

let apiHandler: ((request: Request) => Promise<Response>) | undefined;
let apiApp: Express | undefined;

export async function handleApiFetch(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/health" && !url.pathname.startsWith("/api")) {
    return null;
  }

  if (!apiHandler) {
    const { createApiApp } = await import("./createApp");
    apiApp = createApiApp();
    apiHandler = fromNodeMiddleware(apiApp);
  }

  return apiHandler(request);
}
