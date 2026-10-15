import type { JobStatus } from "../api/types";

const integer = new Intl.NumberFormat("en-US");

export function formatCount(n: number): string {
  return integer.format(n);
}

/** 1,234,567 → "1.2M"; for rates and totals where precision doesn't help. */
export function formatCompact(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s ? `${m} min ${s} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function secondsBetween(from: string, to: string | number): number {
  const end = typeof to === "number" ? to : Date.parse(to);
  return Math.max(0, (end - Date.parse(from)) / 1000);
}

export function formatAgo(iso: string, now: number): string {
  const s = secondsBetween(iso, now);
  if (s < 5) return "just now";
  if (s < 60) return `${Math.round(s)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Today at 2:46 AM", "Yesterday at 9:05 PM", "Oct 3 at 11:20 AM" (year added when it differs). */
export function formatTimestamp(iso: string, now: number): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const daysAgo = Math.round((startOfDay(new Date(now)) - startOfDay(date)) / 86_400_000);
  if (daysAgo === 0) return `Today at ${time}`;
  if (daysAgo === 1) return `Yesterday at ${time}`;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(!sameYear && { year: "numeric" }) });
  return `${day} at ${time}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatMean(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function formatPercent(progress: number): string {
  return `${Math.floor(progress * 100)}%`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  generating: "Writing files",
  running: "Merging",
  done: "Done",
  failed: "Failed",
};

export function jobTitle(fileCount: number, valuesPerFile: number): string {
  return `${formatCount(fileCount)} files × ${formatCount(valuesPerFile)} values`;
}
