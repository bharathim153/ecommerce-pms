"use client";

import { useState } from "react";
import { RichTextEditor } from "@/components/RichTextEditor";

/** Visual (TipTap) or raw-HTML editing of the same value. Switching remounts the visual editor with the latest HTML. */
export function EmailEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const tab = (m: "visual" | "html", label: string) => (
    <button type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
      className={`rounded-md px-3 py-1 text-sm font-medium ${mode === m ? "bg-indigo-100 text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`}>{label}</button>
  );
  return (
    <div className="space-y-2">
      <div role="tablist" aria-label="Editor mode" className="flex gap-1">{tab("visual", "Visual")}{tab("html", "HTML")}</div>
      {mode === "visual"
        ? <RichTextEditor key="visual" value={value} onChange={onChange} />
        : <textarea aria-label="HTML source" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} rows={18}
            className="block w-full rounded-md border border-slate-300 bg-white p-3 font-mono text-xs" placeholder="<h1>Hello {{name}}</h1>" />}
      <p className="text-xs text-slate-500">Merge tags: <code>{"{{name}}"}</code> <code>{"{{email}}"}</code> <code>{"{{app_name}}"}</code> <code>{"{{unsubscribe_url}}"}</code>. An unsubscribe footer is added to every email automatically. Scripts and unsafe markup are removed on save.</p>
    </div>
  );
}
