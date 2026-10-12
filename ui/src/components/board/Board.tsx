import { LayoutGroup, motion } from "motion/react";
import type { JobSnapshot } from "../../api/types";
import { formatCount } from "../../lib/format";
import { placeItems } from "../../lib/placement";
import { sizeColor, sizeInk } from "../../lib/sizeColor";
import "../../styles/board.css";
import { Chip } from "./Chip";
import { Station } from "./Station";
import { useBoardTransitions } from "./useBoardTransitions";

/** Stations per row; beyond this they wrap and the extra rows aren't wired to the bus. */
const MAX_COLUMNS = 5;

export function Board({ snapshot, now, result }: { snapshot: JobSnapshot; now: number; result?: React.ReactNode }) {
  const { job, items, workers } = snapshot;
  const { arriving, spent } = useBoardTransitions(items);
  const placement = placeItems(items ?? [], workers, arriving);

  const stationIds = [...workers.map((w) => w.id), ...placement.silent];
  const byId = new Map(workers.map((w) => [w.id, w]));
  const cols = Math.max(1, Math.min(stationIds.length, MAX_COLUMNS));

  return (
    <section className="board" aria-label="Queue and workers">
      <div className="board__queue-head">
        <h2>{job.status === "done" ? "Result" : "Queue"}</h2>
        <QueueSummary snapshot={snapshot} waiting={placement.queue.length} held={items ? items.length - placement.queue.length : 0} />
      </div>

      <LayoutGroup id={job.id}>
        <div className="board__queue">
          {job.status === "done" ? (
            <ResultChip fileCount={job.fileCount} />
          ) : items === null ? (
            <p className="board__note">
              {formatCount(job.fileCount)} files is too many to draw; the live view covers jobs of up to 100 files. Progress
              and the workers below still update.
            </p>
          ) : job.status === "generating" ? (
            <p className="board__note">Writing {formatCount(job.fileCount)} files. They join the queue together once all are written.</p>
          ) : (
            placement.queue.map((i) => <Chip key={i.id} id={i.id} filesCovered={i.filesCovered} fileCount={job.fileCount} />)
          )}
        </div>

        {job.status !== "done" && (
          <>
            <div className="board__bus" aria-hidden="true" />
            <div className="board__stations" style={{ "--cols": cols } as React.CSSProperties}>
              {stationIds.length === 0 && <p className="board__note">No workers are running. Start some with docker compose up.</p>}
              {stationIds.map((id, index) => (
                <Station
                  key={id}
                  workerId={id}
                  worker={byId.get(id)}
                  jobId={job.id}
                  fileCount={job.fileCount}
                  held={placement.held.get(id) ?? []}
                  spent={spent.filter((s) => s.workerId === id)}
                  now={now}
                  lower={index >= cols}
                  showTray={items !== null}
                />
              ))}
            </div>
          </>
        )}
      </LayoutGroup>

      {job.status === "done" && result}
      {items !== null && job.status === "running" && <SizeLegend fileCount={job.fileCount} />}
    </section>
  );
}

function QueueSummary({ snapshot, waiting, held }: { snapshot: JobSnapshot; waiting: number; held: number }) {
  if (snapshot.items === null || snapshot.job.status !== "running") return null;
  return (
    <p className="muted board__summary">
      {waiting} waiting, {held} being merged. Next to be taken is on the left.
    </p>
  );
}

function ResultChip({ fileCount }: { fileCount: number }) {
  return (
    <motion.div
      className="chip chip--result"
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      style={{ background: sizeColor(fileCount, fileCount), color: sizeInk(fileCount, fileCount) }}
    >
      All {formatCount(fileCount)} files merged
    </motion.div>
  );
}

function SizeLegend({ fileCount }: { fileCount: number }) {
  return (
    <div className="legend">
      <span>1 file</span>
      <span className="legend__ramp" aria-hidden="true" />
      <span>{formatCount(fileCount)} files</span>
    </div>
  );
}
