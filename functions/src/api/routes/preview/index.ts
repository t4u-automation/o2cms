/**
 * Content Preview API (CPA) - Preview Router
 * Read-only API for ALL content (published and drafts)
 * Base path: /preview/spaces
 */

import { Router } from "express";
import express from "express";
import entriesRouter from "./entries";
import assetsRouter from "./assets";
import contentTypesRouter from "./contentTypes";
import localesRouter from "./locales";
const router = Router({ mergeParams: true });

// Parse JSON for all routes
router.use(express.json());

/**
 * Mount resource routers
 * Path structure: /preview/spaces/:space_id/environments/:env_id/...
 * 
 * Note: resolveEnvironment middleware is applied inside each route handler
 * after authentication, to convert environment names to document IDs.
 */
router.use("/:space_id/environments/:env_id/entries", entriesRouter);
router.use("/:space_id/environments/:env_id/assets", assetsRouter);
router.use("/:space_id/environments/:env_id/content_types", contentTypesRouter);
router.use("/:space_id/environments/:env_id/locales", localesRouter);

// Space info endpoint
router.get("/:space_id", async (req, res, next) => {
  try {
    res.json({
      sys: {
        type: "Space",
        id: req.params.space_id,
      },
      name: "Space",
    });
  } catch (error) {
    next(error);
  }
});

export default router;

