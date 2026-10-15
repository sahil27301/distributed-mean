import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listJobs } from "../api/client";
import type { Job, StatusFilter } from "../api/types";
import { ProgressBar, Segmented, StatusLamp } from "../components/bits";
import { NewJobsDialog } from "../components/NewJobsDialog";
import { formatAgo, formatDuration, formatPercent, jobTitle, secondsBetween, shortId } from "../lib/format";
import { useNow, usePolling } from "../lib/usePolling";
import "../styles/jobs.css";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "done", label: "Done" },
  { value: "failed", label: "Failed" },
];

export function JobsPage() {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const cursor = cursors.at(-1) ?? null;
  const now = useNow();

  const { data, error, refresh } = usePolling(
    () => listJobs({ cursor, status: filter }),
    2000,
    `${filter}:${cursor ?? ""}`,
  );

  const noJobsAtAll = filter === "all" && cursor === null && data?.jobs.length === 0;

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [cursor]);

  const changeFilter = (next: StatusFilter) => {
    setFilter(next);
    setCursors([null]);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Jobs</h1>
          <p className="muted">Each job averages every value position across its files.</p>
        </div>
        <button className="button button--primary" type="button" onClick={() => setDialogOpen(true)}>
          New jobs
        </button>
      </div>

      {!noJobsAtAll && (
        <div className="jobs-toolbar">
          <Segmented label="Show" options={FILTERS} value={filter} onChange={changeFilter} />
        </div>
      )}

      {error && <p className="alert">Can't reach the API: {error.message}</p>}

      {data && data.jobs.length === 0 && (
        <div className="empty">
          <p>
            {noJobsAtAll
              ? "No jobs yet. Use New jobs to create one and watch the workers merge it."
              : "No jobs match this filter."}
          </p>
        </div>
      )}

      {data && data.jobs.length > 0 && (
        <ul className="job-list">
          {data.jobs.map((job) => (
            <li key={job.id}>
              <JobRow job={job} now={now} />
            </li>
          ))}
        </ul>
      )}

      {(cursors.length > 1 || data?.nextCursor) && (
        <div className="pager">
          <button
            className="button button--plain"
            type="button"
            disabled={cursors.length === 1}
            onClick={() => setCursors((c) => c.slice(0, -1))}
          >
            Newer
          </button>
          <button
            className="button button--plain"
            type="button"
            disabled={!data?.nextCursor}
            onClick={() => data?.nextCursor && setCursors((c) => [...c, data.nextCursor])}
          >
            Older
          </button>
        </div>
      )}

      <NewJobsDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => {
          changeFilter("all");
          refresh();
        }}
      />
    </>
  );
}

function JobRow({ job, now }: { job: Job; now: number }) {
  const active = job.status === "running";
  return (
    <Link to={`/jobs/${job.id}`} className="job-row">
      <span className="job-row__title">{jobTitle(job.fileCount, job.valuesPerFile)}</span>
      <span className="job-row__figure">
        {active && formatPercent(job.progress)}
        {job.status === "done" && job.completedAt && formatDuration(secondsBetween(job.createdAt, job.completedAt))}
      </span>
      <span className="job-row__meta">
        <StatusLamp status={job.status} />
        <span className="muted">{formatAgo(job.createdAt, now)}</span>
        <span className="muted job-row__id">{shortId(job.id)}</span>
      </span>
      {active && (
        <span className="job-row__bar">
          <ProgressBar value={job.progress} status={job.status} />
        </span>
      )}
    </Link>
  );
}
