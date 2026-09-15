// Page sections that are pure data rendering: the week's slate, standings, box score, headlines.
const esc = (s) => String(s ?? "").trim().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const perthTime = (iso) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", weekday: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).replace(",", "");

export function slateBlock(games, week, teamAbbr) {
  const rows = [...games]
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
    .map((g) => {
      const mine = g.home.abbr === teamAbbr || g.away.abbr === teamAbbr;
      const status = g.final ? "Final" : g.state === "in" ? esc(g.clock ?? "Live") : g.timeValid ? perthTime(g.kickoff) : "time TBD";
      const score = g.final || g.state === "in" ? `${g.away.score} : ${g.home.score}` : g.line ? esc(g.line) : "";
      return `<tr data-id="${g.id}"${mine ? ' class="me"' : ""}${g.state === "in" ? ' data-live="1"' : ""}>
        <td><span class="away">${esc(g.away.abbr)}</span> at <span class="home">${esc(g.home.abbr)}</span></td>
        <td class="score">${score}</td>
        <td class="status">${status}</td></tr>`;
    })
    .join("");
  return `<section class="card" id="slate" data-week="${week}">
    <h2>Week ${week} slate</h2>
    <p class="when">Every game this week, Perth time. Scores refresh when you open the page on game day.</p>
    <table class="slate"><tbody>${rows}</tbody></table>
  </section>`;
}

export function standingsBlock(conference, teamAbbr) {
  const divisions = conference.groups
    .map((d) => {
      const rows = d.rows
        .map((r) => `<tr${r.abbr === teamAbbr ? ' class="me"' : ""}><td>${esc(r.name)}</td><td>${esc(r.wins)}-${esc(r.losses)}${Number(r.ties) ? `-${esc(r.ties)}` : ""}</td><td>${esc(r.streak ?? "")}</td><td>${esc(r.diff ?? "")}</td></tr>`)
        .join("");
      return `<h3>${esc(d.name)}</h3><table><tbody>${rows}</tbody></table>`;
    })
    .join("");
  return `<section class="card"><h2>${esc(conference.name)}</h2>${divisions}</section>`;
}

const STAT_LABELS = [
  ["totalYards", "Total yards"],
  ["netPassingYards", "Passing yards"],
  ["rushingYards", "Rushing yards"],
  ["firstDowns", "First downs"],
  ["thirdDownEff", "Third downs"],
  ["turnovers", "Turnovers"],
  ["sacksYardsLost", "Sacked"],
  ["totalPenaltiesYards", "Penalties"],
  ["possessionTime", "Possession"],
];

export function boxscoreBlock(box, teamAbbr) {
  if (!box) return "";
  const [a, b] = box.teams;
  const rows = STAT_LABELS.filter(([k]) => a.stats[k] != null || b.stats[k] != null)
    .map(([k, label]) => `<tr><td>${esc(a.stats[k] ?? "")}</td><th scope="row">${label}</th><td>${esc(b.stats[k] ?? "")}</td></tr>`)
    .join("");
  const mine = box.players[teamAbbr] ?? {};
  const lines = ["passing", "rushing", "receiving"]
    .filter((cat) => mine[cat]?.length)
    .map((cat) => `<h3>${cat[0].toUpperCase()}${cat.slice(1)}</h3><ul class="lines">${mine[cat].map((p) => `<li><b>${esc(p.name)}</b> ${esc(p.line)}</li>`).join("")}</ul>`)
    .join("");
  return `<section class="card"><h2>Box score</h2>
    <table class="box"><thead><tr><th>${esc(a.abbr)}</th><th></th><th>${esc(b.abbr)}</th></tr></thead><tbody>${rows}</tbody></table>
    ${lines}
  </section>`;
}

export function headlinesBlock(bengals, opponent, opponentName) {
  const item = (a) => `<li><a href="${esc(a.url ?? "#")}" rel="noopener">${esc(a.headline)}</a>${a.summary ? `<span>${esc(a.summary)}</span>` : ""}</li>`;
  const opp = opponent.length ? `<h3>${esc(opponentName)}</h3><ul class="news">${opponent.slice(0, 3).map(item).join("")}</ul>` : "";
  return `<section class="card"><h2>Headlines</h2><ul class="news">${bengals.slice(0, 6).map(item).join("")}</ul>${opp}</section>`;
}

// Runs in the browser: refreshes the slate and the countdown without waiting for the next cron run.
export const LIVE_SCRIPT = `
(function(){
  var slate=document.getElementById('slate'); if(!slate) return;
  var week=slate.dataset.week;
  var fmt=function(iso){return new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Perth',weekday:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(iso)).replace(',','')};
  var apply=function(games){games.forEach(function(g){var c=g.competitions[0];var row=slate.querySelector('tr[data-id="'+g.id+'"]');if(!row)return;var away=c.competitors.find(function(x){return x.homeAway==='away'});var home=c.competitors.find(function(x){return x.homeAway==='home'});var st=c.status.type;var live=st.state==='in';row.classList.toggle('live',live);if(st.state!=='pre'){row.querySelector('.score').textContent=away.score+' : '+home.score;row.querySelector('.status').textContent=st.completed?'Final':(c.status.displayClock+' Q'+c.status.period)}else if(c.timeValid!==false){row.querySelector('.status').textContent=fmt(g.date)}});var note=document.getElementById('slate-note');if(note)note.textContent='Scores refreshed '+new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Perth',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date())+' Perth.'};
  var flat=function(s){return Object.keys(s).reduce(function(a,k){return a.concat(s[k].games)},[])};
  fetch('https://cdn.espn.com/core/nfl/schedule?xhr=1&year=2026&week='+week).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(j){return flat(j.content.schedule)})
    .catch(function(){return fetch('https://the-slate-psi.vercel.app/api/week?week='+week).then(function(r){return r.json()}).then(flat)})
    .then(apply).catch(function(){});
  var cd=document.getElementById('countdown'); if(!cd) return;
  var kick=new Date(cd.dataset.kick).getTime();
  var tick=function(){var d=kick-Date.now();if(d<=0){cd.textContent='kicked off';return}var m=Math.floor(d/60000),days=Math.floor(m/1440),h=Math.floor(m%1440/60),mm=m%60;cd.textContent='kicks off in '+(days?days+'d ':'')+h+'h '+mm+'m'};
  tick(); setInterval(tick,60000);
})();`;
