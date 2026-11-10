const IS_PRODUCTION =
  window.location.hostname === 'fplwizard.pages.dev';

const BASE = IS_PRODUCTION
  ? 'https://fplcomanager.andreashuvenaars.workers.dev'
  : 'https://fplcomanager-preview.andreashuvenaars.workers.dev';
export async function api(path){const r=await fetch(BASE+path,{headers:{Accept:'application/json'},cache:'no-store'});if(!r.ok){let d='';try{d=(await r.json()).detail||''}catch{}throw new Error(`${r.status} ${d}`.trim())}return r.json()}
async function allPlayers(){
  // The Worker clamps every /players request to 75 results. First obtain a broad seed
  // across all four positions, then query each discovered club separately. Club squads
  // are safely below 75, so this produces the complete current FPL player universe.
  const positions=['GK','DEF','MID','FWD'];
  const seedPages=await Promise.all(positions.map(position=>api(`/players?position=${position}&limit=75&sort=minutes`)));
  const seeds=seedPages.flatMap(page=>page?.players||[]);
  const teams=[...new Set(seeds.map(player=>player.team).filter(Boolean))].sort();
  const clubPages=await Promise.all(teams.map(team=>api(`/players?team=${encodeURIComponent(team)}&limit=75&sort=minutes`)));
  const unique=new Map();
  for(const page of clubPages) for(const player of (page?.players||[])) unique.set(Number(player.id),player);
  return {players:[...unique.values()],teams,teamCount:teams.length};
}
export const endpoints={gameweek:()=>api('/gameweek'),manager:id=>api(`/manager?manager_id=${id}`),managerHistory:id=>api(`/manager/history?manager_id=${id}`),squad:(id,gw)=>api(`/manager/squad/${gw}?manager_id=${id}`),fixtures:()=>api('/fixtures'),players:allPlayers,player:id=>api(`/player/${id}`),teamStrength:(season,recent=6)=>api(`/team-strength?season=${encodeURIComponent(season)}&recent=${recent}`),historicalPlayers:seasons=>api(`/historical/players?seasons=${encodeURIComponent(seasons)}`)};
