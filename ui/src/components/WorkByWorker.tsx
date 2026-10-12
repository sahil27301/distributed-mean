import { getJobTasks } from "../api/client";
import { formatCompact, formatCount, formatDuration } from "../lib/format";
import { useFetchOnce } from "../lib/usePolling";

/** Who did the merges for a finished job. Lost and failed columns appear only when some attempt was. */
export function WorkByWorker({ jobId }: { jobId: string }) {
  const { data, error } = useFetchOnce(() => getJobTasks(jobId), jobId);
  if (error) return <p className="muted">Couldn't load the task history: {error.message}</p>;
  if (!data || data.length === 0) return null;

  const showLost = data.some((w) => w.lost > 0);
  const showFailed = data.some((w) => w.failed > 0);
  const merges = data.reduce((n, w) => n + w.committed, 0);

  return (
    <section className="work">
      <h2>Work by worker</h2>
      <p className="muted work__caption">
        {formatCount(merges)} merges across {data.length} {data.length === 1 ? "worker" : "workers"}.
      </p>
      <table className="work__table">
        <thead>
          <tr>
            <th scope="col">Worker</th>
            <th scope="col">Merges</th>
            <th scope="col">Values read</th>
            <th scope="col">Busy</th>
            {showLost && <th scope="col">Lost leases</th>}
            {showFailed && <th scope="col">Failed</th>}
          </tr>
        </thead>
        <tbody>
          {data.map((w) => (
            <tr key={w.workerId}>
              <th scope="row">{w.label}</th>
              <td>{formatCount(w.committed)}</td>
              <td>{formatCompact(w.valuesRead)}</td>
              <td>{formatDuration(w.busySeconds)}</td>
              {showLost && <td>{w.lost || null}</td>}
              {showFailed && <td className={w.failed ? "work__bad" : undefined}>{w.failed || null}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
