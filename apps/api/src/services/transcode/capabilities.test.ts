import { describe, expect, it } from "bun:test";
import { parseEncoderList } from "@rawkoon/api/services/transcode/capabilities";

describe("parseEncoderList", () => {
  it("extracts encoder names from ffmpeg -encoders", () => {
    const out = [
      "Encoders:",
      " V..... = Video",
      " ------",
      " V....D libx265              libx265 H.265 / HEVC (codec hevc)",
      " V..... libsvtav1            SVT-AV1 (codec av1)",
      " V....D hevc_vaapi           H.265/HEVC (VAAPI) (codec hevc)",
      " A....D aac                  AAC",
    ].join("\n");
    const s = parseEncoderList(out);
    expect([...s].sort()).toEqual([
      "aac",
      "hevc_vaapi",
      "libsvtav1",
      "libx265",
    ]);
  });
});
