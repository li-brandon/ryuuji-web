import { QuickAddButton } from "@/components/QuickAdd";
import { EmptyState } from "@/components/ui/EmptyState";

export default function LibraryPage() {
  return (
    <>
      <header className="page-header">
        <h1>Library</h1>
        <p>Everything you track, from Plan to Watch to Completed.</p>
      </header>
      <EmptyState icon="library" title="Your library is empty" action={<QuickAddButton>Add a title</QuickAddButton>}>
        Search TMDB for a movie or show to start your library. New titles land in Plan to Watch.
      </EmptyState>
    </>
  );
}
