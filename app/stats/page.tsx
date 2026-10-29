import { EmptyState } from "@/components/ui/EmptyState";

export default function StatsPage() {
  return (
    <>
      <header className="page-header">
        <h1>Stats</h1>
        <p>Your watching, by the numbers.</p>
      </header>
      <EmptyState icon="stats" title="Stats need a few logs">
        Log some episodes and movies to see your watch time, streaks and favorite genres.
      </EmptyState>
    </>
  );
}
