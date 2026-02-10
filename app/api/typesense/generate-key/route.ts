import { NextRequest, NextResponse } from 'next/server';
import Typesense from 'typesense';

// Initialize Typesense client with admin key
const client = new Typesense.Client({
  nodes: [{
    host: process.env.TYPESENSE_HOST || '',
    port: Number(process.env.TYPESENSE_PORT) || 443,
    protocol: process.env.TYPESENSE_PROTOCOL || 'https',
  }],
  apiKey: process.env.TYPESENSE_ADMIN_API_KEY || '',
  connectionTimeoutSeconds: 2,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId } = body;

    // Validate required parameters
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Missing required parameter: tenantId' },
        { status: 400 }
      );
    }

    // Optional: Add authentication check here
    // Verify that the requesting user actually belongs to this tenant
    // You can get this from session/JWT/Firebase Auth

    // Build the embedded filter - this ensures the key can ONLY search this tenant's data
    const embeddedFilter = `tenant_id:=${tenantId}`;

    // Generate a scoped API key that expires in 24 hours
    const expiresAt = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hours from now

    const scopedSearchKey = client.keys().generateScopedSearchKey(
      process.env.TYPESENSE_SEARCH_API_KEY || process.env.TYPESENSE_ADMIN_API_KEY || '', 
      {
        filter_by: embeddedFilter,
        expires_at: expiresAt,
      }
    );

    return NextResponse.json({
      key: scopedSearchKey,
      expiresAt,
      filters: {
        tenantId,
      },
    });
  } catch (error: any) {
    console.error('[generate-key] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate key' },
      { status: 500 }
    );
  }
}

