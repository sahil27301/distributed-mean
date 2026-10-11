import { z } from "zod";
import { MAX_FILE_COUNT, MAX_VALUES_PER_FILE, MIN_FILE_COUNT, MIN_VALUES_PER_FILE } from "./limits.js";

export const CreateJobSchema = z.object({
  fileCount: z.number().int().min(MIN_FILE_COUNT).max(MAX_FILE_COUNT),
  valuesPerFile: z.number().int().min(MIN_VALUES_PER_FILE).max(MAX_VALUES_PER_FILE),
});

export type CreateJobInput = z.infer<typeof CreateJobSchema>;

export const JobIdSchema = z.uuid();
