# TV Tracker 📺

An app to track the shows I've watched, I'm watching and let me know when episodes are coming out.
Think Letterboxd × TV Forecast: no limits on how many shows you track, and every show keeps its progress.

This branch (`main`) is the **web app** version. It installs on iPhone, iPad and Mac like a native app (no Safari UI)
and is hosted for free on GitHub Pages.

## Features

- **Find any show.** Search with posters, plus an "Airing Today" shelf. Add a Trakt key to also get Trending and Most Anticipated shelves.
- **Seasons & episodes** with numbers, names, air dates and community ratings for each episode.
- **Statuses:** Watching, Rewatching, Watchlist, Finished. Rewatching tracks a fresh run without losing your first watch.
- **Mark episodes watched** one at a time, a whole season, or **"Watched up to here"** from any episode.
  Tap an episode or long-press it. The ✓ button in *My Shows* marks the next episode.
- **Always see where you are.** Every show shows its last watched episode, what's next and how many are left.
  You don't have to "follow" a show to see this.
- **Lists:** build as many lists as you like, mixing watchlist and followed shows. You can reorder them and give each one an emoji.
- **Ratings:** half-star ratings (Letterboxd style) for whole shows and for single episodes. They sit next to the
  TVmaze score, and next to IMDb, Rotten Tomatoes, Metacritic and Trakt scores if you add the free keys.
- **Upcoming:** a calendar of new episodes and season premieres. It also lists seasons that have been announced without a date yet.
- **Notifications & news** for:
  - an episode airing within 24 hours
  - an episode that's out now
  - a **new season announced**, with its premiere date once one is set
  - a premiere date that changes
- **Add to Calendar:** exports your schedule as `.ics` with alerts, so iOS Calendar reminds you even when the app is closed.
- **Profile:** stats, a ratings histogram, favorites and a watch diary.
- **Import from Trakt / TV Forecast:** TV Forecast syncs with Trakt, so you can import your watched history,
  watchlist and ratings from a public Trakt profile.
- **Backups:** export and import a JSON file, for example to move your data to another device.
- Follows Apple's Human Interface Guidelines:
  - system font and colours, large titles, inset grouped lists, sheets and action sheets
  - Dark Mode, safe areas and Reduce Motion
  - a sidebar on iPad and Mac
  - swipe from the left edge to go back
  - 7 accent colours to choose from

## Data sources

| Source | Used for | Key needed |
| --- | --- | --- |
| [TVmaze](https://www.tvmaze.com/api) | Search, shows, seasons, episodes, posters, schedules, ratings | No |
| [Trakt](https://trakt.docs.apiary.io) | Trakt ratings, Trending/Anticipated, importing history | Free Client ID ([create app](https://trakt.tv/oauth/applications/new)) |
| [OMDb](https://www.omdbapi.com) | IMDb, Rotten Tomatoes, Metacritic scores | Free API key |

You enter the keys in **Profile → Data sources & import**. They're stored only on your device.

## Hosting on GitHub Pages (one-time setup)

1. Open the repository on GitHub and go to **Settings → Pages**.
2. Under **Build and deployment**:
   - set **Source** to *Deploy from a branch*
   - set **Branch** to `main` and the folder to `/ (root)`
   - press **Save**.
3. After a minute the app is live at `https://<your-username>.github.io/<repo-name>/`.

## Installing it

- **iPhone / iPad:** open the URL in Safari, tap **Share**, then **Add to Home Screen**.
  To get notifications, open it from the Home Screen and turn them on in *Upcoming* or *Profile*. This needs iOS 16.4 or later.
- **Mac:** open the URL in Safari, then choose **File → Add to Dock** (macOS Sonoma or later).

## Good to know (web-app limitations)

- **Notifications:** the app checks your shows each time it opens or comes back to the foreground. If anything changed, it
  notifies you and updates the badge. A web app can't wake itself up in the background without a push server.
  Use **Add schedule to Calendar** for reminders that work even when the app is closed.
  Native local notifications are planned for the native iOS/macOS version.
- **Storage:** your data lives on each device separately. Use **Export backup / Import backup** to move it between devices.
  iCloud sync is planned for the native version.

## Development

The app is plain HTML/CSS/JavaScript ES modules. There is no build step, and [Preact + htm](https://github.com/developit/htm)
is vendored in `js/vendor/`.

```sh
python3 -m http.server 8080   # then open http://localhost:8080
```

```
index.html, manifest.webmanifest, sw.js   app shell, install metadata, offline/notification service worker
css/app.css                               all styling (HIG tokens, light/dark)
js/app.js                                 router, tab bar/sidebar, boot
js/store.js                               your data (localStorage): statuses, watched episodes, ratings, lists
js/sync.js                                refresh, new-episode/season detection, notifications, .ics export
js/api/                                   TVmaze, Trakt, OMDb clients (cached in IndexedDB)
js/views/                                 screens: My Shows, Upcoming, Discover, Lists, Profile, Show detail
```

When you change app files, bump `VERSION` in `sw.js` so installed copies pick up the update.

Show data © [TVmaze](https://www.tvmaze.com), licensed CC BY-SA.
