# Library interchange schema

A versioned JSON file holding a user's whole library: titles with their watch events nested inside. The web app's import/export (LIB-420) and the macOS app's export (LIB-422) both read and write this format. The source of truth is `lib/library-schema.ts`; `parseLibraryFile` validates a file and rejects unknown formats, unknown versions and bad values.

Unknown fields are rejected at every object level; validation errors include the object path and unknown field names. Breaking changes require a schema version bump. Version 1 also accepts optional non-secret settings.

Duplicate titles (same `tmdbId` + `kind`) and duplicate event `uid`s anywhere within one file are rejected. Errors report every duplicate occurrence after the first with its path; no partial file is imported.

## Envelope

| Field           | Type   | Notes                                     |
| --------------- | ------ | ----------------------------------------- |
| `format`        | string | Always `"ryuuji-library"`.                |
| `schemaVersion` | number | `1`. Bump on breaking changes.         |
| `exportedAt`    | string | ISO 8601 date-time.                       |
| `settings`      | object | Optional theme and watch preferences; see below. |
| `titles`        | array  | Title objects, each with `watchEvents`.   |

## Title

Fields mirror the macOS `Title` model (`SchemaV2`). Raw values match the Swift enums:

- `kind`: `movie`, `show`
- `status`: `planToWatch`, `watching`, `rewatching`, `caughtUp`, `onHold`, `dropped`, `completed`
- `showStatus`: `Returning Series`, `Ended`, `Canceled`, `In Production`, `Planned`, `Pilot`, `Unknown`

Differences from the macOS storage:

- `kindRaw`, `statusRaw`, `showStatusRaw` are named `kind`, `status`, `showStatus`.
- `episodesData` and `providerDataJSON` are the decoded objects `episodes` (`EpisodeMetadata`) and `providerData` (`WatchProviderData`), or `null` when empty.
- All dates are ISO 8601 strings, including `providerData.fetchedAt`. `releaseDate` and `airDate` stay `yyyy-MM-dd`.
- Optional fields may be `null` or omitted; omitted ones read as `null`.

## Watch providers

`providerData` caches one region: `region`, ISO `fetchedAt`, subscription `providers`, `rent`, `buy`, and nullable TMDB watch-page `link`. Each provider has `id`, `name`, nullable `logoPath`, and `displayPriority`. `rent` and `buy` default to empty arrays when omitted, preserving version 1 compatibility with existing web and macOS files. Only subscription providers match My services badges; another region’s cache is hidden. Region and service preferences are included in optional `settings.watch`. Streaming data is supplied by JustWatch through TMDB.

## Watch event

`uid`, `watchedAt`, `season`, `episode`, `tmdbEpisodeId`, `batchId`. `uid` and `batchId` are UUIDs. A movie watch has `null` season and episode. Events belong to the title they're nested in.

## Example

```json
{
  "format": "ryuuji-library",
  "schemaVersion": 1,
  "exportedAt": "2026-10-28T09:30:00Z",
  "settings": { "theme": "system", "watch": { "region": "US", "services": [1899] } },
  "titles": [
    {
      "tmdbId": 1399,
      "kind": "show",
      "name": "Game of Thrones",
      "originalName": "Game of Thrones",
      "overview": "Seven noble families fight for control of the mythical land of Westeros.",
      "posterPath": "/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg",
      "releaseDate": "2011-04-17",
      "genres": ["Sci-Fi & Fantasy", "Drama"],
      "originCountries": ["US"],
      "originalLanguage": "en",
      "runtime": null,
      "isAnime": false,
      "showStatus": "Ended",
      "episodes": {
        "schemaVersion": 1,
        "seasons": [
          {
            "number": 1,
            "name": "Season 1",
            "episodes": [
              { "tmdbId": 63056, "season": 1, "number": 1, "name": "Winter Is Coming", "airDate": "2011-04-17", "runtime": 62 }
            ]
          }
        ]
      },
      "metadataRevision": 3,
      "lastRefreshedAt": "2026-10-27T18:00:00Z",
      "providerData": {
        "region": "US",
        "fetchedAt": "2026-10-27T18:00:00Z",
        "providers": [{ "id": 1899, "name": "Max", "logoPath": "/max.jpg", "displayPriority": 1 }],
        "link": "https://www.themoviedb.org/tv/1399/watch?locale=US"
      },
      "status": "watching",
      "score": 9,
      "notes": "",
      "addedAt": "2026-10-01T20:15:00Z",
      "watchEvents": [
        {
          "uid": "3f1c2a9e-8b7d-4c6e-9a51-2d0f4e6b7c81",
          "watchedAt": "2026-10-02T21:00:00Z",
          "season": 1,
          "episode": 1,
          "tmdbEpisodeId": 63056,
          "batchId": null
        }
      ]
    },
    {
      "tmdbId": 129,
      "kind": "movie",
      "name": "Spirited Away",
      "originalName": "千と千尋の神隠し",
      "overview": "",
      "releaseDate": "2001-07-20",
      "genres": ["Animation", "Family", "Fantasy"],
      "originCountries": ["JP"],
      "originalLanguage": "ja",
      "runtime": 125,
      "isAnime": true,
      "metadataRevision": 0,
      "status": "planToWatch",
      "notes": "",
      "addedAt": "2026-10-20T08:00:00Z",
      "watchEvents": []
    }
  ]
}
```

## Web import and backup

Imports validate the entire strict file before opening a write transaction. Titles match by
TMDB id and kind; event UIDs match across the entire library. A conflicting event UID
keeps the existing event and is reported separately in preview. Confirmation recomputes
against current data under the watch-log lock, then commits both stores atomically.

Merge rule: keep the newer status, score, and notes. The current Title schema has no
per-title user modification timestamp, and local storage has no separate title modification
record. `addedAt` is creation time, `lastRefreshedAt` and `providerData.fetchedAt` describe
metadata caches, and event `watchedAt` is viewing time; none represents a title edit.
Consequently there are no comparable modification times in version 1: imports are treated
as newer. Incoming status (including `planToWatch`), non-null score (including zero), and
non-blank notes win. Null scores and blank notes never erase local values. No title fields
are added for timestamp tracking. If modification times become available, compare per-title
times first; otherwise compare file `exportedAt` with the local title modification time.
Metadata fills only null, empty string, or empty array fields; false booleans, revision
numbers, added dates, and refresh timestamps remain unchanged. Preview lists every changed
title field (old → new) and every differing discarded value with its field and reason.
Preview counts changed existing titles as “to merge”; identical titles are “unchanged”.
Re-importing identical data performs no puts/adds and leaves metadataRevision unchanged.

Changed titles (including titles with added events) enter the metadata scheduler's separate
localStorage queue. Refresh retries offline/failed work and uses the existing metadata
refresh path to remap history. Export does not clear cached timestamps or revisions.
Backups use deterministic title/key and event/UID ordering and a consistent read transaction.
Optional `settings` is a strict object with optional `theme` (`system`, `light`, `dark`)
and optional `watch` (strict object with `region`, a two-letter uppercase country code,
and `services`, an array of nonnegative integer provider IDs). Omitted watch members use
the app defaults (US and an empty service list). Export includes current preferences;
preview lists settings changes. Import restores only supplied settings after the library
transaction commits, using the app setters and change events. Missing settings leave local
preferences unchanged. The macOS exporter may omit settings. Passcodes, tokens, credentials,
and other secrets are never exported or restored; unknown settings keys are rejected.
