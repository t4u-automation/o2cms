// ============================================
// Contentful-Compatible Rich Text Types
// Based on @contentful/rich-text-types
// ============================================

/**
 * Block-level node types
 */
export enum BLOCKS {
  DOCUMENT = "document",
  PARAGRAPH = "paragraph",
  HEADING_1 = "heading-1",
  HEADING_2 = "heading-2",
  HEADING_3 = "heading-3",
  HEADING_4 = "heading-4",
  HEADING_5 = "heading-5",
  HEADING_6 = "heading-6",
  OL_LIST = "ordered-list",
  UL_LIST = "unordered-list",
  LIST_ITEM = "list-item",
  HR = "hr",
  QUOTE = "blockquote",
  EMBEDDED_ENTRY = "embedded-entry-block",
  EMBEDDED_ASSET = "embedded-asset-block",
  TABLE = "table",
  TABLE_ROW = "table-row",
  TABLE_CELL = "table-cell",
  TABLE_HEADER_CELL = "table-header-cell",
}

/**
 * Inline-level node types
 */
export enum INLINES {
  HYPERLINK = "hyperlink",
  ENTRY_HYPERLINK = "entry-hyperlink",
  ASSET_HYPERLINK = "asset-hyperlink",
  EMBEDDED_ENTRY = "embedded-entry-inline",
}

/**
 * Text mark types (formatting)
 */
export enum MARKS {
  BOLD = "bold",
  ITALIC = "italic",
  UNDERLINE = "underline",
  CODE = "code",
  SUPERSCRIPT = "superscript",
  SUBSCRIPT = "subscript",
  STRIKETHROUGH = "strikethrough",
}

/**
 * Mark applied to text
 */
export interface Mark {
  type: MARKS;
}

/**
 * Link reference structure (for embedded assets/entries)
 */
export interface LinkReference {
  sys: {
    type: "Link";
    linkType: "Asset" | "Entry";
    id: string;
  };
}

/**
 * Base node interface
 */
export interface BaseNode {
  nodeType: string;
  data: Record<string, any>;
}

/**
 * Text node (leaf node with actual text content)
 */
export interface TextNode {
  nodeType: "text";
  value: string;
  marks: Mark[];
  data: Record<string, any>;
}

/**
 * Block node (contains other nodes)
 */
export interface BlockNode extends BaseNode {
  nodeType: BLOCKS;
  content: (BlockNode | InlineNode | TextNode)[];
}

/**
 * Inline node (within text flow)
 */
export interface InlineNode extends BaseNode {
  nodeType: INLINES;
  content: TextNode[];
}

/**
 * Embedded Asset Block
 */
export interface EmbeddedAssetBlock extends BaseNode {
  nodeType: BLOCKS.EMBEDDED_ASSET;
  data: {
    target: LinkReference;
  };
  content: [];
}

/**
 * Embedded Entry Block
 */
export interface EmbeddedEntryBlock extends BaseNode {
  nodeType: BLOCKS.EMBEDDED_ENTRY;
  data: {
    target: LinkReference;
  };
  content: [];
}

/**
 * Embedded Entry Inline
 */
export interface EmbeddedEntryInline extends BaseNode {
  nodeType: INLINES.EMBEDDED_ENTRY;
  data: {
    target: LinkReference;
  };
  content: TextNode[];
}

/**
 * Hyperlink node
 */
export interface HyperlinkNode extends BaseNode {
  nodeType: INLINES.HYPERLINK;
  data: {
    uri: string;
  };
  content: TextNode[];
}

/**
 * Entry Hyperlink node
 */
export interface EntryHyperlinkNode extends BaseNode {
  nodeType: INLINES.ENTRY_HYPERLINK;
  data: {
    target: LinkReference;
  };
  content: TextNode[];
}

/**
 * Asset Hyperlink node
 */
export interface AssetHyperlinkNode extends BaseNode {
  nodeType: INLINES.ASSET_HYPERLINK;
  data: {
    target: LinkReference;
  };
  content: TextNode[];
}

/**
 * Document node (root of Rich Text)
 */
export interface RichTextDocument {
  nodeType: BLOCKS.DOCUMENT;
  data: Record<string, any>;
  content: (BlockNode | EmbeddedAssetBlock | EmbeddedEntryBlock)[];
}

/**
 * Any Rich Text node type
 */
export type RichTextNode =
  | RichTextDocument
  | BlockNode
  | InlineNode
  | TextNode
  | EmbeddedAssetBlock
  | EmbeddedEntryBlock
  | EmbeddedEntryInline
  | HyperlinkNode
  | EntryHyperlinkNode
  | AssetHyperlinkNode;

/**
 * Helper to create an empty Rich Text document
 */
export function createEmptyDocument(): RichTextDocument {
  return {
    nodeType: BLOCKS.DOCUMENT,
    data: {},
    content: [
      {
        nodeType: BLOCKS.PARAGRAPH,
        data: {},
        content: [
          {
            nodeType: "text",
            value: "",
            marks: [],
            data: {},
          },
        ],
      },
    ],
  };
}

/**
 * Helper to create a text node
 */
export function createTextNode(value: string, marks: Mark[] = []): TextNode {
  return {
    nodeType: "text",
    value,
    marks,
    data: {},
  };
}

/**
 * Helper to create an embedded asset block
 */
export function createEmbeddedAssetBlock(assetId: string): EmbeddedAssetBlock {
  return {
    nodeType: BLOCKS.EMBEDDED_ASSET,
    data: {
      target: {
        sys: {
          type: "Link",
          linkType: "Asset",
          id: assetId,
        },
      },
    },
    content: [],
  };
}

/**
 * Helper to create an embedded entry block
 */
export function createEmbeddedEntryBlock(entryId: string): EmbeddedEntryBlock {
  return {
    nodeType: BLOCKS.EMBEDDED_ENTRY,
    data: {
      target: {
        sys: {
          type: "Link",
          linkType: "Entry",
          id: entryId,
        },
      },
    },
    content: [],
  };
}

/**
 * Check if a value is a valid Rich Text document
 */
export function isRichTextDocument(value: any): value is RichTextDocument {
  return (
    value &&
    typeof value === "object" &&
    value.nodeType === BLOCKS.DOCUMENT &&
    Array.isArray(value.content)
  );
}

/**
 * Check if a value is a Rich Text node (document or legacy HTML string)
 */
export function isRichTextValue(value: any): boolean {
  // Accept both Contentful JSON format and legacy HTML strings
  if (typeof value === "string") {
    return true; // Legacy HTML format
  }
  return isRichTextDocument(value);
}




