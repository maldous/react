import { randomUUID } from "node:crypto";

export const packageName = "@platform/notification-runtime";

export class NotificationError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "NotificationError";
    this.cause = cause;
  }
}

export type NotificationChannel = "push" | "in-app" | "email" | "sms";

export interface Notification {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channels: NotificationChannel[];
}

export interface NotificationDeliveryResult {
  deliveryId: string;
  channels: NotificationChannel[];
}

export interface NotificationPort {
  send(notification: Notification): Promise<NotificationDeliveryResult>;
  markRead(notificationIds: string[]): Promise<void>;
}

export interface InMemoryNotificationPort extends NotificationPort {
  getSent(userId: string): Notification[];
}

export function createInMemoryNotificationPort(): InMemoryNotificationPort {
  const sent: Array<Notification & { deliveryId: string }> = [];
  return {
    async send(notification) {
      const deliveryId = randomUUID();
      sent.push({ ...notification, deliveryId });
      return { deliveryId, channels: notification.channels };
    },
    async markRead() {},
    getSent(userId) {
      return sent.filter((n) => n.userId === userId);
    },
  };
}
