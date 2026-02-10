/**
 * API Main App
 * Express.js API for C4U CMS
 */

import express from "express";
import cors from "cors";
import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { ApiError, ServerError } from "./errors";
import spacesRouter from "./routes/spaces";
import cdnRouter from "./routes/cdn";
import previewRouter from "./routes/preview";
import migrationRouter from "./routes/migration";

const app = express();

// ============================================
// Middleware
// ============================================

// CORS configuration
const corsOptions = {
  origin: true, // Allow all origins (can restrict in production)
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Contentful-User-Agent"],
};

app.use(cors(corsOptions));

// DO NOT parse JSON bodies globally - let individual routes handle it
// This prevents consuming the body stream before multer can process uploads

// Add request ID to every request
app.use((req: Request, res: Response, next: NextFunction) => {
  req.requestId = randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  next();
});

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`[API] ${req.method} ${req.path} - ${req.requestId}`);
  next();
});

// ============================================
// Routes
// ============================================

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// API v1 routes (Content Management API)
app.use("/v1/spaces", spacesRouter);

// Migration API routes
app.use("/v1/migration", migrationRouter);

// Content Delivery API (CDA) - published content only
app.use("/cdn/spaces", cdnRouter);

// Content Preview API (CPA) - includes drafts
app.use("/preview/spaces", previewRouter);

// Root redirect
app.get("/", (req: Request, res: Response) => {
  res.json({
    message: "O2 CMS Content Management API",
    version: "1.0.0",
    documentation: "https://docs.o2cms.com",
    endpoints: {
      health: "/health",
      cma: "/v1/spaces",
      migration: "/v1/migration",
      cda: "/cdn/spaces",
      cpa: "/preview/spaces",
    },
  });
});

// ============================================
// Error Handling
// ============================================

// 404 handler
app.use((req: Request, res: Response, next: NextFunction) => {
  res.status(404).json({
    sys: {
      type: "Error",
      id: "NotFound",
    },
    message: `The requested endpoint '${req.method} ${req.path}' was not found.`,
    requestId: req.requestId,
  });
});

// Global error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const errorDetails = {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    timestamp: new Date().toISOString(),
    errorName: err.name,
    errorCode: err.code,
    errorStatus: err.status,
    message: err.message,
  };

  console.error(`[API Error] ${req.requestId}:`, errorDetails);
  console.error(`[API Error Stack]:`, err.stack);

  if (err instanceof ApiError) {
    const response = err.toJSON();
    response.requestId = req.requestId;
    if (process.env.NODE_ENV === "development") {
      response._debug = errorDetails;
    }
    return res.status(err.statusCode).json(response);
  }

  // Unknown error - return generic 500 with more details in development
  const genericError = new ServerError(
    process.env.NODE_ENV === "development" ? err.message : "An internal server error occurred."
  );
  const response = genericError.toJSON();
  response.requestId = req.requestId;
  if (process.env.NODE_ENV === "development") {
    response._debug = {
      ...errorDetails,
      errorMessage: err.message,
      errorCode: err.code,
      stack: err.stack?.split("\n").slice(0, 5), // First 5 stack lines
    };
  }
  return res.status(500).json(response);
});

export default app;

