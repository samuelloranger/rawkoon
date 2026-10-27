import type { BookEditionKind } from "@rawkoon/shared/types";

const BOOKS = "/mnt/storage/Books";
const AUDIO = "/mnt/storage/Audiobooks";

export interface Source {
  kind: BookEditionKind;
  /** File for a single-format ebook, directory for everything else. */
  path: string;
  /** Register the file where it is, for destinations the API cannot create (root-owned dir); ebook only, since audiobooks need postProcessBook. */
  inPlace?: boolean;
}

export interface Entry {
  /** Stable handle for logs and --only. */
  key: string;
  /** Google Books search query used by --resolve. */
  query: string;
  /** Filled in from --resolve output. Required by --dry-run and --apply. */
  volumeId?: string;
  /** What the volume is expected to be, so a bad match is obvious in review. */
  expect: string;
  /** Overrides the provider-reported language after create, for volumes whose ISBN group disagrees with the text. */
  forceLanguage?: string;
  sources: Source[];
}

const HP = `${BOOKS}/J.K. Rowling - Harry Potter`;
const HPA = `${AUDIO}/Harry Potter`;
const MAAS = `${BOOKS}/Sarah Maas`;
const YARROS = `${BOOKS}/Rebecca Yaros`;

export const MANIFEST: Entry[] = [
  // ---- J.K. Rowling, Harry Potter (fr) — ebook (epub+mobi) and audiobook ----
  // The only self-consistent French set (one author spelling); UK-registered ISBNs need forceLanguage.
  {
    key: "hp1",
    query: 'intitle:"Harry Potter à l\'école des sorciers" inauthor:Rowling',
    volumeId: "nvijsUyJYR4C",
    forceLanguage: "fr",
    expect: "Harry Potter à l'école des sorciers (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${HP}/Harry Potter - T01 - Harry Potter a l'Ecole des Sorciers (9)`,
      },
      {
        kind: "audiobook",
        path: `${HPA}/(1997) Harry Potter à l’école des sorciers`,
      },
    ],
  },
  {
    key: "hp2",
    query: 'intitle:"Harry Potter et la Chambre des secrets" inauthor:Rowling',
    volumeId: "GBl6MWssicEC",
    forceLanguage: "fr",
    expect: "Harry Potter et la Chambre des secrets (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${HP}/Harry Potter - T02 - Harry Potter et la Chambre des Secrets (12)`,
      },
      {
        kind: "audiobook",
        path: `${HPA}/(1998) Harry Potter et la Chambre des Secrets`,
      },
    ],
  },
  {
    key: "hp3",
    query:
      'intitle:"Harry Potter et le prisonnier d\'Azkaban" inauthor:Rowling',
    volumeId: "vWxokFDTpy4C",
    forceLanguage: "fr",
    expect: "Harry Potter et le prisonnier d'Azkaban (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${HP}/Harry Potter - T03 - Harry Potter et le Prisonnier d'Azkaban (13)`,
      },
      {
        kind: "audiobook",
        path: `${HPA}/(1999) Harry Potter et le prisonnier d’Azkaban`,
      },
    ],
  },
  {
    key: "hp4",
    query: 'intitle:"Harry Potter et la Coupe de feu" inauthor:Rowling',
    volumeId: "ox9BiuVKM1cC",
    forceLanguage: "fr",
    expect: "Harry Potter et la Coupe de feu (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${HP}/Harry Potter - T04 - Harry Potter et la Coupe de Feu (15)`,
      },
      {
        kind: "audiobook",
        path: `${HPA}/(2000) Harry Potter et la Coupe de Feu`,
      },
    ],
  },
  {
    key: "hp5",
    query: 'intitle:"Harry Potter et l\'Ordre du Phénix" inauthor:Rowling',
    volumeId: "d1Fm_U1LzY4C",
    forceLanguage: "fr",
    expect: "Harry Potter et l'Ordre du Phénix (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${HP}/Harry Potter - T05 - Harry Potter et l'Ordre du Phenix (14)`,
      },
      {
        kind: "audiobook",
        path: `${HPA}/(2003) Harry Potter et l’Ordre du Phénix`,
      },
    ],
  },
  {
    key: "hp6",
    query: 'intitle:"Harry Potter et le Prince de Sang-Mêlé" inauthor:Rowling',
    volumeId: "YoVZxxIVvnQC",
    forceLanguage: "fr",
    expect: "Harry Potter et le Prince de Sang-Mêlé (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${HP}/Harry Potter - T06 - Harry Potter et le Prince de Sang-Mele (11)`,
      },
      {
        kind: "audiobook",
        path: `${HPA}/(2005) Harry Potter et le Prince de Sang-Mêlé`,
      },
    ],
  },
  {
    key: "hp7",
    query: 'intitle:"Harry Potter et les Reliques de la Mort" inauthor:Rowling',
    volumeId: "Z8GBngEACAAJ",
    forceLanguage: "fr",
    expect: "Harry Potter et les Reliques de la Mort (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${HP}/Harry Potter - T07 - Harry Potter et les Reliques de la Mort (10)`,
      },
      {
        kind: "audiobook",
        path: `${HPA}/(2007) Harry Potter et les Reliques de la Mort`,
      },
    ],
  },

  // ---- Sarah J. Maas, Un palais d'épines et de roses (fr) ----
  // Titled by real book title; the alternative volumes show a series position where the title belongs.
  {
    key: "acotar1",
    query: 'intitle:"Un palais d\'épines et de roses" inauthor:Maas',
    volumeId: "OlkOugEACAAJ",
    // The source epub bundles tomes 1 and 3, and splitting it would mean splitting the file.
    expect:
      "Un palais d'épines et de roses T1 (fr) — source epub bundles T1+T3",
    sources: [
      {
        kind: "ebook",
        path: `${MAAS}/Un Palais d'epines et de roses - Sarah J. Maas.epub`,
      },
      {
        kind: "audiobook",
        path: `${AUDIO}/Sarah J. Maas  - Un palais d'épines et de rose 1 [mp3-64]`,
      },
    ],
  },
  {
    key: "acotar2",
    query: "Un palais de colère et de brume Sarah J Maas",
    volumeId: "tRPbswEACAAJ",
    expect: "Un palais d'épines et de roses T2, colère et brume (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${MAAS}/Un Palais de colere et de brume - Sarah J. Maas.epub`,
      },
    ],
  },
  {
    key: "acotar3",
    query: "Un Palais d'épines et de roses T3 Sarah J Maas",
    volumeId: "9QTMxgEACAAJ",
    expect: "Un palais d'épines et de roses T3, cendres et ruines (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${MAAS}/Un palais de cendres et de ruin - Sarah J. Maas.epub`,
      },
    ],
  },
  {
    key: "acotar4",
    query: "Un palais de glace et de lumière Sarah J Maas",
    volumeId: "KcEkygEACAAJ",
    expect: "Un palais d'épines et de roses T3.5, glace et lumière (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${MAAS}/Un palais de glace et de lumier - Sarah J. Maas.epub`,
      },
    ],
  },
  {
    key: "acotar5",
    query: "Un palais de flammes d'argent Sarah J Maas",
    volumeId: "T6u7zgEACAAJ",
    expect: "Un palais d'épines et de roses T5, flammes d'argent (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${MAAS}/Sarah J. Maas - Un Palais de flammes d'argent (2021).epub`,
      },
    ],
  },

  // ---- Rebecca Yarros, The Empyrean (fr) ----
  {
    key: "empyrean1",
    query: "Fourth Wing Rebecca Yarros français",
    volumeId: "PzfpEAAAQBAJ",
    // Audiobook only: the epub is truncated (no end-of-central-directory).
    expect: "Fourth Wing VF / Empyrean 1 (fr), audiobook only",
    sources: [
      {
        kind: "audiobook",
        path: `${AUDIO}/Rebecca Yarros - The Empyrean 1 - Fourth Wing`,
      },
    ],
  },
  {
    key: "empyrean2",
    query: "Iron Flame Rebecca Yarros français",
    volumeId: "q7jvEAAAQBAJ",
    expect: "Iron Flame VF / Empyrean 2 (fr), audiobook only",
    sources: [
      {
        kind: "audiobook",
        path: `${AUDIO}/Rebecca Yarros - The Empyrean 2 - Iron Flame`,
      },
    ],
  },
  {
    key: "empyrean3",
    query: "Onyx Storm Rebecca Yarros français",
    volumeId: "-yU9EQAAQBAJ",
    expect: "Onyx Storm VF / Empyrean 3 (fr) — the (anglais) epub is skipped",
    sources: [
      { kind: "ebook", path: `${YARROS}/Onyx Storm - Rebecca Yarros.epub` },
    ],
  },

  // ---- Suzanne Collins, Hunger Games (fr) ----
  {
    key: "hg1",
    query: "Hunger Games Suzanne Collins tome 1",
    volumeId: "lEnrxE2FUFAC",
    expect: "Hunger Games tome 1 (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Hunger Games/[Tome 1] Hunger Games.epub`,
      },
    ],
  },
  {
    key: "hg2",
    query: "Hunger Games tome 2 L'embrasement Suzanne Collins",
    volumeId: "m5M_8vnQWe8C",
    expect: "Hunger Games tome 2, L'embrasement (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Hunger Games/[Tome 2] Hunger Games - L'Embrasement.epub`,
      },
    ],
  },
  {
    key: "hg3",
    query: "Hunger Games tome 3 La révolte Suzanne Collins",
    volumeId: "bxgqqjEEsRQC",
    expect: "Hunger Games tome 3, La révolte (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Hunger Games/[Tome 3] Hunger Games - La Révolte.epub`,
      },
    ],
  },

  // ---- Colleen Hoover (fr) ----
  // The matching pdfs stay on disk; epub is preferred and a second format adds nothing.
  {
    key: "hoover-jamais-plus",
    query: 'intitle:"Jamais plus" inauthor:Hoover',
    volumeId: "43g9DgAAQBAJ",
    expect:
      "Jamais plus (fr) — It Ends With Us pdf is the en duplicate, skipped",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Coleen Hoover/Jamais plus - Colleen Hoover.epub`,
      },
    ],
  },
  {
    key: "hoover-souvenirs",
    query: "Reminders of Him Souvenirs de lui Colleen Hoover",
    volumeId: "5xvpEAAAQBAJ",
    // Published in French first, then reissued under the English title; same book.
    expect: "Souvenirs de lui / Reminders of him VF (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Coleen Hoover/Souvenirs de Lui - Colleen Hoover (fr).epub`,
      },
    ],
  },

  // ---- Freida McFadden — only the titles not already in the library ----
  // "Never Lie (2022).epub" is actually "La psy" per its OPF, already in the library.
  {
    key: "mcfadden-boyfriend",
    query: "Le boyfriend Freida McFadden",
    volumeId: "UrhzEQAAQBAJ",
    expect: "Le boyfriend (fr, 2025)",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Freida McFadden/Le.Boyfriend.2025.Frieda.McFadden.epub`,
      },
    ],
  },

  // ---- Titles whose filenames were English but whose files are French ----
  // Each epub declares fr in its OPF despite the English filename.
  {
    key: "weir-martian",
    query: "Seul sur Mars Andy Weir",
    volumeId: "1eKuoAEACAAJ",
    expect: "Seul sur Mars (fr) — file named 'The Martian', OPF says fr",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Andy Weir/The Martian (2011).epub`,
        inPlace: true,
      },
    ],
  },
  {
    key: "weir-phm",
    query: "Projet Dernière Chance Andy Weir",
    volumeId: "9JQ2EAAAQBAJ",
    expect: "Projet Dernière Chance (fr) — file named 'Project Hail Mary'",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Andy Weir/Project Hail Mary (2021).epub`,
        inPlace: true,
      },
    ],
  },
  {
    key: "grace-icebreaker",
    query: "Icebreaker Maple Hills Tome 1 Hannah Grace",
    volumeId: "Ghe1EAAAQBAJ",
    expect: "Icebreaker, Maple Hills T1, édition française (fr)",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Hannah Grace/Icebreaker - Hannah Grace.epub`,
      },
    ],
  },

  // ---- Québec / misc (fr) ----
  {
    key: "morrissette-mises-en-scene",
    query: "Mises en scène Guillaume Morrissette",
    volumeId: "c8eDEQAAQBAJ",
    expect: "Mises en scène (fr), Guillaume Morrissette",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Guillaume Morrissette/Mises en scène - Guillaume Morrissette.epub`,
      },
    ],
  },
  {
    key: "kitten-borderline1",
    query: 'intitle:"Borderline" inauthor:"Joyce Kitten"',
    volumeId: "gdNw0AEACAAJ",
    expect: "Borderline Tome 1 (fr), Joyce Kitten",
    sources: [
      {
        kind: "ebook",
        path: `${BOOKS}/Joyce Kitten/Joyce Kitten - Borderline, Tome 1.epub`,
      },
    ],
  },
];
