"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import Typesense from 'typesense';

interface TypesenseContextType {
  search: (params: SearchParams) => Promise<any>;
  searchAssets: (params: AssetSearchParams) => Promise<any>;
  isReady: boolean;
  loading: boolean;
  error: string | null;
  refreshKey: () => Promise<void>;
}

interface SearchParams {
  query: string;
  projectId: string;
  environmentId: string;
  contentTypeId?: string;
  status?: string;
}

interface AssetSearchParams {
  query: string;
  projectId: string;
  environmentId?: string; // Filter by environment
  contentType?: string; // Filter by MIME type
}

interface TypesenseProviderProps {
  children: ReactNode;
  tenantId: string;
}

const TypesenseContext = createContext<TypesenseContextType | undefined>(undefined);

export function TypesenseProvider({ children, tenantId }: TypesenseProviderProps) {
  const [searchKey, setSearchKey] = useState<string | null>(null);
  const [keyExpiresAt, setKeyExpiresAt] = useState<number | null>(null);
  const [client, setClient] = useState<Typesense.Client | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate or refresh the scoped search key
  const generateKey = useCallback(async () => {
    if (!tenantId) {
      console.warn('Missing tenantId for Typesense key generation');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/typesense/generate-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate search key');
      }

      const data = await response.json();
      setSearchKey(data.key);
      setKeyExpiresAt(data.expiresAt);

      // Initialize Typesense client with the scoped key
      const typesenseClient = new Typesense.Client({
        nodes: [{
          host: process.env.NEXT_PUBLIC_TYPESENSE_HOST || '',
          port: Number(process.env.NEXT_PUBLIC_TYPESENSE_PORT) || 443,
          protocol: process.env.NEXT_PUBLIC_TYPESENSE_PROTOCOL || 'https',
        }],
        apiKey: data.key,
        connectionTimeoutSeconds: 2,
      });

      setClient(typesenseClient);
    } catch (err: any) {
      console.error('❌ Error generating search key:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  // Generate key when tenant changes
  useEffect(() => {
    if (tenantId) {
      generateKey();
    }
  }, [tenantId, generateKey]);

  // Auto-refresh key before it expires
  useEffect(() => {
    if (!keyExpiresAt) return;

    const now = Math.floor(Date.now() / 1000);
    const expiresIn = keyExpiresAt - now;
    
    // Refresh 5 minutes (300 seconds) before expiry
    const refreshTime = (expiresIn - 300) * 1000;

    if (refreshTime > 0) {
      const timer = setTimeout(() => {
        generateKey();
      }, refreshTime);

      return () => clearTimeout(timer);
    } else if (expiresIn <= 0) {
      // Key already expired, refresh immediately
      console.warn('⚠️ Typesense key expired, refreshing...');
      generateKey();
    }
  }, [keyExpiresAt, generateKey]);

  // Search entries function
  const search = useCallback(async ({ query, projectId, environmentId, contentTypeId, status }: SearchParams) => {
    if (!client) {
      throw new Error('Typesense client not initialized');
    }

    const filters: string[] = [];
    
    // Note: tenant_id is already embedded in the scoped key - user can't bypass it!
    // project_id and environment_id are added as query filters for flexibility
    
    filters.push(`project_id:=${projectId}`);
    filters.push(`environment_id:=${environmentId}`);

    if (contentTypeId) {
      filters.push(`content_type_id:=${contentTypeId}`);
    }

    if (status && status !== 'all') {
      filters.push(`status:=${status}`);
    }

    const searchParameters: any = {
      q: query || '*',
      query_by: 'title',
      sort_by: 'updated_at:desc',
      per_page: 250,
    };

    if (filters.length > 0) {
      searchParameters.filter_by = filters.join(' && ');
    }

    try {
      const results = await client
        .collections('entries')
        .documents()
        .search(searchParameters);

      return results;
    } catch (err: any) {
      console.error('❌ Typesense search error:', err);
      throw err;
    }
  }, [client]);

  // Search assets function
  const searchAssets = useCallback(async ({ query, projectId, environmentId, contentType }: AssetSearchParams) => {
    if (!client) {
      throw new Error('Typesense client not initialized');
    }

    const filters: string[] = [];
    
    // Note: tenant_id is already embedded in the scoped key
    filters.push(`project_id:=${projectId}`);
    
    if (environmentId) {
      filters.push(`environment_id:=${environmentId}`);
    }

    if (contentType) {
      filters.push(`content_type:${contentType}*`);
    }

    const searchParameters: any = {
      q: query || '*',
      query_by: 'title,file_name',
      sort_by: 'updated_at:desc',
      per_page: 250,
    };

    if (filters.length > 0) {
      searchParameters.filter_by = filters.join(' && ');
    }

    try {
      const results = await client
        .collections('assets')
        .documents()
        .search(searchParameters);

      return results;
    } catch (err: any) {
      console.error('❌ Typesense assets search error:', err);
      throw err;
    }
  }, [client]);

  const value: TypesenseContextType = {
    search,
    searchAssets,
    isReady: !!client && !loading,
    loading,
    error,
    refreshKey: generateKey,
  };

  return (
    <TypesenseContext.Provider value={value}>
      {children}
    </TypesenseContext.Provider>
  );
}

export function useTypesense() {
  const context = useContext(TypesenseContext);
  if (context === undefined) {
    throw new Error('useTypesense must be used within a TypesenseProvider');
  }
  return context;
}

