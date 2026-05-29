import { randomUUID } from "node:crypto";

export const packageName = "@platform/worker-runtime";

export class WorkerError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "WorkerError";
    this.cause = cause;
  }
}

export type WorkerTaskStatus = "scheduled" | "running" | "completed" | "failed" | "cancelled";

export interface WorkerTask<T = unknown> {
  name: string;
  payload: T;
  scheduledAt?: Date;
  maxRetries?: number;
}

export interface WorkerPort {
  schedule(task: WorkerTask): Promise<string>;
  cancel(taskId: string): Promise<void>;
  status(taskId: string): Promise<WorkerTaskStatus | null>;
}

export function createInMemoryWorkerPort(): WorkerPort {
  const tasks = new Map<string, WorkerTaskStatus>();
  return {
    async schedule() {
      const id = randomUUID();
      tasks.set(id, "scheduled");
      return id;
    },
    async cancel(taskId) {
      if (tasks.has(taskId)) tasks.set(taskId, "cancelled");
    },
    async status(taskId) {
      return tasks.get(taskId) ?? null;
    },
  };
}
