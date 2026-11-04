import { Suspense } from "react";
import { NewCampaign } from "@/components/email/NewCampaign";

export const instant = false;

export default function Page() {
  return <Suspense fallback={null}><NewCampaign /></Suspense>;
}
