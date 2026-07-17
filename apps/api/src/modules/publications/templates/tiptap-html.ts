import { escapeHtml } from "./editorial.css";

type TiptapNode = {
  type?: unknown;
  attrs?: unknown;
  content?: unknown;
  marks?: unknown;
  text?: unknown;
};

type TiptapMark = { type?: unknown; attrs?: unknown };

export function tiptapDocumentToHtml(value: Record<string, unknown>) {
  if (value.type !== "doc" || !Array.isArray(value.content)) return null;
  return value.content.map((node) => renderNode(node)).join("\n");
}

function renderNode(value: unknown): string {
  if (!isRecord(value)) return "";
  const node = value as TiptapNode;
  const children = Array.isArray(node.content) ? node.content.map(renderNode).join("") : "";

  switch (node.type) {
    case "text": return applyMarks(escapeHtml(typeof node.text === "string" ? node.text : ""), node.marks);
    case "paragraph": return children ? `<p>${children}</p>` : '<p class="studio-sheet__spacer" aria-hidden="true">&nbsp;</p>';
    case "heading": {
      const attrs = isRecord(node.attrs) ? node.attrs : {};
      const level = attrs.level === 3 ? 3 : 2;
      return `<h${level}>${children}</h${level}>`;
    }
    case "bulletList": return `<ul>${children}</ul>`;
    case "orderedList": return `<ol>${children}</ol>`;
    case "listItem": return `<li>${children}</li>`;
    case "hardBreak": return "<br>";
    case "doc": return children;
    default: return children;
  }
}

function applyMarks(text: string, marks: unknown) {
  if (!Array.isArray(marks)) return text;
  return marks.reduce((result, rawMark) => {
    if (!isRecord(rawMark)) return result;
    const mark = rawMark as TiptapMark;
    if (mark.type === "bold") return `<strong>${result}</strong>`;
    if (mark.type === "italic") return `<em>${result}</em>`;
    if (mark.type !== "link" || !isRecord(mark.attrs)) return result;
    const href = safeHref(mark.attrs.href);
    return href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${result}</a>` : result;
  }, text);
}

function safeHref(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
