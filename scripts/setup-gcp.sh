#!/bin/bash

# O2 CMS - Google Cloud Setup Script
# This script configures all necessary permissions and APIs for O2 CMS deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  O2 CMS - Google Cloud Setup Script   ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check if project ID is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: Please provide your Google Cloud project ID${NC}"
    echo "Usage: ./setup-gcp.sh YOUR_PROJECT_ID"
    exit 1
fi

PROJECT_ID=$1
echo -e "Project ID: ${YELLOW}$PROJECT_ID${NC}"
echo ""

# Verify gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud CLI is not installed${NC}"
    echo "Please install: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Verify firebase is installed
if ! command -v firebase &> /dev/null; then
    echo -e "${RED}Error: Firebase CLI is not installed${NC}"
    echo "Please install: npm install -g firebase-tools"
    exit 1
fi

# Get project number
echo -e "${YELLOW}Fetching project number...${NC}"
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)' 2>/dev/null)

if [ -z "$PROJECT_NUMBER" ]; then
    echo -e "${RED}Error: Could not fetch project number. Make sure you have access to the project.${NC}"
    exit 1
fi

echo -e "Project Number: ${GREEN}$PROJECT_NUMBER${NC}"
echo ""

# Step 1: Enable APIs
echo -e "${YELLOW}Step 1: Enabling required APIs...${NC}"
apis=(
    "cloudfunctions.googleapis.com"
    "cloudbuild.googleapis.com"
    "artifactregistry.googleapis.com"
    "run.googleapis.com"
    "eventarc.googleapis.com"
    "pubsub.googleapis.com"
    "secretmanager.googleapis.com"
    "identitytoolkit.googleapis.com"
    "firestore.googleapis.com"
    "storage.googleapis.com"
    "firebaseextensions.googleapis.com"
)

for api in "${apis[@]}"; do
    echo -n "  Enabling $api... "
    gcloud services enable $api --project=$PROJECT_ID 2>/dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${YELLOW}(already enabled)${NC}"
done
echo ""

# Step 2: Configure IAM permissions
echo -e "${YELLOW}Step 2: Configuring IAM permissions...${NC}"

# Eventarc Service Agent
echo -n "  Granting Eventarc Service Agent role... "
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-eventarc.iam.gserviceaccount.com" \
    --role="roles/eventarc.serviceAgent" \
    --quiet 2>/dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${YELLOW}(may already exist)${NC}"

# Pub/Sub publisher for Eventarc
echo -n "  Granting Pub/Sub publisher role to Eventarc... "
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-eventarc.iam.gserviceaccount.com" \
    --role="roles/pubsub.publisher" \
    --quiet 2>/dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${YELLOW}(may already exist)${NC}"

# Token creator for Pub/Sub
echo -n "  Granting Token Creator to Pub/Sub service agent... "
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
    --role="roles/iam.serviceAccountTokenCreator" \
    --quiet 2>/dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${YELLOW}(may already exist)${NC}"

# Token creator for Compute service account
echo -n "  Granting Token Creator to Compute service account... "
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/iam.serviceAccountTokenCreator" \
    --quiet 2>/dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${YELLOW}(may already exist)${NC}"

# Token creator for App Engine service account
echo -n "  Granting Token Creator to App Engine service account... "
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com" \
    --role="roles/iam.serviceAccountTokenCreator" \
    --quiet 2>/dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${YELLOW}(may already exist)${NC}"

# Run invoker for Compute service account
echo -n "  Granting Run Invoker to Compute service account... "
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/run.invoker" \
    --quiet 2>/dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${YELLOW}(may already exist)${NC}"

# Event Receiver for Compute service account
echo -n "  Granting Event Receiver to Compute service account... "
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/eventarc.eventReceiver" \
    --quiet 2>/dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${YELLOW}(may already exist)${NC}"

echo ""

# Step 3: Create placeholder secrets (optional)
echo -e "${YELLOW}Step 3: Creating placeholder secrets...${NC}"
echo -e "${YELLOW}Note: You should update these with real values before using the features.${NC}"

secrets=(
    "SENDGRID_API_KEY:placeholder_sendgrid_key"
    "TYPESENSE_HOST:placeholder_typesense_host"
    "TYPESENSE_ADMIN_API_KEY:placeholder_typesense_key"
)

for secret_pair in "${secrets[@]}"; do
    secret_name="${secret_pair%%:*}"
    secret_value="${secret_pair#*:}"
    
    echo -n "  Creating $secret_name... "
    if gcloud secrets describe $secret_name --project=$PROJECT_ID &>/dev/null; then
        echo -e "${YELLOW}(already exists)${NC}"
    else
        echo -n "$secret_value" | gcloud secrets create $secret_name \
            --data-file=- \
            --project=$PROJECT_ID 2>/dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
    fi
done

# Grant secret access to compute service account
echo ""
echo -e "${YELLOW}Granting secret access to service accounts...${NC}"
for secret_pair in "${secrets[@]}"; do
    secret_name="${secret_pair%%:*}"
    echo -n "  Granting access to $secret_name... "
    gcloud secrets add-iam-policy-binding $secret_name \
        --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
        --role="roles/secretmanager.secretAccessor" \
        --project=$PROJECT_ID \
        --quiet 2>/dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${YELLOW}(may already exist)${NC}"
done

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Setup Complete!                       ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Next steps:"
echo -e "  1. Update secrets with real values:"
echo -e "     ${YELLOW}echo -n 'your-real-key' | gcloud secrets versions add SENDGRID_API_KEY --data-file=- --project=$PROJECT_ID${NC}"
echo ""
echo -e "  2. Set Firebase project:"
echo -e "     ${YELLOW}firebase use $PROJECT_ID${NC}"
echo ""
echo -e "  3. Deploy the application:"
echo -e "     ${YELLOW}firebase deploy${NC}"
echo ""
echo -e "  4. Wait 2-3 minutes for IAM permissions to propagate before deploying functions."
echo ""



