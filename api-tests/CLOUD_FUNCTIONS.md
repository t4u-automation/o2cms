# API Testing - Cloud Functions

Test the O2 Content Management API hosted on Cloud Functions.

## Your API Key
```
o2_cma_092d2da745627e47b6c30fe29a51cf68
```

## API Base URL

**Local Emulator:**
```
http://localhost:5001/t4u-cms/us-central1/api
```

**Production:**
```
https://us-central1-t4u-cms.cloudfunctions.net/api
```

## Quick Test

### Test Locally (with emulator):
```bash
firebase emulators:start --only functions
```

Then in another terminal:
```bash
curl -H "Authorization: Bearer o2_cma_092d2da745627e47b6c30fe29a51cf68" \
     http://localhost:5001/t4u-cms/us-central1/api/v1/spaces
```

### Test Production:
```bash
curl -H "Authorization: Bearer o2_cma_092d2da745627e47b6c30fe29a51cf68" \
     https://us-central1-t4u-cms.cloudfunctions.net/api/v1/spaces
```

## Available Endpoints

### Health Check
```bash
curl https://us-central1-t4u-cms.cloudfunctions.net/api/health
```

### List Spaces (Projects)
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
     https://us-central1-t4u-cms.cloudfunctions.net/api/v1/spaces
```

### Get Specific Space
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
     https://us-central1-t4u-cms.cloudfunctions.net/api/v1/spaces/PROJECT_ID
```

## Deploy to Production

```bash
cd functions
npm run build
firebase deploy --only functions:api
```

The API will be available at:
```
https://us-central1-t4u-cms.cloudfunctions.net/api
```

## Architecture Benefits

✅ **Auto-scaling** - Handles any traffic load  
✅ **Independent deployment** - Deploy API without touching UI  
✅ **Global distribution** - Fast worldwide  
✅ **Cost-effective** - Pay per use  
✅ **Built-in monitoring** - Firebase Console logs  

## Next Steps

Once deployed, update your applications to use:
```
https://us-central1-t4u-cms.cloudfunctions.net/api/v1/
```

Instead of:
```
http://localhost:3000/api/v1/
```

