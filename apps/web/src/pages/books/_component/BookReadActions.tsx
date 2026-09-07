import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import type { Book } from "@rawkoon/shared/types";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm/ConfirmContext";
import { toast } from "sonner";
import { useSetBookRead } from "../_hooks/useBooks";

export function BookReadBadge() {
  const { t } = useTranslation("common");
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-emerald-300">
      <Check className="h-3 w-3" />
      {t("books.readBadge")}
    </span>
  );
}

function useMarkBookRead() {
  const { t } = useTranslation("common");
  const { confirm } = useConfirm();
  const setRead = useSetBookRead();

  const markRead = (book: Book) => {
    confirm({
      variant: "default",
      title: t("books.markRead"),
      description: t("books.markReadConfirm", { title: book.title }),
      confirmLabel: t("books.markReadConfirmAction"),
      onConfirm: async () => {
        try {
          await setRead.mutateAsync({ id: book.id, read: true });
          toast.success(t("books.markReadDone"));
        } catch {
          toast.error(t("books.markReadFailed"));
          throw new Error("mark-read failed");
        }
      },
    });
  };

  const markUnread = async (book: Book) => {
    try {
      await setRead.mutateAsync({ id: book.id, read: false });
      toast.success(t("books.markUnreadDone"));
    } catch {
      toast.error(t("books.markReadFailed"));
    }
  };

  return { markRead, markUnread, isPending: setRead.isPending };
}

export function MarkBookReadAction({ book }: { book: Book }) {
  const { t } = useTranslation("common");
  const { markRead, markUnread, isPending } = useMarkBookRead();
  const isRead = book.read_at != null;

  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={isPending}
      onClick={() => (isRead ? void markUnread(book) : markRead(book))}
    >
      {isRead ? t("books.markUnread") : t("books.markRead")}
    </Button>
  );
}

type MenuPos = { x: number; y: number };

export function BookReadContextMenu({
  book,
  children,
}: {
  book: Book;
  children: ReactNode;
}) {
  const { t } = useTranslation("common");
  const { markRead, markUnread, isPending } = useMarkBookRead();
  const [pos, setPos] = useState<MenuPos | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isRead = book.read_at != null;

  useEffect(() => {
    if (!pos) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPos(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [pos]);

  return (
    <div
      className="relative"
      onContextMenu={(e) => {
        e.preventDefault();
        setPos({ x: e.clientX, y: e.clientY });
      }}
    >
      {children}
      {pos && (
        <div
          ref={menuRef}
          role="menu"
          style={{ top: pos.y, left: pos.x }}
          className="fixed z-[var(--z-popover)] min-w-48 rounded-md border border-neutral-700 bg-neutral-800 p-1 text-sm text-neutral-100 shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
        >
          <button
            type="button"
            role="menuitem"
            disabled={isPending}
            className="w-full rounded px-2 py-1.5 text-left hover:bg-neutral-700 disabled:opacity-50"
            onClick={() => {
              setPos(null);
              if (isRead) void markUnread(book);
              else markRead(book);
            }}
          >
            {isRead ? t("books.markUnread") : t("books.markRead")}
          </button>
        </div>
      )}
    </div>
  );
}
