import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Film, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Primary action look from the approved design: parchment accent on the dark panel. */
export const PRIMARY_BTN =
  "focus-ring rounded-xl bg-primary-400 px-[18px] py-[11px] text-[15px] font-semibold text-neutral-950 transition-colors hover:bg-primary-300 disabled:cursor-not-allowed disabled:opacity-50";
export const GHOST_BTN =
  "focus-ring rounded-xl border border-border px-[18px] py-[11px] text-[15px] font-semibold text-neutral-100 transition-colors hover:border-border-strong";

/** Centered two-column dialog from `sm` up, bottom sheet below it, small tray when `tray`. */
export function AddDialogShell({
  title,
  subtitle,
  posterUrl,
  onClose,
  tray = false,
  children,
}: {
  title: string;
  subtitle?: string;
  posterUrl?: string | null;
  onClose: () => void;
  tray?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation("common");
  return (
    <RadixDialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[var(--z-modal)] bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <RadixDialog.Content
          aria-describedby={undefined}
          // Focus the panel, not the first control, so no field opens with a focus ring.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          className={cn(
            "fixed z-[var(--z-modal)] overflow-y-auto overscroll-contain border border-border bg-surface-raised text-left shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] outline-none",
            "max-h-[88dvh] data-[state=open]:animate-in data-[state=open]:duration-200 motion-reduce:animate-none",
            tray
              ? "inset-x-3 bottom-4 rounded-[22px] p-3.5 data-[state=open]:slide-in-from-bottom-4 sm:left-1/2 sm:right-auto sm:w-[420px] sm:-translate-x-1/2"
              : [
                  "inset-x-0 bottom-0 rounded-t-3xl px-[18px] pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2 data-[state=open]:slide-in-from-bottom-full",
                  "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:grid sm:w-[min(800px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:grid-cols-[170px_1fr] sm:rounded-[20px] sm:p-0 sm:data-[state=open]:fade-in-0 sm:data-[state=open]:zoom-in-95 sm:data-[state=open]:slide-in-from-bottom-0",
                ],
          )}
        >
          {tray ? (
            <div className="flex items-center justify-between gap-2">
              <RadixDialog.Title className="font-display text-[17px] font-semibold leading-tight text-neutral-50">
                {title}
              </RadixDialog.Title>
              {subtitle && (
                <span className="shrink-0 text-[13px] text-neutral-400">
                  {subtitle}
                </span>
              )}
            </div>
          ) : (
            <>
              <div className="mx-auto mb-2 h-[5px] w-[38px] rounded-full bg-border-strong sm:hidden" />
              <div className="relative hidden min-h-full bg-neutral-800 sm:block">
                {posterUrl ? (
                  <img
                    src={posterUrl}
                    alt=""
                    className="absolute inset-0 size-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-primary-950 to-neutral-950">
                    <Film className="size-8 text-neutral-500" />
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-4 sm:gap-[18px] sm:px-6 sm:pb-5 sm:pt-[22px]">
                <div className="flex items-center gap-3 pr-8 sm:block">
                  <div className="h-[68px] w-[46px] shrink-0 overflow-hidden rounded-lg bg-neutral-800 sm:hidden">
                    {posterUrl && (
                      <img
                        src={posterUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <RadixDialog.Title className="font-display text-[19px] font-semibold leading-tight text-neutral-50 sm:text-[23px]">
                      {title}
                    </RadixDialog.Title>
                    {subtitle && (
                      <p className="mt-0.5 text-[13px] text-neutral-400 sm:text-sm">
                        {subtitle}
                      </p>
                    )}
                  </div>
                </div>
                {children}
              </div>
              <RadixDialog.Close
                aria-label={t("a11y.closeDialog")}
                className="focus-ring absolute right-3.5 top-3 rounded-full p-1 text-neutral-400 hover:bg-neutral-700/60 hover:text-neutral-200"
              >
                <X className="size-5" />
              </RadixDialog.Close>
            </>
          )}
          {tray && children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 text-[13px] font-medium text-neutral-400">
      {children}
    </p>
  );
}
