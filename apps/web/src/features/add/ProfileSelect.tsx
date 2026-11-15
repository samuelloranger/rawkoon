import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ProfileSelect({
  profiles,
  value,
  onChange,
  label,
  className,
}: {
  profiles: { id: number; name: string }[];
  value: number | null;
  onChange: (id: number) => void;
  label: string;
  className?: string;
}) {
  return (
    <Select
      value={value == null ? undefined : String(value)}
      onValueChange={(v) => onChange(Number(v))}
    >
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {profiles.map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
