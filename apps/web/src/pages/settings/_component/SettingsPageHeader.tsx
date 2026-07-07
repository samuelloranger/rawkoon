import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface SettingsPageHeaderProps {
  actions?: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  title: ReactNode;
}

export function SettingsPageHeader({
  actions,
  description,
  title,
}: SettingsPageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="break-words text-xl font-semibold tracking-tight text-neutral-100">
          {title}
        </h2>
        {description && (
          <p className="mt-1 max-w-2xl break-words text-sm text-neutral-400">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}
