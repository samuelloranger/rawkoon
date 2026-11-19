import { describe, expect, it } from "bun:test";
import { isLossyInode } from "./downloadsScanner";

describe("isLossyInode", () => {
  it("flags an inode stored from a rounded double", () => {
    expect(isLossyInode(String(Number(2n ** 62n + 12345n)))).toBe(true);
  });

  it("trusts an exact bigint inode and small inodes", () => {
    expect(isLossyInode((2n ** 62n + 12345n).toString())).toBe(false);
    expect(isLossyInode("123456")).toBe(false);
  });

  it("handles negative inodes from an old signed stat", () => {
    expect(isLossyInode(String(Number(-(2n ** 62n) - 12345n)))).toBe(true);
    expect(isLossyInode((-(2n ** 62n) - 12345n).toString())).toBe(false);
  });
});
