CREATE TABLE jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_count       int NOT NULL CHECK (file_count >= 2),
  values_per_file  int NOT NULL CHECK (values_per_file >= 2),
  status           text NOT NULL CHECK (status IN ('generating', 'running', 'done', 'failed')),
  result_path      text,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_claimed_at  timestamptz NOT NULL DEFAULT now(),
  running_at       timestamptz,
  completed_at     timestamptz
);

CREATE TABLE items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid NOT NULL REFERENCES jobs (id),
  path             text NOT NULL,
  files_covered    int NOT NULL CHECK (files_covered >= 1),
  claimed_by       text,
  lease_expires_at timestamptz,
  attempts         int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- One row per finished task attempt, for stats. Committed rows are written in the commit transaction.
-- Attempts cut short by a crash leave no row (their items show it through `attempts`).
CREATE TABLE tasks (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id        uuid NOT NULL REFERENCES jobs (id),
  worker_id     text NOT NULL,
  inputs        int NOT NULL,
  files_covered int NOT NULL,
  values_read   bigint NOT NULL,
  final         boolean NOT NULL,
  outcome       text NOT NULL CHECK (outcome IN ('committed', 'lost', 'failed')),
  error         text,
  claimed_at    timestamptz NOT NULL,
  finished_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tasks_job_idx ON tasks (job_id);

-- Round-robin job selection: matches `WHERE status = 'running' ORDER BY last_claimed_at, created_at`.
CREATE INDEX jobs_rr_idx ON jobs (last_claimed_at, created_at) WHERE status = 'running';

-- Per-job item lookup, largest partials first.
CREATE INDEX items_job_idx ON items (job_id, files_covered DESC);
