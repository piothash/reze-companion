/** ARC — display formatters for operator surfaces. */
export function fmt(value: number | null | undefined, digits = 4): string {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}

export function fmtInt(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(value);
}

export function fmtPct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(2)}%`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().replace("T", " ").slice(0, 19);
}
