import type { Request } from "express";

/** Origin of the running UI server (for headless print / PDF export). */
export function resolveFrontendOrigin(request: Request): string {
  const fromEnv = process.env.FRONTEND_ORIGIN?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;

  const host = request.get("x-forwarded-host") || request.get("host");
  if (!host) {
    return "http://localhost:5173";
  }

  const proto = request.get("x-forwarded-proto") || request.protocol || "http";
  return `${proto}://${host}`;
}
