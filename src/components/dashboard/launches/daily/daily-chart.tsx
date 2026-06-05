"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  CHANNEL_COLORS,
  CHANNEL_LABELS,
  DAILY_CHANNELS,
} from "@/lib/launch-daily/types";
import type { LaunchDailyRow } from "@/lib/launch-daily/types";

/**
 * Stacked bar of leads per day per channel, ported visually from the
 * prototype's chart (Recharts BarChart with one stack per row, one segment
 * per channel). Sorted ascending by date.
 */
export function DailyChart({ rows }: { readonly rows: readonly LaunchDailyRow[] }) {
  if (rows.length === 0) return null;

  const data = [...rows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({
      date: r.date,
      meta_ads: r.meta_ads,
      google_ads: r.google_ads,
      tiktok_ads: r.tiktok_ads,
      organico: r.organico,
      whatsapp: r.whatsapp,
      referidos: r.referidos,
      otro: r.otro,
    }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="date"
            stroke="var(--color-fg-muted)"
            tick={{ fontSize: 11 }}
            tickMargin={6}
          />
          <YAxis
            stroke="var(--color-fg-muted)"
            tick={{ fontSize: 11 }}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              fontSize: "12px",
            }}
            labelStyle={{ color: "var(--color-fg)" }}
            itemStyle={{ color: "var(--color-fg)" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {DAILY_CHANNELS.map((ch) => (
            <Bar
              key={ch}
              dataKey={ch}
              stackId="leads"
              fill={CHANNEL_COLORS[ch]}
              name={CHANNEL_LABELS[ch]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
