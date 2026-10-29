# Library interchange schema

A versioned JSON file holding a user's whole library: titles with their watch events nested inside. The web app's import/export (LIB-420) and the macOS app's export (LIB-422) both read and write this format. The source of truth is `lib/library-schema.ts`; `parseLibraryFile` validates a file and rejects unknown formats, unknown versions and bad values.

Unknown fields are rejected at every object level; validation errors include the object path and unknown field names. `schemaVersion` must be bumped whenever a field is added, including nested fields.

Duplicate titles (same `tmdbId` + `kind`) and duplicate event `uid`s anywhere within one file are rejected. Errors report every duplicate occurrence after the first with its path; no partial file is imported.

## Envelope

| Field           | Type   | Notes                                     |
| --------------- | ------ | ----------------------------------------- |
| `format`        | string | Always `"ryuuji-library"`.                |
| `schemaVersion` | number | `1`. Bump whenever a field is added or on any breaking change.         |
| `exportedAt`    | string | ISO 8601 date-time.                       |
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

`providerData` caches one region: `region`, ISO `fetchedAt`, subscription `providers`, `rent`, `buy`, and nullable TMDB watch-page `link`. Each provider has `id`, `name`, nullable `logoPath`, and `displayPriority`. `rent` and `buy` default to empty arrays when omitted, preserving version 1 compatibility with existing web and macOS files. Only subscription providers match My services badges; another region’s cache is hidden. Region and service preferences stay in localStorage, outside the interchange file. Streaming data is supplied by JustWatch through TMDB.

## Watch event

`uid`, `watchedAt`, `season`, `episode`, `tmdbEpisodeId`, `batchId`. `uid` and `batchId` are UUIDs. A movie watch has `null` season and episode. Events belong to the title they're nested in.

## Example

```json
{
  "format": "ryuuji-library",
  "schemaVersion": 1,
  "exportedAt": "2026-10-28T09:30:00Z",
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
