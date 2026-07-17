export const editorialCss = `
  :root { color: #242522; background: #fff; font-family: Inter, Arial, sans-serif; }
  * { box-sizing: border-box; }
  @page { size: A4; margin: 20mm 17mm 20mm; }
  body { margin: 0; font-size: 10.5pt; line-height: 1.58; color: #343632; }
  .masthead { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 18px; border-bottom: 1px solid #dfe3dc; }
  .brand { font-size: 9px; letter-spacing: .16em; text-transform: uppercase; color: #6e746d; }
  .kind { font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: #39715c; }
  h1 { margin: 22px 0 10px; font-family: Georgia, 'Times New Roman', serif; font-weight: 400; font-size: 31pt; line-height: 1.08; color: #20211f; }
  .summary { max-width: 84%; margin: 0 0 22px; font-size: 12pt; color: #666b64; }
  .meta { display: flex; gap: 24px; padding: 12px 0; border-top: 1px solid #eceeea; border-bottom: 1px solid #eceeea; color: #737870; font-size: 9pt; }
  main { padding-top: 25px; }
  h2 { break-after: avoid; margin: 27px 0 8px; font-size: 16pt; color: #242622; }
  h3 { break-after: avoid; margin: 20px 0 7px; font-size: 12pt; color: #2c2f2b; }
  p { margin: 0 0 10px; white-space: pre-wrap; }
  ul, ol { margin: 7px 0 14px; padding-left: 22px; }
  li { margin: 4px 0; }
  .callout { margin: 18px 0; padding: 14px 16px; border-left: 3px solid #7eab99; background: #f4f8f6; }
  .materials { break-before: auto; margin-top: 30px; padding-top: 18px; border-top: 1px solid #dfe3dc; }
  .material { display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 9px 0; border-bottom: 1px solid #eceeea; }
  .material small { color: #7a7f78; }
  footer { position: fixed; bottom: -12mm; left: 0; right: 0; color: #888d86; font-size: 8pt; border-top: 1px solid #eceeea; padding-top: 7px; }
`;

export function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function textToEditorialHtml(value: string) {
  const lines = value.split(/\r?\n/u);
  const output: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => { if (list) output.push(`</${list}>`); list = null; };
  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
    const unordered = /^[-*]\s+(.+)$/u.exec(line);
    const ordered = /^\d+[.)]\s+(.+)$/u.exec(line);
    if (heading) { closeList(); const level = Math.min(3, heading[1]!.length + 1); output.push(`<h${level}>${escapeHtml(heading[2]!)}</h${level}>`); }
    else if (unordered || ordered) {
      const next = unordered ? "ul" : "ol";
      if (list !== next) { closeList(); list = next; output.push(`<${next}>`); }
      output.push(`<li>${escapeHtml((unordered ?? ordered)![1]!)}</li>`);
    } else if (line) { closeList(); output.push(`<p>${escapeHtml(raw)}</p>`); }
    else closeList();
  }
  closeList();
  return output.join("\n");
}
