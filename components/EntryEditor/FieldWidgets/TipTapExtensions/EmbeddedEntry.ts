/**
 * TipTap Extension: Embedded Entry
 * Renders embedded entries in the Rich Text editor
 */

import { Node, mergeAttributes } from "@tiptap/core";

export interface EmbeddedEntryOptions {
  HTMLAttributes: Record<string, any>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embeddedEntry: {
      /**
       * Insert an embedded entry
       */
      setEmbeddedEntry: (options: { entryId: string }) => ReturnType;
    };
  }
}

export const EmbeddedEntry = Node.create<EmbeddedEntryOptions>({
  name: "embeddedEntry",

  group: "block",

  atom: true,

  draggable: true,

  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      entryId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-entry-id"),
        renderHTML: (attributes) => {
          if (!attributes.entryId) {
            return {};
          }
          return {
            "data-entry-id": attributes.entryId,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="embedded-entry"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "embedded-entry",
        class: "embedded-entry-node",
      }),
      ["span", { class: "embedded-entry-placeholder" }, "📄 Embedded Entry"],
    ];
  },

  addCommands() {
    return {
      setEmbeddedEntry:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },
});

export default EmbeddedEntry;
