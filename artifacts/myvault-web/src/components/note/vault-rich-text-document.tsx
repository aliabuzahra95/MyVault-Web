import { Link } from "wouter";
import type { VaultInlineStyle, VaultRichTextDocument } from "@/lib/restore/vaultRichText";
import { cn } from "@/lib/utils";

const styleClasses: Partial<Record<VaultInlineStyle, string>> = {
  Bold: "font-bold",
  Italic: "italic",
  Underline: "underline decoration-1 underline-offset-2",
  Heading: "text-2xl font-bold leading-9 text-slate-950",
  Heading2: "text-xl font-bold leading-8 text-slate-950",
  Heading3: "text-lg font-semibold leading-8 text-slate-900",
  Heading4: "text-base font-semibold text-slate-900",
  Quote: "italic text-slate-500",
  ColorRed: "text-[#e5484d]",
  ColorOrange: "text-[#f97316]",
  ColorGreen: "text-[#2f9e66]",
  ColorBlue: "text-[#2f80ed]",
  ColorPurple: "text-[#8b5cf6]",
  ColorPink: "text-[#db2777]",
  ColorSlate: "text-[#64748b]",
};

interface VaultRichTextDocumentViewProps {
  document: VaultRichTextDocument;
}

export function VaultRichTextDocumentView({ document }: VaultRichTextDocumentViewProps) {
  const boundaries = new Set([0, document.text.length]);
  document.styleMarks.forEach((mark) => {
    boundaries.add(mark.start);
    boundaries.add(mark.end);
  });
  document.noteLinks.forEach((link) => {
    boundaries.add(link.start);
    boundaries.add(link.end);
  });
  const positions = [...boundaries].sort((first, second) => first - second);

  return (
    <div className="whitespace-pre-wrap break-words text-[16px] leading-7 text-slate-700" data-testid="restored-rich-text">
      {positions.slice(0, -1).map((start, index) => {
        const end = positions[index + 1];
        const content = document.text.slice(start, end);
        const styles = document.styleMarks.filter((mark) => mark.start <= start && mark.end >= end).map((mark) => styleClasses[mark.style]);
        const noteLink = document.noteLinks.find((link) => link.start <= start && link.end >= end);
        const className = cn(styles);

        return noteLink ? (
          <Link key={`${start}-${end}`} href={`/notes/${encodeURIComponent(noteLink.noteId)}`} className={cn(className, "text-primary underline decoration-primary/35 underline-offset-2 hover:decoration-primary")}>
            {content}
          </Link>
        ) : (
          <span key={`${start}-${end}`} className={className}>{content}</span>
        );
      })}
    </div>
  );
}
