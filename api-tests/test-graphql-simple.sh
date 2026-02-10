#!/bin/bash

# Simple GraphQL API Test
# Tests basic GraphQL functionality
# Usage: ./test-graphql-simple.sh <CDA_TOKEN> <SPACE_ID> <ENV_ID>

CDA_TOKEN="${1:-}"
SPACE_ID="${2:-}"
ENV_ID="${3:-master}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -z "$CDA_TOKEN" ] || [ -z "$SPACE_ID" ]; then
  echo "Usage: ./test-graphql-simple.sh <CDA_TOKEN> <SPACE_ID> [ENV_ID]"
  echo ""
  echo "Example:"
  echo "  ./test-graphql-simple.sh o2_cda_xxxx my-space-id master"
  exit 1
fi

GRAPHQL_URL="https://us-central1-t4u-cms.cloudfunctions.net/graphql"
GRAPHQL_ENDPOINT="${GRAPHQL_URL}?space=${SPACE_ID}&environment=${ENV_ID}"

echo "======================================================"
echo "  GraphQL API Simple Test"
echo "======================================================"
echo ""
echo "Endpoint: $GRAPHQL_ENDPOINT"
echo "Token:    ${CDA_TOKEN:0:15}..."
echo ""

PASS=0
FAIL=0

# Helper function for GraphQL calls
call_graphql() {
  local query="$1"
  local variables="${2:-{}}"
  
  local json_payload=$(jq -n --arg q "$query" --argjson v "$variables" '{query: $q, variables: $v}')
  
  curl -s -w "\n---HTTP_CODE:%{http_code}" -X POST \
    -H "Authorization: Bearer $CDA_TOKEN" \
    -H "Content-Type: application/json" \
    --data-raw "$json_payload" \
    "$GRAPHQL_ENDPOINT"
}

# Test 1: Simple introspection
echo "Test 1: Introspection (__typename)"
response=$(call_graphql "{ __typename }")
http_code=$(echo "$response" | grep "^---HTTP_CODE:" | cut -d: -f2)
body=$(echo "$response" | grep -v "^---HTTP_CODE:")

if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✓ PASS${NC} - Got 200 response"
  echo "Response: $body"
  ((PASS++))
else
  echo -e "${RED}✗ FAIL${NC} - Expected 200, got $http_code"
  echo "Response: $body"
  ((FAIL++))
fi

echo ""

# Test 2: Query assets
echo "Test 2: Query assetCollection"
response=$(call_graphql "{ assetCollection(limit: 5) { total items { sys { id } title } } }")
http_code=$(echo "$response" | grep "^---HTTP_CODE:" | cut -d: -f2)
body=$(echo "$response" | grep -v "^---HTTP_CODE:")

if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✓ PASS${NC} - Got 200 response"
  
  # Check if response has data
  if echo "$body" | jq -e '.data.assetCollection' > /dev/null 2>&1; then
    total=$(echo "$body" | jq -r '.data.assetCollection.total')
    echo "  Found $total assets"
    ((PASS++))
  else
    echo "  Response: $body"
  fi
else
  echo -e "${RED}✗ FAIL${NC} - Expected 200, got $http_code"
  echo "Response: $body"
  ((FAIL++))
fi

echo ""

# Test 3: Query entries
echo "Test 3: Query entryCollection"
response=$(call_graphql "{ entryCollection(limit: 5) { total items { sys { id } } } }")
http_code=$(echo "$response" | grep "^---HTTP_CODE:" | cut -d: -f2)
body=$(echo "$response" | grep -v "^---HTTP_CODE:")

if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✓ PASS${NC} - Got 200 response"
  
  if echo "$body" | jq -e '.data.entryCollection' > /dev/null 2>&1; then
    total=$(echo "$body" | jq -r '.data.entryCollection.total')
    echo "  Found $total entries"
    ((PASS++))
  else
    echo "  Response: $body"
  fi
else
  echo -e "${RED}✗ FAIL${NC} - Expected 200, got $http_code"
  echo "Response: $body"
  ((FAIL++))
fi

echo ""

# Test 4: Schema introspection
echo "Test 4: Schema introspection"
response=$(call_graphql "{ __schema { types { name } } }")
http_code=$(echo "$response" | grep "^---HTTP_CODE:" | cut -d: -f2)
body=$(echo "$response" | grep -v "^---HTTP_CODE:")

if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✓ PASS${NC} - Got 200 response"
  
  if echo "$body" | grep -q "Asset"; then
    echo "  ✓ Schema contains Asset type"
    ((PASS++))
  else
    echo "  ✗ Schema missing Asset type"
    ((FAIL++))
  fi
else
  echo -e "${RED}✗ FAIL${NC} - Expected 200, got $http_code"
  echo "Response: $body"
  ((FAIL++))
fi

echo ""

# Summary
echo "======================================================"
echo "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo "======================================================"

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi



