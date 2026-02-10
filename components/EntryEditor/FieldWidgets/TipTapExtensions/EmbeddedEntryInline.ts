import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import EmbeddedEntryInlineNode from "./EmbeddedEntryInlineNode";

export interface EmbeddedEntryInlineOptions {
  entries: any[];
  contentTypes: any[];
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embeddedEntryInline: {
      setEmbeddedEntryInline: (options: { entryId: string }) => ReturnType;
    };
  }
}

export const EmbeddedEntryInline = Node.create<EmbeddedEntryInlineOptions>({
  name: "embeddedEntryInline",

  group: "inline",

  inline: true,

  atom: true,

  addOptions() {
    return {
      entries: [],
      contentTypes: [],
    };
  },

  addAttributes() {
    return {
      entryId: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-embedded-entry-inline]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-embedded-entry-inline': '' })];
  },

  addCommands() {
    return {
      setEmbeddedEntryInline:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbeddedEntryInlineNode);
  },
});

export default EmbeddedEntryInline;




