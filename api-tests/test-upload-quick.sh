#!/bin/bash

# Quick Upload Test Script
# Usage: ./test-upload-quick.sh <API_KEY> [local|prod]

API_KEY="${1:-}"
ENV="${2:-prod}"

if [ "$ENV" = "local" ]; then
  BASE_URL="http://localhost:5001/t4u-cms/us-central1/api"
else
  BASE_URL="https://us-central1-t4u-cms.cloudfunctions.net/api"
fi

if [ -z "$API_KEY" ]; then
  echo "Usage: ./test-upload-quick.sh <API_KEY> [local|prod]"
  exit 1
fi

echo "Testing upload to: $BASE_URL"
echo "API Key: ${API_KEY:0:15}..."
echo ""

# First, get or create a space
echo "1. Creating test space..."
space_response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Upload Test Space", "defaultLocale": "en-US"}' \
  "$BASE_URL/v1/spaces")

space_id=$(echo "$space_response" | sed '$d' | jq -r '.sys.id' 2>/dev/null)
echo "Space ID: $space_id"
echo ""

# Wait for space initialization
echo "Waiting 5 seconds for initialization..."
sleep 5
echo ""

# Test file upload
echo "2. Testing file upload..."
curl -v -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@test-image.png" \
  "$BASE_URL/v1/spaces/$space_id/uploads"

echo ""
echo ""
echo "Check the logs above for [Middleware] and [Uploads] debug messages"

