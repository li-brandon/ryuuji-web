"use client";

import { useCallback, useState } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import styles from "./ui.module.css";

type Props = { src: string | null; alt?: string; small?: boolean; className?: string };

/**
 * 2:3 poster art: shimmers while loading, fades in, and falls back to an icon when there is no
 * artwork or it fails. Width comes from the container (or `small` for 46px list thumbnails).
 */
export function Poster(props: Props) {
  // A new src starts over from "loading".
  return <PosterArt key={props.src} {...props} />;
}

function PosterArt({ src, alt = "", small, className }: Props) {
  const [state, setState] = useState<"loading" | "loaded" | "error">(src ? "loading" : "error");
  // An image cached before hydration has already fired `load`, so check on mount too.
  const onMount = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete) setState(img.naturalWidth ? "loaded" : "error");
  }, []);

  return (
    <span className={cx(styles.poster, small && styles.posterSm, className)} data-state={state}>
      {src && state !== "error" && (
        // TMDB serves pre-sized posters, so next/image optimization adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={onMount}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
        />
      )}
      {state === "error" && (
        <span className={styles.posterFallback} role={alt ? "img" : undefined} aria-label={alt || undefined}>
          <Icon name="film" size={small ? 18 : 28} />
        </span>
      )}
    </span>
  );
}
