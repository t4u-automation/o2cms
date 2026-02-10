#!/bin/bash

# Manual cURL examples for Environments API
# This script shows you how to test each endpoint manually

API_KEY="${1:-}"
SPACE_ID="${2:-}"
BASE_URL="https://us-central1-t4u-cms.cloudfunctions.net/api"

if [ -z "$API_KEY" ] || [ -z "$SPACE_ID" ]; then
  echo "Usage: ./test-manual-curl.sh <API_KEY> <SPACE_ID>"
  echo ""
  echo "Example:"
  echo "  ./test-manual-curl.sh o2_cma_xxxx my-project-id"
  exit 1
fi

echo "📋 Manual cURL Test Examples"
echo "=============================="
echo ""
echo "API Key: ${API_KEY:0:15}..."
echo "Space ID: $SPACE_ID"
echo "Base URL: $BASE_URL"
echo ""

echo "To test manually, copy and run these commands:"
echo ""

echo "1️⃣  LIST ALL ENVIRONMENTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "curl -X GET \\"
echo "  $BASE_URL/v1/spaces/$SPACE_ID/environments \\"
echo "  -H 'Authorization: Bearer $API_KEY' \\"
echo "  -H 'Content-Type: application/json' | jq"
echo ""

echo "2️⃣  CREATE NEW ENVIRONMENT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "curl -X POST \\"
echo "  $BASE_URL/v1/spaces/$SPACE_ID/environments \\"
echo "  -H 'Authorization: Bearer $API_KEY' \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{'"
echo "    \"name\": \"staging\","
echo "    \"description\": \"Staging environment\""
echo "  '}' | jq"
echo ""

echo "3️⃣  GET SPECIFIC ENVIRONMENT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "curl -X GET \\"
echo "  $BASE_URL/v1/spaces/$SPACE_ID/environments/ENV_ID \\"
echo "  -H 'Authorization: Bearer $API_KEY' \\"
echo "  -H 'Content-Type: application/json' | jq"
echo ""
echo "Note: Replace ENV_ID with an actual environment ID from step 1 or 2"
echo ""

echo "4️⃣  UPDATE ENVIRONMENT"
echo "━━━━━━━━━━━━━━━━━━━━━"
echo "curl -X PUT \\"
echo "  $BASE_URL/v1/spaces/$SPACE_ID/environments/ENV_ID \\"
echo "  -H 'Authorization: Bearer $API_KEY' \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{'"
echo "    \"name\": \"staging\","
echo "    \"description\": \"Updated description\""
echo "  '}' | jq"
echo ""

echo "5️⃣  DELETE ENVIRONMENT"
echo "━━━━━━━━━━━━━━━━━━━━"
echo "curl -X DELETE \\"
echo "  $BASE_URL/v1/spaces/$SPACE_ID/environments/ENV_ID \\"
echo "  -H 'Authorization: Bearer $API_KEY' \\"
echo "  -H 'Content-Type: application/json'"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 Tips:"
echo "  - Use 'jq' to format JSON responses prettily"
echo "  - Replace ENV_ID with actual environment IDs"
echo "  - Add -v flag to curl to see full request/response details"
echo "  - Save responses: -o filename.json"
echo ""

