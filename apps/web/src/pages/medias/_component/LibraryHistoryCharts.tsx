import { useTranslation } from "react-i18next";
import type { TooltipContentProps } from "recharts";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LabelList,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils";
import { Card } from "./LibrarySharedUI";

const panelClassName =
  "rounded-lg border border-neutral-700/60 bg-neutral-900/50";

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleString("default", { month: "short" })} ${d.getDate()}`;
}

// ─── Shared chart tooltip ─────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
}: TooltipContentProps<
  number | string | ReadonlyArray<number | string>,
  number | string
>) {
  if (!active || !payload?.length) return null;
  const label = payload[0]?.payload?.label as string | undefined;
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 shadow-sm text-[11px]">
      {label && <p className="text-neutral-400 mb-0.5">{label}</p>}
      {payload.map((p, i) => (
        <p
          key={i}
          className="font-semibold tabular-nums"
          style={{ color: String(p.color ?? p.fill) }}
        >
          {p.name ? `${p.name}: ` : ""}
          {p.value}
        </p>
      ))}
    </div>
  );
}

export function IndexersBarChart({
  indexers,
}: {
  indexers: { name: string; count: number }[];
}) {
  const h = Math.min(indexers.length * 28, 210);
  return (
    <div style={{ height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={indexers}
          margin={{ top: 0, right: 36, left: 0, bottom: 0 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={96}
            tick={{ fontSize: 11, fill: "#737373" }}
            tickLine={false}
            axisLine={false}
          />
          <Bar dataKey="count" fill="#0ea5e9" radius={[0, 3, 3, 0]} barSize={6}>
            <LabelList
              dataKey="count"
              position="right"
              style={{
                fontSize: 11,
                fill: "#737373",
                fontVariantNumeric: "tabular-nums",
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GrabsAreaChart({
  data,
}: {
  data: { date: string; count: number }[];
}) {
  const chartData = data.map((d) => ({ ...d, label: formatDateShort(d.date) }));
  return (
    <div className="h-14 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="grabGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" hide />
          <Tooltip
            content={ChartTooltip}
            cursor={{
              stroke: "#38bdf8",
              strokeWidth: 1,
              strokeDasharray: "3 3",
            }}
          />
          <Area
            type="monotone"
            dataKey="count"
            name="Grabs"
            stroke="#38bdf8"
            fill="url(#grabGradient)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: "#38bdf8", strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GrabStatusDonut({
  completed,
  failed,
  active,
}: {
  completed: number;
  failed: number;
  active: number;
}) {
  const { t } = useTranslation("common");
  const segments = [
    {
      name: t("medias.history.grabStatusCompleted"),
      value: completed,
      color: "#10b981",
    },
    {
      name: t("medias.history.grabStatusFailed"),
      value: failed,
      color: "#f43f5e",
    },
    {
      name: t("medias.history.grabStatusActive"),
      value: active,
      color: "#38bdf8",
    },
  ].filter((s) => s.value > 0);

  if (segments.length === 0) return null;

  return (
    <Card className={cn(panelClassName, "px-4 py-3")}>
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400 mb-3">
        {t("medias.history.grabStatus")}
      </p>
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={segments}
                dataKey="value"
                innerRadius="55%"
                outerRadius="85%"
                strokeWidth={0}
                paddingAngle={2}
                startAngle={90}
                endAngle={-270}
                isAnimationActive={false}
              >
                {segments.map((s, i) => (
                  <Cell key={i} fill={s.color} />
                ))}
              </Pie>
              <Tooltip content={ChartTooltip} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-1.5 min-w-0">
          {segments.map((s) => (
            <div key={s.name} className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-xs text-neutral-300 truncate">
                {s.name}
              </span>
              <span className="ml-auto font-mono text-xs font-semibold tabular-nums text-neutral-100 pl-2">
                {s.value.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
