# nfl-briefing

A page that rewrites itself twice a day during the NFL season: the next Cincinnati Bengals game in Perth time with the line and the storylines, the last result with who decided it, the AFC North table, and a few lines from around the league. Written for one reader who wants to talk about the games with someone who follows them closely.

How it runs: a GitHub Actions cron at 00:00 and 12:00 UTC fetches ESPN's public schedule, standings, and news feeds, asks Claude for the written parts (grounded only in those feeds), renders `public/index.html`, and commits it. Vercel serves the committed page. No servers.

Run locally with `ANTHROPIC_API_KEY` set:

    npm ci
    node brief.mjs

`data/state.json` remembers which games already have a pre-game and post-game write-up, so the model is only called when something new happened. `data/last-facts.json` is the exact input the last write-up was grounded in.
