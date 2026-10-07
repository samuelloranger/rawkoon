# AI release picks

Rawkoon can ask a language model to choose between the releases a quality
profile already accepts. It is optional: with no AI provider, or whenever the
model can't help, the classic scorer picks exactly as it always has.

Configure it in **Settings → AI**.

## Where the model is asked

| Switch | When it runs |
| --- | --- |
| RSS auto-grab | A new release in an indexer feed matches a wanted movie or episode. |
| Scheduled & upgrade searches | Scheduled release checks, upgrade searches, and **Search** on a Library item. |
| Interactive search suggestion | Interactive search shows a suggested release with its reasoning. You still choose what to grab. |
| Book grabs | Wanted-edition searches, **Search** on a book, format upgrades, and book RSS matches. |

The model is only asked when at least two grabbable releases remain after the
profile's hard rules, the blocklist, and dead torrents (zero seeders) have been
filtered out. It sees at most the ten best-scored candidates.

## How it chooses

For movies and TV, the model discards releases for the wrong season or episode
and low-quality captures (CAM, TS, screeners), prefers the profile's preferred
audio languages in order, then follows the profile score and breaks ties by
seeders.

For books, it also discards the wrong title, series volume or author, the wrong
format kind (ebook versus audiobook), a clearly different language than the
edition's, and abridged, sample or summary releases.

Its answer is checked before it is used: a pick that isn't one of the offered
releases is ignored. If the request fails, times out (30 seconds), is
rate-limited, or the daily budget is spent, the classic scorer's choice is
grabbed instead. Grabs chosen by the model are marked as AI picks in download
history.

## What is sent to the provider

- the title, year and type of the movie or show, the target season and
  episode, and the profile's preferred audio languages;
- for books, the title, authors, series and position, wanted format kind, and
  edition language;
- for each candidate release: its title, size, seeders, profile score and, for
  books, parsed format, language and bitrate.

Download links are never sent. They often carry tracker API keys, so each
candidate is given an opaque id (`r0`, `r1`, …) that Rawkoon maps back itself.
If you use a hosted provider, release titles and the titles in your library are
shared with it; use a local server (llama.cpp, Ollama) to keep them on your
network.

## Provider settings

Any OpenAI-compatible endpoint works: a local llama.cpp or Ollama server, or a
hosted one such as Groq. Set the base URL, the model, and an API key for hosted
providers. The key is encrypted at rest like other integration secrets, and is
removed from any provider error Rawkoon records.

| Setting | Effect |
| --- | --- |
| Input / output price | USD per million tokens. Only used to estimate cost on the AI page. |
| Daily budget | When today's estimated spend reaches it, automatic grabs use the classic scorer until midnight UTC. Needs at least one price. |
| Features | Turns the model off for one place without disabling the provider. |

## Usage and history

The AI page records every request to the provider, including failed ones:

- calls, success rate, tokens, estimated cost, and median and 95th-percentile
  latency, for the last 7, 30, 90 or 365 days;
- how often the model picked a different release than the classic scorer;
- breakdowns by feature, trigger and model;
- failure rates of AI-picked grabs compared with classic grabs;
- a filterable history of each call, with the picked release, the classic
  choice, and the model's reasoning.

Calls skipped because the budget was spent are counted separately and do not
count against the success rate.
