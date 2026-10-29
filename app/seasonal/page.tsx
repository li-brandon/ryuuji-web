import { EmptyState } from "@/components/ui/EmptyState";

export default function SeasonalPage() {
  return (
    <>
      <header className="page-header">
        <h1>Seasonal</h1>
        <p>This season’s anime at a glance.</p>
      </header>
      <EmptyState icon="seasonal" title="The seasonal chart is on its way">
        Soon you’ll browse what’s airing this season and add shows to follow with one tap.
      </EmptyState>
    </>
  );
}
