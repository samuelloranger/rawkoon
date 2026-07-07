const COLON_RE = /:/g;
const INVALID_FILE_CHARS = /[/\\*?"<>|]/g;

/** Remove characters unsafe in path segments, matching Sonarr/Radarr's colon convention */
export function sanitizeFilenamePart(part: string): string {
  return part
    .replace(COLON_RE, " -")
    .replace(INVALID_FILE_CHARS, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function sanitizePathTemplateOutput(rendered: string): string {
  return rendered
    .split("/")
    .map((s) => sanitizeFilenamePart(s))
    .filter(Boolean)
    .join("/");
}

function padNum(n: number, width: number): string {
  return String(Math.trunc(n)).padStart(width, "0");
}

function replaceBraceTokens(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{([^}]+)\}/g, (_, raw: string) => {
    const trimmed = raw.trim();
    const colon = trimmed.indexOf(":");
    let key = trimmed;
    let pad: number | null = null;
    if (colon !== -1) {
      key = trimmed.slice(0, colon).trim();
      const padStr = trimmed.slice(colon + 1).trim();
      const p = parseInt(padStr.replace(/^0+/, "") || padStr, 10);
      if (Number.isFinite(p) && p > 0) pad = p;
    }
    const v = vars[key];
    if (v == null || v === "") return "";
    if (typeof v === "number" && pad != null) return padNum(v, pad);
    return String(v);
  });
}

function collapseTemplateNoise(s: string): string {
  return s
    .replace(/\[\s*\]/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s+-\s+|\s+-\s+$/g, "")
    .trim();
}

export function renderMovieTemplate(
  template: string,
  data: {
    title: string;
    year: number | null;
    resolution: string | null;
    source: string | null;
    codec: string | null;
    ext: string;
  },
): string {
  const stem = replaceBraceTokens(template, {
    title: data.title,
    year: data.year,
    resolution: data.resolution,
    source: data.source,
    codec: data.codec,
    ext: data.ext,
  });
  return sanitizeFilenamePart(collapseTemplateNoise(stem));
}

export function renderEpisodeTemplate(
  template: string,
  data: {
    show: string;
    season: number;
    episode: number;
    title: string | null;
    resolution: string | null;
    source: string | null;
    ext: string;
  },
): string {
  const stem = replaceBraceTokens(template, {
    show: data.show,
    season: data.season,
    episode: data.episode,
    title: data.title ?? "Episode",
    resolution: data.resolution,
    source: data.source,
    ext: data.ext,
  });
  return sanitizePathTemplateOutput(collapseTemplateNoise(stem));
}
