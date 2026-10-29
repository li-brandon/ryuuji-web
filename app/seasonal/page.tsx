import { Suspense } from "react";
import { Seasonal, SeasonalSkeleton } from "./Seasonal";

export default function SeasonalPage() {
  return <Suspense fallback={<SeasonalSkeleton />}><Seasonal /></Suspense>;
}
