/**
 * Synthetic release and file names covering the shapes the release/filename
 * parsers have to handle. `truth` is what a correct parse looks like, so a
 * parser change can be judged against it, not just against the old output.
 * Sample entries carry the truth of the release they sample; samples are
 * filtered upstream by the isSample flag.
 */
export type ReleaseNameCase = {
  name: string;
  truth: {
    title: string;
    year?: number;
    season?: number;
    /** All episode numbers the release covers (multi-episode releases list each). */
    episodes?: number[];
    /** Daily shows: the air date as YYYY-MM-DD. */
    airDate?: string;
    /** Season pack (whole season, no episode). */
    seasonPack?: boolean;
    /** Multi-season packs: every season covered (`season` is the first). */
    seasons?: number[];
    /** The whole series, not one season ("Complete Series", "Intégrale"). */
    completeSeries?: boolean;
  };
};

export const MOVIE_RELEASES: ReleaseNameCase[] = [
  // Plain scene names across sources and resolutions.
  {
    name: "The.Long.Voyage.2021.1080p.BluRay.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.720p.BluRay.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.7.1-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.2160p.UHD.BluRay.REMUX.DV.HDR10+.TrueHD.Atmos.7.1-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.WEB-DL.DDP5.1.H.264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.AMZN.WEB-DL.DDP5.1.H.264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.NF.WEBRip.DDP5.1.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.2160p.DSNP.WEB-DL.DDP5.1.Atmos.DV.HEVC-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.2160p.ATVP.WEB-DL.DDP5.1.HDR10+.H.265-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.HMAX.WEB-DL.DD5.1.H.264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.720p.HDTV.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.DVDRip.XviD-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.576p.DVDRip.x264.AAC-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.480p.WEB.h264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.BDRip.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.BRRip.XviD.MP3-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.HDRip.XviD.AC3-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.BluRay.AV1.Opus.5.1-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.BluRay.VC-1.DTS-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.BluRay.FLAC.2.0.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.BluRay.LPCM.2.0.AVC-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.2160p.WEB-DL.HLG.H.265-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.BluRay.DTS-X.7.1.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.WEB.E-AC-3.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.1080i.HDTV.MPEG2.AC3-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.4K.WEB-DL.x265-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.UHD.BluRay.2160p.x265-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.HDCAM.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.HDLight.1080p.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },

  // Revisions, editions, samples.
  {
    name: "The.Long.Voyage.2021.PROPER.1080p.BluRay.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.REPACK.1080p.BluRay.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.REAL.PROPER.1080p.WEB.h264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.EXTENDED.1080p.BluRay.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.Directors.Cut.1080p.BluRay.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.REMASTERED.1080p.BluRay.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.UNRATED.720p.BluRay.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.IMAX.2160p.WEB-DL.x265-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.BluRay.x264-GRP.Sample",
    truth: { title: "The Long Voyage", year: 2021 },
  },

  // Titles containing years or numbers.
  {
    name: "1917.2019.1080p.BluRay.x264-GRP",
    truth: { title: "1917", year: 2019 },
  },
  {
    name: "2001.A.Space.Odyssey.1968.2160p.UHD.BluRay.x265-GRP",
    truth: { title: "2001 A Space Odyssey", year: 1968 },
  },
  {
    name: "Blade.Runner.2049.2017.1080p.BluRay.x264-GRP",
    truth: { title: "Blade Runner 2049", year: 2017 },
  },
  {
    name: "2012.2009.720p.BluRay.x264-GRP",
    truth: { title: "2012", year: 2009 },
  },
  {
    name: "1984.1984.1080p.BluRay.x264-GRP",
    truth: { title: "1984", year: 1984 },
  },
  {
    name: "Ocean.Eleven.2001.1080p.BluRay.x264-GRP",
    truth: { title: "Ocean Eleven", year: 2001 },
  },
  {
    name: "Seven.Samurai.1954.1080p.BluRay.x264-GRP",
    truth: { title: "Seven Samurai", year: 1954 },
  },
  {
    name: "Apollo.13.1995.1080p.BluRay.x264-GRP",
    truth: { title: "Apollo 13", year: 1995 },
  },
  {
    name: "District.9.2009.1080p.BluRay.x264-GRP",
    truth: { title: "District 9", year: 2009 },
  },
  {
    name: "300.2006.1080p.BluRay.x264-GRP",
    truth: { title: "300", year: 2006 },
  },
  {
    name: "Space.Odyssey.Part.2.2022.1080p.WEB.h264-GRP",
    truth: { title: "Space Odyssey Part 2", year: 2022 },
  },

  // Separators and punctuation.
  {
    name: "The Long Voyage (2021) 1080p BluRay x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The Long Voyage (2021) [1080p] [BluRay] [5.1] [YTS.MX]",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The_Long_Voyage_2021_1080p_BluRay_x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.[2021].1080p.BluRay.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "Mr.Smiths.Journey.2020.1080p.WEB.h264-GRP",
    truth: { title: "Mr Smiths Journey", year: 2020 },
  },
  {
    name: "Spider-Folk.Across.Worlds.2023.1080p.WEB-DL.DDP5.1.H.264-GRP",
    truth: { title: "Spider-Folk Across Worlds", year: 2023 },
  },
  {
    name: "The.Thing's.Return.2018.720p.BluRay.x264-GRP",
    truth: { title: "The Thing's Return", year: 2018 },
  },
  {
    name: "Une.Histoire.d'Été.2020.1080p.WEB.h264-GRP",
    truth: { title: "Une Histoire d'Été", year: 2020 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.BluRay.x264",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "the.long.voyage.2021.1080p.bluray.x264-grp",
    truth: { title: "The Long Voyage", year: 2021 },
  },

  // French and multi-language releases.
  {
    name: "Le.Grand.Depart.2022.FRENCH.1080p.WEB.H264-GRP",
    truth: { title: "Le Grand Depart", year: 2022 },
  },
  {
    name: "Le.Grand.Depart.2022.TRUEFRENCH.1080p.BluRay.x264-GRP",
    truth: { title: "Le Grand Depart", year: 2022 },
  },
  {
    name: "Le.Grand.Depart.2022.MULTi.1080p.BluRay.x264-GRP",
    truth: { title: "Le Grand Depart", year: 2022 },
  },
  {
    name: "Le.Grand.Depart.2022.MULTi.VFF.1080p.BluRay.x265-GRP",
    truth: { title: "Le Grand Depart", year: 2022 },
  },
  {
    name: "Le.Grand.Depart.2022.MULTi.VFQ.1080p.WEB.H265-GRP",
    truth: { title: "Le Grand Depart", year: 2022 },
  },
  {
    name: "Le.Grand.Depart.2022.MULTi.VF2.1080p.BluRay.x264-GRP",
    truth: { title: "Le Grand Depart", year: 2022 },
  },
  {
    name: "Le.Grand.Depart.2022.MULTi.VFF.VFQ.2160p.UHD.BluRay.x265.HDR-GRP",
    truth: { title: "Le Grand Depart", year: 2022 },
  },
  {
    name: "Le.Grand.Depart.2022.VFQ.1080p.WEB-DL.DDP5.1.H264-GRP",
    truth: { title: "Le Grand Depart", year: 2022 },
  },
  {
    name: "Le.Grand.Depart.2022.VQC.720p.WEB.x264-GRP",
    truth: { title: "Le Grand Depart", year: 2022 },
  },
  {
    name: "Le.Grand.Depart.2022.VFI.1080p.WEB.x264-GRP",
    truth: { title: "Le Grand Depart", year: 2022 },
  },
  {
    name: "Le.Grand.Depart.2022.VOSTFR.1080p.WEB.x264-GRP",
    truth: { title: "Le Grand Depart", year: 2022 },
  },
  {
    name: "Le.Grand.Depart.2022.FRENCH.HDLight.1080p.x264.AC3-GRP",
    truth: { title: "Le Grand Depart", year: 2022 },
  },
  {
    name: "The.Long.Voyage.2021.MULTi.TRUEFRENCH.1080p.BluRay.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.GERMAN.DL.1080p.BluRay.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.iTALiAN.1080p.WEB.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.SPANISH.1080p.WEB.x264-GRP",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "Le.Grand.Depart.2022.MULTi.1080p.WEB.H264-GRP.mkv",
    truth: { title: "Le Grand Depart", year: 2022 },
  },

  // Movies with no year or odd layout.
  {
    name: "The.Long.Voyage.1080p.BluRay.x264-GRP",
    truth: { title: "The Long Voyage" },
  },
  { name: "The Long Voyage", truth: { title: "The Long Voyage" } },
  {
    name: "The Long Voyage 2021",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The Long Voyage (2021)",
    truth: { title: "The Long Voyage", year: 2021 },
  },

  // Shapes the existing parsers special-case.
  {
    name: "Ocean's.8.2018.1080p.BluRay.x264-GRP",
    truth: { title: "Ocean's 8", year: 2018 },
  },
  {
    name: "Fast.&.Loud.Road.2015.720p.WEB.x264-GRP",
    truth: { title: "Fast & Loud Road", year: 2015 },
  },
  {
    name: "Summer.of.1985.2020.1080p.WEB.h264-GRP",
    truth: { title: "Summer of 1985", year: 2020 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.WEB-DL.DDP5.1.H.264-RARBG",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.BluRay.x264-SomeLongGroupName",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.HDTV.x264-GRP.ts",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "Élan.Vital.2019.1080p.WEB.h264-GRP",
    truth: { title: "Élan Vital", year: 2019 },
  },
];

export const TV_RELEASES: ReleaseNameCase[] = [
  // Single episodes.
  {
    name: "Quiet.Harbor.S01E01.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1] },
  },
  {
    name: "Quiet.Harbor.S01E01.720p.HDTV.x264-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1] },
  },
  {
    name: "Quiet.Harbor.S01E01.2160p.WEB-DL.DDP5.1.DV.HDR.H.265-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1] },
  },
  {
    name: "Quiet.Harbor.S03E12.1080p.AMZN.WEB-DL.DDP5.1.H.264-GRP",
    truth: { title: "Quiet Harbor", season: 3, episodes: [12] },
  },
  {
    name: "Quiet.Harbor.S10E101.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 10, episodes: [101] },
  },
  {
    name: "Quiet.Harbor.s02e05.720p.web.h264-grp",
    truth: { title: "Quiet Harbor", season: 2, episodes: [5] },
  },
  {
    name: "Quiet Harbor - S02E05 - Episode Name (1080p WEB-DL)",
    truth: { title: "Quiet Harbor", season: 2, episodes: [5] },
  },
  {
    name: "Quiet.Harbor.S02E05.Episode.Name.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 2, episodes: [5] },
  },
  {
    name: "Quiet.Harbor.S02E05.PROPER.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 2, episodes: [5] },
  },
  {
    name: "Quiet.Harbor.S02E05.REPACK.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 2, episodes: [5] },
  },
  {
    name: "Quiet_Harbor_S02E05_1080p_WEB_h264-GRP",
    truth: { title: "Quiet Harbor", season: 2, episodes: [5] },
  },
  {
    name: "Quiet.Harbor.S02E05.1080p.WEB.h264-GRP.mkv",
    truth: { title: "Quiet Harbor", season: 2, episodes: [5] },
  },
  {
    name: "Quiet.Harbor.S02E05.1080p.WEB.h264-GRP.Sample",
    truth: { title: "Quiet Harbor", season: 2, episodes: [5] },
  },

  // NxNN style.
  {
    name: "Quiet.Harbor.1x02.HDTV.XviD-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [2] },
  },
  {
    name: "Quiet Harbor 2x05 720p HDTV x264-GRP",
    truth: { title: "Quiet Harbor", season: 2, episodes: [5] },
  },
  {
    name: "Quiet.Harbor.12x103.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 12, episodes: [103] },
  },

  // Multi-episode.
  {
    name: "Quiet.Harbor.S01E01E02.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1, 2] },
  },
  {
    name: "Quiet.Harbor.S01E01-E03.720p.HDTV.x264-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1, 2, 3] },
  },
  {
    name: "Quiet.Harbor.S01E01-03.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1, 2, 3] },
  },
  {
    name: "Quiet.Harbor.S01E01.E02.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1, 2] },
  },
  {
    name: "Quiet.Harbor.4x04-05.HDTV.x264-GRP",
    truth: { title: "Quiet Harbor", season: 4, episodes: [4, 5] },
  },

  // Season packs.
  {
    name: "Quiet.Harbor.S02.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 2, seasonPack: true },
  },
  {
    name: "Quiet.Harbor.S02.COMPLETE.1080p.BluRay.x264-GRP",
    truth: { title: "Quiet Harbor", season: 2, seasonPack: true },
  },
  {
    name: "Quiet.Harbor.Season.2.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 2, seasonPack: true },
  },
  {
    name: "Quiet Harbor Season 2 Complete 720p WEB-DL",
    truth: { title: "Quiet Harbor", season: 2, seasonPack: true },
  },
  {
    name: "Quiet.Harbor.Saison.2.FRENCH.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 2, seasonPack: true },
  },
  {
    name: "Quiet.Harbor.Stagione.2.iTALiAN.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 2, seasonPack: true },
  },
  {
    name: "Quiet.Harbor.S02.MULTi.VFF.1080p.WEB.H265-GRP",
    truth: { title: "Quiet Harbor", season: 2, seasonPack: true },
  },
  {
    name: "Quiet.Harbor.S02.720p.HDTV.x264-GRP",
    truth: { title: "Quiet Harbor", season: 2, seasonPack: true },
  },
  {
    name: "Quiet.Harbor.S02.2160p.WEB-DL.DDP5.1.HDR.H.265-GRP",
    truth: { title: "Quiet Harbor", season: 2, seasonPack: true },
  },
  {
    name: "Quiet.Harbor.S10.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 10, seasonPack: true },
  },

  // Titles with years and numbers.
  {
    name: "Quiet.Harbor.2019.S01E01.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", year: 2019, season: 1, episodes: [1] },
  },
  {
    name: "Quiet.Harbor.(2019).S01E01.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", year: 2019, season: 1, episodes: [1] },
  },
  // A country qualifier is part of the show's title here.
  {
    name: "Quiet.Harbor.US.S01E01.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor US", season: 1, episodes: [1] },
  },
  {
    name: "Quiet.Harbor.2019.S02.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", year: 2019, season: 2, seasonPack: true },
  },
  {
    name: "1923.S01E03.1080p.WEB.h264-GRP",
    truth: { title: "1923", season: 1, episodes: [3] },
  },
  {
    name: "Station.19.S05E04.1080p.WEB.h264-GRP",
    truth: { title: "Station 19", season: 5, episodes: [4] },
  },
  {
    name: "The.100.S03E07.720p.HDTV.x264-GRP",
    truth: { title: "The 100", season: 3, episodes: [7] },
  },
  {
    name: "9-1-1.S06E02.1080p.WEB.h264-GRP",
    truth: { title: "9-1-1", season: 6, episodes: [2] },
  },
  {
    name: "From.S02E01.1080p.WEB.h264-GRP",
    truth: { title: "From", season: 2, episodes: [1] },
  },
  {
    name: "Quiet.Harbor.S01E01.1080p.10bit.WEB.x265-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1] },
  },

  // French TV.
  {
    name: "Quiet.Harbor.S01E01.FRENCH.1080p.WEB.H264-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1] },
  },
  {
    name: "Quiet.Harbor.S01E01.MULTi.VFQ.1080p.WEB.H265-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1] },
  },
  {
    name: "Quiet.Harbor.S01E01.VOSTFR.1080p.WEB.H264-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1] },
  },

  // Daily shows.
  {
    name: "Evening.Report.2024.01.15.1080p.WEB.h264-GRP",
    truth: { title: "Evening Report", airDate: "2024-01-15" },
  },
  {
    name: "Evening.Report.2024-01-15.720p.HDTV.x264-GRP",
    truth: { title: "Evening Report", airDate: "2024-01-15" },
  },
  {
    name: "Evening Report 2024 01 15 Guest Name 1080p WEB h264-GRP",
    truth: { title: "Evening Report", airDate: "2024-01-15" },
  },

  // Anime and absolute numbering.
  {
    name: "[SubGroup] Starfall Saga - 12 (1080p) [ABCD1234].mkv",
    truth: { title: "Starfall Saga", episodes: [12] },
  },
  {
    name: "[SubGroup] Starfall Saga - 112 [1080p][HEVC]",
    truth: { title: "Starfall Saga", episodes: [112] },
  },
  {
    name: "[SubGroup] Starfall Saga S2 - 05 (1080p)",
    truth: { title: "Starfall Saga", season: 2, episodes: [5] },
  },
  {
    name: "[SubGroup] Starfall Saga - S01E05 [1080p]",
    truth: { title: "Starfall Saga", season: 1, episodes: [5] },
  },

  // Multi-season and whole-series packs.
  {
    name: "Quiet.Harbor.S01-S03.1080p.WEB.h264-GRP",
    truth: {
      title: "Quiet Harbor",
      season: 1,
      seasons: [1, 2, 3],
      seasonPack: true,
    },
  },
  {
    name: "Quiet.Harbor.S03-S04.720p.HDTV.x264-GRP",
    truth: {
      title: "Quiet Harbor",
      season: 3,
      seasons: [3, 4],
      seasonPack: true,
    },
  },
  {
    name: "Quiet Harbor Seasons 1-3 1080p WEB-DL",
    truth: {
      title: "Quiet Harbor",
      season: 1,
      seasons: [1, 2, 3],
      seasonPack: true,
    },
  },
  {
    name: "Quiet.Harbor.Complete.Series.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", completeSeries: true },
  },
  {
    name: "Quiet.Harbor.The.Complete.Series.720p.BluRay.x264-GRP",
    truth: { title: "Quiet Harbor", completeSeries: true },
  },
  {
    name: "Quiet.Harbor.COMPLETE.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", completeSeries: true },
  },
  {
    name: "Quiet.Harbor.Integrale.FRENCH.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", completeSeries: true },
  },
  {
    name: "Quiet Harbor Season 02 (Complete) 1080p WEB-DL",
    truth: { title: "Quiet Harbor", season: 2, seasonPack: true },
  },
  {
    name: "Quiet.Harbor.Series.2.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 2, seasonPack: true },
  },

  // Episode shapes and look-alikes.
  {
    name: "Quiet.Harbor.S01E01-720p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1] },
  },
  {
    name: "Quiet.Harbor.S01E01-10bit.WEB.x265-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1] },
  },
  {
    name: "Quiet.Harbor.S01E01.10bit.WEB.x265-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1] },
  },
  {
    name: "Quiet.Harbor.S01E01-5.1.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1] },
  },
  {
    name: "Quiet.Harbor.S01E01-S01E02.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1, 2] },
  },
  {
    name: "Quiet.Harbor.S03E04.S03E05.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 3, episodes: [4, 5] },
  },
  {
    name: "Quiet.Harbor.3x04-3x06.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 3, episodes: [4, 5, 6] },
  },
  {
    name: "Quiet.Harbor.S03E06-60fps.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 3, episodes: [6] },
  },
  {
    name: "quiet.harbor.s01e01e02.720p.hdtv.x264-grp",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1, 2] },
  },
  {
    name: "Quiet.Harbor.Season.2.E05.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 2, episodes: [5] },
  },
  {
    name: "Quiet Harbor Season 2 Episode 3 720p WEB-DL",
    truth: { title: "Quiet Harbor", season: 2, episodes: [3] },
  },
  {
    name: "Quiet.Harbor.S00E01.Special.1080p.WEB.h264-GRP",
    truth: { title: "Quiet Harbor", season: 0, episodes: [1] },
  },
  {
    name: "Quiet.Harbor.S02E04.1080p.NF.WEB-DL.DDP5.1.H.264-GRP",
    truth: { title: "Quiet Harbor", season: 2, episodes: [4] },
  },
  {
    name: "Été.Indien.S01E02.FRENCH.1080p.WEB.h264-GRP",
    truth: { title: "Été Indien", season: 1, episodes: [2] },
  },
];

/** On-disk file names as they reach the importer / rescan (with extensions). */
export const FILE_NAMES: ReleaseNameCase[] = [
  {
    name: "The.Long.Voyage.2021.1080p.BluRay.x264-GRP.mkv",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The Long Voyage (2021).mkv",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The Long Voyage (2021) [Bluray-1080p].mkv",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The Long Voyage (2021) [2160p HDR10+ DV].mkv",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.2160p.UHD.BluRay.x265.HDR10+.mkv",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.WEB-DL.DDP5.1.H.264-GRP.mkv",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "The.Long.Voyage.2021.1080p.BluRay.10bit.x265-GRP.mkv",
    truth: { title: "The Long Voyage", year: 2021 },
  },
  {
    name: "1917.2019.1080p.BluRay.x264-GRP.mkv",
    truth: { title: "1917", year: 2019 },
  },
  {
    name: "Blade.Runner.2049.2017.2160p.UHD.BluRay.x265-GRP.mkv",
    truth: { title: "Blade Runner 2049", year: 2017 },
  },
  {
    name: "Le.Grand.Depart.2022.MULTi.VFQ.1080p.WEB.H265-GRP.mkv",
    truth: { title: "Le Grand Depart", year: 2022 },
  },
  {
    name: "Quiet.Harbor.S01E01.1080p.WEB.h264-GRP.mkv",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1] },
  },
  {
    name: "Quiet Harbor - S01E01 - Pilot.mkv",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1] },
  },
  {
    name: "Quiet Harbor - 1x01 - Pilot.mkv",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1] },
  },
  {
    name: "Quiet.Harbor.S01E01E02.1080p.WEB.h264-GRP.mkv",
    truth: { title: "Quiet Harbor", season: 1, episodes: [1, 2] },
  },
  {
    name: "Quiet.Harbor.S01E05.Part.1.1080p.WEB.h264-GRP.mkv",
    truth: { title: "Quiet Harbor", season: 1, episodes: [5] },
  },
  {
    name: "Quiet.Harbor.S01E05.Part.2.1080p.WEB.h264-GRP.mkv",
    truth: { title: "Quiet Harbor", season: 1, episodes: [5] },
  },
  {
    name: "Quiet Harbor (2019) - S02E03 - Name [WEBDL-1080p][EAC3 5.1][h264]-GRP.mkv",
    truth: { title: "Quiet Harbor", year: 2019, season: 2, episodes: [3] },
  },
  {
    name: "quiet.harbor.s02e03.720p.hdtv.x264-grp.mkv",
    truth: { title: "Quiet Harbor", season: 2, episodes: [3] },
  },
  {
    name: "Evening.Report.2024.01.15.1080p.WEB.h264-GRP.mkv",
    truth: { title: "Evening Report", airDate: "2024-01-15" },
  },
];

export const ALL_RELEASE_NAMES: ReleaseNameCase[] = [
  ...MOVIE_RELEASES,
  ...TV_RELEASES,
  ...FILE_NAMES,
];
