/** Re-mounts on navigation, so each page fades in (see .page in globals.css). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page">{children}</div>;
}
