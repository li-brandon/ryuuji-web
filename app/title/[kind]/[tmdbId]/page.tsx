import { notFound } from "next/navigation";
import { kindSchema } from "@/lib/types";
import { TitleDetail } from "./TitleDetail";

export default async function TitlePage({ params }: { params: Promise<{ kind: string; tmdbId: string }> }) {
  const route = await params;
  const kind = kindSchema.safeParse(route.kind);
  const tmdbId = Number(route.tmdbId);
  if (!kind.success || !Number.isSafeInteger(tmdbId) || tmdbId <= 0) notFound();
  return <TitleDetail titleKey={{ kind: kind.data, tmdbId }} />;
}
