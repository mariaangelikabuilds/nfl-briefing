const esc = (s) => String(s ?? "").trim().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function scoreline(g, teamAbbr) {
  const mine = g.home.abbr === teamAbbr ? g.home : g.away;
  const them = g.home.abbr === teamAbbr ? g.away : g.home;
  const verb = mine.winner ? "beat" : mine.score === them.score ? "tied" : "lost to";
  return `${mine.abbr} ${mine.score} ${verb} ${them.abbr} ${them.score}`;
}

function resultTag(g, teamAbbr) {
  const mine = g.home.abbr === teamAbbr ? g.home : g.away;
  const them = g.home.abbr === teamAbbr ? g.away : g.home;
  const tag = mine.winner ? "W" : mine.score === them.score ? "T" : "L";
  return `${tag} ${mine.score}-${them.score}`;
}

function matchupLine(g, teamAbbr) {
  const home = g.home.abbr === teamAbbr;
  const them = home ? g.away : g.home;
  return `${home ? "vs" : "at"} ${them.name}${them.record ? ` (${them.record})` : ""}`;
}

function nextBlock(next, pregame, teamAbbr) {
  if (!next) return `<section class="card"><h2>Next game</h2><p>No Bengals game left on the schedule.</p></section>`;
  const facts = [
    `<dt>Kickoff</dt><dd>${esc(next.kickoff_perth)} Perth</dd>`,
    next.line ? `<dt>Line</dt><dd>${esc(next.line)}${next.overUnder ? `, total ${esc(next.overUnder)}` : ""}</dd>` : "",
    next.venue ? `<dt>Where</dt><dd>${esc(next.venue)}${next.city ? `, ${esc(next.city)}` : ""}</dd>` : "",
    next.tv.length ? `<dt>TV (US)</dt><dd>${esc(next.tv.join(", "))}</dd>` : "",
  ].join("");
  const body = pregame
    ? `<p class="lead">${esc(pregame.matchup_read)}</p>
       <ul>${pregame.storylines.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
       <h3>Ask him</h3>
       <ol>${pregame.questions_for_banjo.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>`
    : `<p class="muted">Briefing lands within two days of kickoff.</p>`;
  return `<section class="card">
    <h2>Next: ${esc(matchupLine(next, teamAbbr))}</h2>
    <dl class="facts">${facts}</dl>
    ${body}
  </section>`;
}

function lastBlock(last, postgame, teamAbbr) {
  if (!last) return "";
  const leaders = last.leaders.filter((l) => l.player).map((l) => `<li><b>${esc(l.player)}</b> ${esc(l.line)}</li>`).join("");
  const body = postgame
    ? `<p class="lead">${esc(postgame.what_decided_it)}</p>
       <ul>${postgame.standouts.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
       <p>${esc(postgame.division_meaning)}</p>
       <h3>Ask him</h3>
       <p class="q">${esc(postgame.question_for_banjo)}</p>`
    : `<p class="muted">Recap lands on the next run.</p>`;
  return `<section class="card">
    <h2>Last: ${esc(scoreline(last, teamAbbr))}</h2>
    <p class="when">Week ${last.week}, ${esc(last.kickoff_perth)} Perth</p>
    ${leaders ? `<ul class="leaders">${leaders}</ul>` : ""}
    ${body}
  </section>`;
}

function divisionBlock(division, teamAbbr) {
  const rows = division.rows
    .map((r) => `<tr${r.abbr === teamAbbr ? ' class="me"' : ""}><td>${esc(r.name)}</td><td>${esc(r.wins)}-${esc(r.losses)}${Number(r.ties) ? `-${esc(r.ties)}` : ""}</td><td>${esc(r.streak ?? "")}</td></tr>`)
    .join("");
  return `<section class="card"><h2>${esc(division.name)}</h2><table><tbody>${rows}</tbody></table></section>`;
}

function leagueBlock(league) {
  return `<section class="card"><h2>Around the league</h2><ul>${league.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></section>`;
}

function scheduleBlock(season, teamAbbr) {
  const mine = season.filter((g) => g.home.abbr === teamAbbr || g.away.abbr === teamAbbr).sort((a, b) => a.week - b.week);
  const rows = mine
    .map((g) => {
      const result = g.final ? resultTag(g, teamAbbr) : g.kickoff_perth ?? "";
      return `<tr class="${g.final ? "done" : ""}"><td>${g.week}</td><td>${esc(matchupLine(g, teamAbbr))}</td><td>${esc(result)}</td></tr>`;
    })
    .join("");
  return `<section class="card"><h2>Bengals season</h2><table><tbody>${rows}</tbody></table></section>`;
}

const perth = (d) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(d));

export function renderPage({ now, next, last, division, briefing, writtenAt, season, teamAbbr }) {
  const perthDay = (d) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", weekday: "short", day: "numeric", month: "short" }).format(new Date(d));
  const seasonPerth = season.map((g) => ({ ...g, kickoff_perth: g.timeValid ? perth(g.kickoff) : `${perthDay(g.kickoff)}, time TBD` }));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Bengals briefing</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,800&family=IBM+Plex+Sans:wght@400;600&display=swap" rel="stylesheet">
<style>
  :root { --orange: #FB4F14; --ink: #141210; --paper: #f6f1ea; --line: #2a2622; --muted: #b9b0a6; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--ink); color: var(--paper); font: 17px/1.5 "IBM Plex Sans", system-ui, sans-serif; padding: 0 16px 48px; }
  main { max-width: 640px; margin: 0 auto; }
  header { padding: 28px 0 8px; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  header h1 { font: 800 clamp(34px, 9vw, 48px)/1 "Bricolage Grotesque", sans-serif; letter-spacing: -0.02em; margin: 0; color: var(--orange); }
  header time { color: var(--muted); font-size: 14px; }
  .card { border-top: 2px solid var(--orange); padding: 20px 0 8px; margin-top: 20px; }
  h2 { font: 800 clamp(22px, 6vw, 28px)/1.15 "Bricolage Grotesque", sans-serif; margin: 0 0 12px; letter-spacing: -0.01em; }
  h3 { font: 600 15px/1.3 "IBM Plex Sans", sans-serif; margin: 20px 0 6px; color: var(--orange); }
  .lead { font-size: 19px; }
  .muted { color: var(--muted); }
  .when { color: var(--muted); margin: -6px 0 12px; font-size: 15px; }
  .q { font-size: 19px; font-weight: 600; }
  dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0 0 16px; }
  dl.facts dt { color: var(--muted); }
  dl.facts dd { margin: 0; }
  ul, ol { padding-left: 22px; margin: 8px 0; }
  li { margin: 6px 0; }
  ul.leaders { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0 0 14px; font-size: 15px; }
  table { width: 100%; border-collapse: collapse; font-size: 15px; }
  td { padding: 8px 6px 8px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
  td:last-child { text-align: right; white-space: nowrap; }
  tr.me td { color: var(--orange); font-weight: 600; }
  tr.done td { color: var(--muted); }
  footer { color: var(--muted); font-size: 13px; margin-top: 40px; }
  a { color: inherit; }
</style>
</head>
<body>
<main>
  <header>
    <h1>Bengals briefing</h1>
    <time datetime="${esc(now.toISOString())}">checked ${esc(perth(now))} Perth</time>
  </header>
  ${nextBlock(next, briefing.pregame, teamAbbr)}
  ${lastBlock(last, briefing.postgame, teamAbbr)}
  ${divisionBlock(division, teamAbbr)}
  ${leagueBlock(briefing.league)}
  ${scheduleBlock(seasonPerth, teamAbbr)}
  <footer>Briefing written ${esc(perth(writtenAt))} Perth. Scores and schedule from ESPN's public feeds; times in Perth (AWST). Written for Angel, twice a day.</footer>
</main>
</body>
</html>
`;
}
