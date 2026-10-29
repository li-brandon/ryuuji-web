import type { Metadata } from "next";
import { Gallery } from "./Gallery";

export const metadata: Metadata = { title: "Components" };

export default function ComponentsPage() {
  return (
    <>
      <header className="page-header">
        <h1>Components</h1>
        <p>Every shared component from components/ui, in light and dark side by side.</p>
      </header>
      <Gallery />
    </>
  );
}
