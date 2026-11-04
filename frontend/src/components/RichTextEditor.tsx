"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { useRef } from "react";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import { useToast } from "@/context/ToastContext";

function Btn({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded px-2 py-1 text-sm hover:bg-slate-200 disabled:opacity-40 ${active ? "bg-indigo-100 text-indigo-700" : "text-slate-700"}`}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px bg-slate-300" aria-hidden />;

function Toolbar({ editor }: { editor: Editor }) {
  const { notify } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"),
      h1: e.isActive("heading", { level: 1 }), h2: e.isActive("heading", { level: 2 }), h3: e.isActive("heading", { level: 3 }),
      ul: e.isActive("bulletList"), ol: e.isActive("orderedList"), link: e.isActive("link"),
      left: e.isActive({ textAlign: "left" }), center: e.isActive({ textAlign: "center" }), right: e.isActive({ textAlign: "right" }),
      inTable: e.isActive("table"),
      canUndo: e.can().undo(), canRedo: e.can().redo(),
    }),
  });

  function setLink() {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL (https://…)", prev ?? "https://");
    if (url === null) return;
    if (url === "") return void editor.chain().focus().unsetLink().run();
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return notify("error", "Links must start with http://, https:// or mailto:");
    editor.chain().focus().extendMarkRange("link").setLink({ href: url, target: "_blank" }).run();
  }

  async function onImage(file: File) {
    const form = new FormData();
    form.append("image", file);
    try {
      const { data } = await api.post<ApiEnvelope<{ url: string }>>("/admin/uploads/image", form);
      editor.chain().focus().setImage({ src: data.data.url, alt: file.name.replace(/\.[^.]+$/, "") }).run();
    } catch (err) {
      notify("error", parseError(err).message);
    }
  }

  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 p-1.5">
      <Btn label="Bold" active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></Btn>
      <Btn label="Italic" active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></Btn>
      <Btn label="Underline" active={s.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></Btn>
      <Sep />
      <Btn label="Heading 1" active={s.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</Btn>
      <Btn label="Heading 2" active={s.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</Btn>
      <Btn label="Heading 3" active={s.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</Btn>
      <Sep />
      <Btn label="Bullet list" active={s.ul} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</Btn>
      <Btn label="Numbered list" active={s.ol} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</Btn>
      <Sep />
      <Btn label="Align left" active={s.left} onClick={() => editor.chain().focus().setTextAlign("left").run()}>⟸</Btn>
      <Btn label="Align center" active={s.center} onClick={() => editor.chain().focus().setTextAlign("center").run()}>≡</Btn>
      <Btn label="Align right" active={s.right} onClick={() => editor.chain().focus().setTextAlign("right").run()}>⟹</Btn>
      <Sep />
      <Btn label="Link" active={s.link} onClick={setLink}>Link</Btn>
      <Btn label="Insert image" onClick={() => fileRef.current?.click()}>Image</Btn>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImage(f); e.target.value = ""; }} />
      <Sep />
      <Btn label="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Table</Btn>
      {s.inTable && (
        <>
          <Btn label="Add row below" onClick={() => editor.chain().focus().addRowAfter().run()}>+Row</Btn>
          <Btn label="Delete row" onClick={() => editor.chain().focus().deleteRow().run()}>−Row</Btn>
          <Btn label="Add column after" onClick={() => editor.chain().focus().addColumnAfter().run()}>+Col</Btn>
          <Btn label="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()}>−Col</Btn>
          <Btn label="Toggle header row" onClick={() => editor.chain().focus().toggleHeaderRow().run()}>Header</Btn>
          <Btn label="Merge or split cells" onClick={() => editor.chain().focus().mergeOrSplit().run()}>Merge</Btn>
          <Btn label="Delete table" onClick={() => editor.chain().focus().deleteTable().run()}>✕ Table</Btn>
        </>
      )}
      <Sep />
      <Btn label="Undo" disabled={!s.canUndo} onClick={() => editor.chain().focus().undo().run()}>↶</Btn>
      <Btn label="Redo" disabled={!s.canRedo} onClick={() => editor.chain().focus().redo().run()}>↷</Btn>
    </div>
  );
}

export function RichTextEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: false, HTMLAttributes: { rel: "noopener noreferrer nofollow" } } }),
      Image.configure({ resize: { enabled: true, directions: ["bottom-right", "bottom-left", "top-right", "top-left"], minWidth: 40, minHeight: 40, alwaysPreserveAspectRatio: true } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: value,
    editorProps: { attributes: { class: "rich-content", "aria-label": "Product description" } },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? "" : e.getHTML()),
  });

  if (!editor) return <div className="h-64 animate-pulse rounded-md border border-slate-200 bg-slate-50" />;

  return (
    <div className="overflow-hidden rounded-md border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-indigo-500">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
