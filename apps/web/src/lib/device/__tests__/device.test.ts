import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDeviceInfo } from "../index";

function mockNavigator(userAgent: string, platform = "Linux x86_64") {
  Object.defineProperty(navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
  Object.defineProperty(navigator, "platform", {
    value: platform,
    configurable: true,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("getDeviceInfo — browser detection", () => {
  it("detects Chrome", () => {
    mockNavigator(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    const info = getDeviceInfo();
    expect(info.browserName).toBe("Chrome");
    expect(info.browserVersion).toBe("120.0");
  });

  it("detects Firefox", () => {
    mockNavigator(
      "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
    );
    const info = getDeviceInfo();
    expect(info.browserName).toBe("Firefox");
    expect(info.browserVersion).toBe("121.0");
  });

  it("detects Edge", () => {
    mockNavigator(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    );
    const info = getDeviceInfo();
    expect(info.browserName).toBe("Edge");
  });

  it("detects Safari", () => {
    mockNavigator(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      "MacIntel",
    );
    const info = getDeviceInfo();
    expect(info.browserName).toBe("Safari");
    expect(info.browserVersion).toBe("17.0");
  });
});

describe("getDeviceInfo — OS detection", () => {
  it("detects Windows 10/11", () => {
    mockNavigator(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    const info = getDeviceInfo();
    expect(info.osName).toBe("Windows");
    expect(info.osVersion).toBe("10/11");
  });

  it("detects macOS", () => {
    mockNavigator(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
      "MacIntel",
    );
    const info = getDeviceInfo();
    expect(info.osName).toBe("macOS");
    expect(info.osVersion).toBe("14.2");
  });

  it("detects iOS", () => {
    mockNavigator(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
      "iPhone",
    );
    const info = getDeviceInfo();
    expect(info.osName).toBe("iOS");
    expect(info.osVersion).toBe("17.2");
  });

  it("detects Android", () => {
    mockNavigator(
      "Mozilla/5.0 (Linux; Android 13.0; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
    );
    const info = getDeviceInfo();
    expect(info.osName).toBe("Android");
    expect(info.osVersion).toBe("13.0");
  });

  it("detects Linux", () => {
    mockNavigator(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    const info = getDeviceInfo();
    expect(info.osName).toBe("Linux");
  });
});
