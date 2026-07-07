import type { Job } from "bullmq";
import { prisma } from "@rawkoon/api/db";
import { Prisma } from "@prisma/client";

export interface ActivityLogJobData {
  type: string;
  userId?: string | null;
  payload?: Prisma.InputJsonValue;
  createdAt?: string; // ISO string for serialization
}

export async function processActivityLogJob(job: Job<ActivityLogJobData>) {
  const { type, userId, payload, createdAt } = job.data;

  try {
    await prisma.activityLog.create({
      data: {
        type,
        userId: userId ?? null,
        payload: payload ?? Prisma.DbNull,
        createdAt: createdAt ? new Date(createdAt) : new Date(),
      },
    });
    return { success: true };
  } catch (error) {
    console.warn(
      `[ActivityLogWorker] Failed to write activity log: ${type}`,
      error,
    );
    throw error;
  }
}
