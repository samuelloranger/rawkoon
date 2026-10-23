import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import * as Popover from "@radix-ui/react-popover";
import { LogOut, Settings } from "lucide-react";
import { useAuth } from "@/lib/auth/useAuth";
import { useLanguageToggle } from "@/lib/app/useLanguageToggle";
import { useSignOut } from "@/lib/auth/useSignOut";
import { formatDisplayName } from "@/lib/utils/format";
import { displayEmail } from "@/lib/jellyfinEmail";
import { cn } from "@/lib/utils";

type AccountMenuVariant = "sidebar" | "compact" | "tab";

interface AccountMenuProps {
  variant: AccountMenuVariant;
  side?: "top" | "right" | "bottom" | "left";
}

function Avatar({ size }: { size: "sm" | "md" }) {
  const { user } = useAuth();
  if (!user) return null;
  const name = formatDisplayName(user);
  const box = size === "md" ? "h-8 w-8" : "h-6 w-6";
  return user.avatar_url ? (
    <img
      decoding="async"
      src={user.avatar_url}
      alt=""
      className={cn(
        box,
        "shrink-0 rounded-lg object-cover ring-1 ring-white/10",
      )}
    />
  ) : (
    <div
      className={cn(
        box,
        "flex shrink-0 items-center justify-center rounded-lg bg-primary-900/40 text-xs font-semibold text-primary-300",
      )}
    >
      {name.charAt(0).toUpperCase() || "?"}
    </div>
  );
}

/** The one place for settings, language and sign-out, on every screen size. */
export function AccountMenu({ variant, side = "top" }: AccountMenuProps) {
  const { t } = useTranslation("common");
  const { user } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const language = useLanguageToggle();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);

  if (!user) return null;
  const name = formatDisplayName(user);
  const onSettings = pathname.startsWith("/settings");

  const trigger =
    variant === "sidebar" ? (
      <button
        type="button"
        aria-label={t("nav.account")}
        className="focus-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.04]"
      >
        <Avatar size="md" />
        <span className="truncate text-[13px] font-medium text-neutral-300">
          {name}
        </span>
      </button>
    ) : variant === "compact" ? (
      <button
        type="button"
        aria-label={t("nav.account")}
        className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/[0.06]"
      >
        <Avatar size="md" />
      </button>
    ) : (
      <button
        type="button"
        aria-label={t("nav.account")}
        style={{ touchAction: "manipulation" }}
        className={cn(
          "focus-ring flex min-h-[3.5rem] flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium leading-none transition-colors",
          onSettings || open
            ? "text-primary-300"
            : "text-neutral-400 active:text-neutral-200",
        )}
      >
        <Avatar size="sm" />
        <span>{t("nav.account")}</span>
      </button>
    );

  const rowClass =
    "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-neutral-300 transition-colors hover:bg-white/[0.04]";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          align={variant === "tab" ? "end" : "start"}
          sideOffset={8}
          collisionPadding={16}
          className="z-[var(--z-modal)] w-56 overflow-hidden rounded-xl border border-neutral-700/60 bg-neutral-800 p-1.5 shadow-lg"
        >
          <div className="truncate px-2.5 py-1.5 text-xs text-neutral-500">
            {displayEmail(user.email)}
          </div>
          <Link
            to="/settings/profile"
            onClick={() => setOpen(false)}
            className={cn(rowClass, onSettings && "bg-white/[0.06] text-white")}
          >
            <Settings className="h-4 w-4" />
            {t("settings.title")}
          </Link>
          <button type="button" onClick={language.toggle} className={rowClass}>
            <span className="flex-1 text-left">{t("common.language")}</span>
            <span className="text-xs text-neutral-400">
              {language.currentName}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className={rowClass}
          >
            <LogOut className="h-4 w-4" />
            {t("nav.logout")}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
