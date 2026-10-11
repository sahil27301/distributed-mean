import type { ErrorRequestHandler } from "express";

/** Client errors raised by middleware (e.g. malformed JSON) keep their status; everything else is a 500. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status: unknown = err?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({ error: err.message });
    return;
  }
  req.log.error({ err }, "unhandled error");
  res.status(500).json({ error: "internal error" });
};
