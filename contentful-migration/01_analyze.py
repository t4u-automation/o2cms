#!/usr/bin/env python3
"""
Phase 1: Contentful Analysis Script

Analyzes Contentful space content and compares with O2 CMS capabilities.
Produces a detailed report highlighting:
- Content types, fields, and their compatibility
- Validations that will be preserved vs ignored
- Appearances/widgets that will be preserved vs ignored
- Asset and entry counts
- Rich Text fields (preserved as Contentful-compatible JSON)

Usage:
    python 01_analyze.py

Output:
    - Console report with colored output
    - analysis_report.json - Detailed JSON report
    - analysis_report.txt - Human-readable text report
"""

import os
import sys
import json
import requests
from typing import Dict, List, Any, Set
from datetime import datetime
from dataclasses import dataclass, field, asdict

# ============================================
# CONFIGURATION
# ============================================

# Contentful Source Configuration
CONTENTFUL_SPACE_ID = os.getenv("CONTENTFUL_SPACE_ID", "k1pwmoi723xt")
CONTENTFUL_CDA_TOKEN = os.getenv("CONTENTFUL_CDA_TOKEN", "Iwb8JFzeF9_E2fuJ0b1WB2xSegJffcTIWpOO7eZh8wg")
CONTENTFUL_ENVIRONMENT = os.getenv("CONTENTFUL_ENVIRONMENT", "dev")
CONTENTFUL_BASE_URL = "https://cdn.contentful.com"

# O2 CMS Destination Configuration (for comparison)
O2_SPACE_ID = os.getenv("O2_SPACE_ID", "A1mFPJUoUE4djSkBr66j")
O2_CMA_TOKEN = os.getenv("O2_CMA_TOKEN", "o2_cma_145656e8f38d1c8f1c02fa9496604360")
O2_ENVIRONMENT = os.getenv("O2_ENVIRONMENT", "master")
O2_BASE_URL = os.getenv("O2_BASE_URL", "https://us-central1-t4u-cms.cloudfunctions.net/api")

# ============================================
# O2 PLATFORM CAPABILITIES
# ============================================

# Field types fully supported by O2
O2_SUPPORTED_FIELD_TYPES = {
    "Symbol",      # Short text (max 256 chars)
    "Text",        # Long text (max 50,000 chars)
    "RichText",    # WYSIWYG editor
    "Integer",     # Whole numbers
    "Number",      # Decimal numbers
    "Date",        # ISO 8601 date strings
    "Boolean",     # True/false
    "Location",    # Lat/lon coordinates
    "Object",      # JSON objects
    "Link",        # References to Assets or Entries
    "Array",       # Arrays of items
}

# Validations supported by O2
O2_SUPPORTED_VALIDATIONS = {
    "size",           # Text length, array length (min/max)
    "range",          # Number min/max
    "regexp",         # Pattern matching for text fields
    "in",             # Predefined values (powers dropdown/radio)
    "linkContentType",  # Restrict entry references to specific content types
    "linkMimetypeGroup",  # MIME type group filtering (defined but not fully enforced)
}

# Validations NOT supported by O2 (will be ignored)
O2_UNSUPPORTED_VALIDATIONS = {
    "unique",             # Requires DB query - not implemented
    "prohibitRegexp",     # Negative regex pattern
    "dateRange",          # Date min/max
    "assetImageDimensions",  # Image dimension constraints
    "assetFileSize",      # File size constraints
    "enabledMarks",       # Rich text marks
    "enabledNodeTypes",   # Rich text node types
    "nodes",              # Rich text embedded entry constraints
}

# Widget/Appearance IDs supported by O2
O2_SUPPORTED_WIDGETS = {
    "singleLine",         # Default Symbol widget
    "urlEditor",          # URL input
    "dropdown",           # Dropdown select (with `in` validation)
    "radio",              # Radio buttons (with `in` validation)
    "multipleLine",       # Multiline textarea
    "markdown",           # Markdown editor
    "richTextEditor",     # TipTap rich text
    "boolean",            # Checkbox/toggle
    "numberEditor",       # Number input
    "datePicker",         # Date picker
    "locationEditor",     # Map location picker
    "objectEditor",       # JSON editor
    "entryLinkEditor",    # Entry reference picker
    "entryLinksEditor",   # Multiple entry references
    "assetLinkEditor",    # Asset/media picker
    "assetLinksEditor",   # Multiple assets
    "tagEditor",          # Tag input
}

# Widgets NOT supported (will fallback to defaults)
O2_UNSUPPORTED_WIDGETS = {
    "slugEditor",         # Auto-generate slug (use singleLine instead)
    "listInput",          # List of strings
    "checkbox",           # Checkbox (use boolean instead)
    "rating",             # Star rating
    "calendar",           # Calendar view
}

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

def print_dim(text: str):
    print(f"  {Colors.DIM}{text}{Colors.RESET}")

# ============================================
# DATA CLASSES FOR ANALYSIS
# ============================================

@dataclass
class ValidationAnalysis:
    name: str
    supported: bool
    details: str = ""

@dataclass
class WidgetAnalysis:
    widget_id: str
    supported: bool
    fallback: str = ""

@dataclass
class FieldAnalysis:
    field_id: str
    field_name: str
    field_type: str
    type_supported: bool
    required: bool
    localized: bool
    validations: List[ValidationAnalysis] = field(default_factory=list)
    widget: WidgetAnalysis = None
    issues: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

@dataclass
class ContentTypeAnalysis:
    content_type_id: str
    name: str
    description: str
    display_field: str
    fields: List[FieldAnalysis] = field(default_factory=list)
    entry_count: int = 0
    fully_compatible: bool = True
    issues: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

@dataclass 
class AnalysisReport:
    timestamp: str
    contentful_space_id: str
    contentful_environment: str
    o2_space_id: str
    o2_environment: str
    
    # Counts
    total_content_types: int = 0
    total_entries: int = 0
    total_assets: int = 0
    total_locales: int = 0
    
    # Compatibility summary
    fully_compatible_content_types: int = 0
    partially_compatible_content_types: int = 0
    
    # Details
    content_types: List[ContentTypeAnalysis] = field(default_factory=list)
    locales: List[Dict] = field(default_factory=list)
    
    # Aggregate issues
    unsupported_validations_used: Dict[str, int] = field(default_factory=dict)
    unsupported_widgets_used: Dict[str, int] = field(default_factory=dict)

# ============================================
# CONTENTFUL CLIENT
# ============================================

class ContentfulClient:
    """Client for Contentful CDA"""
    
    def __init__(self, space_id: str, token: str, environment: str = "master"):
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
        response = requests.get(url, headers=self.headers, params=params, timeout=30)
        response.raise_for_status()
        return response.json()
    
    def get_content_types(self) -> List[Dict]:
        result = self._request("/content_types", {"limit": 1000})
        return result.get("items", [])
    
    def get_assets_count(self) -> int:
        result = self._request("/assets", {"limit": 1})
        return result.get("total", 0)
    
    def get_entries_count(self) -> int:
        result = self._request("/entries", {"limit": 1})
        return result.get("total", 0)
    
    def get_entries_by_content_type(self, content_type_id: str) -> int:
        result = self._request("/entries", {"content_type": content_type_id, "limit": 1})
        return result.get("total", 0)
    
    def get_locales(self) -> List[Dict]:
        result = self._request("/locales", {"limit": 100})
        return result.get("items", [])


class O2Client:
    """Client for O2 CMS CMA"""
    
    def __init__(self, space_id: str, token: str, environment: str = "master"):
        self.space_id = space_id
        self.token = token
        self.environment = environment
        self.base_url = O2_BASE_URL
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
    
    def _request(self, endpoint: str) -> Dict:
        url = f"{self.base_url}{endpoint}"
        response = requests.get(url, headers=self.headers, timeout=30)
        if response.status_code == 200:
            return response.json()
        return {}
    
    def get_content_types(self) -> List[Dict]:
        result = self._request(f"/v1/spaces/{self.space_id}/environments/{self.environment}/content_types")
        return result.get("items", [])
    
    def get_locales(self) -> List[Dict]:
        result = self._request(f"/v1/spaces/{self.space_id}/environments/{self.environment}/locales")
        return result.get("items", [])
    
    def get_entries_count(self) -> int:
        result = self._request(f"/v1/spaces/{self.space_id}/environments/{self.environment}/entries")
        return result.get("total", 0)
    
    def get_assets_count(self) -> int:
        result = self._request(f"/v1/spaces/{self.space_id}/environments/{self.environment}/assets")
        return result.get("total", 0)

# ============================================
# ANALYSIS FUNCTIONS
# ============================================

def analyze_validation(validation: Dict) -> ValidationAnalysis:
    """Analyze a single validation rule"""
    
    # Validation is a dict with one key (the validation type)
    for val_type, val_config in validation.items():
        supported = val_type in O2_SUPPORTED_VALIDATIONS
        
        details = ""
        if val_type == "size":
            min_val = val_config.get("min", "")
            max_val = val_config.get("max", "")
            details = f"min={min_val}, max={max_val}"
        elif val_type == "range":
            min_val = val_config.get("min", "")
            max_val = val_config.get("max", "")
            details = f"min={min_val}, max={max_val}"
        elif val_type == "regexp":
            pattern = val_config.get("pattern", "")
            details = f"pattern={pattern[:30]}..." if len(pattern) > 30 else f"pattern={pattern}"
        elif val_type == "in":
            values = val_config if isinstance(val_config, list) else []
            details = f"{len(values)} options"
        elif val_type == "linkContentType":
            types = val_config if isinstance(val_config, list) else []
            details = f"types: {', '.join(types)}"
        elif val_type == "linkMimetypeGroup":
            groups = val_config if isinstance(val_config, list) else []
            details = f"groups: {', '.join(groups)}"
        elif val_type == "unique":
            details = "unique constraint"
        else:
            details = json.dumps(val_config)[:50]
        
        return ValidationAnalysis(
            name=val_type,
            supported=supported,
            details=details
        )
    
    return ValidationAnalysis(name="unknown", supported=False)


def analyze_widget(editor: Dict) -> WidgetAnalysis:
    """Analyze a field's widget/appearance"""
    
    if not editor:
        return WidgetAnalysis(widget_id="default", supported=True, fallback="")
    
    widget_id = editor.get("widgetId", "default")
    supported = widget_id in O2_SUPPORTED_WIDGETS
    
    # Determine fallback widget
    fallback = ""
    if not supported:
        if widget_id == "slugEditor":
            fallback = "singleLine"
        elif widget_id == "listInput":
            fallback = "tagEditor"
        elif widget_id == "checkbox":
            fallback = "boolean"
        elif widget_id == "rating":
            fallback = "numberEditor"
        else:
            fallback = "singleLine"
    
    return WidgetAnalysis(
        widget_id=widget_id,
        supported=supported,
        fallback=fallback
    )


def analyze_field(cf_field: Dict) -> FieldAnalysis:
    """Analyze a single content type field"""
    
    field_id = cf_field.get("id", "")
    field_name = cf_field.get("name", field_id)
    field_type = cf_field.get("type", "")
    link_type = cf_field.get("linkType", "")
    
    # Check field type support
    type_supported = field_type in O2_SUPPORTED_FIELD_TYPES
    
    analysis = FieldAnalysis(
        field_id=field_id,
        field_name=field_name,
        field_type=field_type if not link_type else f"{field_type}:{link_type}",
        type_supported=type_supported,
        required=cf_field.get("required", False),
        localized=cf_field.get("localized", False),
    )
    
    # Analyze validations
    for validation in cf_field.get("validations", []):
        val_analysis = analyze_validation(validation)
        analysis.validations.append(val_analysis)
        
        if not val_analysis.supported:
            analysis.warnings.append(f"Validation '{val_analysis.name}' not supported - will be ignored")
    
    # Analyze widget/editor
    editor = cf_field.get("widgetId")
    if editor:
        # Old format: widgetId directly on field
        analysis.widget = WidgetAnalysis(
            widget_id=editor,
            supported=editor in O2_SUPPORTED_WIDGETS,
            fallback="" if editor in O2_SUPPORTED_WIDGETS else "singleLine"
        )
    else:
        # Check items for Array type
        items = cf_field.get("items", {})
        if items:
            for validation in items.get("validations", []):
                val_analysis = analyze_validation(validation)
                analysis.validations.append(val_analysis)
                if not val_analysis.supported:
                    analysis.warnings.append(f"Item validation '{val_analysis.name}' not supported")
    
    # Add issues for unsupported types
    if not type_supported:
        analysis.issues.append(f"Field type '{field_type}' is not supported")
    
    return analysis


def analyze_content_type(cf_ct: Dict, entry_count: int) -> ContentTypeAnalysis:
    """Analyze a single content type"""
    
    ct_id = cf_ct.get("sys", {}).get("id", "")
    name = cf_ct.get("name", ct_id)
    description = cf_ct.get("description", "")
    display_field = cf_ct.get("displayField", "")
    
    analysis = ContentTypeAnalysis(
        content_type_id=ct_id,
        name=name,
        description=description,
        display_field=display_field,
        entry_count=entry_count
    )
    
    # Analyze each field
    for cf_field in cf_ct.get("fields", []):
        field_analysis = analyze_field(cf_field)
        analysis.fields.append(field_analysis)
        
        # Propagate issues
        if field_analysis.issues:
            analysis.issues.extend([f"Field '{field_analysis.field_id}': {i}" for i in field_analysis.issues])
        if field_analysis.warnings:
            analysis.warnings.extend([f"Field '{field_analysis.field_id}': {w}" for w in field_analysis.warnings])
    
    # Determine overall compatibility
    analysis.fully_compatible = len(analysis.issues) == 0 and len(analysis.warnings) == 0
    
    return analysis


def run_analysis() -> AnalysisReport:
    """Run full analysis of Contentful space"""
    
    print_header("CONTENTFUL SPACE ANALYSIS")
    
    # Initialize report
    report = AnalysisReport(
        timestamp=datetime.now().isoformat(),
        contentful_space_id=CONTENTFUL_SPACE_ID,
        contentful_environment=CONTENTFUL_ENVIRONMENT,
        o2_space_id=O2_SPACE_ID,
        o2_environment=O2_ENVIRONMENT,
    )
    
    # Connect to Contentful
    print_info(f"Connecting to Contentful space: {CONTENTFUL_SPACE_ID}")
    cf_client = ContentfulClient(CONTENTFUL_SPACE_ID, CONTENTFUL_CDA_TOKEN, CONTENTFUL_ENVIRONMENT)
    
    # Connect to O2
    print_info(f"Connecting to O2 space: {O2_SPACE_ID}")
    o2_client = O2Client(O2_SPACE_ID, O2_CMA_TOKEN, O2_ENVIRONMENT)
    
    # Get counts
    print_subheader("Fetching Overview")
    
    try:
        report.total_entries = cf_client.get_entries_count()
        print_success(f"Total Entries: {report.total_entries}")
    except Exception as e:
        print_error(f"Failed to get entries count: {e}")
    
    try:
        report.total_assets = cf_client.get_assets_count()
        print_success(f"Total Assets: {report.total_assets}")
    except Exception as e:
        print_error(f"Failed to get assets count: {e}")
    
    # Get locales
    print_subheader("Analyzing Locales")
    
    try:
        cf_locales = cf_client.get_locales()
        report.total_locales = len(cf_locales)
        report.locales = cf_locales
        
        for locale in cf_locales:
            code = locale.get("code", "")
            name = locale.get("name", code)
            is_default = locale.get("default", False)
            fallback = locale.get("fallbackCode", "none")
            
            status = f"{Colors.GREEN}(default){Colors.RESET}" if is_default else ""
            print_success(f"Locale: {code} - {name} {status} (fallback: {fallback})")
        
        # Check O2 locales
        o2_locales = o2_client.get_locales()
        o2_locale_codes = {loc.get("code") for loc in o2_locales}
        
        print_info(f"\nO2 existing locales: {o2_locale_codes or 'none'}")
        
        # Find locales to create
        cf_locale_codes = {loc.get("code") for loc in cf_locales}
        new_locales = cf_locale_codes - o2_locale_codes
        if new_locales:
            print_warning(f"Locales to create in O2: {new_locales}")
        
    except Exception as e:
        print_error(f"Failed to get locales: {e}")
    
    # Analyze content types
    print_subheader("Analyzing Content Types")
    
    try:
        cf_content_types = cf_client.get_content_types()
        report.total_content_types = len(cf_content_types)
        print_success(f"Found {len(cf_content_types)} content types")
        
        # Check existing O2 content types
        o2_content_types = o2_client.get_content_types()
        o2_ct_ids = {ct.get("apiId", ct.get("sys", {}).get("id", "")) for ct in o2_content_types}
        print_info(f"O2 existing content types: {len(o2_content_types)}")
        
        for cf_ct in cf_content_types:
            ct_id = cf_ct.get("sys", {}).get("id", "")
            
            # Get entry count for this content type
            try:
                entry_count = cf_client.get_entries_by_content_type(ct_id)
            except:
                entry_count = 0
            
            # Analyze content type
            ct_analysis = analyze_content_type(cf_ct, entry_count)
            report.content_types.append(ct_analysis)
            
            # Track compatibility
            if ct_analysis.fully_compatible:
                report.fully_compatible_content_types += 1
            else:
                report.partially_compatible_content_types += 1
            
            # Track unsupported features used
            for field in ct_analysis.fields:
                for val in field.validations:
                    if not val.supported:
                        report.unsupported_validations_used[val.name] = \
                            report.unsupported_validations_used.get(val.name, 0) + 1
                
                if field.widget and not field.widget.supported:
                    report.unsupported_widgets_used[field.widget.widget_id] = \
                        report.unsupported_widgets_used.get(field.widget.widget_id, 0) + 1
            
    except Exception as e:
        print_error(f"Failed to analyze content types: {e}")
        import traceback
        traceback.print_exc()
    
    return report


def print_report(report: AnalysisReport):
    """Print detailed analysis report"""
    
    print_header("ANALYSIS REPORT")
    
    # Overview
    print_subheader("Overview")
    print(f"  {'Contentful Space:':<25} {report.contentful_space_id}")
    print(f"  {'Contentful Environment:':<25} {report.contentful_environment}")
    print(f"  {'O2 Space:':<25} {report.o2_space_id}")
    print(f"  {'O2 Environment:':<25} {report.o2_environment}")
    print()
    print(f"  {'Content Types:':<25} {report.total_content_types}")
    print(f"  {'Entries:':<25} {report.total_entries}")
    print(f"  {'Assets:':<25} {report.total_assets}")
    print(f"  {'Locales:':<25} {report.total_locales}")
    
    # Compatibility summary
    print_subheader("Compatibility Summary")
    
    total = report.total_content_types
    full = report.fully_compatible_content_types
    partial = report.partially_compatible_content_types
    
    print(f"  {Colors.GREEN}Fully Compatible:{Colors.RESET}      {full}/{total} content types")
    print(f"  {Colors.YELLOW}Partially Compatible:{Colors.RESET}  {partial}/{total} content types")
    
    if report.unsupported_validations_used:
        print(f"\n  {Colors.YELLOW}Unsupported Validations Used:{Colors.RESET}")
        for val, count in sorted(report.unsupported_validations_used.items()):
            print(f"    - {val}: {count} field(s) - will be IGNORED")
    
    if report.unsupported_widgets_used:
        print(f"\n  {Colors.YELLOW}Unsupported Widgets Used:{Colors.RESET}")
        for widget, count in sorted(report.unsupported_widgets_used.items()):
            print(f"    - {widget}: {count} field(s) - will use FALLBACK")
    
    # Content Type Details
    print_subheader("Content Type Details")
    
    for ct in report.content_types:
        # Status icon
        if ct.fully_compatible:
            status = f"{Colors.GREEN}✓ COMPATIBLE{Colors.RESET}"
        else:
            status = f"{Colors.YELLOW}⚠ PARTIAL{Colors.RESET}"
        
        print(f"\n  {Colors.BOLD}{ct.name}{Colors.RESET} ({ct.content_type_id})")
        print(f"    Status: {status}")
        print(f"    Entries: {ct.entry_count}")
        print(f"    Fields: {len(ct.fields)}")
        
        # Field details
        for field in ct.fields:
            type_icon = f"{Colors.GREEN}✓{Colors.RESET}" if field.type_supported else f"{Colors.RED}✗{Colors.RESET}"
            req = f"{Colors.RED}*{Colors.RESET}" if field.required else ""
            loc = f"{Colors.CYAN}[L]{Colors.RESET}" if field.localized else ""
            
            print(f"      {type_icon} {field.field_id}: {field.field_type} {req}{loc}")
            
            # Show validations
            for val in field.validations:
                val_icon = f"{Colors.GREEN}✓{Colors.RESET}" if val.supported else f"{Colors.YELLOW}⚠{Colors.RESET}"
                print(f"        {val_icon} {val.name}: {val.details}")
            
            # Show widget if non-default
            if field.widget and field.widget.widget_id != "default":
                widget_icon = f"{Colors.GREEN}✓{Colors.RESET}" if field.widget.supported else f"{Colors.YELLOW}⚠{Colors.RESET}"
                fallback_note = f" → {field.widget.fallback}" if field.widget.fallback else ""
                print(f"        {widget_icon} widget: {field.widget.widget_id}{fallback_note}")
        
        # Show issues and warnings
        if ct.issues:
            print(f"    {Colors.RED}Issues:{Colors.RESET}")
            for issue in ct.issues[:5]:  # Limit to 5
                print(f"      - {issue}")
            if len(ct.issues) > 5:
                print(f"      ... and {len(ct.issues) - 5} more")
        
        if ct.warnings:
            print(f"    {Colors.YELLOW}Warnings:{Colors.RESET}")
            for warning in ct.warnings[:5]:  # Limit to 5
                print(f"      - {warning}")
            if len(ct.warnings) > 5:
                print(f"      ... and {len(ct.warnings) - 5} more")
    
    # Migration recommendation
    print_subheader("Migration Recommendation")
    
    if report.fully_compatible_content_types == report.total_content_types:
        print(f"  {Colors.GREEN}✅ All content types are fully compatible!{Colors.RESET}")
        print("  Migration can proceed without data loss.")
    else:
        print(f"  {Colors.YELLOW}⚠ Some features will be lost during migration:{Colors.RESET}")
        
        if report.unsupported_validations_used:
            print("\n  Validations that will be IGNORED (data still migrates, just no validation):")
            for val in report.unsupported_validations_used:
                print(f"    - {val}")
        
        if report.unsupported_widgets_used:
            print("\n  Widgets that will use FALLBACK (data still migrates, different UI):")
            for widget in report.unsupported_widgets_used:
                print(f"    - {widget}")
        
        print(f"\n  {Colors.CYAN}The actual content data will migrate successfully.{Colors.RESET}")
        print("  Only some CMS editing features will differ.")


def save_reports(report: AnalysisReport):
    """Save reports to files"""
    
    # Convert to dict for JSON
    def to_dict(obj):
        if hasattr(obj, '__dict__'):
            return {k: to_dict(v) for k, v in obj.__dict__.items()}
        elif isinstance(obj, list):
            return [to_dict(i) for i in obj]
        elif isinstance(obj, dict):
            return {k: to_dict(v) for k, v in obj.items()}
        return obj
    
    # Save JSON report
    json_path = "analysis_report.json"
    with open(json_path, 'w') as f:
        json.dump(to_dict(report), f, indent=2)
    print_success(f"Saved JSON report to {json_path}")
    
    # Save text summary
    txt_path = "analysis_report.txt"
    with open(txt_path, 'w') as f:
        f.write("CONTENTFUL TO O2 CMS MIGRATION ANALYSIS REPORT\n")
        f.write(f"Generated: {report.timestamp}\n")
        f.write("=" * 60 + "\n\n")
        
        f.write("OVERVIEW\n")
        f.write("-" * 40 + "\n")
        f.write(f"Contentful Space: {report.contentful_space_id}\n")
        f.write(f"O2 Space: {report.o2_space_id}\n")
        f.write(f"Content Types: {report.total_content_types}\n")
        f.write(f"Entries: {report.total_entries}\n")
        f.write(f"Assets: {report.total_assets}\n")
        f.write(f"Locales: {report.total_locales}\n\n")
        
        f.write("COMPATIBILITY\n")
        f.write("-" * 40 + "\n")
        f.write(f"Fully Compatible: {report.fully_compatible_content_types}/{report.total_content_types}\n")
        f.write(f"Partially Compatible: {report.partially_compatible_content_types}/{report.total_content_types}\n\n")
        
        if report.unsupported_validations_used:
            f.write("Unsupported Validations Used:\n")
            for val, count in report.unsupported_validations_used.items():
                f.write(f"  - {val}: {count} fields\n")
            f.write("\n")
        
        if report.unsupported_widgets_used:
            f.write("Unsupported Widgets Used:\n")
            for widget, count in report.unsupported_widgets_used.items():
                f.write(f"  - {widget}: {count} fields\n")
            f.write("\n")
        
        f.write("CONTENT TYPES\n")
        f.write("-" * 40 + "\n")
        for ct in report.content_types:
            status = "✓ COMPATIBLE" if ct.fully_compatible else "⚠ PARTIAL"
            f.write(f"\n{ct.name} ({ct.content_type_id})\n")
            f.write(f"  Status: {status}\n")
            f.write(f"  Entries: {ct.entry_count}\n")
            f.write(f"  Fields: {len(ct.fields)}\n")
            
            for field in ct.fields:
                req = "*" if field.required else ""
                loc = "[L]" if field.localized else ""
                f.write(f"    - {field.field_id}: {field.field_type} {req}{loc}\n")
            
            if ct.warnings:
                f.write("  Warnings:\n")
                for w in ct.warnings:
                    f.write(f"    - {w}\n")
    
    print_success(f"Saved text report to {txt_path}")


def main():
    """Main entry point"""
    
    print(f"\n{Colors.BOLD}{Colors.BLUE}")
    print("╔═══════════════════════════════════════════════════════════════╗")
    print("║   CONTENTFUL → O2 CMS MIGRATION ANALYSIS                     ║")
    print("║   Phase 1: Content Analysis                                   ║")
    print("╚═══════════════════════════════════════════════════════════════╝")
    print(f"{Colors.RESET}")
    
    try:
        # Run analysis
        report = run_analysis()
        
        # Print report
        print_report(report)
        
        # Save reports
        print_subheader("Saving Reports")
        save_reports(report)
        
        print(f"\n{Colors.GREEN}Analysis complete!{Colors.RESET}")
        print(f"Review the reports before proceeding with migration.\n")
        
        return 0
        
    except requests.exceptions.RequestException as e:
        print_error(f"API request failed: {e}")
        return 1
    except Exception as e:
        print_error(f"Analysis failed: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())

