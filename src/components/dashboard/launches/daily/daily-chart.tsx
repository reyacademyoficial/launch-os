"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
 * Leads-per-day-per-channel line chart, ported from the prototype's
 * Card "Leads por día y canal".
 *
 * Only renders a line for channels that have at least one non-zero day —
 * otherwise the legend gets crowded with flat-zero series.
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

  const activeChannels = DAILY_CHANNELS.filter((ch) =>
    data.some((d) => d[ch] > 0),
  );

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
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
            width={32}
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
          {activeChannels.map((ch) => (
            <Line
              key={ch}
              type="monotone"
              dataKey={ch}
              stroke={CHANNEL_COLORS[ch]}
              strokeWidth={2}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
              connectNulls
              name={CHANNEL_LABELS[ch]}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
