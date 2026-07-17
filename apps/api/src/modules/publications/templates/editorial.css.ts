export const editorialCss = `
  :root { color: #252722; background: #fff; font-family: Inter, Arial, sans-serif; }
  * { box-sizing: border-box; }
  @page { size: A4; margin: 18mm 17mm 19mm; }
  body { margin: 0; font-size: 10.5pt; line-height: 1.58; color: #343732; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .masthead { align-items: flex-start; border-bottom: 1px solid #dfe4dc; display: flex; justify-content: space-between; padding-bottom: 12px; }
  .brand, .kind, .eyebrow { font-size: 8.5px; letter-spacing: .15em; text-transform: uppercase; }
  .brand { color: #555c54; font-weight: 700; }
  .kind, .eyebrow { color: #39715c; }
  h1 { color: #20221f; font-family: Georgia, 'Times New Roman', serif; font-size: 29pt; font-weight: 400; line-height: 1.08; margin: 17px 0 9px; }
  .summary { color: #636a62; font-size: 11.5pt; line-height: 1.5; margin: 0 0 18px; max-width: 88%; }
  .meta { border-bottom: 1px solid #e7eae5; border-top: 1px solid #e7eae5; color: #737a72; display: flex; flex-wrap: wrap; font-size: 8.8pt; gap: 8px 24px; padding: 9px 0; }
  main { padding-top: 20px; }
  main h2 { break-after: avoid; color: #252824; font-size: 15pt; line-height: 1.25; margin: 24px 0 7px; }
  main h3 { break-after: avoid; color: #2c302b; font-size: 11.5pt; margin: 19px 0 6px; }
  p { margin: 0 0 10px; }
  ul, ol { margin: 8px 0 15px; padding-left: 23px; }
  li { margin: 4px 0; padding-left: 3px; }
  li > p { display: inline; margin: 0; }
  strong { font-weight: 700; }
  a { color: #2f6b54; text-decoration-color: #8db5a4; text-underline-offset: 2px; }
  .materials { border-top: 1px solid #dfe4dc; break-before: auto; margin-top: 28px; padding-top: 15px; }
  .materials > h2 { font-family: Georgia, 'Times New Roman', serif; font-weight: 400; }
  .material { border-bottom: 1px solid #eceeea; display: grid; gap: 12px; grid-template-columns: 1fr auto; padding: 9px 0; }
  .material small { color: #7a8078; }
  footer { align-items: center; border-top: 1px solid #e3e7e1; bottom: 0; color: #858b83; display: flex; font-size: 7.5pt; justify-content: space-between; left: 0; padding-top: 6px; position: fixed; right: 0; }
  .publication--studio .masthead .eyebrow { color: #92978f; margin-top: 4px; }
  .studio-sheet__opening { break-after: avoid; }
  .publication--studio h1 { font-size: 27pt; margin-top: 21px; max-width: 92%; }
  .studio-sheet__body { font-family: Georgia, 'Times New Roman', serif; font-size: 12pt; line-height: 1.72; margin: 0 auto; max-width: 154mm; padding-top: 24px; }
  .studio-sheet__body p { margin: 0 0 12px; }
  .studio-sheet__body .studio-sheet__spacer { font-size: 7pt; line-height: 1; margin: 0 0 10px; min-height: 7pt; }
  .studio-sheet__body ul, .studio-sheet__body ol { margin-bottom: 17px; }
  .studio-sheet__body .materials { font-family: Inter, Arial, sans-serif; font-size: 9.5pt; line-height: 1.45; }

  .publication--sop h1 { font-size: 28pt; }
  .sop-opening { break-after: avoid; padding-top: 18px; }
  .sop-opening > .eyebrow { color: #6b756d; }
  .sop-foundation { display: grid; gap: 9px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-bottom: 25px; }
  .sop-foundation__item { background: #f6f7f4; border: 1px solid #e0e4dd; border-radius: 8px; break-inside: avoid; padding: 12px 13px; }
  .sop-foundation__item--rule { grid-column: 1 / -1; }
  .sop-foundation__item > span, .sop-result > span, .sop-attention > span, .sop-step__eyebrow, .section-heading > span { color: #667067; font-size: 7.6pt; font-weight: 700; letter-spacing: .11em; text-transform: uppercase; }
  .sop-foundation__item p { color: #333832; font-size: 9.8pt; line-height: 1.45; margin: 5px 0 0; }
  .section-heading { border-bottom: 1px solid #dfe4dc; margin-bottom: 4px; padding-bottom: 10px; }
  .section-heading h2 { font-family: Georgia, 'Times New Roman', serif; font-size: 19pt; font-weight: 400; margin: 3px 0 0; }
  .sop-step { border-bottom: 1px solid #e4e8e1; break-inside: auto; padding: 17px 0 19px; }
  .sop-step__heading { align-items: flex-start; break-after: avoid; display: grid; gap: 12px; grid-template-columns: 31px 1fr; }
  .sop-step-number { align-items: center; background: #e8f4ee; border: 1px solid #b9d9ca; border-radius: 50%; color: #27634c; display: flex; font-size: 10.5pt; font-weight: 700; height: 31px; justify-content: center; width: 31px; }
  .sop-step__eyebrow { color: #7b837b; display: block; margin: 0 0 2px; }
  .sop-step__heading h2 { font-size: 14pt; margin: 0; }
  .sop-step__instruction { font-size: 10.2pt; line-height: 1.55; margin: 9px 0 0 43px; }
  .sop-result, .sop-attention { border: 1px solid; border-radius: 8px; break-inside: avoid; margin: 11px 0 0 43px; padding: 10px 12px; }
  .sop-result { background: #edf7f2; border-color: #c5dfd2; }
  .sop-result > span { color: #2f6b54; }
  .sop-result p { color: #315443; margin: 4px 0 0; }
  .sop-attention { background: #fbf6ea; border-color: #ead8ab; }
  .sop-attention > span { color: #806329; }
  .sop-attention ul { color: #6f5727; margin: 5px 0 0; padding-left: 18px; }
  .empty-note { color: #7a8078; padding: 18px 0; }
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
