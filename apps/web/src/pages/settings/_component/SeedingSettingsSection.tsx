import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import type {
  IndexerSeedRuleRow,
  MediaPostProcessingSettings,
  SeedRule,
} from "@rawkoon/shared/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useUpdateMediaPostProcessingSettings } from "@/features/medias/hooks/useUpdateMediaPostProcessingSettings";
import { useSeeding } from "@/features/seeding/hooks/useSeeding";
import {
  useDeleteSeedRule,
  useSeedRules,
  useUpsertSeedRule,
} from "@/features/seeding/hooks/useSeedRules";
import {
  draftFromRule,
  type RuleDraft,
  ruleFromDraft,
  ruleSentence,
} from "@/features/seeding/lib/ruleDraft";
import { formatBytes } from "@/lib/utils/format";

const FIELD =
  "focus-ring w-20 rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm tabular-nums";

function RuleFields({
  draft,
  onChange,
}: {
  draft: RuleDraft;
  onChange: (d: RuleDraft) => void;
}) {
  const { t } = useTranslation("common");
  return (
    <div className="flex flex-wrap gap-2.5">
      <label className="grid gap-1 text-xs text-neutral-500">
        {t("settings.seeding.ratio")}
        <input
          inputMode="decimal"
          className={FIELD}
          placeholder={t("settings.seeding.none")}
          value={draft.ratio}
          aria-label={t("settings.seeding.ratio")}
          onChange={(e) => onChange({ ...draft, ratio: e.target.value })}
        />
      </label>
      <label className="grid gap-1 text-xs text-neutral-500">
        {t("settings.seeding.seedTime")}
        <span className="flex">
          <input
            inputMode="decimal"
            className={`${FIELD} rounded-r-none`}
            placeholder={t("settings.seeding.none")}
            value={draft.time}
            aria-label={t("settings.seeding.seedTime")}
            onChange={(e) => onChange({ ...draft, time: e.target.value })}
          />
          <select
            className="rounded-r-lg border border-l-0 border-neutral-700 bg-neutral-800 px-2 text-sm"
            value={draft.unit}
            aria-label={t("settings.seeding.seedTime")}
            onChange={(e) =>
              onChange({ ...draft, unit: e.target.value as RuleDraft["unit"] })
            }
          >
            <option value="hours">{t("settings.seeding.unitHours")}</option>
            <option value="days">{t("settings.seeding.unitDays")}</option>
          </select>
        </span>
      </label>
    </div>
  );
}

function RuleCard({
  title,
  isPrivate,
  draft,
  onChange,
}: {
  title: string;
  isPrivate?: boolean;
  draft: RuleDraft;
  onChange: (d: RuleDraft) => void;
}) {
  const { t } = useTranslation("common");
  const rule = ruleFromDraft(draft);
  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-800 p-4">
      <h3 className="mb-3 flex items-center gap-1.5 font-sans text-sm font-semibold text-neutral-100">
        {isPrivate && <Lock size={13} aria-hidden />}
        {title}
      </h3>
      <RuleFields draft={draft} onChange={onChange} />
      <p className="mt-2.5 min-h-5 text-sm text-neutral-200" aria-live="polite">
        {rule ? (
          ruleSentence(rule, t)
        ) : (
          <span className="text-red-400">{t("settings.seeding.invalid")}</span>
        )}
      </p>
    </div>
  );
}

function IndexerRuleRow({ row }: { row: IndexerSeedRuleRow }) {
  const { t } = useTranslation("common");
  const upsert = useUpsertSeedRule();
  const remove = useDeleteSeedRule();
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const parsed = editing ? ruleFromDraft(editing) : null;
  const inheritedFrom = t(
    row.is_private
      ? "settings.seeding.indexers.sourcePrivate"
      : "settings.seeding.indexers.sourcePublic",
  );
  return (
    <tr className="border-b border-neutral-700 last:border-0">
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5">
          {row.is_private && <Lock size={12} aria-hidden />}
          {row.indexer}
        </span>
      </td>
      <td className="px-3 py-2.5">
        {editing ? (
          <RuleFields draft={editing} onChange={setEditing} />
        ) : row.override ? (
          <span className="text-primary-300">
            {ruleSentence(row.effective, t)}
          </span>
        ) : (
          <span className="text-neutral-500">
            {t("settings.seeding.indexers.inherited", {
              rule: ruleSentence(row.effective, t),
              source: inheritedFrom,
            })}
          </span>
        )}
      </td>
      <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">
        {row.held_count}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        {editing ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={!parsed}
              onClick={async () => {
                if (!parsed) return;
                await upsert.mutateAsync({
                  indexer: row.indexer,
                  rule: parsed,
                });
                setEditing(null);
              }}
            >
              {t("settings.seeding.indexers.save")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(null)}
            >
              {t("settings.seeding.indexers.cancel")}
            </Button>
          </>
        ) : row.override ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => remove.mutateAsync(row.indexer)}
          >
            {t("settings.seeding.indexers.useDefault")}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(draftFromRule(row.effective))}
          >
            {t("settings.seeding.indexers.customize")}
          </Button>
        )}
      </td>
    </tr>
  );
}

export function SeedingSettingsSection({
  settings,
}: {
  settings: MediaPostProcessingSettings;
}) {
  const { t } = useTranslation("common");
  const update = useUpdateMediaPostProcessingSettings();
  const [enabled, setEnabled] = useState(settings.seed_sweep_enabled);
  const [pub, setPub] = useState<RuleDraft>(() =>
    draftFromRule({
      ratio: settings.min_seed_ratio > 0 ? settings.min_seed_ratio : null,
      seed_time_mins: settings.public_seed_time_mins,
    }),
  );
  const [priv, setPriv] = useState<RuleDraft>(() =>
    draftFromRule({
      ratio: settings.private_seed_ratio,
      seed_time_mins: settings.private_seed_time_mins,
    }),
  );
  const preview = useSeeding({ preview: true, enabled: !enabled });
  const rules = useSeedRules();
  const wouldRelease = preview.data?.would_release_now;

  const onSave = async () => {
    const p: SeedRule | null = ruleFromDraft(pub);
    const q: SeedRule | null = ruleFromDraft(priv);
    if (!p || !q) return;
    try {
      await update.mutateAsync({
        seed_sweep_enabled: enabled,
        // min_seed_ratio 0 is the existing "no public ratio target".
        min_seed_ratio: p.ratio ?? 0,
        public_seed_time_mins: p.seed_time_mins,
        private_seed_ratio: q.ratio,
        private_seed_time_mins: q.seed_time_mins,
      });
      toast.success(t("settings.seeding.saved"));
    } catch {
      toast.error(t("settings.seeding.saveError"));
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-neutral-700 bg-neutral-900/50 p-5">
      <div>
        <h2 className="text-xl">{t("settings.seeding.title")}</h2>
        <p className="mt-1 max-w-[68ch] text-sm text-neutral-400">
          {t("settings.seeding.description")}
        </p>
      </div>
      <label className="flex items-start gap-3">
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label={t("settings.seeding.enable")}
        />
        <span>
          <span className="block text-sm font-medium text-neutral-100">
            {t("settings.seeding.enable")}
          </span>
          <span className="block text-xs text-neutral-500">
            {t("settings.seeding.enableHint")}
          </span>
        </span>
      </label>
      {!enabled && wouldRelease && wouldRelease.count > 0 && (
        <p className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200">
          {t("settings.seeding.preview", {
            count: wouldRelease.count,
            size: formatBytes(wouldRelease.bytes),
          })}
        </p>
      )}
      {settings.file_operation === "move" && (
        <p className="text-sm text-amber-200">
          {t("settings.seeding.moveMode")}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <RuleCard
          title={t("settings.seeding.publicTitle")}
          draft={pub}
          onChange={setPub}
        />
        <RuleCard
          title={t("settings.seeding.privateTitle")}
          isPrivate
          draft={priv}
          onChange={setPriv}
        />
      </div>
      <p className="text-xs text-neutral-500">
        {t("settings.seeding.unknownPrivate")}
      </p>
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={onSave}
          disabled={
            update.isPending || !ruleFromDraft(pub) || !ruleFromDraft(priv)
          }
        >
          {t("settings.seeding.save")}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-700 bg-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-neutral-500">
            <tr className="border-b border-neutral-700">
              <th className="px-3 py-2.5 font-medium">
                {t("settings.seeding.indexers.indexer")}
              </th>
              <th className="px-3 py-2.5 font-medium">
                {t("settings.seeding.indexers.rule")}
              </th>
              <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">
                {t("settings.seeding.indexers.held")}
              </th>
              <th className="w-28" />
            </tr>
          </thead>
          <tbody>
            {(rules.data?.indexers ?? []).map((row) => (
              <IndexerRuleRow key={row.indexer} row={row} />
            ))}
          </tbody>
        </table>
        {rules.data && rules.data.indexers.length === 0 && (
          <p className="px-3 py-4 text-sm text-neutral-500">
            {t("settings.seeding.indexers.empty")}
          </p>
        )}
      </div>
    </section>
  );
}
