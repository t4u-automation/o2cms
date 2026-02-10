/**
 * JavaScript/Node.js API Test Script
 * Tests the O2 CMS Content Management API
 */

const API_KEY = process.env.O2_CMA_API_KEY || '';
const BASE_URL = process.env.O2_API_BASE_URL || 'http://localhost:3000/api/v1';

// Helper function to make API calls
async function apiCall(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const defaultHeaders = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers: defaultHeaders,
  });

  const data = await response.json();

  return {
    status: response.status,
    statusText: response.statusText,
    data,
  };
}

// Test 1: Valid request
async function testValidRequest() {
  console.log('\n✅ Test 1: Valid API Key');
  console.log('GET /spaces with valid Bearer token\n');

  try {
    const result = await apiCall('/spaces', {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
    });

    console.log('Status:', result.status, result.statusText);
    console.log('Response:', JSON.stringify(result.data, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Test 2: Missing Authorization
async function testMissingAuth() {
  console.log('\n❌ Test 2: Missing Authorization Header');
  console.log('GET /spaces without auth\n');

  try {
    const result = await apiCall('/spaces');

    console.log('Status:', result.status, result.statusText);
    console.log('Response:', JSON.stringify(result.data, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Test 3: Invalid API Key
async function testInvalidKey() {
  console.log('\n❌ Test 3: Invalid API Key');
  console.log('GET /spaces with invalid key\n');

  try {
    const result = await apiCall('/spaces', {
      headers: {
        'Authorization': 'Bearer invalid_key_123',
      },
    });

    console.log('Status:', result.status, result.statusText);
    console.log('Response:', JSON.stringify(result.data, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Test 4: Wrong format (no Bearer)
async function testWrongFormat() {
  console.log('\n❌ Test 4: Wrong Authorization Format');
  console.log('GET /spaces without "Bearer" prefix\n');

  try {
    const result = await apiCall('/spaces', {
      headers: {
        'Authorization': API_KEY,
      },
    });

    console.log('Status:', result.status, result.statusText);
    console.log('Response:', JSON.stringify(result.data, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Run all tests
async function runTests() {
  console.log('🧪 Testing O2 CMS Content Management API');
  console.log('======================================');

  await testValidRequest();
  await testMissingAuth();
  await testInvalidKey();
  await testWrongFormat();

  console.log('\n🎉 Tests Complete!\n');
}

// Execute tests
runTests().catch(console.error);

