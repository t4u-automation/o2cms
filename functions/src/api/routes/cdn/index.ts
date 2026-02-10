/**
 * Content Delivery API (CDA) - CDN Router
 * Read-only API for published content
 * Base path: /cdn/spaces
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
 * Path structure: /cdn/spaces/:space_id/environments/:env_id/...
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
    // Simple space info - just return basic space details
    res.json({
      sys: {
        type: "Space",
        id: req.params.space_id,
      },
      name: "Space", // TODO: Fetch actual space name
    });
  } catch (error) {
    next(error);
  }
});

export default router;

