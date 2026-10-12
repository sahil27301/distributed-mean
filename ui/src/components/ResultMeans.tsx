import { getResultPreview } from "../api/client";
import { formatCount, formatMean } from "../lib/format";
import { useFetchOnce } from "../lib/usePolling";

/** The first means of a finished job, read from the start of the result file. */
export function ResultMeans({ jobId }: { jobId: string }) {
  const { data, error } = useFetchOnce(() => getResultPreview(jobId), jobId);
  if (error) return <p className="muted">Couldn't read the result: {error.message}</p>;
  if (!data) return null;

  const shown = data.means.length;
  return (
    <div className="means">
      <p className="means__caption muted">
        {shown === data.total
          ? `All ${formatCount(data.total)} means, by position.`
          : `The first ${shown} of ${formatCount(data.total)} means, by position. Download means for all of them.`}
      </p>
      <ol className="means__grid" start={0}>
        {data.means.map((mean, index) => (
          <li key={index} className="means__cell">
            <span className="means__index">{index}</span>
            <span>{formatMean(mean)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
