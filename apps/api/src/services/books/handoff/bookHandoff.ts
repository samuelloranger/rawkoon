import { prisma } from "@rawkoon/api/db";
import { gateAiCall } from "@rawkoon/api/services/aiProvider/aiGate";
import { loadEnabledAiProviderConfig } from "@rawkoon/api/services/aiProvider/client";
import type { AiGateResult } from "@rawkoon/api/services/aiProvider/aiGate";
import {
  loadEpubTextModel,
  type EpubTextModel,
} from "@rawkoon/api/services/books/handoff/epubTextModel";
import {
  listenToRead,
  readToListen,
  type HandoffFailure,
} from "@rawkoon/api/services/books/handoff/handoffCore";
import {
  createWhisperTranscriber,
  type AudioChapter,
  type Transcriber,
  type WhisperTranscriberOptions,
} from "@rawkoon/api/services/books/handoff/transcribe";
import type { AiProviderConfig } from "@rawkoon/api/utils/integrations/types";
import type {
  BookHandoffToAudiobookResponse,
  BookHandoffToEbookResponse,
} from "@rawkoon/shared/types";

export type HandoffErrorCode =
  | HandoffFailure["code"]
  | "no_ebook_edition"
  | "no_epub_file"
  | "no_audiobook_edition"
  | "no_audio_file"
  | "ai_provider_disabled"
  | "feature_disabled"
  | "budget_exceeded";

export type HandoffOutcome<T> = T | { ok: false; code: HandoffErrorCode };

/** Everything with a side effect, so tests can run the flow without a DB, ffmpeg or network. */
export interface HandoffDeps {
  loadConfig: () => Promise<AiProviderConfig | null>;
  checkGate: (
    config: AiProviderConfig,
    bookEditionId: number,
  ) => Promise<AiGateResult>;
  loadModel: (path: string) => Promise<EpubTextModel | null>;
  createTranscriber: (options: WhisperTranscriberOptions) => Transcriber;
}

export const defaultHandoffDeps: HandoffDeps = {
  loadConfig: loadEnabledAiProviderConfig,
  checkGate: (config, bookEditionId) =>
    gateAiCall(config, { feature: "book_sync", bookEditionId }),
  loadModel: loadEpubTextModel,
  createTranscriber: createWhisperTranscriber,
};

interface Sources {
  epubPath: string;
  epubFileId: number;
  audioEditionId: number;
  chapters: AudioChapter[];
  durationSecs: number;
}

async function resolveSources(
  bookId: number,
): Promise<Sources | { ok: false; code: HandoffErrorCode }> {
  const [ebook, audiobook] = await Promise.all([
    prisma.bookEdition.findUnique({
      where: { bookId_kind: { bookId, kind: "ebook" } },
      select: {
        files: { select: { id: true, filePath: true, format: true } },
      },
    }),
    prisma.bookEdition.findUnique({
      where: { bookId_kind: { bookId, kind: "audiobook" } },
      select: {
        id: true,
        durationSecs: true,
        chapters: {
          orderBy: { index: "asc" },
          select: {
            startSecs: true,
            endSecs: true,
            bookFile: { select: { id: true, filePath: true } },
          },
        },
      },
    }),
  ]);
  if (!ebook) return { ok: false, code: "no_ebook_edition" };
  if (!audiobook) return { ok: false, code: "no_audiobook_edition" };

  // An edition can hold several formats; only an epub has the spine we map onto.
  const epub = ebook.files.find((f) => f.format.toLowerCase() === "epub");
  if (!epub) return { ok: false, code: "no_epub_file" };
  if (audiobook.chapters.length === 0)
    return { ok: false, code: "no_audio_file" };

  const chapterEnd = Math.max(...audiobook.chapters.map((c) => c.endSecs));
  return {
    epubPath: epub.filePath,
    epubFileId: epub.id,
    audioEditionId: audiobook.id,
    chapters: audiobook.chapters,
    durationSecs: chapterEnd > 0 ? chapterEnd : (audiobook.durationSecs ?? 0),
  };
}

type Prepared = {
  sources: Sources;
  model: EpubTextModel;
  transcribe: Transcriber;
};

/** Resolves files, then checks provider and gate before anything is read or transcribed. */
async function prepare(
  bookId: number,
  deps: HandoffDeps,
): Promise<Prepared | { ok: false; code: HandoffErrorCode }> {
  const sources = await resolveSources(bookId);
  if ("ok" in sources) return sources;

  const config = await deps.loadConfig();
  if (!config) return { ok: false, code: "ai_provider_disabled" };

  const gate = await deps.checkGate(config, sources.audioEditionId);
  if (!gate.allowed) return { ok: false, code: gate.reason };

  const model = await deps.loadModel(sources.epubPath);
  if (!model) return { ok: false, code: "no_epub_file" };

  return {
    sources,
    model,
    transcribe: deps.createTranscriber({
      config,
      chapters: sources.chapters,
      language: model.language,
      bookEditionId: sources.audioEditionId,
    }),
  };
}

/** What a caller that persists the result needs beyond the response itself. */
export interface HandoffSource {
  epubFileId: number;
  spineCount: number;
  audiobookDurationSecs: number;
}

export interface DetailedHandoff<T> {
  result: T;
  source: HandoffSource;
}

const sourceOf = (p: Prepared): HandoffSource => ({
  epubFileId: p.sources.epubFileId,
  spineCount: p.model.docs.length,
  audiobookDurationSecs: p.sources.durationSecs,
});

export async function handoffToEbookDetailed(
  bookId: number,
  positionSecs: number,
  deps: HandoffDeps = defaultHandoffDeps,
): Promise<HandoffOutcome<DetailedHandoff<BookHandoffToEbookResponse>>> {
  const prepared = await prepare(bookId, deps);
  if ("ok" in prepared) return prepared;
  const result = await listenToRead({
    model: prepared.model,
    transcribe: prepared.transcribe,
    positionSecs: Math.min(
      Math.max(positionSecs, 0),
      prepared.sources.durationSecs,
    ),
  });
  if ("ok" in result) return result;
  return { result, source: sourceOf(prepared) };
}

export async function handoffToAudiobookDetailed(
  bookId: number,
  spinePath: string,
  progression: number,
  deps: HandoffDeps = defaultHandoffDeps,
): Promise<HandoffOutcome<DetailedHandoff<BookHandoffToAudiobookResponse>>> {
  const prepared = await prepare(bookId, deps);
  if ("ok" in prepared) return prepared;
  const result = await readToListen({
    model: prepared.model,
    transcribe: prepared.transcribe,
    durationSecs: prepared.sources.durationSecs,
    spinePath,
    progression,
  });
  if ("ok" in result) return result;
  return { result, source: sourceOf(prepared) };
}

export async function handoffToEbook(
  bookId: number,
  positionSecs: number,
  deps: HandoffDeps = defaultHandoffDeps,
): Promise<HandoffOutcome<BookHandoffToEbookResponse>> {
  const out = await handoffToEbookDetailed(bookId, positionSecs, deps);
  return "ok" in out ? out : out.result;
}

export async function handoffToAudiobook(
  bookId: number,
  spinePath: string,
  progression: number,
  deps: HandoffDeps = defaultHandoffDeps,
): Promise<HandoffOutcome<BookHandoffToAudiobookResponse>> {
  const out = await handoffToAudiobookDetailed(
    bookId,
    spinePath,
    progression,
    deps,
  );
  return "ok" in out ? out : out.result;
}
