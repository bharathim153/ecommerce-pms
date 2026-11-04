"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { TemplateForm } from "@/components/email/TemplateForm";
import { Spinner } from "@/components/ui";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import type { EmailTemplate } from "@/types";

export function EditTemplate() {
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<EmailTemplate | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.get<ApiEnvelope<EmailTemplate>>(`/admin/email/templates/${id}`).then((r) => setT(r.data.data)).catch((e) => setError(parseError(e).status === 404 ? "Template not found." : parseError(e).message)); }, [id]);
  if (error) return <p className="text-red-700">{error}</p>;
  if (!t) return <Spinner label="Loading template" />;
  return <TemplateForm key={t.id} template={t} />;
}
