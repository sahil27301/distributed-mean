import { motion } from "motion/react";
import { sizeColor, sizeInk } from "../../lib/sizeColor";

const MOVE = { type: "spring", stiffness: 260, damping: 30 } as const;

export function Chip({ id, filesCovered, fileCount }: { id: string; filesCovered: number; fileCount: number }) {
  return (
    <motion.div
      layoutId={id}
      layout="position"
      transition={MOVE}
      className="chip"
      style={{ background: sizeColor(filesCovered, fileCount), color: sizeInk(filesCovered, fileCount) }}
      title={filesCovered === 1 ? "1 file" : `${filesCovered} files merged`}
    >
      {filesCovered > 1 ? filesCovered : null}
    </motion.div>
  );
}

/** An input that was just merged away: shrinks out inside the station that consumed it. */
export function SpentChip({ filesCovered, fileCount }: { filesCovered: number; fileCount: number }) {
  return (
    <motion.div
      className="chip"
      initial={{ opacity: 1, scale: 1 }}
      animate={{ opacity: 0, scale: 0.4 }}
      transition={{ duration: 0.35, ease: "easeIn" }}
      style={{ background: sizeColor(filesCovered, fileCount), color: sizeInk(filesCovered, fileCount) }}
      aria-hidden="true"
    >
      {filesCovered > 1 ? filesCovered : null}
    </motion.div>
  );
}
