/**
 * Standalone Upload Test Function (v2)
 * Simple isolated test to verify multer works without any middleware interference
 */

import { onRequest } from "firebase-functions/v2/https";
import express from "express";
import cors from "cors";
import busboy from "busboy";

const app = express();

// CORS
app.use(cors({ origin: true }));

// Test upload endpoint using busboy directly with rawBody
app.post("/upload", (req: any, res) => {
  console.log('[Test Upload] Content-Type:', req.headers['content-type']);
  console.log('[Test Upload] Method:', req.method);
  console.log('[Test Upload] Has rawBody:', !!req.rawBody);
  console.log('[Test Upload] rawBody length:', req.rawBody?.length);
  
  const bb = busboy({ headers: req.headers });
  const files: any[] = [];

  bb.on('file', (fieldname: string, file: any, info: any) => {
    console.log('[Test Upload] File detected:', info);
    const chunks: Buffer[] = [];
    
    file.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    
    file.on('end', () => {
      const buffer = Buffer.concat(chunks);
      files.push({
        fieldname,
        originalname: info.filename,
        mimetype: info.mimeType,
        size: buffer.length,
      });
      console.log('[Test Upload] File received:', info.filename, buffer.length, 'bytes');
    });
  });

  bb.on('error', (error: Error) => {
    console.error('[Test Upload] Busboy error:', error);
    res.status(500).json({ success: false, error: error.message });
  });

  bb.on('finish', () => {
    console.log('[Test Upload] Busboy finished, files:', files.length);
    res.json({
      success: true,
      message: 'File uploaded successfully!',
      files,
    });
  });

  // Use rawBody instead of piping req (Firebase Functions requirement)
  if (req.rawBody) {
    bb.end(req.rawBody);
  } else {
    req.pipe(bb);
  }
});

// Health check
app.get("/", (req, res) => {
  res.json({ message: "Upload test endpoint ready" });
});

export const testUpload = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
    cors: true,
  },
  app
);

