import { describe, expect, it } from "bun:test";
import {
  describeFailure,
  parseProgressBlock,
  runFfmpeg,
} from "@rawkoon/api/services/transcode/ffmpegRunner";

describe("parseProgressBlock", () => {
  it("reads out_time_us, fps, speed and size", () => {
    const p = parseProgressBlock(
      "frame=240\nfps=48.5\nout_time_us=10000000\ntotal_size=5242880\nspeed=2.02x\nprogress=continue\n",
    );
    expect(p).toEqual({
      outTimeSecs: 10,
      fps: 48.5,
      speed: 2.02,
      totalSize: 5242880,
      done: false,
    });
  });

  it("marks end and tolerates N/A", () => {
    const p = parseProgressBlock("out_time_us=N/A\nspeed=N/A\nprogress=end\n");
    expect(p.done).toBe(true);
    expect(p.outTimeSecs).toBeNull();
    expect(p.speed).toBeNull();
  });
});

describe("describeFailure", () => {
  it("explains an OOM kill", () => {
    expect(
      describeFailure({
        code: null,
        signal: "SIGKILL",
        stderr: "",
        aborted: false,
      }),
    ).toBe("ffmpeg killed (out of memory?)");
  });

  it("uses the last stderr line", () => {
    expect(
      describeFailure({
        code: 1,
        signal: null,
        stderr: "a\nError while opening encoder\n",
        aborted: false,
      }),
    ).toBe("ffmpeg exited 1: Error while opening encoder");
  });
});

describe("runFfmpeg", () => {
  it("returns aborted without spawning when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await runFfmpeg(["/nonexistent/ffmpeg-binary"], {
      signal: ac.signal,
    });
    expect(r.aborted).toBe(true);
  });
});
