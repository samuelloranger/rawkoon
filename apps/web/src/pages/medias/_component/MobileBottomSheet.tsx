import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileBottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  bodyClassName?: string;
  footer: ReactNode;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function MobileBottomSheet({
  open,
  onClose,
  title,
  closeLabel,
  bodyClassName,
  footer,
  children,
}: MobileBottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      const focusable =
        sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      focusable?.[0]?.focus();
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
      return;
    }

    if (e.key !== "Tab") return;

    const focusable = Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
      return;
    }

    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            onClick={onClose}
          />

          <motion.div
            key="sheet"
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onKeyDown={handleKeyDown}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{
              type: "spring",
              damping: 32,
              stiffness: 380,
              mass: 0.9,
            }}
            className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[88dvh] flex-col rounded-t-2xl bg-neutral-900 shadow-2xl"
          >
            <div className="flex shrink-0 justify-center pb-1 pt-3">
              <div className="h-1 w-10 rounded-full bg-neutral-700" />
            </div>

            <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-5 py-3">
              <span className="text-sm font-semibold text-neutral-100">
                {title}
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label={closeLabel}
                className="rounded-full p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
              >
                <X size={15} />
              </button>
            </div>

            <div
              className={cn("flex-1 overflow-y-auto px-5 py-5", bodyClassName)}
            >
              {children}
            </div>

            <div
              className="flex shrink-0 items-center gap-3 border-t border-neutral-800 px-5 py-4"
              style={{
                paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
              }}
            >
              {footer}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
