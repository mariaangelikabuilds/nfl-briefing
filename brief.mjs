import { readFile, writeFile, mkdir } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { renderPage } from "./page.mjs";

const SEASON = 2026;
const TEAM_ID = "4";
const TEAM_ABBR = "CIN";
const PRE_WINDOW_MS = 48 * 3600 * 1000;
const STATE_PATH = "data/state.json";
const PAGE_PATH = "docs/index.html";
const UA = { "User-Agent": "Mozilla/5.0 (briefing; personal, twice daily)" };

async function fetchJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function flattenWeek(weekJson, week) {
  const days = Object.values(weekJson.content?.schedule ?? {});
  return days.flatMap((day) => day.games.map((g) => ({ ...g, week })));
}

async function fetchSeason() {
  const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
  const perWeek = await Promise.all(
    weeks.map((w) => fetchJson(`https://cdn.espn.com/core/nfl/schedule?xhr=1&year=${SEASON}&week=${w}`).then((j) => flattenWeek(j, w)))
  );
  return perWeek.flat();
}

function compactGame(g) {
  const comp = g.competitions[0];
  const side = (ha) => comp.competitors.find((c) => c.homeAway === ha);
  const team = (c) => ({
    id: c.team.id,
    abbr: c.team.abbreviation,
    name: c.team.displayName,
    score: comp.status.type.completed ? Number(c.score) : null,
    winner: c.winner ?? null,
    record: c.records?.[0]?.summary ?? null,
  });
  const leaders = (comp.leaders ?? []).map((l) => ({
    stat: l.name,
    line: l.leaders?.[0]?.displayValue ?? null,
    player: l.leaders?.[0]?.athlete?.displayName ?? null,
    team: l.leaders?.[0]?.team?.abbreviation ?? null,
  }));
  const odds = comp.odds?.[0];
  const w = g.weather;
  return {
    id: g.id,
    week: g.week,
    kickoff: g.date,
    timeValid: comp.timeValid !== false,
    state: comp.status.type.state,
    clock: comp.status.type.state === "in" ? `${comp.status.displayClock ?? ""} Q${comp.status.period ?? ""}` : null,
    weather: w ? { text: w.displayValue, tempF: w.temperature ?? w.highTemperature ?? null, tempC: Number.isFinite(w.temperature ?? w.highTemperature) ? Math.round(((w.temperature ?? w.highTemperature) - 32) * 5 / 9) : null } : null,
    moneyline: odds?.moneyline ? { away: odds.moneyline.away?.close?.odds ?? null, home: odds.moneyline.home?.close?.odds ?? null } : null,
    detail: comp.status.type.shortDetail,
    final: Boolean(comp.status.type.completed),
    home: team(side("home")),
    away: team(side("away")),
    line: comp.odds?.[0]?.details ?? null,
    overUnder: comp.odds?.[0]?.overUnder ?? null,
    venue: comp.venue?.fullName ?? null,
    city: comp.venue?.address?.city ?? null,
    tv: [...new Set([...(comp.broadcasts ?? []).flatMap((b) => b.names ?? [b.media?.shortName]), ...(comp.geoBroadcasts ?? []).map((b) => b.media?.shortName)].filter(Boolean))],
    leaders: comp.status.type.completed ? leaders : [],
  };
}

const involves = (g) => g.home.id === TEAM_ID || g.away.id === TEAM_ID;

async function fetchDivision() {
  const json = await fetchJson("https://cdn.espn.com/core/nfl/standings?xhr=1");
  const conferences = json.content.standings.groups;
  const division = conferences.flatMap((c) => c.groups).find((d) => d.standings.entries.some((e) => e.team.id === TEAM_ID));
  const stat = (e, name) => e.stats.find((s) => s.name === name)?.displayValue ?? null;
  return {
    name: division.name,
    rows: division.standings.entries.map((e) => ({
      abbr: e.team.abbreviation,
      name: e.team.displayName,
      wins: stat(e, "wins"),
      losses: stat(e, "losses"),
      ties: stat(e, "ties"),
      streak: stat(e, "streak"),
      diff: stat(e, "differential") ?? stat(e, "pointDifferential"),
    })),
  };
}

async function fetchConference() {
  const json = await fetchJson("https://cdn.espn.com/core/nfl/standings?xhr=1");
  const conf = json.content.standings.groups.find((c) => c.groups.some((d) => d.standings.entries.some((e) => e.team.id === TEAM_ID)));
  const stat = (e, name) => e.stats.find((s) => s.name === name)?.displayValue ?? null;
  return {
    name: conf.name,
    groups: conf.groups.map((d) => ({
      name: d.name,
      rows: d.standings.entries.map((e) => ({
        abbr: e.team.abbreviation,
        name: e.team.displayName,
        wins: stat(e, "wins"),
        losses: stat(e, "losses"),
        ties: stat(e, "ties"),
        streak: stat(e, "streak"),
        diff: stat(e, "differential") ?? stat(e, "pointDifferential"),
      })),
    })),
  };
}

const PLAYER_LINE = {
  passing: (st) => `${st[0]}, ${st[1]} yds, ${st[3]} TD, ${st[4]} INT`,
  rushing: (st) => `${st[0]} car, ${st[1]} yds, ${st[3]} TD`,
  receiving: (st) => `${st[0]} rec, ${st[1]} yds, ${st[3]} TD`,
};

async function fetchBoxscore(gameId) {
  const json = await fetchJson(`https://cdn.espn.com/core/nfl/boxscore?xhr=1&gameId=${gameId}`);
  const box = json.gamepackageJSON?.boxscore;
  if (!box?.teams?.length) return null;
  const teams = box.teams.map((t) => ({ abbr: t.team.abbreviation, stats: Object.fromEntries(t.statistics.map((s) => [s.name, s.displayValue])) }));
  const players = Object.fromEntries(
    (box.players ?? []).map((side) => [
      side.team.abbreviation,
      Object.fromEntries(
        side.statistics
          .filter((cat) => PLAYER_LINE[cat.name])
          .map((cat) => [cat.name, cat.athletes.slice(0, 3).map((a) => ({ name: a.athlete.displayName, line: PLAYER_LINE[cat.name](a.stats) }))])
      ),
    ])
  );
  return { teams, players };
}

async function fetchNews(teamId) {
  const json = await fetchJson(`https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/news?team=${teamId}&limit=8`);
  return (json.articles ?? []).map((a) => ({
    headline: a.headline,
    summary: a.description ?? null,
    published: a.published,
    url: a.links?.web?.href ?? null,
  }));
}

const Briefing = z.object({
  pregame: z
    .object({
      matchup_read: z.string(),
      storylines: z.array(z.string()).min(1).max(4),
      watch_for: z.array(z.string()).min(2).max(3),
      the_call: z.string(),
    })
    .nullable(),
  postgame: z
    .object({
      what_decided_it: z.string(),
      standouts: z.array(z.string()).min(1).max(3),
      division_meaning: z.string(),
      the_take: z.string(),
    })
    .nullable(),
  league: z.object({ lines: z.array(z.string()).min(3).max(6) }),
});

const SYSTEM = `You write a private twice-daily Cincinnati Bengals briefing for Banjo. He lives in Perth, follows the NFL closely, and knows the game, so skip the basics and talk to him like a sharp beat writer sharing notes before and after each game.

Rules.
Every statement must trace to a field in the facts JSON you are given. If the facts do not support a claim, leave it out. Never invent injuries, quotes, or motives. If a news headline is the only source, attribute it as a headline.
Plain words, no hype, no filler. Short sentences. No em dashes. Do not use the words robust, comprehensive, seamless, elevate, unlock, delve, leverage, or landscape.
Pregame: matchup_read is the shape of the game in two or three sentences. storylines come from the news and records. watch_for is two or three concrete things to keep an eye on during the game. the_call is one committed prediction with a reason, stated as an opinion he can argue with.
Postgame: what_decided_it is the honest read of why it went the way it went. standouts name players with their actual lines. division_meaning is the AFC North picture. the_take is one opinion worth a text message, grounded in the facts.
Kickoff times in the facts are already converted to Perth time. Use them as given. A kickoff marked "time not set yet" has no confirmed time; say so rather than guessing.
Every number you write (scores, yards, records, lines, totals) must appear in the facts exactly. Do not round, add, or infer numbers.
The league lines are about the rest of the league; the Bengals game is covered elsewhere on the page, so do not repeat it.
The facts carry two flags. Write the pregame section only when write_pregame is true, otherwise return null for it. Write the postgame section only when write_postgame is true, otherwise return null for it. Always write the league lines.
Keep each string under 220 characters. The league lines cover the rest of the week around the league, three to six of them, most consequential first.`;

function needs(season, state, now) {
  const mine = season.filter(involves);
  const next = mine.filter((g) => !g.final && new Date(g.kickoff) > now).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))[0] ?? null;
  const last = mine.filter((g) => g.final).sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff))[0] ?? null;
  const kept = state.briefing ?? {};
  const hasPre = kept.pregame && kept.pregame_for === next?.id;
  const hasPost = kept.postgame && kept.postgame_for === last?.id;
  const preDue = next && new Date(next.kickoff) - now <= PRE_WINDOW_MS && !hasPre;
  const postDue = last && !hasPost;
  const finals = season.filter((g) => g.final).map((g) => g.id).sort();
  const newFinals = JSON.stringify(finals) !== JSON.stringify(state.finals ?? []);
  return { next, last, preDue: Boolean(preDue), postDue: Boolean(postDue), finals, newFinals };
}

const perth = (iso) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));

const perthDay = (iso) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));

function withPerth(g) {
  if (!g) return null;
  return { ...g, kickoff_perth: g.timeValid ? perth(g.kickoff) : `${perthDay(g.kickoff)}, time not set yet` };
}

async function askClaude(facts) {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(facts) }],
    output_config: { format: zodOutputFormat(Briefing), effort: "medium" },
  });
  console.log(`claude stop=${res.stop_reason} in=${res.usage.input_tokens} out=${res.usage.output_tokens}`);
  if (res.stop_reason === "refusal") throw new Error("model refused the briefing request");
  if (res.stop_reason === "max_tokens") throw new Error("briefing truncated at max_tokens");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = Briefing.safeParse(JSON.parse(text));
  if (!parsed.success) {
    await writeFile("data/last-raw.txt", text);
    throw new Error(`briefing failed validation, raw saved to data/last-raw.txt: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
  }
  return parsed.data;
}

async function main() {
  const now = new Date();
  const state = JSON.parse(await readFile(STATE_PATH, "utf8").catch(() => "{}"));
  const season = (await fetchSeason()).map(compactGame);
  const division = await fetchDivision();
  const conference = await fetchConference();
  const { next, last, preDue, postDue, finals, newFinals } = needs(season, state, now);
  const weekOf = (g) => season.filter((x) => x.week === g.week && !involves(x));
  const currentWeek = (next ?? last)?.week ?? 1;

  const mustWrite = preDue || postDue || newFinals || !state.briefing;
  const box = last ? await fetchBoxscore(last.id).catch(() => null) : null;
  const opponentNews = next ? await fetchNews(next.home.id === TEAM_ID ? next.away.id : next.home.id).catch(() => []) : [];
  const bengalsNews = await fetchNews(TEAM_ID).catch(() => []);
  const facts = {
    now_perth: perth(now.toISOString()),
    bengals_next: withPerth(next),
    bengals_last: withPerth(last),
    write_pregame: preDue,
    write_postgame: postDue,
    division,
    last_game_boxscore: box,
    news_bengals: bengalsNews,
    news_opponent: opponentNews,
    league_week: currentWeek,
    league_games: season.filter((g) => g.week === currentWeek || g.week === currentWeek - 1).filter((g) => !involves(g)).map(withPerth),
  };

  const fresh = mustWrite ? await askClaude(facts) : null;
  const kept = state.briefing ?? {};
  const briefing = fresh
    ? {
        pregame: fresh.pregame ?? (kept.pregame_for === next?.id ? kept.pregame : null),
        pregame_for: next?.id ?? null,
        postgame: fresh.postgame ?? (kept.postgame_for === last?.id ? kept.postgame : null),
        postgame_for: last?.id ?? null,
        league: fresh.league,
      }
    : kept;

  const nextState = {
    finals,
    briefing,
    written_at: mustWrite ? now.toISOString() : state.written_at,
  };

  await mkdir("docs", { recursive: true });
  await mkdir("data", { recursive: true });
  const opponentName = next ? (next.home.id === TEAM_ID ? next.away.name : next.home.name) : "";
  await writeFile(PAGE_PATH, renderPage({ now, next: withPerth(next), last: withPerth(last), division, conference, box, news: { bengals: bengalsNews, opponent: opponentNews, opponentName }, week: currentWeek, briefing, writtenAt: nextState.written_at, season, teamAbbr: TEAM_ABBR }));
  await writeFile(STATE_PATH, JSON.stringify(nextState, null, 2) + "\n");
  await writeFile("data/last-facts.json", JSON.stringify(facts, null, 2) + "\n");
  console.log(`${mustWrite ? "wrote" : "kept"} briefing; pre=${preDue} post=${postDue} newFinals=${newFinals}; next=${next?.detail ?? "none"}; last=${last?.detail ?? "none"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
