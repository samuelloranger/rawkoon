import { z } from "zod";
import { connectionFailure } from "@rawkoon/api/utils/describeError";
import {
  isValidHttpUrl,
  normalizeUrl,
} from "@rawkoon/api/utils/integrations/utils";

/** Request body of a "Test" route: typed values win, so a form can be tested before saving. */
export const testBodySchema = z.object({
  website_url: z.string().optional(),
  api_key: z.string().optional(),
});

type Stored = { website_url?: string; api_key?: string } | null | undefined;

const sameUrl = (a: string, b: string): boolean => {
  try {
    const strip = (u: string) => new URL(u).href.replace(/\/+$/, "");
    return strip(a) === strip(b);
  } catch {
    return false;
  }
};

/** The URL and key to probe: typed values, else the stored ones; or the reason there is nothing to test. */
export function resolveTestTarget(
  body: z.infer<typeof testBodySchema>,
  stored: Stored,
): { website_url: string; api_key: string } | { error: string } {
  const websiteUrl = normalizeUrl(
    body.website_url?.trim() || stored?.website_url || "",
  );
  if (!websiteUrl || !isValidHttpUrl(websiteUrl)) {
    return { error: "No valid website_url to test" };
  }
  const typedKey = body.api_key?.trim();
  // The saved key must never travel to a URL the admin hasn't saved it for.
  const mayUseStored =
    !stored?.website_url || sameUrl(websiteUrl, stored.website_url);
  const apiKey = typedKey || (mayUseStored ? stored?.api_key : "") || "";
  if (!apiKey) {
    return {
      error:
        !typedKey && stored?.api_key && !mayUseStored
          ? "Enter the API key to test a different URL"
          : "No API key to test",
    };
  }
  return { website_url: websiteUrl, api_key: apiKey };
}

/** The `{ success: false }` body of a failed test; never carries the key. */
export function failedTest(error: unknown, target: string) {
  const failure = connectionFailure(error, target);
  return { success: false as const, error: failure.message, ...failure };
}
