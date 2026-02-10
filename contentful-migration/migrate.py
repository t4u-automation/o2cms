#!/usr/bin/env python3
"""
Contentful to O2 CMS Migration Tool

Interactive migration tool that:
1. Analyzes your Contentful space
2. Lets you select which content types to migrate
3. Lets you choose asset migration strategy (all vs linked only)
4. Migrates selected content with progress tracking

Usage:
    python migrate.py [--ci] [--reset]

Options:
    --ci     Non-interactive mode (migrate everything)
    --reset  Reset migration state and start fresh

Output:
    - migration_state.json - Progress tracking (can resume if interrupted)
    - migration_log.txt - Detailed migration log
"""

import os
import sys
import json
import time
import argparse
import requests
from typing import Dict, List, Any, Optional, Tuple, Set
from datetime import datetime
from dataclasses import dataclass, field, asdict
import tempfile
import jwt
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
RATE_LIMIT_DELAY = 0.1
PAGE_SIZE = 100
MAX_RETRIES = 3
RETRY_DELAY = 2
SAVE_STATE_EVERY = 10
PARALLEL_WORKERS = 5

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
    
    # Destination space
    o2_space_id: str = ""
    o2_space_name: str = ""
    o2_environment_id: str = ""
    
    # User selections
    selected_content_types: List[str] = field(default_factory=list)
    asset_strategy: str = "linked"  # "all" or "linked"
    
    # ID mappings: old_id -> new_id
    content_type_map: Dict[str, str] = field(default_factory=dict)
    asset_map: Dict[str, str] = field(default_factory=dict)
    entry_map: Dict[str, str] = field(default_factory=dict)
    
    # Track what's been migrated
    migrated_content_types: List[str] = field(default_factory=list)
    migrated_assets: List[str] = field(default_factory=list)
    migrated_entries: List[str] = field(default_factory=list)
    
    # Linked assets (discovered during entry analysis)
    linked_asset_ids: List[str] = field(default_factory=list)
    
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
        for key, value in data.items():
            if hasattr(state, key):
                setattr(state, key, value)
        
        return state

# ============================================
# EMBARGOED ASSETS SIGNING
# ============================================

class EmbargoedAssetSigner:
    """Signs embargoed asset URLs for Contentful secure CDN using JWT"""
    
    TOKEN_LIFETIME = 15 * 60
    
    def __init__(self, space_id: str, environment: str, cma_token: str):
        self.space_id = space_id
        self.environment = environment
        self.cma_token = cma_token
        self.asset_key = None
        self.asset_key_expires = None
    
    def get_or_create_asset_key(self) -> Dict:
        if self.asset_key and self.asset_key_expires:
            if datetime.now().timestamp() < self.asset_key_expires - 300:
                return self.asset_key
        
        url = f"{CONTENTFUL_CMA_URL}/spaces/{self.space_id}/environments/{self.environment}/asset_keys"
        headers = {
            "Authorization": f"Bearer {self.cma_token}",
            "Content-Type": "application/json"
        }
        
        expires_at = int(datetime.now().timestamp()) + (48 * 60 * 60)
        
        response = requests.post(url, headers=headers, json={"expiresAt": expires_at}, timeout=30)
        
        if response.status_code not in [200, 201]:
            raise Exception(f"Failed to create asset key: {response.status_code} - {response.text}")
        
        key_data = response.json()
        self.asset_key = {"secret": key_data.get("secret"), "policy": key_data.get("policy")}
        self.asset_key_expires = expires_at
        
        return self.asset_key
    
    def sign_url(self, url: str) -> str:
        if "secure.ctfassets.net" not in url:
            return url
        
        if url.startswith("//"):
            url = "https:" + url
        
        key = self.get_or_create_asset_key()
        exp = int(datetime.now().timestamp()) + self.TOKEN_LIFETIME
        
        token = jwt.encode({"sub": url, "exp": exp}, key["secret"].encode("utf-8"), algorithm="HS256")
        
        return f"{url}?token={token}&policy={key['policy']}"

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
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
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
    
    def get_entries(self, content_type: str = None, skip: int = 0, limit: int = PAGE_SIZE) -> Tuple[List[Dict], int]:
        params = {"skip": skip, "limit": limit}
        if content_type:
            params["content_type"] = content_type
        result = self._request("/entries", params)
        return result.get("items", []), result.get("total", 0)
    
    def get_all_entries(self, content_type: str = None) -> List[Dict]:
        all_entries = []
        skip = 0
        total = None
        
        while total is None or skip < total:
            entries, total = self.get_entries(content_type=content_type, skip=skip, limit=PAGE_SIZE)
            all_entries.extend(entries)
            skip += PAGE_SIZE
            time.sleep(RATE_LIMIT_DELAY)
        
        return all_entries
    
    def get_entries_for_content_types(self, content_type_ids: List[str]) -> List[Dict]:
        """Get all entries for specified content types"""
        all_entries = []
        for ct_id in content_type_ids:
            entries = self.get_all_entries(content_type=ct_id)
            all_entries.extend(entries)
        return all_entries

# ============================================
# O2 CLIENT
# ============================================

class O2Client:
    """Client for O2 CMS CMA"""
    
    def __init__(self, token: str, space_id: str = None, environment_name: str = "master"):
        self.space_id = space_id
        self.token = token
        self.environment_name = environment_name
        self.environment_id = None
        self.base_url = O2_BASE_URL
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    def set_space(self, space_id: str):
        """Set the space ID for subsequent operations"""
        self.space_id = space_id
    
    def get_spaces(self) -> List[Dict]:
        """Get all spaces accessible with this token"""
        endpoint = "/v1/spaces"
        result, status = self._request("GET", endpoint)
        if status == 200:
            return result.get("items", [])
        return []
    
    def create_space(self, name: str, description: str = "") -> Tuple[Dict, bool]:
        """Create a new space"""
        endpoint = "/v1/spaces"
        data = {"name": name}
        if description:
            data["description"] = description
        result, status = self._request("POST", endpoint, data)
        return result, status == 201
    
    def resolve_environment_id(self) -> bool:
        if not self.space_id:
            return False
        
        endpoint = f"/v1/spaces/{self.space_id}/environments"
        result, status = self._request("GET", endpoint)
        
        if status != 200:
            return False
        
        environments = result.get("items", [])
        for env in environments:
            env_name = env.get("name", "")
            env_id = env.get("sys", {}).get("id", "")
            
            if env_name == self.environment_name or env_id == self.environment_name:
                self.environment_id = env_id
                return True
        
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
                    response = requests.request(method=method, url=url, headers=upload_headers, files=files, timeout=120)
                else:
                    response = requests.request(method=method, url=url, headers=request_headers, json=data, timeout=60)
                
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
    
    def upload_file(self, file_path: str, filename: str) -> Tuple[str, bool]:
        endpoint = f"/v1/spaces/{self.space_id}/uploads"
        
        with open(file_path, 'rb') as f:
            files = {'file': (filename, f)}
            result, status = self._request("POST", endpoint, files=files)
        
        if status == 201:
            return result.get("sys", {}).get("id", ""), True
        return "", False
    
    def create_asset(self, data: Dict) -> Tuple[Dict, bool]:
        endpoint = f"/v1/spaces/{self.space_id}/environments/{self.environment_id}/assets"
        result, status = self._request("POST", endpoint, data)
        return result, status == 201
    
    def publish_asset(self, asset_id: str) -> bool:
        endpoint = f"/v1/spaces/{self.space_id}/environments/{self.environment_id}/assets/{asset_id}/published"
        _, status = self._request("PUT", endpoint)
        return status == 200
    
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
# ANALYSIS & SELECTION
# ============================================

def analyze_content_types(cf_client: ContentfulClient) -> List[Dict]:
    """Analyze and return content types with entry counts"""
    print_subheader("Analyzing Content Types")
    
    content_types = cf_client.get_content_types()
    
    results = []
    for ct in content_types:
        ct_id = ct.get("sys", {}).get("id", "")
        name = ct.get("name", ct_id)
        description = ct.get("description", "")
        fields = ct.get("fields", [])
        
        # Get entry count for this content type
        _, entry_count = cf_client.get_entries(content_type=ct_id, limit=1)
        
        results.append({
            "id": ct_id,
            "name": name,
            "description": description[:50] + "..." if len(description) > 50 else description,
            "field_count": len(fields),
            "entry_count": entry_count,
            "raw": ct
        })
    
    # Sort by entry count descending
    results.sort(key=lambda x: x["entry_count"], reverse=True)
    
    return results

def display_content_types(content_types: List[Dict]):
    """Display content types in a table format"""
    print(f"\n  {Colors.BOLD}{'#':<4} {'Name':<30} {'API ID':<25} {'Fields':<8} {'Entries':<10}{Colors.RESET}")
    print(f"  {'-'*4} {'-'*30} {'-'*25} {'-'*8} {'-'*10}")
    
    for i, ct in enumerate(content_types, 1):
        print(f"  {i:<4} {ct['name'][:29]:<30} {ct['id'][:24]:<25} {ct['field_count']:<8} {ct['entry_count']:<10}")
    
    print()

def select_content_types(content_types: List[Dict], ci_mode: bool = False) -> List[str]:
    """Interactive content type selection"""
    if ci_mode:
        # In CI mode, select all
        return [ct["id"] for ct in content_types]
    
    print(f"\n{Colors.BOLD}Select content types to migrate:{Colors.RESET}")
    print(f"  {Colors.CYAN}a{Colors.RESET} - Select all")
    print(f"  {Colors.CYAN}1,2,5{Colors.RESET} - Select specific (comma-separated numbers)")
    print(f"  {Colors.CYAN}1-5{Colors.RESET} - Select range")
    print(f"  {Colors.CYAN}1-5,8,10{Colors.RESET} - Combine ranges and numbers")
    print()
    
    while True:
        selection = input(f"  {Colors.YELLOW}Your selection:{Colors.RESET} ").strip().lower()
        
        if selection == 'a':
            return [ct["id"] for ct in content_types]
        
        try:
            selected_indices = set()
            parts = selection.split(',')
            
            for part in parts:
                part = part.strip()
                if '-' in part:
                    start, end = map(int, part.split('-'))
                    selected_indices.update(range(start, end + 1))
                else:
                    selected_indices.add(int(part))
            
            # Validate indices
            if all(1 <= i <= len(content_types) for i in selected_indices):
                return [content_types[i-1]["id"] for i in sorted(selected_indices)]
            else:
                print_error(f"Invalid selection. Please enter numbers between 1 and {len(content_types)}")
        except ValueError:
            print_error("Invalid format. Use 'a' for all, or numbers like '1,2,5' or '1-5'")

def select_asset_strategy(ci_mode: bool = False) -> str:
    """Ask user about asset migration strategy"""
    if ci_mode:
        return "linked"  # Default to linked in CI mode
    
    print(f"\n{Colors.BOLD}Asset Migration Strategy:{Colors.RESET}")
    print(f"  {Colors.CYAN}1{Colors.RESET} - Migrate only assets linked to selected entries (recommended)")
    print(f"  {Colors.CYAN}2{Colors.RESET} - Migrate ALL assets from Contentful")
    print()
    
    while True:
        selection = input(f"  {Colors.YELLOW}Your selection [1]:{Colors.RESET} ").strip()
        
        if selection == '' or selection == '1':
            return "linked"
        elif selection == '2':
            return "all"
        else:
            print_error("Please enter 1 or 2")

# ============================================
# SPACE SELECTION / CREATION
# ============================================

def display_spaces(spaces: List[Dict]):
    """Display available spaces in a table format"""
    print(f"\n  {Colors.BOLD}{'#':<4} {'Name':<35} {'ID':<30}{Colors.RESET}")
    print(f"  {'-'*4} {'-'*35} {'-'*30}")
    
    for i, space in enumerate(spaces, 1):
        name = space.get("name", "Unnamed")[:34]
        space_id = space.get("sys", {}).get("id", "")[:29]
        print(f"  {i:<4} {name:<35} {space_id:<30}")
    
    print()

def select_or_create_space(o2_client: O2Client, state: MigrationState, ci_mode: bool = False) -> Tuple[str, str]:
    """
    Let user select an existing space or create a new one.
    Returns (space_id, space_name)
    """
    print_subheader("O2 CMS Destination Space")
    
    # Get existing spaces
    print_info("Fetching existing spaces...")
    spaces = o2_client.get_spaces()
    
    if ci_mode:
        # In CI mode, use environment variable or first space
        if O2_SPACE_ID:
            for space in spaces:
                if space.get("sys", {}).get("id") == O2_SPACE_ID:
                    return O2_SPACE_ID, space.get("name", "")
        if spaces:
            space = spaces[0]
            return space.get("sys", {}).get("id", ""), space.get("name", "")
        print_error("No spaces found and CI mode - cannot create interactively")
        sys.exit(1)
    
    print(f"\n{Colors.BOLD}Choose destination space:{Colors.RESET}")
    print(f"  {Colors.CYAN}n{Colors.RESET} - Create a NEW space")
    
    if spaces:
        print(f"  {Colors.CYAN}1-{len(spaces)}{Colors.RESET} - Select an existing space")
        display_spaces(spaces)
    else:
        print_info("\n  No existing spaces found. You'll need to create one.")
        print()
    
    while True:
        selection = input(f"  {Colors.YELLOW}Your selection [n]:{Colors.RESET} ").strip().lower()
        
        if selection == '' or selection == 'n':
            # Create new space
            return create_new_space(o2_client)
        
        try:
            idx = int(selection)
            if 1 <= idx <= len(spaces):
                space = spaces[idx - 1]
                space_id = space.get("sys", {}).get("id", "")
                space_name = space.get("name", "")
                return space_id, space_name
            else:
                print_error(f"Please enter a number between 1 and {len(spaces)}, or 'n' for new")
        except ValueError:
            print_error("Please enter a number or 'n' for new space")

def create_new_space(o2_client: O2Client) -> Tuple[str, str]:
    """Interactively create a new space"""
    print(f"\n{Colors.BOLD}Create New Space:{Colors.RESET}")
    
    while True:
        name = input(f"  {Colors.YELLOW}Space name:{Colors.RESET} ").strip()
        if not name:
            print_error("Space name is required")
            continue
        
        description = input(f"  {Colors.YELLOW}Description (optional):{Colors.RESET} ").strip()
        
        print_info(f"\nCreating space '{name}'...")
        result, success = o2_client.create_space(name, description)
        
        if success:
            space_id = result.get("sys", {}).get("id", "")
            print_success(f"Space created: {name} (ID: {space_id})")
            
            # Wait a moment for environment to be created
            print_info("Waiting for default environment to be initialized...")
            time.sleep(3)
            
            return space_id, name
        else:
            error_msg = result.get("message", result.get("error", str(result)))
            print_error(f"Failed to create space: {error_msg}")
            
            retry = input(f"  {Colors.YELLOW}Try again? [Y/n]:{Colors.RESET} ").strip().lower()
            if retry == 'n':
                print_error("Cannot proceed without a destination space")
                sys.exit(1)

def extract_linked_asset_ids(entries: List[Dict]) -> Set[str]:
    """Extract all asset IDs referenced in entries (including Rich Text)"""
    asset_ids = set()
    
    def extract_from_value(value: Any):
        if value is None:
            return
        
        if isinstance(value, dict):
            sys = value.get("sys", {})
            
            # Check for direct Asset link
            if sys.get("type") == "Link" and sys.get("linkType") == "Asset":
                asset_id = sys.get("id")
                if asset_id:
                    asset_ids.add(asset_id)
            
            # Check for Rich Text embedded-asset-block
            if value.get("nodeType") in ("embedded-asset-block", "asset-hyperlink"):
                target = value.get("data", {}).get("target", {})
                asset_id = target.get("sys", {}).get("id")
                if asset_id:
                    asset_ids.add(asset_id)
            
            # Recursively check nested objects
            for v in value.values():
                extract_from_value(v)
        
        elif isinstance(value, list):
            for item in value:
                extract_from_value(item)
    
    for entry in entries:
        extract_from_value(entry.get("fields", {}))
    
    return asset_ids

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
        "apiId": ct_id,
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
    
    if field_type == "Link":
        field["linkType"] = link_type
    
    if field_type == "Array":
        items = cf_field.get("items", {})
        field["items"] = {"type": items.get("type", "Symbol")}
        if items.get("linkType"):
            field["items"]["linkType"] = items.get("linkType")
        if items.get("validations"):
            field["items"]["validations"] = items.get("validations")
    
    validations = cf_field.get("validations", [])
    if validations:
        supported_validations = []
        for val in validations:
            val_type = list(val.keys())[0] if val else None
            if val_type in {"size", "range", "regexp", "in", "linkContentType", "linkMimetypeGroup"}:
                supported_validations.append(val)
        if supported_validations:
            field["validations"] = supported_validations
    
    return field

def transform_field_value(value: Any, state: MigrationState) -> Any:
    """Transform a field value, updating references (including Rich Text embedded content)"""
    if value is None:
        return None
    
    if isinstance(value, dict):
        sys = value.get("sys", {})
        
        if sys.get("type") == "Link":
            link_type = sys.get("linkType")
            old_id = sys.get("id")
            
            if link_type == "Asset":
                new_id = state.asset_map.get(old_id, old_id)
                return {"sys": {"type": "Link", "linkType": "Asset", "id": new_id}}
            elif link_type == "Entry":
                new_id = state.entry_map.get(old_id, old_id)
                return {"sys": {"type": "Link", "linkType": "Entry", "id": new_id}}
            else:
                return value
        
        return {k: transform_field_value(v, state) for k, v in value.items()}
    
    if isinstance(value, list):
        return [transform_field_value(item, state) for item in value]
    
    return value

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

def transform_asset_data(cf_asset: Dict, upload_id: str, filename: str, content_type: str = "application/octet-stream") -> Dict:
    """Transform Contentful asset to O2 format"""
    fields = cf_asset.get("fields", {})
    
    title_field = fields.get("title", {})
    if isinstance(title_field, str):
        title_field = {"en-US": title_field}
    
    desc_field = fields.get("description", {})
    if isinstance(desc_field, str):
        desc_field = {"en-US": desc_field}
    
    o2_fields = {"title": title_field, "description": desc_field}
    
    o2_file = {
        "en-US": {
            "uploadFrom": {"sys": {"type": "Link", "linkType": "Upload", "id": upload_id}},
            "fileName": filename,
            "contentType": content_type
        }
    }
    
    o2_fields["file"] = o2_file
    
    return {"fields": o2_fields}

# ============================================
# MIGRATION FUNCTIONS
# ============================================

def download_asset_file(url: str, filename: str, signer: EmbargoedAssetSigner = None) -> Optional[str]:
    """Download an asset file to a temporary location"""
    try:
        if url.startswith("//"):
            url = "https:" + url
        
        if "secure.ctfassets.net" in url and signer:
            url = signer.sign_url(url)
        
        headers = {"User-Agent": "Mozilla/5.0 ContentfulMigration/1.0"}
        
        for attempt in range(3):
            try:
                response = requests.get(url, timeout=120, stream=True, headers=headers)
                response.raise_for_status()
                break
            except requests.exceptions.RequestException as e:
                if attempt == 2:
                    raise
                time.sleep(1)
        
        ext = os.path.splitext(filename)[1] or ""
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
        
        for chunk in response.iter_content(chunk_size=8192):
            temp_file.write(chunk)
        
        temp_file.close()
        return temp_file.name
        
    except Exception as e:
        return None

def migrate_content_types(cf_client: ContentfulClient, o2_client: O2Client, 
                         state: MigrationState, logger: MigrationLogger, 
                         content_type_data: List[Dict]) -> bool:
    """Migrate selected content types"""
    print_header("PHASE 1: CONTENT TYPES MIGRATION")
    logger.log("Starting content types migration")
    
    existing_cts = o2_client.get_content_types()
    existing_api_ids = {ct.get("apiId") for ct in existing_cts}
    
    for ct in existing_cts:
        api_id = ct.get("apiId", "")
        ct_id = ct.get("sys", {}).get("id", "")
        if api_id and ct_id:
            state.content_type_map[api_id] = ct_id
    
    # Filter to selected content types
    selected_cts = [ct for ct in content_type_data if ct["id"] in state.selected_content_types]
    state.stats["content_types"]["total"] = len(selected_cts)
    
    print_info(f"Content types to migrate: {len(selected_cts)}")
    print()
    
    for i, ct_data in enumerate(selected_cts):
        old_id = ct_data["id"]
        name = ct_data["name"]
        
        print_progress(i + 1, len(selected_cts), name)
        
        if old_id in state.migrated_content_types:
            state.stats["content_types"]["skipped"] += 1
            continue
        
        if old_id in existing_api_ids:
            for ct in existing_cts:
                if ct.get("apiId") == old_id:
                    state.content_type_map[old_id] = ct.get("sys", {}).get("id", old_id)
                    break
            state.migrated_content_types.append(old_id)
            state.stats["content_types"]["skipped"] += 1
            logger.log(f"Skipped content type (exists): {old_id}")
            continue
        
        ct_transform = transform_content_type(ct_data["raw"])
        result, success = o2_client.create_content_type(ct_transform)
        
        if success:
            new_id = result.get("sys", {}).get("id", "")
            state.content_type_map[old_id] = new_id
            state.migrated_content_types.append(old_id)
            logger.log(f"Created content type: {old_id} -> {new_id}")
            
            time.sleep(RATE_LIMIT_DELAY)
            if o2_client.publish_content_type(new_id):
                logger.log(f"Published content type: {new_id}")
            
            state.stats["content_types"]["migrated"] += 1
        else:
            logger.log(f"Failed to create content type {old_id}: {result}")
            state.stats["content_types"]["failed"] += 1
        
        time.sleep(RATE_LIMIT_DELAY)
        
        if (i + 1) % SAVE_STATE_EVERY == 0:
            state.save()
    
    print()
    print_success(f"Content types: {state.stats['content_types']['migrated']} migrated, "
                 f"{state.stats['content_types']['skipped']} skipped, "
                 f"{state.stats['content_types']['failed']} failed")
    
    state.save()
    return state.stats["content_types"]["failed"] == 0

def process_single_asset(cf_asset: Dict, signer: Optional[EmbargoedAssetSigner],
                        o2_client: O2Client, logger: MigrationLogger,
                        state_lock: threading.Lock) -> Tuple[str, Optional[str], str]:
    """Process a single asset"""
    old_id = cf_asset.get("sys", {}).get("id", "")
    fields = cf_asset.get("fields", {})
    
    file_field = fields.get("file", {})
    if not file_field:
        logger.log(f"Skipped asset (no file): {old_id}")
        return (old_id, None, "skipped")
    
    if isinstance(file_field, dict):
        first_key = list(file_field.keys())[0] if file_field else None
        if first_key and isinstance(file_field.get(first_key), dict):
            file_info = file_field[first_key]
        elif "url" in file_field:
            file_info = file_field
        else:
            file_info = list(file_field.values())[0] if file_field else {}
    else:
        return (old_id, None, "skipped")
    
    if isinstance(file_info, dict):
        file_url = file_info.get("url", "")
        filename = file_info.get("fileName", "file")
        content_type = file_info.get("contentType", "application/octet-stream")
    else:
        return (old_id, None, "skipped")
    
    if not file_url:
        return (old_id, None, "skipped")
    
    temp_path = None
    try:
        temp_path = download_asset_file(file_url, filename, signer)
        if not temp_path:
            logger.log(f"Failed to download asset: {old_id}")
            return (old_id, None, "failed")
        
        upload_id, upload_success = o2_client.upload_file(temp_path, filename)
        
        if not upload_success:
            logger.log(f"Failed to upload asset: {old_id}")
            return (old_id, None, "failed")
        
        asset_data = transform_asset_data(cf_asset, upload_id, filename, content_type)
        result, success = o2_client.create_asset(asset_data)
        
        if success:
            new_id = result.get("sys", {}).get("id", "")
            logger.log(f"Created asset: {old_id} -> {new_id}")
            
            time.sleep(RATE_LIMIT_DELAY)
            o2_client.publish_asset(new_id)
            
            return (old_id, new_id, "migrated")
        else:
            logger.log(f"Failed to create asset {old_id}: {result}")
            return (old_id, None, "failed")
            
    except Exception as e:
        logger.log(f"Error processing asset {old_id}: {e}")
        return (old_id, None, "failed")
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except:
                pass

def migrate_assets(cf_client: ContentfulClient, o2_client: O2Client, 
                  state: MigrationState, logger: MigrationLogger) -> bool:
    """Migrate assets based on selected strategy"""
    print_header("PHASE 2: ASSETS MIGRATION")
    logger.log(f"Starting assets migration (strategy: {state.asset_strategy})")
    
    # Create signer for embargoed assets
    signer = None
    if CONTENTFUL_CMA_TOKEN:
        try:
            signer = EmbargoedAssetSigner(CONTENTFUL_SPACE_ID, CONTENTFUL_ENVIRONMENT, CONTENTFUL_CMA_TOKEN)
            signer.get_or_create_asset_key()
            print_success("Embargoed asset signer ready")
        except Exception as e:
            print_warning(f"Failed to create asset signer: {e}")
    
    # Get all assets from Contentful
    print_info("Fetching assets from Contentful...")
    cf_assets = cf_client.get_all_assets()
    
    # Filter based on strategy
    if state.asset_strategy == "linked":
        linked_ids = set(state.linked_asset_ids)
        assets_to_process = [a for a in cf_assets if a.get("sys", {}).get("id", "") in linked_ids]
        print_info(f"Found {len(cf_assets)} total assets, {len(assets_to_process)} linked to selected entries")
    else:
        assets_to_process = cf_assets
        print_info(f"Migrating all {len(assets_to_process)} assets")
    
    state.stats["assets"]["total"] = len(assets_to_process)
    
    # Filter already migrated
    assets_to_migrate = []
    for cf_asset in assets_to_process:
        old_id = cf_asset.get("sys", {}).get("id", "")
        if old_id in state.migrated_assets:
            state.stats["assets"]["skipped"] += 1
        else:
            assets_to_migrate.append(cf_asset)
    
    if not assets_to_migrate:
        print_success("All assets already migrated!")
        return True
    
    print_info(f"Assets to migrate: {len(assets_to_migrate)}")
    print()
    
    state_lock = threading.Lock()
    completed = 0
    
    def update_progress():
        nonlocal completed
        completed += 1
        print_progress(completed, len(assets_to_migrate), f"Processing ({PARALLEL_WORKERS} workers)")
    
    with ThreadPoolExecutor(max_workers=PARALLEL_WORKERS) as executor:
        future_to_asset = {
            executor.submit(process_single_asset, cf_asset, signer, o2_client, logger, state_lock): cf_asset 
            for cf_asset in assets_to_migrate
        }
        
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
                    else:
                        state.failed_assets.append(old_id)
                        state.stats["assets"]["failed"] += 1
                    
                    update_progress()
                    
                    if completed % SAVE_STATE_EVERY == 0:
                        state.save()
                        
            except Exception as e:
                logger.log(f"Unexpected error in asset processing: {e}")
    
    print()
    print_success(f"Assets: {state.stats['assets']['migrated']} migrated, "
                 f"{state.stats['assets']['skipped']} skipped, "
                 f"{state.stats['assets']['failed']} failed")
    
    state.save()
    return state.stats["assets"]["failed"] == 0

def migrate_entries(cf_client: ContentfulClient, o2_client: O2Client, 
                   state: MigrationState, logger: MigrationLogger) -> bool:
    """Migrate entries for selected content types"""
    print_header("PHASE 3: ENTRIES MIGRATION")
    logger.log("Starting entries migration")
    
    # Get entries for selected content types
    print_info("Fetching entries for selected content types...")
    cf_entries = cf_client.get_entries_for_content_types(state.selected_content_types)
    state.stats["entries"]["total"] = len(cf_entries)
    
    print_info(f"Total entries to migrate: {len(cf_entries)}")
    print()
    
    for i, cf_entry in enumerate(cf_entries):
        old_id = cf_entry.get("sys", {}).get("id", "")
        old_ct_id = cf_entry.get("sys", {}).get("contentType", {}).get("sys", {}).get("id", "")
        fields = cf_entry.get("fields", {})
        
        # Get display name
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
        
        if old_id in state.migrated_entries:
            state.stats["entries"]["skipped"] += 1
            continue
        
        new_ct_id = state.content_type_map.get(old_ct_id)
        if not new_ct_id:
            logger.log(f"Skipped entry (no content type mapping): {old_id}")
            state.stats["entries"]["failed"] += 1
            state.failed_entries.append(old_id)
            continue
        
        transformed_fields = transform_entry_fields(fields, state)
        entry_data = {"fields": transformed_fields}
        result, success = o2_client.create_entry(new_ct_id, entry_data)
        
        if success:
            new_id = result.get("sys", {}).get("id", "")
            state.entry_map[old_id] = new_id
            state.migrated_entries.append(old_id)
            logger.log(f"Created entry: {old_id} -> {new_id}")
            
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
        
        if (i + 1) % SAVE_STATE_EVERY == 0:
            state.save()
    
    print()
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
    
    print(f"\n{Colors.BOLD}Destination:{Colors.RESET}")
    print(f"  Space: {state.o2_space_name} ({state.o2_space_id})")
    print(f"  Environment: {state.o2_environment_id}")
    
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

# ============================================
# MAIN
# ============================================

def main():
    parser = argparse.ArgumentParser(description='Migrate content from Contentful to O2 CMS')
    parser.add_argument('--ci', action='store_true', help='Non-interactive mode (migrate everything)')
    parser.add_argument('--reset', action='store_true', help='Reset migration state and start fresh')
    args = parser.parse_args()
    
    print(f"\n{Colors.BOLD}{Colors.BLUE}")
    print("╔═══════════════════════════════════════════════════════════════╗")
    print("║     CONTENTFUL → O2 CMS MIGRATION TOOL                       ║")
    print("║     Interactive Migration with Content Type Selection         ║")
    print("╚═══════════════════════════════════════════════════════════════╝")
    print(f"{Colors.RESET}")
    
    print(f"\n{Colors.BOLD}Source Configuration:{Colors.RESET}")
    print(f"  Contentful Space: {CONTENTFUL_SPACE_ID}")
    print(f"  Contentful Env:   {CONTENTFUL_ENVIRONMENT}")
    
    # Initialize or load state
    if args.reset and os.path.exists("migration_state.json"):
        os.remove("migration_state.json")
        print_info("\nMigration state reset")
    
    state = MigrationState.load()
    
    # Initialize Contentful client
    cf_client = ContentfulClient(CONTENTFUL_SPACE_ID, CONTENTFUL_CDA_TOKEN, CONTENTFUL_ENVIRONMENT)
    
    # Initialize O2 client (without space initially)
    o2_client = O2Client(token=O2_CMA_TOKEN, environment_name=O2_ENVIRONMENT)
    
    # Step 1: Select or create destination space
    if state.o2_space_id:
        # Resume with previously selected space
        print_info(f"\nResuming migration to space: {state.o2_space_name} ({state.o2_space_id})")
        o2_client.set_space(state.o2_space_id)
    else:
        # Interactive space selection
        space_id, space_name = select_or_create_space(o2_client, state, ci_mode=args.ci)
        state.o2_space_id = space_id
        state.o2_space_name = space_name
        o2_client.set_space(space_id)
        state.save()
    
    # Resolve O2 environment ID
    print_info("\nResolving O2 environment ID...")
    if not o2_client.resolve_environment_id():
        print_error(f"Failed to resolve environment '{O2_ENVIRONMENT}' in O2 space")
        return 1
    
    state.o2_environment_id = o2_client.environment_id
    print_success(f"Environment resolved: {o2_client.environment_id}")
    
    print(f"\n{Colors.BOLD}Destination:{Colors.RESET}")
    print(f"  O2 Space: {state.o2_space_name} ({state.o2_space_id})")
    print(f"  O2 Env:   {o2_client.environment_id}")
    
    # Initialize logger
    logger = MigrationLogger()
    
    try:
        # Phase 0: Analyze and select content types
        if not state.selected_content_types:
            content_types = analyze_content_types(cf_client)
            
            if not content_types:
                print_error("No content types found in Contentful space")
                return 1
            
            display_content_types(content_types)
            
            # Select content types
            state.selected_content_types = select_content_types(content_types, ci_mode=args.ci)
            
            selected_names = [ct["name"] for ct in content_types if ct["id"] in state.selected_content_types]
            print_success(f"Selected {len(state.selected_content_types)} content types: {', '.join(selected_names)}")
            
            # Get entries for selected content types to analyze linked assets
            print_info("\nAnalyzing entries for linked assets...")
            entries = cf_client.get_entries_for_content_types(state.selected_content_types)
            linked_assets = extract_linked_asset_ids(entries)
            state.linked_asset_ids = list(linked_assets)
            
            print_info(f"Found {len(entries)} entries with {len(linked_assets)} unique linked assets")
            
            # Select asset strategy
            state.asset_strategy = select_asset_strategy(ci_mode=args.ci)
            print_success(f"Asset strategy: {'Linked assets only' if state.asset_strategy == 'linked' else 'All assets'}")
            
            state.save()
        else:
            print_info(f"\nResuming previous migration:")
            print_info(f"  Selected content types: {len(state.selected_content_types)}")
            print_info(f"  Asset strategy: {state.asset_strategy}")
            print_info(f"  Content types migrated: {len(state.migrated_content_types)}")
            print_info(f"  Assets migrated: {len(state.migrated_assets)}")
            print_info(f"  Entries migrated: {len(state.migrated_entries)}")
            
            # Reload content type data
            content_types = analyze_content_types(cf_client)
        
        # Confirm before starting
        if not args.ci:
            print(f"\n{Colors.YELLOW}Ready to start migration.{Colors.RESET}")
            input("\nPress ENTER to continue or Ctrl+C to cancel...")
        
        # Phase 1: Content Types
        migrate_content_types(cf_client, o2_client, state, logger, content_types)
        
        # Phase 2: Assets
        migrate_assets(cf_client, o2_client, state, logger)
        
        # Phase 3: Entries
        migrate_entries(cf_client, o2_client, state, logger)
        
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

