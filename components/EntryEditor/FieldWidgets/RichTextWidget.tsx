"use client";

import { ContentTypeField, Asset, Entry, ContentType, RichTextDocument, isRichTextDocument } from "@/types";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { EmbeddedAssetNode, EmbeddedEntryNode, EmbeddedEntryInline } from "./TipTapExtensions";
import {
  tipTapToContentful,
  contentfulToTipTap,
  parseRichTextValue,
} from "@/lib/utils/richTextConverter";
import { 
  Bold, 
  Italic, 
  Underline as UnderlineIcon, 
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListOrdered,
  Quote,
  Minus,
  Table as TableIcon,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Link as LinkIcon,
  Image as ImageIcon,
  FileText,
  Plus,
  ChevronDown,
  Type,
} from "lucide-react";

interface RichTextWidgetProps {
  field: ContentTypeField;
  value: RichTextDocument | string;
  onChange: (value: RichTextDocument) => void;
  disabled?: boolean;
  error?: boolean;
  assets?: Asset[];
  entries?: Entry[];
  contentTypes?: ContentType[];
  onInsertAsset?: () => Promise<string | null>; // Returns asset ID or null if cancelled
  onInsertEntry?: () => Promise<string | null>; // Returns entry ID or null if cancelled
}

export default function RichTextWidget({
  field,
  value,
  onChange,
  disabled = false,
  error = false,
  assets = [],
  entries = [],
  contentTypes = [],
  onInsertAsset,
  onInsertEntry,
}: RichTextWidgetProps) {
  const [characterCount, setCharacterCount] = useState(0);
  const [showEmbedMenu, setShowEmbedMenu] = useState(false);
  const embedMenuRef = useRef<HTMLDivElement>(null);
  
  // Track if update is from editor (internal) vs external prop change
  const isInternalUpdate = useRef(false);
  // Track if editor has fully initialized (to skip initial normalization updates)
  const isEditorReady = useRef(false);
  
  // Close embed menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (embedMenuRef.current && !embedMenuRef.current.contains(event.target as Node)) {
        setShowEmbedMenu(false);
      }
    };
    
    if (showEmbedMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showEmbedMenu]);

  // Get enabled formats from field configuration
  const enabledFormats = field.appearance?.settings?.enabledFormats || [];
  
  // Get validation constraints
  const sizeValidation = field.validations.find((v) => v.size);
  const maxLength = sizeValidation?.size?.max;

  // Check if a format is enabled
  const isFormatEnabled = useCallback((format: string) => {
    if (enabledFormats.length === 0) return true; // All enabled by default
    return enabledFormats.includes(format);
  }, [enabledFormats]);

  // Check if embedded assets/entries are enabled
  const isEmbeddedAssetEnabled = isFormatEnabled("embeddedAsset") || enabledFormats.length === 0;
  const isEmbeddedEntryEnabled = isFormatEnabled("embeddedEntry") || enabledFormats.length === 0;

  // Parse initial value to TipTap format
  const initialContent = useMemo(() => {
    const parsed = parseRichTextValue(value);
    // If it's a string (legacy HTML), TipTap will parse it directly
    // If it's a TipTap document, use it as-is
    return typeof parsed === "string" ? parsed : parsed;
  }, []);

  // Configure TipTap extensions based on enabled formats
  const extensions = useMemo(() => [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3, 4, 5, 6].filter((level) => 
          isFormatEnabled(`h${level}`)
        ) as [1, 2, 3, 4, 5, 6],
      },
      bold: isFormatEnabled("bold"),
      italic: isFormatEnabled("italic"),
      strike: isFormatEnabled("strikethrough"),
      code: isFormatEnabled("code"),
      bulletList: isFormatEnabled("ul"),
      orderedList: isFormatEnabled("ol"),
      blockquote: isFormatEnabled("quote"),
      horizontalRule: isFormatEnabled("hr"),
    }),
    ...(isFormatEnabled("underline") ? [Underline] : []),
    ...(isFormatEnabled("subscript") ? [Subscript] : []),
    ...(isFormatEnabled("superscript") ? [Superscript] : []),
    ...(isFormatEnabled("table") ? [
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
    ] : []),
    ...(isFormatEnabled("link") ? [
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-[var(--text-primary)] underline",
        },
      }),
    ] : []),
    TextAlign.configure({
      types: ["heading", "paragraph"],
    }),
    // Add embedded content extensions with data
    ...(isEmbeddedAssetEnabled ? [EmbeddedAssetNode.configure({ assets })] : []),
    ...(isEmbeddedEntryEnabled ? [EmbeddedEntryNode.configure({ entries, contentTypes })] : []),
    ...(isEmbeddedEntryEnabled ? [EmbeddedEntryInline.configure({ entries, contentTypes })] : []),
  ], [isFormatEnabled, isEmbeddedAssetEnabled, isEmbeddedEntryEnabled, assets, entries, contentTypes]);

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      // Skip updates during initial editor setup (TipTap normalizes content on load)
      if (!isEditorReady.current) {
        return;
      }
      
      // Mark this as an internal update to prevent useEffect from resetting content
      isInternalUpdate.current = true;
      
      // Convert TipTap JSON to Contentful Rich Text JSON
      const tipTapDoc = editor.getJSON() as any;
      const contentfulDoc = tipTapToContentful(tipTapDoc);
      onChange(contentfulDoc);
      setCharacterCount(editor.getText().length);
      
      // Reset flag after a short delay to allow the state update to propagate
      setTimeout(() => {
        isInternalUpdate.current = false;
      }, 100);
    },
    onCreate: ({ editor }) => {
      setCharacterCount(editor.getText().length);
      // Mark editor as ready after a short delay to let TipTap finish normalizing
      setTimeout(() => {
        isEditorReady.current = true;
      }, 100);
    },
  });

  // Update editor content when value changes externally
  useEffect(() => {
    if (!editor) return;
    
    // Skip if this is an internal update (user is typing)
    if (isInternalUpdate.current) return;

    // Parse the new value
    const parsed = parseRichTextValue(value);
    const currentJson = JSON.stringify(editor.getJSON());
    const newJson = typeof parsed === "string" 
      ? null  // Don't compare HTML strings
      : JSON.stringify(parsed);

    // Only update if content is different (to avoid infinite loops)
    // Use queueMicrotask to avoid flushSync warning
    if (newJson && currentJson !== newJson) {
      queueMicrotask(() => {
        editor.commands.setContent(parsed);
      });
    } else if (typeof parsed === "string") {
      // For HTML strings, compare rendered HTML
      if (parsed !== editor.getHTML()) {
        queueMicrotask(() => {
          editor.commands.setContent(parsed);
        });
      }
    }
  }, [value, editor]);

  // Update editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled);
    }
  }, [disabled, editor]);

  // Handle inserting an asset
  const handleInsertAsset = useCallback(async () => {
    if (!editor || !onInsertAsset) return;
    
    const assetId = await onInsertAsset();
    if (assetId) {
      editor.chain().focus().setEmbeddedAsset({ assetId }).run();
    }
  }, [editor, onInsertAsset]);

  // Handle inserting an entry (block)
  const handleInsertEntry = useCallback(async () => {
    if (!editor || !onInsertEntry) return;
    
    const entryId = await onInsertEntry();
    if (entryId) {
      editor.chain().focus().setEmbeddedEntry({ entryId }).run();
    }
  }, [editor, onInsertEntry]);

  // Handle inserting an inline entry
  const handleInsertInlineEntry = useCallback(async () => {
    if (!editor || !onInsertEntry) return;
    
    const entryId = await onInsertEntry();
    if (entryId) {
      editor.chain().focus().setEmbeddedEntryInline({ entryId }).run();
    }
  }, [editor, onInsertEntry]);

  if (!editor) {
    return (
      <div className="border border-[var(--border-main)] rounded-[6px] p-4 bg-gray-50">
        <div className="text-sm text-[var(--text-secondary)]">
          Loading editor...
        </div>
      </div>
    );
  }

  // Toolbar button component
  const ToolbarButton = ({ 
    icon: Icon, 
    onClick, 
    title,
    isActive = false,
    isEnabled = true 
  }: { 
    icon: any; 
    onClick: () => void; 
    title: string;
    isActive?: boolean;
    isEnabled?: boolean;
  }) => {
    if (!isEnabled) return null;
    
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={`p-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          isActive
            ? "bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)]"
            : "hover:bg-gray-100 text-[var(--icon-secondary)]"
        }`}
      >
        <Icon size={16} />
      </button>
    );
  };

  const setLink = () => {
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("URL", previousUrl);

    // cancelled
    if (url === null) {
      return;
    }

    // empty
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    // update link
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className={`border rounded-[6px] overflow-hidden ${
      error ? "border-red-500" : "border-[var(--border-main)]"
    }`}>
      {/* Toolbar */}
      <div className="bg-gray-50 border-b border-[var(--border-main)] p-2 flex items-center gap-1 flex-wrap">
        {/* Headings */}
        {(isFormatEnabled("h1") || isFormatEnabled("h2") || isFormatEnabled("h3") || 
          isFormatEnabled("h4") || isFormatEnabled("h5") || isFormatEnabled("h6")) && (
          <div className="flex gap-1 border-r pr-2 mr-2">
            <ToolbarButton
              icon={Heading1}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              title="Heading 1"
              isActive={editor.isActive("heading", { level: 1 })}
              isEnabled={isFormatEnabled("h1")}
            />
            <ToolbarButton
              icon={Heading2}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              title="Heading 2"
              isActive={editor.isActive("heading", { level: 2 })}
              isEnabled={isFormatEnabled("h2")}
            />
            <ToolbarButton
              icon={Heading3}
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              title="Heading 3"
              isActive={editor.isActive("heading", { level: 3 })}
              isEnabled={isFormatEnabled("h3")}
            />
            <ToolbarButton
              icon={Heading4}
              onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
              title="Heading 4"
              isActive={editor.isActive("heading", { level: 4 })}
              isEnabled={isFormatEnabled("h4")}
            />
            <ToolbarButton
              icon={Heading5}
              onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()}
              title="Heading 5"
              isActive={editor.isActive("heading", { level: 5 })}
              isEnabled={isFormatEnabled("h5")}
            />
            <ToolbarButton
              icon={Heading6}
              onClick={() => editor.chain().focus().toggleHeading({ level: 6 }).run()}
              title="Heading 6"
              isActive={editor.isActive("heading", { level: 6 })}
              isEnabled={isFormatEnabled("h6")}
            />
          </div>
        )}

        {/* Text Formatting */}
        <div className="flex gap-1 border-r pr-2 mr-2">
          <ToolbarButton
            icon={Bold}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold"
            isActive={editor.isActive("bold")}
            isEnabled={isFormatEnabled("bold")}
          />
          <ToolbarButton
            icon={Italic}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic"
            isActive={editor.isActive("italic")}
            isEnabled={isFormatEnabled("italic")}
          />
          <ToolbarButton
            icon={UnderlineIcon}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            title="Underline"
            isActive={editor.isActive("underline")}
            isEnabled={isFormatEnabled("underline")}
          />
          <ToolbarButton
            icon={Strikethrough}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title="Strikethrough"
            isActive={editor.isActive("strike")}
            isEnabled={isFormatEnabled("strikethrough")}
          />
          <ToolbarButton
            icon={Code}
            onClick={() => editor.chain().focus().toggleCode().run()}
            title="Code"
            isActive={editor.isActive("code")}
            isEnabled={isFormatEnabled("code")}
          />
          <ToolbarButton
            icon={SuperscriptIcon}
            onClick={() => editor.chain().focus().toggleSuperscript().run()}
            title="Superscript"
            isActive={editor.isActive("superscript")}
            isEnabled={isFormatEnabled("superscript")}
          />
          <ToolbarButton
            icon={SubscriptIcon}
            onClick={() => editor.chain().focus().toggleSubscript().run()}
            title="Subscript"
            isActive={editor.isActive("subscript")}
            isEnabled={isFormatEnabled("subscript")}
          />
        </div>

        {/* Lists */}
        {(isFormatEnabled("ul") || isFormatEnabled("ol")) && (
          <div className="flex gap-1 border-r pr-2 mr-2">
            <ToolbarButton
              icon={List}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              title="Bullet List"
              isActive={editor.isActive("bulletList")}
              isEnabled={isFormatEnabled("ul")}
            />
            <ToolbarButton
              icon={ListOrdered}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              title="Numbered List"
              isActive={editor.isActive("orderedList")}
              isEnabled={isFormatEnabled("ol")}
            />
          </div>
        )}

        {/* Other formatting */}
        <div className="flex gap-1 border-r pr-2 mr-2">
          <ToolbarButton
            icon={Quote}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title="Quote"
            isActive={editor.isActive("blockquote")}
            isEnabled={isFormatEnabled("quote")}
          />
          <ToolbarButton
            icon={Minus}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Horizontal Rule"
            isEnabled={isFormatEnabled("hr")}
          />
          <ToolbarButton
            icon={LinkIcon}
            onClick={setLink}
            title="Link"
            isActive={editor.isActive("link")}
            isEnabled={isFormatEnabled("link")}
          />
          <ToolbarButton
            icon={TableIcon}
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            title="Insert Table"
            isEnabled={isFormatEnabled("table")}
          />
        </div>

        {/* Embed Dropdown */}
        {(isEmbeddedAssetEnabled || isEmbeddedEntryEnabled) && (onInsertAsset || onInsertEntry) && (
          <div className="relative" ref={embedMenuRef}>
            <button
              type="button"
              onClick={() => setShowEmbedMenu(!showEmbedMenu)}
              disabled={disabled}
              className={`flex items-center gap-1 px-2 py-1.5 rounded text-sm font-medium transition-colors ${
                showEmbedMenu
                  ? "bg-[var(--fill-tsp-gray-main)] text-[var(--text-primary)]"
                  : "hover:bg-gray-100 text-[var(--text-secondary)]"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <Plus size={14} />
              <span>Embed</span>
              <ChevronDown size={14} />
            </button>
            
            {showEmbedMenu && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-[var(--border-main)] rounded-lg shadow-lg py-1 z-50 min-w-[160px]">
                {isEmbeddedEntryEnabled && onInsertEntry && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmbedMenu(false);
                      handleInsertEntry();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 text-[var(--text-primary)]"
                  >
                    <FileText size={16} className="text-[var(--icon-secondary)]" />
                    <span>Entry</span>
                  </button>
                )}
                {isEmbeddedEntryEnabled && onInsertEntry && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmbedMenu(false);
                      handleInsertInlineEntry();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 text-[var(--text-primary)]"
                  >
                    <Type size={16} className="text-[var(--icon-secondary)]" />
                    <span>Inline entry</span>
                  </button>
                )}
                {isEmbeddedAssetEnabled && onInsertAsset && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmbedMenu(false);
                      handleInsertAsset();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 text-[var(--text-primary)]"
                  >
                    <ImageIcon size={16} className="text-[var(--icon-secondary)]" />
                    <span>Asset</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Editor Content */}
      <div 
        className="p-4 min-h-[300px] cursor-text"
        onClick={() => editor?.commands.focus()}
      >
        <EditorContent 
          editor={editor} 
          className="prose prose-sm max-w-none focus:outline-none min-h-[280px]"
        />
      </div>

      {/* Character count */}
      {maxLength && (
        <div className="px-4 py-2 bg-gray-50 border-t border-[var(--border-main)] text-xs text-[var(--text-tertiary)] text-right">
          {characterCount} {maxLength && `/ ${maxLength}`} characters
        </div>
      )}

      {/* TipTap styles */}
      <style jsx global>{`
        .ProseMirror {
          outline: none;
          min-height: 280px;
        }
        .ProseMirror:focus {
          outline: none;
        }
        .ProseMirror p {
          margin: 0.5rem 0;
        }
        .ProseMirror h1 {
          font-size: 2rem;
          font-weight: bold;
          margin: 1rem 0 0.5rem;
        }
        .ProseMirror h2 {
          font-size: 1.5rem;
          font-weight: bold;
          margin: 1rem 0 0.5rem;
        }
        .ProseMirror h3 {
          font-size: 1.25rem;
          font-weight: bold;
          margin: 0.75rem 0 0.5rem;
        }
        .ProseMirror h4 {
          font-size: 1.125rem;
          font-weight: bold;
          margin: 0.75rem 0 0.5rem;
        }
        .ProseMirror h5 {
          font-size: 1rem;
          font-weight: bold;
          margin: 0.5rem 0;
        }
        .ProseMirror h6 {
          font-size: 0.875rem;
          font-weight: bold;
          margin: 0.5rem 0;
        }
        .ProseMirror ul,
        .ProseMirror ol {
          padding-left: 1.5rem;
          margin: 0.5rem 0;
        }
        .ProseMirror blockquote {
          border-left: 3px solid #d1d5db;
          padding-left: 1rem;
          margin: 1rem 0;
          color: #6b7280;
        }
        .ProseMirror code {
          background-color: #f3f4f6;
          padding: 0.125rem 0.25rem;
          border-radius: 0.25rem;
          font-family: monospace;
          font-size: 0.875em;
        }
        .ProseMirror pre {
          background-color: #1f2937;
          color: #f9fafb;
          padding: 0.75rem;
          border-radius: 0.375rem;
          overflow-x: auto;
          margin: 1rem 0;
        }
        .ProseMirror pre code {
          background: none;
          color: inherit;
          padding: 0;
        }
        .ProseMirror hr {
          border: none;
          border-top: 2px solid #e5e7eb;
          margin: 1.5rem 0;
        }
        .ProseMirror table {
          border-collapse: collapse;
          margin: 1rem 0;
          width: 100%;
        }
        .ProseMirror th,
        .ProseMirror td {
          border: 1px solid #d1d5db;
          padding: 0.5rem;
          text-align: left;
        }
        .ProseMirror th {
          background-color: #f3f4f6;
          font-weight: bold;
        }
        /* Embedded content styles */
        .ProseMirror .embedded-asset-node,
        .ProseMirror .embedded-entry-node {
          border: 2px dashed #d1d5db;
          border-radius: 8px;
          padding: 1rem;
          margin: 0.5rem 0;
          background-color: #f9fafb;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .ProseMirror .embedded-asset-node.ProseMirror-selectednode,
        .ProseMirror .embedded-entry-node.ProseMirror-selectednode {
          border-color: #3b82f6;
          background-color: #eff6ff;
        }
        .ProseMirror .embedded-asset-placeholder,
        .ProseMirror .embedded-entry-placeholder {
          color: #6b7280;
          font-size: 0.875rem;
        }
      `}</style>
    </div>
  );
}
