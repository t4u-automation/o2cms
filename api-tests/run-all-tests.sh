#!/bin/bash

# Master test runner for O2 CMS API
# Usage: ./run-all-tests.sh <API_KEY> <SPACE_ID>

API_KEY="${1:-}"
SPACE_ID="${2:-}"

if [ -z "$API_KEY" ] || [ -z "$SPACE_ID" ]; then
  echo "Usage: ./run-all-tests.sh <API_KEY> <SPACE_ID>"
  echo ""
  echo "Example:"
  echo "  ./run-all-tests.sh o2_cma_xxxx my-project-id"
  exit 1
fi

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 Running O2 CMS API Test Suite"
echo "=================================="
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

failed=0

# Test 1: Environments API
echo "Running Environments API Tests..."
if bash "$SCRIPT_DIR/test-environments-api.sh" "$API_KEY" "$SPACE_ID"; then
  echo -e "${GREEN}✓ Environments API tests passed${NC}"
else
  echo -e "${RED}✗ Environments API tests failed${NC}"
  failed=$((failed + 1))
fi

echo ""
echo "=================================="
if [ $failed -eq 0 ]; then
  echo -e "${GREEN}✅ All test suites passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ $failed test suite(s) failed${NC}"
  exit 1
fi

