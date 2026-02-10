#!/usr/bin/env python3
"""
Phase 2: Contentful to O2 CMS Migration Script

Migrates Content Types, Assets, and Entries from Contentful to O2 CMS.

Prerequisites:
    - Run 01_analyze.py first to verify compatibility
    - O2 space must exist (locale will be auto-created after ~10 seconds)

Usage:
    python 02_migrate.py [--skip-content-types] [--skip-assets] [--skip-entries]

Output:
    - migration_state.json - Progress tracking (can resume if interrupted)
    - migration_log.txt - Detailed migration log

Note:
    Rich Text fields are migrated as Contentful-compatible JSON format.
    Embedded asset/entry references within Rich Text are automatically updated.
"""

import os
import sys
import json
import time
import argparse
import requests
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime
from dataclasses import dataclass, field, asdict
import tempfile
import hashlib
import jwt
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

# ============================================
# CONFIGURATION
# ============================================

# Contentful Source Configuration
CONTENTFUL_SPACE_ID = os.getenv("CONTENTFUL_SPACE_ID", "")
CONTENTFUL_CDA_TOKEN = os.getenv("CONTENTFUL_CDA_TOKEN", "")
CONTENTFUL_CMA_TOKEN = os.getenv("CONTENTFUL_CMA_TOKEN", "")
CONTENTFUL_ENVIRONMENT = os.getenv("CONTENTFUL_ENVIRONMENT", "master")
CONTENTFUL_BASE_URL = "https://cdn.contentful.com"
CONTENTFUL_CMA_URL = "https://api.contentful.com"

# O2 CMS Destination Configuration
O2_SPACE_ID = os.getenv("O2_SPACE_ID", "")
O2_CMA_TOKEN = os.getenv("O2_CMA_TOKEN", "")
O2_ENVIRONMENT = os.getenv("O2_ENVIRONMENT", "master")
O2_BASE_URL = os.getenv("O2_BASE_URL", "")

# Migration Settings
RATE_LIMIT_DELAY = 0.05  # seconds between API calls (minimal)
PAGE_SIZE = 100  # items per page for pagination
MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds
SAVE_STATE_EVERY = 25  # Save state every N items (less frequent = faster)
PARALLEL_WORKERS = 10  # Number of parallel asset uploads (increase for speed)

# ============================================
# EMBARGOED ASSETS SIGNING
# ============================================

class EmbargoedAssetSigner:
    """Signs embargoed asset URLs for Contentful secure CDN using JWT"""
    
    TOKEN_LIFETIME = 15 * 60  # 15 minutes in seconds
    
    def __init__(self, space_id: str, environment: str, cma_token: str):
        self.space_id = space_id
        self.environment = environment
        self.cma_token = cma_token
        self.asset_key = None
        self.asset_key_expires = None
    
    def get_or_create_asset_key(self) -> Dict:
        """Get cached asset key or create a new one via CMA API"""
        
        # Check if we have a valid cached key
        if self.asset_key and self.asset_key_expires:
            if datetime.now().timestamp() < self.asset_key_expires - 300:  # 5 min buffer
                return self.asset_key
        
        # Create new asset key via CMA
        url = f"{CONTENTFUL_CMA_URL}/spaces/{self.space_id}/environments/{self.environment}/asset_keys"
        headers = {
            "Authorization": f"Bearer {self.cma_token}",
            "Content-Type": "application/json"
        }
        
        # Request a key valid for 48 hours (maximum)
        expires_at = int(datetime.now().timestamp()) + (48 * 60 * 60)
        
        response = requests.post(
            url, 
            headers=headers,
            json={"expiresAt": expires_at},
            timeout=30
        )
        
        if response.status_code not in [200, 201]:
            raise Exception(f"Failed to create asset key: {response.status_code} - {response.text}")
        
        key_data = response.json()
        self.asset_key = {
            "secret": key_data.get("secret"),
            "policy": key_data.get("policy")
        }
        self.asset_key_expires = expires_at
        
        return self.asset_key
    
    def sign_url(self, url: str) -> str:
        """Sign an embargoed asset URL using JWT"""
        
        # Only sign secure.ctfassets.net URLs
        if "secure.ctfassets.net" not in url:
            return url
        
        # Ensure URL has https protocol
        if url.startswith("//"):
            url = "https:" + url
        
        # Get or create asset key
        key = self.get_or_create_asset_key()
        secret = key["secret"]
        policy = key["policy"]
        
        # Create JWT token with the FULL URL as subject
        # Secret is used as UTF-8 string (not base64 decoded)
        exp = int(datetime.now().timestamp()) + self.TOKEN_LIFETIME
        
        token = jwt.encode(
            {"sub": url, "exp": exp},
            secret.encode("utf-8"),
            algorithm="HS256"
        )
        
        # Build the signed URL
        signed_url = f"{url}?token={token}&policy={policy}"
        
        return signed_url

# ============================================
# COLOR OUTPUT
# ============================================

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    MAGENTA = '\033[95m'
    RESET = '\033[0m'
    BOLD = '\033[1m'
    DIM = '\033[2m'

def print_header(text: str):
    print(f"\n{Colors.BLUE}{'='*70}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}  {text}{Colors.RESET}")
    print(f"{Colors.BLUE}{'='*70}{Colors.RESET}\n")

def print_subheader(text: str):
    print(f"\n{Colors.CYAN}── {text} ──{Colors.RESET}\n")

def print_success(text: str):
    print(f"  {Colors.GREEN}✓{Colors.RESET} {text}")

def print_error(text: str):
    print(f"  {Colors.RED}✗{Colors.RESET} {text}")

def print_warning(text: str):
    print(f"  {Colors.YELLOW}⚠{Colors.RESET} {text}")

def print_info(text: str):
    print(f"  {Colors.CYAN}ℹ{Colors.RESET} {text}")

def print_progress(current: int, total: int, item_name: str):
    percentage = (current / total) * 100 if total > 0 else 0
    bar_len = 30
    filled = int(bar_len * current / total) if total > 0 else 0
    bar = '█' * filled + '░' * (bar_len - filled)
    print(f"\r  [{bar}] {current}/{total} ({percentage:.1f}%) {item_name[:40]:<40}", end='', flush=True)

# ============================================
# LOGGING
# ============================================

class MigrationLogger:
    def __init__(self, filepath: str = "migration_log.txt"):
        self.filepath = filepath
        self.file = open(filepath, 'a')
        self.log(f"\n{'='*60}")
        self.log(f"Migration started at {datetime.now().isoformat()}")
        self.log(f"{'='*60}")
    
    def log(self, message: str):
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.file.write(f"[{timestamp}] {message}\n")
        self.file.flush()
    
    def close(self):
        self.log(f"Migration ended at {datetime.now().isoformat()}")
        self.file.close()

# ============================================
# MIGRATION STATE
# ============================================

@dataclass
class MigrationState:
    """Track migration progress and ID mappings"""
    
    # ID mappings: old_id -> new_id
    content_type_map: Dict[str, str] = field(default_factory=dict)
    asset_map: Dict[str, str] = field(default_factory=dict)
    entry_map: Dict[str, str] = field(default_factory=dict)
    
    # Track what's been migrated
    migrated_content_types: List[str] = field(default_factory=list)
    migrated_assets: List[str] = field(default_factory=list)
    migrated_entries: List[str] = field(default_factory=list)
    
    # Stats
    stats: Dict[str, Dict[str, int]] = field(default_factory=lambda: {
        "content_types": {"total": 0, "migrated": 0, "skipped": 0, "failed": 0},
        "assets": {"total": 0, "migrated": 0, "skipped": 0, "failed": 0},
        "entries": {"total": 0, "migrated": 0, "skipped": 0, "failed": 0},
    })
    
    # Failed items for retry
    failed_assets: List[str] = field(default_factory=list)
    failed_entries: List[str] = field(default_factory=list)
    
    def save(self, filepath: str = "migration_state.json"):
        with open(filepath, 'w') as f:
            json.dump(asdict(self), f, indent=2)
    
    @classmethod
    def load(cls, filepath: str = "migration_state.json") -> 'MigrationState':
        if not os.path.exists(filepath):
            return cls()
        
        with open(filepath, 'r') as f:
            data = json.load(f)
        
        state = cls()
        state.content_type_map = data.get("content_type_map", {})
        state.asset_map = data.get("asset_map", {})
        state.entry_map = data.get("entry_map", {})
        state.migrated_content_types = data.get("migrated_content_types", [])
        state.migrated_assets = data.get("migrated_assets", [])
        state.migrated_entries = data.get("migrated_entries", [])
        state.stats = data.get("stats", state.stats)
        state.failed_assets = data.get("failed_assets", [])
        state.failed_entries = data.get("failed_entries", [])
        
        return state

# ============================================
# CONTENTFUL CLIENT
# ============================================

class ContentfulClient:
    """Client for Contentful CDA"""
    
    def __init__(self, space_id: str, token: str, environment: str):
        self.space_id = space_id
        self.token = token
        self.environment = environment
        self.base_url = f"{CONTENTFUL_BASE_URL}/spaces/{space_id}/environments/{environment}"
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
    
    def _request(self, endpoint: str, params: Dict = None) -> Dict:
        url = f"{self.base_url}{endpoint}"
        
        for attempt in range(MAX_RETRIES):
            try:
                response = requests.get(url, headers=self.headers, params=params, timeout=30)
                
                if response.status_code == 429:
                    retry_after = int(response.headers.get('X-Contentful-RateLimit-Reset', RETRY_DELAY))
                    time.sleep(retry_after)
                    continue
                
                response.raise_for_status()
                return response.json()
                
            except requests.exceptions.RequestException as e:
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY)
                else:
                    raise
        
        return {}
    
    def get_content_types(self) -> List[Dict]:
        result = self._request("/content_types", {"limit": 1000})
        return result.get("items", [])
    
    def get_assets(self, skip: int = 0, limit: int = PAGE_SIZE) -> Tuple[List[Dict], int]:
        result = self._request("/assets", {"skip": skip, "limit": limit})
        return result.get("items", []), result.get("total", 0)
    
    def get_all_assets(self) -> List[Dict]:
        all_assets = []
        skip = 0
        total = None
        
        while total is None or skip < total:
            assets, total = self.get_assets(skip=skip, limit=PAGE_SIZE)
            all_assets.extend(assets)
            skip += PAGE_SIZE
            time.sleep(RATE_LIMIT_DELAY)
        
        return all_assets
    
    def get_entries(self, skip: int = 0, limit: int = PAGE_SIZE) -> Tuple[List[Dict], int]:
        result = self._request("/entries", {"skip": skip, "limit": limit})
        return result.get("items", []), result.get("total", 0)
    
    def get_all_entries(self) -> List[Dict]:
        all_entries = []
        skip = 0
        total = None
        
        while total is None or skip < total:
            entries, total = self.get_entries(skip=skip, limit=PAGE_SIZE)
            all_entries.extend(entries)
            skip += PAGE_SIZE
            time.sleep(RATE_LIMIT_DELAY)
        
        return all_entries

# ============================================
# O2 CLIENT
# ============================================

class O2Client:
    """Client for O2 CMS CMA"""
    
    def __init__(self, space_id: str, token: str, environment_name: str):
        self.space_id = space_id
        self.token = token
        self.environment_name = environment_name  # The name (e.g., "master")
        self.environment_id = None  # Will be resolved from API
        self.base_url = O2_BASE_URL
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
    
    def resolve_environment_id(self) -> bool:
        """Fetch the actual environment ID from the API based on environment name"""
        endpoint = f"/v1/spaces/{self.space_id}/environments"
        result, status = self._request("GET", endpoint)
        
        if status != 200:
            return False
        
        environments = result.get("items", [])
        for env in environments:
            # Check if name matches (could be in name field or the ID itself)
            env_name = env.get("name", "")
            env_id = env.get("sys", {}).get("id", "")
            
            if env_name == self.environment_name or env_id == self.environment_name:
                self.environment_id = env_id
                return True
        
        # If no match found, try using the name as the ID directly
        self.environment_id = self.environment_name
        return True
    
    def _request(self, method: str, endpoint: str, data: Dict = None, 
                 headers: Dict = None, files: Dict = None) -> Tuple[Dict, int]:
        url = f"{self.base_url}{endpoint}"
        request_headers = {**self.headers}
        if headers:
            request_headers.update(headers)
        
        for attempt in range(MAX_RETRIES):
            try:
                if files:
                    upload_headers = {"Authorization": f"Bearer {self.token}"}
                    response = requests.request(
                        method=method,
                        url=url,
                        headers=upload_headers,
                        files=files,
                        timeout=120
                    )
                else:
                    response = requests.request(
                        method=method,
                        url=url,
                        headers=request_headers,
                        json=data,
                        timeout=60
                    )
                
                if response.status_code == 429:
                    time.sleep(RETRY_DELAY)
                    continue
                
                try:
                    return response.json(), response.status_code
                except:
                    return {"error": response.text}, response.status_code
                    
            except requests.exceptions.RequestException as e:
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY)
                else:
                    return {"error": str(e)}, 500
        
        return {}, 500
    
    # Content Types
    def get_content_types(self) -> List[Dict]:
        endpoint = f"/v1/spaces/{self.space_id}/environments/{self.environment_id}/content_types"
        result, _ = self._request("GET", endpoint)
        return result.get("items", [])
    
    def create_content_type(self, data: Dict) -> Tuple[Dict, bool]:
        endpoint = f"/v1/spaces/{self.space_id}/environments/{self.environment_id}/content_types"
        result, status = self._request("POST", endpoint, data)
        return result, status == 201
    
    def publish_content_type(self, ct_id: str) -> bool:
        endpoint = f"/v1/spaces/{self.space_id}/environments/{self.environment_id}/content_types/{ct_id}/published"
        _, status = self._request("PUT", endpoint)
        return status == 200
    
    # Uploads
    def upload_file(self, file_path: str, filename: str) -> Tuple[str, bool]:
        endpoint = f"/v1/spaces/{self.space_id}/uploads"
        
        with open(file_path, 'rb') as f:
            files = {'file': (filename, f)}
            result, status = self._request("POST", endpoint, files=files)
        
        if status == 201:
            return result.get("sys", {}).get("id", ""), True
        return "", False
    
    # Assets
    def create_asset(self, data: Dict) -> Tuple[Dict, bool]:
        endpoint = f"/v1/spaces/{self.space_id}/environments/{self.environment_id}/assets"
        result, status = self._request("POST", endpoint, data)
        return result, status == 201
    
    def publish_asset(self, asset_id: str) -> bool:
        endpoint = f"/v1/spaces/{self.space_id}/environments/{self.environment_id}/assets/{asset_id}/published"
        _, status = self._request("PUT", endpoint)
        return status == 200
    
    # Entries
    def create_entry(self, content_type_id: str, data: Dict) -> Tuple[Dict, bool]:
        endpoint = f"/v1/spaces/{self.space_id}/environments/{self.environment_id}/entries"
        headers = {"X-Content-Type": content_type_id}
        result, status = self._request("POST", endpoint, data, headers=headers)
        return result, status == 201
    
    def publish_entry(self, entry_id: str) -> bool:
        endpoint = f"/v1/spaces/{self.space_id}/environments/{self.environment_id}/entries/{entry_id}/published"
        _, status = self._request("PUT", endpoint)
        return status == 200

# ============================================
# TRANSFORMATION FUNCTIONS
# ============================================

def transform_content_type(cf_ct: Dict) -> Dict:
    """Transform Contentful content type to O2 format"""
    
    ct_id = cf_ct.get("sys", {}).get("id", "")
    name = cf_ct.get("name", ct_id)
    
    fields = []
    for cf_field in cf_ct.get("fields", []):
        field = transform_field(cf_field)
        if field:
            fields.append(field)
    
    return {
        "name": name,
        "apiId": ct_id,  # Use Contentful ID as apiId
        "description": cf_ct.get("description", ""),
        "displayField": cf_ct.get("displayField", ""),
        "fields": fields
    }


def transform_field(cf_field: Dict) -> Dict:
    """Transform a Contentful field definition to O2 format"""
    
    field_type = cf_field.get("type", "Symbol")
    link_type = cf_field.get("linkType", "")
    
    field = {
        "id": cf_field.get("id", ""),
        "name": cf_field.get("name", ""),
        "type": field_type,
        "required": cf_field.get("required", False),
        "localized": cf_field.get("localized", False),
    }
    
    # Handle Link type
    if field_type == "Link":
        field["linkType"] = link_type
    
    # Handle Array type
    if field_type == "Array":
        items = cf_field.get("items", {})
        field["items"] = {
            "type": items.get("type", "Symbol")
        }
        if items.get("linkType"):
            field["items"]["linkType"] = items.get("linkType")
        
        # Copy item validations
        if items.get("validations"):
            field["items"]["validations"] = items.get("validations")
    
    # Copy validations (only supported ones)
    validations = cf_field.get("validations", [])
    if validations:
        supported_validations = []
        for val in validations:
            # Get the validation type (first key)
            val_type = list(val.keys())[0] if val else None
            if val_type in {"size", "range", "regexp", "in", "linkContentType", "linkMimetypeGroup"}:
                supported_validations.append(val)
        
        if supported_validations:
            field["validations"] = supported_validations
    
    return field


def download_asset_file(url: str, filename: str, signer: EmbargoedAssetSigner = None) -> Optional[str]:
    """Download an asset file to a temporary location"""
    try:
        # Contentful URLs might need protocol
        if url.startswith("//"):
            url = "https:" + url
        
        # Sign embargoed URLs
        if "secure.ctfassets.net" in url and signer:
            url = signer.sign_url(url)
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ContentfulMigration/1.0"
        }
        
        for attempt in range(3):
            try:
                response = requests.get(url, timeout=120, stream=True, headers=headers)
                response.raise_for_status()
                break
            except requests.exceptions.SSLError:
                if attempt == 2:
                    response = requests.get(url, timeout=120, stream=True, headers=headers, verify=False)
                    response.raise_for_status()
                else:
                    time.sleep(1)
            except requests.exceptions.RequestException as e:
                if attempt == 2:
                    raise
                time.sleep(1)
        
        # Create temp file with proper extension
        ext = os.path.splitext(filename)[1] or ""
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
        
        for chunk in response.iter_content(chunk_size=8192):
            temp_file.write(chunk)
        
        temp_file.close()
        return temp_file.name
        
    except Exception as e:
        print(f"\n    Download error: {e}")
        return None


def transform_asset_data(cf_asset: Dict, upload_id: str, filename: str, content_type: str = "application/octet-stream") -> Dict:
    """Transform Contentful asset to O2 format"""
    fields = cf_asset.get("fields", {})
    
    # Handle title field (could be string or locale dict)
    title_field = fields.get("title", {})
    if isinstance(title_field, str):
        title_field = {"en-US": title_field}
    
    # Handle description field (could be string or locale dict)
    desc_field = fields.get("description", {})
    if isinstance(desc_field, str):
        desc_field = {"en-US": desc_field}
    
    o2_fields = {
        "title": title_field,
        "description": desc_field
    }
    
    # Create file field with the upload link
    # Use en-US as default locale
    o2_file = {
        "en-US": {
            "uploadFrom": {
                "sys": {
                    "type": "Link",
                    "linkType": "Upload",
                    "id": upload_id
                }
            },
            "fileName": filename,
            "contentType": content_type
        }
    }
    
    o2_fields["file"] = o2_file
    
    return {"fields": o2_fields}


def transform_entry_fields(fields: Dict, state: MigrationState) -> Dict:
    """Transform entry fields, updating asset and entry references"""
    
    transformed = {}
    
    for field_id, locale_values in fields.items():
        if not isinstance(locale_values, dict):
            continue
            
        transformed[field_id] = {}
        
        for locale, value in locale_values.items():
            transformed[field_id][locale] = transform_field_value(value, state)
    
    return transformed


def transform_field_value(value: Any, state: MigrationState) -> Any:
    """
    Transform a field value, updating references.
    
    This handles:
    - Direct Link references (Asset/Entry links)
    - Rich Text content (Contentful JSON format)
      - embedded-asset-block, embedded-entry-block, embedded-entry-inline
      - asset-hyperlink, entry-hyperlink
    - Nested objects and arrays (recursively processed)
    
    Rich Text is preserved as Contentful-compatible JSON, with embedded
    asset/entry IDs remapped to the new O2 IDs.
    """
    
    if value is None:
        return None
    
    # Handle Link references (including those in Rich Text embedded content)
    if isinstance(value, dict):
        sys = value.get("sys", {})
        
        if sys.get("type") == "Link":
            link_type = sys.get("linkType")
            old_id = sys.get("id")
            
            if link_type == "Asset":
                new_id = state.asset_map.get(old_id, old_id)
                return {
                    "sys": {
                        "type": "Link",
                        "linkType": "Asset",
                        "id": new_id
                    }
                }
            elif link_type == "Entry":
                new_id = state.entry_map.get(old_id, old_id)
                return {
                    "sys": {
                        "type": "Link",
                        "linkType": "Entry",
                        "id": new_id
                    }
                }
            else:
                return value
        
        # Recursively transform nested objects
        return {k: transform_field_value(v, state) for k, v in value.items()}
    
    # Handle arrays
    if isinstance(value, list):
        return [transform_field_value(item, state) for item in value]
    
    return value

# ============================================
# MIGRATION FUNCTIONS
# ============================================

def migrate_content_types(cf_client: ContentfulClient, o2_client: O2Client, 
                         state: MigrationState, logger: MigrationLogger) -> bool:
    """Migrate content types from Contentful to O2"""
    
    print_header("PHASE 1: CONTENT TYPES MIGRATION")
    logger.log("Starting content types migration")
    
    # Get existing O2 content types
    existing_cts = o2_client.get_content_types()
    existing_api_ids = {ct.get("apiId") for ct in existing_cts}
    
    # Also create a map of existing IDs
    for ct in existing_cts:
        api_id = ct.get("apiId", "")
        ct_id = ct.get("sys", {}).get("id", "")
        if api_id and ct_id:
            state.content_type_map[api_id] = ct_id
    
    print_info(f"Existing content types in O2: {len(existing_cts)}")
    
    # Get Contentful content types
    cf_content_types = cf_client.get_content_types()
    state.stats["content_types"]["total"] = len(cf_content_types)
    
    print_info(f"Content types to migrate: {len(cf_content_types)}")
    print()
    
    for i, cf_ct in enumerate(cf_content_types):
        old_id = cf_ct.get("sys", {}).get("id", "")
        name = cf_ct.get("name", old_id)
        
        print_progress(i + 1, len(cf_content_types), name)
        
        # Skip if already migrated
        if old_id in state.migrated_content_types:
            state.stats["content_types"]["skipped"] += 1
            continue
        
        # Skip if already exists in O2
        if old_id in existing_api_ids:
            # Find the existing ID
            for ct in existing_cts:
                if ct.get("apiId") == old_id:
                    state.content_type_map[old_id] = ct.get("sys", {}).get("id", old_id)
                    break
            state.migrated_content_types.append(old_id)
            state.stats["content_types"]["skipped"] += 1
            logger.log(f"Skipped content type (exists): {old_id}")
            continue
        
        # Transform and create
        ct_data = transform_content_type(cf_ct)
        result, success = o2_client.create_content_type(ct_data)
        
        if success:
            new_id = result.get("sys", {}).get("id", "")
            state.content_type_map[old_id] = new_id
            state.migrated_content_types.append(old_id)
            logger.log(f"Created content type: {old_id} -> {new_id}")
            
            # Publish content type
            time.sleep(RATE_LIMIT_DELAY)
            if o2_client.publish_content_type(new_id):
                logger.log(f"Published content type: {new_id}")
            else:
                logger.log(f"Failed to publish content type: {new_id}")
            
            state.stats["content_types"]["migrated"] += 1
        else:
            logger.log(f"Failed to create content type {old_id}: {result}")
            state.stats["content_types"]["failed"] += 1
        
        time.sleep(RATE_LIMIT_DELAY)
        
        # Save state periodically
        if (i + 1) % SAVE_STATE_EVERY == 0:
            state.save()
    
    print()  # New line after progress bar
    print_success(f"Content types: {state.stats['content_types']['migrated']} migrated, "
                 f"{state.stats['content_types']['skipped']} skipped, "
                 f"{state.stats['content_types']['failed']} failed")
    
    state.save()
    return state.stats["content_types"]["failed"] == 0


def process_single_asset(
    cf_asset: Dict,
    signer: Optional[EmbargoedAssetSigner],
    o2_client: O2Client,
    logger: MigrationLogger,
    state_lock: threading.Lock
) -> Tuple[str, Optional[str], str]:
    """
    Process a single asset: download, upload, create, publish.
    Returns: (old_id, new_id or None, status: 'migrated'|'skipped'|'failed')
    """
    old_id = cf_asset.get("sys", {}).get("id", "")
    fields = cf_asset.get("fields", {})
    
    # Get file info (handle various formats from Contentful)
    file_field = fields.get("file", {})
    if not file_field:
        logger.log(f"Skipped asset (no file): {old_id}")
        return (old_id, None, "skipped")
    
    # Handle different formats: could be locale dict or direct file info
    if isinstance(file_field, dict):
        first_key = list(file_field.keys())[0] if file_field else None
        if first_key and isinstance(file_field.get(first_key), dict):
            file_info = file_field[first_key]
        elif "url" in file_field:
            file_info = file_field
        else:
            file_info = list(file_field.values())[0] if file_field else {}
    else:
        logger.log(f"Skipped asset (unexpected file format): {old_id}")
        return (old_id, None, "skipped")
    
    # Extract URL, filename, and content type
    if isinstance(file_info, dict):
        file_url = file_info.get("url", "")
        filename = file_info.get("fileName", "file")
        content_type = file_info.get("contentType", "application/octet-stream")
    elif isinstance(file_info, str):
        file_url = file_info
        filename = file_url.split("/")[-1] if "/" in file_url else "file"
        content_type = "application/octet-stream"
    else:
        logger.log(f"Skipped asset (no file info): {old_id}")
        return (old_id, None, "skipped")
    
    if not file_url:
        logger.log(f"Skipped asset (no URL): {old_id}")
        return (old_id, None, "skipped")
    
    temp_path = None
    try:
        # Download the file
        temp_path = download_asset_file(file_url, filename, signer)
        if not temp_path:
            logger.log(f"Failed to download asset: {old_id} ({file_url})")
            return (old_id, None, "failed")
        
        # Upload to O2
        upload_id, upload_success = o2_client.upload_file(temp_path, filename)
        
        if not upload_success:
            logger.log(f"Failed to upload asset: {old_id}")
            return (old_id, None, "failed")
        
        # Create asset
        asset_data = transform_asset_data(cf_asset, upload_id, filename, content_type)
        result, success = o2_client.create_asset(asset_data)
        
        if success:
            new_id = result.get("sys", {}).get("id", "")
            logger.log(f"Created asset: {old_id} -> {new_id}")
            
            # Publish asset (no delay in parallel context)
            if o2_client.publish_asset(new_id):
                logger.log(f"Published asset: {new_id}")
            
            return (old_id, new_id, "migrated")
        else:
            logger.log(f"Failed to create asset {old_id}: {result}")
            return (old_id, None, "failed")
            
    except Exception as e:
        logger.log(f"Error processing asset {old_id}: {e}")
        return (old_id, None, "failed")
    finally:
        # Clean up temp file
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except:
                pass


def migrate_assets(cf_client: ContentfulClient, o2_client: O2Client, 
                  state: MigrationState, logger: MigrationLogger) -> bool:
    """Migrate assets from Contentful to O2 (parallel processing)"""
    
    print_header("PHASE 2: ASSETS MIGRATION (PARALLEL)")
    logger.log(f"Starting assets migration with {PARALLEL_WORKERS} workers")
    
    # Create embargoed asset signer for secure URLs
    signer = None
    if CONTENTFUL_CMA_TOKEN:
        try:
            print_info("Creating embargoed asset signer...")
            signer = EmbargoedAssetSigner(CONTENTFUL_SPACE_ID, CONTENTFUL_ENVIRONMENT, CONTENTFUL_CMA_TOKEN)
            signer.get_or_create_asset_key()
            print_success("Embargoed asset signer ready")
        except Exception as e:
            print_warning(f"Failed to create asset signer: {e}")
            print_warning("Will attempt downloads without signing")
    
    # Get all assets from Contentful
    print_info("Fetching assets from Contentful...")
    cf_assets = cf_client.get_all_assets()
    state.stats["assets"]["total"] = len(cf_assets)
    
    # Filter out already migrated assets
    assets_to_migrate = []
    for cf_asset in cf_assets:
        old_id = cf_asset.get("sys", {}).get("id", "")
        if old_id in state.migrated_assets:
            state.stats["assets"]["skipped"] += 1
        else:
            assets_to_migrate.append(cf_asset)
    
    print_info(f"Total assets: {len(cf_assets)}, To migrate: {len(assets_to_migrate)}, Already done: {state.stats['assets']['skipped']}")
    print()
    
    if not assets_to_migrate:
        print_success("All assets already migrated!")
        return True
    
    # Thread-safe lock for state updates
    state_lock = threading.Lock()
    completed = 0
    
    def update_progress():
        nonlocal completed
        completed += 1
        print_progress(completed, len(assets_to_migrate), f"Processing ({PARALLEL_WORKERS} workers)")
    
    # Process assets in parallel
    with ThreadPoolExecutor(max_workers=PARALLEL_WORKERS) as executor:
        # Submit all tasks
        future_to_asset = {
            executor.submit(
                process_single_asset, 
                cf_asset, 
                signer, 
                o2_client, 
                logger, 
                state_lock
            ): cf_asset 
            for cf_asset in assets_to_migrate
        }
        
        # Process results as they complete
        for future in as_completed(future_to_asset):
            try:
                old_id, new_id, status = future.result()
                
                with state_lock:
                    if status == "migrated":
                        state.asset_map[old_id] = new_id
                        state.migrated_assets.append(old_id)
                        state.stats["assets"]["migrated"] += 1
                    elif status == "skipped":
                        state.stats["assets"]["skipped"] += 1
                    else:  # failed
                        state.failed_assets.append(old_id)
                        state.stats["assets"]["failed"] += 1
                    
                    update_progress()
                    
                    # Save state periodically
                    if completed % SAVE_STATE_EVERY == 0:
                        state.save()
                        
            except Exception as e:
                logger.log(f"Unexpected error in asset processing: {e}")
    
    print()  # New line after progress bar
    print_success(f"Assets: {state.stats['assets']['migrated']} migrated, "
                 f"{state.stats['assets']['skipped']} skipped, "
                 f"{state.stats['assets']['failed']} failed")
    
    state.save()
    return state.stats["assets"]["failed"] == 0


def migrate_entries(cf_client: ContentfulClient, o2_client: O2Client, 
                   state: MigrationState, logger: MigrationLogger) -> bool:
    """Migrate entries from Contentful to O2"""
    
    print_header("PHASE 3: ENTRIES MIGRATION")
    logger.log("Starting entries migration")
    
    # Get all entries from Contentful
    print_info("Fetching entries from Contentful...")
    cf_entries = cf_client.get_all_entries()
    state.stats["entries"]["total"] = len(cf_entries)
    
    print_info(f"Total entries to migrate: {len(cf_entries)}")
    print()
    
    # First pass: create all entries (some references might not exist yet)
    for i, cf_entry in enumerate(cf_entries):
        old_id = cf_entry.get("sys", {}).get("id", "")
        old_ct_id = cf_entry.get("sys", {}).get("contentType", {}).get("sys", {}).get("id", "")
        fields = cf_entry.get("fields", {})
        
        # Get display name (handle both string and locale dict)
        display_name = old_id
        for field_name in ["title", "name", "eventName", "slug"]:
            if field_name in fields:
                field_data = fields[field_name]
                if field_data:
                    if isinstance(field_data, str):
                        display_name = field_data[:40]
                        break
                    elif isinstance(field_data, dict):
                        first_val = list(field_data.values())[0]
                        if first_val:
                            display_name = str(first_val)[:40]
                            break
        
        print_progress(i + 1, len(cf_entries), display_name)
        
        # Skip if already migrated
        if old_id in state.migrated_entries:
            state.stats["entries"]["skipped"] += 1
            continue
        
        # Get the new content type ID
        new_ct_id = state.content_type_map.get(old_ct_id)
        if not new_ct_id:
            logger.log(f"Skipped entry (no content type mapping): {old_id} (ct: {old_ct_id})")
            state.stats["entries"]["failed"] += 1
            state.failed_entries.append(old_id)
            continue
        
        # Transform entry fields (update references)
        transformed_fields = transform_entry_fields(fields, state)
        
        # Create entry
        entry_data = {"fields": transformed_fields}
        result, success = o2_client.create_entry(new_ct_id, entry_data)
        
        if success:
            new_id = result.get("sys", {}).get("id", "")
            state.entry_map[old_id] = new_id
            state.migrated_entries.append(old_id)
            logger.log(f"Created entry: {old_id} -> {new_id}")
            
            # Publish entry
            time.sleep(RATE_LIMIT_DELAY)
            if o2_client.publish_entry(new_id):
                logger.log(f"Published entry: {new_id}")
            
            state.stats["entries"]["migrated"] += 1
        else:
            error_msg = result.get("message", result.get("error", str(result)))
            logger.log(f"Failed to create entry {old_id}: {error_msg}")
            state.failed_entries.append(old_id)
            state.stats["entries"]["failed"] += 1
        
        time.sleep(RATE_LIMIT_DELAY)
        
        # Save state periodically
        if (i + 1) % SAVE_STATE_EVERY == 0:
            state.save()
    
    print()  # New line after progress bar
    print_success(f"Entries: {state.stats['entries']['migrated']} migrated, "
                 f"{state.stats['entries']['skipped']} skipped, "
                 f"{state.stats['entries']['failed']} failed")
    
    state.save()
    return state.stats["entries"]["failed"] == 0

# ============================================
# SUMMARY
# ============================================

def print_summary(state: MigrationState):
    """Print migration summary"""
    
    print_header("MIGRATION SUMMARY")
    
    print(f"\n{Colors.BOLD}Content Types:{Colors.RESET}")
    print(f"  Total:    {state.stats['content_types']['total']}")
    print(f"  Migrated: {Colors.GREEN}{state.stats['content_types']['migrated']}{Colors.RESET}")
    print(f"  Skipped:  {Colors.YELLOW}{state.stats['content_types']['skipped']}{Colors.RESET}")
    print(f"  Failed:   {Colors.RED}{state.stats['content_types']['failed']}{Colors.RESET}")
    
    print(f"\n{Colors.BOLD}Assets:{Colors.RESET}")
    print(f"  Total:    {state.stats['assets']['total']}")
    print(f"  Migrated: {Colors.GREEN}{state.stats['assets']['migrated']}{Colors.RESET}")
    print(f"  Skipped:  {Colors.YELLOW}{state.stats['assets']['skipped']}{Colors.RESET}")
    print(f"  Failed:   {Colors.RED}{state.stats['assets']['failed']}{Colors.RESET}")
    
    print(f"\n{Colors.BOLD}Entries:{Colors.RESET}")
    print(f"  Total:    {state.stats['entries']['total']}")
    print(f"  Migrated: {Colors.GREEN}{state.stats['entries']['migrated']}{Colors.RESET}")
    print(f"  Skipped:  {Colors.YELLOW}{state.stats['entries']['skipped']}{Colors.RESET}")
    print(f"  Failed:   {Colors.RED}{state.stats['entries']['failed']}{Colors.RESET}")
    
    total_failed = (state.stats['content_types']['failed'] + 
                   state.stats['assets']['failed'] + 
                   state.stats['entries']['failed'])
    
    if total_failed == 0:
        print(f"\n{Colors.GREEN}{Colors.BOLD}✅ MIGRATION COMPLETED SUCCESSFULLY!{Colors.RESET}")
    else:
        print(f"\n{Colors.YELLOW}{Colors.BOLD}⚠ MIGRATION COMPLETED WITH {total_failed} FAILURES{Colors.RESET}")
        print(f"\nFailed items saved to migration_state.json")
        print(f"Review migration_log.txt for details")

# ============================================
# MAIN
# ============================================

def main():
    parser = argparse.ArgumentParser(description='Migrate content from Contentful to O2 CMS')
    parser.add_argument('--skip-content-types', action='store_true', help='Skip content types migration')
    parser.add_argument('--skip-assets', action='store_true', help='Skip assets migration')
    parser.add_argument('--skip-entries', action='store_true', help='Skip entries migration')
    parser.add_argument('--reset', action='store_true', help='Reset migration state and start fresh')
    args = parser.parse_args()
    
    print(f"\n{Colors.BOLD}{Colors.BLUE}")
    print("╔═══════════════════════════════════════════════════════════════╗")
    print("║     CONTENTFUL → O2 CMS MIGRATION                            ║")
    print("║     Phase 2: Data Migration                                   ║")
    print("╚═══════════════════════════════════════════════════════════════╝")
    print(f"{Colors.RESET}")
    
    print(f"\n{Colors.BOLD}Configuration:{Colors.RESET}")
    print(f"  Contentful Space: {CONTENTFUL_SPACE_ID}")
    print(f"  Contentful Env:   {CONTENTFUL_ENVIRONMENT}")
    print(f"  O2 Space:         {O2_SPACE_ID}")
    print(f"  O2 Env:           {O2_ENVIRONMENT}")
    
    # Initialize or load state
    if args.reset and os.path.exists("migration_state.json"):
        os.remove("migration_state.json")
        print_info("Migration state reset")
    
    state = MigrationState.load()
    
    if state.migrated_content_types or state.migrated_assets or state.migrated_entries:
        print_info(f"\nResuming previous migration:")
        print_info(f"  Content types: {len(state.migrated_content_types)} already migrated")
        print_info(f"  Assets: {len(state.migrated_assets)} already migrated")
        print_info(f"  Entries: {len(state.migrated_entries)} already migrated")
    
    # Initialize clients
    cf_client = ContentfulClient(CONTENTFUL_SPACE_ID, CONTENTFUL_CDA_TOKEN, CONTENTFUL_ENVIRONMENT)
    o2_client = O2Client(O2_SPACE_ID, O2_CMA_TOKEN, O2_ENVIRONMENT)
    
    # Resolve O2 environment ID from API
    print_info("Resolving O2 environment ID...")
    if not o2_client.resolve_environment_id():
        print_error(f"Failed to resolve environment '{O2_ENVIRONMENT}' in O2 space")
        return 1
    
    print_success(f"Environment '{O2_ENVIRONMENT}' resolved to ID: {o2_client.environment_id}")
    
    # Initialize logger
    logger = MigrationLogger()
    
    # Confirm
    print(f"\n{Colors.YELLOW}Ready to start migration.{Colors.RESET}")
    print(f"  Skip content types: {args.skip_content_types}")
    print(f"  Skip assets: {args.skip_assets}")
    print(f"  Skip entries: {args.skip_entries}")
    confirm = input("\nPress ENTER to continue or Ctrl+C to cancel...")
    
    try:
        # Phase 1: Content Types
        if not args.skip_content_types:
            migrate_content_types(cf_client, o2_client, state, logger)
        else:
            print_info("Skipping content types migration")
        
        # Phase 2: Assets
        if not args.skip_assets:
            migrate_assets(cf_client, o2_client, state, logger)
        else:
            print_info("Skipping assets migration")
        
        # Phase 3: Entries
        if not args.skip_entries:
            migrate_entries(cf_client, o2_client, state, logger)
        else:
            print_info("Skipping entries migration")
        
    except KeyboardInterrupt:
        print_warning("\n\nMigration interrupted by user")
        state.save()
        logger.log("Migration interrupted by user")
    except Exception as e:
        print_error(f"\n\nMigration failed: {e}")
        state.save()
        logger.log(f"Migration failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        logger.close()
    
    # Print summary
    print_summary(state)
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

