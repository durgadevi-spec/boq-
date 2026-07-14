import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import path from "path";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Enable CORS for all routes
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true
}));

app.use(
  express.json({
    limit: "500mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ limit: "500mb", extended: true, parameterLimit: 500000 }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Register ALL API routes
  await registerRoutes(httpServer, app);

  // Vite (dev) or static (prod)
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ✅ SPA FALLBACK — THIS IS THE FIX FOR 404
  // Allows React/Wouter to handle routing
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    if (process.env.NODE_ENV === "production") {
      return res.sendFile(
        path.resolve(process.cwd(), "dist/public/index.html")
      );
    }

    // In development, let Vite handle index.html
    next();
  });

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  // Server listen
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = "localhost";

  console.log("[index] About to call httpServer.listen()");

  httpServer.on("error", (err: any) => {
    console.error("[index] Server error:", err);
  });

  httpServer.listen(
    {
      port,
      host,
    },
    () => {
      log(`🚀 Server running on http://localhost:${port}`);
    },
  );

  console.log("[index] httpServer.listen() called (async)");
})().catch(err => {
  console.error("[index] Fatal error during startup:", err);
  process.exit(1);
});