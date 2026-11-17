import {
  LABEL_CLASS,
  SELECT_CLASS,
} from "@/pages/settings/_component/MediaPostProcessingForm";

export function CardSection({
  id,
  title,
  description,
  children,
  actions,
}: {
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div
      id={id}
      className="scroll-mt-24 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-700/60 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-neutral-400">{description}</p>
          )}
        </div>
        {actions}
      </div>
      <div className="space-y-4 p-6">{children}</div>
    </div>
  );
}

export function ProfileSelect({
  id,
  label,
  noneLabel,
  hint,
  profiles,
  error,
  registration,
}: {
  id: string;
  label: string;
  noneLabel: string;
  hint: string;
  profiles: { id: number; name: string }[];
  error?: string;
  registration: React.ComponentProps<"select">;
}) {
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <select id={id} {...registration} className={SELECT_CLASS}>
        <option value="">{noneLabel}</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      <p className="mt-1.5 text-xs text-neutral-400">{hint}</p>
    </div>
  );
}
