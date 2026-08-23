import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import {
  Bold,
  Check,
  ChevronDown,
  Heading,
  Italic,
  List,
  ListOrdered,
  Palette,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { VaultRichTextDocument } from "@/lib/restore/vaultRichText";
import { tiptapToVaultRichText, vaultRichTextToTiptap } from "@/lib/restore/vaultRichTextTiptap";

type MyVaultRichTextEditorProps = {
  document: VaultRichTextDocument;
  onChange: (document: VaultRichTextDocument) => void;
};

const colorOptions = [
  { name: "Red", value: "#e5484d" },
  { name: "Orange", value: "#f97316" },
  { name: "Green", value: "#2f9e66" },
  { name: "Blue", value: "#2f80ed" },
  { name: "Purple", value: "#8b5cf6" },
  { name: "Pink", value: "#db2777" },
  { name: "Slate", value: "#64748b" },
] as const;

function ToolButton({ label, active = false, disabled = false, onClick, children }: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn("h-8 w-8 shrink-0 text-slate-600", active && "bg-primary/10 text-primary")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function MyVaultRichTextEditor({ document, onChange }: MyVaultRichTextEditorProps) {
  const documentRef = useRef(document);
  const [, refreshToolbar] = useState(0);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, trailingNode: false, underline: false }),
      Underline,
      TextStyle,
      Color,
    ],
    content: vaultRichTextToTiptap(document),
    editorProps: {
      attributes: {
        class: "tiptap min-h-[34rem] py-5 text-[16px] leading-7 text-slate-700 outline-none",
        "aria-label": "Note body",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const nextDocument = tiptapToVaultRichText(currentEditor.getJSON(), documentRef.current);
      documentRef.current = nextDocument;
      onChange(nextDocument);
      refreshToolbar((value) => value + 1);
    },
    onSelectionUpdate: () => refreshToolbar((value) => value + 1),
    onTransaction: () => refreshToolbar((value) => value + 1),
  });

  useEffect(() => {
    if (!editor || document === documentRef.current) return;
    documentRef.current = document;
    editor.commands.setContent(vaultRichTextToTiptap(document), { emitUpdate: false });
  }, [document, editor]);

  if (!editor) return <div className="min-h-[30rem]" />;

  const headingLevel = ([1, 2, 3, 4] as const).find((level) => editor.isActive("heading", { level }));

  return (
    <div className="min-w-0">
      <div
        className="sticky top-[52px] z-10 flex min-h-11 items-center gap-0.5 overflow-x-auto border-y border-border/60 bg-background/95 px-1 py-1.5 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="formatting-toolbar"
      >
        <ToolButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 />
        </ToolButton>
        <ToolButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 />
        </ToolButton>

        <span className="mx-1 h-5 w-px shrink-0 bg-slate-200" />

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" className={cn("h-8 gap-1 px-2 text-slate-600", headingLevel && "bg-primary/10 text-primary")} aria-label="Text style">
                  {headingLevel ? <Heading /> : <Pilcrow />}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Text style</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuItem onSelect={() => editor.chain().focus().setParagraph().run()}>
              <Pilcrow /> Paragraph {!headingLevel && !editor.isActive("blockquote") && <Check className="ml-auto" />}
            </DropdownMenuItem>
            {([1, 2, 3, 4] as const).map((level) => (
              <DropdownMenuItem key={level} onSelect={() => editor.chain().focus().toggleHeading({ level }).run()}>
                <Heading /> Heading {level} {headingLevel === level && <Check className="ml-auto" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => editor.chain().focus().toggleBlockquote().run()}>
              <Quote /> Quotation {editor.isActive("blockquote") && <Check className="ml-auto" />}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ToolButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold />
        </ToolButton>
        <ToolButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic />
        </ToolButton>
        <ToolButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon />
        </ToolButton>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-slate-600" aria-label="Text colour">
                  <Palette />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Text colour</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Text colour</DropdownMenuLabel>
            <div className="grid grid-cols-7 gap-1.5 px-2 pb-2">
              {colorOptions.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  aria-label={option.name}
                  title={option.name}
                  onClick={() => editor.chain().focus().setColor(option.value).run()}
                  className={cn("h-5 w-5 rounded-full ring-offset-2 transition-shadow hover:ring-2 hover:ring-slate-300", editor.isActive("textStyle", { color: option.value }) && "ring-2 ring-slate-900")}
                  style={{ backgroundColor: option.value }}
                />
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => editor.chain().focus().unsetColor().run()}>
              <RemoveFormatting /> Default colour
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="mx-1 h-5 w-px shrink-0 bg-slate-200" />

        <ToolButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List />
        </ToolButton>
        <ToolButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered />
        </ToolButton>
        <ToolButton label="Quotation" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote />
        </ToolButton>
        <ToolButton label="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
          <RemoveFormatting />
        </ToolButton>
      </div>

      <EditorContent
        editor={editor}
        data-testid="rich-text-editor"
        className="max-w-[760px] [&_.tiptap_blockquote]:my-4 [&_.tiptap_blockquote]:border-l-2 [&_.tiptap_blockquote]:border-primary/35 [&_.tiptap_blockquote]:pl-4 [&_.tiptap_blockquote]:italic [&_.tiptap_blockquote]:text-slate-500 [&_.tiptap_h1]:mb-3 [&_.tiptap_h1]:mt-7 [&_.tiptap_h1]:text-2xl [&_.tiptap_h1]:font-bold [&_.tiptap_h1]:leading-9 [&_.tiptap_h2]:mb-2 [&_.tiptap_h2]:mt-6 [&_.tiptap_h2]:text-xl [&_.tiptap_h2]:font-bold [&_.tiptap_h3]:mb-2 [&_.tiptap_h3]:mt-5 [&_.tiptap_h3]:text-lg [&_.tiptap_h3]:font-semibold [&_.tiptap_h4]:mb-1 [&_.tiptap_h4]:mt-4 [&_.tiptap_h4]:font-semibold [&_.tiptap_li]:my-1 [&_.tiptap_ol]:my-3 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-6 [&_.tiptap_p]:my-2 [&_.tiptap_ul]:my-3 [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-6"
      />
    </div>
  );
}
