# O2 CMS Deployment Guide

This guide covers everything needed to deploy O2 CMS to your own Google Cloud/Firebase environment.

## Quick Start

For automated setup, run:

```bash
./scripts/setup-gcp.sh YOUR_PROJECT_ID
```

This script will enable all required APIs, configure IAM permissions, and create placeholder secrets.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v20 or later
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) (`gcloud`)
- [Firebase CLI](https://firebase.google.com/docs/cli) (`firebase-tools`)
- A Google Cloud project with billing enabled

## 1. Initial Setup

### 1.1 Create Firebase Project

```bash
# Login to Firebase
firebase login

# Create a new Firebase project (or use existing)
firebase projects:create YOUR_PROJECT_ID

# Set as default project
firebase use YOUR_PROJECT_ID
```

### 1.2 Enable Required APIs

```bash
export PROJECT_ID="YOUR_PROJECT_ID"

# Enable all required Google Cloud APIs
gcloud services enable cloudfunctions.googleapis.com --project=$PROJECT_ID
gcloud services enable cloudbuild.googleapis.com --project=$PROJECT_ID
gcloud services enable artifactregistry.googleapis.com --project=$PROJECT_ID
gcloud services enable run.googleapis.com --project=$PROJECT_ID
gcloud services enable eventarc.googleapis.com --project=$PROJECT_ID
gcloud services enable pubsub.googleapis.com --project=$PROJECT_ID
gcloud services enable secretmanager.googleapis.com --project=$PROJECT_ID
gcloud services enable identitytoolkit.googleapis.com --project=$PROJECT_ID
gcloud services enable firestore.googleapis.com --project=$PROJECT_ID
gcloud services enable storage.googleapis.com --project=$PROJECT_ID
gcloud services enable firebaseextensions.googleapis.com --project=$PROJECT_ID
```

### 1.3 Initialize Firebase Services

```bash
# Initialize Firestore (choose production mode)
firebase init firestore

# Initialize Storage
firebase init storage

# Initialize Hosting (for frontend)
firebase init hosting
```

## 2. Configure Secrets

O2 CMS uses Google Cloud Secret Manager for sensitive configuration.

### 2.1 Required Secrets

#### SendGrid (for invitation emails)

```bash
# Create SendGrid API key secret
echo -n "YOUR_SENDGRID_API_KEY" | gcloud secrets create SENDGRID_API_KEY \
  --data-file=- \
  --project=$PROJECT_ID
```

> **Note:** SendGrid is optional. If not configured, invitation emails won't be sent but the invitation system will still work.

#### Typesense (for search - optional)

```bash
# Create Typesense secrets
echo -n "your-typesense-host.example.com" | gcloud secrets create TYPESENSE_HOST \
  --data-file=- \
  --project=$PROJECT_ID

echo -n "your-typesense-admin-api-key" | gcloud secrets create TYPESENSE_ADMIN_API_KEY \
  --data-file=- \
  --project=$PROJECT_ID
```

> **Note:** Typesense is optional. If not configured, the search sync functions will skip silently.

### 2.2 Grant Secret Access

```bash
# Get project number
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')

# Grant access to the compute service account (used by v2 functions)
for SECRET in SENDGRID_API_KEY TYPESENSE_HOST TYPESENSE_ADMIN_API_KEY; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" \
    --project=$PROJECT_ID 2>/dev/null || echo "Secret $SECRET may not exist, skipping..."
done
```

## 3. Configure IAM Permissions

### 3.1 Eventarc Permissions (for Firestore triggers)

```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')

# Grant Eventarc Service Agent role
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-eventarc.iam.gserviceaccount.com" \
  --role="roles/eventarc.serviceAgent"

# Grant Pub/Sub publisher role to Eventarc
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-eventarc.iam.gserviceaccount.com" \
  --role="roles/pubsub.publisher"

# Grant token creator to Pub/Sub service agent
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

### 3.2 Storage Permissions (for asset migration)

```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')

# Grant token creator to compute service account (for signed URLs)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"

# Grant token creator to App Engine service account
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

### 3.3 Cloud Run Invoker (for internal function calls)

```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/run.invoker"
```

## 4. Deploy Firestore Indexes

```bash
# Deploy Firestore indexes
firebase deploy --only firestore:indexes
```

## 5. Deploy Firestore Security Rules

```bash
# Deploy security rules
firebase deploy --only firestore:rules
```

## 6. Deploy Storage Security Rules

```bash
# Deploy storage rules
firebase deploy --only storage
```

## 7. Deploy Cloud Functions

### 7.1 Install Dependencies

```bash
cd functions
npm install
cd ..
```

### 7.2 Deploy All Functions

```bash
firebase deploy --only functions
```

### 7.3 Verify Deployment

After deployment, you should see these function URLs:

| Function | URL Pattern |
|----------|-------------|
| `api` | `https://us-central1-PROJECT_ID.cloudfunctions.net/api` |
| `graphql` | `https://us-central1-PROJECT_ID.cloudfunctions.net/graphql` |
| `runMigrationJob` | `https://runmigrationjob-HASH.a.run.app` |

## 8. Deploy Frontend (Next.js)

### 8.1 Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your Firebase configuration:
- Get Firebase config from: Firebase Console → Project Settings → General → Your apps
- Set `NEXT_PUBLIC_API_BASE_URL` to your deployed API URL

### 8.2 Build and Deploy

```bash
# Install dependencies
npm install

# Build the application
npm run build

# Deploy to Firebase Hosting
firebase deploy --only hosting
```

## 9. Post-Deployment Setup

### 9.1 Create First Admin User

1. Go to your deployed app URL
2. Sign up with your email
3. The first user automatically becomes the tenant owner

### 9.2 Configure SendGrid Domain (Optional)

If using SendGrid for emails:

1. Go to [SendGrid Dashboard](https://app.sendgrid.com/)
2. Navigate to Settings → Sender Authentication
3. Authenticate your domain (e.g., `o2cms.com`)
4. The default sender is `no-reply@yourdomain.com`

### 9.3 Initialize Typesense Collections (Optional)

If using Typesense for search, call the initialization functions:

```bash
# Using Firebase callable functions
firebase functions:shell

# In the shell:
initializeTypesenseCollection({})
initializeAssetsCollection({})
```

## 10. Environment Variables Reference

### Functions Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SENDGRID_API_KEY` | No | SendGrid API key for invitation emails |
| `SENDGRID_FROM_EMAIL` | No | Sender email (default: `no-reply@o2cms.com`) |
| `SENDGRID_FROM_NAME` | No | Sender name (default: `O2 CMS`) |
| `APP_BASE_URL` | No | Base URL for invitation links (default: `https://o2cms.com`) |
| `TYPESENSE_HOST` | No | Typesense server hostname |
| `TYPESENSE_PORT` | No | Typesense server port (default: `443`) |
| `TYPESENSE_PROTOCOL` | No | Typesense protocol (default: `https`) |
| `TYPESENSE_ADMIN_API_KEY` | No | Typesense admin API key |

## 11. Troubleshooting

### Functions fail to deploy with "Eventarc Service Agent" error

Run the IAM permissions script from Section 3.1 and wait 2-3 minutes for propagation.

### "Secret not found" error during deployment

Make sure all secrets exist in Secret Manager:

```bash
gcloud secrets list --project=$PROJECT_ID
```

Create any missing secrets or remove them from function configurations.

### Firestore triggers not firing

1. Check that Eventarc API is enabled
2. Verify IAM permissions are set correctly
3. Check Cloud Functions logs for errors:

```bash
gcloud functions logs read --project=$PROJECT_ID
```

### Storage upload fails with permission error

Grant the Service Account Token Creator role as shown in Section 3.2.

## 12. Updating Secrets

To update an existing secret:

```bash
echo -n "new-secret-value" | gcloud secrets versions add SECRET_NAME \
  --data-file=- \
  --project=$PROJECT_ID
```

## 13. Cleanup / Uninstall

To remove all deployed resources:

```bash
# Delete all functions
firebase functions:delete --all-functions

# Delete Firestore data (careful!)
# This cannot be undone
firebase firestore:delete --all-collections

# Delete the Firebase project
firebase projects:delete $PROJECT_ID
```

## Support

For issues and feature requests, please open an issue on GitHub.

