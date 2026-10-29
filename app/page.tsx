import { QuickAddButton } from "@/components/QuickAdd";
import { EmptyState } from "@/components/ui/EmptyState";

export default function UpNextPage() {
  return (
    <>
      <header className="page-header">
        <h1>Up Next</h1>
        <p>The next episode of everything you’re watching.</p>
      </header>
      <EmptyState icon="upNext" title="Nothing up next yet" action={<QuickAddButton>Find something to watch</QuickAddButton>}>
        Add a show or movie and its next episode lands here, ready to log in one tap. Press ⌘K or Ctrl-K to search anywhere.
      </EmptyState>
    </>
  );
}
