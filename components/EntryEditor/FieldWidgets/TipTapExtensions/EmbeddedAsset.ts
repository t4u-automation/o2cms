/**
 * TipTap Extension: Embedded Asset
 * Renders embedded assets (images, videos, files) in the Rich Text editor
 */

import { Node, mergeAttributes } from "@tiptap/core";

export interface EmbeddedAssetOptions {
  HTMLAttributes: Record<string, any>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embeddedAsset: {
      /**
       * Insert an embedded asset
       */
      setEmbeddedAsset: (options: { assetId: string }) => ReturnType;
    };
  }
}

export const EmbeddedAsset = Node.create<EmbeddedAssetOptions>({
  name: "embeddedAsset",

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
      assetId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-asset-id"),
        renderHTML: (attributes) => {
          if (!attributes.assetId) {
            return {};
          }
          return {
            "data-asset-id": attributes.assetId,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="embedded-asset"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "embedded-asset",
        class: "embedded-asset-node",
      }),
      ["span", { class: "embedded-asset-placeholder" }, "📷 Embedded Asset"],
    ];
  },

  addCommands() {
    return {
      setEmbeddedAsset:
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

export default EmbeddedAsset;
