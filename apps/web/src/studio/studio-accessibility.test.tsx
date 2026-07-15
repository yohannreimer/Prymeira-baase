import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudioCopilot from "./StudioCopilot";
import StudioPage from "./StudioPage";
import type { StudioDocument } from "./studio.types";

const studioStyles = readFileSync(resolve(process.cwd(), "src/studio/studio.css"), "utf8");
const proactivityStyles = readFileSync(resolve(process.cwd(), "src/studio/studio-proactivity.css"), "utf8");
const studioCssRules = parseCssRules(studioStyles);

describe("Owner Studio accessibility and adaptive quiet ops", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/#estudio");
    installLocalStorage();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      })
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => undefined));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.document.body.style.overflow = "";
  });

  it("exposes named landmarks, ordered headings, and labelled capture controls", () => {
    render(<StudioPage />);

    const studio = screen.getByRole("region", { name: "Estúdio" });
    expect(within(studio).getByRole("navigation", { name: "Seções do Estúdio" })).toBeInTheDocument();
    expect(within(studio).getByRole("region", { name: "Conteúdo da seção" })).toBeInTheDocument();
    expect(within(studio).getByRole("heading", { level: 1, name: "Estúdio" })).toBeInTheDocument();
    expect(within(studio).getByRole("heading", { level: 2, name: "Um espaço para pensar com clareza." })).toBeInTheDocument();
    expect(within(studio).getByRole("form", { name: "Nova captura" })).toBeInTheDocument();
    expect(within(studio).getByRole("textbox", { name: "Registre um pensamento" })).toBeInTheDocument();
  });

  it("moves through the internal navigation with arrows, Home, and End", () => {
    render(<StudioPage />);
    const navigation = screen.getByRole("navigation", { name: "Seções do Estúdio" });
    const home = within(navigation).getByRole("button", { name: "Início" });
    const inbox = within(navigation).getByRole("button", { name: "Entrada" });
    const privacy = within(navigation).getByRole("button", { name: "Privacidade" });

    home.focus();
    fireEvent.keyDown(home, { key: "ArrowDown" });
    expect(inbox).toHaveFocus();
    fireEvent.keyDown(inbox, { key: "End" });
    expect(privacy).toHaveFocus();
    fireEvent.keyDown(privacy, { key: "Home" });
    expect(home).toHaveFocus();
    fireEvent.keyDown(home, { key: "ArrowUp" });
    expect(privacy).toHaveFocus();
  });

  it("contains the mobile copilot sheet and returns focus to its trigger", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(max-width: 1200px)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      })
    });

    render(<StudioCopilot document={studioDocument} onDocumentChange={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Copiloto do Estúdio" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(screen.getByLabelText("O que você quer entender melhor?")).toHaveFocus());
    await user.keyboard("{Escape}");
    const trigger = screen.getByRole("button", { name: "Pensar com a IA" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("announces stream phases once without exposing token deltas as live text", async () => {
    const user = userEvent.setup();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(new ReadableStream({
      start(streamController) { controller = streamController; }
    }), { headers: { "content-type": "text/event-stream" } }));
    render(<StudioCopilot document={studioDocument} onDocumentChange={vi.fn()} />);

    const live = screen.getByRole("status");
    await user.type(screen.getByLabelText("O que você quer entender melhor?"), "Organize este pensamento");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    expect(live).toHaveTextContent("Gerando resposta");

    controller.enqueue(new TextEncoder().encode("event: delta\ndata: {\"text\":\"Primeiro token\"}\n\n"));
    controller.enqueue(new TextEncoder().encode("event: delta\ndata: {\"text\":\" e segundo token\"}\n\n"));
    expect(live).not.toHaveTextContent("token");
    controller.enqueue(new TextEncoder().encode("event: done\ndata: {\"message_id\":\"message_1\"}\n\n"));
    controller.close();
    await waitFor(() => expect(live).toHaveTextContent("Resposta concluída"));
  });

  it("encodes state beyond color and keeps save feedback persistently live", () => {
    render(<StudioPage />);
    expect(screen.getByRole("button", { name: "Início" })).toHaveAttribute("aria-current", "page");
    expect(cssRule('.studio-editor__save-status[data-state="offline"]')).toBeDefined();
    expect(cssRule('.studio-nav__item[aria-current="page"]')).toBeDefined();
  });

  it("enables motion only when the user has not requested reduced motion", () => {
    expect(cssRule(".studio-nav__item", "(prefers-reduced-motion: no-preference)").get("transition-duration")).toBe("180ms");
    expect(cssRule(".studio-nav__item").has("transition")).toBe(false);
    expect(cssRule(".studio-nav__item").has("transition-duration")).toBe(false);
    expect(cssRule(".studio-composer").has("transition")).toBe(false);
    expect(cssRule(".studio-composer").has("transition-duration")).toBe(false);
  });

  it("announces explicit section navigation without making the content region live", async () => {
    const user = userEvent.setup();
    render(<StudioPage />);

    const content = screen.getByRole("region", { name: "Conteúdo da seção" });
    const navigationStatus = screen.getByRole("status", { name: "Mudança de seção" });
    const inbox = screen.getByRole("button", { name: "Entrada" });
    const goals = screen.getByRole("button", { name: "Metas" });
    expect(content).not.toHaveAttribute("aria-live");
    expect(navigationStatus).toHaveAttribute("aria-live", "polite");
    expect(navigationStatus).toHaveAttribute("aria-atomic", "true");
    expect(navigationStatus).toBeEmptyDOMElement();

    await user.click(inbox);
    expect(inbox).toHaveFocus();
    expect(navigationStatus).toHaveTextContent("Seção Entrada aberta.");
    expect(within(content).getByRole("heading", { level: 2, name: "Entrada" })).toBeInTheDocument();

    window.history.replaceState(null, "", "/#estudio/plans");
    fireEvent.popState(window);
    expect(navigationStatus).toBeEmptyDOMElement();
    expect(within(content).getByRole("heading", { level: 2, name: "Planos" })).toBeInTheDocument();

    await user.click(goals);
    expect(goals).toHaveFocus();
    expect(navigationStatus).toHaveTextContent("Seção Metas aberta.");
    expect(within(content).getByRole("heading", { level: 2, name: "Metas" })).toBeInTheDocument();
  });

  it("parses material rules through nested grouping at-rules without entering keyframes", () => {
    const fixtureRules = parseCssRules(String.raw`
      @layer studio {
        @container editor (min-width: 30rem) {
          /* a comment with a misleading { brace } */
          @supports (display: grid) {
            @media (min-width: 60rem) {
              .studio-material-composer::before {
                content: "chave } e \"escape\" /* literal */";
                color: var(--muted);
              }
            }
          }
        }
      }
      @font-face {
        font-family: "Studio { Sans";
        src: url("studio.woff2");
      }
      @keyframes quiet-material {
        from { opacity: 0; }
        to { opacity: 1; }
      }
    `);
    const expectedContext = [
      "@layer studio",
      "@container editor (min-width: 30rem)",
      "@supports (display: grid)",
      "@media (min-width: 60rem)"
    ];
    const material = cssRuleFrom(
      fixtureRules,
      ".studio-material-composer::before",
      "(min-width: 60rem)",
      expectedContext
    );

    expect(material.get("content")).toBe(String.raw`"chave } e \"escape\" /* literal */"`);
    expect(material.get("color")).toBe("var(--muted)");
    expect(fixtureRules).toHaveLength(1);
    expect(fixtureRules.flatMap((rule) => rule.selectors)).not.toEqual(expect.arrayContaining(["from", "to"]));
  });

  it("styles document materials as a quiet, wrapping, token-based action strip", () => {
    const strip = cssRule(".studio-material-composer");
    expect(strip.get("border-top")).toBe("1px solid var(--line)");
    expect(strip.get("padding")).toBe("18px 0");

    const actions = cssRule(".studio-material-composer__actions");
    expect(actions.get("display")).toBe("flex");
    expect(actions.get("flex-wrap")).toBe("wrap");
    expect(actions.get("gap")).toBe("8px");

    const actionButton = cssRule(".studio-material-composer__action");
    expect(actionButton.get("min-height")).toBe("40px");
    expect(actionButton.get("background")).toBe("var(--panel)");
    expect(actionButton.get("border")).toBe("1px solid var(--line)");
    expect(cssRule(".studio-material-composer__label").get("color")).toBe("var(--muted)");

    const recording = cssRule(
      '.studio-material-composer__action[aria-pressed="true"]'
    );
    expect(recording.get("background")).toBe("var(--accent-bg)");
    expect(recording.get("color")).toBe("var(--accent-ink)");
    expect(cssRule(".studio-material-composer__link").get("display")).toBe("grid");
    expect(cssRule(".studio-material-composer__recovery").get("display")).toBe("flex");
    expect(cssRule(".studio-material-composer__status").get("color")).toBe("var(--muted)");
    expect(cssRule(".studio-material-composer__action:focus-visible").get("outline")).toBe("2px solid var(--accent)");

    const mobile = "(max-width: 720px)";
    expect(cssRule(".studio-document-assets", mobile).get("max-width")).toBe("100%");
    expect(cssRule(".studio-document-assets", mobile).get("min-width")).toBe("0");
    expect(cssRule(".studio-material-composer__link", mobile).get("grid-template-columns")).toBe("repeat(2, minmax(0, 1fr))");

    const selectors = studioCssRules.flatMap((rule) => rule.selectors);
    expect(selectors.some((selector) => selector.includes(".studio-document-assets > section:first-child"))).toBe(false);
    expect(selectors.some((selector) => selector.includes(".studio-document-assets") && selector.includes("[role="))).toBe(false);
  });

  it("keeps primary hover accented instead of inheriting the neutral hover", () => {
    const hover = "(hover: hover)";
    expect(cssRule(
      ".studio-material-composer__link-action:not(.studio-material-composer__link-action--primary):hover:not(:disabled)",
      hover
    ).get("background")).toBe("var(--panel2)");
    expect(cssRule(
      ".studio-material-composer__link-action--primary:hover:not(:disabled)",
      hover
    ).get("background")).toBe("var(--accent-bg)");
    expect(cssRule(
      ".studio-material-composer__recovery-action:not(.studio-material-composer__recovery-action--primary):hover:not(:disabled)",
      hover
    ).get("background")).toBe("var(--panel2)");
    expect(cssRule(
      ".studio-material-composer__recovery-action--primary:hover:not(:disabled)",
      hover
    ).get("background")).toBe("var(--accent-bg)");
  });

  it("uses the global coarse target rule for controls and specific rules for links and audio", () => {
    const coarse = "(pointer: coarse)";
    expect(cssRule(".studio-screen").get("--studio-touch-target")).toBe("44px");
    expect(cssRule(".studio-screen button", coarse).get("min-height")).toBe("var(--studio-touch-target)");
    expect(cssRule('.studio-screen input:not([type="checkbox"]):not([type="radio"])', coarse).get("min-height")).toBe("var(--studio-touch-target)");
    expect(studioCssRules.filter((rule) => (
      rule.media === coarse
      && rule.selectors.some((selector) => selector.startsWith(".studio-material-composer"))
    ))).toHaveLength(0);
    expect(cssRule(".studio-document-assets .studio-asset-status a", coarse).get("min-height")).toBe("44px");
    const audio = cssRule(".studio-asset-status__original audio", coarse);
    expect(audio.get("height")).toBe("44px");
    expect(audio.get("max-width")).toBe("100%");
    expect(audio.get("min-height")).toBe("44px");
  });

  it("keeps every material rule token-based and asset rows free of nested cards", () => {
    const materialRules = studioCssRules.filter((rule) => rule.selectors.some((selector) => (
      selector.startsWith(".studio-material-composer")
      || selector.startsWith(".studio-document-assets")
      || selector.startsWith(".studio-asset-status")
      || selector.startsWith(".studio-asset-transcript")
    )));
    expect(materialRules.length).toBeGreaterThan(0);
    for (const rule of materialRules) {
      const values = [...rule.declarations.values()].join(" ");
      expect(values, rule.selectors.join(", ")).not.toMatch(/linear-gradient|#[0-9a-f]{3,8}|\brgba?\(/iu);
    }
    for (const selector of [
      ".studio-document-assets",
      ".studio-asset-status",
      ".studio-asset-status__processing"
    ]) {
      const declarations = cssRule(selector);
      expect(declarations.has("background"), selector).toBe(false);
      expect(declarations.has("border"), selector).toBe(false);
      expect(declarations.has("border-radius"), selector).toBe(false);
      expect(declarations.has("box-shadow"), selector).toBe(false);
    }
  });

  it("keeps proactive signals inside the shared quiet-ops visual system", () => {
    expect(proactivityStyles).not.toMatch(/linear-gradient|#[0-9a-f]{3,8}|\brgba?\(/i);
    expect(proactivityStyles).toMatch(/background:\s*var\(--accent-bg\)/);
    expect(proactivityStyles).toMatch(/border-radius:\s*var\(--studio-panel-radius\)/);
    expect(proactivityStyles).toMatch(/@media \(max-width: 720px\)/);
  });
});

const studioDocument: StudioDocument = {
  id: "document_1",
  workspaceId: "workspace_1",
  ownerProfileId: "owner_1",
  captureKey: null,
  title: "Plano",
  bodyJson: { type: "doc", content: [] },
  bodyText: "Original",
  revision: 1,
  captureMode: "text",
  inboxState: "reviewed",
  isFocused: false,
  status: "active",
  createdAt: "2026-07-14T10:00:00.000Z",
  updatedAt: "2026-07-14T10:00:00.000Z",
  archivedAt: null
};

function installLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, String(value))
    }
  });
}

type ParsedCssRule = {
  selectors: string[];
  declarations: Map<string, string>;
  media: string | null;
  context: string[];
};

function cssRule(selector: string, media: string | null = null, context?: readonly string[]) {
  return cssRuleFrom(studioCssRules, selector, media, context);
}

function cssRuleFrom(
  rules: ParsedCssRule[],
  selector: string,
  media: string | null = null,
  context?: readonly string[]
) {
  const matches = rules.filter((rule) => (
    rule.media === media
    && rule.selectors.includes(selector)
    && (context === undefined || (
      rule.context.length === context.length
      && rule.context.every((entry, index) => entry === context[index])
    ))
  ));
  const contextLabel = context?.join(" > ") ?? media ?? "root";
  expect(matches, `missing CSS rule: ${selector} @ ${contextLabel}`).toHaveLength(1);
  return matches[0]?.declarations ?? new Map<string, string>();
}

function parseCssRules(styles: string) {
  const rules: ParsedCssRule[] = [];
  const source = styles;

  function walk(start: number, end: number, context: string[]) {
    let cursor = start;
    while (cursor < end) {
      cursor = skipCssTrivia(source, cursor, end);
      if (cursor >= end) return;
      const boundary = findCssBoundary(source, cursor, end);
      if (!boundary) return;
      if (boundary.kind === "statement") {
        cursor = boundary.index + 1;
        continue;
      }
      const open = boundary.index;
      const prelude = stripCssComments(source.slice(cursor, open)).trim();
      const close = matchingBrace(source, open, end);
      if (prelude.startsWith("@")) {
        const isKeyframes = /^@(?:-[\w]+-)?keyframes\b/iu.test(prelude);
        if (!isKeyframes && findOpeningBrace(source, open + 1, close) !== -1) {
          walk(open + 1, close, [...context, prelude]);
        }
      } else if (prelude) {
        const mediaContext = findMediaContext(context);
        rules.push({
          selectors: splitTopLevel(prelude, ",").map((selector) => selector.trim()),
          declarations: parseDeclarations(source.slice(open + 1, close)),
          media: mediaContext?.replace(/^@media\s+/iu, "") ?? null,
          context: [...context]
        });
      }
      cursor = close + 1;
    }
  }

  walk(0, source.length, []);
  return rules;
}

function findMediaContext(context: readonly string[]) {
  for (let index = context.length - 1; index >= 0; index -= 1) {
    const entry = context[index];
    if (entry && /^@media\s+/iu.test(entry)) return entry;
  }
  return undefined;
}

function skipCssTrivia(source: string, start: number, end: number) {
  let cursor = start;
  while (cursor < end) {
    if (/\s/u.test(source[cursor] ?? "")) {
      cursor += 1;
      continue;
    }
    if (source[cursor] === "/" && source[cursor + 1] === "*") {
      cursor = skipCssComment(source, cursor, end);
      continue;
    }
    break;
  }
  return cursor;
}

function skipCssComment(source: string, start: number, end: number) {
  const close = source.indexOf("*/", start + 2);
  return close === -1 || close >= end ? end : close + 2;
}

function findCssBoundary(source: string, start: number, end: number) {
  let quote = "";
  let roundDepth = 0;
  let squareDepth = 0;
  for (let index = start; index < end; index += 1) {
    const character = source[index] ?? "";
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      index = skipCssComment(source, index, end) - 1;
    } else if (character === "\\") {
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(") {
      roundDepth += 1;
    } else if (character === ")") {
      roundDepth -= 1;
    } else if (character === "[") {
      squareDepth += 1;
    } else if (character === "]") {
      squareDepth -= 1;
    } else if (roundDepth === 0 && squareDepth === 0 && character === "{") {
      return { index, kind: "block" as const };
    } else if (roundDepth === 0 && squareDepth === 0 && character === ";") {
      return { index, kind: "statement" as const };
    }
  }
  return null;
}

function findOpeningBrace(source: string, start: number, end: number) {
  let quote = "";
  for (let index = start; index < end; index += 1) {
    const character = source[index] ?? "";
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      index = skipCssComment(source, index, end) - 1;
    } else if (character === "\\") {
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      return index;
    }
  }
  return -1;
}

function matchingBrace(source: string, open: number, end: number) {
  let depth = 1;
  let quote = "";
  for (let index = open + 1; index < end; index += 1) {
    const character = source[index] ?? "";
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      index = skipCssComment(source, index, end) - 1;
    } else if (character === "\\") index += 1;
    else if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  throw new Error(`Unclosed CSS block at ${open}`);
}

function splitTopLevel(value: string, separator: string) {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\\") index += 1;
    else if (character === '"' || character === "'") quote = character;
    else if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth -= 1;
    else if (character === separator && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function parseDeclarations(body: string) {
  const declarations = new Map<string, string>();
  for (const declaration of splitTopLevel(stripCssComments(body), ";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    declarations.set(
      declaration.slice(0, colon).trim(),
      declaration.slice(colon + 1).trim()
    );
  }
  return declarations;
}

function stripCssComments(value: string) {
  let result = "";
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (quote) {
      result += character;
      if (character === "\\" && index + 1 < value.length) {
        result += value[++index];
      } else if (character === quote) {
        quote = "";
      }
    } else if (character === '"' || character === "'") {
      quote = character;
      result += character;
    } else if (character === "/" && value[index + 1] === "*") {
      index = skipCssComment(value, index, value.length) - 1;
    } else {
      result += character;
    }
  }
  return result;
}
