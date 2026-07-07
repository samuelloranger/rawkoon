import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface IntegrationUrlInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  description?: string;
  className?: string;
}

function isValidUrl(value: string): boolean {
  if (!value) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function IntegrationUrlInput({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  description,
  className,
}: IntegrationUrlInputProps) {
  const { t } = useTranslation("common");
  const [error, setError] = useState("");

  const handleBlur = () => {
    if (value && !isValidUrl(value)) {
      setError(t("settings.integrations.invalidUrl"));
    } else {
      setError("");
    }
    onBlur?.();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    if (error) setError("");
  };

  return (
    <div className={className}>
      <label className="block text-sm font-medium text-neutral-300 mb-2">
        {label}
      </label>
      {description && (
        <p className="mb-2 text-xs text-neutral-400">{description}</p>
      )}
      <input
        type="url"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        className={cn(
          "w-full px-4 py-2 border rounded-lg bg-neutral-900 text-white transition-colors",
          error
            ? "border-red-500 focus:ring-red-400"
            : "border-neutral-600 focus:ring-primary-500",
        )}
      />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
