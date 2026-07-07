import { describe, expect, it } from "bun:test";
import {
  notificationEventBus,
  emitUserNotification,
  type NotificationStreamEvent,
} from "./notificationEvents";

describe("notificationEvents", () => {
  it("emits a notification event to subscribers with a timestamp", () => {
    const received: NotificationStreamEvent[] = [];
    const handler = (e: NotificationStreamEvent) => received.push(e);
    notificationEventBus.on("notification", handler);
    try {
      emitUserNotification({
        userId: "user-1",
        id: 42,
        title: "Hello",
        body: "World",
        type: "test",
        url: "/settings",
        metadata: { service_name: "Sonarr" },
      });
    } finally {
      notificationEventBus.off("notification", handler);
    }

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      userId: "user-1",
      id: 42,
      title: "Hello",
      body: "World",
      type: "test",
      url: "/settings",
      metadata: { service_name: "Sonarr" },
    });
    expect(typeof received[0].ts).toBe("number");
  });

  it("delivers each event to every active subscriber (multiple tabs)", () => {
    const a: NotificationStreamEvent[] = [];
    const b: NotificationStreamEvent[] = [];
    const ha = (e: NotificationStreamEvent) => a.push(e);
    const hb = (e: NotificationStreamEvent) => b.push(e);
    notificationEventBus.on("notification", ha);
    notificationEventBus.on("notification", hb);
    try {
      emitUserNotification({
        userId: "user-2",
        id: 7,
        title: "T",
        body: "B",
        type: "system",
        url: null,
      });
    } finally {
      notificationEventBus.off("notification", ha);
      notificationEventBus.off("notification", hb);
    }
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].id).toBe(7);
    expect(b[0].id).toBe(7);
  });
});
