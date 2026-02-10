#!/bin/bash

# API Test Script for O2 CMS - Cloud Functions
# Tests the Cloud Functions API

API_KEY="${O2_CMA_API_KEY:?Set O2_CMA_API_KEY environment variable}"

# Use production URL or local emulator
if [ "$1" == "local" ]; then
  BASE_URL="http://localhost:5001/t4u-cms/us-central1/api"
  echo "🧪 Testing O2 CMS API (Local Emulator)"
else
  BASE_URL="${O2_API_BASE_URL:?Set O2_API_BASE_URL environment variable}"
  echo "🧪 Testing O2 CMS API (Production)"
fi

echo "======================================"
echo "Base URL: $BASE_URL"
echo ""

# Test 1: Health check (no auth required)
echo "✅ Test 1: Health Check (no auth)"
echo "GET $BASE_URL/health"
echo ""
curl -X GET "$BASE_URL/health" \
  -H "Content-Type: application/json" \
  -w "\n\nStatus Code: %{http_code}\n" \
  -s | jq '.'
echo ""
echo "---"
echo ""

# Test 2: Valid request
echo "✅ Test 2: Valid API Key"
echo "GET $BASE_URL/v1/spaces"
echo ""
curl -X GET "$BASE_URL/v1/spaces" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -w "\n\nStatus Code: %{http_code}\n" \
  -s | jq '.'
echo ""
echo "---"
echo ""

# Test 3: Missing Authorization Header
echo "❌ Test 3: Missing Authorization Header"
echo "GET $BASE_URL/v1/spaces (no auth)"
echo ""
curl -X GET "$BASE_URL/v1/spaces" \
  -H "Content-Type: application/json" \
  -w "\n\nStatus Code: %{http_code}\n" \
  -s | jq '.'
echo ""
echo "---"
echo ""

# Test 4: Invalid API Key
echo "❌ Test 4: Invalid API Key"
echo "GET $BASE_URL/v1/spaces (invalid key)"
echo ""
curl -X GET "$BASE_URL/v1/spaces" \
  -H "Authorization: Bearer invalid_key_123" \
  -H "Content-Type: application/json" \
  -w "\n\nStatus Code: %{http_code}\n" \
  -s | jq '.'
echo ""
echo "---"
echo ""

# Test 5: Wrong Authorization Format
echo "❌ Test 5: Wrong Authorization Format (missing Bearer)"
echo "GET $BASE_URL/v1/spaces"
echo ""
curl -X GET "$BASE_URL/v1/spaces" \
  -H "Authorization: $API_KEY" \
  -H "Content-Type: application/json" \
  -w "\n\nStatus Code: %{http_code}\n" \
  -s | jq '.'
echo ""
echo "---"
echo ""

echo "🎉 Tests Complete!"
echo ""
echo "Usage:"
echo "  ./test-api.sh         # Test production"
echo "  ./test-api.sh local   # Test local emulator"

