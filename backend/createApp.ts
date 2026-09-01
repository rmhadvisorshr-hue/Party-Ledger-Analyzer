import cors from "cors";
import express from "express";
import { analysisRouter } from "./src/routes/analysis.routes";
import { convertRouter } from "./src/routes/convert.routes";

export function createApiApp() {
  const app = express();

  // Same-origin requests (integrated dev/preview) ignore these headers, so
  // this is safe to leave on unconditionally — it only matters when the API
  // runs standalone (see standalone.ts) and the frontend is served separately.
  app.use(cors({
    origin: (origin, callback) => {
      const allowedOrigins = [process.env.FRONTEND_ORIGIN, "http://localhost:5173", "http://localhost:5174"].filter(Boolean) as string[];
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  }));
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "ai-bank-statement-analyzer" });
  });

  app.use("/api", convertRouter);
  app.use("/api", analysisRouter);

  app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(400).json({
      code: "REQUEST_FAILED",
      message: error.message || "Request failed.",
    });
  });

  return app;
}
