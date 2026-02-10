#!/bin/bash

# Test script for Content Types API - Full CRUD operations
# Usage: ./test-content-types-api.sh <API_KEY> <SPACE_ID>

API_KEY="${1:-}"
SPACE_ID="${2:-}"
BASE_URL="https://us-central1-t4u-cms.cloudfunctions.net/api"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

if [ -z "$API_KEY" ] || [ -z "$SPACE_ID" ]; then
  echo "Usage: ./test-content-types-api.sh <API_KEY> <SPACE_ID>"
  echo ""
  echo "Example:"
  echo "  ./test-content-types-api.sh o2_cma_xxxx my-project-id"
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

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Testing Content Types API - Full CRUD${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo "Base URL: $BASE_URL"
echo "Space ID: $SPACE_ID"
echo "API Key: ${API_KEY:0:15}..."
echo ""

# ============================================
# Step 1: Create or get main environment
# ============================================
echo -e "${YELLOW}[1] GET/CREATE MAIN ENVIRONMENT${NC}"
# Get main environment (should exist by default)
response=$(call_api "GET" "/v1/spaces/$SPACE_ID/environments/main" "")
parsed=$(parse_response "$response")
http_code="${parsed%%|*}"

if [ "$http_code" = "200" ]; then
  env_id="main"
  echo -e "${GREEN}✓${NC} Main environment exists"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} Main environment not found"
  FAIL=$((FAIL + 1))
  exit 1
fi
echo ""

# ============================================
# Step 2: List Content Types (before creating)
# ============================================
echo -e "${YELLOW}[2] LIST CONTENT TYPES (Before)${NC}"
response=$(call_api "GET" "/v1/spaces/$SPACE_ID/environments/$env_id/content_types" "")
assert_status "GET /v1/spaces/:space_id/environments/:env_id/content_types" "$response" "200"
initial_count=$(echo "$response" | sed '$d' | jq '.total' 2>/dev/null || echo "0")
echo "    Initial content types: $initial_count"
echo ""

# ============================================
# Step 3: Create Content Type
# ============================================
echo -e "${YELLOW}[3] CREATE CONTENT TYPE${NC}"
response=$(call_api "POST" "/v1/spaces/$SPACE_ID/environments/$env_id/content_types" \
  '{
    "name": "Blog Post",
    "description": "A blog post content type for testing",
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
        "id": "slug",
        "name": "Slug",
        "type": "Symbol",
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
assert_status "POST /v1/spaces/:space_id/environments/:env_id/content_types" "$response" "201"

# Extract content type ID
ct_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "    Created Content Type ID: $ct_id"
echo ""

if [ -z "$ct_id" ] || [ "$ct_id" = "null" ]; then
  echo -e "${RED}✗ Failed to create content type${NC}"
  exit 1
fi

# ============================================
# Step 4: Get Specific Content Type
# ============================================
echo -e "${YELLOW}[4] GET SPECIFIC CONTENT TYPE${NC}"
response=$(call_api "GET" "/v1/spaces/$SPACE_ID/environments/$env_id/content_types/$ct_id" "")
assert_status "GET /v1/spaces/:space_id/environments/:env_id/content_types/:ct_id" "$response" "200"
ct_name=$(echo "$response" | sed '$d' | jq -r '.name' 2>/dev/null)
echo "    Retrieved content type: $ct_name"
echo ""

# ============================================
# Step 5: List Content Types (after creating)
# ============================================
echo -e "${YELLOW}[5] LIST CONTENT TYPES (After create)${NC}"
response=$(call_api "GET" "/v1/spaces/$SPACE_ID/environments/$env_id/content_types" "")
assert_status "GET /v1/spaces/:space_id/environments/:env_id/content_types" "$response" "200"
after_create_count=$(echo "$response" | sed '$d' | jq '.total' 2>/dev/null || echo "0")
echo "    Total content types: $after_create_count"
echo ""

# ============================================
# Step 6: Update Content Type
# ============================================
echo -e "${YELLOW}[6] UPDATE CONTENT TYPE${NC}"
response=$(call_api "PUT" "/v1/spaces/$SPACE_ID/environments/$env_id/content_types/$ct_id" \
  '{
    "name": "Blog Post",
    "description": "Updated blog post type with more details",
    "displayField": "title"
  }')
assert_status "PUT /v1/spaces/:space_id/environments/:env_id/content_types/:ct_id" "$response" "200"
updated_desc=$(echo "$response" | sed '$d' | jq -r '.description' 2>/dev/null)
echo "    Updated description: $updated_desc"
echo ""

# ============================================
# Step 7: Publish Content Type
# ============================================
echo -e "${YELLOW}[7] PUBLISH CONTENT TYPE${NC}"
response=$(call_api "PUT" "/v1/spaces/$SPACE_ID/environments/$env_id/content_types/$ct_id/published" "")
assert_status "PUT /v1/spaces/:space_id/environments/:env_id/content_types/:ct_id/published" "$response" "200"
published_version=$(echo "$response" | sed '$d' | jq -r '.sys.publishedVersion' 2>/dev/null)
echo "    Published version: $published_version"
echo ""

# ============================================
# Step 8: Try to update published content type (should fail)
# ============================================
echo -e "${YELLOW}[8] TRY UPDATE PUBLISHED CT (should fail)${NC}"
response=$(call_api "PUT" "/v1/spaces/$SPACE_ID/environments/$env_id/content_types/$ct_id" \
  '{"name": "New Name", "displayField": "title"}')
parsed=$(parse_response "$response")
http_code="${parsed%%|*}"
if [ "$http_code" = "400" ]; then
  echo -e "${GREEN}✓${NC} Correctly prevented update of published CT (HTTP 400)"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} Should have prevented update (got $http_code)"
  FAIL=$((FAIL + 1))
fi
echo ""

# ============================================
# Step 9: Unpublish Content Type
# ============================================
echo -e "${YELLOW}[9] UNPUBLISH CONTENT TYPE${NC}"
response=$(call_api "DELETE" "/v1/spaces/$SPACE_ID/environments/$env_id/content_types/$ct_id/published" "")
assert_status "DELETE /v1/spaces/:space_id/environments/:env_id/content_types/:ct_id/published" "$response" "200"
echo ""

# ============================================
# Step 10: Delete Content Type
# ============================================
echo -e "${YELLOW}[10] DELETE CONTENT TYPE${NC}"
response=$(call_api "DELETE" "/v1/spaces/$SPACE_ID/environments/$env_id/content_types/$ct_id" "")
assert_status "DELETE /v1/spaces/:space_id/environments/:env_id/content_types/:ct_id" "$response" "204"
echo ""

# ============================================
# Step 11: Verify Deletion (404)
# ============================================
echo -e "${YELLOW}[11] VERIFY DELETION (404)${NC}"
response=$(call_api "GET" "/v1/spaces/$SPACE_ID/environments/$env_id/content_types/$ct_id" "")
assert_status "GET deleted CT (should be 404)" "$response" "404"
echo ""

# ============================================
# Step 12: Error Cases
# ============================================
echo -e "${YELLOW}[12] ERROR CASES${NC}"

# Missing name
echo -n "    Missing name field... "
response=$(call_api "POST" "/v1/spaces/$SPACE_ID/environments/$env_id/content_types" \
  '{"displayField": "title", "fields": []}')
parsed=$(parse_response "$response")
http_code="${parsed%%|*}"
if [ "$http_code" = "400" ]; then
  echo -e "${GREEN}✓${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} (got $http_code)"
  FAIL=$((FAIL + 1))
fi

# Missing fields
echo -n "    Missing fields... "
response=$(call_api "POST" "/v1/spaces/$SPACE_ID/environments/$env_id/content_types" \
  '{"name": "Test", "displayField": "title"}')
parsed=$(parse_response "$response")
http_code="${parsed%%|*}"
if [ "$http_code" = "400" ]; then
  echo -e "${GREEN}✓${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} (got $http_code)"
  FAIL=$((FAIL + 1))
fi

# Invalid API key
echo -n "    Invalid API key... "
response=$(curl -s -w "\n%{http_code}" -X GET \
  -H "Authorization: Bearer invalid_key" \
  -H "Content-Type: application/json" \
  "$BASE_URL/v1/spaces/$SPACE_ID/environments/$env_id/content_types")
parsed=$(parse_response "$response")
http_code="${parsed%%|*}"
if [ "$http_code" = "401" ]; then
  echo -e "${GREEN}✓${NC}"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} (got $http_code)"
  FAIL=$((FAIL + 1))
fi

echo ""

# ============================================
# Summary
# ============================================
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}✅ All Content Types API tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi

