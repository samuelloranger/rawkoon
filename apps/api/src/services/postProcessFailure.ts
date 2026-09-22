/** Content failures are the release's fault and get it blocklisted; anything else is retryable. */
export type PostProcessRejectKind = "no_content" | "pack_mismatch";

export type PostProcessFailure = {
  success: false;
  reason: string;
  rejectKind?: PostProcessRejectKind;
};
