import { Suspense } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Library } from "./Library";

export default function LibraryPage() {
  return <Suspense fallback={<Skeleton height={88} />}><Library /></Suspense>;
}
