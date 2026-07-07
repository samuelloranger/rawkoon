import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCustomFormatsList } from "@/pages/settings/useCustomFormats";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Assignment {
  custom_format_id: number;
  score: number;
  required: boolean;
  forbidden: boolean;
}

interface Props {
  value: Assignment[];
  onChange: (next: Assignment[]) => void;
}

// ─── Shared input styling (matches the form's selectClass) ───────────────────

const selectClass =
  "w-full rounded-lg border px-3 py-2 text-sm border-neutral-700 bg-neutral-900 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-colors";

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm border-neutral-700 bg-neutral-900 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-colors";

// ─── Mutual-exclusivity toggle (required / forbidden / neither) ──────────────

type Stance = "required" | "forbidden" | "neither";

function stanceOf(a: Assignment): Stance {
  if (a.required) return "required";
  if (a.forbidden) return "forbidden";
  return "neither";
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CustomFormatAssignmentEditor({ value, onChange }: Props) {
  const { t } = useTranslation("common");
  const { data } = useCustomFormatsList({ staleTime: 30_000 });
  const allFormats = data?.custom_formats ?? [];

  // Formats not yet assigned
  const assignedIds = new Set(value.map((a) => a.custom_format_id));
  const available = allFormats.filter((f) => !assignedIds.has(f.id));

  // Lookup helper
  function nameOf(id: number): string {
    return allFormats.find((f) => f.id === id)?.name ?? String(id);
  }

  function addAssignment(id: number) {
    onChange([
      ...value,
      { custom_format_id: id, score: 0, required: false, forbidden: false },
    ]);
  }

  function removeAssignment(id: number) {
    onChange(value.filter((a) => a.custom_format_id !== id));
  }

  function updateAssignment(id: number, patch: Partial<Assignment>) {
    onChange(
      value.map((a) => (a.custom_format_id === id ? { ...a, ...patch } : a)),
    );
  }

  function applyStance(id: number, stance: Stance) {
    updateAssignment(id, {
      required: stance === "required",
      forbidden: stance === "forbidden",
    });
  }

  if (allFormats.length === 0) {
    return (
      <p className="text-sm text-neutral-400 italic py-1">
        {t("customFormats.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Existing assignment rows */}
      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((assignment) => {
            const stance = stanceOf(assignment);
            return (
              <div
                key={assignment.custom_format_id}
                className="flex items-center gap-2 rounded-lg border px-3 py-2 border-neutral-700 bg-neutral-800/50"
              >
                {/* Format name */}
                <span className="flex-1 min-w-0 truncate text-sm font-medium text-neutral-200">
                  {nameOf(assignment.custom_format_id)}
                </span>

                {/* Score input */}
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs text-neutral-400">
                    {t("customFormats.score")}
                  </span>
                  <input
                    type="number"
                    aria-label={`${t("customFormats.score")} ${nameOf(assignment.custom_format_id)}`}
                    value={assignment.score}
                    onChange={(e) =>
                      updateAssignment(assignment.custom_format_id, {
                        score: Number(e.target.value) || 0,
                      })
                    }
                    className={cn(inputClass, "w-20 text-center")}
                  />
                </div>

                {/* Mutual-exclusive stance selector */}
                <select
                  aria-label={`stance ${nameOf(assignment.custom_format_id)}`}
                  value={stance}
                  onChange={(e) =>
                    applyStance(
                      assignment.custom_format_id,
                      e.target.value as Stance,
                    )
                  }
                  className={cn(selectClass, "w-32 shrink-0")}
                >
                  <option value="neither">—</option>
                  <option value="required">
                    {t("customFormats.required")}
                  </option>
                  <option value="forbidden">
                    {t("customFormats.forbidden")}
                  </option>
                </select>

                {/* Remove button */}
                <button
                  type="button"
                  aria-label={`remove ${nameOf(assignment.custom_format_id)}`}
                  onClick={() => removeAssignment(assignment.custom_format_id)}
                  className="shrink-0 rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-neutral-200"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add selector — only shown when unassigned formats exist */}
      {available.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) addAssignment(Number(e.target.value));
          }}
          className={cn(selectClass, "text-neutral-400")}
          aria-label="add custom format"
        >
          <option value="" disabled>
            + {t("customFormats.title")}…
          </option>
          {available.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
