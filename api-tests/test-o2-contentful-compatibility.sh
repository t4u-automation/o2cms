#!/bin/bash

# O2 CMS vs Contentful Compatibility Test
# 
# This script compares O2 CMS and Contentful API responses to validate
# that migrated content is served identically.
#
# Usage:
#   ./test-o2-contentful-compatibility.sh <O2_CDA_TOKEN> <O2_SPACE_ID> <CF_CDA_TOKEN> <CF_SPACE_ID> [O2_ENV_ID] [CF_ENV_ID]
#
# Or with environment variables:
#   export O2_CDA_TOKEN="..."
#   export O2_SPACE_ID="..."
#   export CF_CDA_TOKEN="..."
#   export CF_SPACE_ID="..."
#   ./test-o2-contentful-compatibility.sh

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if arguments provided, use them to set env vars
if [ -n "$1" ]; then
  export O2_CDA_TOKEN="$1"
fi
if [ -n "$2" ]; then
  export O2_SPACE_ID="$2"
fi
if [ -n "$3" ]; then
  export CF_CDA_TOKEN="$3"
fi
if [ -n "$4" ]; then
  export CF_SPACE_ID="$4"
fi
if [ -n "$5" ]; then
  export O2_ENV_ID="$5"
fi
if [ -n "$6" ]; then
  export CF_ENV_ID="$6"
fi

# Validate required vars
if [ -z "$O2_CDA_TOKEN" ] || [ -z "$O2_SPACE_ID" ] || [ -z "$CF_CDA_TOKEN" ] || [ -z "$CF_SPACE_ID" ]; then
  echo -e "${RED}Missing required parameters${NC}"
  echo ""
  echo "Usage:"
  echo "  $0 <O2_CDA_TOKEN> <O2_SPACE_ID> <CF_CDA_TOKEN> <CF_SPACE_ID> [O2_ENV_ID] [CF_ENV_ID]"
  echo ""
  echo "Or set environment variables:"
  echo "  export O2_CDA_TOKEN=\"o2_cda_...\""
  echo "  export O2_SPACE_ID=\"your-o2-space-id\""
  echo "  export O2_ENV_ID=\"abc123...\"     # optional: actual environment document ID"
  echo "  export O2_ENV_NAME=\"master\"      # optional: environment name (resolved to ID)"
  echo ""
  echo "  export CF_CDA_TOKEN=\"your-contentful-cda-token\""
  echo "  export CF_SPACE_ID=\"your-contentful-space-id\""
  echo "  export CF_ENV_ID=\"master\"        # optional, defaults to master"
  echo "  $0"
  echo ""
  echo "Note: O2 uses document IDs for environments. The script resolves the name automatically."
  exit 1
fi

echo -e "${CYAN}Running O2 CMS vs Contentful Compatibility Test...${NC}"
echo ""

# Run the Node.js test
node "$SCRIPT_DIR/test-o2-contentful-compatibility.js"
exit $?

