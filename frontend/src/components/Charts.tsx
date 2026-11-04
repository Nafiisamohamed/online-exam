'use client';
/**
 * Chart components (recharts). All numbers come from API queries - nothing hard-coded.
 * Style: one brand-green hue for single series, thin bars with 4px rounded tops,
 * recessive grid/axes, hover tooltip on every bar, legend only for 2+ series.
 */
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Empty } from './ui';

const INK = '#4b5563';
const GRID = '#eef0f2';
const BRAND = '#146f41';
const MUTED = '#9ca3af';
const AMBER = '#d97706';

const axis = { stroke: GRID, tick: { fill: INK, fontSize: 12 }, tickLine: false } as const;
const tooltipStyle = { borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,.08)' };

export interface BarDatum {
  label: string;
  value: number;
}

/** Single-series bar chart. */
export function SimpleBarChart({ data, valueLabel, height = 240, maxY, unit = '' }: { data: BarDatum[]; valueLabel: string; height?: number; maxY?: number; unit?: string }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ height }} role="img" aria-label={valueLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" {...axis} interval={0} />
          <YAxis {...axis} axisLine={false} allowDecimals={false} domain={[0, maxY ?? 'auto']} unit={unit} />
          <Tooltip cursor={{ fill: 'rgba(20,111,65,0.06)' }} contentStyle={tooltipStyle} formatter={(v: number) => [`${v}${unit}`, valueLabel]} />
          <Bar dataKey="value" name={valueLabel} fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={44} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Two series side by side (e.g. attempts vs flagged), with a legend. */
export function PairBarChart({ data, aLabel, bLabel, height = 240 }: { data: { label: string; a: number; b: number }[]; aLabel: string; bLabel: string; height?: number }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ height }} role="img" aria-label={`${aLabel} / ${bLabel}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barGap={2} barCategoryGap="24%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" {...axis} interval={0} />
          <YAxis {...axis} axisLine={false} allowDecimals={false} />
          <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} contentStyle={tooltipStyle} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: INK }} />
          <Bar dataKey="a" name={aLabel} fill={MUTED} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="b" name={bLabel} fill={AMBER} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
