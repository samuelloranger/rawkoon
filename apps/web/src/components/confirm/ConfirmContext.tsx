import * as AlertDialog from "@radix-ui/react-alert-dialog";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ConfirmVariant = "default" | "destructive";

type ConfirmOptions = {
  variant?: ConfirmVariant;
  title?: string;
  description?: ReactNode;
  /** When true, renders no description block. Defaults to false; falls back to i18n default if `description` is omitted. */
  hideDescription?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
};

export type ConfirmFn = (options: ConfirmOptions) => void;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): { confirm: ConfirmFn } {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return { confirm: ctx };
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation("common");
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<ConfirmOptions | null>(null);
  const confirmedCloseRef = useRef(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    dialogRef.current = dialog;
  }, [dialog]);

  const confirmFn = useCallback((opts: ConfirmOptions) => {
    setDialog((cur) => (cur !== null ? cur : opts));
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    if (!next) {
      if (!confirmedCloseRef.current) {
        dialogRef.current?.onCancel?.();
      }
      confirmedCloseRef.current = false;
      setDialog(null);
      setBusy(false);
    }
  }, []);

  const handleConfirm = useCallback(async () => {
    const opts = dialogRef.current;
    if (!opts || busy) return;
    try {
      setBusy(true);
      await Promise.resolve(opts.onConfirm());
      confirmedCloseRef.current = true;
      setDialog(null);
    } catch {
      // Stay open; caller should surface errors (e.g. toast).
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const variant = dialog?.variant ?? "destructive";
  const title = dialog?.title ?? t("common.confirmDialog.title");
  const description =
    dialog?.description ?? t("common.confirmDialog.description");
  const confirmLabel =
    dialog?.confirmLabel ?? t("common.confirmDialog.confirmLabel");
  const cancelLabel = dialog?.cancelLabel ?? t("common.cancel");

  return (
    <ConfirmContext.Provider value={confirmFn}>
      {children}
      <AlertDialog.Root open={dialog !== null} onOpenChange={handleOpenChange}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <AlertDialog.Content
            className={cn(
              "fixed left-1/2 top-1/2 z-[var(--z-modal)] grid max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-2xl border p-6 text-left shadow-xl outline-none border-neutral-700 bg-neutral-800",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            )}
            onOpenAutoFocus={
              variant === "destructive"
                ? (e) => {
                    e.preventDefault();
                    cancelButtonRef.current?.focus();
                  }
                : undefined
            }
          >
            <AlertDialog.Title className="text-lg font-medium leading-6 text-white">
              {title}
            </AlertDialog.Title>
            {dialog?.hideDescription ? (
              <AlertDialog.Description className="sr-only">
                {title}
              </AlertDialog.Description>
            ) : (
              <AlertDialog.Description asChild>
                <div className="text-sm text-neutral-400">{description}</div>
              </AlertDialog.Description>
            )}
            <div className="flex flex-row justify-end gap-2 pt-2">
              <AlertDialog.Cancel asChild>
                <Button
                  ref={cancelButtonRef}
                  type="button"
                  variant="outline"
                  disabled={busy}
                >
                  {cancelLabel}
                </Button>
              </AlertDialog.Cancel>
              <Button
                type="button"
                variant={variant === "destructive" ? "destructive" : "default"}
                disabled={busy}
                aria-busy={busy}
                onClick={() => void handleConfirm()}
              >
                {busy ? t("common.loading") : confirmLabel}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}
