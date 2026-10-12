import { Link, useParams } from "react-router-dom";
import { ApiError, getSnapshot, resultHref } from "../api/client";
import type { Job } from "../api/types";
import { ProgressBar, Facts, StatusLamp } from "../components/bits";
import { Board } from "../components/board/Board";
import { ResultMeans } from "../components/ResultMeans";
import { WorkByWorker } from "../components/WorkByWorker";
import {
  formatAgo,
  formatCount,
  formatDuration,
  formatPercent,
  formatTimestamp,
  jobTitle,
  secondsBetween,
} from "../lib/format";
import { useNow, usePolling } from "../lib/usePolling";
import "../styles/job.css";

export function JobPage() {
  const { id = "" } = useParams();
  const now = useNow(250);
  const { data, error } = usePolling(() => getSnapshot(id), 500, id);

  if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
    return (
      <>
        <BackLink />
        <p>There's no job with this id. It may belong to a database that was reset.</p>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <BackLink />
        {error ? <p className="alert">Can't reach the API: {error.message}</p> : <p className="muted">Loading the job</p>}
      </>
    );
  }

  const { job } = data;
  const href = resultHref(job);
  // Progress counts merges, so it only means something once the files are written.
  const active = job.status === "running";
  const finished = job.status === "done" || job.status === "failed";

  return (
    <>
      <BackLink />
      <header className="job-head">
        <div className="job-head__main">
          <h1>{jobTitle(job.fileCount, job.valuesPerFile)}</h1>
          <div className="job-head__meta">
            <StatusLamp status={job.status} />
            {active && <span>{formatPercent(job.progress)}</span>}
            {job.completedAt && (
              <span className="muted">
                {job.status === "failed" ? "failed after" : "took"}{" "}
                {formatDuration(secondsBetween(job.createdAt, job.completedAt))}
              </span>
            )}
          </div>
        </div>
        {href && (
          <a className="button button--primary" href={href} download>
            Download means
          </a>
        )}
      </header>

      {job.status === "failed" && job.error && <p className="alert">{job.error}</p>}
      {error && <p className="alert">Lost contact with the API; showing the last update. {error.message}</p>}

      {active && (
        <div className="job-progress">
          <ProgressBar value={job.progress} status={job.status} />
        </div>
      )}

      {job.status !== "failed" && (
        <Board snapshot={data} now={now} result={job.status === "done" && <ResultMeans jobId={job.id} />} />
      )}

      {finished && <WorkByWorker jobId={job.id} />}

      <div className="job-details">
        <h2>Details</h2>
        <Facts rows={detailRows(job, now)} />
      </div>
    </>
  );
}

function BackLink() {
  return (
    <Link to="/" className="back-link">
      All jobs
    </Link>
  );
}

function detailRows(job: Job, now: number): [string, React.ReactNode | null][] {
  const generationEnd = job.runningAt ?? (job.status === "generating" ? now : null);
  const mergeEnd = job.completedAt ?? (job.status === "running" ? now : null);
  const totalEnd = job.completedAt ?? now;
  return [
    ["Files", formatCount(job.fileCount)],
    ["Values per file", formatCount(job.valuesPerFile)],
    ["Values across all files", formatCount(job.fileCount * job.valuesPerFile)],
    [
      "Created",
      <span key="created" title={new Date(job.createdAt).toLocaleString()}>
        {formatTimestamp(job.createdAt, now)}
        <span className="muted">{formatAgo(job.createdAt, now)}</span>
      </span>,
    ],
    [
      "Generating input files",
      generationEnd !== null ? formatDuration(secondsBetween(job.createdAt, generationEnd)) : null,
    ],
    ["Merging", job.runningAt && mergeEnd !== null ? formatDuration(secondsBetween(job.runningAt, mergeEnd)) : null],
    [job.completedAt ? "Total" : "Total so far", formatDuration(secondsBetween(job.createdAt, totalEnd))],
    ["Job id", <code key="id">{job.id}</code>],
  ];
}
