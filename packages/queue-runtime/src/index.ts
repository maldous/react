import { randomUUID } from "node:crypto";

export const packageName = "@platform/queue-runtime";

export class QueueError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "QueueError";
    this.cause = cause;
  }
}

export interface JobOptions {
  delay?: number;
  priority?: number;
  maxRetries?: number;
}

export interface Job<T> {
  id: string;
  payload: T;
  attempts: number;
  createdAt: Date;
  scheduledAt: Date;
}

export interface QueuePort<T> {
  enqueue(payload: T, options?: JobOptions): Promise<string>;
  size(): Promise<number>;
  drain(handler: (job: Job<T>) => Promise<void>): Promise<void>;
}

export function createInMemoryQueue<T>(): QueuePort<T> {
  const jobs: Job<T>[] = [];
  return {
    async enqueue(payload, options = {}) {
      const id = randomUUID();
      const now = new Date();
      jobs.push({
        id,
        payload,
        attempts: 0,
        createdAt: now,
        scheduledAt: options.delay ? new Date(now.getTime() + options.delay) : now,
      });
      return id;
    },
    async size() {
      return jobs.length;
    },
    async drain(handler) {
      while (jobs.length > 0) {
        const job = jobs.shift()!;
        job.attempts++;
        await handler(job);
      }
    },
  };
}
