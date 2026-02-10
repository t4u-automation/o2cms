#!/bin/bash

# Test script for Environments API - Full CRUD operations
# Usage: ./test-environments-api.sh <API_KEY> <SPACE_ID>

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
  echo "Usage: ./test-environments-api.sh <API_KEY> <SPACE_ID>"
  echo ""
  echo "Example:"
  echo "  ./test-environments-api.sh o2_cma_xxxx my-project-id"
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

echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo -e "${BLUE}  Testing Environments API - Full CRUD${NC}"
echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo "Base URL: $BASE_URL"
echo "Space ID: $SPACE_ID"
echo "API Key: ${API_KEY:0:15}..."
echo ""

# ============================================
# Test 1: List Environments (Before creating)
# ============================================
echo -e "${YELLOW}[1] LIST ENVIRONMENTS${NC}"
response=$(call_api "GET" "/v1/spaces/$SPACE_ID/environments" "")
assert_status "GET /v1/spaces/:space_id/environments" "$response" "200"
initial_count=$(echo "$response" | sed '$d' | jq '.total' 2>/dev/null || echo "0")
echo "    Initial environment count: $initial_count"
echo ""

# ============================================
# Test 2: Create Environment
# ============================================
echo -e "${YELLOW}[2] CREATE ENVIRONMENT${NC}"
response=$(call_api "POST" "/v1/spaces/$SPACE_ID/environments" \
  '{"name": "staging", "description": "Staging environment for testing"}')
assert_status "POST /v1/spaces/:space_id/environments" "$response" "201"

# Extract environment ID from response
env_id=$(echo "$response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "    Created environment ID: $env_id"
echo ""

if [ -z "$env_id" ] || [ "$env_id" = "null" ]; then
  echo -e "${RED}✗ Failed to create environment${NC}"
  exit 1
fi

# ============================================
# Test 3: Get Specific Environment
# ============================================
echo -e "${YELLOW}[3] GET ENVIRONMENT${NC}"
response=$(call_api "GET" "/v1/spaces/$SPACE_ID/environments/$env_id" "")
assert_status "GET /v1/spaces/:space_id/environments/:environment_id" "$response" "200"
name=$(echo "$response" | sed '$d' | jq -r '.name' 2>/dev/null)
echo "    Retrieved environment: $name"
echo ""

# ============================================
# Test 4: Update Environment
# ============================================
echo -e "${YELLOW}[4] UPDATE ENVIRONMENT${NC}"
response=$(call_api "PUT" "/v1/spaces/$SPACE_ID/environments/$env_id" \
  '{"name": "staging", "description": "Updated staging environment with new description"}')
assert_status "PUT /v1/spaces/:space_id/environments/:environment_id" "$response" "200"
updated_desc=$(echo "$response" | sed '$d' | jq -r '.description' 2>/dev/null)
echo "    Updated description: $updated_desc"
echo ""

# ============================================
# Test 5: List Again (After creating)
# ============================================
echo -e "${YELLOW}[5] LIST ENVIRONMENTS AGAIN${NC}"
response=$(call_api "GET" "/v1/spaces/$SPACE_ID/environments" "")
assert_status "GET /v1/spaces/:space_id/environments (after create)" "$response" "200"
final_count=$(echo "$response" | sed '$d' | jq '.total' 2>/dev/null || echo "0")
echo "    Final environment count: $final_count"
echo ""

# ============================================
# Test 6: Delete Environment
# ============================================
echo -e "${YELLOW}[6] DELETE ENVIRONMENT${NC}"
response=$(call_api "DELETE" "/v1/spaces/$SPACE_ID/environments/$env_id" "")
assert_status "DELETE /v1/spaces/:space_id/environments/:environment_id" "$response" "204"
echo ""

# ============================================
# Test 7: Verify Deletion (404)
# ============================================
echo -e "${YELLOW}[7] VERIFY DELETION (404)${NC}"
response=$(call_api "GET" "/v1/spaces/$SPACE_ID/environments/$env_id" "")
assert_status "GET deleted environment (should be 404)" "$response" "404"
echo ""

# ============================================
# Test 8: Error Cases
# ============================================
echo -e "${YELLOW}[8] ERROR CASES${NC}"

# Missing name
echo -n "    Missing name field... "
response=$(call_api "POST" "/v1/spaces/$SPACE_ID/environments" '{"description": "No name"}')
parsed=$(parse_response "$response")
http_code="${parsed%%|*}"
if [ "$http_code" = "400" ]; then
  echo -e "${GREEN}✓${NC} (HTTP 400)"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} (Expected 400, got $http_code)"
  FAIL=$((FAIL + 1))
fi

# Invalid API key
echo -n "    Invalid API key... "
response=$(curl -s -w "\n%{http_code}" -X GET \
  -H "Authorization: Bearer invalid_key" \
  -H "Content-Type: application/json" \
  "$BASE_URL/v1/spaces/$SPACE_ID/environments")
parsed=$(parse_response "$response")
http_code="${parsed%%|*}"
if [ "$http_code" = "401" ]; then
  echo -e "${GREEN}✓${NC} (HTTP 401)"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} (Expected 401, got $http_code)"
  FAIL=$((FAIL + 1))
fi

# Non-existent environment
echo -n "    Non-existent environment... "
response=$(call_api "GET" "/v1/spaces/$SPACE_ID/environments/nonexistent" "")
parsed=$(parse_response "$response")
http_code="${parsed%%|*}"
if [ "$http_code" = "404" ]; then
  echo -e "${GREEN}✓${NC} (HTTP 404)"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗${NC} (Expected 404, got $http_code)"
  FAIL=$((FAIL + 1))
fi

echo ""

# ============================================
# Summary
# ============================================
echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo -e "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo -e "${BLUE}═══════════════════════════════════════════${NC}"

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi

