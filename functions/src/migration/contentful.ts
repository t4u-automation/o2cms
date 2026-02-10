/**
 * Contentful API Client
 * Handles all interactions with Contentful CMA and CDA APIs
 */

import axios, { AxiosInstance } from "axios";
import * as jwt from "jsonwebtoken";
import {
  ContentfulContentType,
  ContentfulAsset,
  ContentfulEntry,
  ContentfulLocale,
} from "./types";

const CONTENTFUL_CMA_URL = "https://api.contentful.com";
const CONTENTFUL_CDA_URL = "https://cdn.contentful.com";
const PAGE_SIZE = 100;
const RATE_LIMIT_DELAY = 100; // ms
const ASSET_KEY_LIFETIME = 48 * 60 * 60; // 48 hours in seconds
const JWT_TOKEN_LIFETIME = 15 * 60; // 15 minutes in seconds

export class ContentfulClient {
  private cdaClient: AxiosInstance;
  private cmaClient: AxiosInstance;
  private accessToken: string; // Token for asset downloads
  private spaceId: string;
  private environment: string;
  private cmaToken: string;
  
  // Embargoed asset signing
  private assetKey: { secret: string; policy: string } | null = null;
  private assetKeyExpires: number | null = null;

  constructor(
    spaceId: string,
    environment: string,
    cmaToken: string,
    cdaToken?: string
  ) {
    // Store for later use (asset key creation)
    this.spaceId = spaceId;
    this.environment = environment;
    this.cmaToken = cmaToken.trim();
    
    // Use CDA for reads if token provided (faster), otherwise use CMA
    // Trim tokens to remove any accidental whitespace/newlines
    const readToken = (cdaToken || cmaToken).trim();
    const readBaseUrl = cdaToken ? CONTENTFUL_CDA_URL : CONTENTFUL_CMA_URL;

    // Store token for asset downloads (prefer CDA token if available)
    this.accessToken = readToken;

    this.cdaClient = axios.create({
      baseURL: `${readBaseUrl}/spaces/${spaceId}/environments/${environment}`,
      headers: {
        Authorization: `Bearer ${readToken}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    // CMA client for entries (to get drafts) and assets
    this.cmaClient = axios.create({
      baseURL: `${CONTENTFUL_CMA_URL}/spaces/${spaceId}/environments/${environment}`,
      headers: {
        Authorization: `Bearer ${this.cmaToken}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  }

  /**
   * Get all content types
   */
  async getContentTypes(): Promise<ContentfulContentType[]> {
    const response = await this.cdaClient.get("/content_types", {
      params: { limit: 1000 },
    });
    return response.data.items || [];
  }

  /**
   * Get specific content types by IDs
   */
  async getContentTypesByIds(ids: string[]): Promise<ContentfulContentType[]> {
    const allTypes = await this.getContentTypes();
    return allTypes.filter((ct) => ids.includes(ct.sys.id));
  }

  /**
   * Get all locales
   */
  async getLocales(): Promise<ContentfulLocale[]> {
    // Use CMA for locales to ensure consistency with entry data
    const response = await this.cmaClient.get("/locales");
    return response.data.items || [];
  }

  /**
   * Get all assets with pagination
   * Uses CMA to include draft/unpublished assets with file info
   */
  async getAllAssets(
    onProgress?: (fetched: number, total: number) => void
  ): Promise<ContentfulAsset[]> {
    const assets: ContentfulAsset[] = [];
    let skip = 0;
    let total = 0;

    do {
      // Use CMA to get all assets including drafts
      const response = await this.cmaClient.get("/assets", {
        params: { limit: PAGE_SIZE, skip },
      });

      total = response.data.total || 0;
      const items = response.data.items || [];
      assets.push(...items);

      if (onProgress) {
        onProgress(assets.length, total);
      }

      skip += PAGE_SIZE;
      await this.delay(RATE_LIMIT_DELAY);
    } while (skip < total);

    return assets;
  }

  /**
   * Get assets by specific IDs (for linked asset strategy)
   * Uses CMA to include draft/unpublished assets with file info
   */
  async getAssetsByIds(
    ids: string[],
    onProgress?: (fetched: number, total: number) => void
  ): Promise<ContentfulAsset[]> {
    const assets: ContentfulAsset[] = [];
    const chunks = this.chunkArray(ids, 100); // Contentful allows up to 100 IDs per query

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      // Use CMA to get all assets including drafts
      const response = await this.cmaClient.get("/assets", {
        params: {
          "sys.id[in]": chunk.join(","),
          limit: 100,
        },
      });

      assets.push(...(response.data.items || []));

      if (onProgress) {
        onProgress(assets.length, ids.length);
      }

      await this.delay(RATE_LIMIT_DELAY);
    }

    return assets;
  }

  /**
   * Get all entries for specific content types with pagination
   * Uses CMA to include draft entries (CDA only returns published)
   */
  async getEntriesForContentTypes(
    contentTypeIds: string[],
    onProgress?: (fetched: number, total: number) => void
  ): Promise<ContentfulEntry[]> {
    const entries: ContentfulEntry[] = [];
    let totalExpected = 0;

    for (const ctId of contentTypeIds) {
      let skip = 0;
      let total = 0;

      do {
        try {
          // Use CMA to get all entries including drafts
          const response = await this.cmaClient.get("/entries", {
            params: {
              content_type: ctId,
              limit: PAGE_SIZE,
              skip,
            },
          });

          total = response.data.total || 0;
          if (skip === 0) {
            totalExpected += total;
          }

          const items = response.data.items || [];
          entries.push(...items);

          if (onProgress) {
            onProgress(entries.length, totalExpected);
          }

          skip += PAGE_SIZE;
          await this.delay(RATE_LIMIT_DELAY);
        } catch (error: any) {
          // Check if this is a "content type not found" error
          if (error.response?.status === 400) {
            const errorMessage = error.response?.data?.message || "";
            console.error(`[getEntriesForContentTypes] Content type "${ctId}" query failed: ${errorMessage}`);
            console.error(`[getEntriesForContentTypes] Space: ${this.spaceId}, Environment: ${this.environment}`);
            throw new Error(`Content type "${ctId}" not found or invalid in Contentful space "${this.spaceId}" environment "${this.environment}". Please ensure the content type exists.`);
          }
          throw error;
        }
      } while (skip < total);
    }

    return entries;
  }

  /**
   * Get a single entry by ID
   */
  async getEntry(entryId: string): Promise<ContentfulEntry | null> {
    try {
      const response = await this.cdaClient.get(`/entries/${entryId}`, {
        params: { locale: "*" },
      });
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get a single asset by ID
   */
  async getAsset(assetId: string): Promise<ContentfulAsset | null> {
    try {
      const response = await this.cdaClient.get(`/assets/${assetId}`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get or create asset key for embargoed asset signing
   * Asset keys are cached and reused until they expire
   */
  private async getOrCreateAssetKey(): Promise<{ secret: string; policy: string }> {
    // Check if we have a valid cached key (with 5 min buffer)
    const now = Math.floor(Date.now() / 1000);
    if (this.assetKey && this.assetKeyExpires && now < this.assetKeyExpires - 300) {
      return this.assetKey;
    }

    // Create new asset key via CMA API
    const expiresAt = now + ASSET_KEY_LIFETIME;
    const url = `${CONTENTFUL_CMA_URL}/spaces/${this.spaceId}/environments/${this.environment}/asset_keys`;
    
    try {
      const response = await axios.post(
        url,
        { expiresAt },
        {
          headers: {
            Authorization: `Bearer ${this.cmaToken}`,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        }
      );

      this.assetKey = {
        secret: response.data.secret,
        policy: response.data.policy,
      };
      this.assetKeyExpires = expiresAt;

      return this.assetKey;
    } catch (error: any) {
      const status = error.response?.status;
      const message = error.response?.data?.message || error.message;
      console.error(`[getOrCreateAssetKey] Failed to create asset key: HTTP ${status} - ${message}`);
      throw new Error(`Asset key creation failed: ${message}`);
    }
  }

  /**
   * Sign an embargoed asset URL using JWT
   * Handles URLs with unicode characters by trying multiple URL formats
   */
  private async signEmbargoedUrl(url: string): Promise<{ signedUrl: string; variants: string[] }> {
    const key = await this.getOrCreateAssetKey();
    const exp = Math.floor(Date.now() / 1000) + JWT_TOKEN_LIFETIME;

    // Parse URL to handle encoding properly
    const urlObj = new URL(url);
    
    // Create multiple URL variants to try (for unicode characters in filenames)
    const urlVariants: string[] = [
      url, // Original URL
      urlObj.origin + encodeURI(decodeURI(urlObj.pathname)), // Re-encoded
      urlObj.origin + urlObj.pathname.split('/').map(p => encodeURIComponent(decodeURIComponent(p))).join('/'), // Component-encoded
    ];

    // Remove duplicates
    const uniqueVariants = [...new Set(urlVariants)];

    // Create signed URLs for each variant
    const signedVariants: string[] = [];
    for (const variant of uniqueVariants) {
      const token = jwt.sign(
        { sub: variant, exp },
        key.secret,
        { algorithm: "HS256" }
      );
      signedVariants.push(`${variant}?token=${token}&policy=${key.policy}`);
    }

    return { signedUrl: signedVariants[0], variants: signedVariants };
  }

  /**
   * Download asset file to buffer
   * Handles both regular and secure/embargoed assets with fallback authentication
   */
  async downloadAssetFile(url: string): Promise<Buffer> {
    // Ensure URL has protocol
    let fullUrl = url;
    if (url.startsWith("//")) {
      fullUrl = "https:" + url;
    }

    const sanitizedUrl = fullUrl.split("?")[0];
    const isSecureAsset = fullUrl.includes("secure.ctfassets.net");

    // Try different authentication methods in order
    const authMethods: Array<{ name: string; getUrl: () => Promise<string> }> = [];

    if (isSecureAsset) {
      // For secure assets, try JWT signing with URL variants first
      authMethods.push({
        name: "JWT signing (with URL variants)",
        getUrl: async () => {
          try {
            const { signedUrl, variants } = await this.signEmbargoedUrl(fullUrl);
            // Store variants for retry
            (this as any)._jwtVariants = variants;
            return signedUrl;
          } catch (e) {
            console.warn(`[downloadAssetFile] JWT signing setup failed, skipping`);
            throw e;
          }
        },
      });
      authMethods.push({
        name: "access_token",
        getUrl: async () => {
          const separator = fullUrl.includes("?") ? "&" : "?";
          return `${fullUrl}${separator}access_token=${this.accessToken}`;
        },
      });
    } else {
      // For regular assets, try access_token first, then JWT signing as fallback
      authMethods.push({
        name: "access_token",
        getUrl: async () => {
          const separator = fullUrl.includes("?") ? "&" : "?";
          return `${fullUrl}${separator}access_token=${this.accessToken}`;
        },
      });
      authMethods.push({
        name: "JWT signing",
        getUrl: async () => {
          try {
            const { signedUrl } = await this.signEmbargoedUrl(fullUrl);
            return signedUrl;
          } catch (e) {
            console.warn(`[downloadAssetFile] JWT signing setup failed, skipping`);
            throw e;
          }
        },
      });
    }

    // Also try without any auth as last resort (public assets)
    authMethods.push({
      name: "no auth",
      getUrl: async () => fullUrl,
    });

    let lastError: any = null;

    for (const method of authMethods) {
      try {
        const authenticatedUrl = await method.getUrl();
        
        // For JWT signing with variants, try all variants
        if (method.name.includes("JWT signing") && (this as any)._jwtVariants?.length > 1) {
          const variants = (this as any)._jwtVariants as string[];
          for (let i = 0; i < variants.length; i++) {
            try {
              const response = await axios.get(variants[i], {
                responseType: "arraybuffer",
                timeout: 120000,
                headers: { "User-Agent": "O2CMS-Migration/1.0" },
              });
              return Buffer.from(response.data);
            } catch (variantError: any) {
              if (i === variants.length - 1) {
                throw variantError; // Last variant, let outer catch handle it
              }
              // Try next variant
            }
          }
        } else {
          const response = await axios.get(authenticatedUrl, {
            responseType: "arraybuffer",
            timeout: 120000, // 2 minutes for large files
            headers: {
              "User-Agent": "O2CMS-Migration/1.0",
            },
          });
          return Buffer.from(response.data);
        }
      } catch (error: any) {
        const statusCode = error.response?.status;
        // Only log if it's not a 403 (expected for wrong auth method)
        if (statusCode !== 403 && statusCode !== 401) {
          console.warn(`[downloadAssetFile] ${method.name} failed for ${sanitizedUrl}: HTTP ${statusCode}`);
        }
        lastError = error;
        // Continue to next method
      }
    }

    // All methods failed
    const statusCode = lastError?.response?.status;
    const errorData = lastError?.response?.data 
      ? Buffer.from(lastError.response.data).toString("utf-8").substring(0, 500) 
      : "";
    
    // Check if this is likely a unicode filename issue with secure CDN
    const hasUnicodeChars = /[^\x00-\x7F]/.test(fullUrl);
    if (statusCode === 403 && isSecureAsset && hasUnicodeChars) {
      console.error(`[downloadAssetFile] Asset has unicode characters in filename and secure CDN returned 403. This is a known Contentful limitation.`);
      throw new Error(`Secure asset has unicode characters in filename (403) - rename file in Contentful to use ASCII characters only`);
    }
    
    console.error(`[downloadAssetFile] All auth methods failed for ${sanitizedUrl}: HTTP ${statusCode}`, errorData);
    throw lastError;
  }

  /**
   * Extract all asset IDs referenced in entries (including Rich Text)
   */
  extractLinkedAssetIds(entries: ContentfulEntry[]): Set<string> {
    const assetIds = new Set<string>();

    const extractFromValue = (value: any): void => {
      if (!value || typeof value !== "object") {
        return;
      }

      // Check for Asset link
      const sys = value.sys;
      if (sys?.type === "Link" && sys?.linkType === "Asset") {
        if (sys.id) {
          assetIds.add(sys.id);
        }
        return;
      }

      // Check for Rich Text embedded assets
      if (
        value.nodeType === "embedded-asset-block" ||
        value.nodeType === "asset-hyperlink"
      ) {
        const assetId = value.data?.target?.sys?.id;
        if (assetId) {
          assetIds.add(assetId);
        }
      }

      // Recursively check nested objects and arrays
      if (Array.isArray(value)) {
        for (const item of value) {
          extractFromValue(item);
        }
      } else {
        for (const key in value) {
          extractFromValue(value[key]);
        }
      }
    };

    for (const entry of entries) {
      extractFromValue(entry.fields);
    }

    return assetIds;
  }

  /**
   * Helper: Split array into chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Helper: Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

