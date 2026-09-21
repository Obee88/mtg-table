import { useEffect, useState } from 'react';

/** Subscribes to a CSS media query; server-safe (false until measured). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Tablet-sized or smaller: the table needs the full width, so the log becomes an overlay. */
export function useNarrowScreen(): boolean {
  return useMediaQuery('(max-width: 1024px)');
}
