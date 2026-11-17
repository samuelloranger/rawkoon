import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  ShelfDetail,
  ShelfEntryView,
  ShelfOrderMode,
} from "@rawkoon/shared/types";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShelfCoverEditor } from "./ShelfCoverEditor";
import { MonthDayField } from "./MonthDayField";
import { CHRISTMAS_WINDOW } from "./monthDay";
import { draftOf, type Draft } from "./shelfDraft";

export function ShelfSettingsForm({
  shelfId,
  detail,
  draft,
  patchDraft,
  entries,
  dirty,
  saving,
  onSave,
  invalidate,
}: {
  shelfId: number;
  detail: ShelfDetail;
  draft: Draft;
  patchDraft: (patch: Partial<Draft>) => void;
  entries: ShelfEntryView[];
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  invalidate: () => Promise<void>;
}) {
  const { t } = useTranslation("common");
  const queryClient = useQueryClient();

  return (
    <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="space-y-1.5">
        <label
          htmlFor="shelf-name"
          className="text-xs font-medium text-neutral-400"
        >
          {t("shelves.name")}
        </label>
        <Input
          id="shelf-name"
          value={draft.name}
          maxLength={120}
          onChange={(event) => patchDraft({ name: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <label
          htmlFor="shelf-description"
          className="text-xs font-medium text-neutral-400"
        >
          {t("shelves.description")}
        </label>
        <Textarea
          id="shelf-description"
          value={draft.description}
          rows={3}
          maxLength={2000}
          onChange={(event) => patchDraft({ description: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-neutral-400">
          {t("shelves.orderMode")}
        </p>
        <Select
          value={draft.orderMode}
          onValueChange={(value) =>
            patchDraft({ orderMode: value as ShelfOrderMode })
          }
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">{t("shelves.order.manual")}</SelectItem>
            <SelectItem value="release">
              {t("shelves.order.release")}
            </SelectItem>
            <SelectItem value="rating">{t("shelves.order.rating")}</SelectItem>
            <SelectItem value="added">{t("shelves.order.added")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-200">{t("shelves.homeRow")}</p>
          <p className="text-xs text-neutral-500">{t("shelves.homeRowHint")}</p>
        </div>
        <Switch
          checked={draft.homeRow}
          onCheckedChange={(checked) => patchDraft({ homeRow: checked })}
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm text-neutral-200">{t("shelves.window")}</p>
        <p className="text-xs text-neutral-500">{t("shelves.windowHint")}</p>
        <div className="grid grid-cols-1 gap-3">
          <MonthDayField
            label={t("shelves.from")}
            value={draft.visibleFrom}
            onChange={(value) => patchDraft({ visibleFrom: value })}
          />
          <MonthDayField
            label={t("shelves.to")}
            value={draft.visibleTo}
            onChange={(value) => patchDraft({ visibleTo: value })}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() =>
            patchDraft({
              visibleFrom: CHRISTMAS_WINDOW.from,
              visibleTo: CHRISTMAS_WINDOW.to,
            })
          }
        >
          {t("shelves.christmasPreset")}
        </Button>
      </div>
      <ShelfCoverEditor
        shelfId={shelfId}
        style={draft.coverStyle}
        tmdbId={draft.coverTmdbId}
        type={draft.coverType}
        entries={entries}
        uploadedUrl={detail.cover.style === "upload" ? detail.cover.url : null}
        coverUrl={draft.coverUrl}
        onChange={patchDraft}
        onUploaded={async (shelf) => {
          // The upload response is the freshest copy; the list refetch follows
          queryClient.setQueryData(queryKeys.shelves.detail(shelfId), {
            shelf,
          });
          // The upload saved the cover server-side; drop the draft's backdrop pick with it
          const saved = draftOf(shelf);
          patchDraft({
            coverStyle: saved.coverStyle,
            coverTmdbId: saved.coverTmdbId,
            coverType: saved.coverType,
            coverUrl: saved.coverUrl,
          });
          await invalidate();
        }}
      />
      <Button
        size="sm"
        disabled={!dirty || saving || draft.name.trim().length === 0}
        onClick={() => onSave()}
        className="w-full"
      >
        {saving ? t("shelves.saving") : t("shelves.save")}
      </Button>
    </div>
  );
}
