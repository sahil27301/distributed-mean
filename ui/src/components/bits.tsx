import type { JobStatus } from "../api/types";
import { STATUS_LABEL } from "../lib/format";

export function StatusLamp({ status }: { status: JobStatus }) {
  return <span className={`lamp lamp--${status}`}>{STATUS_LABEL[status]}</span>;
}

export function ProgressBar({ value, status }: { value: number; status: JobStatus }) {
  return (
    <div
      className={`progress progress--${status}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.floor(value * 100)}
    >
      <div className="progress__fill" style={{ width: `${value * 100}%` }} />
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="segmented__option"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Label/value rows; rows whose value is null or undefined are not rendered. */
export function Facts({ rows }: { rows: [string, React.ReactNode | null | undefined][] }) {
  const visible = rows.filter(([, v]) => v !== null && v !== undefined && v !== false);
  return (
    <dl className="facts">
      {visible.map(([label, value]) => (
        <div className="facts__row" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
