import { Link } from "react-router-dom";
import type { SnapshotItem, Worker } from "../../api/types";
import { formatDuration, secondsBetween } from "../../lib/format";
import { Chip, SpentChip } from "./Chip";
import type { Spent } from "./useBoardTransitions";

interface Props {
  workerId: string;
  worker: Worker | undefined;
  jobId: string;
  fileCount: number;
  held: SnapshotItem[];
  spent: Spent[];
  now: number;
  lower: boolean;
  /** False when the job is too big to draw per item; the station then shows only its state line. */
  showTray: boolean;
}

export function Station({ workerId, worker, jobId, fileCount, held, spent, now, lower, showTray }: Props) {
  const silent = worker === undefined;
  const task = worker?.task ?? null;
  const onThisJob = task?.jobId === jobId;
  const busy = held.length > 0 || (!showTray && onThisJob);
  const classes = ["station", silent && "station--silent", busy && "station--busy", lower && "station--lower"];

  return (
    <div className={classes.filter(Boolean).join(" ")}>
      {showTray && (
        <div className="station__tray">
          {held.map((i) => (
            <Chip key={i.id} id={i.id} filesCovered={i.filesCovered} fileCount={fileCount} />
          ))}
          {spent.map((s) => (
            <SpentChip key={`spent-${s.item.id}`} filesCovered={s.item.filesCovered} fileCount={fileCount} />
          ))}
        </div>
      )}
      <div className="station__name">{worker?.label ?? workerId.split("-")[0]}</div>
      <div className="station__state">
        {silent ? (
          <span className="station__alarm">Not responding; its files return to the queue when the lease runs out</span>
        ) : onThisJob && task ? (
          <>
            Merging {task.inputs} into one, {formatDuration(secondsBetween(task.claimedAt, now))}
          </>
        ) : task ? (
          <Link to={`/jobs/${task.jobId}`} className="muted">
            On another job
          </Link>
        ) : (
          <span className="muted">Idle</span>
        )}
      </div>
    </div>
  );
}
