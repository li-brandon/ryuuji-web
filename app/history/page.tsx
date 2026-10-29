import { EmptyState } from "@/components/ui/EmptyState";

export default function HistoryPage() {
  return (
    <>
      <header className="page-header">
        <h1>History</h1>
        <p>Every episode and movie you’ve logged.</p>
      </header>
      <EmptyState icon="history" title="No watches logged yet">
        When you log an episode or movie it appears here, newest first, so you can look back or fix a mistake.
      </EmptyState>
    </>
  );
}
