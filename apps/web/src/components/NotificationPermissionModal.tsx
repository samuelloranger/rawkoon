import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

interface NotificationPermissionModalProps {
  isOpen: boolean;
  onAllow: () => void;
  onDismiss: () => void;
}

export function NotificationPermissionModal({
  isOpen,
  onAllow,
  onDismiss,
}: NotificationPermissionModalProps) {
  const { t } = useTranslation("common");
  const [shouldRender, setShouldRender] = useState(isOpen);

  if (isOpen && !shouldRender) {
    setShouldRender(true);
  }

  useEffect(() => {
    if (!isOpen && shouldRender) {
      const timer = setTimeout(() => setShouldRender(false), 300);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isOpen, shouldRender]);

  if (!shouldRender) {
    return null;
  }

  const isClosing = !isOpen;

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notification-modal-title"
    >
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-black opacity-50 duration-300",
          isClosing ? "animate-out fade-out" : "animate-in fade-in",
        )}
        onClick={onDismiss}
      />

      {/* Modal */}
      <div
        className={cn(
          "relative bg-neutral-800 rounded-lg shadow-xl max-w-md w-full max-h-[90dvh] overflow-y-auto p-6 border border-neutral-700 duration-300",
          isClosing
            ? "animate-out fade-out zoom-out-95"
            : "animate-in fade-in zoom-in-95",
        )}
      >
        <div className="flex items-start mb-4">
          <div className="flex-shrink-0">
            <Bell className="w-8 h-8 text-primary-400" />
          </div>
          <div className="ml-4 flex-1">
            <h3
              id="notification-modal-title"
              className="text-lg font-semibold text-white mb-2"
            >
              {t("notifications.modal.title")}
            </h3>
            <p className="text-sm text-neutral-300">
              {t("notifications.modal.description")}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          <button
            onClick={onAllow}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors font-medium"
          >
            {t("notifications.modal.allow")}
          </button>
          <button
            onClick={onDismiss}
            className="flex-1 px-4 py-2 bg-neutral-700 text-neutral-200 rounded-md hover:bg-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2 transition-colors font-medium"
          >
            {t("notifications.modal.dismiss")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
