import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DatabaseBackup } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useExportData } from "@/pages/settings/useExportData";
import { SettingsPageHeader } from "@/pages/settings/_component/SettingsPageHeader";

export function DataExportTab() {
  const { t } = useTranslation("common");

  const { isPending: isExporting, mutateAsync: triggerExport } =
    useExportData();

  const handleExport = async () => {
    try {
      const exportData = await triggerExport();
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rawkoon-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t("settings.dataExport.exportSuccess"));
    } catch (error) {
      console.error("Export error:", error);
      toast.error(t("settings.dataExport.exportError"));
    }
  };

  return (
    <div
      className="animate-in fade-in slide-in-from-right-4 duration-300"
      key="data-export-tab"
    >
      <div className="space-y-6">
        <SettingsPageHeader
          icon={DatabaseBackup}
          title={t("settings.dataExport.title")}
          description={t("settings.dataExport.description")}
        />

        <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6">
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-medium mb-2 text-neutral-100">
                {t("settings.dataExport.exportTitle")}
              </h3>
              <p className="text-sm text-neutral-400 mb-4">
                {t("settings.dataExport.exportDescription")}
              </p>
              <Button onClick={handleExport} disabled={isExporting}>
                {isExporting
                  ? t("settings.dataExport.exporting")
                  : t("settings.dataExport.exportButton")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
