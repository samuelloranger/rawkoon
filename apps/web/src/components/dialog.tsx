import * as RadixDialog from "@radix-ui/react-dialog";
import { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  showCloseButton?: boolean;
  hideTitle?: boolean;
  panelClassName?: string;
  /** Panel shell does not scroll; children should use a fixed top block + overflow-y-auto region */
  bodyScroll?: boolean;
}

export function Dialog({
  isOpen,
  onClose,
  title,
  children,
  showCloseButton = true,
  hideTitle = false,
  panelClassName,
  bodyScroll = false,
}: DialogProps) {
  return (
    <RadixDialog.Root
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            "fixed inset-0 z-[var(--z-modal)] bg-black/50",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            "data-[state=open]:duration-150 data-[state=closed]:duration-100",
          )}
        />
        <div className="fixed inset-0 z-[var(--z-modal)] overflow-y-auto overscroll-contain">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <RadixDialog.Content
              onOpenAutoFocus={(e) => e.preventDefault()}
              className={cn(
                "pointer-events-auto flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-2xl border p-6 text-left align-middle shadow-xl outline-none border-neutral-700 bg-neutral-800",
                "data-[state=open]:animate-in data-[state=closed]:animate-out",
                "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
                "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
                "data-[state=open]:duration-150 data-[state=closed]:duration-100",
                bodyScroll ? "min-h-0 overflow-hidden" : "overflow-y-auto",
                hideTitle && "relative",
                panelClassName,
              )}
            >
              <RadixDialog.Title
                className={cn(
                  hideTitle
                    ? "sr-only"
                    : cn(
                        "pb-2 shrink-0 text-lg font-medium leading-6 text-white",
                        panelClassName?.includes("p-0") ? "pt-4 px-6" : "",
                      ),
                )}
              >
                {title}
              </RadixDialog.Title>
              <RadixDialog.Description className="sr-only">
                {title}
              </RadixDialog.Description>

              {showCloseButton && (
                <RadixDialog.Close
                  aria-label="Close dialog"
                  className={cn(
                    "pointer-events-auto absolute shrink-0 rounded-full p-1 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/60 transition-colors",
                    hideTitle ? "top-4 right-4 z-20" : "top-5 right-5 z-20",
                  )}
                >
                  <X className="h-5 w-5" />
                </RadixDialog.Close>
              )}

              <div
                className={cn(
                  "min-h-0 flex-1",
                  bodyScroll && "flex min-h-0 flex-col overflow-hidden",
                )}
              >
                {children}
              </div>
            </RadixDialog.Content>
          </div>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
