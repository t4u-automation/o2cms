import { auth } from "./firebase";

// ============================================
// Token Interceptor
// ============================================

/**
 * Get a fresh Firebase token, refreshing if necessary
 */
async function getFreshToken(): Promise<string | null> {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.warn("[API] No authenticated user found");
      return null;
    }

    // Force refresh the token to ensure it's fresh
    const token = await currentUser.getIdToken(true);
    localStorage.setItem("firebase_token", token);
    console.log("[API] Token refreshed successfully");
    return token;
  } catch (error) {
    console.error("[API] Error refreshing token:", error);
    return null;
  }
}

/**
 * Check if token is expired and refresh if needed
 */
async function getValidToken(): Promise<string | null> {
  try {
    const storedToken = localStorage.getItem("firebase_token");
    
    if (!storedToken) {
      return await getFreshToken();
    }

    // Decode token to check expiration (JWT format: header.payload.signature)
    const parts = storedToken.split('.');
    if (parts.length !== 3) {
      console.warn("[API] Invalid token format, refreshing...");
      return await getFreshToken();
    }

    try {
      // Decode payload
      const payload = JSON.parse(atob(parts[1]));
      const expirationTime = payload.exp * 1000; // Convert to milliseconds
      const currentTime = Date.now();
      const bufferTime = 5 * 60 * 1000; // 5 minute buffer

      // If token expires within 5 minutes, refresh it
      if (currentTime + bufferTime > expirationTime) {
        console.log("[API] Token expiring soon, refreshing...");
        return await getFreshToken();
      }

      return storedToken;
    } catch (decodeError) {
      console.warn("[API] Could not decode token, refreshing...");
      return await getFreshToken();
    }
  } catch (error) {
    console.error("[API] Error validating token:", error);
    return null;
  }
}

/**
 * Make an API request with automatic token refresh on 401
 */
export async function apiCall(
  url: string,
  options: RequestInit & { retryCount?: number } = {}
): Promise<Response> {
  const { retryCount = 0, ...fetchOptions } = options;
  const maxRetries = 2;

  try {
    // Get valid token before making request
    const token = await getValidToken();
    
    const response = await fetch(url, {
      ...fetchOptions,
      headers: {
        ...fetchOptions.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    // If 401 (Unauthorized), try to refresh token and retry
    if (response.status === 401 && retryCount < maxRetries) {
      console.log("[API] Received 401, attempting to refresh token and retry...");
      const newToken = await getFreshToken();
      
      if (newToken) {
        // Retry the request with new token
        return apiCall(url, { ...options, retryCount: retryCount + 1 });
      }
    }

    return response;
  } catch (error) {
    console.error("[API] Request error:", error);
    throw error;
  }
}
