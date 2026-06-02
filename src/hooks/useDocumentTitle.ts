import { useEffect } from "react";

/**
 * Sets `document.title` to "<title> · AA Cockpit" while the component is mounted.
 * Restores the previous title on unmount.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · AA Cockpit`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
