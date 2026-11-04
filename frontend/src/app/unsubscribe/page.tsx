import { Suspense } from "react";
import { UnsubscribeView } from "@/components/UnsubscribeView";

export const instant = false;

export default function Page() {
  return <Suspense fallback={null}><UnsubscribeView /></Suspense>;
}
