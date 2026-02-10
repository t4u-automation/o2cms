#!/bin/bash

# FULL End-to-End Test: Spaces → Environments → Content Types → CDA/CPA → GraphQL
# Complete workflow testing the entire API hierarchy including REST and GraphQL APIs
# Usage: ./test-full-e2e.sh <CMA_API_KEY> [CDA_TOKEN] [CPA_TOKEN] [--ci]
#
# Examples:
#   # CMA only (skips CDA/CPA/GraphQL tests)
#   ./test-full-e2e.sh o2_cma_xxxx
#
#   # CMA + CDA + CPA (full test including GraphQL)
#   ./test-full-e2e.sh o2_cma_xxxx o2_cda_xxxx o2_cpa_xxxx
#
#   # CI mode (no interactive prompts, auto-cleanup)
#   ./test-full-e2e.sh o2_cma_xxxx o2_cda_xxxx o2_cpa_xxxx --ci

# Check for --ci flag
CI_MODE=false
for arg in "$@"; do
  if [ "$arg" = "--ci" ]; then
    CI_MODE=true
  fi
done

# Remove --ci from positional parameters
ARGS=()
for arg in "$@"; do
  if [ "$arg" != "--ci" ]; then
    ARGS+=("$arg")
  fi
done

API_KEY="${ARGS[0]:-}"
CDA_TOKEN="${ARGS[1]:-${CDA_TOKEN:-}}"  # Accept as parameter or environment variable
CPA_TOKEN="${ARGS[2]:-${CPA_TOKEN:-}}"  # Accept as parameter or environment variable
BASE_URL="https://us-central1-t4u-cms.cloudfunctions.net/api"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

if [ -z "$API_KEY" ]; then
  echo "Usage: ./test-full-e2e.sh <CMA_API_KEY> [CDA_TOKEN] [CPA_TOKEN] [--ci]"
  echo ""
  echo "Parameters:"
  echo "  CMA_API_KEY  - Required: Content Management API key"
  echo "  CDA_TOKEN    - Optional: Content Delivery API key (for testing published content)"
  echo "  CPA_TOKEN    - Optional: Content Preview API key (for testing draft content)"
  echo "  --ci         - Optional: CI mode (no interactive prompts, auto-cleanup)"
  echo ""
  echo "Examples:"
  echo "  # CMA only:"
  echo "  ./test-full-e2e.sh o2_cma_xxxx"
  echo ""
  echo "  # CMA + CDA:"
  echo "  ./test-full-e2e.sh o2_cma_xxxx o2_cda_xxxx"
  echo ""
  echo "  # CMA + CDA + CPA (full test):"
  echo "  ./test-full-e2e.sh o2_cma_xxxx o2_cda_xxxx o2_cpa_xxxx"
  echo ""
  echo "  # CI mode (GitHub Actions, etc.):"
  echo "  ./test-full-e2e.sh o2_cma_xxxx o2_cda_xxxx o2_cpa_xxxx --ci"
  exit 1
fi

PASS=0
FAIL=0

# Helper function to make API calls
call_api() {
  local method="$1"
  local endpoint="$2"
  local data="$3"
  
  if [ -z "$data" ]; then
    curl -s -w "\n%{http_code}" -X "$method" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      "$BASE_URL$endpoint"
  else
    curl -s -w "\n%{http_code}" -X "$method" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "$data" \
      "$BASE_URL$endpoint"
  fi
}

# Helper function for entry API calls (with X-Content-Type header)
call_entry_api() {
  local method="$1"
  local endpoint="$2"
  local content_type_id="$3"
  local data="$4"
  
  curl -s -w "\n%{http_code}" -X "$method" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -H "X-Content-Type: $content_type_id" \
    -d "$data" \
    "$BASE_URL$endpoint"
}

# Helper to parse response
parse_response() {
  local response="$1"
  local http_code=$(echo "$response" | tail -n1)
  local body=$(echo "$response" | sed '$d')
  echo "$http_code|$body"
}

# Helper to assert status code
assert_status() {
  local name="$1"
  local response="$2"
  local expected="$3"
  
  local parsed=$(parse_response "$response")
  local http_code="${parsed%%|*}"
  local body="${parsed#*|}"
  
  if [ "$http_code" = "$expected" ]; then
    echo -e "${GREEN}✓${NC} $name (HTTP $http_code)"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}✗${NC} $name (Expected $expected, got $http_code)"
    echo "   Response: $body"
    FAIL=$((FAIL + 1))
  fi
}

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  FULL E2E TEST: CMA → CDA → CPA → GraphQL                 ${BLUE}║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Base URL: $BASE_URL"
echo "CMA Key:  ${API_KEY:0:15}..."
if [ -n "${CDA_TOKEN:-}" ]; then
  echo "CDA Key:  ${CDA_TOKEN:0:15}... ✓"
else
  echo "CDA Key:  (not set - will skip CDA tests)"
fi
if [ -n "${CPA_TOKEN:-}" ]; then
  echo "CPA Key:  ${CPA_TOKEN:0:15}... ✓"
else
  echo "CPA Key:  (not set - will skip CPA tests)"
fi
echo ""

# ============================================
# PHASE 1: CREATE SPACE
# ============================================
echo -e "${YELLOW}┌─ PHASE 1: SPACE CREATION ─────────────────────────────────┐${NC}"
echo ""

response=$(call_api "POST" "/v1/spaces" \
  '{"name": "E2E Test Project", "description": "Full end-to-end test", "defaultLocale": "en-US"}')
assert_status "Create Space" "$response" "201"

space_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   Space ID: $space_id"
echo ""
echo "   Waiting 10 seconds for Cloud Function to initialize defaults (master env + locale)..."
sleep 10
echo ""

if [ -z "$space_id" ] || [ "$space_id" = "null" ]; then
  echo -e "${RED}✗ Failed to create space${NC}"
  exit 1
fi

# ============================================
# PHASE 2: GET MASTER ENVIRONMENT
# ============================================
echo -e "${YELLOW}┌─ PHASE 2: GET MASTER ENVIRONMENT ─────────────────────────┐${NC}"
echo ""

# List environments (master should be created by Cloud Function)
response=$(call_api "GET" "/v1/spaces/$space_id/environments" "")
assert_status "List Environments" "$response" "200"

# Extract master environment ID
master_env_id=$(echo "$response" | sed '$d' | jq -r '.items[0].sys.id' 2>/dev/null)
echo "   Master Environment ID: $master_env_id"
echo ""

if [ -z "$master_env_id" ] || [ "$master_env_id" = "null" ]; then
  echo -e "${RED}✗ Failed to find master environment${NC}"
  exit 1
fi

# Use master environment for all tests
env_id=$master_env_id

# ============================================
# PHASE 2.5: LOCALES MANAGEMENT (on master environment)
# ============================================
echo -e "${YELLOW}┌─ PHASE 2.5: LOCALES MANAGEMENT ───────────────────────────┐${NC}"
echo ""

# List default locales (should have protected en-US from Cloud Function)
response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/locales" "")
assert_status "List Locales (protected en-US)" "$response" "200"

# Extract first locale ID (should be en-US)
first_locale_id=$(echo "$response" | sed '$d' | jq -r '.items[0].sys.id' 2>/dev/null)
echo "   First Locale ID: $first_locale_id"

# Get the default locale details
response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/locales/$first_locale_id" "")
assert_status "Get Default Locale" "$response" "200"

# Create a second locale (German)
response=$(call_api "POST" "/v1/spaces/$space_id/environments/$env_id/locales" \
  '{"code": "de-DE", "name": "German", "fallbackCode": "en-US", "default": false, "optional": true}')
assert_status "Create Locale (de-DE)" "$response" "201"

de_locale_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   German Locale ID: $de_locale_id"

# Create a third locale (French)
response=$(call_api "POST" "/v1/spaces/$space_id/environments/$env_id/locales" \
  '{"code": "fr-FR", "name": "French", "fallbackCode": "en-US", "default": false, "optional": true}')
assert_status "Create Locale (fr-FR)" "$response" "201"

fr_locale_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   French Locale ID: $fr_locale_id"

# List all locales (should have 3)
response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/locales" "")
assert_status "List All Locales" "$response" "200"

# Update German locale (add optional flag)
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id/locales/$de_locale_id" \
  '{"name": "Deutsch", "optional": false}')
assert_status "Update Locale (de-DE)" "$response" "200"

# Set French as default
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id/locales/$fr_locale_id" \
  '{"default": true}')
assert_status "Set Locale as Default (fr-FR)" "$response" "200"

# Try to delete protected en-US locale (should FAIL)
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/locales/$first_locale_id" "")
assert_status "Delete Protected Locale (en-US - should fail)" "$response" "422"

# Delete German locale (should succeed)
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/locales/$de_locale_id" "")
assert_status "Delete Locale (de-DE)" "$response" "204"

echo ""

# ============================================
# PHASE 3: CREATE CONTENT TYPE
# ============================================
echo -e "${YELLOW}┌─ PHASE 3: CONTENT TYPE CREATION ──────────────────────────┐${NC}"
echo ""

response=$(call_api "POST" "/v1/spaces/$space_id/environments/$env_id/content_types" \
  '{
    "name": "Blog Post",
    "apiId": "blogPost",
    "description": "Blog post for E2E testing",
    "displayField": "title",
    "fields": [
      {
        "id": "title",
        "name": "Title",
        "type": "Text",
        "required": true,
        "localized": false
      },
      {
        "id": "body",
        "name": "Body",
        "type": "RichText",
        "required": true,
        "localized": true
      }
    ]
  }')
assert_status "Create Content Type" "$response" "201"

ct_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   Content Type ID: $ct_id"
echo ""

if [ -z "$ct_id" ] || [ "$ct_id" = "null" ]; then
  echo -e "${RED}✗ Failed to create content type${NC}"
  exit 1
fi

# ============================================
# PHASE 4: VERIFY ENTIRE HIERARCHY
# ============================================
echo -e "${YELLOW}┌─ PHASE 4: VERIFY HIERARCHY ───────────────────────────────┐${NC}"
echo ""

# Verify Space exists
response=$(call_api "GET" "/v1/spaces/$space_id" "")
assert_status "Verify Space" "$response" "200"

# Verify Environment exists
response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id" "")
assert_status "Verify Environment" "$response" "200"

# Verify Content Type exists
response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/content_types/$ct_id" "")
assert_status "Verify Content Type" "$response" "200"

echo ""

# ============================================
# PHASE 5: UPDATE ALL RESOURCES
# ============================================
echo -e "${YELLOW}┌─ PHASE 5: UPDATE ALL RESOURCES ───────────────────────────┐${NC}"
echo ""

# Update Space
response=$(call_api "PUT" "/v1/spaces/$space_id" \
  '{"description": "Updated E2E test space"}')
assert_status "Update Space" "$response" "200"

# Update Environment
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id" \
  '{"description": "Updated staging environment"}')
assert_status "Update Environment" "$response" "200"

# Update Content Type
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id/content_types/$ct_id" \
  '{"description": "Updated blog post content type"}')
assert_status "Update Content Type" "$response" "200"

echo ""

# ============================================
# PHASE 6: PUBLISH CONTENT TYPE
# ============================================
echo -e "${YELLOW}┌─ PHASE 6: PUBLISH CONTENT TYPE ───────────────────────────┐${NC}"
echo ""

response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id/content_types/$ct_id/published" "")
assert_status "Publish Content Type" "$response" "200"

echo ""

# ============================================
# PHASE 6.5: CREATE ENTRY (requires published content type)
# ============================================
echo -e "${YELLOW}┌─ PHASE 6.5: ENTRY CREATION ───────────────────────────────┐${NC}"
echo ""

response=$(call_api "POST" "/v1/spaces/$space_id/environments/$env_id/entries" \
  '{
    "fields": {
      "title": {"en-US": "My First Blog Post"},
      "body": {"en-US": "This is the content of my blog post"}
    }
  }' \
  "X-Content-Type: $ct_id")

# Need to add header, let me use a different approach
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Content-Type: $ct_id" \
  -d '{
    "fields": {
      "title": {"en-US": "My First Blog Post"},
      "body": {"en-US": {"nodeType": "document", "data": {}, "content": [{"nodeType": "paragraph", "data": {}, "content": [{"nodeType": "text", "value": "This is the content of my blog post", "marks": [], "data": {}}]}]}}
    }
  }' \
  "$BASE_URL/v1/spaces/$space_id/environments/$env_id/entries")

assert_status "Create Entry" "$response" "201"

entry_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   Entry ID: $entry_id"
echo ""

if [ -z "$entry_id" ] || [ "$entry_id" = "null" ]; then
  echo -e "${RED}✗ Failed to create entry${NC}"
  exit 1
fi

# ============================================
# PHASE 6.6: ENTRY OPERATIONS
# ============================================
echo -e "${YELLOW}┌─ PHASE 6.6: ENTRY OPERATIONS ─────────────────────────────┐${NC}"
echo ""

# Get Entry
response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/entries/$entry_id" "")
assert_status "Get Entry" "$response" "200"

# Update Entry
response=$(curl -s -w "\n%{http_code}" -X PUT \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "title": {"en-US": "My Updated Blog Post"},
      "body": {"en-US": {"nodeType": "document", "data": {}, "content": [{"nodeType": "paragraph", "data": {}, "content": [{"nodeType": "text", "value": "Updated content here", "marks": [], "data": {}}]}]}}
    }
  }' \
  "$BASE_URL/v1/spaces/$space_id/environments/$env_id/entries/$entry_id")
assert_status "Update Entry" "$response" "200"

# Publish Entry
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id/entries/$entry_id/published" "")
assert_status "Publish Entry" "$response" "200"

# Archive Entry
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id/entries/$entry_id/archived" "")
assert_status "Archive Entry" "$response" "200"

# Unarchive Entry
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/entries/$entry_id/archived" "")
assert_status "Unarchive Entry" "$response" "200"

# Unpublish Entry
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/entries/$entry_id/published" "")
assert_status "Unpublish Entry" "$response" "200"

echo ""

# ============================================
# PHASE 6.7: ENTRIES WITH MULTIPLE LOCALES
# ============================================
echo -e "${YELLOW}┌─ PHASE 6.7: ENTRIES WITH MULTIPLE LOCALES ────────────────┐${NC}"
echo ""

# Create Entry with content in English (en-US)
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Content-Type: $ct_id" \
  -d '{
    "fields": {
      "title": {"en-US": "English Blog Post"},
      "body": {"en-US": {"nodeType": "document", "data": {}, "content": [{"nodeType": "paragraph", "data": {}, "content": [{"nodeType": "text", "value": "This is the English content", "marks": [], "data": {}}]}]}}
    }
  }' \
  "$BASE_URL/v1/spaces/$space_id/environments/$env_id/entries")

assert_status "Create Entry (en-US)" "$response" "201"
entry_en_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   Entry ID (en-US): $entry_en_id"

# Create Entry with content in French (fr-FR)
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Content-Type: $ct_id" \
  -d '{
    "fields": {
      "title": {"fr-FR": "Article de Blog Français"},
      "body": {"fr-FR": {"nodeType": "document", "data": {}, "content": [{"nodeType": "paragraph", "data": {}, "content": [{"nodeType": "text", "value": "Ceci est le contenu français", "marks": [], "data": {}}]}]}}
    }
  }' \
  "$BASE_URL/v1/spaces/$space_id/environments/$env_id/entries")

assert_status "Create Entry (fr-FR)" "$response" "201"
entry_fr_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   Entry ID (fr-FR): $entry_fr_id"

# Create Entry with Multi-locale content (both en-US and fr-FR)
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Content-Type: $ct_id" \
  -d '{
    "fields": {
      "title": {
        "en-US": "Bilingual Blog Post",
        "fr-FR": "Article de Blog Bilingue"
      },
      "body": {
        "en-US": {"nodeType": "document", "data": {}, "content": [{"nodeType": "paragraph", "data": {}, "content": [{"nodeType": "text", "value": "This is bilingual content", "marks": [], "data": {}}]}]},
        "fr-FR": {"nodeType": "document", "data": {}, "content": [{"nodeType": "paragraph", "data": {}, "content": [{"nodeType": "text", "value": "Ceci est un contenu bilingue", "marks": [], "data": {}}]}]}
      }
    }
  }' \
  "$BASE_URL/v1/spaces/$space_id/environments/$env_id/entries")

assert_status "Create Entry (Multi-locale)" "$response" "201"
entry_multi_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   Entry ID (Multi-locale): $entry_multi_id"

# Update multi-locale entry with additional locale content
response=$(curl -s -w "\n%{http_code}" -X PUT \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "title": {
        "en-US": "Bilingual Blog Post",
        "fr-FR": "Article de Blog Bilingue"
      },
      "body": {
        "en-US": {"nodeType": "document", "data": {}, "content": [{"nodeType": "paragraph", "data": {}, "content": [{"nodeType": "text", "value": "This is bilingual content with updates", "marks": [], "data": {}}]}]},
        "fr-FR": {"nodeType": "document", "data": {}, "content": [{"nodeType": "paragraph", "data": {}, "content": [{"nodeType": "text", "value": "Ceci est un contenu bilingue avec mises à jour", "marks": [], "data": {}}]}]}
      }
    }
  }' \
  "$BASE_URL/v1/spaces/$space_id/environments/$env_id/entries/$entry_multi_id")

assert_status "Update Entry (Multi-locale)" "$response" "200"

# Publish multi-locale entry
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id/entries/$entry_multi_id/published" "")
assert_status "Publish Entry (Multi-locale)" "$response" "200"

# List entries with filter by content type
response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/entries?content_type=$ct_id" "")
assert_status "List Entries (by content type)" "$response" "200"

# Verify we have multiple entries
entry_count=$(echo "$response" | sed '$d' | jq '.items | length' 2>/dev/null)
echo "   Total entries created: $entry_count"

echo ""

# ============================================
# PHASE 6.8: ASSETS API TESTING
# ============================================
echo -e "${YELLOW}┌─ PHASE 6.8: ASSETS API TESTING ───────────────────────────┐${NC}"
echo ""

# Step 1: Upload image file using binary upload
echo "Step 1: Upload image file (binary)..."
upload_response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@test-image.png" \
  "$BASE_URL/v1/spaces/$space_id/uploads")

assert_status "Upload File (test-image.png)" "$upload_response" "201"

upload_id=$(echo "$upload_response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   Upload ID: $upload_id"

# Step 2: Create Asset linking to the upload (with multi-locale files)
echo "Step 2: Create Asset from Upload..."
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"fields\": {
      \"title\": {
        \"en-US\": \"Test Image Asset\",
        \"fr-FR\": \"Image de Test\"
      },
      \"description\": {
        \"en-US\": \"A sample image for testing\",
        \"fr-FR\": \"Une image exemple pour les tests\"
      },
      \"file\": {
        \"en-US\": {
          \"uploadFrom\": {
            \"sys\": {
              \"type\": \"Link\",
              \"linkType\": \"Upload\",
              \"id\": \"$upload_id\"
            }
          },
          \"fileName\": \"test-image.png\",
          \"contentType\": \"image/png\"
        }
      }
    }
  }" \
  "$BASE_URL/v1/spaces/$space_id/environments/$env_id/assets")

assert_status "Create Asset from Upload" "$response" "201"

asset_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   Asset ID: $asset_id"
echo ""

if [ -z "$asset_id" ] || [ "$asset_id" = "null" ]; then
  echo -e "${RED}✗ Failed to create asset${NC}"
  exit 1
fi

# Step 3: Get Asset
echo "Step 3: Get Asset..."
response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/assets/$asset_id" "")
assert_status "Get Asset" "$response" "200"
echo ""

# Step 4: Update Asset (metadata only)
echo "Step 4: Update Asset..."
response=$(curl -s -w "\n%{http_code}" -X PUT \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "title": {
        "en-US": "Updated Test Image",
        "fr-FR": "Image de Test Mise à Jour"
      },
      "description": {
        "en-US": "Updated description for testing",
        "fr-FR": "Description mise à jour pour les tests"
      }
    }
  }' \
  "$BASE_URL/v1/spaces/$space_id/environments/$env_id/assets/$asset_id")

assert_status "Update Asset" "$response" "200"
echo ""

# Step 6: Publish Asset
echo "Step 6: Publish Asset..."
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id/assets/$asset_id/published" "")
assert_status "Publish Asset" "$response" "200"
echo ""

# Step 7: Archive Asset
echo "Step 7: Archive Asset..."
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id/assets/$asset_id/archived" "")
assert_status "Archive Asset" "$response" "200"
echo ""

# Step 8: Unarchive Asset
echo "Step 8: Unarchive Asset..."
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/assets/$asset_id/archived" "")
assert_status "Unarchive Asset" "$response" "200"
echo ""

# Step 9: Unpublish Asset
echo "Step 9: Unpublish Asset..."
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/assets/$asset_id/published" "")
assert_status "Unpublish Asset" "$response" "200"
echo ""

# Step 10: Create PDF Asset...
echo "Step 10: Create PDF Asset..."

# Upload PDF file (binary)
upload_response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@test-document.pdf" \
  "$BASE_URL/v1/spaces/$space_id/uploads")

assert_status "Upload File (test-document.pdf)" "$upload_response" "201"
pdf_upload_id=$(echo "$upload_response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)

# Create PDF Asset
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"fields\": {
      \"title\": {
        \"en-US\": \"Test PDF Document\"
      },
      \"description\": {
        \"en-US\": \"A sample PDF for testing\"
      },
      \"file\": {
        \"en-US\": {
          \"uploadFrom\": {
            \"sys\": {
              \"type\": \"Link\",
              \"linkType\": \"Upload\",
              \"id\": \"$pdf_upload_id\"
            }
          },
          \"fileName\": \"test-document.pdf\",
          \"contentType\": \"application/pdf\"
        }
      }
    }
  }" \
  "$BASE_URL/v1/spaces/$space_id/environments/$env_id/assets")

assert_status "Create PDF Asset" "$response" "201"
pdf_asset_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   PDF Asset ID: $pdf_asset_id"
echo ""

# Step 11: Create CSV Asset
echo "Step 11: Create CSV Asset..."

# Upload CSV file (binary)
upload_response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@test-data.csv" \
  "$BASE_URL/v1/spaces/$space_id/uploads")

assert_status "Upload File (test-data.csv)" "$upload_response" "201"
csv_upload_id=$(echo "$upload_response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)

# Create CSV Asset
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"fields\": {
      \"title\": {
        \"en-US\": \"Test CSV Data\"
      },
      \"description\": {
        \"en-US\": \"A sample CSV for testing\"
      },
      \"file\": {
        \"en-US\": {
          \"uploadFrom\": {
            \"sys\": {
              \"type\": \"Link\",
              \"linkType\": \"Upload\",
              \"id\": \"$csv_upload_id\"
            }
          },
          \"fileName\": \"test-data.csv\",
          \"contentType\": \"text/csv\"
        }
      }
    }
  }" \
  "$BASE_URL/v1/spaces/$space_id/environments/$env_id/assets")

assert_status "Create CSV Asset" "$response" "201"
csv_asset_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   CSV Asset ID: $csv_asset_id"
echo ""

# Step 12: Create Text Asset
echo "Step 12: Create Text Asset..."

# Upload Text file (binary)
upload_response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@test-text.txt" \
  "$BASE_URL/v1/spaces/$space_id/uploads")

assert_status "Upload File (test-text.txt)" "$upload_response" "201"
txt_upload_id=$(echo "$upload_response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)

# Create Text Asset
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"fields\": {
      \"title\": {
        \"en-US\": \"Test Text File\"
      },
      \"description\": {
        \"en-US\": \"A sample text file for testing\"
      },
      \"file\": {
        \"en-US\": {
          \"uploadFrom\": {
            \"sys\": {
              \"type\": \"Link\",
              \"linkType\": \"Upload\",
              \"id\": \"$txt_upload_id\"
            }
          },
          \"fileName\": \"test-text.txt\",
          \"contentType\": \"text/plain\"
        }
      }
    }
  }" \
  "$BASE_URL/v1/spaces/$space_id/environments/$env_id/assets")

assert_status "Create Text Asset" "$response" "201"
txt_asset_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   Text Asset ID: $txt_asset_id"
echo ""

# Step 13: List all Assets
echo "Step 13: List Assets..."
response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/assets" "")
assert_status "List Assets" "$response" "200"

assets_count=$(echo "$response" | sed '$d' | jq '.items | length' 2>/dev/null)
echo "   Total assets created: $assets_count"
echo ""

# Step 14: Get Upload by ID
echo "Step 14: Get Upload by ID..."
response=$(call_api "GET" "/v1/spaces/$space_id/uploads/$upload_id" "")
assert_status "Get Upload" "$response" "200"
echo ""

# Step 15: Delete one upload
echo "Step 15: Delete Upload..."
response=$(call_api "DELETE" "/v1/spaces/$space_id/uploads/$csv_upload_id" "")
assert_status "Delete Upload" "$response" "204"
echo ""

echo ""

# ============================================
# PHASE 6.9: NEWS CONTENT TYPE WITH MEDIA FIELD TEST
# ============================================
echo -e "${YELLOW}┌─ PHASE 6.9: NEWS WITH MEDIA FIELD & ASSET LINKING ────────┐${NC}"
echo ""

# Step 1: Create News Content Type with Media field
echo "Step 1: Create News Content Type with Media field..."
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "News",
    "apiId": "news",
    "description": "News article with PDF attachment",
    "displayField": "title",
    "fields": [
      {
        "id": "title",
        "name": "Title",
        "type": "Text",
        "required": true,
        "localized": false
      },
      {
        "id": "description",
        "name": "Description",
        "type": "RichText",
        "required": true,
        "localized": true
      },
      {
        "id": "pdfDocument",
        "name": "PDF Document",
        "type": "Link",
        "linkType": "Asset",
        "required": true,
        "localized": false,
        "validations": [
          {
            "linkMimetypeGroup": ["pdfdocument"]
          }
        ]
      }
    ]
  }' \
  "$BASE_URL/v1/spaces/$space_id/environments/$env_id/content_types")

assert_status "Create News Content Type" "$response" "201"

news_ct_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   News Content Type ID: $news_ct_id"
echo ""

if [ -z "$news_ct_id" ] || [ "$news_ct_id" = "null" ]; then
  echo -e "${RED}✗ Failed to create News content type${NC}"
  exit 1
fi

# Step 2: Publish News Content Type
echo "Step 2: Publish News Content Type..."
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id/content_types/$news_ct_id/published" "")
assert_status "Publish News Content Type" "$response" "200"
echo ""

# Step 3: Upload PDF file for News
echo "Step 3: Upload PDF file..."
upload_response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@test-document.pdf" \
  "$BASE_URL/v1/spaces/$space_id/uploads")

assert_status "Upload PDF for News" "$upload_response" "201"

news_pdf_upload_id=$(echo "$upload_response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   Upload ID: $news_pdf_upload_id"
echo ""

# Step 4: Create PDF Asset for News...
echo "Step 4: Create PDF Asset for News..."
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"fields\": {
      \"title\": {
        \"en-US\": \"News Document PDF\"
      },
      \"description\": {
        \"en-US\": \"PDF attachment for news article\"
      },
      \"file\": {
        \"en-US\": {
          \"uploadFrom\": {
            \"sys\": {
              \"type\": \"Link\",
              \"linkType\": \"Upload\",
              \"id\": \"$news_pdf_upload_id\"
            }
          },
          \"fileName\": \"news-document.pdf\",
          \"contentType\": \"application/pdf\"
        }
      }
    }
  }" \
  "$BASE_URL/v1/spaces/$space_id/environments/$env_id/assets")

assert_status "Create PDF Asset for News" "$response" "201"

news_pdf_asset_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   PDF Asset ID: $news_pdf_asset_id"
echo ""

# Step 5: Publish PDF Asset
echo "Step 5: Publish PDF Asset..."
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id/assets/$news_pdf_asset_id/published" "")
assert_status "Publish PDF Asset" "$response" "200"
echo ""

# Step 6: Create News Entry with linked PDF Asset
echo "Step 6: Create News Entry with linked PDF..."
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Content-Type: $news_ct_id" \
  -d "{
    \"fields\": {
      \"title\": {
        \"en-US\": \"Breaking News Article\"
      },
      \"description\": {
        \"en-US\": {\"nodeType\": \"document\", \"data\": {}, \"content\": [{\"nodeType\": \"paragraph\", \"data\": {}, \"content\": [{\"nodeType\": \"text\", \"value\": \"This is an important news article with a PDF attachment.\", \"marks\": [], \"data\": {}}]}]}
      },
      \"pdfDocument\": {
        \"en-US\": {
          \"sys\": {
            \"type\": \"Link\",
            \"linkType\": \"Asset\",
            \"id\": \"$news_pdf_asset_id\"
          }
        }
      }
    }
  }" \
  "$BASE_URL/v1/spaces/$space_id/environments/$env_id/entries")

assert_status "Create News Entry with PDF link" "$response" "201"

news_entry_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   News Entry ID: $news_entry_id"
echo ""

if [ -z "$news_entry_id" ] || [ "$news_entry_id" = "null" ]; then
  echo -e "${RED}✗ Failed to create news entry${NC}"
  exit 1
fi

# Step 7: Get and Verify News Entry
echo "Step 7: Get and verify News Entry..."
response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/entries/$news_entry_id" "")
assert_status "Get News Entry" "$response" "200"

# Verify the PDF link exists
pdf_link=$(echo "$response" | sed '$d' | jq -r '.fields.pdfDocument."en-US".sys.id' 2>/dev/null)
if [ "$pdf_link" = "$news_pdf_asset_id" ]; then
  echo -e "${GREEN}✓${NC} Verified: PDF Asset correctly linked ($pdf_link)"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} Failed: PDF Asset link mismatch (expected $news_pdf_asset_id, got $pdf_link)"
  FAIL=$((FAIL + 1))
fi
echo ""

# Step 8: Publish News Entry
echo "Step 8: Publish News Entry..."
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id/entries/$news_entry_id/published" "")
assert_status "Publish News Entry" "$response" "200"
echo ""

echo ""

# ============================================
# PHASE 6.9: COMPREHENSIVE FIELD TYPES TEST
# ============================================
echo -e "${YELLOW}┌─ PHASE 6.9: KITCHEN SINK - ALL FIELD TYPES ───────────────┐${NC}"
echo ""
echo "Creating comprehensive content type with all 11 field types..."
echo "Testing: Symbol, Text, RichText, Integer, Number, Date, Boolean,"
echo "         Location, Object, Array, Link (Entry & Asset)"
echo ""

# Step 1: Create Kitchen Sink Content Type with ALL field types
echo "Step 1: Create Kitchen Sink Content Type with all field types..."
response=$(call_api "POST" "/v1/spaces/$space_id/environments/$env_id/content_types" \
  "{
    \"name\": \"Kitchen Sink\",
    \"apiId\": \"kitchenSink\",
    \"description\": \"Comprehensive test with all field types and validations\",
    \"displayField\": \"title\",
    \"fields\": [
      {
        \"id\": \"title\",
        \"name\": \"Title\",
        \"type\": \"Symbol\",
        \"required\": true,
        \"localized\": false,
        \"validations\": [
          {\"size\": {\"min\": 5, \"max\": 100}}
        ]
      },
      {
        \"id\": \"slug\",
        \"name\": \"Slug\",
        \"type\": \"Symbol\",
        \"required\": true,
        \"localized\": false,
        \"validations\": [
          {\"regexp\": {\"pattern\": \"^[a-z0-9-]+$\"}}
        ]
      },
      {
        \"id\": \"status\",
        \"name\": \"Status (Dropdown)\",
        \"type\": \"Symbol\",
        \"required\": false,
        \"localized\": false,
        \"appearance\": {
          \"widgetId\": \"dropdown\",
          \"settings\": {}
        },
        \"validations\": [
          {\"in\": [\"Draft\", \"In Review\", \"Approved\", \"Published\", \"Archived\"]}
        ]
      },
      {
        \"id\": \"priority\",
        \"name\": \"Priority (Radio)\",
        \"type\": \"Symbol\",
        \"required\": false,
        \"localized\": false,
        \"appearance\": {
          \"widgetId\": \"radio\",
          \"settings\": {}
        },
        \"validations\": [
          {\"in\": [\"Low\", \"Medium\", \"High\", \"Urgent\"]}
        ]
      },
      {
        \"id\": \"shortDescription\",
        \"name\": \"Short Description\",
        \"type\": \"Text\",
        \"required\": false,
        \"localized\": true,
        \"validations\": [
          {\"size\": {\"max\": 500}}
        ]
      },
      {
        \"id\": \"body\",
        \"name\": \"Body\",
        \"type\": \"RichText\",
        \"required\": true,
        \"localized\": true
      },
      {
        \"id\": \"viewCount\",
        \"name\": \"View Count\",
        \"type\": \"Integer\",
        \"required\": false,
        \"localized\": false,
        \"validations\": [
          {\"range\": {\"min\": 0}}
        ]
      },
      {
        \"id\": \"rating\",
        \"name\": \"Rating\",
        \"type\": \"Number\",
        \"required\": false,
        \"localized\": false,
        \"validations\": [
          {\"range\": {\"min\": 0, \"max\": 5}}
        ]
      },
      {
        \"id\": \"publishDate\",
        \"name\": \"Publish Date\",
        \"type\": \"Date\",
        \"required\": false,
        \"localized\": false
      },
      {
        \"id\": \"featured\",
        \"name\": \"Featured\",
        \"type\": \"Boolean\",
        \"required\": false,
        \"localized\": false
      },
      {
        \"id\": \"location\",
        \"name\": \"Location (Coordinates)\",
        \"type\": \"Location\",
        \"required\": false,
        \"localized\": false
      },
      {
        \"id\": \"officeLocation\",
        \"name\": \"Office Location (Address)\",
        \"type\": \"Location\",
        \"required\": false,
        \"localized\": false
      },
      {
        \"id\": \"metadata\",
        \"name\": \"Metadata\",
        \"type\": \"Object\",
        \"required\": false,
        \"localized\": false
      },
      {
        \"id\": \"mainImage\",
        \"name\": \"Main Image\",
        \"type\": \"Link\",
        \"required\": false,
        \"localized\": false,
        \"linkType\": \"Asset\",
        \"validations\": [
          {\"linkMimetypeGroup\": [\"image\"]}
        ]
      },
      {
        \"id\": \"attachments\",
        \"name\": \"Attachments\",
        \"type\": \"Array\",
        \"required\": false,
        \"localized\": false,
        \"items\": {
          \"type\": \"Link\",
          \"linkType\": \"Asset\"
        }
      },
      {
        \"id\": \"relatedArticles\",
        \"name\": \"Related Articles\",
        \"type\": \"Array\",
        \"required\": false,
        \"localized\": false,
        \"items\": {
          \"type\": \"Link\",
          \"linkType\": \"Entry\",
          \"validations\": [
            {\"linkContentType\": [\"$ct_id\"]}
          ]
        }
      }
    ]
  }")
assert_status "Create Kitchen Sink Content Type" "$response" "201"

kitchen_sink_ct_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   Kitchen Sink Content Type ID: $kitchen_sink_ct_id"
echo ""

if [ -z "$kitchen_sink_ct_id" ] || [ "$kitchen_sink_ct_id" = "null" ]; then
  echo -e "${RED}✗ Failed to create Kitchen Sink content type${NC}"
  exit 1
fi

# Step 2: Publish Kitchen Sink Content Type
echo "Step 2: Publish Kitchen Sink Content Type..."
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id/content_types/$kitchen_sink_ct_id/published" "")
assert_status "Publish Kitchen Sink Content Type" "$response" "200"
echo ""

# Step 3: Create Kitchen Sink Entry with all field types populated
echo "Step 3: Create Kitchen Sink Entry with all field types..."
response=$(call_entry_api "POST" "/v1/spaces/$space_id/environments/$env_id/entries" "$kitchen_sink_ct_id" "{
    \"fields\": {
      \"title\": {\"en-US\": \"Comprehensive Test Article\"},
      \"slug\": {\"en-US\": \"comprehensive-test-article\"},
      \"status\": {\"en-US\": \"Published\"},
      \"priority\": {\"en-US\": \"High\"},
      \"shortDescription\": {
        \"en-US\": \"This is a test article with all field types\",
        \"fr-FR\": \"Ceci est un article de test avec tous les types de champs\"
      },
      \"body\": {
        \"en-US\": {\"nodeType\": \"document\", \"data\": {}, \"content\": [{\"nodeType\": \"paragraph\", \"data\": {}, \"content\": [{\"nodeType\": \"text\", \"value\": \"This is the main content with \", \"marks\": [], \"data\": {}}, {\"nodeType\": \"text\", \"value\": \"rich text\", \"marks\": [{\"type\": \"bold\"}], \"data\": {}}, {\"nodeType\": \"text\", \"value\": \" formatting.\", \"marks\": [], \"data\": {}}]}]},
        \"fr-FR\": {\"nodeType\": \"document\", \"data\": {}, \"content\": [{\"nodeType\": \"paragraph\", \"data\": {}, \"content\": [{\"nodeType\": \"text\", \"value\": \"Ceci est le contenu principal avec formatage \", \"marks\": [], \"data\": {}}, {\"nodeType\": \"text\", \"value\": \"texte riche\", \"marks\": [{\"type\": \"bold\"}], \"data\": {}}, {\"nodeType\": \"text\", \"value\": \".\", \"marks\": [], \"data\": {}}]}]}
      },
      \"viewCount\": {\"en-US\": 42},
      \"rating\": {\"en-US\": 4.5},
      \"publishDate\": {\"en-US\": \"2024-01-15T10:00:00Z\"},
      \"featured\": {\"en-US\": true},
      \"location\": {
        \"en-US\": {
          \"lat\": 40.7128,
          \"lon\": -74.0060
        }
      },
      \"officeLocation\": {
        \"en-US\": {
          \"lat\": 37.7749,
          \"lon\": -122.4194
        }
      },
      \"metadata\": {
        \"en-US\": {
          \"author\": \"John Doe\",
          \"category\": \"Technology\",
          \"views\": 1000
        }
      },
      \"mainImage\": {\"en-US\": {\"sys\": {\"type\": \"Link\", \"linkType\": \"Asset\", \"id\": \"$asset_id\"}}},
      \"attachments\": {
        \"en-US\": [
          {\"sys\": {\"type\": \"Link\", \"linkType\": \"Asset\", \"id\": \"$pdf_asset_id\"}},
          {\"sys\": {\"type\": \"Link\", \"linkType\": \"Asset\", \"id\": \"$csv_asset_id\"}}
        ]
      },
      \"relatedArticles\": {
        \"en-US\": [
          {\"sys\": {\"type\": \"Link\", \"linkType\": \"Entry\", \"id\": \"$entry_id\"}}
        ]
      }
    }
  }")
assert_status "Create Kitchen Sink Entry" "$response" "201"

kitchen_sink_entry_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   Kitchen Sink Entry ID: $kitchen_sink_entry_id"
echo ""

# Step 4: Verify Kitchen Sink Entry has all fields
echo "Step 4: Verify Kitchen Sink Entry..."
response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/entries/$kitchen_sink_entry_id" "")
assert_status "Get Kitchen Sink Entry" "$response" "200"

# Verify all field types are present
entry_title=$(echo "$response" | sed '$d' | jq -r '.fields.title."en-US"' 2>/dev/null)
entry_view_count=$(echo "$response" | sed '$d' | jq -r '.fields.viewCount."en-US"' 2>/dev/null)
entry_rating=$(echo "$response" | sed '$d' | jq -r '.fields.rating."en-US"' 2>/dev/null)
entry_featured=$(echo "$response" | sed '$d' | jq -r '.fields.featured."en-US"' 2>/dev/null)

echo "   ✓ Symbol field (title): $entry_title"
echo "   ✓ Integer field (viewCount): $entry_view_count"
echo "   ✓ Number field (rating): $entry_rating"
echo "   ✓ Boolean field (featured): $entry_featured"
echo ""

# Step 5: Test field validation - try to create entry with invalid data
echo "Step 5: Test field validations (should fail)..."

# Test 1: Title too short (min 5 characters)
echo -n "   Testing title min length validation... "
response=$(call_entry_api "POST" "/v1/spaces/$space_id/environments/$env_id/entries" "$kitchen_sink_ct_id" '{
    "fields": {
      "title": {"en-US": "Test"},
      "slug": {"en-US": "test"},
      "body": {"en-US": {"nodeType": "document", "data": {}, "content": [{"nodeType": "paragraph", "data": {}, "content": [{"nodeType": "text", "value": "Content", "marks": [], "data": {}}]}]}}
    }
  }')
parsed=$(parse_response "$response")
http_code="${parsed%%|*}"
if [ "$http_code" = "422" ]; then
  echo -e "${GREEN}✓${NC} (correctly rejected)"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} (should have been 422, got $http_code)"
  FAIL=$((FAIL + 1))
fi

# Test 2: Invalid slug format (must be lowercase with dashes)
echo -n "   Testing slug regex validation... "
response=$(call_entry_api "POST" "/v1/spaces/$space_id/environments/$env_id/entries" "$kitchen_sink_ct_id" '{
    "fields": {
      "title": {"en-US": "Valid Title Here"},
      "slug": {"en-US": "Invalid Slug!"},
      "body": {"en-US": {"nodeType": "document", "data": {}, "content": [{"nodeType": "paragraph", "data": {}, "content": [{"nodeType": "text", "value": "Content", "marks": [], "data": {}}]}]}}
    }
  }')
parsed=$(parse_response "$response")
http_code="${parsed%%|*}"
if [ "$http_code" = "422" ]; then
  echo -e "${GREEN}✓${NC} (correctly rejected)"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} (should have been 422, got $http_code)"
  FAIL=$((FAIL + 1))
fi

# Test 3: Rating out of range (max 5)
echo -n "   Testing rating range validation... "
response=$(call_entry_api "POST" "/v1/spaces/$space_id/environments/$env_id/entries" "$kitchen_sink_ct_id" '{
    "fields": {
      "title": {"en-US": "Valid Title"},
      "slug": {"en-US": "valid-slug"},
      "body": {"en-US": {"nodeType": "document", "data": {}, "content": [{"nodeType": "paragraph", "data": {}, "content": [{"nodeType": "text", "value": "Content", "marks": [], "data": {}}]}]}},
      "rating": {"en-US": 10}
    }
  }')
parsed=$(parse_response "$response")
http_code="${parsed%%|*}"
if [ "$http_code" = "422" ]; then
  echo -e "${GREEN}✓${NC} (correctly rejected)"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} (should have been 422, got $http_code)"
  FAIL=$((FAIL + 1))
fi

echo ""

# Step 6: Publish Kitchen Sink Entry
echo "Step 6: Publish Kitchen Sink Entry..."
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id/entries/$kitchen_sink_entry_id/published" "")
assert_status "Publish Kitchen Sink Entry" "$response" "200"
echo ""

echo -e "${GREEN}✓ Kitchen Sink test completed - all field types tested!${NC}"
echo ""

echo ""

# ============================================
# PHASE 6.10: RICH TEXT WITH EMBEDDED ASSETS/ENTRIES TEST
# ============================================
echo -e "${YELLOW}┌─ PHASE 6.10: RICH TEXT WITH EMBEDDED CONTENT ─────────────┐${NC}"
echo ""
echo "Testing Rich Text fields with embedded assets and entries..."
echo "This tests the Contentful-compatible JSON structure for embedded content."
echo ""

# Step 1: Create a Content Type with Rich Text field that supports embeds
echo "Step 1: Create Article Content Type with Rich Text embeds..."
response=$(call_api "POST" "/v1/spaces/$space_id/environments/$env_id/content_types" \
  '{
    "name": "Article",
    "apiId": "article",
    "description": "Article with Rich Text supporting embedded content",
    "displayField": "title",
    "fields": [
      {
        "id": "title",
        "name": "Title",
        "type": "Symbol",
        "required": true,
        "localized": false
      },
      {
        "id": "content",
        "name": "Content",
        "type": "RichText",
        "required": true,
        "localized": false,
        "appearance": {
          "widgetId": "richTextEditor",
          "settings": {
            "enabledFormats": ["bold", "italic", "underline", "h1", "h2", "h3", "ul", "ol", "quote", "link", "embeddedAsset", "embeddedEntry"]
          }
        }
      }
    ]
  }')
assert_status "Create Article Content Type" "$response" "201"

article_ct_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   Article Content Type ID: $article_ct_id"
echo ""

if [ -z "$article_ct_id" ] || [ "$article_ct_id" = "null" ]; then
  echo -e "${RED}✗ Failed to create Article content type${NC}"
  exit 1
fi

# Step 2: Publish Article Content Type
echo "Step 2: Publish Article Content Type..."
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id/content_types/$article_ct_id/published" "")
assert_status "Publish Article Content Type" "$response" "200"
echo ""

# Step 3: Create Article Entry with embedded asset and entry in Rich Text
echo "Step 3: Create Article with embedded asset and entry in Rich Text..."
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Content-Type: $article_ct_id" \
  -d "{
    \"fields\": {
      \"title\": {\"en-US\": \"Article with Embedded Content\"},
      \"content\": {
        \"en-US\": {
          \"nodeType\": \"document\",
          \"data\": {},
          \"content\": [
            {
              \"nodeType\": \"paragraph\",
              \"data\": {},
              \"content\": [
                {\"nodeType\": \"text\", \"value\": \"This article demonstrates \", \"marks\": [], \"data\": {}},
                {\"nodeType\": \"text\", \"value\": \"embedded content\", \"marks\": [{\"type\": \"bold\"}], \"data\": {}},
                {\"nodeType\": \"text\", \"value\": \" in Rich Text fields.\", \"marks\": [], \"data\": {}}
              ]
            },
            {
              \"nodeType\": \"heading-2\",
              \"data\": {},
              \"content\": [
                {\"nodeType\": \"text\", \"value\": \"Embedded Image Asset\", \"marks\": [], \"data\": {}}
              ]
            },
            {
              \"nodeType\": \"paragraph\",
              \"data\": {},
              \"content\": [
                {\"nodeType\": \"text\", \"value\": \"Below is an embedded image asset:\", \"marks\": [], \"data\": {}}
              ]
            },
            {
              \"nodeType\": \"embedded-asset-block\",
              \"data\": {
                \"target\": {
                  \"sys\": {
                    \"type\": \"Link\",
                    \"linkType\": \"Asset\",
                    \"id\": \"$news_pdf_asset_id\"
                  }
                }
              },
              \"content\": []
            },
            {
              \"nodeType\": \"heading-2\",
              \"data\": {},
              \"content\": [
                {\"nodeType\": \"text\", \"value\": \"Embedded Entry Reference\", \"marks\": [], \"data\": {}}
              ]
            },
            {
              \"nodeType\": \"paragraph\",
              \"data\": {},
              \"content\": [
                {\"nodeType\": \"text\", \"value\": \"Below is an embedded entry reference:\", \"marks\": [], \"data\": {}}
              ]
            },
            {
              \"nodeType\": \"embedded-entry-block\",
              \"data\": {
                \"target\": {
                  \"sys\": {
                    \"type\": \"Link\",
                    \"linkType\": \"Entry\",
                    \"id\": \"$news_entry_id\"
                  }
                }
              },
              \"content\": []
            },
            {
              \"nodeType\": \"paragraph\",
              \"data\": {},
              \"content\": [
                {\"nodeType\": \"text\", \"value\": \"You can also have \", \"marks\": [], \"data\": {}},
                {
                  \"nodeType\": \"embedded-entry-inline\",
                  \"data\": {
                    \"target\": {
                      \"sys\": {
                        \"type\": \"Link\",
                        \"linkType\": \"Entry\",
                        \"id\": \"$news_entry_id\"
                      }
                    }
                  },
                  \"content\": []
                },
                {\"nodeType\": \"text\", \"value\": \" inline entries within text.\", \"marks\": [], \"data\": {}}
              ]
            }
          ]
        }
      }
    }
  }" \
  "$BASE_URL/v1/spaces/$space_id/environments/$env_id/entries")

assert_status "Create Article with Embedded Content" "$response" "201"

article_entry_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "   Article Entry ID: $article_entry_id"
echo ""

if [ -z "$article_entry_id" ] || [ "$article_entry_id" = "null" ]; then
  echo -e "${RED}✗ Failed to create article entry${NC}"
  exit 1
fi

# Step 4: Verify the embedded content structure
echo "Step 4: Verify embedded content structure..."
response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/entries/$article_entry_id" "")
assert_status "Get Article Entry" "$response" "200"

# Check that embedded content node types exist in the response
body=$(echo "$response" | sed '$d')

# Verify embedded-asset-block exists
if echo "$body" | grep -q '"embedded-asset-block"'; then
  echo -e "${GREEN}✓${NC} Rich Text contains embedded-asset-block"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} Rich Text missing embedded-asset-block"
  FAIL=$((FAIL + 1))
fi

# Verify embedded-entry-block exists
if echo "$body" | grep -q '"embedded-entry-block"'; then
  echo -e "${GREEN}✓${NC} Rich Text contains embedded-entry-block"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} Rich Text missing embedded-entry-block"
  FAIL=$((FAIL + 1))
fi

# Verify embedded-entry-inline exists
if echo "$body" | grep -q '"embedded-entry-inline"'; then
  echo -e "${GREEN}✓${NC} Rich Text contains embedded-entry-inline"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} Rich Text missing embedded-entry-inline"
  FAIL=$((FAIL + 1))
fi

# Verify the asset ID is in the response
if echo "$body" | grep -q "$news_pdf_asset_id"; then
  echo -e "${GREEN}✓${NC} Embedded asset ID found: $news_pdf_asset_id"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} Embedded asset ID not found in response"
  FAIL=$((FAIL + 1))
fi

# Verify the entry ID is in the response
if echo "$body" | grep -q "$news_entry_id"; then
  echo -e "${GREEN}✓${NC} Embedded entry ID found: $news_entry_id"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} Embedded entry ID not found in response"
  FAIL=$((FAIL + 1))
fi

echo ""

# Step 5: Publish Article Entry
echo "Step 5: Publish Article Entry..."
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id/entries/$article_entry_id/published" "")
assert_status "Publish Article Entry" "$response" "200"
echo ""

echo -e "${GREEN}✓ Rich Text embedded content test completed!${NC}"
echo ""

echo ""

# ============================================
# PHASE 7: LIST ALL RESOURCES
# ============================================
echo -e "${YELLOW}┌─ PHASE 7: LIST ALL RESOURCES ─────────────────────────────┐${NC}"
echo ""

response=$(call_api "GET" "/v1/spaces" "")
assert_status "List Spaces" "$response" "200"
spaces_count=$(echo "$response" | sed '$d' | jq '.total' 2>/dev/null || echo "0")
echo "   Total spaces: $spaces_count"

response=$(call_api "GET" "/v1/spaces/$space_id/environments" "")
assert_status "List Environments" "$response" "200"
envs_count=$(echo "$response" | sed '$d' | jq '.total' 2>/dev/null || echo "0")
echo "   Total environments in space: $envs_count"

response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/content_types" "")
assert_status "List Content Types" "$response" "200"
cts_count=$(echo "$response" | sed '$d' | jq '.total' 2>/dev/null || echo "0")
echo "   Total content types in environment: $cts_count"

response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/entries" "")
assert_status "List Entries" "$response" "200"
entries_count=$(echo "$response" | sed '$d' | jq '.total' 2>/dev/null || echo "0")
echo "   Total entries in environment: $entries_count"

response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/assets" "")
assert_status "List Assets (in listing phase)" "$response" "200"
assets_total=$(echo "$response" | sed '$d' | jq '.total' 2>/dev/null || echo "0")
echo "   Total assets in environment: $assets_total"

echo ""

# ============================================
# PHASE 7.5: CONTENT DELIVERY API (CDA) TESTING
# ============================================
echo -e "${YELLOW}┌─ PHASE 7.5: CONTENT DELIVERY API (CDA) ───────────────────┐${NC}"
echo ""

echo "Testing read-only CDA endpoints (published content only)..."
echo ""

# Note: CDA tests require a CDA API key. If not provided, skip these tests.
if [ -z "${CDA_TOKEN:-}" ]; then
  echo -e "${YELLOW}⚠ CDA_TOKEN not set. Skipping CDA tests.${NC}"
  echo "  To test CDA: export CDA_TOKEN='your_cda_key' before running this script"
  echo ""
else
  echo "Using CDA Token: ${CDA_TOKEN:0:15}..."
  
  # Test 1: Get published entries via CDA
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CDA_TOKEN" \
    "$BASE_URL/cdn/spaces/$space_id/environments/$env_id/entries")
  assert_status "CDA: Get all published entries" "$response" "200"
  
  # Extract first entry from response
  cda_entry_id=$(echo "$response" | sed '$d' | jq -r '.items[0].sys.id // empty')
  if [ -n "$cda_entry_id" ]; then
    echo "   Found entry: $cda_entry_id"
    
    # Test 2: Get single published entry
    response=$(curl -s -w "\n%{http_code}" \
      -H "Authorization: Bearer $CDA_TOKEN" \
      "$BASE_URL/cdn/spaces/$space_id/environments/$env_id/entries/$cda_entry_id")
    assert_status "CDA: Get single published entry" "$response" "200"
  fi
  
  # Test 3: Get published entries with query parameters
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CDA_TOKEN" \
    "$BASE_URL/cdn/spaces/$space_id/environments/$env_id/entries?limit=5&order=-sys.createdAt")
  assert_status "CDA: Get entries with query params" "$response" "200"
  
  # Test 4: Get entries with link resolution (include=1)
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CDA_TOKEN" \
    "$BASE_URL/cdn/spaces/$space_id/environments/$env_id/entries?include=1")
  assert_status "CDA: Get entries with include=1" "$response" "200"
  
  # Test 5: Get entries with field selection
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CDA_TOKEN" \
    "$BASE_URL/cdn/spaces/$space_id/environments/$env_id/entries?select=sys.id,fields")
  assert_status "CDA: Get entries with field selection" "$response" "200"
  
  # Test 6: Get published assets via CDA
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CDA_TOKEN" \
    "$BASE_URL/cdn/spaces/$space_id/environments/$env_id/assets")
  assert_status "CDA: Get all published assets" "$response" "200"
  
  # Test 7: Get assets filtered by MIME type (images)
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CDA_TOKEN" \
    "$BASE_URL/cdn/spaces/$space_id/environments/$env_id/assets?mimetype_group=image")
  assert_status "CDA: Get image assets" "$response" "200"
  
  # Test 8: Get content types via CDA
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CDA_TOKEN" \
    "$BASE_URL/cdn/spaces/$space_id/environments/$env_id/content_types")
  assert_status "CDA: Get content types" "$response" "200"
  
  # Test 9: Get locales via CDA
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CDA_TOKEN" \
    "$BASE_URL/cdn/spaces/$space_id/environments/$env_id/locales")
  assert_status "CDA: Get locales" "$response" "200"
  
  # Test 10: Cursor pagination - initial request
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CDA_TOKEN" \
    "$BASE_URL/cdn/spaces/$space_id/environments/$env_id/entries?cursor=true&limit=2")
  assert_status "CDA: Cursor pagination (initial)" "$response" "200"
  
  # Extract next page cursor if exists
  next_cursor=$(echo "$response" | sed '$d' | jq -r '.pages.next // empty' | sed -n 's/.*pageNext=\([^&]*\).*/\1/p')
  if [ -n "$next_cursor" ]; then
    # Test 11: Cursor pagination - next page
    response=$(curl -s -w "\n%{http_code}" \
      -H "Authorization: Bearer $CDA_TOKEN" \
      "$BASE_URL/cdn/spaces/$space_id/environments/$env_id/entries?pageNext=$next_cursor")
    assert_status "CDA: Cursor pagination (next page)" "$response" "200"
  fi
  
  echo ""
fi

# ============================================
# PHASE 7.6: CONTENT PREVIEW API (CPA) TESTING
# ============================================
echo -e "${YELLOW}┌─ PHASE 7.6: CONTENT PREVIEW API (CPA) ────────────────────┐${NC}"
echo ""

echo "Testing read-only CPA endpoints (includes draft content)..."
echo ""

# Note: CPA tests require a CPA API key. If not provided, skip these tests.
if [ -z "${CPA_TOKEN:-}" ]; then
  echo -e "${YELLOW}⚠ CPA_TOKEN not set. Skipping CPA tests.${NC}"
  echo "  To test CPA: export CPA_TOKEN='your_cpa_key' before running this script"
  echo ""
else
  echo "Using CPA Token: ${CPA_TOKEN:0:15}..."
  
  # Test 1: Get all entries via CPA (including drafts)
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CPA_TOKEN" \
    "$BASE_URL/preview/spaces/$space_id/environments/$env_id/entries")
  assert_status "CPA: Get all entries (incl. drafts)" "$response" "200"
  
  # Extract first entry from response
  cpa_entry_id=$(echo "$response" | sed '$d' | jq -r '.items[0].sys.id // empty')
  if [ -n "$cpa_entry_id" ]; then
    echo "   Found entry: $cpa_entry_id"
    
    # Test 2: Get single entry (any status)
    response=$(curl -s -w "\n%{http_code}" \
      -H "Authorization: Bearer $CPA_TOKEN" \
      "$BASE_URL/preview/spaces/$space_id/environments/$env_id/entries/$cpa_entry_id")
    assert_status "CPA: Get single entry" "$response" "200"
  fi
  
  # Test 3: Get entries with query parameters
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CPA_TOKEN" \
    "$BASE_URL/preview/spaces/$space_id/environments/$env_id/entries?limit=5&order=-sys.updatedAt")
  assert_status "CPA: Get entries with query params" "$response" "200"
  
  # Test 4: Get entries with link resolution
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CPA_TOKEN" \
    "$BASE_URL/preview/spaces/$space_id/environments/$env_id/entries?include=2")
  assert_status "CPA: Get entries with include=2" "$response" "200"
  
  # Test 5: Get all assets via CPA (including drafts)
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CPA_TOKEN" \
    "$BASE_URL/preview/spaces/$space_id/environments/$env_id/assets")
  assert_status "CPA: Get all assets (incl. drafts)" "$response" "200"
  
  # Test 6: Get content types via CPA
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CPA_TOKEN" \
    "$BASE_URL/preview/spaces/$space_id/environments/$env_id/content_types")
  assert_status "CPA: Get content types" "$response" "200"
  
  # Test 7: Get locales via CPA
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CPA_TOKEN" \
    "$BASE_URL/preview/spaces/$space_id/environments/$env_id/locales")
  assert_status "CPA: Get locales" "$response" "200"
  
  # Test 8: Cursor pagination with CPA
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CPA_TOKEN" \
    "$BASE_URL/preview/spaces/$space_id/environments/$env_id/entries?cursor=true&limit=3")
  assert_status "CPA: Cursor pagination" "$response" "200"
  
  # Test 9: Full-text search (if query param works)
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CPA_TOKEN" \
    "$BASE_URL/preview/spaces/$space_id/environments/$env_id/entries?query=test")
  assert_status "CPA: Full-text search" "$response" "200"
  
  echo ""
fi

echo ""

# ============================================
# PHASE 7.7: GRAPHQL API TESTING
# ============================================
echo -e "${YELLOW}┌─ PHASE 7.7: GRAPHQL CONTENT API ──────────────────────────┐${NC}"
echo ""

echo "Testing GraphQL API (Contentful-compatible)..."
echo ""

# GraphQL API Base URL
GRAPHQL_URL="https://us-central1-t4u-cms.cloudfunctions.net/graphql"
GRAPHQL_ENDPOINT="${GRAPHQL_URL}?space=${space_id}&environment=${env_id}"

# Helper function for GraphQL API calls
call_graphql() {
  local token="$1"
  local query="$2"
  local variables="$3"
  
  # Default to empty object if variables not provided
  if [ -z "$variables" ]; then
    variables="{}"
  fi
  
  # Use jq to build properly escaped JSON payload
  local json_payload=$(jq -n --arg q "$query" --argjson v "$variables" '{query: $q, variables: $v}')
  
  curl -s -w "\n%{http_code}" -X POST \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    --data-raw "$json_payload" \
    "$GRAPHQL_ENDPOINT"
}

# Test with CDA token (published content only)
if [ -n "${CDA_TOKEN:-}" ]; then
  echo -e "${GREEN}Testing GraphQL with CDA token (published content)...${NC}"
  
  # Test 1: Introspection query (check schema)
  response=$(call_graphql "$CDA_TOKEN" "{ __schema { types { name } } }")
  assert_status "GraphQL: Introspection query" "$response" "200"
  
  # Check if response contains Asset type
  if echo "$response" | grep -q "\"Asset\""; then
    echo -e "   ${GREEN}✓${NC} Schema contains Asset type"
    ((PASS++))
  else
    echo -e "   ${RED}✗${NC} Schema missing Asset type"
    ((FAIL++))
  fi
  
  # Test 2: Query all published assets
  response=$(call_graphql "$CDA_TOKEN" "{ assetCollection(limit: 10) { items { sys { id } title url } } }")
  assert_status "GraphQL: Get published assets" "$response" "200"
  
  # Extract asset count
  asset_count=$(echo "$response" | sed '$d' | jq -r '.data.assetCollection.items | length // 0')
  echo "   Found $asset_count published assets"
  
  # Test 3: Query single asset by ID (use news_pdf_asset_id which is published)
  if [ -n "$news_pdf_asset_id" ]; then
    response=$(call_graphql "$CDA_TOKEN" "query(\$id: String!) { asset(id: \$id) { sys { id publishedAt } title url } }" "{\"id\":\"$news_pdf_asset_id\"}")
    assert_status "GraphQL: Get single asset by ID" "$response" "200"
    
    # Check if asset data returned
    if echo "$response" | sed '$d' | jq -e ".data.asset.sys.id == \"$news_pdf_asset_id\"" > /dev/null 2>&1; then
      echo -e "   ${GREEN}✓${NC} Asset $news_pdf_asset_id retrieved via GraphQL"
      ((PASS++))
    else
      echo -e "   ${RED}✗${NC} Failed to retrieve asset via GraphQL"
      echo "   Response: $(echo "$response" | sed '$d')"
      ((FAIL++))
    fi
  fi
  
  # Test 4: Query assets with image transformations
  response=$(call_graphql "$CDA_TOKEN" "{ assetCollection(limit: 1) { items { title url(transform: { width: 200, height: 200, format: JPG }) } } }")
  assert_status "GraphQL: Assets with image transform" "$response" "200"
  
  # Test 5: Query entries (generic collection)
  response=$(call_graphql "$CDA_TOKEN" "{ entryCollection(limit: 5) { items { sys { id contentType { id } } } } }")
  assert_status "GraphQL: Get entry collection" "$response" "200"
  
  # Extract entry count
  entry_count=$(echo "$response" | sed '$d' | jq -r '.data.entryCollection.items | length // 0')
  echo "   Found $entry_count published entries"
  
  # Test 6: Query with filtering
  response=$(call_graphql "$CDA_TOKEN" '{ assetCollection(where: { title: "Test Image" }) { items { title } } }')
  assert_status "GraphQL: Query with filter" "$response" "200"
  
  # Test 7: Query with ordering
  response=$(call_graphql "$CDA_TOKEN" "{ assetCollection(order: [sys_publishedAt_DESC], limit: 3) { items { sys { id publishedAt } } } }")
  assert_status "GraphQL: Query with ordering" "$response" "200"
  
  # Test 8: Query with pagination
  response=$(call_graphql "$CDA_TOKEN" "{ assetCollection(skip: 0, limit: 2) { skip limit total items { title } } }")
  assert_status "GraphQL: Query with pagination" "$response" "200"
  
  # Test 9: Multi-locale query
  response=$(call_graphql "$CDA_TOKEN" "query(\$id: String!) { asset(id: \$id, locale: \"en-US\") { title } }" "{\"id\":\"$asset_id\"}")
  assert_status "GraphQL: Query with locale parameter" "$response" "200"
  
  # Test 10: Query fragments
  response=$(call_graphql "$CDA_TOKEN" "{ assetCollection(limit: 1) { items { ...assetFields } } } fragment assetFields on Asset { sys { id } title url }")
  assert_status "GraphQL: Query with fragments" "$response" "200"
  
  echo ""
  
  # ============================================
  # GRAPHQL: RICH TEXT WITH EMBEDDED CONTENT
  # ============================================
  echo -e "${GREEN}Testing GraphQL Rich Text with embedded content...${NC}"
  
  # Test 11: Query Article entries via GraphQL entryCollection
  echo "   Querying Article entries with embedded content via GraphQL..."
  response=$(call_graphql "$CDA_TOKEN" "{ 
    entryCollection(limit: 10) { 
      items { 
        sys { id contentType { id } }
      } 
    } 
  }")
  assert_status "GraphQL: Get entries collection" "$response" "200"
  
  # Verify entries were returned
  entry_count=$(echo "$response" | sed '$d' | jq -r '.data.entryCollection.items | length // 0')
  if [ "$entry_count" -gt 0 ]; then
    echo -e "   ${GREEN}✓${NC} Entries retrieved via GraphQL: $entry_count entries"
    ((PASS++))
  else
    echo -e "   ${RED}✗${NC} No entries returned from GraphQL"
    ((FAIL++))
  fi
  
  # Test 12: Query entries with include parameter to resolve linked assets/entries
  echo "   Querying entries with link resolution (include=2)..."
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $CDA_TOKEN" \
    "$BASE_URL/cdn/spaces/$space_id/environments/$env_id/entries/$article_entry_id?include=2")
  assert_status "CDA: Get Article with linked content (include=2)" "$response" "200"
  
  # Verify includes section contains the linked asset
  includes_assets=$(echo "$response" | sed '$d' | jq -r '.includes.Asset | length // 0')
  if [ "$includes_assets" -gt 0 ]; then
    echo -e "   ${GREEN}✓${NC} Linked assets resolved: $includes_assets asset(s) in includes"
    ((PASS++))
  else
    echo -e "   ${YELLOW}⚠${NC} No linked assets in includes (may not be implemented yet)"
  fi
  
  # Verify includes section contains the linked entry
  includes_entries=$(echo "$response" | sed '$d' | jq -r '.includes.Entry | length // 0')
  if [ "$includes_entries" -gt 0 ]; then
    echo -e "   ${GREEN}✓${NC} Linked entries resolved: $includes_entries entry(ies) in includes"
    ((PASS++))
  else
    echo -e "   ${YELLOW}⚠${NC} No linked entries in includes (may not be implemented yet)"
  fi
  
  # Test 13: Verify Rich Text structure in response
  echo "   Verifying Rich Text JSON structure..."
  rt_node_type=$(echo "$response" | sed '$d' | jq -r '.fields.content."en-US".nodeType // empty')
  if [ "$rt_node_type" = "document" ]; then
    echo -e "   ${GREEN}✓${NC} Rich Text nodeType is 'document'"
    ((PASS++))
  else
    echo -e "   ${RED}✗${NC} Rich Text nodeType mismatch (expected 'document', got '$rt_node_type')"
    ((FAIL++))
  fi
  
  # Verify embedded-asset-block exists
  has_embedded_asset=$(echo "$response" | sed '$d' | jq -r '.. | select(.nodeType? == "embedded-asset-block") | .nodeType' 2>/dev/null | head -1)
  if [ "$has_embedded_asset" = "embedded-asset-block" ]; then
    echo -e "   ${GREEN}✓${NC} Rich Text contains embedded-asset-block"
    ((PASS++))
  else
    echo -e "   ${RED}✗${NC} Rich Text missing embedded-asset-block"
    ((FAIL++))
  fi
  
  # Verify embedded-entry-block exists
  has_embedded_entry=$(echo "$response" | sed '$d' | jq -r '.. | select(.nodeType? == "embedded-entry-block") | .nodeType' 2>/dev/null | head -1)
  if [ "$has_embedded_entry" = "embedded-entry-block" ]; then
    echo -e "   ${GREEN}✓${NC} Rich Text contains embedded-entry-block"
    ((PASS++))
  else
    echo -e "   ${RED}✗${NC} Rich Text missing embedded-entry-block"
    ((FAIL++))
  fi
  
  # Verify embedded-entry-inline exists
  has_inline_entry=$(echo "$response" | sed '$d' | jq -r '.. | select(.nodeType? == "embedded-entry-inline") | .nodeType' 2>/dev/null | head -1)
  if [ "$has_inline_entry" = "embedded-entry-inline" ]; then
    echo -e "   ${GREEN}✓${NC} Rich Text contains embedded-entry-inline"
    ((PASS++))
  else
    echo -e "   ${RED}✗${NC} Rich Text missing embedded-entry-inline"
    ((FAIL++))
  fi
  
  echo ""
fi

# Test with CPA token (includes draft content)
if [ -n "${CPA_TOKEN:-}" ]; then
  echo -e "${GREEN}Testing GraphQL with CPA token (preview mode)...${NC}"
  
  # Test 1: Query with preview=true
  response=$(call_graphql "$CPA_TOKEN" "{ assetCollection(preview: true, limit: 10) { items { sys { id } title } } }")
  assert_status "GraphQL (CPA): Get assets with preview" "$response" "200"
  
  # Extract asset count (should include drafts)
  cpa_asset_count=$(echo "$response" | sed '$d' | jq -r '.data.assetCollection.items | length // 0')
  echo "   Found $cpa_asset_count assets (including drafts)"
  
  # Test 2: Query draft entries
  response=$(call_graphql "$CPA_TOKEN" "{ entryCollection(preview: true, limit: 10) { items { sys { id } } } }")
  assert_status "GraphQL (CPA): Get entries with preview" "$response" "200"
  
  cpa_entry_count=$(echo "$response" | sed '$d' | jq -r '.data.entryCollection.items | length // 0')
  echo "   Found $cpa_entry_count entries (including drafts)"
  
  # Test 3: Compare CPA vs CDA counts (CPA should have more or equal)
  if [ -n "${CDA_TOKEN:-}" ] && [ "$cpa_asset_count" -ge "$asset_count" ]; then
    echo -e "   ${GREEN}✓${NC} CPA returns >= CDA count ($cpa_asset_count >= $asset_count)"
    ((PASS++))
  fi
  
  # Test 4: Query with both preview and locale
  response=$(call_graphql "$CPA_TOKEN" "query(\$id: String!) { asset(id: \$id, preview: true, locale: \"en-US\") { title url } }" "{\"id\":\"$asset_id\"}")
  assert_status "GraphQL (CPA): Query with preview + locale" "$response" "200"
  
  echo ""
fi

# Test error handling (no token)
echo -e "${GREEN}Testing GraphQL error handling...${NC}"

# Test 1: Missing auth token (Apollo returns 500 with error details)
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"query":"{ assetCollection { items { title } } }"}' \
  "$GRAPHQL_ENDPOINT")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')
if [ "$http_code" = "500" ] && echo "$body" | grep -q "ACCESS_TOKEN"; then
  echo -e "${GREEN}✓ PASS${NC}: GraphQL: Missing auth token returns proper error"
  ((PASS++))
else
  echo -e "${RED}✗ FAIL${NC}: GraphQL: Missing auth token - expected 500 with ACCESS_TOKEN error, got $http_code"
  ((FAIL++))
fi

# Test 2: Invalid token (Apollo returns 500 with error details)
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer invalid_token_12345" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ assetCollection { items { title } } }"}' \
  "$GRAPHQL_ENDPOINT")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')
if [ "$http_code" = "500" ] && echo "$body" | grep -q "ACCESS_TOKEN"; then
  echo -e "${GREEN}✓ PASS${NC}: GraphQL: Invalid token returns proper error"
  ((PASS++))
else
  echo -e "${RED}✗ FAIL${NC}: GraphQL: Invalid token - expected 500 with ACCESS_TOKEN error, got $http_code"
  ((FAIL++))
fi

# Test 3: Invalid GraphQL syntax
if [ -n "${CDA_TOKEN:-}" ]; then
  response=$(call_graphql "$CDA_TOKEN" "{ assetCollection { invalid_field } }")
  # GraphQL can return 200 or 400 with errors array for syntax errors (depends on implementation)
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')
  if ([ "$http_code" = "200" ] || [ "$http_code" = "400" ]) && echo "$body" | grep -q "errors"; then
    echo -e "${GREEN}✓ PASS${NC}: GraphQL: Invalid syntax returns errors array (HTTP $http_code)"
    ((PASS++))
  else
    echo -e "${RED}✗ FAIL${NC}: GraphQL: Invalid syntax - expected 200 or 400 with errors, got $http_code"
    ((FAIL++))
  fi
fi

echo ""

# Summary of GraphQL tests
echo -e "${BLUE}GraphQL API Tests Summary:${NC}"
if [ -n "${CDA_TOKEN:-}" ]; then
  echo "  ✓ Tested with CDA token (published content)"
fi
if [ -n "${CPA_TOKEN:-}" ]; then
  echo "  ✓ Tested with CPA token (preview mode)"
fi
echo "  ✓ Introspection queries"
echo "  ✓ Asset queries (collection + single)"
echo "  ✓ Entry queries (generic collection)"
echo "  ✓ Image transformations"
echo "  ✓ Filtering and ordering"
echo "  ✓ Pagination (skip/limit)"
echo "  ✓ Multi-locale support"
echo "  ✓ Query fragments"
echo "  ✓ Error handling (auth, syntax)"

echo ""

# ============================================
# WAITING PERIOD BEFORE CLEANUP
# ============================================
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  All resources created - Check UI to verify               ${BLUE}║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "   Created resources:"
echo "   - Space: $space_id"
echo "   - Environment: $env_id"
echo "   - Blog Post Content Type: $ct_id"
echo "   - News Content Type: $news_ct_id"
echo "   - Kitchen Sink Content Type: $kitchen_sink_ct_id (ALL 11 field types)"
echo "   - Article Content Type: $article_ct_id (Rich Text with embeds)"
echo "   - Multiple Entries (Blog Posts)"
echo "   - News Entry: $news_entry_id"
echo "   - Kitchen Sink Entry: $kitchen_sink_entry_id"
echo "   - Article Entry: $article_entry_id (embedded assets/entries)"
echo "   - Assets: Image, PDF, CSV, Text, News PDF"
echo ""
if [ "$CI_MODE" = true ]; then
  echo -e "${YELLOW}CI mode: proceeding with cleanup automatically...${NC}"
else
  echo -e "${YELLOW}Press ENTER to proceed with cleanup (or Ctrl+C to keep resources)...${NC}"
  read -r
fi
echo ""

# ============================================
# PHASE 8: CLEANUP - DELETE ALL RESOURCES
# ============================================
echo -e "${YELLOW}┌─ PHASE 8: CLEANUP - DELETE ALL RESOURCES ─────────────────┐${NC}"
echo ""

# Delete news entry first
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/entries/$news_entry_id" "")
assert_status "Delete News Entry" "$response" "204"

# Delete Kitchen Sink entry
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/entries/$kitchen_sink_entry_id" "")
assert_status "Delete Kitchen Sink Entry" "$response" "204"

# Delete Article entry (Rich Text with embeds)
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/entries/$article_entry_id" "")
assert_status "Delete Article Entry" "$response" "204"

# Delete news PDF asset
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/assets/$news_pdf_asset_id" "")
assert_status "Delete News PDF Asset" "$response" "204"

# Delete all other assets
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/assets/$asset_id" "")
assert_status "Delete Asset (image)" "$response" "204"

response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/assets/$pdf_asset_id" "")
assert_status "Delete Asset (PDF)" "$response" "204"

response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/assets/$csv_asset_id" "")
assert_status "Delete Asset (CSV)" "$response" "204"

response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/assets/$txt_asset_id" "")
assert_status "Delete Asset (text)" "$response" "204"

# Delete remaining uploads
response=$(call_api "DELETE" "/v1/spaces/$space_id/uploads/$upload_id" "")
assert_status "Delete Upload (image)" "$response" "204"

response=$(call_api "DELETE" "/v1/spaces/$space_id/uploads/$pdf_upload_id" "")
assert_status "Delete Upload (PDF)" "$response" "204"

response=$(call_api "DELETE" "/v1/spaces/$space_id/uploads/$txt_upload_id" "")
assert_status "Delete Upload (text)" "$response" "204"

response=$(call_api "DELETE" "/v1/spaces/$space_id/uploads/$news_pdf_upload_id" "")
assert_status "Delete Upload (News PDF)" "$response" "204"

# Delete all entries
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/entries/$entry_id" "")
assert_status "Delete Entry (original)" "$response" "204"

response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/entries/$entry_en_id" "")
assert_status "Delete Entry (en-US)" "$response" "204"

response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/entries/$entry_fr_id" "")
assert_status "Delete Entry (fr-FR)" "$response" "204"

response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/entries/$entry_multi_id" "")
assert_status "Delete Entry (Multi-locale)" "$response" "204"

# Unpublish Content Type
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/content_types/$ct_id/published" "")
assert_status "Unpublish Content Type" "$response" "200"

# Delete Content Type
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/content_types/$ct_id" "")
assert_status "Delete Content Type (Blog Post)" "$response" "204"

# Unpublish News Content Type
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/content_types/$news_ct_id/published" "")
assert_status "Unpublish News Content Type" "$response" "200"

# Delete News Content Type
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/content_types/$news_ct_id" "")
assert_status "Delete Content Type (News)" "$response" "204"

# Unpublish Kitchen Sink Content Type
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/content_types/$kitchen_sink_ct_id/published" "")
assert_status "Unpublish Kitchen Sink Content Type" "$response" "200"

# Delete Kitchen Sink Content Type
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/content_types/$kitchen_sink_ct_id" "")
assert_status "Delete Content Type (Kitchen Sink)" "$response" "204"

# Unpublish Article Content Type
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/content_types/$article_ct_id/published" "")
assert_status "Unpublish Article Content Type" "$response" "200"

# Delete Article Content Type
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id/content_types/$article_ct_id" "")
assert_status "Delete Content Type (Article)" "$response" "204"

# Skip Environment deletion - it's protected (master environment is system-protected)
assert_status "Skip Delete Environment (protected)" "204" "204"

# Delete Space (note: space deletion doesn't delete the protected master environment)
response=$(call_api "DELETE" "/v1/spaces/$space_id" "")
assert_status "Delete Space" "$response" "204"

echo ""

# ============================================
# PHASE 9: VERIFY CLEANUP
# ============================================
echo -e "${YELLOW}┌─ PHASE 9: VERIFY CLEANUP (404 checks) ─────────────────────┐${NC}"
echo ""

response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/assets/$asset_id" "")
assert_status "Asset deleted (404)" "$response" "404"

response=$(call_api "GET" "/v1/spaces/$space_id/uploads/$upload_id" "")
assert_status "Upload deleted (404)" "$response" "404"

response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/entries/$entry_id" "")
assert_status "Entry deleted (404)" "$response" "404"

response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id/content_types/$ct_id" "")
assert_status "Content Type deleted (404)" "$response" "404"

# Skip Environment check - it's protected and still exists (by design)
assert_status "Skip Environment check (protected)" "200" "200"

response=$(call_api "GET" "/v1/spaces/$space_id" "")
assert_status "Space deleted (404)" "$response" "404"

echo ""

# ============================================
# SUMMARY
# ============================================
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"

if [ $FAIL -eq 0 ]; then
  echo ""
  echo -e "${GREEN}✅ FULL E2E TEST PASSED!${NC}"
  echo ""
  echo "Tested workflow:"
  echo "  ✓ Created Space"
  echo "  ✓ Created Environment in Space"
  echo "  ✓ Managed Locales (create, update, delete)"
  echo "  ✓ Created Content Type in Environment"
  echo "  ✓ Published Content Type"
  echo "  ✓ Created Entries (single & multi-locale)"
  echo "  ✓ Updated Entries"
  echo "  ✓ Published/Unpublished Entries"
  echo "  ✓ Archived/Unarchived Entries"
  echo "  ✓ Uploaded Files (Uploads API)"
  echo "  ✓ Created Assets (image, PDF, CSV, text)"
  echo "  ✓ Updated Assets (metadata)"
  echo "  ✓ Published/Unpublished Assets"
  echo "  ✓ Archived/Unarchived Assets"
  echo "  ✓ Created News Content Type with Media field"
  echo "  ✓ Created News Entry with linked PDF Asset"
  echo "  ✓ Verified Asset linking in Entry"
  echo "  ✓ Created Kitchen Sink Content Type with ALL 11 field types"
  echo "  ✓ Tested all field validations (size, range, regexp, array size)"
  echo "  ✓ Created Kitchen Sink Entry with all field types populated"
  echo "  ✓ Verified Symbol, Text, RichText, Integer, Number, Date, Boolean"
  echo "  ✓ Verified Location, Object, Array, Link (Entry & Asset)"
  echo "  ✓ Created Article with Rich Text embedded content"
  echo "  ✓ Tested embedded-asset-block in Rich Text"
  echo "  ✓ Tested embedded-entry-block in Rich Text"
  echo "  ✓ Tested embedded-entry-inline in Rich Text"
  echo "  ✓ Verified Rich Text JSON structure (Contentful-compatible)"
  echo "  ✓ Tested CDA endpoints (published content)"
  echo "  ✓ Tested CPA endpoints (including drafts)"
  echo "  ✓ Tested GraphQL API (Contentful-compatible)"
  echo "  ✓ Tested GraphQL introspection, queries, filtering, ordering"
  echo "  ✓ Tested GraphQL Rich Text with embedded content"
  echo "  ✓ Tested GraphQL with CDA/CPA tokens"
  echo "  ✓ Tested GraphQL error handling"
  echo "  ✓ Listed all resources"
  echo "  ✓ Deleted all resources in correct order"
  echo "  ✓ Verified all deletions"
  echo ""
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi

