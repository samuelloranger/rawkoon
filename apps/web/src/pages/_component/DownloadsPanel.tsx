import { useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import type { TooltipContentProps } from "recharts";
import { AreaChart, Area, Tooltip, ResponsiveContainer } from "recharts";

import { useDownloadsSpeed } from "@/pages/_component/useDownloadsSpeed";
import { formatSpeed } from "@/lib/utils/format";
import {
  Kicker,
  WidgetHeader,
  WidgetShell,
} from "@/pages/_component/widgetPrimitives";

const SPEED_RING_SIZE = 60;

type SpeedSample = { dl: number; ul: number };

function SpeedTooltip({
  active,
  payload,
}: TooltipContentProps<
  number | string | ReadonlyArray<number | string>,
  number | string
>) {
  if (!active || !payload?.length) return null;
  const dl = payload.find((p) => p.dataKey === "dl");
  const ul = payload.find((p) => p.dataKey === "ul");
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 shadow-sm text-[11px] space-y-0.5">
      {dl && (
        <p className="font-semibold tabular-nums text-sky-500">
          ↓ {formatSpeed(Number(dl.value))}
        </p>
      )}
      {ul && (
        <p className="font-semibold tabular-nums text-emerald-500">
          ↑ {formatSpeed(Number(ul.value))}
        </p>
      )}
    </div>
  );
}

export function DownloadsPanel() {
  const { t } = useTranslation("common");
  const { data, isLoading } = useDownloadsSpeed();

  const ringRef = useRef<SpeedSample[]>([]);
  const [speedHistory, setSpeedHistory] = useState<SpeedSample[]>([]);

  useEffect(() => {
    if (!data?.connected) return;
    const next = [
      ...ringRef.current.slice(-(SPEED_RING_SIZE - 1)),
      { dl: data.dl_speed, ul: data.ul_speed },
    ];
    ringRef.current = next;
    setSpeedHistory(next);
  }, [data]);

  return (
    <WidgetShell>
      <WidgetHeader
        icon={Download}
        title={t("dashboard.home.downloadsTitle")}
      />

      <div className="px-4 py-3 space-y-4">
        {isLoading && (
          <div className="space-y-3">
            <div className="h-2 w-16 rounded-full bg-neutral-800 animate-pulse" />
            <div className="flex gap-6">
              <div className="h-5 w-20 rounded bg-neutral-800 animate-pulse" />
              <div
                className="h-5 w-20 rounded bg-neutral-800 animate-pulse"
                style={{ animationDelay: "80ms" }}
              />
            </div>
            <div className="h-10 w-full rounded-lg bg-neutral-800 animate-pulse" />
          </div>
        )}

        {!data?.enabled && !isLoading && (
          <p className="py-2 text-sm text-neutral-400 text-center">
            {t("dashboard.home.qbittorrentNotConfigured")}
          </p>
        )}

        {data?.enabled && (
          <div>
            <Kicker>{t("dashboard.home.transfer")}</Kicker>
            <div className="mt-2 flex items-center gap-6">
              <div className="flex items-center gap-1.5 font-mono text-sm font-semibold tabular-nums text-sky-400">
                <ArrowDown size={13} />
                {formatSpeed(data.dl_speed)}
              </div>
              <div className="flex items-center gap-1.5 font-mono text-sm font-semibold tabular-nums text-emerald-400">
                <ArrowUp size={13} />
                {formatSpeed(data.ul_speed)}
              </div>
            </div>
            {speedHistory.length > 2 && (
              <div className="mt-2 h-10 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={speedHistory}
                    margin={{ top: 2, right: 0, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="dlGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#38bdf8"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor="#38bdf8"
                          stopOpacity={0}
                        />
                      </linearGradient>
                      <linearGradient
                        id="ulGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#10b981"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor="#10b981"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <Tooltip
                      content={SpeedTooltip}
                      cursor={{
                        stroke: "#71717a",
                        strokeWidth: 1,
                        strokeDasharray: "3 3",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="dl"
                      stroke="#38bdf8"
                      fill="url(#dlGradient)"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="ul"
                      stroke="#10b981"
                      fill="url(#ulGradient)"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
