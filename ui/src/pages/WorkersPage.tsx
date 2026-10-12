import { Link } from "react-router-dom";
import { listWorkers } from "../api/client";
import type { Worker } from "../api/types";
import { Facts } from "../components/bits";
import { formatCompact, formatCount, formatDuration, formatPercent, secondsBetween, shortId } from "../lib/format";
import { useNow, usePolling } from "../lib/usePolling";
import "../styles/workers.css";

export function WorkersPage() {
  const now = useNow(250);
  const { data, error } = usePolling(listWorkers, 1000, "workers");
  const workers = data ? [...data].sort((a, b) => a.label.localeCompare(b.label)) : null;
  const busy = workers?.filter((w) => w.task).length ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Workers</h1>
          <p className="muted">
            Each worker merges two to five files at a time. A worker's name is its container id, so{" "}
            <code>docker kill</code> with that name stops it mid-merge.
          </p>
        </div>
        {workers && workers.length > 0 && (
          <p className="workers-count">
            {busy} of {workers.length} merging
          </p>
        )}
      </div>

      {error && <p className="alert">Can't reach the API: {error.message}</p>}

      {workers && workers.length === 0 && (
        <div className="empty">
          <p>No workers have reported in the last 15 seconds. Start some with docker compose up -d --scale worker=4.</p>
        </div>
      )}

      {workers && workers.length > 0 && (
        <ul className="worker-grid">
          {workers.map((w) => (
            <li key={w.id}>
              <WorkerCard worker={w} now={now} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function describeInputs(inputs: number, filesCovered: number): string {
  if (inputs === filesCovered) return `${inputs} raw files`;
  return `${inputs} partials that cover ${formatCount(filesCovered)} files`;
}

function WorkerCard({ worker, now }: { worker: Worker; now: number }) {
  const { task, stats } = worker;
  const uptime = secondsBetween(worker.startedAt, now);
  return (
    <article className={`worker${task ? " worker--busy" : ""}`}>
      <header className="worker__head">
        <h2>{worker.label}</h2>
        <span className={`lamp${task ? " lamp--running" : ""}`}>{task ? "Merging" : "Idle"}</span>
      </header>

      <div className="worker__now">
        {task ? (
          <>
            <p>
              {describeInputs(task.inputs, task.filesCovered)}, {formatDuration(secondsBetween(task.claimedAt, now))} so far
            </p>
            <Link to={`/jobs/${task.jobId}`}>Open job {shortId(task.jobId)}</Link>
          </>
        ) : (
          <p className="muted">Waiting for work</p>
        )}
      </div>

      <Facts
        rows={[
          ["Delay factor", `${worker.speedFactor.toFixed(2)}×`],
          ["Merges done", stats ? formatCount(stats.committed) : null],
          ["Values read", stats && stats.valuesRead > 0 ? formatCompact(stats.valuesRead) : null],
          [
            "Read rate",
            stats?.valuesPerBusySecond ? `${formatCompact(stats.valuesPerBusySecond)} values/s` : null,
          ],
          ["Busy", stats && uptime > 0 ? formatPercent(Math.min(1, stats.busySeconds / uptime)) : null],
          ["Lost leases", stats?.lost ? formatCount(stats.lost) : null],
          ["Failed merges", stats?.failed ? formatCount(stats.failed) : null],
          ["Up for", formatDuration(uptime)],
        ]}
      />
    </article>
  );
}
