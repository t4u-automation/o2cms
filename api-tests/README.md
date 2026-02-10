# API Tests

This directory contains end-to-end tests for the O2 CMS API.

## Main Test File

**`test-full-e2e.sh`** - Comprehensive E2E test covering:
- Content Management API (CMA) - Create, update, delete
- Content Delivery API (CDA) - Read published content
- Content Preview API (CPA) - Read all content including drafts

### Running Tests

**CMA Only:**
```bash
./test-full-e2e.sh YOUR_CMA_TOKEN
```

**CMA + CDA:**
```bash
./test-full-e2e.sh YOUR_CMA_TOKEN YOUR_CDA_TOKEN
```

**CMA + CDA + CPA (Full Test):**
```bash
./test-full-e2e.sh YOUR_CMA_TOKEN YOUR_CDA_TOKEN YOUR_CPA_TOKEN
```

**Alternative: Using environment variables:**
```bash
export CDA_TOKEN="your_cda_token"
export CPA_TOKEN="your_cpa_token"
./test-full-e2e.sh YOUR_CMA_TOKEN
```

### Test Flow

1. **Phase 1-6.9**: Create all content (spaces, environments, content types, entries, assets)
2. **Phase 7**: List all resources
3. **Phase 7.5**: Test CDA endpoints (if CDA_TOKEN set)
4. **Phase 7.6**: Test CPA endpoints (if CPA_TOKEN set)
5. **Wait 2 minutes** (time to check UI)
6. **Phase 8**: Delete all resources
7. **Phase 9**: Verify cleanup

### What's Tested

#### Content Management API (CMA)
- ✅ Spaces CRUD
- ✅ Environments CRUD
- ✅ Content Types CRUD & Publishing
- ✅ Entries CRUD, Publishing, Archiving
- ✅ Multi-locale entries
- ✅ Assets upload, processing, publishing
- ✅ Link fields (Entry & Asset references)
- ✅ All 11 field types
- ✅ Field validations

#### Content Delivery API (CDA)
- ✅ Get published entries
- ✅ Get single entry
- ✅ Query parameters (limit, order, select)
- ✅ Link resolution (include parameter)
- ✅ Field selection
- ✅ Published assets
- ✅ MIME type filtering
- ✅ Content types & locales
- ✅ **Cursor pagination** (with pageNext)

#### Content Preview API (CPA)
- ✅ Get all entries (including drafts)
- ✅ Get single entry (any status)
- ✅ Query parameters
- ✅ Link resolution
- ✅ All assets (including drafts)
- ✅ Content types & locales
- ✅ **Cursor pagination**
- ✅ Full-text search

### Test Count

**Total: ~120+ tests** covering all APIs

### Requirements

- `curl` - HTTP client
- `jq` - JSON processor
- CMA API key (required)
- CDA API key (optional, for delivery API tests)
- CPA API key (optional, for preview API tests)

### Creating API Keys

1. Log into O2 CMS
2. Go to Settings → API Keys
3. Create keys for each type:
   - **CMA** - Content Management (read/write)
   - **CDA** - Content Delivery (read published only)
   - **CPA** - Content Preview (read all including drafts)

### Example Output

```
╔═══════════════════════════════════════════════════════════════╗
║  FULL E2E TEST: CMA → CDA → CPA                            ║
╚═══════════════════════════════════════════════════════════════╝

Base URL: https://us-central1-t4u-cms.cloudfunctions.net/api
CMA Key:  o2_cma_12345... ✓
CDA Key:  o2_cda_67890... ✓
CPA Key:  o2_cpa_abcde... ✓

┌─ PHASE 1: SPACE CREATION ─────────────────────────────────┐
✓ Create Space (HTTP 201)
...

┌─ PHASE 7.5: CONTENT DELIVERY API (CDA) ───────────────────┐
✓ CDA: Get all published entries (HTTP 200)
✓ CDA: Get single published entry (HTTP 200)
✓ CDA: Cursor pagination (initial) (HTTP 200)
...

┌─ PHASE 7.6: CONTENT PREVIEW API (CPA) ────────────────────┐
✓ CPA: Get all entries (incl. drafts) (HTTP 200)
✓ CPA: Cursor pagination (HTTP 200)
...

╔═══════════════════════════════════════════════════════════════╗
║  TEST SUMMARY                                                 ║
╚═══════════════════════════════════════════════════════════════╝

Passed: 120
Failed: 0

✓ ALL TESTS PASSED
```

### Troubleshooting

**CDA/CPA tests skipped:**
- Make sure `CDA_TOKEN` and `CPA_TOKEN` are exported before running
- Verify tokens are valid and not expired

**404 errors on CDA/CPA:**
- Functions may not be deployed yet
- Run `firebase deploy --only functions` first

**No published content in CDA:**
- CDA only returns published entries/assets
- Ensure content is published in Phase 6

### Notes

- CDA/CPA tests run **before** the 2-minute wait period
- This allows testing delivery APIs with freshly created content
- All content is cleaned up at the end
- If a test fails, cleanup still runs
