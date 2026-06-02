import { useEffect } from "react";

type HotkeyHandler = (e: KeyboardEvent) => void;

/**
 * Lightweight keyboard shortcut hook.
 *
 * Usage:
 *   useHotkeys({
 *     "k": (e) => { if (e.metaKey) openCommandPalette() },
 *     "?": () => showShortcutModal(),
 *   });
 *
 * Modifier-key combos: check `e.metaKey`, `e.ctrlKey`, `e.shiftKey` inside the handler.
 * Skips firing when the user is typing in an input/textarea/contenteditable element.
 */
export function useHotkeys(handlers: Record<string, HotkeyHandler>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        // Only allow meta-key shortcuts through when typing
        if (!e.metaKey && !e.ctrlKey) return;
      }

      const handler = handlers[e.key.toLowerCase()];
      if (handler) handler(e);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}
