import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  widthClass = "max-w-2xl",
  closeDisabled = false,
  initialFocusRef,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  widthClass?: string;
  closeDisabled?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const first = dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      const requested = initialFocusRef?.current;
      (requested && dialog?.contains(requested) ? requested : first ?? dialog)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      const previous = previousFocusRef.current;
      if (previous?.isConnected) previous.focus();
    };
  }, [initialFocusRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!closeDisabled) {
          event.preventDefault();
          onClose();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter((element) => !element.hasAttribute("disabled") && element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeDisabled, onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 sm:items-center"
      onClick={() => { if (!closeDisabled) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`flex max-h-[92vh] w-full ${widthClass} flex-col overflow-hidden rounded-t-[16px] border border-line bg-ink-200 shadow-2xl sm:rounded-[16px]`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-medium text-paper">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-2xs leading-4 text-paper-3">{description}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            className="text-paper-3 hover:text-paper disabled:cursor-not-allowed disabled:opacity-40"
            disabled={closeDisabled}
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-5">{children}</main>
        {footer && <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
