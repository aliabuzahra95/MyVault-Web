import { replaceVaultRichText, type VaultInlineStyle, type VaultRichTextDocument, type VaultStyleMark } from "@/lib/restore/vaultRichText";

export type TiptapJson = {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: TiptapJson[];
  content?: TiptapJson[];
  text?: string;
};

const inlineStyles = new Set<VaultInlineStyle>([
  "Bold",
  "Italic",
  "Underline",
  "ColorRed",
  "ColorOrange",
  "ColorGreen",
  "ColorBlue",
  "ColorPurple",
  "ColorPink",
  "ColorSlate",
]);

const colors: Record<string, VaultInlineStyle> = {
  "#e5484d": "ColorRed",
  "#f97316": "ColorOrange",
  "#2f9e66": "ColorGreen",
  "#2f80ed": "ColorBlue",
  "#8b5cf6": "ColorPurple",
  "#db2777": "ColorPink",
  "#64748b": "ColorSlate",
};

const styleColors = Object.fromEntries(Object.entries(colors).map(([color, style]) => [style, color]));

function styleToMark(style: VaultInlineStyle): TiptapJson | null {
  if (style === "Bold") return { type: "bold" };
  if (style === "Italic") return { type: "italic" };
  if (style === "Underline") return { type: "underline" };
  const color = styleColors[style];
  return color ? { type: "textStyle", attrs: { color } } : null;
}

function inlineContent(document: VaultRichTextDocument, start: number, end: number): TiptapJson[] | undefined {
  if (start >= end) return undefined;
  const boundaries = new Set([start, end]);
  document.styleMarks.forEach((mark) => {
    if (!inlineStyles.has(mark.style) || mark.end <= start || mark.start >= end) return;
    boundaries.add(Math.max(start, mark.start));
    boundaries.add(Math.min(end, mark.end));
  });

  const positions = [...boundaries].sort((first, second) => first - second);
  return positions.slice(0, -1).flatMap((segmentStart, index) => {
    const segmentEnd = positions[index + 1];
    const text = document.text.slice(segmentStart, segmentEnd);
    if (!text) return [];
    const marks = document.styleMarks
      .filter((mark) => inlineStyles.has(mark.style) && mark.start <= segmentStart && mark.end >= segmentEnd)
      .flatMap((mark) => styleToMark(mark.style) ?? []);
    return [{ type: "text", text, ...(marks.length ? { marks } : {}) }];
  });
}

function blockStyle(document: VaultRichTextDocument, start: number, end: number) {
  const styles = document.styleMarks
    .filter((mark) => mark.start < end && mark.end > start)
    .map((mark) => mark.style);
  if (styles.includes("Heading")) return { type: "heading", attrs: { level: 1 } };
  if (styles.includes("Heading2")) return { type: "heading", attrs: { level: 2 } };
  if (styles.includes("Heading3")) return { type: "heading", attrs: { level: 3 } };
  if (styles.includes("Heading4")) return { type: "heading", attrs: { level: 4 } };
  if (styles.includes("Quote")) return { type: "blockquote" };
  return { type: "paragraph" };
}

type SourceLine = { text: string; start: number; end: number };

function lineNode(document: VaultRichTextDocument, line: SourceLine, contentStart = line.start): TiptapJson {
  const style = blockStyle(document, contentStart, line.end);
  const content = inlineContent(document, contentStart, line.end);
  const paragraph = { type: style.type === "heading" ? "heading" : "paragraph", ...(style.attrs ? { attrs: style.attrs } : {}), ...(content ? { content } : {}) };
  return style.type === "blockquote" ? { type: "blockquote", content: [paragraph] } : paragraph;
}

export function vaultRichTextToTiptap(document: VaultRichTextDocument): TiptapJson {
  let offset = 0;
  const lines: SourceLine[] = document.text.split("\n").map((text) => {
    const line = { text, start: offset, end: offset + text.length };
    offset += text.length + 1;
    return line;
  });
  const content: TiptapJson[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const bullet = line.text.match(/^•\s/);
    const ordered = line.text.match(/^(\d+)\.\s/);
    if (!bullet && !ordered) {
      content.push(lineNode(document, line));
      index += 1;
      continue;
    }

    const listType = bullet ? "bulletList" : "orderedList";
    const items: TiptapJson[] = [];
    const startNumber = ordered ? Number(ordered[1]) : 1;
    while (index < lines.length) {
      const candidate = lines[index];
      const prefix = listType === "bulletList" ? candidate.text.match(/^•\s/) : candidate.text.match(/^\d+\.\s/);
      if (!prefix) break;
      const contentStart = candidate.start + prefix[0].length;
      items.push({ type: "listItem", content: [lineNode(document, candidate, contentStart)] });
      index += 1;
    }
    content.push({ type: listType, ...(listType === "orderedList" ? { attrs: { start: startNumber } } : {}), content: items });
  }

  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

function marksFromTiptap(marks: TiptapJson[] | undefined): VaultInlineStyle[] {
  return (marks ?? []).flatMap<VaultInlineStyle>((mark) => {
    if (mark.type === "bold") return ["Bold"];
    if (mark.type === "italic") return ["Italic"];
    if (mark.type === "underline") return ["Underline"];
    if (mark.type === "textStyle" && typeof mark.attrs?.color === "string") {
      const style = colors[mark.attrs.color.toLowerCase()];
      return style ? [style] : [];
    }
    return [];
  });
}

function inlineSegments(node: TiptapJson): Array<{ text: string; styles: VaultInlineStyle[] }> {
  if (node.type === "text") return [{ text: node.text ?? "", styles: marksFromTiptap(node.marks) }];
  if (node.type === "hardBreak") return [{ text: "\n", styles: [] }];
  return (node.content ?? []).flatMap(inlineSegments);
}

function mergeMarks(marks: VaultStyleMark[]) {
  return marks
    .filter((mark) => mark.start < mark.end)
    .toSorted((first, second) => first.style.localeCompare(second.style) || first.start - second.start)
    .reduce<VaultStyleMark[]>((merged, mark) => {
      const previous = merged.at(-1);
      if (previous?.style === mark.style && previous.end >= mark.start) {
        previous.end = Math.max(previous.end, mark.end);
      } else {
        merged.push({ ...mark });
      }
      return merged;
    }, []);
}

export function tiptapToVaultRichText(json: TiptapJson, previous: VaultRichTextDocument): VaultRichTextDocument {
  const textParts: string[] = [];
  const styleMarks: VaultStyleMark[] = [];
  let offset = 0;

  const appendLine = (segments: Array<{ text: string; styles: VaultInlineStyle[] }>, blockStyle?: VaultInlineStyle, prefix = "") => {
    if (textParts.length) {
      textParts.push("\n");
      offset += 1;
    }
    if (prefix) {
      textParts.push(prefix);
      offset += prefix.length;
    }
    const lineStart = offset;
    segments.forEach((segment) => {
      const start = offset;
      textParts.push(segment.text);
      offset += segment.text.length;
      segment.styles.forEach((style) => styleMarks.push({ start, end: offset, style }));
    });
    if (blockStyle && offset > lineStart) styleMarks.push({ start: lineStart, end: offset, style: blockStyle });
  };

  const appendBlock = (node: TiptapJson, inheritedStyle?: VaultInlineStyle, prefix = "") => {
    const headingLevel = node.type === "heading" ? Number(node.attrs?.level ?? 1) : 0;
    const headingStyle = ({ 1: "Heading", 2: "Heading2", 3: "Heading3", 4: "Heading4" } as const)[headingLevel as 1 | 2 | 3 | 4];
    appendLine(inlineSegments(node), headingStyle ?? inheritedStyle, prefix);
  };

  (json.content ?? []).forEach((node) => {
    if (node.type === "bulletList" || node.type === "orderedList") {
      const start = Number(node.attrs?.start ?? 1);
      (node.content ?? []).forEach((item, itemIndex) => {
        const firstBlock = item.content?.find((child) => child.type === "paragraph" || child.type === "heading") ?? { type: "paragraph" };
        appendBlock(firstBlock, undefined, node.type === "bulletList" ? "• " : `${start + itemIndex}. `);
      });
    } else if (node.type === "blockquote") {
      (node.content ?? []).forEach((child) => appendBlock(child, "Quote"));
    } else if (node.type === "horizontalRule") {
      appendLine([{ text: "---", styles: [] }]);
    } else {
      appendBlock(node);
    }
  });

  const text = textParts.join("");
  const noteLinks = replaceVaultRichText(previous, text).noteLinks;
  return { text, styleMarks: mergeMarks(styleMarks), noteLinks };
}
