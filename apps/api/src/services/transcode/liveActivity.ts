import { prisma } from "@rawkoon/api/db";
import {
  type ReencodeLiveState,
  sendLiveActivityViaRelay,
} from "@rawkoon/api/utils/apns";
import type { TranscodeLiveProgress, TranscodeStep } from "@rawkoon/shared/types";
import type { ClaimedJob } from "./repo";

const MIN_UPDATE_MS = 15_000;
const MIN_PROGRESS_DELTA = 0.05;

function state(
  step: TranscodeStep,
  progress: TranscodeLiveProgress | null,
  status: ReencodeLiveState["status"] = "running",
): ReencodeLiveState {
  return {
    progress: Math.min(1, Math.max(0, progress?.progress ?? 0)),
    step,
    etaSeconds: progress?.eta_secs ?? null,
    status,
  };
}

async function startOnDevice(
  device: { id: number; startToken: string },
  job: ClaimedJob,
): Promise<void> {
  await prisma.liveActivityDevice.update({
    where: { id: device.id },
    data: {
      currentJobId: job.id,
      activityToken: null,
      lastProgress: null,
      lastStep: null,
      lastSentAt: null,
    },
  });
  const result = await sendLiveActivityViaRelay({
    event: "start",
    token: device.startToken,
    state: state("preflight", null),
    attributes: {
      jobId: job.id,
      title: job.title.slice(0, 160),
      codec: job.settings.codec,
    },
  });
  if (result.expired) {
    await prisma.liveActivityDevice.delete({ where: { id: device.id } });
  } else if (!result.success) {
    await prisma.liveActivityDevice.update({
      where: { id: device.id },
      data: { currentJobId: null },
    });
    console.warn(`[transcode] Live Activity start failed on ${device.id}: ${result.error}`);
  }
}

export const transcodeLiveActivity = {
  async start(job: ClaimedJob): Promise<void> {
    const devices = await prisma.liveActivityDevice.findMany({
      where: {
        user: { isAdmin: true },
        OR: [{ currentJobId: null }, { currentJobId: { not: job.id } }],
      },
      select: { id: true, startToken: true },
    });
    await Promise.allSettled(devices.map((device) => startOnDevice(device, job)));
  },

  async startForInstallation(installationId: string, job: ClaimedJob): Promise<void> {
    const device = await prisma.liveActivityDevice.findUnique({
      where: { installationId },
      select: { id: true, startToken: true, currentJobId: true },
    });
    if (device && device.currentJobId !== job.id) await startOnDevice(device, job);
  },

  async update(
    job: ClaimedJob,
    step: TranscodeStep,
    progress: TranscodeLiveProgress | null,
  ): Promise<void> {
    const now = Date.now();
    const value = state(step, progress);
    const devices = await prisma.liveActivityDevice.findMany({
      where: { currentJobId: job.id, activityToken: { not: null }, user: { isAdmin: true } },
    });
    await Promise.allSettled(devices.map(async (device) => {
      if (!device.activityToken) return;
      const stepChanged = device.lastStep !== step;
      const changedEnough = Math.abs(value.progress - (device.lastProgress ?? 0)) >= MIN_PROGRESS_DELTA;
      const oldEnough = !device.lastSentAt || now - device.lastSentAt.getTime() >= MIN_UPDATE_MS;
      if (!stepChanged && !(changedEnough && oldEnough)) return;
      const result = await sendLiveActivityViaRelay({
        event: "update", token: device.activityToken, state: value,
      });
      if (result.success) {
        await prisma.liveActivityDevice.update({
          where: { id: device.id },
          data: { lastStep: step, lastProgress: value.progress, lastSentAt: new Date(now) },
        });
      } else if (result.expired) {
        await prisma.liveActivityDevice.update({
          where: { id: device.id }, data: { activityToken: null },
        });
      }
    }));
  },

  async end(
    job: ClaimedJob,
    status: "done" | "failed" | "cancelled",
  ): Promise<void> {
    const devices = await prisma.liveActivityDevice.findMany({
      where: { currentJobId: job.id },
    });
    await Promise.allSettled(devices.map(async (device) => {
      if (device.activityToken) {
        await sendLiveActivityViaRelay({
          event: "end",
          token: device.activityToken,
          state: state("rescan", { progress: status === "done" ? 1 : device.lastProgress ?? 0,
            fps: null, speed: null, eta_secs: null, current_bytes: null }, status),
        });
      }
      await prisma.liveActivityDevice.update({
        where: { id: device.id },
        data: { currentJobId: null, activityToken: null, lastProgress: null,
          lastStep: null, lastSentAt: null },
      });
    }));
  },
};
