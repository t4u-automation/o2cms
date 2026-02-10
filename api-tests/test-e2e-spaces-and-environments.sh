#!/bin/bash

# End-to-End Test: Spaces and Environments APIs
# This tests the complete flow: Create Space → Create Environment → Update → Delete All
# Usage: ./test-e2e-spaces-and-environments.sh <API_KEY>

API_KEY="${1:-}"
BASE_URL="https://us-central1-t4u-cms.cloudfunctions.net/api"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

if [ -z "$API_KEY" ]; then
  echo "Usage: ./test-e2e-spaces-and-environments.sh <API_KEY>"
  echo ""
  echo "Example:"
  echo "  ./test-e2e-spaces-and-environments.sh o2_cma_xxxx"
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
echo -e "${BLUE}  End-to-End Test: Spaces & Environments APIs${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo "Base URL: $BASE_URL"
echo "API Key: ${API_KEY:0:15}..."
echo ""

# ============================================
# Phase 1: Test Spaces API
# ============================================
echo -e "${YELLOW}═══ PHASE 1: SPACES API ═══${NC}"
echo ""

# Step 1: Create a test space
echo -e "${YELLOW}[1] CREATE SPACE${NC}"
response=$(call_api "POST" "/v1/spaces" \
  '{"name": "E2E Test Space", "description": "End-to-end test space", "defaultLocale": "en-US"}')
assert_status "POST /v1/spaces" "$response" "201"

# Extract space ID from response
space_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "    Created Space ID: $space_id"
echo ""

if [ -z "$space_id" ] || [ "$space_id" = "null" ]; then
  echo -e "${RED}✗ Failed to create space${NC}"
  exit 1
fi

# Step 2: List all spaces
echo -e "${YELLOW}[2] LIST SPACES${NC}"
response=$(call_api "GET" "/v1/spaces" "")
assert_status "GET /v1/spaces" "$response" "200"
space_count=$(echo "$response" | sed '$d' | jq '.total' 2>/dev/null || echo "0")
echo "    Total spaces: $space_count"
echo ""

# Step 3: Get specific space
echo -e "${YELLOW}[3] GET SPACE${NC}"
response=$(call_api "GET" "/v1/spaces/$space_id" "")
assert_status "GET /v1/spaces/:space_id" "$response" "200"
space_name=$(echo "$response" | sed '$d' | jq -r '.name' 2>/dev/null)
echo "    Retrieved space: $space_name"
echo ""

# Step 4: Update space
echo -e "${YELLOW}[4] UPDATE SPACE${NC}"
response=$(call_api "PUT" "/v1/spaces/$space_id" \
  '{"description": "Updated test space with better description"}')
assert_status "PUT /v1/spaces/:space_id" "$response" "200"
updated_desc=$(echo "$response" | sed '$d' | jq -r '.description' 2>/dev/null)
echo "    Updated description: $updated_desc"
echo ""

# ============================================
# Phase 2: Test Environments API (within the created space)
# ============================================
echo -e "${YELLOW}═══ PHASE 2: ENVIRONMENTS API (in the created space) ═══${NC}"
echo ""

# Step 5: Create environment in the test space
echo -e "${YELLOW}[5] CREATE ENVIRONMENT${NC}"
response=$(call_api "POST" "/v1/spaces/$space_id/environments" \
  '{"name": "e2e-staging", "description": "E2E staging environment"}')
assert_status "POST /v1/spaces/:space_id/environments" "$response" "201"

env_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "    Created Environment ID: $env_id"
echo ""

if [ -z "$env_id" ] || [ "$env_id" = "null" ]; then
  echo -e "${RED}✗ Failed to create environment${NC}"
  exit 1
fi

# Step 6: List environments in the space
echo -e "${YELLOW}[6] LIST ENVIRONMENTS${NC}"
response=$(call_api "GET" "/v1/spaces/$space_id/environments" "")
assert_status "GET /v1/spaces/:space_id/environments" "$response" "200"
env_count=$(echo "$response" | sed '$d' | jq '.total' 2>/dev/null || echo "0")
echo "    Total environments in space: $env_count"
echo ""

# Step 7: Get specific environment
echo -e "${YELLOW}[7] GET ENVIRONMENT${NC}"
response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id" "")
assert_status "GET /v1/spaces/:space_id/environments/:environment_id" "$response" "200"
env_name=$(echo "$response" | sed '$d' | jq -r '.name' 2>/dev/null)
echo "    Retrieved environment: $env_name"
echo ""

# Step 8: Update environment
echo -e "${YELLOW}[8] UPDATE ENVIRONMENT${NC}"
response=$(call_api "PUT" "/v1/spaces/$space_id/environments/$env_id" \
  '{"description": "Updated staging environment for testing"}')
assert_status "PUT /v1/spaces/:space_id/environments/:environment_id" "$response" "200"
updated_env_desc=$(echo "$response" | sed '$d' | jq -r '.description' 2>/dev/null)
echo "    Updated description: $updated_env_desc"
echo ""

# ============================================
# Phase 3: Cleanup (Delete all created resources)
# ============================================
echo -e "${YELLOW}═══ PHASE 3: CLEANUP (Delete created resources) ═══${NC}"
echo ""

# Step 9: Delete environment
echo -e "${YELLOW}[9] DELETE ENVIRONMENT${NC}"
response=$(call_api "DELETE" "/v1/spaces/$space_id/environments/$env_id" "")
assert_status "DELETE /v1/spaces/:space_id/environments/:environment_id" "$response" "204"
echo ""

# Step 10: Verify environment deleted (404)
echo -e "${YELLOW}[10] VERIFY ENVIRONMENT DELETED${NC}"
response=$(call_api "GET" "/v1/spaces/$space_id/environments/$env_id" "")
assert_status "GET deleted environment (should be 404)" "$response" "404"
echo ""

# Step 11: Delete space
echo -e "${YELLOW}[11] DELETE SPACE${NC}"
response=$(call_api "DELETE" "/v1/spaces/$space_id" "")
assert_status "DELETE /v1/spaces/:space_id" "$response" "204"
echo ""

# Step 12: Verify space deleted (404)
echo -e "${YELLOW}[12] VERIFY SPACE DELETED${NC}"
response=$(call_api "GET" "/v1/spaces/$space_id" "")
assert_status "GET deleted space (should be 404)" "$response" "404"
echo ""

# ============================================
# Summary
# ============================================
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}✅ All E2E tests passed!${NC}"
  echo ""
  echo "Test flow completed successfully:"
  echo "  ✓ Created space"
  echo "  ✓ Listed spaces"
  echo "  ✓ Retrieved space"
  echo "  ✓ Updated space"
  echo "  ✓ Created environment in space"
  echo "  ✓ Listed environments"
  echo "  ✓ Retrieved environment"
  echo "  ✓ Updated environment"
  echo "  ✓ Deleted environment"
  echo "  ✓ Verified environment deleted"
  echo "  ✓ Deleted space"
  echo "  ✓ Verified space deleted"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi

