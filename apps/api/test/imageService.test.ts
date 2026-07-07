import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isAllowedFile,
  getContentType,
  saveImageAndCreateThumbnail,
  deleteImageFiles,
  getImage,
  getThumbnail,
} from "../src/services/imageService";

describe("Image Service", () => {
  describe("isAllowedFile", () => {
    it("should allow PNG files", () => {
      expect(isAllowedFile("image.png")).toBe(true);
      expect(isAllowedFile("image.PNG")).toBe(true);
    });

    it("should allow JPG/JPEG files", () => {
      expect(isAllowedFile("image.jpg")).toBe(true);
      expect(isAllowedFile("image.jpeg")).toBe(true);
      expect(isAllowedFile("image.JPG")).toBe(true);
      expect(isAllowedFile("image.JPEG")).toBe(true);
    });

    it("should allow GIF files", () => {
      expect(isAllowedFile("image.gif")).toBe(true);
      expect(isAllowedFile("image.GIF")).toBe(true);
    });

    it("should allow WebP files", () => {
      expect(isAllowedFile("image.webp")).toBe(true);
      expect(isAllowedFile("image.WEBP")).toBe(true);
    });

    it("should reject non-image files", () => {
      expect(isAllowedFile("document.pdf")).toBe(false);
      expect(isAllowedFile("script.js")).toBe(false);
      expect(isAllowedFile("style.css")).toBe(false);
      expect(isAllowedFile("data.json")).toBe(false);
      expect(isAllowedFile("archive.zip")).toBe(false);
    });

    it("should reject files without extension", () => {
      expect(isAllowedFile("noextension")).toBe(false);
    });

    it("should handle filenames with multiple dots", () => {
      expect(isAllowedFile("my.photo.jpg")).toBe(true);
      expect(isAllowedFile("file.name.with.dots.png")).toBe(true);
    });

    it("should reject empty filenames", () => {
      expect(isAllowedFile("")).toBe(false);
    });

    it("should handle edge cases", () => {
      expect(isAllowedFile(".jpg")).toBe(true);
      expect(isAllowedFile("..jpg")).toBe(true);
    });
  });

  describe("getContentType", () => {
    it("should return correct content type for PNG", () => {
      expect(getContentType("image.png")).toBe("image/png");
      expect(getContentType("image.PNG")).toBe("image/png");
    });

    it("should return correct content type for JPG/JPEG", () => {
      expect(getContentType("image.jpg")).toBe("image/jpeg");
      expect(getContentType("image.jpeg")).toBe("image/jpeg");
      expect(getContentType("image.JPG")).toBe("image/jpeg");
    });

    it("should return correct content type for GIF", () => {
      expect(getContentType("image.gif")).toBe("image/gif");
    });

    it("should return correct content type for WebP", () => {
      expect(getContentType("image.webp")).toBe("image/webp");
    });

    it("should return octet-stream for unknown extensions", () => {
      expect(getContentType("file.xyz")).toBe("application/octet-stream");
      expect(getContentType("file.pdf")).toBe("application/octet-stream");
    });

    it("should handle filenames with multiple dots", () => {
      expect(getContentType("my.photo.jpg")).toBe("image/jpeg");
    });
  });

  describe("saveImageAndCreateThumbnail", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "rawkoon-img-"));
      process.env.IMAGE_STORAGE_DIR = dir;
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
      delete process.env.IMAGE_STORAGE_DIR;
    });

    it("should throw error for invalid file type", async () => {
      const mockFile = new File(["test"], "test.pdf", {
        type: "application/pdf",
      });

      await expect(saveImageAndCreateThumbnail(mockFile)).rejects.toThrow(
        "Invalid file type",
      );
    });
  });

  describe("deleteImageFiles", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "rawkoon-img-"));
      process.env.IMAGE_STORAGE_DIR = dir;
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
      delete process.env.IMAGE_STORAGE_DIR;
    });

    it("should handle null/empty image name gracefully", async () => {
      await deleteImageFiles("");
      await deleteImageFiles(null as unknown as string);
    });
  });

  describe("getImage / getThumbnail", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "rawkoon-img-"));
      process.env.IMAGE_STORAGE_DIR = dir;
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
      delete process.env.IMAGE_STORAGE_DIR;
    });

    it("should return null when file does not exist", async () => {
      expect(await getImage("missing.jpg")).toBeNull();
      expect(await getThumbnail("missing.jpg")).toBeNull();
    });
  });
});

// Integration test — uses the real test image fixture and the tmp filesystem
describe("Image Service Integration", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rawkoon-img-int-"));
    process.env.IMAGE_STORAGE_DIR = dir;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.IMAGE_STORAGE_DIR;
  });

  it("should save image and create thumbnail on disk", async () => {
    const testImagePath = new URL("./fixtures/test-image.png", import.meta.url)
      .pathname;
    const imageFile = Bun.file(testImagePath);
    const imageBuffer = await imageFile.arrayBuffer();

    const mockFile = new File([imageBuffer], "test-upload.png", {
      type: "image/png",
    });

    const imagePath = await saveImageAndCreateThumbnail(mockFile);
    expect(imagePath).toBeDefined();
    expect(imagePath).toMatch(/\.png$/);

    const image = await getImage(imagePath);
    expect(image).not.toBeNull();

    const thumbnail = await getThumbnail(imagePath);
    expect(thumbnail).not.toBeNull();

    await deleteImageFiles(imagePath);
    expect(await getImage(imagePath)).toBeNull();
    expect(await getThumbnail(imagePath)).toBeNull();
  });
});

describe("Image Service with Test Fixture", () => {
  it("should load and validate test image file", async () => {
    const testImagePath = new URL("./fixtures/test-image.png", import.meta.url)
      .pathname;
    const imageFile = Bun.file(testImagePath);

    expect(await imageFile.exists()).toBe(true);

    const imageBuffer = await imageFile.arrayBuffer();
    expect(imageBuffer.byteLength).toBeGreaterThan(0);

    const bytes = new Uint8Array(imageBuffer);
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x4e);
    expect(bytes[3]).toBe(0x47);
  });

  it("should recognize test image as allowed file type", () => {
    expect(isAllowedFile("test-image.png")).toBe(true);
  });

  it("should return correct content type for test image", () => {
    expect(getContentType("test-image.png")).toBe("image/png");
  });
});
