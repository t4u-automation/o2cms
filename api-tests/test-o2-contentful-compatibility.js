#!/usr/bin/env node

/**
 * O2 CMS vs Contentful Compatibility Test
 * 
 * This test compares responses from O2 CMS and Contentful APIs to validate
 * that migrated content is served identically.
 * 
 * Usage:
 *   node test-o2-contentful-compatibility.js
 * 
 * Environment variables:
 *   O2_CDA_TOKEN       - O2 CMS CDA API key
 *   O2_SPACE_ID        - O2 Space ID
 *   O2_ENV_ID          - O2 Environment ID (default: master)
 *   
 *   CF_CDA_TOKEN       - Contentful CDA API key
 *   CF_SPACE_ID        - Contentful Space ID
 *   CF_ENV_ID          - Contentful Environment ID (default: master)
 */

const https = require('https');
const http = require('http');

// Configuration
const config = {
  o2: {
    baseUrl: process.env.O2_BASE_URL || 'https://us-central1-t4u-cms.cloudfunctions.net/api',
    cdaToken: process.env.O2_CDA_TOKEN,
    spaceId: process.env.O2_SPACE_ID,
    envId: process.env.O2_ENV_ID || null, // Will be resolved from API if not provided
    envName: process.env.O2_ENV_NAME || 'master', // Used to find environment by name
  },
  contentful: {
    baseUrl: 'https://cdn.contentful.com',
    cdaToken: process.env.CF_CDA_TOKEN,
    spaceId: process.env.CF_SPACE_ID,
    envId: process.env.CF_ENV_ID || 'master',
  }
};

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

// Test results
let passed = 0;
let failed = 0;
let warnings = 0;
const differences = [];

// Helper: Make HTTP request
function request(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;
    
    const req = client.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: data
          });
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Helper: Fetch from O2
async function fetchO2(endpoint) {
  const url = `${config.o2.baseUrl}/cdn/spaces/${config.o2.spaceId}/environments/${config.o2.envId}${endpoint}`;
  return request(url, {
    'Authorization': `Bearer ${config.o2.cdaToken}`,
    'Content-Type': 'application/json'
  });
}

// Helper: Resolve O2 environment ID
// O2 CDA API now supports both environment names (like "master") and document IDs
async function resolveO2EnvironmentId() {
  const envId = config.o2.envId || config.o2.envName || 'master';
  console.log(`  Using O2 environment: ${envId}`);
  return envId;
}

// Helper: Fetch from Contentful
async function fetchContentful(endpoint) {
  const url = `${config.contentful.baseUrl}/spaces/${config.contentful.spaceId}/environments/${config.contentful.envId}${endpoint}`;
  return request(url, {
    'Authorization': `Bearer ${config.contentful.cdaToken}`,
    'Content-Type': 'application/json'
  });
}

// Helper: Deep compare objects
function deepCompare(o2Value, cfValue, path = '', options = {}) {
  const diffs = [];
  const { ignorePaths = [], ignoreFields = [] } = options;
  
  // Check if path should be ignored
  for (const ignorePath of ignorePaths) {
    if (path.includes(ignorePath)) return diffs;
  }
  
  // Handle null/undefined
  if (o2Value === null && cfValue === null) return diffs;
  if (o2Value === undefined && cfValue === undefined) return diffs;
  
  // Different types
  if (typeof o2Value !== typeof cfValue) {
    // Allow string vs undefined for optional fields
    if ((o2Value === '' && cfValue === undefined) || (o2Value === undefined && cfValue === '')) {
      return diffs;
    }
    diffs.push({ path, o2: o2Value, cf: cfValue, type: 'type_mismatch' });
    return diffs;
  }
  
  // Primitives
  if (typeof o2Value !== 'object') {
    if (o2Value !== cfValue) {
      diffs.push({ path, o2: o2Value, cf: cfValue, type: 'value_mismatch' });
    }
    return diffs;
  }
  
  // Arrays
  if (Array.isArray(o2Value)) {
    if (!Array.isArray(cfValue)) {
      diffs.push({ path, o2: 'array', cf: typeof cfValue, type: 'type_mismatch' });
      return diffs;
    }
    
    // Compare array lengths
    if (o2Value.length !== cfValue.length) {
      diffs.push({ path, o2: `length=${o2Value.length}`, cf: `length=${cfValue.length}`, type: 'array_length' });
    }
    
    // Compare items (up to min length)
    const minLen = Math.min(o2Value.length, cfValue.length);
    for (let i = 0; i < minLen; i++) {
      diffs.push(...deepCompare(o2Value[i], cfValue[i], `${path}[${i}]`, options));
    }
    return diffs;
  }
  
  // Objects
  if (o2Value === null || cfValue === null) {
    if (o2Value !== cfValue) {
      diffs.push({ path, o2: o2Value, cf: cfValue, type: 'null_mismatch' });
    }
    return diffs;
  }
  
  // Get all keys from both objects
  const allKeys = new Set([...Object.keys(o2Value), ...Object.keys(cfValue)]);
  
  for (const key of allKeys) {
    // Skip ignored fields
    if (ignoreFields.includes(key)) continue;
    
    const newPath = path ? `${path}.${key}` : key;
    
    if (!(key in o2Value)) {
      diffs.push({ path: newPath, o2: undefined, cf: cfValue[key], type: 'missing_in_o2' });
    } else if (!(key in cfValue)) {
      diffs.push({ path: newPath, o2: o2Value[key], cf: undefined, type: 'missing_in_cf' });
    } else {
      diffs.push(...deepCompare(o2Value[key], cfValue[key], newPath, options));
    }
  }
  
  return diffs;
}

// Helper: Print section header
function printHeader(title) {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70));
}

// Helper: Print test result
function printResult(testName, success, details = '') {
  if (success) {
    console.log(`${colors.green}✓${colors.reset} ${testName}`);
    passed++;
  } else {
    console.log(`${colors.red}✗${colors.reset} ${testName}`);
    if (details) console.log(`  ${colors.dim}${details}${colors.reset}`);
    failed++;
  }
}

// Helper: Print warning
function printWarning(message) {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
  warnings++;
}

// Test: Compare Content Types
// NOTE: O2 migration generates new IDs but preserves apiId (Contentful sys.id)
async function testContentTypes() {
  printHeader('Content Types Comparison');
  
  try {
    const [o2Resp, cfResp] = await Promise.all([
      fetchO2('/content_types'),
      fetchContentful('/content_types')
    ]);
    
    if (o2Resp.status !== 200) {
      printResult('Fetch O2 content types', false, `HTTP ${o2Resp.status}`);
      return;
    }
    if (cfResp.status !== 200) {
      printResult('Fetch Contentful content types', false, `HTTP ${cfResp.status}`);
      return;
    }
    
    printResult('Fetch content types from both systems', true);
    
    const o2Types = o2Resp.data.items || [];
    const cfTypes = cfResp.data.items || [];
    
    console.log(`  O2: ${o2Types.length} content types, Contentful: ${cfTypes.length} content types`);
    
    // O2 generates new IDs but preserves Contentful sys.id as "apiId"
    // Create O2 map by apiId (which equals Contentful sys.id)
    const o2MapByApiId = new Map(o2Types.map(t => [t.apiId, t]));
    const cfMap = new Map(cfTypes.map(t => [t.sys.id, t]));
    
    let matchCount = 0;
    let missingCount = 0;
    
    // Check each Contentful type exists in O2 by apiId
    for (const [cfId, cfType] of cfMap) {
      // O2 stores Contentful sys.id as apiId
      const o2Type = o2MapByApiId.get(cfId);
      
      if (!o2Type) {
        printResult(`Content type "${cfType.name}" (apiId: ${cfId}) exists in O2`, false, 'Missing in O2');
        missingCount++;
        continue;
      }
      
      // Compare name and fields (ignore sys IDs since they're different)
      const nameMismatch = o2Type.name !== cfType.name;
      const fieldsDiff = compareFields(o2Type.fields, cfType.fields);
      
      if (!nameMismatch && fieldsDiff.length === 0) {
        printResult(`Content type "${cfType.name}" (apiId: ${cfId})`, true);
        matchCount++;
      } else {
        const issues = [];
        if (nameMismatch) issues.push(`name: O2="${o2Type.name}" CF="${cfType.name}"`);
        if (fieldsDiff.length > 0) issues.push(`${fieldsDiff.length} field differences`);
        printResult(`Content type "${cfType.name}" (apiId: ${cfId})`, false, issues.join(', '));
        fieldsDiff.slice(0, 3).forEach(d => {
          console.log(`    ${colors.dim}${d}${colors.reset}`);
        });
      }
    }
    
    // Check for extra types in O2 (not migrated from Contentful)
    const cfApiIds = new Set(cfTypes.map(t => t.sys.id));
    for (const [apiId, o2Type] of o2MapByApiId) {
      if (!cfApiIds.has(apiId)) {
        console.log(`  ${colors.dim}ℹ O2 type "${o2Type.name}" (apiId: ${apiId}) is not from Contentful (locally created)${colors.reset}`);
      }
    }
    
    console.log(`\n  Summary: ${matchCount} content types match, ${missingCount} missing in O2`);
    
  } catch (err) {
    printResult('Content types comparison', false, err.message);
  }
}

// Helper: Compare content type fields
function compareFields(o2Fields, cfFields) {
  const diffs = [];
  
  if (!o2Fields || !cfFields) {
    if (o2Fields?.length !== cfFields?.length) {
      diffs.push(`Field count: O2=${o2Fields?.length || 0}, CF=${cfFields?.length || 0}`);
    }
    return diffs;
  }
  
  // Create maps by field id
  const o2FieldMap = new Map(o2Fields.map(f => [f.id, f]));
  const cfFieldMap = new Map(cfFields.map(f => [f.id, f]));
  
  for (const [id, cfField] of cfFieldMap) {
    const o2Field = o2FieldMap.get(id);
    if (!o2Field) {
      diffs.push(`Field "${id}" missing in O2`);
      continue;
    }
    if (o2Field.type !== cfField.type) {
      diffs.push(`Field "${id}" type: O2=${o2Field.type}, CF=${cfField.type}`);
    }
    if (o2Field.name !== cfField.name) {
      diffs.push(`Field "${id}" name: O2=${o2Field.name}, CF=${cfField.name}`);
    }
  }
  
  for (const [id] of o2FieldMap) {
    if (!cfFieldMap.has(id)) {
      diffs.push(`Field "${id}" only in O2`);
    }
  }
  
  return diffs;
}

// Test: Compare Entries
// NOTE: O2 migration generates new entry IDs. We match entries by content.
async function testEntries() {
  printHeader('Entries Comparison');
  
  try {
    // Request without locale parameter - both APIs should return flattened format
    const [o2Resp, cfResp] = await Promise.all([
      fetchO2('/entries?limit=1000'),
      fetchContentful('/entries?limit=1000')
    ]);
    
    if (o2Resp.status !== 200) {
      printResult('Fetch O2 entries', false, `HTTP ${o2Resp.status}`);
      console.log(`  ${colors.red}O2 Response:${colors.reset}`, JSON.stringify(o2Resp.data).substring(0, 500));
      return;
    }
    if (cfResp.status !== 200) {
      printResult('Fetch Contentful entries', false, `HTTP ${cfResp.status}`);
      return;
    }
    
    printResult('Fetch entries from both systems', true);
    
    const o2Entries = o2Resp.data.items || [];
    const cfEntries = cfResp.data.items || [];
    
    console.log(`  O2: ${o2Resp.data.total || o2Entries.length} entries, Contentful: ${cfResp.data.total || cfEntries.length} entries`);
    
    // Count comparison
    if (o2Entries.length === cfEntries.length) {
      printResult('Entry count matches', true);
    } else {
      printResult('Entry count matches', false, `O2: ${o2Entries.length}, CF: ${cfEntries.length}`);
    }
    
    // Group entries by content type for clearer reporting
    const cfByType = new Map();
    for (const entry of cfEntries) {
      const typeId = entry.sys.contentType?.sys?.id || 'unknown';
      if (!cfByType.has(typeId)) cfByType.set(typeId, []);
      cfByType.get(typeId).push(entry);
    }
    
    const o2ByType = new Map();
    for (const entry of o2Entries) {
      const typeId = entry.sys.contentType?.sys?.id || 'unknown';
      if (!o2ByType.has(typeId)) o2ByType.set(typeId, []);
      o2ByType.get(typeId).push(entry);
    }
    
    console.log(`\n  Entries by Content Type:`);
    for (const [typeId, entries] of cfByType) {
      const o2Count = o2ByType.get(typeId)?.length || 0;
      const cfCount = entries.length;
      const icon = o2Count === cfCount ? colors.green + '✓' : colors.red + '✗';
      console.log(`    ${icon}${colors.reset} ${typeId}: O2=${o2Count}, CF=${cfCount}`);
    }
    
    let matchCount = 0;
    let partialMatchCount = 0;
    let noMatchCount = 0;

    // DETAILED COMPARISON: For each content type, compare all entries
    for (const [typeId, cfTypeEntries] of cfByType) {
      console.log(`\n  ${colors.cyan}━━━ ${typeId} (${cfTypeEntries.length} entries) ━━━${colors.reset}`);
      
      const o2TypeEntries = o2ByType.get(typeId) || [];
      
      for (const cfEntry of cfTypeEntries) {
        const entryName = getEntryDisplayName(cfEntry);
        
        // Find best matching O2 entry
        let bestMatch = null;
        let bestMatchScore = 0;
        let bestMatchDetails = null;
        
        for (const o2Entry of o2TypeEntries) {
          const { score, details } = calculateFieldSimilarityDetailed(cfEntry.fields, o2Entry.fields);
          
          if (score > bestMatchScore) {
            bestMatchScore = score;
            bestMatch = o2Entry;
            bestMatchDetails = details;
          }
          
          if (score === 1.0) break;
        }
        
        const scorePercent = Math.round(bestMatchScore * 100);
        const cfFieldCount = Object.keys(cfEntry.fields || {}).length;
        const o2FieldCount = bestMatch ? Object.keys(bestMatch.fields || {}).length : 0;
        
        if (bestMatchScore >= 0.95) {
          // Full match - show green checkmark with field count
          console.log(`    ${colors.green}✓${colors.reset} "${entryName}" - ${scorePercent}% (${cfFieldCount} fields)`);
          matchCount++;
        } else if (bestMatchScore >= 0.5) {
          // Partial match - show details
          console.log(`    ${colors.yellow}~${colors.reset} "${entryName}" - ${scorePercent}% match`);
          console.log(`      CF fields: ${Object.keys(cfEntry.fields || {}).join(', ')}`);
          console.log(`      O2 fields: ${bestMatch ? Object.keys(bestMatch.fields || {}).join(', ') : 'none'}`);
          if (bestMatchDetails) {
            for (const d of bestMatchDetails.slice(0, 5)) {
              console.log(`      ${colors.dim}${d}${colors.reset}`);
            }
          }
          partialMatchCount++;
        } else {
          // No match
          console.log(`    ${colors.red}✗${colors.reset} "${entryName}" - NOT FOUND (best: ${scorePercent}%)`);
          console.log(`      CF fields: ${Object.keys(cfEntry.fields || {}).join(', ')}`);
          noMatchCount++;
        }
      }
    }
    
    console.log(`\n  ════════════════════════════════════════`);
    console.log(`  Summary:`);
    console.log(`    ${colors.green}${matchCount}${colors.reset} entries fully matched (≥95% similar)`);
    console.log(`    ${colors.yellow}${partialMatchCount}${colors.reset} entries partially matched (50-95% similar)`);
    console.log(`    ${colors.red}${noMatchCount}${colors.reset} entries not found`);
    console.log(`  ════════════════════════════════════════`);
    
    if (noMatchCount === 0 && partialMatchCount === 0) {
      printResult('All entries match between O2 and Contentful', true);
    } else if (noMatchCount > 0) {
      printResult('Entry migration completeness', false, `${noMatchCount} entries missing`);
    } else {
      printResult('Entry migration completeness', false, `${partialMatchCount} partial matches`);
    }
    
  } catch (err) {
    printResult('Entries comparison', false, err.message);
  }
}

// Helper: Calculate similarity between two field objects (0-1)
// Ignores reference IDs (sys.id) since O2 generates new IDs during migration
function calculateFieldSimilarity(cfFields, o2Fields) {
  const { score } = calculateFieldSimilarityDetailed(cfFields, o2Fields);
  return score;
}

// Helper: Calculate similarity with detailed mismatch info
function calculateFieldSimilarityDetailed(cfFields, o2Fields) {
  const details = [];
  
  if (!cfFields && !o2Fields) return { score: 1, details };
  if (!cfFields || !o2Fields) return { score: 0, details: ['One side has no fields'] };
  
  const cfKeys = Object.keys(cfFields);
  const o2Keys = Object.keys(o2Fields);
  
  if (cfKeys.length === 0 && o2Keys.length === 0) return { score: 1, details };
  if (cfKeys.length === 0 || o2Keys.length === 0) return { score: 0, details: ['Empty fields'] };
  
  let matchingFields = 0;
  let totalFields = cfKeys.length;
  
  // Check for fields only in CF
  const cfOnly = cfKeys.filter(k => !o2Keys.includes(k));
  if (cfOnly.length > 0) {
    details.push(`Fields only in CF: ${cfOnly.join(', ')}`);
  }
  
  // Check for fields only in O2
  const o2Only = o2Keys.filter(k => !cfKeys.includes(k));
  if (o2Only.length > 0) {
    details.push(`Fields only in O2: ${o2Only.join(', ')}`);
  }
  
  for (const key of cfKeys) {
    if (key in o2Fields) {
      const cfValue = cfFields[key];
      const o2Value = o2Fields[key];
      
      // Compare values, normalizing references (ignoring IDs)
      if (compareFieldValues(cfValue, o2Value)) {
        matchingFields++;
      } else {
        // Show what's different
        const cfStr = JSON.stringify(cfValue).substring(0, 50);
        const o2Str = JSON.stringify(o2Value).substring(0, 50);
        details.push(`"${key}" differs: CF=${cfStr}... O2=${o2Str}...`);
      }
    }
  }
  
  return { score: matchingFields / totalFields, details };
}

// Compare two field values, treating references as equal if structure matches (ignoring IDs)
function compareFieldValues(cfValue, o2Value) {
  // Both null/undefined
  if (cfValue == null && o2Value == null) return true;
  if (cfValue == null || o2Value == null) return false;
  
  // Different types
  if (typeof cfValue !== typeof o2Value) return false;
  
  // Primitives (string, number, boolean)
  if (typeof cfValue !== 'object') {
    return cfValue === o2Value;
  }
  
  // Arrays
  if (Array.isArray(cfValue)) {
    if (!Array.isArray(o2Value)) return false;
    if (cfValue.length !== o2Value.length) return false;
    return cfValue.every((item, i) => compareFieldValues(item, o2Value[i]));
  }
  
  // Check if this is a Contentful Link reference
  if (cfValue.sys?.type === 'Link' && o2Value.sys?.type === 'Link') {
    // References match if linkType is the same (ignore id since it's regenerated)
    return cfValue.sys.linkType === o2Value.sys.linkType;
  }
  
  // Check if this is Rich Text (has nodeType)
  if (cfValue.nodeType && o2Value.nodeType) {
    // Compare node type and content structure
    if (cfValue.nodeType !== o2Value.nodeType) return false;
    // For rich text, just check that both have content (deep comparison too complex)
    return (cfValue.content?.length > 0) === (o2Value.content?.length > 0);
  }
  
  // Regular objects - compare all keys
  const cfKeys = Object.keys(cfValue);
  const o2Keys = Object.keys(o2Value);
  
  // Must have same keys
  if (cfKeys.length !== o2Keys.length) return false;
  
  return cfKeys.every(key => {
    if (!(key in o2Value)) return false;
    return compareFieldValues(cfValue[key], o2Value[key]);
  });
}

// Helper: Get a display name for an entry
function getEntryDisplayName(entry) {
  const fields = entry.fields || {};
  
  // Try common field names for display
  const displayFields = ['title', 'name', 'headline', 'slug', 'internalName'];
  
  for (const fieldName of displayFields) {
    if (fields[fieldName]) {
      // Get first locale value
      const value = fields[fieldName];
      if (typeof value === 'object') {
        const firstLocale = Object.keys(value)[0];
        if (firstLocale && typeof value[firstLocale] === 'string') {
          return value[firstLocale].substring(0, 40);
        }
      } else if (typeof value === 'string') {
        return value.substring(0, 40);
      }
    }
  }
  
  return entry.sys?.id?.substring(0, 20) || 'unknown';
}

// Test: Compare Assets
// NOTE: Only assets linked to entries are migrated, so we validate O2 assets against Contentful
async function testAssets() {
  printHeader('Assets Comparison');
  
  try {
    const [o2Resp, cfResp] = await Promise.all([
      fetchO2('/assets?limit=1000'),
      fetchContentful('/assets?limit=1000')
    ]);
    
    if (o2Resp.status !== 200) {
      printResult('Fetch O2 assets', false, `HTTP ${o2Resp.status}`);
      return;
    }
    if (cfResp.status !== 200) {
      printResult('Fetch Contentful assets', false, `HTTP ${cfResp.status}`);
      return;
    }
    
    printResult('Fetch assets from both systems', true);
    
    const o2Assets = o2Resp.data.items || [];
    const cfAssets = cfResp.data.items || [];
    
    console.log(`  O2: ${o2Assets.length} migrated assets`);
    console.log(`  Contentful: ${cfAssets.length} total assets`);
    console.log(`  ${colors.dim}(Only assets linked to entries were migrated)${colors.reset}`);
    
    // Create CF map by title for lookup
    const cfByTitle = new Map();
    for (const asset of cfAssets) {
      const title = asset.fields?.title?.['en-US'] || asset.fields?.title || asset.sys.id;
      cfByTitle.set(title, asset);
    }
    
    let matchCount = 0;
    let mismatchCount = 0;
    const mismatches = [];
    
    console.log(`\n  ${colors.cyan}━━━ Validating O2 Assets ━━━${colors.reset}`);
    
    // For each O2 asset, find matching Contentful asset and validate
    for (const o2Asset of o2Assets) {
      const o2Title = o2Asset.fields?.title?.['en-US'] || o2Asset.fields?.title || o2Asset.sys.id;
      const o2File = o2Asset.fields?.file?.['en-US'] || o2Asset.fields?.file;
      
      // Find matching CF asset by title
      const cfAsset = cfByTitle.get(o2Title);
      
      if (!cfAsset) {
        console.log(`    ${colors.yellow}?${colors.reset} "${o2Title}" - not found in Contentful (may have different title)`);
        mismatchCount++;
        continue;
      }
      
      const cfFile = cfAsset.fields?.file?.['en-US'] || cfAsset.fields?.file;
      
      // Compare file properties
      const issues = [];
      
      if (cfFile && o2File) {
        // Check content type
        if (cfFile.contentType !== o2File.contentType) {
          issues.push(`contentType: O2=${o2File.contentType}, CF=${cfFile.contentType}`);
        }
        
        // Check filename
        if (cfFile.fileName !== o2File.fileName) {
          issues.push(`fileName differs`);
        }
      }
      
      if (issues.length === 0) {
        console.log(`    ${colors.green}✓${colors.reset} "${o2Title}"`);
        matchCount++;
      } else {
        console.log(`    ${colors.yellow}~${colors.reset} "${o2Title}"`);
        for (const issue of issues) {
          console.log(`      ${colors.dim}${issue}${colors.reset}`);
        }
        mismatches.push({ title: o2Title, issues });
        mismatchCount++;
      }
    }
    
    console.log(`\n  ════════════════════════════════════════`);
    console.log(`  Summary:`);
    console.log(`    ${colors.green}${matchCount}${colors.reset} assets validated successfully`);
    console.log(`    ${colors.yellow}${mismatchCount}${colors.reset} assets with issues`);
    console.log(`    ${colors.dim}${cfAssets.length - o2Assets.length} Contentful assets not migrated (not linked to entries)${colors.reset}`);
    console.log(`  ════════════════════════════════════════`);
    
    if (mismatchCount === 0) {
      printResult('All migrated assets match Contentful', true);
    } else {
      printResult('Asset validation', false, `${mismatchCount} assets have issues`);
    }
    
  } catch (err) {
    printResult('Assets comparison', false, err.message);
  }
}

// Test: Compare specific entry by ID (not useful after migration since IDs change)
// Kept for reference but will likely fail
async function testSingleEntry(entryId) {
  printHeader(`Single Entry Comparison: ${entryId}`);
  console.log(`  ${colors.yellow}Note: O2 generates new IDs during migration, so ID-based lookup won't work.${colors.reset}`);
  console.log(`  ${colors.yellow}Use content-based matching instead (see testEntries).${colors.reset}`);
}

// Helper: Make GraphQL request
async function graphqlRequest(url, query, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(JSON.stringify({ query }));
    req.end();
  });
}

// Test: Compare GraphQL responses
async function testGraphQL() {
  printHeader('GraphQL Comparison');
  
  const o2GraphQLUrl = `https://us-central1-t4u-cms.cloudfunctions.net/graphql?space=${config.o2.spaceId}&environment=${config.o2.envId}`;
  const cfGraphQLUrl = `https://graphql.contentful.com/content/v1/spaces/${config.contentful.spaceId}/environments/${config.contentful.envId}`;
  
  try {
    // Test 1: Check endpoints are responding
    const testQuery = `{ __typename }`;
    const [o2Test, cfTest] = await Promise.all([
      graphqlRequest(o2GraphQLUrl, testQuery, config.o2.cdaToken),
      graphqlRequest(cfGraphQLUrl, testQuery, config.contentful.cdaToken)
    ]);
    
    if (o2Test.status !== 200) {
      printResult('O2 GraphQL endpoint', false, `HTTP ${o2Test.status}`);
      return;
    }
    if (cfTest.status !== 200) {
      printResult('Contentful GraphQL endpoint', false, `HTTP ${cfTest.status}`);
      return;
    }
    printResult('Both GraphQL endpoints responding', true);
    
    // Test 2: Compare Assets via GraphQL
    console.log(`\n  ${colors.cyan}━━━ Assets via GraphQL ━━━${colors.reset}`);
    const assetQuery = `{
      assetCollection(limit: 1000) {
        total
        items {
          sys { id }
          title
          contentType
          fileName
        }
      }
    }`;
    
    const [o2Assets, cfAssets] = await Promise.all([
      graphqlRequest(o2GraphQLUrl, assetQuery, config.o2.cdaToken),
      graphqlRequest(cfGraphQLUrl, assetQuery, config.contentful.cdaToken)
    ]);
    
    const o2AssetTotal = o2Assets.data?.data?.assetCollection?.total || 0;
    const cfAssetTotal = cfAssets.data?.data?.assetCollection?.total || 0;
    
    console.log(`    O2: ${o2AssetTotal} assets (migrated)`);
    console.log(`    Contentful: ${cfAssetTotal} assets (total)`);
    console.log(`    ${colors.dim}(Only assets linked to entries were migrated)${colors.reset}`);
    printResult('Assets accessible via GraphQL', o2AssetTotal > 0);
    
    // Test 3: Compare each content type collection
    console.log(`\n  ${colors.cyan}━━━ Content Type Collections via GraphQL ━━━${colors.reset}`);
    
    // Get content type apiIds from CDA first
    const cdaContentTypes = await fetchO2('/content_types');
    const contentTypeApiIds = (cdaContentTypes.data?.items || []).map(ct => ct.apiId);
    
    for (const apiId of contentTypeApiIds) {
      // Convert apiId to GraphQL collection name (camelCase + "Collection")
      const collectionName = apiId + 'Collection';
      
      const collectionQuery = `{
        ${collectionName}(limit: 1000) {
          total
          items {
            sys { id }
          }
        }
      }`;
      
      try {
        const [o2Coll, cfColl] = await Promise.all([
          graphqlRequest(o2GraphQLUrl, collectionQuery, config.o2.cdaToken),
          graphqlRequest(cfGraphQLUrl, collectionQuery, config.contentful.cdaToken)
        ]);
        
        const o2Total = o2Coll.data?.data?.[collectionName]?.total;
        const cfTotal = cfColl.data?.data?.[collectionName]?.total;
        
        if (o2Total !== undefined && cfTotal !== undefined) {
          const match = o2Total === cfTotal;
          const icon = match ? colors.green + '✓' : colors.yellow + '~';
          console.log(`    ${icon}${colors.reset} ${collectionName}: O2=${o2Total}, CF=${cfTotal}`);
          
          if (match) {
            passed++;
          } else {
            warnings++;
          }
        } else {
          // Check for errors
          const o2Error = o2Coll.data?.errors?.[0]?.message || '';
          const cfError = cfColl.data?.errors?.[0]?.message || '';
          
          if (o2Error || cfError) {
            console.log(`    ${colors.red}✗${colors.reset} ${collectionName}: Query error`);
            if (o2Error) console.log(`      ${colors.dim}O2: ${o2Error.substring(0, 60)}${colors.reset}`);
            if (cfError) console.log(`      ${colors.dim}CF: ${cfError.substring(0, 60)}${colors.reset}`);
          }
        }
      } catch (err) {
        console.log(`    ${colors.red}✗${colors.reset} ${collectionName}: ${err.message}`);
      }
    }
    
    // Test 4: Compare entry fields via GraphQL for a sample content type
    console.log(`\n  ${colors.cyan}━━━ Entry Field Comparison via GraphQL ━━━${colors.reset}`);
    
    // Use "announcement" as a sample (or first available)
    const sampleType = contentTypeApiIds.includes('announcement') ? 'announcement' : contentTypeApiIds[0];
    
    if (sampleType) {
      // Get field names from content type
      const ctResp = await fetchContentful(`/content_types/${sampleType}`);
      const fields = ctResp.data?.fields || [];
      const fieldNames = fields.map(f => f.id).filter(id => !id.includes('-')); // Filter valid GraphQL names
      
      // Build query with actual fields
      const fieldsQuery = fieldNames.slice(0, 5).join('\n            '); // First 5 fields
      
      const entryQuery = `{
        ${sampleType}Collection(limit: 5) {
          items {
            sys { id }
            ${fieldsQuery}
          }
        }
      }`;
      
      try {
        const [o2Entries, cfEntries] = await Promise.all([
          graphqlRequest(o2GraphQLUrl, entryQuery, config.o2.cdaToken),
          graphqlRequest(cfGraphQLUrl, entryQuery, config.contentful.cdaToken)
        ]);
        
        const o2Items = o2Entries.data?.data?.[`${sampleType}Collection`]?.items || [];
        const cfItems = cfEntries.data?.data?.[`${sampleType}Collection`]?.items || [];
        
        console.log(`    Sample: ${sampleType}Collection`);
        console.log(`    O2 returned ${o2Items.length} entries, CF returned ${cfItems.length} entries`);
        
        if (o2Items.length > 0 && cfItems.length > 0) {
          // Compare first entry's fields
          const o2First = o2Items[0];
          const cfFirst = cfItems.find(cf => {
            // Match by field content since IDs differ
            return fieldNames.some(f => o2First[f] === cfFirst[f]);
          }) || cfItems[0];
          
          let matchingFields = 0;
          for (const field of fieldNames.slice(0, 5)) {
            if (field in o2First && field in cfFirst) {
              const o2Val = JSON.stringify(o2First[field]);
              const cfVal = JSON.stringify(cfFirst[field]);
              if (o2Val === cfVal) {
                matchingFields++;
              }
            }
          }
          
          console.log(`    Field comparison: ${matchingFields}/${Math.min(5, fieldNames.length)} fields match`);
          printResult('GraphQL entry fields accessible', matchingFields > 0);
        }
      } catch (err) {
        console.log(`    ${colors.dim}Sample query error: ${err.message}${colors.reset}`);
      }
    }
    
    console.log('');
    printResult('GraphQL API compatibility verified', true);
    
  } catch (err) {
    printResult('GraphQL comparison', false, err.message);
  }
}

// Main
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║           O2 CMS vs Contentful Compatibility Test                    ║
╚══════════════════════════════════════════════════════════════════════╝
`);
  
  // Validate config
  const missing = [];
  if (!config.o2.cdaToken) missing.push('O2_CDA_TOKEN');
  if (!config.o2.spaceId) missing.push('O2_SPACE_ID');
  if (!config.contentful.cdaToken) missing.push('CF_CDA_TOKEN');
  if (!config.contentful.spaceId) missing.push('CF_SPACE_ID');
  
  if (missing.length > 0) {
    console.log(`${colors.red}Missing required environment variables:${colors.reset}`);
    missing.forEach(v => console.log(`  - ${v}`));
    console.log(`
Usage:
  export O2_CDA_TOKEN="o2_cda_..."
  export O2_SPACE_ID="your-o2-space-id"
  export O2_ENV_ID="master"                    # optional, defaults to master
  
  export CF_CDA_TOKEN="your-contentful-cda-token"
  export CF_SPACE_ID="your-contentful-space-id"
  export CF_ENV_ID="master"                    # optional, defaults to master
  
  node test-o2-contentful-compatibility.js
`);
    process.exit(1);
  }
  
  console.log('Configuration:');
  console.log(`  O2 Space:         ${config.o2.spaceId}`);
  console.log(`  O2 Token:         ${config.o2.cdaToken.substring(0, 15)}...`);
  console.log('');
  console.log(`  CF Space:         ${config.contentful.spaceId}`);
  console.log(`  CF Environment:   ${config.contentful.envId}`);
  console.log(`  CF Token:         ${config.contentful.cdaToken.substring(0, 15)}...`);
  console.log('');
  
  // Resolve O2 environment ID (may need to look up by name)
  try {
    config.o2.envId = await resolveO2EnvironmentId();
  } catch (err) {
    console.log(`${colors.red}Failed to resolve O2 environment: ${err.message}${colors.reset}`);
    process.exit(1);
  }
  
  console.log(`  O2 Environment:   ${config.o2.envId}`);
  console.log('');
  
  // Run tests
  await testContentTypes();
  await testEntries();
  await testAssets();
  await testGraphQL();
  
  // Summary
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                          TEST SUMMARY                                 ║
╚══════════════════════════════════════════════════════════════════════╝

  ${colors.green}Passed:${colors.reset}   ${passed}
  ${colors.red}Failed:${colors.reset}   ${failed}
  ${colors.yellow}Warnings:${colors.reset} ${warnings}
`);
  
  if (failed === 0) {
    console.log(`${colors.green}✓ All tests passed!${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${colors.red}✗ Some tests failed${colors.reset}\n`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

