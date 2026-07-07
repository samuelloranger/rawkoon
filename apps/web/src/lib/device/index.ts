/**
 * Utility functions to detect device information
 */

export interface DeviceInfo {
  deviceName: string | null;
  osName: string;
  osVersion: string | null;
  browserName: string;
  browserVersion: string | null;
  platform: string;
}

/**
 * Detect browser name and version from user agent
 */
function detectBrowser(userAgent: string): {
  name: string;
  version: string | null;
} {
  // Chrome (includes Edge based on Chromium)
  if (userAgent.includes("Chrome") && !userAgent.includes("Edg")) {
    const match = userAgent.match(/Chrome\/(\d+\.\d+)/);
    return { name: "Chrome", version: match ? match[1] : null };
  }

  // Edge (Chromium-based)
  if (userAgent.includes("Edg")) {
    const match = userAgent.match(/Edg\/(\d+\.\d+)/);
    return { name: "Edge", version: match ? match[1] : null };
  }

  // Firefox
  if (userAgent.includes("Firefox")) {
    const match = userAgent.match(/Firefox\/(\d+\.\d+)/);
    return { name: "Firefox", version: match ? match[1] : null };
  }

  // Safari (must check before Chrome as Safari UA includes Chrome)
  if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
    const match = userAgent.match(/Version\/(\d+\.\d+)/);
    return { name: "Safari", version: match ? match[1] : null };
  }

  // Opera
  if (userAgent.includes("Opera") || userAgent.includes("OPR")) {
    const match = userAgent.match(/(?:Opera|OPR)\/(\d+\.\d+)/);
    return { name: "Opera", version: match ? match[1] : null };
  }

  return { name: "Unknown", version: null };
}

/**
 * Detect OS name and version from user agent
 */
function detectOS(userAgent: string): { name: string; version: string | null } {
  // Windows
  if (userAgent.includes("Windows")) {
    if (userAgent.includes("Windows NT 10.0"))
      return { name: "Windows", version: "10/11" };
    if (userAgent.includes("Windows NT 6.3"))
      return { name: "Windows", version: "8.1" };
    if (userAgent.includes("Windows NT 6.2"))
      return { name: "Windows", version: "8" };
    if (userAgent.includes("Windows NT 6.1"))
      return { name: "Windows", version: "7" };
    return { name: "Windows", version: null };
  }

  if (userAgent.includes("iPhone") || userAgent.includes("iPod")) {
    const match = userAgent.match(/OS (\d+[._]\d+)/);
    if (match) {
      const version = match[1].replace("_", ".");
      return { name: "iOS", version };
    }
    return { name: "iOS", version: null };
  }

  if (userAgent.includes("iPad")) {
    const match = userAgent.match(/OS (\d+[._]\d+)/);
    if (match) {
      const version = match[1].replace("_", ".");
      return { name: "iPadOS", version };
    }
    return { name: "iPadOS", version: null };
  }

  // macOS
  if (userAgent.includes("Mac OS X") || userAgent.includes("Macintosh")) {
    const match = userAgent.match(/Mac OS X (\d+[._]\d+)/);
    if (match) {
      const version = match[1].replace("_", ".");
      return { name: "macOS", version };
    }
    return { name: "macOS", version: null };
  }

  // Android
  if (userAgent.includes("Android")) {
    const match = userAgent.match(/Android (\d+\.\d+)/);
    return { name: "Android", version: match ? match[1] : null };
  }

  // Linux
  if (userAgent.includes("Linux")) {
    return { name: "Linux", version: null };
  }

  return { name: "Unknown", version: null };
}

/**
 * Get device information from the current browser environment
 */
export function getDeviceInfo(): DeviceInfo {
  const userAgent = navigator.userAgent;
  const platform = navigator.platform || "Unknown";

  const browser = detectBrowser(userAgent);
  const os = detectOS(userAgent);

  // Try to get device name (not always available)
  const deviceName = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory
    ? `${platform} (${(navigator as Navigator & { deviceMemory?: number }).deviceMemory}GB)`
    : null;

  return {
    deviceName,
    osName: os.name,
    osVersion: os.version,
    browserName: browser.name,
    browserVersion: browser.version,
    platform,
  };
}
