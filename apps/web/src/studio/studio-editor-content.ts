import Link from "@tiptap/extension-link";
import { generateText, type JSONContent, type TextSerializer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

const serializeList: TextSerializer = ({ node }) => (
  node.textBetween(0, node.content.size, "\n", "\n")
);

export const studioEditorTextOptions = {
  blockSeparator: "\n",
  textSerializers: {
    bulletList: serializeList,
    orderedList: serializeList
  }
};

export function createStudioEditorExtensions() {
  return [
    StarterKit.configure({ link: false }),
    Link.configure({ openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer" } })
  ];
}

export function studioBodyText(bodyJson: Record<string, unknown>) {
  return generateText(
    bodyJson as JSONContent,
    createStudioEditorExtensions(),
    studioEditorTextOptions
  );
}
