import { useEffect, useRef, useState } from "react";
import { createJob } from "../api/client";
import { formatCount } from "../lib/format";
import "../styles/dialog.css";

interface Draft {
  key: number;
  fileCount: string;
  valuesPerFile: string;
}

interface Preset {
  name: string;
  description: string;
  jobs: [number, number][];
}

/** Sizes chosen against the default simulated speed (about 1–4 s per million values read). */
const PRESETS: Preset[] = [
  { name: "Watch one", description: "40 files, drawn live as they merge", jobs: [[40, 500_000]] },
  { name: "Tiny", description: "6 files, one merge and the final one", jobs: [[6, 1_000]] },
  {
    name: "Burst",
    description: "Three jobs at once, sharing the workers",
    jobs: [
      [30, 400_000],
      [60, 250_000],
      [12, 800_000],
    ],
  },
  { name: "Too big to draw", description: "2,000 files; progress only", jobs: [[2_000, 5_000]] },
];

const LIMITS = { fileCount: [2, 99_999], valuesPerFile: [2, 999_999] } as const;

let nextKey = 1;
const draft = (fileCount: number, valuesPerFile: number): Draft => ({
  key: nextKey++,
  fileCount: String(fileCount),
  valuesPerFile: String(valuesPerFile),
});

function fieldError(value: string, [min, max]: readonly [number, number]): string | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return `Whole number from ${formatCount(min)} to ${formatCount(max)}`;
  return null;
}

export function NewJobsDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [drafts, setDrafts] = useState<Draft[]>(() => [draft(40, 500_000)]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setError(null);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const invalid = drafts.some(
    (d) => fieldError(d.fileCount, LIMITS.fileCount) || fieldError(d.valuesPerFile, LIMITS.valuesPerFile),
  );

  const update = (key: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    let created = 0;
    try {
      for (const d of drafts) {
        await createJob(Number(d.fileCount), Number(d.valuesPerFile));
        created++;
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(
        `${created ? `Created ${created} of ${drafts.length}. ` : ""}The next one was rejected: ${(err as Error).message}`,
      );
      if (created) {
        setDrafts((ds) => ds.slice(created));
        onCreated();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const label = drafts.length === 1 ? "Create job" : `Create ${drafts.length} jobs`;

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="new-jobs-title">
      <form onSubmit={submit} className="dialog__body">
        <h2 id="new-jobs-title">New jobs</h2>
        <p className="muted dialog__lede">
          Jobs with up to 100 files are drawn live on their page. Pick a preset or set the sizes yourself.
        </p>

        <div className="presets" role="group" aria-label="Presets">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              className="preset"
              onClick={() => setDrafts(p.jobs.map(([f, c]) => draft(f, c)))}
            >
              <span className="preset__name">{p.name}</span>
              <span className="preset__desc">{p.description}</span>
            </button>
          ))}
        </div>

        <div className={`drafts${drafts.length > 1 ? " drafts--many" : ""}`}>
          <div className="drafts__head" aria-hidden="true">
            <span>Files</span>
            <span>Values per file</span>
            {drafts.length > 1 && <span className="draft__remove-slot" />}
          </div>
          {drafts.map((d, i) => {
            const fErr = fieldError(d.fileCount, LIMITS.fileCount);
            const cErr = fieldError(d.valuesPerFile, LIMITS.valuesPerFile);
            return (
              <div className="draft" key={d.key}>
                <label className="field">
                  <span className="visually-hidden">Files, job {i + 1}</span>
                  <input
                    inputMode="numeric"
                    value={d.fileCount}
                    aria-invalid={!!fErr}
                    onChange={(e) => update(d.key, { fileCount: e.target.value.replace(/[^\d]/g, "") })}
                  />
                  {fErr && <span className="field__error">{fErr}</span>}
                </label>
                <label className="field">
                  <span className="visually-hidden">Values per file, job {i + 1}</span>
                  <input
                    inputMode="numeric"
                    value={d.valuesPerFile}
                    aria-invalid={!!cErr}
                    onChange={(e) => update(d.key, { valuesPerFile: e.target.value.replace(/[^\d]/g, "") })}
                  />
                  {cErr && <span className="field__error">{cErr}</span>}
                </label>
                {drafts.length > 1 && (
                  <button
                    type="button"
                    className="button button--plain draft__remove"
                    aria-label={`Remove job ${i + 1}`}
                    onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="button button--plain drafts__add"
            onClick={() => setDrafts((ds) => [...ds, draft(20, 100_000)])}
          >
            Add another job
          </button>
        </div>

        {error && <p className="alert">{error}</p>}

        <div className="dialog__actions">
          <button type="button" className="button button--plain" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={invalid || submitting}>
            {submitting ? "Creating…" : label}
          </button>
        </div>
      </form>
    </dialog>
  );
}
