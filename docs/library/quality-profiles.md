# Quality profiles

A quality profile tells Rawkoon which releases are allowed and which allowed
release is preferred. Profiles are used when you search from a Library item,
when Rawkoon evaluates RSS candidates, and when you choose the default profile
for new media.

Create them in **Settings → Quality profiles**. Set the default profile in
**Settings → Library**, then override it on an individual movie or show when
needed.

## Hard rules and preferences

Some choices reject a release. Others only improve its score.

| Control | Effect |
| --- | --- |
| Minimum resolution | Rejects releases below the selected resolution. |
| Resolution cutoff | Rejects releases above the selected resolution; leave it unset for no ceiling. |
| Require HDR | Rejects releases without an HDR marker. |
| Preferred languages | Rejects a release when its title has no matching audio-language marker. |
| Maximum size | Rejects a release above the configured size. |
| Minimum seeders | Rejects a release below the threshold when the indexer reports a seeder count. |
| Required/forbidden custom formats | Enforces conditions you define for a release title or parsed quality. |

Preferred source, codec, HDR, tracker, and custom-format scores rank releases
that have already passed those rules. A preferred value is not a requirement
unless it is represented by a required custom format.

## Create a usable first profile

Start narrow enough to avoid unwanted files, but not so narrow that searches
return nothing:

1. Choose the minimum resolution you actually want to keep.
2. Leave the resolution cutoff empty unless you need to reject higher-quality
   releases.
3. Add preferred sources and codecs in order of preference.
4. Set language, HDR, size, and seeder requirements only when your indexers
   consistently expose those details.
5. Save, add a test title, and inspect the release results before relying on
   RSS automation.

Use a separate profile for materially different needs, such as a compact 1080p
library and a larger 4K library.

## Trackers and custom formats

You can order preferred trackers. By default, tracker order is a tie-breaker;
the option to prefer a tracker over quality gives it more weight.

Custom formats are reusable named conditions. Assign one to a profile with a
positive or negative score, or mark it required or forbidden. A custom format
matches only when all of its conditions match, so start with a small, easily
verified condition set.

## When a release is not selectable

Interactive search displays a rejected candidate when a hard profile rule
fails. Check the profile before assuming an integration is broken:

- lower the minimum resolution or remove an unintended ceiling;
- loosen a language, HDR, size, or seeder requirement;
- review required and forbidden custom formats; or
- use a different profile for that title.

Manual searches reset a title’s failed-search counter and allow you to retry a
previously skipped item.
