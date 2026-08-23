export type VaultInlineStyle =
  | "Bold"
  | "Italic"
  | "Underline"
  | "Heading"
  | "Heading2"
  | "Heading3"
  | "Heading4"
  | "Quote"
  | "ColorRed"
  | "ColorOrange"
  | "ColorGreen"
  | "ColorBlue"
  | "ColorPurple"
  | "ColorPink"
  | "ColorSlate";

export type VaultStyleMark = {
  start: number;
  end: number;
  style: VaultInlineStyle;
};

export type VaultNoteLink = {
  start: number;
  end: number;
  noteId: string;
};

export type VaultRichTextDocument = {
  text: string;
  styleMarks: VaultStyleMark[];
  noteLinks: VaultNoteLink[];
};

const STYLE_NAMES = new Set<VaultInlineStyle>([
  "Bold",
  "Italic",
  "Underline",
  "Heading",
  "Heading2",
  "Heading3",
  "Heading4",
  "Quote",
  "ColorRed",
  "ColorOrange",
  "ColorGreen",
  "ColorBlue",
  "ColorPurple",
  "ColorPink",
  "ColorSlate",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedInteger(value: unknown, textLength: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(Math.trunc(value), textLength))
    : 0;
}

function parseJsonValue(value: string): unknown {
  let current: unknown = value;
  for (let attempt = 0; attempt < 2 && typeof current === "string"; attempt += 1) {
    try {
      current = JSON.parse(current);
    } catch {
      return null;
    }
  }
  return current;
}

export function parseVaultRichTextDocument(value: string | null | undefined): VaultRichTextDocument | null {
  if (!value?.trim()) return null;
  const parsed = parseJsonValue(value);
  if (!isRecord(parsed) || typeof parsed.text !== "string") return null;

  const text = parsed.text;
  const styleMarks = (Array.isArray(parsed.styleMarks) ? parsed.styleMarks : []).flatMap<VaultStyleMark>((candidate) => {
    if (!isRecord(candidate) || typeof candidate.style !== "string" || !STYLE_NAMES.has(candidate.style as VaultInlineStyle)) return [];
    const start = boundedInteger(candidate.start, text.length);
    const end = boundedInteger(candidate.end, text.length);
    return start < end ? [{ start, end, style: candidate.style as VaultInlineStyle }] : [];
  });
  const noteLinks = (Array.isArray(parsed.noteLinks) ? parsed.noteLinks : []).flatMap<VaultNoteLink>((candidate) => {
    if (!isRecord(candidate) || typeof candidate.noteId !== "string" || !candidate.noteId) return [];
    const start = boundedInteger(candidate.start, text.length);
    const end = boundedInteger(candidate.end, text.length);
    return start < end ? [{ start, end, noteId: candidate.noteId }] : [];
  });

  return { text, styleMarks, noteLinks };
}

export function blocksToVaultRichText(blocks: Block[]): VaultRichTextDocument {
  const textParts: string[] = [];
  const styleMarks: VaultStyleMark[] = [];
  let offset = 0;
  let orderedListIndex = 0;

  blocks.toSorted((first, second) => first.orderIndex - second.orderIndex).forEach((block) => {
    if (textParts.length) {
      textParts.push("\n");
      offset += 1;
    }

    const prefix = block.type === "bullet"
      ? "• "
      : block.type === "numbered"
        ? `${++orderedListIndex}. `
        : "";
    if (block.type !== "numbered") orderedListIndex = 0;

    const content = block.type === "divider" ? "---" : block.content;
    textParts.push(prefix, content);
    const contentStart = offset + prefix.length;
    const contentEnd = contentStart + content.length;

    const blockStyles: Partial<Record<Block["type"], VaultInlineStyle>> = {
      heading1: "Heading",
      heading2: "Heading2",
      heading3: "Heading3",
      quote: "Quote",
    };
    const style = blockStyles[block.type];
    if (style && contentStart < contentEnd) {
      styleMarks.push({ start: contentStart, end: contentEnd, style });
    }

    offset = contentEnd;
  });

  return { text: textParts.join(""), styleMarks, noteLinks: [] };
}

export function normalizeVaultRichTextDocument({
  value,
  blocks = [],
  fallbackText = "",
}: {
  value?: string | null;
  blocks?: Block[];
  fallbackText?: string | null;
}): VaultRichTextDocument {
  const parsedDocument = parseVaultRichTextDocument(value);
  if (parsedDocument) return parsedDocument;

  const blockDocument = blocksToVaultRichText(blocks);
  const plainText = value ?? "";
  if (plainText.length > blockDocument.text.length) {
    return { text: plainText, styleMarks: [], noteLinks: [] };
  }
  if (blockDocument.text || blocks.length) return blockDocument;

  return { text: fallbackText ?? "", styleMarks: [], noteLinks: [] };
}

export function extractVaultPlainText(value: string | null | undefined) {
  return parseVaultRichTextDocument(value)?.text ?? value ?? "";
}

export function replaceVaultRichText(document: VaultRichTextDocument, text: string): VaultRichTextDocument {
  if (document.text === text) return document;

  let prefixLength = 0;
  const sharedLength = Math.min(document.text.length, text.length);
  while (prefixLength < sharedLength && document.text[prefixLength] === text[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < sharedLength - prefixLength &&
    document.text[document.text.length - 1 - suffixLength] === text[text.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const oldChangeEnd = document.text.length - suffixLength;
  const newChangeEnd = text.length - suffixLength;
  const delta = text.length - document.text.length;

  const styleMarks = document.styleMarks.flatMap<VaultStyleMark>((mark) => {
    if (mark.end <= prefixLength) return [mark];
    if (mark.start >= oldChangeEnd) {
      return [{ ...mark, start: mark.start + delta, end: mark.end + delta }];
    }

    const start = mark.start < prefixLength ? mark.start : prefixLength;
    const end = mark.end > oldChangeEnd ? mark.end + delta : newChangeEnd;
    return start < end ? [{ ...mark, start, end }] : [];
  });

  const noteLinks = document.noteLinks.flatMap<VaultNoteLink>((link) => {
    if (link.end <= prefixLength) return [link];
    if (link.start >= oldChangeEnd) {
      return [{ ...link, start: link.start + delta, end: link.end + delta }];
    }
    return [];
  });

  return { text, styleMarks, noteLinks };
}
import type { Block } from "@workspace/api-client-react";
