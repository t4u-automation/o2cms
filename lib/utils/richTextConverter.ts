/**
 * Rich Text Converter
 * Converts between TipTap JSON and Contentful Rich Text JSON format
 */

import {
  BLOCKS,
  INLINES,
  MARKS,
  RichTextDocument,
  TextNode,
  Mark,
  createEmptyDocument,
  isRichTextDocument,
} from "@/types";

/**
 * TipTap JSON Node structure
 */
interface TipTapNode {
  type: string;
  attrs?: Record<string, any>;
  content?: TipTapNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, any> }[];
}

/**
 * TipTap JSON Document
 */
interface TipTapDocument {
  type: "doc";
  content: TipTapNode[];
}

/**
 * Map TipTap node types to Contentful BLOCKS
 */
const TIPTAP_TO_CONTENTFUL_BLOCKS: Record<string, BLOCKS> = {
  paragraph: BLOCKS.PARAGRAPH,
  heading: BLOCKS.PARAGRAPH, // Handled specially with attrs.level
  bulletList: BLOCKS.UL_LIST,
  orderedList: BLOCKS.OL_LIST,
  listItem: BLOCKS.LIST_ITEM,
  blockquote: BLOCKS.QUOTE,
  horizontalRule: BLOCKS.HR,
  table: BLOCKS.TABLE,
  tableRow: BLOCKS.TABLE_ROW,
  tableCell: BLOCKS.TABLE_CELL,
  tableHeader: BLOCKS.TABLE_HEADER_CELL,
  embeddedAsset: BLOCKS.EMBEDDED_ASSET,
  embeddedEntry: BLOCKS.EMBEDDED_ENTRY,
};

/**
 * Map TipTap mark types to Contentful MARKS
 */
const TIPTAP_TO_CONTENTFUL_MARKS: Record<string, MARKS> = {
  bold: MARKS.BOLD,
  italic: MARKS.ITALIC,
  underline: MARKS.UNDERLINE,
  code: MARKS.CODE,
  strike: MARKS.STRIKETHROUGH,
  subscript: MARKS.SUBSCRIPT,
  superscript: MARKS.SUPERSCRIPT,
};

/**
 * Map Contentful BLOCKS to TipTap node types
 */
const CONTENTFUL_TO_TIPTAP_BLOCKS: Record<string, string> = {
  [BLOCKS.DOCUMENT]: "doc",
  [BLOCKS.PARAGRAPH]: "paragraph",
  [BLOCKS.HEADING_1]: "heading",
  [BLOCKS.HEADING_2]: "heading",
  [BLOCKS.HEADING_3]: "heading",
  [BLOCKS.HEADING_4]: "heading",
  [BLOCKS.HEADING_5]: "heading",
  [BLOCKS.HEADING_6]: "heading",
  [BLOCKS.UL_LIST]: "bulletList",
  [BLOCKS.OL_LIST]: "orderedList",
  [BLOCKS.LIST_ITEM]: "listItem",
  [BLOCKS.QUOTE]: "blockquote",
  [BLOCKS.HR]: "horizontalRule",
  [BLOCKS.TABLE]: "table",
  [BLOCKS.TABLE_ROW]: "tableRow",
  [BLOCKS.TABLE_CELL]: "tableCell",
  [BLOCKS.TABLE_HEADER_CELL]: "tableHeader",
  [BLOCKS.EMBEDDED_ASSET]: "embeddedAsset",
  [BLOCKS.EMBEDDED_ENTRY]: "embeddedEntry",
};

/**
 * Map Contentful MARKS to TipTap mark types
 */
const CONTENTFUL_TO_TIPTAP_MARKS: Record<string, string> = {
  [MARKS.BOLD]: "bold",
  [MARKS.ITALIC]: "italic",
  [MARKS.UNDERLINE]: "underline",
  [MARKS.CODE]: "code",
  [MARKS.STRIKETHROUGH]: "strike",
  [MARKS.SUBSCRIPT]: "subscript",
  [MARKS.SUPERSCRIPT]: "superscript",
};

/**
 * Get heading level from Contentful nodeType
 */
function getHeadingLevel(nodeType: string): number {
  const match = nodeType.match(/heading-(\d)/);
  return match ? parseInt(match[1], 10) : 1;
}

/**
 * Get Contentful heading nodeType from level
 */
function getHeadingNodeType(level: number): BLOCKS {
  const headings: Record<number, BLOCKS> = {
    1: BLOCKS.HEADING_1,
    2: BLOCKS.HEADING_2,
    3: BLOCKS.HEADING_3,
    4: BLOCKS.HEADING_4,
    5: BLOCKS.HEADING_5,
    6: BLOCKS.HEADING_6,
  };
  return headings[level] || BLOCKS.HEADING_1;
}

/**
 * Convert TipTap marks to Contentful marks
 */
function convertTipTapMarks(tipTapMarks?: TipTapNode["marks"]): Mark[] {
  if (!tipTapMarks || tipTapMarks.length === 0) {
    return [];
  }

  return tipTapMarks
    .map((mark) => {
      const contentfulMark = TIPTAP_TO_CONTENTFUL_MARKS[mark.type];
      if (contentfulMark) {
        return { type: contentfulMark };
      }
      return null;
    })
    .filter((mark): mark is Mark => mark !== null);
}

/**
 * Convert Contentful marks to TipTap marks
 */
function convertContentfulMarks(
  contentfulMarks: Mark[]
): TipTapNode["marks"] {
  if (!contentfulMarks || contentfulMarks.length === 0) {
    return [];
  }

  return contentfulMarks
    .map((mark) => {
      const tipTapMark = CONTENTFUL_TO_TIPTAP_MARKS[mark.type];
      if (tipTapMark) {
        return { type: tipTapMark };
      }
      return null;
    })
    .filter((mark): mark is { type: string } => mark !== null);
}

/**
 * Convert a single TipTap node to Contentful node
 */
function convertTipTapNodeToContentful(node: TipTapNode): any {
  // Text node
  if (node.type === "text" && node.text !== undefined) {
    return {
      nodeType: "text",
      value: node.text,
      marks: convertTipTapMarks(node.marks),
      data: {},
    };
  }

  // Heading with level
  if (node.type === "heading") {
    const level = node.attrs?.level || 1;
    return {
      nodeType: getHeadingNodeType(level),
      data: {},
      content: (node.content || []).map(convertTipTapNodeToContentful),
    };
  }

  // Horizontal rule (no content)
  if (node.type === "horizontalRule") {
    return {
      nodeType: BLOCKS.HR,
      data: {},
      content: [],
    };
  }

  // Embedded Asset
  if (node.type === "embeddedAsset") {
    return {
      nodeType: BLOCKS.EMBEDDED_ASSET,
      data: {
        target: {
          sys: {
            type: "Link",
            linkType: "Asset",
            id: node.attrs?.assetId || "",
          },
        },
      },
      content: [],
    };
  }

  // Embedded Entry (block)
  if (node.type === "embeddedEntry") {
    return {
      nodeType: BLOCKS.EMBEDDED_ENTRY,
      data: {
        target: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: node.attrs?.entryId || "",
          },
        },
      },
      content: [],
    };
  }

  // Embedded Entry (inline)
  if (node.type === "embeddedEntryInline") {
    return {
      nodeType: INLINES.EMBEDDED_ENTRY,
      data: {
        target: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: node.attrs?.entryId || "",
          },
        },
      },
      content: [],
    };
  }

  // Link
  if (node.type === "link") {
    return {
      nodeType: INLINES.HYPERLINK,
      data: {
        uri: node.attrs?.href || "",
      },
      content: (node.content || []).map(convertTipTapNodeToContentful),
    };
  }

  // Table cell with attributes
  if (node.type === "tableCell" || node.type === "tableHeader") {
    const nodeType =
      node.type === "tableHeader"
        ? BLOCKS.TABLE_HEADER_CELL
        : BLOCKS.TABLE_CELL;
    return {
      nodeType,
      data: {
        colspan: node.attrs?.colspan || 1,
        rowspan: node.attrs?.rowspan || 1,
      },
      content: (node.content || []).map(convertTipTapNodeToContentful),
    };
  }

  // Default block node
  const contentfulNodeType = TIPTAP_TO_CONTENTFUL_BLOCKS[node.type];
  if (contentfulNodeType) {
    return {
      nodeType: contentfulNodeType,
      data: {},
      content: (node.content || []).map(convertTipTapNodeToContentful),
    };
  }

  // Unknown node type - wrap in paragraph
  console.warn(`Unknown TipTap node type: ${node.type}`);
  return {
    nodeType: BLOCKS.PARAGRAPH,
    data: {},
    content: (node.content || []).map(convertTipTapNodeToContentful),
  };
}

/**
 * Convert a single Contentful node to TipTap node
 */
function convertContentfulNodeToTipTap(node: any): TipTapNode | null {
  // Text node - skip empty text nodes as TipTap doesn't allow them
  if (node.nodeType === "text") {
    const textValue = node.value || "";
    if (!textValue) {
      return null; // Skip empty text nodes
    }
    return {
      type: "text",
      text: textValue,
      marks: convertContentfulMarks(node.marks || []),
    };
  }

  // Heading
  if (node.nodeType.startsWith("heading-")) {
    const level = getHeadingLevel(node.nodeType);
    return {
      type: "heading",
      attrs: { level },
      content: (node.content || [])
        .map(convertContentfulNodeToTipTap)
        .filter((n: TipTapNode | null): n is TipTapNode => n !== null),
    };
  }

  // Horizontal rule
  if (node.nodeType === BLOCKS.HR) {
    return {
      type: "horizontalRule",
    };
  }

  // Embedded Asset
  if (node.nodeType === BLOCKS.EMBEDDED_ASSET) {
    return {
      type: "embeddedAsset",
      attrs: {
        assetId: node.data?.target?.sys?.id || "",
      },
    };
  }

  // Embedded Entry (block)
  if (node.nodeType === BLOCKS.EMBEDDED_ENTRY) {
    return {
      type: "embeddedEntry",
      attrs: {
        entryId: node.data?.target?.sys?.id || "",
      },
    };
  }

  // Embedded Entry (inline)
  if (node.nodeType === INLINES.EMBEDDED_ENTRY) {
    return {
      type: "embeddedEntryInline",
      attrs: {
        entryId: node.data?.target?.sys?.id || "",
      },
    };
  }

  // Hyperlink - TipTap uses marks for links, not nodes
  // Combine all text content and return as single text node with link mark
  if (node.nodeType === INLINES.HYPERLINK) {
    const href = node.data?.uri || "";
    
    // Combine all text values from children
    const textValue = (node.content || [])
      .filter((child: any) => child.nodeType === "text")
      .map((child: any) => child.value || "")
      .join("");
    
    // Skip if no text content (empty hyperlinks)
    if (!textValue) {
      return null;
    }
    
    // Collect all marks from children and add link mark
    const childMarks = (node.content || [])
      .filter((child: any) => child.nodeType === "text")
      .flatMap((child: any) => (child.marks || []).map((m: any) => ({ type: CONTENTFUL_TO_TIPTAP_MARKS[m.type] || m.type })))
      .filter((m: any) => m.type);
    
    return {
      type: "text",
      text: textValue,
      marks: [...childMarks, { type: "link", attrs: { href } }],
    };
  }

  // Table cells
  if (
    node.nodeType === BLOCKS.TABLE_CELL ||
    node.nodeType === BLOCKS.TABLE_HEADER_CELL
  ) {
    const type =
      node.nodeType === BLOCKS.TABLE_HEADER_CELL ? "tableHeader" : "tableCell";
    return {
      type,
      attrs: {
        colspan: node.data?.colspan || 1,
        rowspan: node.data?.rowspan || 1,
      },
      content: (node.content || [])
        .map(convertContentfulNodeToTipTap)
        .filter((n: TipTapNode | null): n is TipTapNode => n !== null),
    };
  }

  // Default block node
  const tipTapType = CONTENTFUL_TO_TIPTAP_BLOCKS[node.nodeType];
  if (tipTapType) {
    const result: TipTapNode = {
      type: tipTapType,
    };

    if (node.content && node.content.length > 0) {
      result.content = node.content
        .map(convertContentfulNodeToTipTap)
        .filter((n: TipTapNode | null): n is TipTapNode => n !== null);
    }

    return result;
  }

  // Unknown node type
  console.warn(`Unknown Contentful node type: ${node.nodeType}`);
  return null;
}

/**
 * Convert TipTap JSON document to Contentful Rich Text document
 */
export function tipTapToContentful(tipTapDoc: TipTapDocument): RichTextDocument {
  if (!tipTapDoc || tipTapDoc.type !== "doc") {
    return createEmptyDocument();
  }

  const content = (tipTapDoc.content || []).map(convertTipTapNodeToContentful);

  // Ensure we have at least one paragraph
  if (content.length === 0) {
    return createEmptyDocument();
  }

  return {
    nodeType: BLOCKS.DOCUMENT,
    data: {},
    content,
  };
}

/**
 * Convert Contentful Rich Text document to TipTap JSON document
 */
export function contentfulToTipTap(
  contentfulDoc: RichTextDocument
): TipTapDocument {
  if (!isRichTextDocument(contentfulDoc)) {
    return {
      type: "doc",
      content: [{ type: "paragraph" }],
    };
  }

  const content = (contentfulDoc.content || [])
    .map(convertContentfulNodeToTipTap)
    .filter((n): n is TipTapNode => n !== null);

  // Ensure we have at least one paragraph
  if (content.length === 0) {
    return {
      type: "doc",
      content: [{ type: "paragraph" }],
    };
  }

  return {
    type: "doc",
    content,
  };
}

/**
 * Parse Rich Text value (handles both legacy HTML and JSON format)
 * Returns TipTap-compatible content
 */
export function parseRichTextValue(value: any): TipTapDocument | string {
  // Empty value
  if (!value) {
    return {
      type: "doc",
      content: [{ type: "paragraph" }],
    };
  }

  // Legacy HTML string - return as-is for TipTap to parse
  if (typeof value === "string") {
    return value;
  }

  // Contentful JSON format - convert to TipTap
  if (isRichTextDocument(value)) {
    return contentfulToTipTap(value);
  }

  // Unknown format - return empty doc
  return {
    type: "doc",
    content: [{ type: "paragraph" }],
  };
}

/**
 * Serialize Rich Text value to Contentful JSON format
 */
export function serializeRichTextValue(
  tipTapDoc: TipTapDocument
): RichTextDocument {
  return tipTapToContentful(tipTapDoc);
}

/**
 * Extract all embedded asset IDs from a Rich Text document
 */
export function extractEmbeddedAssetIds(doc: RichTextDocument): string[] {
  const assetIds: string[] = [];

  function traverse(nodes: any[]) {
    for (const node of nodes) {
      if (node.nodeType === BLOCKS.EMBEDDED_ASSET) {
        const assetId = node.data?.target?.sys?.id;
        if (assetId) {
          assetIds.push(assetId);
        }
      }
      if (node.content && Array.isArray(node.content)) {
        traverse(node.content);
      }
    }
  }

  if (doc.content) {
    traverse(doc.content);
  }

  return assetIds;
}

/**
 * Extract all embedded entry IDs from a Rich Text document
 */
export function extractEmbeddedEntryIds(doc: RichTextDocument): string[] {
  const entryIds: string[] = [];

  function traverse(nodes: any[]) {
    for (const node of nodes) {
      if (
        node.nodeType === BLOCKS.EMBEDDED_ENTRY ||
        node.nodeType === INLINES.EMBEDDED_ENTRY
      ) {
        const entryId = node.data?.target?.sys?.id;
        if (entryId) {
          entryIds.push(entryId);
        }
      }
      if (node.content && Array.isArray(node.content)) {
        traverse(node.content);
      }
    }
  }

  if (doc.content) {
    traverse(doc.content);
  }

  return entryIds;
}

