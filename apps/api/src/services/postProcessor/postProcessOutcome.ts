/** Content failures are the release's fault and get it blocklisted; anything else is retryable. */
export type PostProcessRejectKind = "no_content";

export type PostProcessFailure = {
  success: false;
  reason: string;
  rejectKind?: PostProcessRejectKind;
};

/** What a post-processor reports; `finishPostProcess` is the only thing that records it on the row. */
export type PostProcessOutcome =
  | {
      success: true;
      destinationPath: string;
      episodeCount?: number;
      /** Success that imported nothing because another grab already placed the file; not a fresh import. */
      skipped?: boolean;
      skipReason?: string;
    }
  | PostProcessFailure;
