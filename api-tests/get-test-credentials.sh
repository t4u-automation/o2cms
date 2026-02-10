#!/bin/bash

# Helper script to guide getting test credentials
# This shows you where to find API keys and Space IDs in the CMS

echo "🔑 O2 CMS API - Getting Test Credentials"
echo "═════════════════════════════════════════════"
echo ""

echo "You need 2 things to test the API:"
echo ""

echo "1️⃣  API KEY"
echo "   Location: CMS UI > Settings (top right) > API Keys tab"
echo "   Steps:"
echo "     a) Go to your O2 CMS dashboard"
echo "     b) Click your avatar (top right) → Settings"
echo "     c) Click 'API Keys' tab"
echo "     d) Click 'Generate API Key' button"
echo "     e) Select type: 'CMA' (Content Management API)"
echo "     f) Choose scopes or use defaults"
echo "     g) Click 'Generate'"
echo "     h) COPY THE FULL KEY (shown only once!)"
echo "     i) Format: o2_cma_xxxxxxxxxxxxxxxxxxxxxxxx"
echo ""

echo "2️⃣  SPACE ID (Project ID)"
echo "   Location: Project URL or Projects list"
echo "   Steps:"
echo "     a) Go to your project in O2 CMS"
echo "     b) Look at the URL: https://cms.c4u.dev/projects/YOUR_PROJECT_ID"
echo "     c) Or go to Projects page and click on your project"
echo "     d) The ID appears in the URL or project header"
echo "     e) Format: can be anything (my-project, project123, etc)"
echo ""

echo "═════════════════════════════════════════════"
echo ""

echo "Once you have both, run:"
echo ""
echo "  export API_KEY='o2_cma_your_key_here'"
echo "  export SPACE_ID='your-project-id'"
echo ""

echo "Then test with:"
echo ""
echo "  ./test-environments-api.sh \$API_KEY \$SPACE_ID"
echo ""

echo "Or run the test directly:"
echo ""
echo "  ./test-environments-api.sh o2_cma_xxxx your-project-id"
echo ""

echo "═════════════════════════════════════════════"
echo ""

echo "🔒 Security Notes:"
echo "  • Never commit your API keys to Git"
echo "  • API keys can be revoked in Settings"
echo "  • Each key can be restricted to specific projects"
echo "  • Keep your keys secure like passwords"
echo ""

