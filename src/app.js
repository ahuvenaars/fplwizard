import{endpoints}from'./api.js';import{project,bestLineup}from'./models.js';import{load,save,planFor}from'./store.js';
const DEBUG_MODE=new URLSearchParams(window.location.search).get('debug')==='1';
const $=s=>document.querySelector(s),db=load();const state={managerId:9588528,gw:null,events:[],manager:null,baseSquad:[],baseSquadGameweek:null,players:[],details:{},fixtures:[],plan:null,projections:{},selected:null,transferOut:null,transferAddPosition:null,reviewGw:null,reviewSquad:null,reviewDetails:{},switchingId:null,performanceHistory:[],teamStrength:null,teamStrengthByTeam:new Map(),previousPlayersByCode:new Map(),seasonTransitionReady:false,multiProjections:{},predictionLog:[],activeView:'planner',freeHitPlan:null,freeHitProjections:{},transferWorkspace:'planner',transferTop15Only:false,freeHitSaveError:'',currentTeamBenchmark:null,freeHitRequest:0,readOnlyPlayerMenu:false,freeHitLastValidPlan:null};
let firstPlanIntegrityIssue=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
async function boot(){inspectStoredPlannerPlans();try{const[g,m,fx,ps]=await Promise.all([endpoints.gameweek(),endpoints.manager(state.managerId),endpoints.fixtures(),endpoints.players()]);state.manager=m;state.fixtures=fx;state.players=ps.players;if((ps.teamCount||0)!==20||state.players.length<400)$('#alerts').innerHTML=`<div class="alert">Player universe check: ${state.players.length} players across ${ps.teamCount||0} clubs. Expected 20 clubs.</div>`;state.completedEvents=g.events.filter(x=>x.finished).slice(-8).reverse();state.events=g.events.filter(x=>!x.finished).slice(0,6);state.gw=state.events[0]?.id||g.next_gameweek?.id||m.current_gameweek;$('#teamName').textContent=m.team_name;renderSummary();renderGwNav();setupReview();await openGw(state.gw);loadPerformance().catch(()=>{});loadTeamStrength().catch(()=>{});loadSeasonTransition().catch(()=>{});refreshCompletedGameweeks().catch(()=>{})}catch(err){$('#alerts').innerHTML=`<div class="alert">${esc(err.message)}</div>`}}
function inspectPlanIntegrity(plan,label){
 const playerIds=(Array.isArray(plan?.players)?plan.players:[]).map(player=>Number(player?.player_id)),starterIds=(Array.isArray(plan?.starters)?plan.starters:[]).map(Number),benchIds=(Array.isArray(plan?.bench)?plan.bench:[]).map(Number);
 const duplicates=ids=>ids.filter((id,index)=>ids.indexOf(id)!==index);
 const result={players:playerIds,playerDuplicates:[...new Set(duplicates(playerIds))],starters:starterIds,starterDuplicates:[...new Set(duplicates(starterIds))],bench:benchIds,benchDuplicates:[...new Set(duplicates(benchIds))],overlap:starterIds.filter(id=>benchIds.includes(id))};
 console.log(`[PLAN INTEGRITY] ${label}`,result);
 if(!firstPlanIntegrityIssue&&(result.playerDuplicates.length||result.starterDuplicates.length||result.benchDuplicates.length||result.overlap.length)){firstPlanIntegrityIssue=label;console.error(`[PLAN INTEGRITY] First duplicate detected at ${label}`,result)}
}
function inspectStoredPlannerPlans(){
 for(const [managerId,manager] of Object.entries(db.managers||{}))for(const [gw,plan] of Object.entries(manager?.plans||{}))inspectPlanIntegrity(plan,`loaded from storage manager ${managerId} GW${gw}`);
}
function showPlannerRepairNotice(message){
 const notice=document.createElement('div');notice.className='alert planner-repair-alert';notice.textContent=message;$('#alerts').append(notice);
}
function renderSummary(){
 const m=state.manager,bank=state.plan?plannedBank():Number(m.bank||0),ranks=(state.performanceHistory||[]).filter(row=>Number.isFinite(row.rank)&&row.rank>0),previous=ranks.at(-2),latest=ranks.at(-1),movement=previous&&latest?previous.rank-latest.rank:0,trend=movement?`<span class="rank-trend ${movement>0?'improved':'declined'}" aria-label="${movement>0?'Improved':'Dropped'} ${Math.abs(movement).toLocaleString()} places from GW${previous.gw} to GW${latest.gw}" title="${movement>0?'Improved':'Dropped'} ${Math.abs(movement).toLocaleString()} places from GW${previous.gw} to GW${latest.gw}">${movement>0?'↑':'↓'}</span>`:'';
 $('#summary').innerHTML=`<div class="stat"><b>${Number(m.overall_rank||0).toLocaleString()}${trend}</b><span>Overall rank</span></div><div class="stat"><b>£${Number(m.team_value||0).toFixed(1)}m</b><span>Budget</span></div><div class="stat"><b>£${bank.toFixed(1)}m</b><span>${state.plan?.transfers?.length?'Planned bank':'Bank'}</span></div>`
}
function renderGwNav(){$('#gwNav').innerHTML=state.events.map(e=>`<button data-gw="${e.id}" class="${e.id===state.gw?'active':''}">GW${e.id}</button>`).join('');$('#gwNav').onclick=e=>{const b=e.target.closest('[data-gw]');if(b){const gw=Number(b.dataset.gw);if(state.activeView==='freehit')openFreeHit(gw);else openGw(gw)}}}
function firstPlanningGw(){return Number(state.events?.[0]?.id||state.gw||1)}
function currentActualFreeTransfers(manager=state.manager){
  const m=manager||{};
  const candidates=[m.free_transfers,m.transfers_available,m.free_transfers_available,m.bank_free_transfers];
  const found=candidates.find(v=>Number.isFinite(Number(v))&&Number(v)>=0);
  return Math.max(1,Math.min(5,Number(found??1)));
}
function rolledFreeTransfers(gw,plans=db.managers?.[state.managerId]?.plans||{},first=firstPlanningGw(),manager=state.manager){
  let ft=currentActualFreeTransfers(manager);
  if(Number(gw)<=first)return ft;
  for(let week=first;week<Number(gw);week++){
    const plan=plans[week],used=Number(plan?.transfers?.length||0);
    const start=week===first?currentActualFreeTransfers(manager):ft;
    ft=Math.min(5,Math.max(1,start-used+1));
  }
  return ft;
}
async function openGw(gw){
 clearSwitchMode();state.gw=Number(gw);renderGwNav();$('#lineupTitle').textContent=`Gameweek ${gw}`;
 let squadSource;try{squadSource=await endpoints.squad(state.managerId,Math.min(gw,state.manager.current_gameweek))}catch{squadSource=await endpoints.squad(state.managerId,state.manager.current_gameweek)}
 const officialSquad=squadSource?.squad;
 inspectPlanIntegrity({players:officialSquad,starters:(officialSquad||[]).filter(player=>Number(player.position_order)<=11).map(player=>player.player_id),bench:(officialSquad||[]).filter(player=>Number(player.position_order)>11).map(player=>player.player_id)},`official squad response GW${squadSource?.gameweek||gw}`);
 const squadErrors=officialSquadErrors(officialSquad);if(squadErrors.length)throw new Error(squadErrors[0]);
 state.baseSquad=officialSquad;state.baseSquadGameweek=Number(squadSource.gameweek||Math.min(gw,state.manager.current_gameweek));
 const officialBase=planFromOfficialSquad(Number(gw),squadSource,state.manager);
 inspectPlanIntegrity(officialBase,`constructed official Planner baseline GW${gw}`);
 const baseErrors=plannerIntegrityErrors(officialBase);if(baseErrors.length)throw new Error(`Official squad cannot form a valid Planner baseline: ${baseErrors[0]}`);
 let plans=db.managers?.[state.managerId]?.plans||{};const first=firstPlanningGw();let previous=Number(gw)>first?plans[Number(gw)-1]:null;
 if(previous&&plannerIntegrityErrors(previous).length){
  inspectPlanIntegrity(previous,`corrupt previous Planner plan GW${Number(gw)-1}`);
  const previousBase={...structuredClone(officialBase),gw:Number(gw)-1,transfers:[]},previousRecovery=rebuildPlannerPlan(previousBase,previous),recoveredDb=structuredClone(db);
  recoveredDb.managers[state.managerId].plans[Number(gw)-1]=previousRecovery.plan;
  inspectPlanIntegrity(previousRecovery.plan,`before saving repaired Planner plan GW${Number(gw)-1}`);
  if(save(recoveredDb)){
   for(const key of Object.keys(db))delete db[key];Object.assign(db,recoveredDb);plans=db.managers[state.managerId].plans;previous=plans[Number(gw)-1];
   showPlannerRepairNotice(`Invalid saved lineup for GW${Number(gw)-1} was repaired${previousRecovery.transfersPreserved?' with valid planned transfers':''}.`);
  }else{
   previous=null;showPlannerRepairNotice(`Invalid saved lineup for GW${Number(gw)-1} could not be saved as repaired; it was not used as a baseline.`);
  }
 }
 const stored=plans[gw];
 let base=officialBase;
 if(previous&&plannerIntegrityErrors(previous).length===0){
  const previousBank=Number(previous.endingBank??previous.startingBank??state.manager.bank);
  base={...structuredClone(previous),gw:Number(gw),startingBank:previousBank,endingBank:previousBank,transfers:[]};
 }
 if(stored&&plannerIntegrityErrors(stored).length===0){
  state.plan=stored;inspectPlanIntegrity(state.plan,`loaded valid Planner plan GW${gw}`);
 }else if(stored){
  inspectPlanIntegrity(stored,`corrupt stored Planner plan GW${gw}`);
  const recovery=rebuildPlannerPlan(base,stored);
  inspectPlanIntegrity(recovery.plan,`reconstructed Planner plan GW${gw}`);
  const recoveredDb=structuredClone(db);recoveredDb.managers??={};recoveredDb.managers[state.managerId]??={plans:{}};recoveredDb.managers[state.managerId].plans??={};recoveredDb.managers[state.managerId].plans[gw]=recovery.plan;
  inspectPlanIntegrity(recovery.plan,`before saving repaired Planner plan GW${gw}`);
  if(save(recoveredDb)){
   for(const key of Object.keys(db))delete db[key];Object.assign(db,recoveredDb);state.plan=db.managers[state.managerId].plans[gw];
   showPlannerRepairNotice(`Invalid saved lineup for GW${gw} was repaired${recovery.transfersPreserved?' with valid planned transfers':''}.`);
  }else{
   state.plan=base;showPlannerRepairNotice(`Invalid saved lineup for GW${gw} could not be saved as repaired; using a clean baseline for this session.`);
  }
 }else{
  state.plan=planFor(db,state.managerId,gw,base);inspectPlanIntegrity(state.plan,`loaded newly created Planner plan GW${gw}`);
 }
 state.plan.startingBank=Number(state.plan.startingBank??state.manager.bank??0);state.plan.transfers??=[];state.plan.freeTransfers=rolledFreeTransfers(gw);state.plan.endingBank=plannedBank();state.plan.hitPoints=transferCost().points;state.plan.nextFreeTransfers=Math.min(5,Math.max(1,Number(state.plan.freeTransfers||0)-state.plan.transfers.length+1));
 inspectPlanIntegrity(state.plan,`after Gameweek ${gw} plan load/recovery`);
 await hydrate();calculate();render();
}
function officialSquadErrors(squad){
 if(!Array.isArray(squad))return['Official squad response is missing its player list.'];
 const ids=squad.map(player=>Number(player?.player_id));
 const duplicates=ids.filter((id,index)=>ids.indexOf(id)!==index);
 const errors=[];
 if(squad.length!==15)errors.push(`Expected exactly 15 official players; received ${squad.length}.`);
 if(ids.some(id=>!Number.isSafeInteger(id)||id<1))errors.push('Official squad contains a missing or invalid player_id.');
 if(new Set(ids).size!==ids.length)errors.push(`Official squad contains duplicate player_id values: ${[...new Set(duplicates)].join(', ')}.`);
 const orders=squad.map(player=>Number(player?.position_order));
 if(orders.some(order=>!Number.isInteger(order)||order<1||order>15)||new Set(orders).size!==15)errors.push('Official squad position_order must contain each lineup position from 1 through 15 exactly once.');
 if(squad.filter(player=>player?.captain).length!==1||squad.filter(player=>player?.vice_captain).length!==1)errors.push('Official squad must identify exactly one captain and one vice-captain.');
 return errors;
}
function planFromOfficialSquad(gw,squadSource,manager){
 const errors=officialSquadErrors(squadSource?.squad);if(errors.length)throw new Error(errors[0]);
 const squad=squadSource.squad.map(player=>({...player})).sort((a,b)=>Number(a.position_order)-Number(b.position_order)),bank=Number(squadSource.bank??manager.bank??0);
 return{gw,sourceGameweek:Number(squadSource.gameweek||gw),startingBank:bank,endingBank:bank,players:squad,starters:squad.filter(player=>Number(player.position_order)<=11).map(player=>player.player_id),bench:squad.filter(player=>Number(player.position_order)>11).map(player=>player.player_id),captain:squad.find(player=>player.captain)?.player_id,vice:squad.find(player=>player.vice_captain)?.player_id,transfers:[]};
}
function rebuildPlannerPlan(base,stored){
 const clean=structuredClone(base),history=Array.isArray(stored?.transfers)?stored.transfers:[];
 clean.transfers=[];
 for(const transfer of history){
  const outId=Number(transfer?.out?.player_id),inId=Number(transfer?.in?.player_id),outIndex=clean.players.findIndex(player=>Number(player.player_id)===outId),incoming=transfer?.in;
  const lineupMatches=[...clean.starters,...clean.bench].filter(id=>Number(id)===outId).length;
  if(!Number.isSafeInteger(outId)||!Number.isSafeInteger(inId)||!incoming||outIndex<0||lineupMatches!==1||clean.players.some(player=>Number(player.player_id)===inId))return{plan:structuredClone(base),transfersPreserved:false};
  const outgoing=clean.players[outIndex];
  if(String(outgoing.position)!==String(incoming.position))return{plan:structuredClone(base),transfersPreserved:false};
  const replacement={...incoming,player_id:inId,position_order:outgoing.position_order};
  clean.players[outIndex]=replacement;
  clean.starters=clean.starters.map(id=>Number(id)===outId?inId:id);
  clean.bench=clean.bench.map(id=>Number(id)===outId?inId:id);
  if(Number(clean.captain)===outId)clean.captain=inId;
  if(Number(clean.vice)===outId)clean.vice=inId;
  clean.transfers.push({...transfer,out:structuredClone(outgoing),in:structuredClone(replacement)});
  if(plannerIntegrityErrors(clean).some(error=>error.includes('duplicate')||error.includes('more than once')||error.includes('exactly once')))return{plan:structuredClone(base),transfersPreserved:false};
 }
 const starters=clean.starters.map(Number);
 if(starters.includes(Number(stored?.captain)))clean.captain=Number(stored.captain);
 if(starters.includes(Number(stored?.vice)))clean.vice=Number(stored.vice);
 if(Number(clean.captain)===Number(clean.vice)){clean.captain=base.captain;clean.vice=base.vice}
 clean.startingBank=Number(stored?.startingBank??clean.startingBank);
 clean.freeTransfers=Number(stored?.freeTransfers??clean.freeTransfers??1);
 clean.endingBank=clean.startingBank+clean.transfers.reduce((sum,transfer)=>sum+Number(transfer.salePrice??transfer.out.price??0)-Number(transfer.buyPrice??transfer.in.price??0),0);
 clean.hitPoints=Math.max(0,clean.transfers.length-Math.max(0,clean.freeTransfers))*4;
 if(plannerIntegrityErrors(clean).length)return{plan:structuredClone(base),transfersPreserved:false};
 return{plan:clean,transfersPreserved:history.length>0&&clean.transfers.length===history.length};
}
async function syncCurrentTeam(){
 clearSwitchMode();
 const button=$('#syncCurrentTeam'),status=$('#syncStatus');
 button.disabled=true;button.textContent='Syncing…';status.className='sync-status';status.textContent='Refreshing official profile, squad, Gameweeks, fixtures, and players…';
 try{
  const[g,manager,fixtures,universe]=await Promise.all([endpoints.gameweek(),endpoints.manager(state.managerId),endpoints.fixtures(),endpoints.players()]);
  const events=g.events||[],gw=Number(events.find(event=>!event.finished)?.id||g.next_gameweek?.id||manager.current_gameweek);
  if(!Number.isInteger(gw)||gw<1||gw>38)throw new Error('Could not determine the current or next Gameweek.');
  if(!Array.isArray(universe?.players)||universe.teamCount!==20||universe.players.length<400)throw new Error(`The refreshed player universe is incomplete (${universe?.players?.length||0} players across ${universe?.teamCount||0} clubs).`);
  const squadGw=Math.min(gw,Number(manager.current_gameweek)||gw),squadSource=await endpoints.squad(state.managerId,squadGw),officialSquad=squadSource?.squad;
  inspectPlanIntegrity({players:officialSquad,starters:(officialSquad||[]).filter(player=>Number(player.position_order)<=11).map(player=>player.player_id),bench:(officialSquad||[]).filter(player=>Number(player.position_order)>11).map(player=>player.player_id)},`sync official squad response GW${squadSource?.gameweek||squadGw}`);
  const squadErrors=officialSquadErrors(officialSquad);if(squadErrors.length)throw new Error(squadErrors[0]);
  const officialGw=Number(squadSource.gameweek||squadGw);if(!Number.isInteger(officialGw)||officialGw<1||officialGw>38)throw new Error('The official squad response did not identify a valid source Gameweek.');
  const freshPlan=planFromOfficialSquad(gw,{...squadSource,gameweek:officialGw},manager);
  inspectPlanIntegrity(freshPlan,`sync constructed Planner baseline GW${gw}`);
  const planErrors=plannerIntegrityErrors(freshPlan);if(planErrors.length)throw new Error(`Official squad cannot form a valid Planner lineup: ${planErrors[0]}`);
  const playerIds=freshPlan.players.map(player=>Number(player.player_id));
  const freshDetails=Object.fromEntries(await Promise.all(playerIds.map(async id=>[id,await endpoints.player(id)])));
  const refreshedManager={...manager,bank:squadSource.bank??manager.bank},completedEvents=events.filter(event=>event.finished).slice(-8).reverse(),upcomingEvents=events.filter(event=>!event.finished).slice(0,6);
  const syncedDb=structuredClone(db);syncedDb.managers??={};syncedDb.managers[state.managerId]??={};syncedDb.managers[state.managerId].plans??={};
  const syncedPlans=syncedDb.managers[state.managerId].plans;
  for(const key of Object.keys(syncedPlans))if(Number(key)>gw)delete syncedPlans[key];
  freshPlan.freeTransfers=rolledFreeTransfers(gw,syncedPlans,Number(upcomingEvents[0]?.id||gw),refreshedManager);
  freshPlan.endingBank=freshPlan.startingBank;freshPlan.hitPoints=0;freshPlan.nextFreeTransfers=Math.min(5,Math.max(1,Number(freshPlan.freeTransfers||0)+1));
  inspectPlanIntegrity(freshPlan,`sync before saving Planner baseline GW${gw}`);
  const finalPlanErrors=plannerIntegrityErrors(freshPlan);if(finalPlanErrors.length)throw new Error(`Synced Planner baseline failed integrity validation: ${finalPlanErrors[0]}`);
  syncedPlans[gw]=freshPlan;
  if(!save(syncedDb))throw new Error('Could not save the refreshed Planner baseline to local storage; the existing Planner was not changed.');
  for(const key of Object.keys(db))delete db[key];Object.assign(db,syncedDb);
  state.manager=refreshedManager;state.fixtures=fixtures;state.players=universe.players;state.details={...state.details,...freshDetails};
  state.completedEvents=completedEvents;state.events=upcomingEvents;state.gw=gw;state.plan=syncedPlans[gw];state.baseSquad=state.plan.players.map(player=>({...player}));state.baseSquadGameweek=officialGw;
  $('#teamName').textContent=refreshedManager.team_name;$('#lineupTitle').textContent=`Gameweek ${gw}`;
  setupReview();renderGwNav();calculate();render();
  status.className='sync-status sync-success';
  status.textContent=`Official squad source: GW${officialGw}. Planner projections: GW${gw}. Synced at ${new Date().toLocaleString()}. Refreshed fixtures, ${state.players.length} players, and 1, 3 and 5 GW projections. The Planner baseline was rebuilt from the official squad; incompatible future Planner plans were cleared.`;
 }catch(error){status.className='sync-status sync-error';status.textContent=`Sync failed: ${error.message}`}
 finally{button.disabled=false;button.textContent='Sync current team'}
}
async function hydrate(){const ids=state.plan.players.map(p=>p.player_id);await Promise.allSettled(ids.map(async id=>{if(!state.details[id])state.details[id]=await endpoints.player(id)}))}
function fixture(p){const f=state.fixtures.find(x=>Number(x.gameweek)===state.gw&&(x.home===p.team||x.away===p.team));return f?{...f,difficulty:f.home===p.team?f.home_difficulty:f.away_difficulty,opponent:f.home===p.team?f.away:f.home,home:f.home===p.team}:null}
function seasonLabels(){const now=new Date(),year=now.getMonth()>=6?now.getFullYear():now.getFullYear()-1;return{current:`${year}-${String(year+1).slice(-2)}`,previous:`${year-1}-${String(year).slice(-2)}`}}
async function loadSeasonTransition(){
 try{const labels=seasonLabels(),data=await endpoints.historicalPlayers(`${labels.previous}`);state.previousPlayersByCode=new Map((data.players||[]).filter(row=>row.season===labels.previous).map(row=>[Number(row.code),row]));state.seasonTransitionReady=true;if(state.plan){calculate();render()}}
 catch(error){state.previousPlayersByCode=new Map();state.seasonTransitionReady=false;console.warn('Previous-season priors unavailable',error)}
}
function playerSeasonPrior(universePlayer){return state.previousPlayersByCode.get(Number(universePlayer?.code))||null}
function currentSeasonProgress(){const finished=Number(state.completedEvents?.length||0),allFinished=Number(state.manager?.current_gameweek||0)-1;return Math.max(finished,allFinished,0)}
const TEAM_ALIASES={ARS:['arsenal','ars'],AVL:['aston villa','avl'],BOU:['bournemouth','bou'],BRE:['brentford','bre'],BHA:['brighton','brighton and hove albion','bha'],BUR:['burnley','bur'],CHE:['chelsea','che'],CRY:['crystal palace','cry'],EVE:['everton','eve'],FUL:['fulham','ful'],LEE:['leeds','leeds united','lee'],LIV:['liverpool','liv'],MCI:['manchester city','man city','mci'],MUN:['manchester united','man utd','mun'],NEW:['newcastle','newcastle united','new'],NFO:['nottingham forest',"nott'm forest",'nfo'],SUN:['sunderland','sun'],TOT:['tottenham','tottenham hotspur','spurs','tot'],WHU:['west ham','west ham united','whu'],WOL:['wolves','wolverhampton wanderers','wol']};
function normalTeamName(value){return String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function strengthForTeam(team){const direct=normalTeamName(team),aliases=TEAM_ALIASES[String(team||'').toUpperCase()]||[direct];for(const name of [direct,...aliases.map(normalTeamName)]){const found=state.teamStrengthByTeam.get(name);if(found)return found}return null}
function strengthProfile(value){return{seasonXg:Number(value?.season_xg_per_game??1.35),recentXg:Number(value?.recent6_xg_per_game??value?.season_xg_per_game??1.35),seasonXga:Number(value?.season_xga_per_game??1.35),recentXga:Number(value?.recent6_xga_per_game??value?.season_xga_per_game??1.35),homeXg:Number(value?.home_xg_per_game??value?.season_xg_per_game??1.35),homeXga:Number(value?.home_xga_per_game??value?.season_xga_per_game??1.35),awayXg:Number(value?.away_xg_per_game??value?.season_xg_per_game??1.35),awayXga:Number(value?.away_xga_per_game??value?.season_xga_per_game??1.35),matches:Number(value?.matches||0),source:value?'worker':'fallback'}}
async function loadTeamStrength(){
 try{const season=new Date().getMonth()>=6?`${new Date().getFullYear()}-${String(new Date().getFullYear()+1).slice(-2)}`:`${new Date().getFullYear()-1}-${String(new Date().getFullYear()).slice(-2)}`,data=await endpoints.teamStrength(season,6);state.teamStrength=data;state.teamStrengthByTeam=new Map();for(const team of(data.teams||[])){state.teamStrengthByTeam.set(normalTeamName(team.team),team)}if(state.plan){calculate();render()}}
 catch(error){state.teamStrength=null;state.teamStrengthByTeam=new Map();console.warn('Team strength unavailable',error);$('#alerts').innerHTML+=`<div class="alert">Team xG/xGA unavailable. Fixture projections use neutral fallback data.</div>`}
}
function modelContext(player,gw=state.gw){
 const match=state.fixtures.find(item=>Number(item.gameweek)===Number(gw)&&(item.home===player.team||item.away===player.team)),opponent=match?(match.home===player.team?match.away:match.home):null,universePlayer=state.players.find(item=>Number(item.id)===Number(player.player_id)),detail=state.details[player.player_id]||{},recent=(detail.recent_history||[]).slice(-8),minutes=recent.reduce((n,row)=>n+Number(row.minutes||0),0),saves=recent.reduce((n,row)=>n+Number(row.saves||0),0),defensive=recent.reduce((n,row)=>n+Number(row.defensive_contribution||row.defcon||0),0);
 const teamPlayers=state.players.filter(item=>String(item.team)===String(player.team)&&Number(item.minutes||0)>0),teamXg=teamPlayers.reduce((n,item)=>n+Number(item.xG||0),0),teamXa=teamPlayers.reduce((n,item)=>n+Number(item.xA||0),0),playerXg=Number(universePlayer?.xG||0),playerXa=Number(universePlayer?.xA||0),rawGoalShare=teamXg>0?playerXg/teamXg:null,rawAssistShare=teamXa>0?playerXa/teamXa:null,previousPlayer=playerSeasonPrior(universePlayer),seasonProgress=currentSeasonProgress();return{teamStrength:strengthProfile(strengthForTeam(player.team)),opponentStrength:strengthProfile(strengthForTeam(opponent)),universePlayer,previousPlayer,seasonProgress,keeperSaveRate:minutes?saves*90/minutes:null,defensiveRate:minutes?defensive*90/minutes:null,teamPenaltyRate:.12,teamStrengthSource:strengthForTeam(player.team)&&strengthForTeam(opponent)?'worker':'fallback',playerGoalShare:rawGoalShare,playerAssistShare:rawAssistShare,teamPlayerXg:teamXg,teamPlayerXa:teamXa};
}
function fixtureForGw(p,gw){const matches=state.fixtures.filter(x=>Number(x.gameweek)===Number(gw)&&(x.home===p.team||x.away===p.team));return matches.map(f=>({...f,difficulty:f.home===p.team?f.home_difficulty:f.away_difficulty,opponent:f.home===p.team?f.away:f.home,home:f.home===p.team}))}
function multiProject(p,horizon=5){const rows=[];for(let offset=0;offset<horizon;offset++){const gw=Number(state.gw)+offset,fixtures=fixtureForGw(p,gw);if(!fixtures.length){rows.push({gw,xPts:0,xMin:0,fixture:'Blank',fdr:null});continue}let total=0;const minuteValues=[];for(const f of fixtures){const value=project(p,state.details[p.player_id],f,modelContext(p,gw));total+=value.xPts;const minutes=expectedMinutes(value);if(minutes!==null)minuteValues.push(minutes)}const xMin=minuteValues.length?Math.max(...minuteValues):null;rows.push({gw,xPts:total,xMin,fixture:fixtures.map(f=>`${f.opponent} ${f.home?'H':'A'}`).join(' + '),fdr:Math.round(fixtures.reduce((n,f)=>n+Number(f.difficulty||3),0)/fixtures.length)})}const sum=n=>rows.slice(0,n).reduce((v,row)=>v+row.xPts,0),weighted=n=>rows.slice(0,n).reduce((v,row,i)=>v+row.xPts*Math.max(.6,1-i*.1),0);return{rows,xPts1:sum(1),xPts3:sum(3),weighted3:weighted(3),xPts5:sum(5),weighted5:weighted(5)}}
function calculate(){state.projections={};state.multiProjections={};for(const p of state.plan.players){state.projections[p.player_id]=project(p,state.details[p.player_id],fixture(p),modelContext(p));state.multiProjections[p.player_id]=multiProject(p,5)}}
function persist(){inspectPlanIntegrity(state.plan,`before Planner save GW${state.gw}`);if(!ensurePlannerIntegrity())return false;return save(db)}
function persistPlannerState({invalidateFuture=false}={}){
 inspectPlanIntegrity(state.plan,`before Planner save GW${state.gw}`);if(!ensurePlannerIntegrity())return false;
 const manager=db.managers?.[state.managerId]||{plans:{}},plans={...(manager.plans||{})};
 if(invalidateFuture)for(const key of Object.keys(plans))if(Number(key)>Number(state.gw))delete plans[key];
 plans[state.gw]=state.plan;
 const nextDb={...db,managers:{...(db.managers||{}),[state.managerId]:{...manager,plans}}};
 if(!save(nextDb))return false;
 for(const key of Object.keys(db))delete db[key];Object.assign(db,nextDb);
 return true;
}
const CLUB_CARD_STYLE_SEASON='2026-27';
const CLUB_CARD_STYLES_BY_SEASON={
 '2026-27':{
  1:{primary:'#D71920',secondary:'#FFFFFF',background:'linear-gradient(90deg,#FFFFFF 0 5px,#D71920 5px calc(100% - 5px),#FFFFFF calc(100% - 5px))',color:'#FFFFFF',label:'rgba(6,43,96,.72)'},
  2:{primary:'#670E36',secondary:'#95BFE5',background:'linear-gradient(90deg,#95BFE5 0 7px,#670E36 7px calc(100% - 7px),#95BFE5 calc(100% - 7px))',color:'#FFFFFF',label:'rgba(6,43,96,.68)'},
  3:{primary:'#DA291C',secondary:'#171717',background:'repeating-linear-gradient(90deg,#DA291C 0 8px,#171717 8px 16px)',color:'#FFFFFF',label:'rgba(0,0,0,.68)'},
  4:{primary:'#D71920',secondary:'#FFFFFF',background:'repeating-linear-gradient(90deg,#D71920 0 8px,#FFFFFF 8px 16px)',color:'#FFFFFF',label:'rgba(6,43,96,.72)'},
  5:{primary:'#0057B8',secondary:'#FFFFFF',background:'repeating-linear-gradient(90deg,#0057B8 0 7px,#FFFFFF 7px 8px)',color:'#FFFFFF',label:'rgba(6,43,96,.72)'},
  6:{primary:'#034694',secondary:'#FFFFFF',background:'linear-gradient(135deg,#034694,#0758B8)',color:'#FFFFFF',label:'transparent'},
  7:{primary:'#79BCE8',secondary:'#17365D',background:'repeating-linear-gradient(90deg,#79BCE8 0 7px,#65A9D6 7px 14px,#17365D 14px 15px)',color:'#17365D',label:'rgba(255,255,255,.82)'},
  8:{primary:'#1B458F',secondary:'#C41230',background:'linear-gradient(90deg,#1B458F 0 50%,#C41230 50% 100%)',color:'#FFFFFF',label:'rgba(6,43,96,.48)'},
  9:{primary:'#003399',secondary:'#FFFFFF',background:'linear-gradient(180deg,#003399 0 calc(100% - 1px),#FFFFFF calc(100% - 1px))',color:'#FFFFFF',label:'transparent'},
  10:{primary:'#171717',secondary:'#FFFFFF',background:'linear-gradient(90deg,#171717 0 4px,#FFFFFF 4px calc(100% - 4px),#171717 calc(100% - 4px))',color:'#171717',label:'rgba(255,255,255,.82)'},
  11:{primary:'#F5A623',secondary:'#171717',background:'repeating-linear-gradient(90deg,#F5A623 0 8px,#171717 8px 16px)',color:'#FFFFFF',label:'rgba(0,0,0,.68)'},
  12:{primary:'#0057B8',secondary:'#FFFFFF',background:'linear-gradient(90deg,#FFFFFF 0 4px,#0057B8 4px calc(100% - 4px),#FFFFFF calc(100% - 4px))',color:'#FFFFFF',label:'rgba(6,43,96,.68)'},
  13:{primary:'#1D428A',secondary:'#FFCD00',background:'linear-gradient(180deg,#FFFFFF 0 calc(100% - 3px),#1D428A calc(100% - 3px) calc(100% - 1px),#FFCD00 calc(100% - 1px))',color:'#1D428A',label:'rgba(255,255,255,.76)'},
  14:{primary:'#C8102E',secondary:'#FFFFFF',background:'linear-gradient(135deg,#C8102E,#B20D28)',color:'#FFFFFF',label:'transparent'},
  15:{primary:'#6CABDD',secondary:'#FFFFFF',background:'linear-gradient(180deg,#6CABDD 0 calc(100% - 1px),#FFFFFF calc(100% - 1px))',color:'#132257',label:'transparent'},
  16:{primary:'#DA291C',secondary:'#171717',background:'linear-gradient(90deg,#171717 0 4px,#DA291C 4px calc(100% - 4px),#171717 calc(100% - 4px))',color:'#FFFFFF',label:'rgba(0,0,0,.38)'},
  17:{primary:'#171717',secondary:'#FFFFFF',background:'repeating-linear-gradient(90deg,#171717 0 8px,#FFFFFF 8px 16px)',color:'#FFFFFF',label:'rgba(0,0,0,.68)'},
  18:{primary:'#DD0000',secondary:'#FFFFFF',background:'linear-gradient(180deg,#DD0000 0 calc(100% - 1px),#FFFFFF calc(100% - 1px))',color:'#FFFFFF',label:'transparent'},
  19:{primary:'#132257',secondary:'#FFFFFF',background:'linear-gradient(180deg,#FFFFFF 0 calc(100% - 2px),#132257 calc(100% - 2px))',color:'#132257',label:'rgba(255,255,255,.74)'},
  20:{primary:'#EB172B',secondary:'#FFFFFF',background:'repeating-linear-gradient(90deg,#EB172B 0 8px,#FFFFFF 8px 16px)',color:'#FFFFFF',label:'rgba(6,43,96,.68)'}
 }
};
const DEFAULT_CLUB_CARD_STYLE={primary:'#781D32',secondary:'#151515',background:'#062B60',color:'#FFFFFF',label:'transparent'};
function clubCardStyle(teamOrPlayer){
 const player=teamOrPlayer&&typeof teamOrPlayer==='object'?teamOrPlayer:null,team=String(player?.team??teamOrPlayer??'').toUpperCase(),teamId=Number(player?.team_id)||Number(state.players.find(item=>String(item.team||'').toUpperCase()===team)?.team_id),style=CLUB_CARD_STYLES_BY_SEASON[CLUB_CARD_STYLE_SEASON]?.[teamId]||DEFAULT_CLUB_CARD_STYLE;
 return `--club-primary:${style.primary};--club-secondary:${style.secondary}`
}
function playerCardClubStyle(player){
 const teamId=Number(player?.team_id)||Number(state.players.find(item=>String(item.team||'').toUpperCase()===String(player?.team||'').toUpperCase())?.team_id),style=CLUB_CARD_STYLES_BY_SEASON[CLUB_CARD_STYLE_SEASON]?.[teamId]||DEFAULT_CLUB_CARD_STYLE;
 return `--club-name-background:${style.background};--club-name-color:${style.color};--club-name-label:${style.label}`
}
function cardFixtures(player){return[0,1,2].map(offset=>{const gw=Number(state.gw)+offset,matches=state.fixtures.filter(f=>Number(f.gameweek)===gw&&(f.home===player.team||f.away===player.team));return{gw,text:matches.length?matches.map(f=>`${f.home===player.team?f.away:f.home} ${f.home===player.team?'H':'A'}`).join(' + '):'—',blank:!matches.length,difficulty:matches.length?Math.round(matches.reduce((n,f)=>n+Number(f.home===player.team?f.home_difficulty:f.away_difficulty),0)/matches.length):null}})}
function finiteMetric(value){if(typeof value!=='number'&&typeof value!=='string'||typeof value==='string'&&!value.trim())return null;const number=Number(value);return Number.isFinite(number)?number:null}
function expectedMinutes(projection){const value=finiteMetric(projection?.xMin);return value!==null&&value>=0?value:null}
function lineupXptsTotals(starters,projections,captain,horizon='xPts'){
 const ids=(Array.isArray(starters)?starters:[]).map(Number),valueFor=id=>{const projection=projections?.[id],raw=projection?.[horizon]??(horizon==='xPts1'?projection?.xPts:undefined);return finiteMetric(raw)??0},base=ids.reduce((sum,id)=>sum+valueFor(id),0),captainId=Number(captain),captainPoints=ids.includes(captainId)?valueFor(captainId):0;
 return{base,captain:captainPoints,total:base+captainPoints};
}
function playerCard(id){
 const player=state.plan.players.find(item=>Number(item.player_id)===Number(id)),projection=state.projections[id]||{},fixtures=cardFixtures(player),minutes=expectedMinutes(projection),points=finiteMetric(state.multiProjections[id]?.xPts3??projection.xPts),captain=Number(state.plan.captain)===Number(id),vice=Number(state.plan.vice)===Number(id),transfer=state.plan.transfers.some(item=>Number(item.in.player_id)===Number(id));
 return`<span class="player-card-wrap" style="${playerCardClubStyle(player)}"><button type="button" class="player player-card-v12 ${state.selected===id?'selected':''} ${transfer?'changed':''} ${minutes!==null&&minutes<80?'minutes-warning':''}" data-player="${id}" aria-label="${esc(`${player.name}, ${points===null?'xPts unavailable':`${points.toFixed(1)} xPts`}, ${minutes===null?'expected minutes unavailable':`${Math.round(minutes)} expected minutes`}`)}"><span class="player-card-heading"><strong class="player-card-name" title="${esc(player.name)}">${esc(player.name)}</strong></span><span class="player-card-fixtures">${fixtures.map(item=>`<span class="player-card-fixture ${item.blank?'blank':`fdr-${item.difficulty}`}"${item.blank?'':` title="${esc(`${item.text} · FDR ${item.difficulty}`)}"`}><b>${esc(item.text)}</b></span>`).join('')}</span><span class="player-card-projection"><b class="primary-xpts">${points===null?'—':points.toFixed(1)}</b><small class="player-card-minutes">${minutes===null?'—':Math.round(minutes)} min</small></span></button>${captain?'<span class="player-role-badge captain-badge" aria-label="Captain">C</span>':vice?'<span class="player-role-badge vice-badge" aria-label="Vice-captain">VC</span>':''}</span>`
}
function plannerIntegrityErrors(plan){
 if(!plan||!Array.isArray(plan.players)||!Array.isArray(plan.starters)||!Array.isArray(plan.bench))return['Planner lineup data is incomplete.'];
 const ids=plan.players.map(player=>Number(player?.player_id)),uniqueIds=new Set(ids),starters=plan.starters.map(Number),bench=plan.bench.map(Number),lineupIds=[...starters,...bench],errors=[];
 if(plan.players.some(player=>!player||typeof player!=='object'))errors.push('Planner squad contains an invalid player record.');
 if(ids.some(id=>!Number.isSafeInteger(id)||id<1))errors.push('Planner squad contains an invalid player ID.');
 if(plan.starters.some(id=>typeof id!=='number')||plan.bench.some(id=>typeof id!=='number'))errors.push('Starters and bench must contain player IDs, not player objects.');
 if(ids.length!==uniqueIds.size)errors.push('Planner squad contains duplicate players.');
 if(ids.length!==15)errors.push(`Planner squad must contain 15 players (currently ${ids.length}).`);
 if(starters.length!==11)errors.push(`Starting XI must contain 11 players (currently ${starters.length}).`);
 if(bench.length!==4)errors.push(`Bench must contain four players (currently ${bench.length}).`);
 if(new Set(lineupIds).size!==lineupIds.length)errors.push('A player appears more than once in the lineup.');
 if(lineupIds.length!==ids.length||lineupIds.some(id=>!uniqueIds.has(id))||ids.some(id=>!lineupIds.includes(id)))errors.push('Every squad player must appear exactly once as a starter or bench player.');
 if(!validFormation(plan))errors.push('Starting XI must have 1 GK, at least 3 DEF, at least 2 MID, and at least 1 FWD.');
 if(!starters.includes(Number(plan.captain))||!starters.includes(Number(plan.vice))||Number(plan.captain)===Number(plan.vice))errors.push('Captain and vice-captain must be different starting players.');
 return errors;
}
function ensurePlannerIntegrity(){
 const errors=plannerIntegrityErrors(state.plan);
 if(!errors.length)return true;
 $('#alerts').innerHTML=`<div class="alert">Planner lineup not saved: ${esc(errors[0])}</div>`;
 return false;
}
function updateSwitchPrompt(){
 const active=state.switchingId!==null&&state.switchingId!==undefined;
 const plannerPrompt=$('#switchPrompt'),freeHitPrompt=$('#freeHitSwitchPrompt');
 if(plannerPrompt)plannerPrompt.hidden=!active||state.activeView!=='planner';
 if(freeHitPrompt)freeHitPrompt.hidden=!active||state.activeView!=='freehit';
}
function clearSwitchMode(){
 state.switchingId=null;state.selected=null;updateSwitchPrompt();
}
function beginSwitchMode(id){
 state.switchingId=Number(id);state.selected=null;updateSwitchPrompt();
}
function render(){updateSwitchPrompt();if(!ensurePlannerIntegrity())return;renderSummary();renderPlanningStatus();renderPlanSummary();const by=position=>state.plan.starters.filter(id=>state.plan.players.find(player=>Number(player.player_id)===Number(id))?.position===position),positions=['GK','DEF','MID','FWD'];$('#pitch').innerHTML=positions.map(position=>{const players=by(position);return`<div class="line" data-position="${position}" style="--line-count:${players.length}">${players.map(playerCard).join('')}</div>`}).join('');$('#bench').innerHTML=state.plan.bench.map(playerCard).join('');const totals=lineupXptsTotals(state.plan.starters,state.projections,state.plan.captain);$('#lineupScore').innerHTML=`<span>Projected XI <b>${totals.total.toFixed(1)}</b></span><span>Formation <b>${by('DEF').length}-${by('MID').length}-${by('FWD').length}</b></span>`;document.querySelectorAll('#pitch [data-player],#bench [data-player]').forEach(button=>button.onclick=()=>pick(Number(button.dataset.player)))}
function freeHitPlans(){db.managers??={};db.managers[state.managerId]??={plans:{}};db.managers[state.managerId].freeHitPlans??={};return db.managers[state.managerId].freeHitPlans}
function validPlannerBenchmark(plan){
 if(!plan||!Array.isArray(plan.players)||plan.players.length!==15||plan.players.some(player=>!player||typeof player!=='object')||!Array.isArray(plan.starters)||plan.starters.length!==11||!Array.isArray(plan.bench)||plan.bench.length!==4)return false;
 const ids=plan.players.map(player=>Number(player.player_id)),allLineup=[...plan.starters,...plan.bench].map(Number),positions={GK:0,DEF:0,MID:0,FWD:0};
 if(new Set(ids).size!==15||new Set(allLineup).size!==15||allLineup.some(id=>!ids.includes(id)))return false;
 for(const player of plan.players)positions[player.position]=(positions[player.position]||0)+1;
 return positions.GK===2&&positions.DEF===5&&positions.MID===5&&positions.FWD===3&&validPlannerFormation(plan)&&plan.starters.some(id=>Number(id)===Number(plan.captain))&&plan.starters.some(id=>Number(id)===Number(plan.vice))&&Number(plan.captain)!==Number(plan.vice);
}
function validPlannerFormation(plan){
 const counts={GK:0,DEF:0,MID:0,FWD:0};
 for(const id of plan.starters){const player=plan.players.find(item=>Number(item?.player_id)===Number(id));if(!player)return false;counts[player.position]=(counts[player.position]||0)+1}
 return counts.GK===1&&counts.DEF>=3&&counts.DEF<=5&&counts.MID>=2&&counts.MID<=5&&counts.FWD>=1&&counts.FWD<=3;
}
function currentTeamSignature(plan){
 return JSON.stringify({players:plan.players.map(player=>Number(player.player_id)).sort((a,b)=>a-b),starters:plan.starters.map(Number).sort((a,b)=>a-b),captain:Number(plan.captain),vice:Number(plan.vice)});
}
async function currentTeamCandidate(gw){
 const planned=db.managers?.[state.managerId]?.plans?.[gw];
 if(validPlannerBenchmark(planned))return{plan:{...structuredClone(planned),gw},source:'Planner team'};
 let squad=state.baseSquad;
 if(!Array.isArray(squad)||squad.length!==15){
  const response=await endpoints.squad(state.managerId,Math.min(Number(gw),Number(state.manager?.current_gameweek||gw)));
  squad=response.squad;state.baseSquad=squad;state.baseSquadGameweek=Number(response.gameweek||gw);
 }
 if(!Array.isArray(squad)||squad.length!==15)throw new Error(`Could not load a valid official 15-player squad for GW${gw}.`);
 const official=planFromOfficialSquad(gw,{squad,bank:state.manager?.bank,team_value:state.manager?.team_value},state.manager||{});
 return{plan:official,source:'Official synced team'};
}
function projectGameweek(player,gw){
 const fixtures=fixtureForGw(player,gw),rows=fixtures.map(match=>project(player,state.details[player.player_id],match,modelContext(player,gw)));
 const projection=rows[0]||project(player,state.details[player.player_id],null,modelContext(player,gw));
 projection.xPts=rows.reduce((sum,row)=>sum+Number(row.xPts||0),0);
 const minuteValues=rows.map(row=>expectedMinutes(row)).filter(value=>value!==null);projection.xMin=rows.length?(minuteValues.length?Math.max(...minuteValues):null):0;
 if(rows.length>1)projection.components=Object.fromEntries(Object.keys(projection.components||{}).map(key=>[key,rows.reduce((sum,row)=>sum+Number(row.components?.[key]||0),0)]));
 if(!rows.length)projection.components={};
 return projection;
}
async function prepareFreeHitComparison(request=state.freeHitRequest){
 const candidate=await currentTeamCandidate(state.gw),plan=candidate.plan;
 plan.players=plan.players.map(normalizeFreeHitPlayer);
 await Promise.all(plan.players.map(async player=>{if(!state.details[player.player_id])state.details[player.player_id]=await endpoints.player(player.player_id)}));
 if(request!==state.freeHitRequest)return;
 const projections=Object.fromEntries(plan.players.map(player=>[player.player_id,projectGameweek(player,state.gw)]));
 state.currentTeamBenchmark={...candidate,plan,projections,signature:currentTeamSignature(plan)};
 if(!state.freeHitPlan.baselineSignature){state.freeHitPlan.baselineSignature=state.currentTeamBenchmark.signature;persistFreeHit()}
 renderFreeHitComparison();
}
function freeHitBudget(source){
 const managerValue=Number(source.team_value??state.manager?.team_value),bank=Number(source.bank??state.manager?.bank);
 return managerValue>0&&Number.isFinite(bank)?managerValue+bank:100;
}
function normalizeFreeHitPlayer(player){
 const universe=state.players.find(item=>Number(item.id)===Number(player.player_id));
 return{...universe,...player,player_id:Number(player.player_id),price:Number(player.price??universe?.price??0)};
}
function emptyFreeHitPlan(gw){
 const budget=freeHitBudget({team_value:state.manager?.team_value,bank:state.manager?.bank});
 return{gw:Number(gw),budget,bank:budget,players:[],starters:[],bench:[],captain:null,vice:null};
}
function freeHitDraftErrors(plan){
 if(!plan||!Array.isArray(plan.players)||!Array.isArray(plan.starters)||!Array.isArray(plan.bench))return['Free Hit draft data is incomplete.'];
 const errors=[],players=plan.players,ids=players.map(player=>Number(player?.player_id)),starterIds=plan.starters.map(Number),benchIds=plan.bench.map(Number),allIds=[...starterIds,...benchIds],counts={GK:0,DEF:0,MID:0,FWD:0},clubs=new Map(),limits={GK:2,DEF:5,MID:5,FWD:3},budget=finiteMetric(plan.budget);
 if(players.length>15)errors.push('A Free Hit squad cannot contain more than 15 players.');
 if(players.some(player=>!player||typeof player!=='object'))errors.push('The Free Hit squad contains an invalid player record.');
 if(ids.some(id=>!Number.isSafeInteger(id)||id<1))errors.push('The Free Hit squad contains an invalid player ID.');
 if(new Set(ids).size!==ids.length)errors.push('The Free Hit squad contains duplicate players.');
 for(const player of players){
  if(!player||typeof player!=='object')continue;
  if(!Object.prototype.hasOwnProperty.call(counts,player.position))errors.push(`Invalid Free Hit position: ${String(player.position)}.`);
  else counts[player.position]++;
  const team=String(player.team||'');if(team)clubs.set(team,(clubs.get(team)||0)+1);
  const price=finiteMetric(player.price);if(price===null||price<0)errors.push(`Invalid price for ${player.name||'a selected player'}.`);
 }
 for(const[position,limit]of Object.entries(limits))if(counts[position]>limit)errors.push(`Free Hit allows at most ${limit} ${position} players (currently ${counts[position]}).`);
 if([...clubs.values()].some(count=>count>3))errors.push('A Free Hit squad cannot contain more than three players from one club.');
 if(budget===null||budget<0)errors.push('Free Hit budget is invalid.');
 else if(players.reduce((sum,player)=>sum+(finiteMetric(player?.price)??0),0)>budget+.001)errors.push(`Squad exceeds the £${budget.toFixed(1)}m budget.`);
 if(starterIds.length>11)errors.push('A Free Hit starting XI cannot contain more than 11 players.');
 if(benchIds.length>4)errors.push('A Free Hit bench cannot contain more than four players.');
 if(new Set(allIds).size!==allIds.length)errors.push('A player appears more than once in the Free Hit lineup.');
 if(allIds.length!==ids.length||allIds.some(id=>!ids.includes(id))||ids.some(id=>!allIds.includes(id)))errors.push('Every selected Free Hit player must appear exactly once as a starter or bench player.');
 for(const id of starterIds)if(!players.some(player=>Number(player?.player_id)===id))errors.push('The Free Hit starting XI contains a player outside the squad.');
 for(const id of benchIds)if(!players.some(player=>Number(player?.player_id)===id))errors.push('The Free Hit bench contains a player outside the squad.');
 if(plan.captain!==null&&plan.captain!==undefined&&!starterIds.includes(Number(plan.captain)))errors.push('Free Hit captain must be a starter.');
 if(plan.vice!==null&&plan.vice!==undefined&&!starterIds.includes(Number(plan.vice)))errors.push('Free Hit vice-captain must be a starter.');
 if(plan.captain!==null&&plan.captain!==undefined&&plan.vice!==null&&plan.vice!==undefined&&Number(plan.captain)===Number(plan.vice))errors.push('Free Hit captain and vice-captain must be different players.');
 return[...new Set(errors)];
}
function freeHitRosterErrors(plan){
 const errors=freeHitDraftErrors(plan);if(errors.length)return errors;
 if(plan.players.length!==15)errors.push(`Select exactly 15 players (currently ${plan.players.length}).`);
 const counts={GK:0,DEF:0,MID:0,FWD:0};for(const player of plan.players)counts[player.position]++;
 for(const[position,count]of Object.entries({GK:2,DEF:5,MID:5,FWD:3}))if(counts[position]!==count)errors.push(`Squad needs ${count} ${position} players (currently ${counts[position]||0}).`);
 return errors;
}
function validFreeHitFormation(plan){
 if(!plan||!Array.isArray(plan.players)||!Array.isArray(plan.starters)||plan.starters.length!==11)return false;
 const counts={GK:0,DEF:0,MID:0,FWD:0};for(const id of plan.starters){const player=plan.players.find(item=>Number(item.player_id)===Number(id));if(!player)return false;counts[player.position]++}
 return counts.GK===1&&counts.DEF>=3&&counts.DEF<=5&&counts.MID>=2&&counts.MID<=5&&counts.FWD>=1&&counts.FWD<=3;
}
function validateFreeHit(plan){
 const errors=freeHitRosterErrors(plan);if(errors.length)return errors;
 const starters=plan.starters,bench=plan.bench;
 if(starters.length!==11)errors.push(`Starting XI must contain 11 players (currently ${starters.length}).`);
 if(bench.length!==4)errors.push(`Bench must contain four players (currently ${bench.length}).`);
 if(!validFreeHitFormation(plan))errors.push('Starting XI must have 1 GK, 3–5 DEF, 2–5 MID and 1–3 FWD.');
 if(!starters.some(id=>Number(id)===Number(plan.captain)))errors.push('Captain must be in the starting XI.');
 if(!starters.some(id=>Number(id)===Number(plan.vice)))errors.push('Vice-captain must be in the starting XI.');
 return errors;
}
function persistFreeHit(){if(!state.freeHitPlan)return false;const plans=freeHitPlans(),errors=freeHitDraftErrors(state.freeHitPlan),restore=()=>{if(state.freeHitLastValidPlan){state.freeHitPlan=structuredClone(state.freeHitLastValidPlan);plans[state.gw]=state.freeHitPlan}};if(errors.length){state.freeHitSaveError=`Free Hit draft not saved: ${errors[0]}`;restore();return false}plans[state.gw]=state.freeHitPlan;if(!save(db)){state.freeHitSaveError='Could not save this Free Hit draft to local storage. Check browser storage availability.';restore();return false}state.freeHitLastValidPlan=structuredClone(state.freeHitPlan);state.freeHitSaveError='';return true}
async function openFreeHit(gw=state.gw,reset=false){
 const request=++state.freeHitRequest,nextGw=Number(gw),changedGameweek=Number(state.gw)!==nextGw;if(changedGameweek||reset){clearSwitchMode();state.freeHitPlan=null;state.freeHitLastValidPlan=null;state.currentTeamBenchmark=null;state.freeHitProjections={};$('#freeHitSummary').innerHTML='';$('#freeHitGainSummary').innerHTML='<div class="free-hit-gain-unavailable">Loading current-team comparison…</div>';$('#freeHitTeams').innerHTML=''}state.gw=nextGw;renderGwNav();$('#freeHitTitle').textContent=`Free Hit · GW${state.gw}`;renderFreeHitFixtures();$('#freeHitValidation').innerHTML='<p>Loading official squad and player projections…</p>';
 try{
  const drafts=freeHitPlans();let plan=!reset?drafts[state.gw]:null;
  if(!plan){plan=emptyFreeHitPlan(state.gw);drafts[state.gw]=plan;if(!save(db))throw new Error('Could not save the new empty Free Hit draft to local storage.');state.freeHitSaveError=''}
  plan.gw=state.gw;plan.budget=finiteMetric(plan.budget)??freeHitBudget({});plan.players=(Array.isArray(plan.players)?plan.players:[]).map(normalizeFreeHitPlayer);plan.starters=Array.isArray(plan.starters)?plan.starters:[];plan.bench=Array.isArray(plan.bench)?plan.bench:[];plan.captain??=null;plan.vice??=null;state.freeHitPlan=plan;state.freeHitLastValidPlan=structuredClone(plan);
  await Promise.all(plan.players.map(async player=>{if(!state.details[player.player_id])state.details[player.player_id]=await endpoints.player(player.player_id)}));
  if(request!==state.freeHitRequest)return;calculateFreeHit();await prepareFreeHitComparison(request);if(request!==state.freeHitRequest)return;renderFreeHit();
 }catch(error){if(request===state.freeHitRequest)$('#freeHitValidation').innerHTML=`<div class="alert">Could not load Free Hit squad or player details: ${esc(error.message)}</div>`}
}
function calculateFreeHit(){
 state.freeHitProjections={};const plan=state.freeHitPlan;if(!plan)return;
 for(const player of plan.players)state.freeHitProjections[player.player_id]=projectGameweek(player,state.gw);
}
function renderFreeHit(){
 const plan=state.freeHitPlan;if(!plan)return;const draftErrors=freeHitDraftErrors(plan),complete=plan.players.length===15,errors=complete?validateFreeHit(plan):[],by=position=>plan.starters.filter(id=>plan.players.find(player=>Number(player.player_id)===Number(id))?.position===position);
 const value=plan.players.reduce((sum,player)=>sum+Number(player.price||0),0),clubs=new Map();for(const player of plan.players)clubs.set(player.team,(clubs.get(player.team)||0)+1);
 $('#freeHitSummary').innerHTML=`<div><b>GW${state.gw}</b><span>Selected Gameweek</span></div><div><b>£${value.toFixed(1)}m</b><span>Squad value</span></div><div><b>£${(Number(plan.budget||0)-value).toFixed(1)}m</b><span>Money remaining</span></div><div><b>${plan.players.length}/15</b><span>Players selected</span></div><div><b>${[...clubs.values()].filter(count=>count===3).length}</b><span>Clubs at 3 players</span></div>`;
 renderFreeHitFixtures();
 $('#freeHitValidation').innerHTML=draftErrors.length?`<div class="alert"><b>Free Hit draft needs attention</b><ul>${draftErrors.map(error=>`<li>${esc(error)}</li>`).join('')}</ul></div>`:!complete?`<div class="free-hit-progress"><b>Draft in progress · ${plan.players.length}/15 players</b><p>Add players by position, then optimize the XI and assign captaincy.</p></div>`:errors.length?`<div class="free-hit-progress"><b>Draft in progress · 15/15 players</b><p>Resolve these lineup requirements before the Free Hit team is ready.</p><ul>${errors.map(error=>`<li>${esc(error)}</li>`).join('')}</ul></div>`:'<div class="free-hit-valid">Squad, formation, budget, and captaincy rules are valid.</div>';
 if(state.freeHitSaveError)$('#freeHitValidation').insertAdjacentHTML('beforeend',`<div class="alert">${esc(state.freeHitSaveError)}</div>`);
 renderFreeHitComparison();
}
function renderFreeHitFixtures(){
 const fixtures=state.fixtures.filter(fixture=>Number(fixture.gameweek)===Number(state.gw)),teams=new Set(state.players.map(player=>String(player.team||'')).filter(Boolean)),counts=new Map();
 for(const fixture of fixtures){counts.set(fixture.home,(counts.get(fixture.home)||0)+1);counts.set(fixture.away,(counts.get(fixture.away)||0)+1)}
 const doubles=[...counts.values()].filter(count=>count>1).length,blanks=[...teams].filter(team=>!counts.has(team)).length;
 $('#freeHitFixtureSummary').textContent=fixtures.length?`${fixtures.length} fixtures · ${doubles} double teams · ${blanks} blank teams`:'Fixture summary unavailable';
 $('#freeHitFixtures').innerHTML=fixtures.length?fixtures.map(fixture=>{
  const kickoff=fixture.kickoff?new Date(fixture.kickoff):null,kickoffLabel=kickoff&&!Number.isNaN(kickoff.getTime())?kickoff.toLocaleString([], {weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Kickoff unavailable';
  return`<div class="free-hit-fixture"><div class="free-hit-fixture-team" style="${clubCardStyle(fixture.home)}"><b>${esc(fixture.home)}</b><small>FDR ${esc(fixture.home_difficulty??'—')}</small></div><span class="free-hit-fixture-vs">vs</span><div class="free-hit-fixture-team" style="${clubCardStyle(fixture.away)}"><b>${esc(fixture.away)}</b><small>FDR ${esc(fixture.away_difficulty??'—')}</small></div><time>${esc(kickoffLabel)}</time></div>`;
 }).join(''):'<p class="empty-fixtures">No fixtures are listed for this Gameweek.</p>';
}
function freeHitTargetFixtureLabel(player){
 const fixtures=fixtureForGw({...player,player_id:Number(player.id)},state.gw);
 return fixtures.length?fixtures.map(fixture=>`${fixture.opponent} (${fixture.home?'H':'A'})`).join(' + '):'Blank · 0.0 xPts';
}
function comparisonPlayerCard(player,projection,plan){
 const id=Number(player.player_id),tag=Number(plan.captain)===id?'C':Number(plan.vice)===id?'VC':'',matches=fixtureForGw(player,state.gw),projectionValue=finiteMetric(projection?.xPts)??0,minutes=expectedMinutes(projection),editable=plan===state.freeHitPlan,otherIds=editable?state.currentTeamBenchmark?.plan.players.map(item=>Number(item.player_id))||[]:state.freeHitPlan?.players.map(item=>Number(item.player_id))||[],kept=otherIds.includes(id),tone=kept?'kept':editable?'free-hit-only':'current-only',fixtures=matches.length?matches.map(match=>`<span class="comparison-fixture fdr-${Math.min(5,Math.max(1,Number(match.difficulty||3)))}">${esc(match.opponent)} ${match.home?'H':'A'} · FDR ${esc(match.difficulty??'—')}</span>`).join(''):'<span class="comparison-fixture blank">Blank · 0.0 xPts</span>';
 return`<button type="button" class="comparison-player-card ${tone} ${minutes!==null&&minutes<80?'minutes-warning':''}" style="${clubCardStyle(player.team)}" ${editable?`data-player="${id}"`:`data-current-player="${id}"`}><span class="comparison-card-heading"><strong>${esc(player.name)}${kept?'<small class="kept-tag">KEPT</small>':''}</strong>${tag?`<i class="comparison-role-badge">${tag}</i>`:''}</span><span class="comparison-player-meta">${esc(player.position)} · £${Number(player.price||0).toFixed(1)} · ${projectionValue.toFixed(1)} xPts · ${minutes===null?'—':Math.round(minutes)} min</span><span class="comparison-player-fixtures">${fixtures}</span></button>`;
}
function squadFixtureExposure(plan){
 const result={fdr12:0,fdr3:0,fdr45:0,blank:0,double:0};
 for(const player of plan.players){
  const fixtures=fixtureForGw(player,state.gw);if(!fixtures.length){result.blank++;continue}if(fixtures.length>1){result.double++;continue}
  const difficulty=Number(fixtures[0].difficulty||3);if(difficulty<=2)result.fdr12++;else if(difficulty===3)result.fdr3++;else result.fdr45++;
 }
 return result;
}
function renderFreeHitComparison(){
 const benchmark=state.currentTeamBenchmark,freeHit=state.freeHitPlan;if(!benchmark||!freeHit)return;
 const current=benchmark.plan,currentValid=validPlannerBenchmark(current),freeHitValid=freeHit.players.length===15&&validateFreeHit(freeHit).length===0,currentProjection=benchmark.projections,freeHitProjection=state.freeHitProjections;
 const currentTotals=lineupXptsTotals(current.starters,currentProjection,current.captain),freeHitTotals=lineupXptsTotals(freeHit.starters,freeHitProjection,freeHit.captain),gain=freeHitTotals.total-currentTotals.total;
 const baselineChanged=Boolean(freeHit.baselineSignature&&freeHit.baselineSignature!==benchmark.signature);
 $('#freeHitRebaseNotice').hidden=!baselineChanged;
 $('#freeHitRebaseNotice').innerHTML=baselineChanged?`<span>Current team has changed since this Free Hit draft was created.</span><button id="rebaseFreeHit" type="button" class="secondary">Rebase Free Hit comparison</button>`:'';
 if(baselineChanged)$('#rebaseFreeHit').onclick=()=>{freeHit.baselineSignature=benchmark.signature;persistFreeHit();renderFreeHitComparison()};
 const currentCaptainPlayer=current.players.find(player=>Number(player.player_id)===Number(current.captain)),freeHitCaptainPlayer=freeHit.players.find(player=>Number(player.player_id)===Number(freeHit.captain)),currentVice=current.players.find(player=>Number(player.player_id)===Number(current.vice)),freeHitVice=freeHit.players.find(player=>Number(player.player_id)===Number(freeHit.vice)),currentBench=current.bench.reduce((sum,id)=>sum+(finiteMetric(currentProjection[id]?.xPts)??0),0),freeHitBench=freeHit.bench.reduce((sum,id)=>sum+(finiteMetric(freeHitProjection[id]?.xPts)??0),0),currentExposure=squadFixtureExposure(current),freeHitExposure=squadFixtureExposure(freeHit),teamSummary=(label,totals,captain,vice,bench)=>`<div class="gain-team"><h4>${label}</h4><b class="gain-projected">${totals.total.toFixed(1)}</b><span>projected · ${totals.base.toFixed(1)} XI xPts</span><small>Captain ${esc(captain?.name||'—')} · ${totals.captain.toFixed(1)} xPts<br>Vice ${esc(vice?.name||'—')} · Bench ${bench.toFixed(1)} xPts</small></div>`;
 $('#freeHitGainSummary').innerHTML=`<div class="gain-headline">${teamSummary('CURRENT TEAM',currentTotals,currentCaptainPlayer,currentVice,currentBench)}<div class="gain-primary"><b>${gain>=0?'+':''}${gain.toFixed(1)} xPts</b><span>Expected FH gain</span></div>${teamSummary('FREE HIT TEAM',freeHitTotals,freeHitCaptainPlayer,freeHitVice,freeHitBench)}</div>${!currentValid||!freeHitValid?'<div class="free-hit-gain-unavailable">Gain is provisional until both squads and lineups are valid.</div>':''}<div class="gain-exposure-quick"><span>FDR 4–5 · Current <b>${currentExposure.fdr45}</b></span><span>FDR 1–2 · Free Hit <b>${freeHitExposure.fdr12}</b></span><span>Blanks · Current ${currentExposure.blank} / FH <b>${freeHitExposure.blank}</b></span><span>Doubles · Current ${currentExposure.double} / FH <b>${freeHitExposure.double}</b></span></div>`;
 const teamRows=(position,currentIds,freeHitIds)=>{let html=position?`<div class="comparison-position">${position}</div>`:'';for(let index=0;index<Math.max(currentIds.length,freeHitIds.length);index++){const currentId=currentIds[index],freeHitId=freeHitIds[index],currentPlayer=current.players.find(player=>Number(player.player_id)===Number(currentId)),freeHitPlayer=freeHit.players.find(player=>Number(player.player_id)===Number(freeHitId));html+=`<div class="comparison-row">${currentPlayer?comparisonPlayerCard(currentPlayer,currentProjection[currentId],current):'<div class="comparison-player-empty"></div>'}${freeHitPlayer?comparisonPlayerCard(freeHitPlayer,freeHitProjection[freeHitId],freeHit):'<div class="comparison-player-empty"></div>'}</div>`}return html};
 const selectedByPosition=Object.fromEntries(['GK','DEF','MID','FWD'].map(position=>[position,freeHit.players.filter(player=>player.position===position).length])),positionLimits={GK:2,DEF:5,MID:5,FWD:3},addButtons=`<div class="free-hit-add-actions">${Object.entries(positionLimits).map(([position,limit])=>`<button type="button" class="secondary" data-add-position="${position}" ${selectedByPosition[position]>=limit||freeHit.players.length>=15?'disabled':''}>+ ${position} ${selectedByPosition[position]}/${limit}</button>`).join('')}</div>`;
 let teamsHtml=`<div class="comparison-team-head"><div><b>CURRENT TEAM</b><small>${esc(benchmark.source)} · read-only</small></div><div><b>FREE HIT TEAM</b><small>Editable draft</small>${addButtons}</div></div><h3>STARTING XI</h3>`;
 for(const position of ['GK','DEF','MID','FWD']){const currentIds=current.starters.filter(id=>current.players.find(player=>Number(player.player_id)===Number(id))?.position===position),freeHitIds=freeHit.starters.filter(id=>freeHit.players.find(player=>Number(player.player_id)===Number(id))?.position===position);teamsHtml+=teamRows(position,currentIds,freeHitIds)}
 teamsHtml+='<h3 class="comparison-bench-title">BENCH</h3>';
 teamsHtml+=teamRows('',current.bench,freeHit.bench);
 $('#freeHitTeams').innerHTML=teamsHtml;
 document.querySelectorAll('#freeHitTeams [data-current-player]').forEach(button=>button.onclick=()=>showPlayerMenu(Number(button.dataset.currentPlayer),true));
 document.querySelectorAll('#freeHitTeams [data-player]').forEach(button=>button.onclick=()=>pick(Number(button.dataset.player)));
 document.querySelectorAll('#freeHitTeams [data-add-position]').forEach(button=>button.onclick=()=>openTransfer(null,button.dataset.addPosition));
}
function executeFreeHitSwitch(a,b){
 const plan=state.freeHitPlan;if(!plan)return false;const snapshot=structuredClone(plan),starterA=plan.starters.findIndex(id=>Number(id)===Number(a)),starterB=plan.starters.findIndex(id=>Number(id)===Number(b)),benchA=plan.bench.findIndex(id=>Number(id)===Number(a)),benchB=plan.bench.findIndex(id=>Number(id)===Number(b));
 if(Number(a)===Number(b))return null;
 const playerA=plan.players.find(player=>Number(player.player_id)===Number(a))?.player_id,playerB=plan.players.find(player=>Number(player.player_id)===Number(b))?.player_id;
 if(starterA>=0&&starterB>=0)[plan.starters[starterA],plan.starters[starterB]]=[plan.starters[starterB],plan.starters[starterA]];
 else if(benchA>=0&&benchB>=0)[plan.bench[benchA],plan.bench[benchB]]=[plan.bench[benchB],plan.bench[benchA]];
 else if(starterA>=0&&benchB>=0){plan.starters[starterA]=playerB;plan.bench[benchB]=playerA}
 else if(benchA>=0&&starterB>=0){plan.bench[benchA]=playerB;plan.starters[starterB]=playerA}
 else return false;
 const errors=plan.players.length===15?validateFreeHit(plan):freeHitDraftErrors(plan);if(errors.length){state.freeHitPlan=snapshot;freeHitPlans()[state.gw]=snapshot;return false}return true;
}
function advancedModelDiagnostics(x){if(!x)return'';const m=x.minutes||{},r=x.rates||{},c=x.components||{},names={appearance:'Appearance',goals:'Open-play goals',penalties:'Penalties',assists:'Assists',cleanSheet:'Clean sheet',saves:'Saves',defensive:'Defensive',bonus:'Bonus',cards:'Cards',goalsConceded:'Goals conceded'};return`<div class="model-head"><div><b>${x.xPts.toFixed(2)}</b><span>xPts</span></div><div><b>${Math.round(x.xMin)}</b><span>xMin · ${x.confidence}</span></div></div><div class="model-scenarios"><span>Start ${(m.pStart*100).toFixed(0)}%</span><span>Sub ${(m.pSub*100).toFixed(0)}%</span><span>DNP ${(m.pDnp*100).toFixed(0)}%</span></div><div class="multi-gw-list">${(state.multiProjections[Number($('#playerMenu').dataset.id)]?.rows||[]).map(row=>`<div class="multi-gw-row"><b>GW${row.gw}</b><span>${esc(row.fixture)}</span><small>${row.fdr?`FDR ${row.fdr}`:'Blank'}</small><b>${row.xPts.toFixed(2)}</b></div>`).join('')}</div><div class="model-components">${Object.entries(c).filter(([,v])=>Math.abs(v)>.005).map(([k,v])=>`<div><span>${names[k]||k}</span><b>${v>=0?'+':''}${v.toFixed(2)}</b></div>`).join('')}</div><div class="model-rates"><span>Season xG/90 <b>${r.seasonXG90?.toFixed(2)}</b></span><span>Recent xG/90 <b>${r.recentXG90?.toFixed(2)}</b></span><span>Adjusted xG/90 <b>${r.xG90?.toFixed(2)}</b></span><span>Season xA/90 <b>${r.seasonXA90?.toFixed(2)}</b></span><span>Recent xA/90 <b>${r.recentXA90?.toFixed(2)}</b></span><span>Adjusted xA/90 <b>${r.xA90?.toFixed(2)}</b></span><span>Current-season xG/90 <b>${r.currentSeasonXG90?.toFixed(2)??r.seasonXG90?.toFixed(2)}</b></span><span>Previous-season xG/90 <b>${r.previousSeasonXG90?.toFixed(2)??'—'}</b></span><span>Current-season xA/90 <b>${r.currentSeasonXA90?.toFixed(2)??r.seasonXA90?.toFixed(2)}</b></span><span>Previous-season xA/90 <b>${r.previousSeasonXA90?.toFixed(2)??'—'}</b></span><span>Current-season weight <b>${Math.round((r.currentSeasonWeight||0)*100)}%</b></span><span>Previous-season prior weight <b>${Math.round((r.previousSeasonWeight||0)*100)}%</b></span><span>Season reliability <b>${Math.round((r.reliability||0)*100)}%</b></span><span>Recent reliability <b>${Math.round((r.recentReliability||0)*100)}%</b></span><span>Season minutes used <b>${Math.round(r.seasonMinutes||0)}</b></span><span>Current FPL points <b>${Math.round(r.currentPoints||0)}</b></span><span>Current points/90 <b>${r.currentPoints90?.toFixed(2)??'—'}</b></span><span>Previous points/90 <b>${r.previousPoints90?.toFixed(2)??'—'}</b></span><span>Current goals / xG <b>${r.currentGoals??0} / ${r.currentXg?.toFixed(2)??'0.00'}</b></span><span>Goals minus xG <b>${r.goalsMinusXg>=0?'+':''}${r.goalsMinusXg?.toFixed(2)??'0.00'}</b></span><span>Current assists / xA <b>${r.currentAssists??0} / ${r.currentXa?.toFixed(2)??'0.00'}</b></span><span>Assists minus xA <b>${r.assistsMinusXa>=0?'+':''}${r.assistsMinusXa?.toFixed(2)??'0.00'}</b></span><span>Previous goals / xG <b>${r.previousGoals??0} / ${r.previousXg?.toFixed(2)??'0.00'}</b></span><span>Previous assists / xA <b>${r.previousAssists??0} / ${r.previousXa?.toFixed(2)??'0.00'}</b></span><span>Goal conversion factor <b>${r.goalConversionFactor?.toFixed(2)??'1.00'}</b></span><span>Assist conversion factor <b>${r.assistConversionFactor?.toFixed(2)??'1.00'}</b></span><span>Conversion evidence weight <b>${Math.round((r.conversionWeight||0)*100)}%</b></span><span>Underlying points/90 estimate <b>${r.underlyingPoints90?.toFixed(2)??'—'}</b></span><span>Actual vs underlying gap <b>${r.underlyingActualGap>=0?'+':''}${r.underlyingActualGap?.toFixed(2)??'—'}</b></span><span>Expected goals scored by team <b>${x.environment?.expectedTeamGoals?.toFixed(2)??'—'}</b></span><span>Expected goals against <b>${x.environment?.expectedConceded?.toFixed(2)??'—'}</b></span><span>Expected goals scored by opponent <b>${x.environment?.expectedConceded?.toFixed(2)??'—'}</b></span><span>Team attack strength <b>${x.environment?.teamAttack?.toFixed(2)??'—'}</b></span><span>Team season xG/game <b>${x.environment?.teamSeasonXg?.toFixed(2)??'—'}</b></span><span>Team recent-6 xG/game <b>${x.environment?.teamRecentXg?.toFixed(2)??'—'}</b></span><span>Opponent defence factor <b>${x.environment?.opponentDefence?.toFixed(2)??'—'}</b></span><span>Opponent season xGA/game <b>${x.environment?.opponentSeasonXga?.toFixed(2)??'—'}</b></span><span>Opponent recent-6 xGA/game <b>${x.environment?.opponentRecentXga?.toFixed(2)??'—'}</b></span><span>Opponent attack strength <b>${x.environment?.opponentAttack?.toFixed(2)??'—'}</b></span><span>Opponent season xG/game <b>${x.environment?.opponentSeasonXg?.toFixed(2)??'—'}</b></span><span>Opponent recent-6 xG/game <b>${x.environment?.opponentRecentXg?.toFixed(2)??'—'}</b></span><span>Team defence factor <b>${x.environment?.teamDefence?.toFixed(2)??'—'}</b></span><span>Team season xGA/game <b>${x.environment?.teamSeasonXga?.toFixed(2)??'—'}</b></span><span>Team recent-6 xGA/game <b>${x.environment?.teamRecentXga?.toFixed(2)??'—'}</b></span><span>Team current-season weight <b>${Math.round((x.environment?.teamCurrentSeasonWeight||0)*100)}%</b></span><span>Opponent current-season weight <b>${Math.round((x.environment?.opponentCurrentSeasonWeight||0)*100)}%</b></span><span>Fixture blend <b>${x.environment?.fixtureBlend??'—'}</b></span><span>Team data source <b>${x.environment?.teamDataSource??'Worker endpoint'}</b></span><span>Clean-sheet chance <b>${Math.round((x.environment?.cleanSheetProbability||0)*100)}%</b></span><span>Raw goal share <b>${x.allocation?.rawGoalShare!=null?(x.allocation.rawGoalShare*100).toFixed(1)+'%':'—'}</b></span><span>Shrunk goal share <b>${x.allocation?.goalShare!=null?(x.allocation.goalShare*100).toFixed(1)+'%':'—'}</b></span><span>Raw assist share <b>${x.allocation?.rawAssistShare!=null?(x.allocation.rawAssistShare*100).toFixed(1)+'%':'—'}</b></span><span>Shrunk assist share <b>${x.allocation?.assistShare!=null?(x.allocation.assistShare*100).toFixed(1)+'%':'—'}</b></span><span>Goal share confidence <b>${Math.round((x.allocation?.goalWeight||0)*100)}%</b></span><span>Goal cross-season consistency <b>${Math.round((x.allocation?.goalConsistency||0)*100)}%</b></span><span>Assist share confidence <b>${Math.round((x.allocation?.assistWeight||0)*100)}%</b></span><span>Assist cross-season consistency <b>${Math.round((x.allocation?.assistConsistency||0)*100)}%</b></span><span>Team player xG total <b>${x.allocation?.teamXg?.toFixed(2)??'—'}</b></span><span>Team player xA total <b>${x.allocation?.teamXa?.toFixed(2)??'—'}</b></span><span>Set-piece role <b>${x.roles?.penalty?'Pens':x.roles?.direct?'Direct FK':x.roles?.corners?'Corners':'None'}</b></span></div>`}
function playerTrend(player,projection){
 const rates=projection?.rates||{},history=(state.details[player.player_id]?.recent_history||[]).filter(row=>Number(row.minutes)>0),recent=history.slice(-3),baseline=history.slice(0,-3),rate=(rows,key)=>{const minutes=rows.reduce((sum,row)=>sum+Number(row.minutes||0),0),total=rows.reduce((sum,row)=>sum+Number(row[key]??(key==='xGI'?Number(row.xG||0)+Number(row.xA||0):0)),0);return minutes>=90?total*90/minutes:null},mean=(rows,fn)=>rows.length?rows.reduce((sum,row)=>sum+fn(row),0)/rows.length:null,clamp01=value=>Math.max(-1,Math.min(1,value));
 const seasonXgi=Number(player.xGI??(Number(player.xG||0)+Number(player.xA||0))),seasonMinutes=Number(player.minutes||rates.seasonMinutes||0),seasonXgi90=seasonMinutes>0?seasonXgi*90/seasonMinutes:Number(rates.seasonXG90||0)+Number(rates.seasonXA90||0),recentXgi90=rate(recent,'xGI'),recentStart=mean(recent,row=>Number(row.starts??(Number(row.minutes)>=45?1:0))),baselineStart=mean(baseline,row=>Number(row.starts??(Number(row.minutes)>=45?1:0))),recentMinutes=mean(recent,row=>Number(row.minutes)),baselineMinutes=mean(baseline,row=>Number(row.minutes)),recentPoints90=rate(recent,'points'),baselinePoints90=rate(baseline,'points'),recentDefcon90=recent.some(row=>row.defensive_contribution!=null)?rate(recent,'defensive_contribution'):null,baselineDefcon90=baseline.some(row=>row.defensive_contribution!=null)?rate(baseline,'defensive_contribution'):null;
 const signals=[];if(recentXgi90!=null&&seasonXgi90>.05)signals.push({name:'xGI',value:clamp01((recentXgi90/seasonXgi90-1)/.4),change:(recentXgi90/seasonXgi90-1)*100,weight:.36});
 if(recentStart!=null&&baselineStart!=null){const recentSecurity=.6*recentStart+.4*Math.min(1,recentMinutes/90),baseSecurity=.6*baselineStart+.4*Math.min(1,baselineMinutes/90);signals.push({name:'minutes',value:clamp01((recentSecurity-baseSecurity)/.3),change:(recentSecurity-baseSecurity)*100,weight:.28})}
 const team=strengthForTeam(player.team);if(team&&Number(team.season_xg_per_game)>0&&Number(team.recent6_xg_per_game)>0)signals.push({name:'team attack',value:clamp01((Number(team.recent6_xg_per_game)/Number(team.season_xg_per_game)-1)/.35),change:(Number(team.recent6_xg_per_game)/Number(team.season_xg_per_game)-1)*100,weight:.16});
 if(recentDefcon90!=null&&baselineDefcon90!=null&&['DEF','MID','FWD'].includes(player.position)&&baselineDefcon90>.05)signals.push({name:'DefCon',value:clamp01((recentDefcon90/baselineDefcon90-1)/.5),change:(recentDefcon90/baselineDefcon90-1)*100,weight:.12});
 if(recentPoints90!=null&&baselinePoints90!=null&&baselinePoints90>.05)signals.push({name:'points',value:clamp01((recentPoints90/baselinePoints90-1)/.6),change:(recentPoints90/baselinePoints90-1)*100,weight:.08});
 const weight=signals.reduce((sum,item)=>sum+item.weight,0),score=weight?signals.reduce((sum,item)=>sum+item.value*item.weight,0)/weight:0,direction=score>=.16?'↑ Improving':score<=-.16?'↓ Declining':'→ Stable',leading=signals.filter(item=>item.name!=='points').sort((a,b)=>Math.abs(b.value*b.weight)-Math.abs(a.value*a.weight))[0],minuteText=recentStart==null?'minutes unavailable':baselineStart==null?'minutes sample short':Math.abs(recentStart-baselineStart)<.12?'minutes stable':recentStart>baselineStart?'starts improving':'starts easing',reason=leading&&Math.abs(leading.change)>=8?`${leading.name} ${leading.change>0?'+':''}${Math.round(leading.change)}%, ${minuteText}`:`mixed recent signals, ${minuteText}`;
 return{label:direction,reason,recentXgi90,seasonXgi90,recentPoints90,recentDefcon90,recentStart,score};
}
function setPieceRoles(player){const universe=state.players.find(item=>Number(item.id)===Number(player.player_id))||{},role=(order)=>Number(order)===1?'Lead':Number(order)===2?'Backup':Number(order)>2?'Listed':'—';return{penalties:role(universe.penalties_order),direct:role(universe.direct_freekicks_order),corners:role(universe.corners_and_indirect_freekicks_order)}}
function decisionFixtureRows(player,multi){
 return`<div class="decision-fixture-strip">${(multi?.rows||[]).slice(0,3).map(row=>{const fixtures=fixtureForGw(player,row.gw),label=fixtures.length?fixtures.map(item=>`${item.opponent} (${item.home?'H':'A'})`).join(' · '):'Blank',difficulty=fixtures.length?Math.round(fixtures.reduce((sum,item)=>sum+Number(item.difficulty||3),0)/fixtures.length):null;return`<div class="decision-fixture ${fixtures.length?`fdr-${difficulty}`:'blank'}"><b>GW${row.gw}</b><span>${esc(label)}</span><small>${difficulty?`FDR ${difficulty}`:'—'}</small><strong>${row.xPts.toFixed(1)} xPts</strong></div>`}).join('')}</div>`;
}
function lastThreeResults(player){
 const history=(state.details[player.player_id]?.recent_history||[]).filter(row=>Number(row.gameweek??row.round??row.event)<=Number(state.completedEvents?.[0]?.id||0)).slice(-3);
 if(!history.length)return'<p class="empty-results">No completed player fixtures available.</p>';
 return`<div class="decision-results-strip">${history.map(row=>{const gw=Number(row.gameweek??row.round??row.event),opponentTeam=state.players.find(item=>Number(item.team_id)===Number(row.opponent_team))?.team,fixtures=state.fixtures.filter(item=>Number(item.gameweek)===gw&&(item.home===player.team||item.away===player.team)),fixture=fixtures.find(item=>(item.home===player.team?item.away:item.home)===opponentTeam)||fixtures[0],opponent=fixture?(fixture.home===player.team?fixture.away:fixture.home):(opponentTeam||row.opponent_name||row.opponent||'—'),venue=fixture?(fixture.home===player.team?'H':'A'):null,points=Number(row.points??row.total_points??0),minutes=Number(row.minutes||0),goals=Number(row.goals_scored??row.goals??0),assists=Number(row.assists||0),bonus=Number(row.bonus||0),clean=Number(row.clean_sheets??row.clean_sheet??0)>0;return`<div class="decision-result"><b>GW${gw}${venue?` · ${esc(opponent)} (${venue})`:opponent!=='—'?` · ${esc(opponent)}`:''}</b><strong>${points} pts · ${minutes} min</strong><small>${[goals?`${goals} goal${goals===1?'':'s'}`:'',assists?`${assists} assist${assists===1?'':'s'}`:'',bonus?`${bonus} bonus`:'',['GK','DEF'].includes(player.position)?(clean?'Clean sheet':'No clean sheet'):''].filter(Boolean).join(' · ')||'No goals, assists or bonus'}</small></div>`}).join('')}</div>`;
}
function decisionMetrics(player,projection,multi,freeHitMode=false,targetMode=false){
 const rates=projection?.rates||{},minutes=projection?.minutes||{},expected=expectedMinutes(projection),roles=setPieceRoles(player),trend=playerTrend(player,projection),price=Number(player.price||0),ownership=state.players.find(item=>Number(item.id)===Number(player.player_id))?.ownership,primary=freeHitMode?Number(projection?.xPts||0):Number(multi?.xPts3||0),value=price>0?primary/price:0,universePlayer=state.players.find(item=>Number(item.id)===Number(player.player_id)),owned=ownership==null&&universePlayer?.selected_by_percent==null?'—':`${Number(ownership??universePlayer.selected_by_percent).toFixed(1)}%`,xgi90=Number(rates.seasonXG90||0)+Number(rates.seasonXA90||0),defcon90=trend.recentDefcon90,cleanSheet=Number(projection?.environment?.cleanSheetProbability||0);
 return`<div class="decision-player-meta"><span>${esc(player.position)}</span><span>£${price.toFixed(1)}m</span><span>${owned} owned</span></div><div class="decision-primary"><div><small>${freeHitMode?'1GW':'3GW'} xPts</small><strong>${primary.toFixed(1)}</strong><small>${freeHitMode?'Free Hit horizon':'Primary transfer horizon'}</small></div><div class="decision-minutes"><b>${expected===null?'—':Math.round(expected)} min</b><span>${Math.round(Number(minutes.pStart||0)*100)}% start · ${esc(projection?.confidence||'LOW')} certainty</span></div></div><div class="decision-horizons"><span>1GW <b>${Number(projection?.xPts||0).toFixed(1)}</b></span>${freeHitMode?'':`<span>5GW <b>${Number(multi?.xPts5||0).toFixed(1)}</b></span><span>3GW / £m <b>${value.toFixed(2)}</b></span>`}</div><section class="decision-fixtures"><h4>Upcoming fixtures</h4>${decisionFixtureRows(player,multi)}</section>${targetMode?`<div class="transfer-priority-metrics"><span>xGI/90 <b>${xgi90.toFixed(2)}</b></span><span>Points/90 <b>${Number(rates.currentPoints90||0).toFixed(2)}</b></span><span>Clean sheet <b>${(cleanSheet*100).toFixed(0)}%</b></span><span>DefCon/90 <b>${defcon90==null?'—':defcon90.toFixed(2)}</b></span><span>Trend <b>${esc(trend.label)}</b><small>${esc(trend.reason)}</small></span><span>Set pieces <b>Pens ${esc(roles.penalties)} · FK ${esc(roles.direct)} · Corners ${esc(roles.corners)}</b></span></div>`:`<section class="decision-results"><h4>Last 3 results</h4>${lastThreeResults(player)}</section><section class="decision-roles"><h4>Set pieces</h4><div class="role-badges"><span>Pens <b>${roles.penalties}</b></span><span>Direct FK <b>${roles.direct}</b></span><span>Corners <b>${roles.corners}</b></span></div><small class="decision-trend-inline">${esc(trend.label)} · ${esc(trend.reason)}</small></section>`}`;
}
function modelBreakdown(player,x,freeHitMode=false){
 if(!x)return'';const multi=freeHitMode?multiProject(player,5):state.multiProjections[player.player_id],normal=decisionMetrics(player,x,multi,freeHitMode);
 return`<div class="decision-view">${normal}</div>${DEBUG_MODE?`<section class="advanced-diagnostics"><h4>Advanced model diagnostics</h4>${advancedModelDiagnostics(x)}</section>`:''}`;
}
function showPlayerMenu(id,readOnly=false){
 state.selected=null;const freeHitMode=state.activeView==='freehit',plan=readOnly?state.currentTeamBenchmark?.plan:freeHitMode?state.freeHitPlan:state.plan,projections=readOnly?state.currentTeamBenchmark?.projections:freeHitMode?state.freeHitProjections:state.projections,p=plan?.players.find(item=>Number(item.player_id)===Number(id));if(!p)return;state.readOnlyPlayerMenu=readOnly;
 $('#menuName').textContent=p.name;$('#playerMenu').dataset.id=id;$('#menuFixture').textContent='';$('#menuFixture').hidden=true;$('#playerReplaceAction').textContent=freeHitMode?'Replace in Free Hit':'Plan transfer';
 for(const selector of ['#playerCaptainAction','#playerViceAction','#playerSwitchAction','#playerReplaceAction'])$(selector).hidden=readOnly;
 const eligibleCaptain=!freeHitMode||plan.starters.some(starter=>Number(starter)===Number(id));$('#playerCaptainAction').disabled=!eligibleCaptain;$('#playerViceAction').disabled=!eligibleCaptain;$('#playerCaptainAction').title=eligibleCaptain?'':'Only starting players can be captain';$('#playerViceAction').title=eligibleCaptain?'':'Only starting players can be vice-captain';
 $('#modelBreakdown').innerHTML=modelBreakdown(p,projections?.[id],freeHitMode);$('#playerMenu').showModal();if(freeHitMode)renderFreeHitComparison();else render();
}
function executeSwitch(a,b){
 clearSwitchMode();
 const plan=state.plan;inspectPlanIntegrity(plan,`before lineup switch GW${state.gw}`);
 if(!ensurePlannerIntegrity())return false;
 const snapshot={starters:[...plan.starters],bench:[...plan.bench]};
 const starterA=plan.starters.findIndex(id=>Number(id)===Number(a)),starterB=plan.starters.findIndex(id=>Number(id)===Number(b)),benchA=plan.bench.findIndex(id=>Number(id)===Number(a)),benchB=plan.bench.findIndex(id=>Number(id)===Number(b));
 if(Number(a)===Number(b))return null;
 const playerAId=plan.players.find(player=>Number(player.player_id)===Number(a))?.player_id,playerBId=plan.players.find(player=>Number(player.player_id)===Number(b))?.player_id;
 if(starterA>=0&&starterB>=0)[plan.starters[starterA],plan.starters[starterB]]=[plan.starters[starterB],plan.starters[starterA]];
 else if(benchA>=0&&benchB>=0)[plan.bench[benchA],plan.bench[benchB]]=[plan.bench[benchB],plan.bench[benchA]];
 else if(starterA>=0&&benchB>=0){plan.starters[starterA]=playerBId;plan.bench[benchB]=playerAId}
 else if(benchA>=0&&starterB>=0){plan.bench[benchA]=playerBId;plan.starters[starterB]=playerAId}
 else return false;
 inspectPlanIntegrity(plan,`after lineup switch GW${state.gw}`);
 if(!ensurePlannerIntegrity()){plan.starters=snapshot.starters;plan.bench=snapshot.bench;return false}
 if(!persistPlannerState({invalidateFuture:true})){plan.starters=snapshot.starters;plan.bench=snapshot.bench;clearSwitchMode();return false}
 return true;
}
function pick(id){
 if(state.activeView==='freehit'){
  if(state.switchingId!==null){const from=Number(state.switchingId);if(from===Number(id)){clearSwitchMode();renderFreeHit();return}const snapshot=structuredClone(state.freeHitPlan);clearSwitchMode();if(!executeFreeHitSwitch(from,Number(id))){$('#freeHitValidation').innerHTML='<div class="alert">This switch would create an invalid Free Hit squad or formation. The draft was unchanged.</div>';renderFreeHit();return}if(!persistFreeHit()){state.freeHitPlan=snapshot;$('#freeHitValidation').innerHTML=`<div class="alert">${esc(state.freeHitSaveError)}</div>`}renderFreeHit();return}
  showPlayerMenu(id);return;
 }
 if(state.switchingId!==null){
  const from=Number(state.switchingId);if(from===Number(id)){clearSwitchMode();render();return}
  clearSwitchMode();if(!executeSwitch(from,Number(id))){$('#alerts').innerHTML='<div class="alert">Switch cancelled: the lineup is invalid or could not be saved.</div>';render();return}
  $('#alerts').innerHTML='';render();return;
 }
 showPlayerMenu(id);
}
function validFormation(plan=state.plan){
 if(!plan||!Array.isArray(plan.players)||!Array.isArray(plan.starters)||plan.starters.length!==11)return false;
 const counts={GK:0,DEF:0,MID:0,FWD:0};
 for(const id of plan.starters){const player=plan.players.find(item=>Number(item?.player_id)===Number(id));if(!player)return false;counts[player.position]=(counts[player.position]||0)+1}
 return counts.GK===1&&counts.DEF>=3&&counts.DEF<=5&&counts.MID>=2&&counts.MID<=5&&counts.FWD>=1&&counts.FWD<=3;
}
$('#playerMenu').addEventListener('close',()=>{
 const id=Number($('#playerMenu').dataset.id),v=$('#playerMenu').returnValue,freeHitMode=state.activeView==='freehit',plan=freeHitMode?state.freeHitPlan:state.plan;
 if(state.readOnlyPlayerMenu){state.readOnlyPlayerMenu=false;renderFreeHit();return}
 if(v==='switch'){beginSwitchMode(id);if(freeHitMode)renderFreeHit();else render();return}
 clearSwitchMode();
 if(v==='captain'||v==='vice'){
  const snapshot=structuredClone(plan);if(v==='captain'){plan.captain=id;if(Number(plan.vice)===id)plan.vice=plan.starters.find(x=>Number(x)!==id)}else{plan.vice=id;if(Number(plan.captain)===id)plan.captain=plan.starters.find(x=>Number(x)!==id)}
  if(freeHitMode&&!persistFreeHit())state.freeHitPlan=snapshot;
 }
 if(v==='transfer'){openTransfer(id);return}
 if(freeHitMode){if(v!=='captain'&&v!=='vice')persistFreeHit();renderFreeHit()}else{persist();render()}
});
$('#cancelSwitch').onclick=()=>{clearSwitchMode();render()};
$('#cancelFreeHitSwitch').onclick=()=>{clearSwitchMode();renderFreeHit()};
$('#bestXi').onclick=()=>{const plan=state.plan;if(!plan)return;const snapshot=structuredClone(plan),originalPlans=structuredClone(db.managers?.[state.managerId]?.plans||{}),b=bestLineup(plan.players,state.projections);if(!b)return;plan.starters=[...b.starters];plan.bench=plan.players.map(player=>player.player_id).filter(id=>!b.starters.includes(id));const ranked=[...b.starters].sort((a,c)=>state.projections[c].xPts-state.projections[a].xPts);plan.captain=ranked[0];plan.vice=ranked[1];invalidateFuturePlans();if(!persist()){db.managers[state.managerId].plans=originalPlans;state.plan=db.managers[state.managerId].plans[state.gw]||snapshot}render()};
$('#optimizeFreeHitXi').onclick=()=>{const plan=state.freeHitPlan;if(!plan)return;const rosterErrors=freeHitRosterErrors(plan);if(rosterErrors.length){$('#freeHitValidation').innerHTML=`<div class="alert">Complete the 15-player squad before optimizing the XI: ${esc(rosterErrors[0])}</div>`;return}const snapshot=structuredClone(plan),best=bestLineup(plan.players,state.freeHitProjections);if(!best){$('#freeHitValidation').innerHTML='<div class="alert">Could not find a valid starting XI in this Free Hit squad.</div>';return}plan.starters=best.starters;plan.bench=plan.players.map(player=>player.player_id).filter(id=>!best.starters.includes(id));const ranked=[...best.starters].sort((a,b)=>Number(state.freeHitProjections[b]?.xPts||0)-Number(state.freeHitProjections[a]?.xPts||0));plan.captain=ranked[0];plan.vice=ranked[1];if(!persistFreeHit()){state.freeHitPlan=snapshot;$('#freeHitValidation').innerHTML=`<div class="alert">${esc(state.freeHitSaveError)}</div>`}renderFreeHit()};
$('#highestFreeHitCaptain').onclick=()=>{const plan=state.freeHitPlan;if(!plan)return;const rosterErrors=freeHitRosterErrors(plan);if(rosterErrors.length||plan.starters.length!==11||!validFreeHitFormation(plan)){$('#freeHitValidation').innerHTML=`<div class="alert">Complete a valid squad and starting XI before choosing a captain${rosterErrors.length?`: ${esc(rosterErrors[0])}`:'.'}</div>`;return}const snapshot=structuredClone(plan),ranked=[...plan.starters].sort((a,b)=>Number(state.freeHitProjections[b]?.xPts||0)-Number(state.freeHitProjections[a]?.xPts||0));if(ranked.length<2)return;plan.captain=ranked[0];plan.vice=ranked[1];if(!persistFreeHit()){state.freeHitPlan=snapshot;$('#freeHitValidation').innerHTML=`<div class="alert">${esc(state.freeHitSaveError)}</div>`}renderFreeHit()};
$('#resetFreeHit').onclick=()=>{if(!window.confirm(`Reset the Free Hit draft for GW${state.gw} to an empty team?`))return;openFreeHit(state.gw,true)};
function transferCost(){const used=state.plan?.transfers?.length||0,free=Math.max(0,Number(state.plan?.freeTransfers||0)),paid=Math.max(0,used-free);return{used,free,paid,points:paid*4}}
function updatePlanMeta(){if(!state.plan)return;state.plan.endingBank=plannedBank();state.plan.hitPoints=transferCost().points;state.plan.nextFreeTransfers=Math.min(5,Math.max(1,Number(state.plan.freeTransfers||0)-state.plan.transfers.length+1))}
function invalidateFuturePlans(){const plans=db.managers?.[state.managerId]?.plans||{};for(const key of Object.keys(plans))if(Number(key)>Number(state.gw))delete plans[key]}
function renderPlanningStatus(){if(!state.plan)return;const input=$('#freeTransfers');if(input&&document.activeElement!==input)input.value=String(state.plan.freeTransfers??1);const c=transferCost(),el=$('#hitStatus');el.className=`hit-status ${c.points?'hit':'free'}`;el.innerHTML=c.used===0?`<b>${c.free} FT available</b><small>No transfers planned</small>`:c.points?`<b>-${c.points} point hit</b><small>${c.used} planned · ${c.free} free · ${c.paid} paid</small>`:`<b>No hit</b><small>${c.used} planned within ${c.free} FT</small>`}
function renderPlanSummary(){const el=$('#planSummary'),c=transferCost();if(!state.plan?.transfers?.length){el.innerHTML='';return}el.innerHTML=`<div class="plan-overview"><div class="plan-overview-head"><div><strong>GW${state.gw} plan</strong><small>${c.free} FT · ${c.used} used · £${plannedBank().toFixed(1)} bank</small></div><b>${c.points?`-${c.points} pts`:'No hit'}</b></div>${state.plan.transfers.map((t,i)=>`<div class="plan-transfer"><span><b>${esc(t.out.name)}</b> → <b>${esc(t.in.name)}</b><br><small>Sell £${Number(t.salePrice??t.out.price).toFixed(1)} · buy £${Number(t.buyPrice??t.in.price).toFixed(1)}</small></span><button class="undo-transfer" data-undo-transfer="${i}">Undo</button></div>`).join('')}</div>`;el.querySelectorAll('[data-undo-transfer]').forEach(button=>button.onclick=()=>undoTransfer(Number(button.dataset.undoTransfer)))}
function undoTransfer(index){
 const t=state.plan.transfers[index];if(!t)return;
 const snapshot=structuredClone(state.plan),originalPlans=structuredClone(db.managers?.[state.managerId]?.plans||{});
 state.plan.players=state.plan.players.map(player=>Number(player.player_id)===Number(t.in.player_id)?t.out:player);
 state.plan.starters=state.plan.starters.map(id=>Number(id)===Number(t.in.player_id)?t.out.player_id:id);
 state.plan.bench=state.plan.bench.map(id=>Number(id)===Number(t.in.player_id)?t.out.player_id:id);
 if(Number(state.plan.captain)===Number(t.in.player_id))state.plan.captain=t.out.player_id;
 if(Number(state.plan.vice)===Number(t.in.player_id))state.plan.vice=t.out.player_id;
 state.plan.transfers.splice(index,1);updatePlanMeta();invalidateFuturePlans();
 if(!persist()){db.managers[state.managerId].plans=originalPlans;state.plan=db.managers[state.managerId].plans[state.gw]||snapshot}
 calculate();render();
}
function plannedBank(){if(!state.plan)return Number(state.manager?.bank||0);return Number(state.plan.startingBank??state.manager.bank??0)+state.plan.transfers.reduce((sum,t)=>sum+Number(t.salePrice??t.out.price)-Number(t.in.price),0)}
function rankTransferCandidate(player){const multi=state.multiProjections?.[Number(player.id)]||state.multiProjections?.[player.id]||{};let score=Number(player.total_points||0);if(Number.isFinite(Number(multi.xPts3)))score=Math.max(score,Number(multi.xPts3));if(Number.isFinite(Number(multi.xPts5)))score=Math.max(score,Number(multi.xPts5));if(Number.isFinite(Number(player.price)))score+=Number(player.price)*0.4;return score}
function openTransfer(id,addPosition=null){
 const freeHitMode=state.activeView==='freehit',plan=freeHitMode?state.freeHitPlan:state.plan;state.transferWorkspace=freeHitMode?'freehit':'planner';state.transferAddPosition=freeHitMode&&addPosition?String(addPosition):null;state.transferOut=state.transferAddPosition?null:plan.players.find(player=>Number(player.player_id)===Number(id));if(!state.transferOut&&!state.transferAddPosition)return;
 $('#transferTitle').textContent=state.transferAddPosition?`Add ${state.transferAddPosition} to Free Hit`:freeHitMode?`Replace in Free Hit: ${state.transferOut.name}`:`Replace ${state.transferOut.name}`;$('#confirmTransfer').textContent=state.transferAddPosition?'Add to Free Hit':freeHitMode?'Replace in Free Hit':'Add to plan';$('#sellingPrice').parentElement.hidden=freeHitMode;
 const teams=[...new Map(state.players.map(player=>[player.team_id,{id:player.team_id,name:player.team_name||player.team}])).values()].sort((a,b)=>a.name.localeCompare(b.name));$('#targetTeam').innerHTML=teams.map(team=>`<option value="${team.id}">${esc(team.name)}</option>`).join('');$('#targetTeam').value=String(teams[0]?.id||'');state.transferTop15Only=false;$('#topPerformersBtn').textContent='Top 15 performers';$('#topPerformersBtn').dataset.active='0';
 const prior=freeHitMode||!state.transferOut?null:state.plan.transfers.find(transfer=>Number(transfer.in.player_id)===Number(state.transferOut.player_id));$('#sellingPrice').value=Number(prior?.in?.price??state.transferOut?.price??0).toFixed(1);renderTargetPlayers();$('#transferDialog').showModal();
}
function renderTargetPlayers(){
 const out=state.transferOut,position=state.transferAddPosition||out?.position,team=Number($('#targetTeam').value),freeHitMode=state.transferWorkspace==='freehit',plan=freeHitMode?state.freeHitPlan:state.plan;if(!position||!plan)return;
 const outgoingId=Number(out?.player_id),ids=new Set(plan.players.map(player=>Number(player.player_id))),clubs=new Map();for(const player of plan.players)if(!out||Number(player.player_id)!==outgoingId)clubs.set(player.team,(clubs.get(player.team)||0)+1);
 const cost=plan.players.reduce((sum,player)=>sum+Number(player.price||0),0),maxSpend=freeHitMode?Number(plan.budget)-cost+Number(out?.price||0):Infinity,positionCount=plan.players.filter(player=>player.position===position&&(!out||Number(player.player_id)!==outgoingId)).length,positionLimit={GK:2,DEF:5,MID:5,FWD:3}[position];
 let rows=state.players.filter(player=>Number(player.team_id)===team&&player.position===position&&!ids.has(Number(player.id))&&(!freeHitMode||(positionCount<(positionLimit||0)&&Number(player.price)<=maxSpend+.001&&(clubs.get(player.team)||0)<3))).sort((a,b)=>rankTransferCandidate(b)-rankTransferCandidate(a)||a.price-b.price||a.name.localeCompare(b.name));
 if(state.transferTop15Only)rows=rows.slice(0,15);$('#targetPlayer').innerHTML=rows.length?rows.map(player=>`<option value="${player.id}">${esc(player.name)} · £${player.price.toFixed(1)}${freeHitMode?` · ${esc(freeHitTargetFixtureLabel(player))}`:''}</option>`).join(''):'<option value="">No eligible players</option>';$('#targetPlayer').dataset.poolCount=String(rows.length);
 const current=Number($('#targetPlayer').value),fallback=rows.find(player=>Number(player.id)===current)||rows[0];if(fallback)$('#targetPlayer').value=String(fallback.id);$('#topPerformersBtn').textContent=state.transferTop15Only?'Showing top 15':'Top 15 performers';$('#topPerformersBtn').dataset.active=state.transferTop15Only?'1':'0';renderTransferConsequence();
}
async function renderFreeHitTransferConsequence(request,out,target){
 const plan=state.freeHitPlan,addPosition=state.transferAddPosition;if((!out&&!addPosition)||!target||!plan){$('#transferConsequence').innerHTML='';$('#confirmTransfer').disabled=true;return}
 const bank=Number(plan.budget)-plan.players.reduce((sum,player)=>sum+Number(player.price||0),0),released=Number(out?.price||0),after=bank+released-Number(target.price||0),clubs=new Map();
 for(const player of plan.players)if(!out||Number(player.player_id)!==Number(out.player_id))clubs.set(player.team,(clubs.get(player.team)||0)+1);
 const position=addPosition||out.position,duplicate=plan.players.some(player=>Number(player.player_id)===Number(target.id)),violatesClub=(clubs.get(target.team)||0)>=3,positionLimit={GK:2,DEF:5,MID:5,FWD:3}[position],positionCount=plan.players.filter(player=>player.position===position&&(!out||Number(player.player_id)!==Number(out.player_id))).length,violatesPosition=positionCount>=(positionLimit||0)||target.position!==position;
 $('#budgetBefore').innerHTML=`<div class="budget-grid"><div><span>Free Hit bank</span><b>£${bank.toFixed(1)}</b></div><div><span>${out?'Player released':'Player cost'}</span><b>${out?`£${released.toFixed(1)}`:`£${Number(target.price||0).toFixed(1)}`}</b></div><div><span>${out?'Max spend':'Bank after addition'}</span><b>£${(out?bank+released:after).toFixed(1)}</b></div></div>`;
 $('#confirmTransfer').disabled=true;$('#transferConsequence').innerHTML='<p class="hint">Loading 1GW xPts and start security…</p>';
 if(violatesClub||duplicate||violatesPosition||after<-.001){$('#transferConsequence').innerHTML=`<div class="alert">${violatesClub?'This would exceed the maximum of three players from one club.':duplicate?'This player is already in the Free Hit squad.':violatesPosition?'This would exceed the position limit or select the wrong position.':`£${Math.abs(after).toFixed(1)}m over the Free Hit budget.`}</div>`;return}
 try{
  const detail=state.details[target.id]||await endpoints.player(target.id);if(request!==transferPreviewRequest)return;state.details[target.id]=detail;
  const player={...target,player_id:Number(target.id)},fixtures=fixtureForGw(player,state.gw),items=fixtures.map(match=>project(player,detail,match,modelContext(player,state.gw))),projection=items[0]||project(player,detail,null,modelContext(player,state.gw));
  projection.xPts=items.reduce((sum,item)=>sum+item.xPts,0);const minuteValues=items.map(item=>expectedMinutes(item)).filter(value=>value!==null);projection.xMin=items.length?(minuteValues.length?Math.max(...minuteValues):null):0;
  const current=out?Number(state.freeHitProjections[out.player_id]?.xPts||0):null,gain=current===null?null:projection.xPts-current,profile=decisionMetrics(player,projection,multiProject(player,5),true,true),fixtureLabel=fixtures.length?fixtures.map(match=>`${match.opponent} (${match.home?'H':'A'})`).join(' · '):'Blank';
  $('#transferConsequence').innerHTML=`<div class="consequence"><div class="consequence-row"><span>${out?'Bank after replacement':'Bank after addition'}</span><b>£${after.toFixed(1)}m</b></div><div class="transfer-decision"><h4>Free Hit target · GW${state.gw}</h4><div class="transfer-gain"><span>${out?'1GW gain':'Target 1GW xPts'}</span><b>${gain===null?projection.xPts.toFixed(1):`${gain>=0?'+':''}${gain.toFixed(1)}`} xPts</b><small>${out?`${projection.xPts.toFixed(1)} target · ${current.toFixed(1)} player out`:'Player xPts is unchanged by lineup totals until selected as captain.'}</small></div><div class="consequence-row"><span>Next fixture(s)</span><b>${esc(fixtureLabel)}</b></div>${profile}</div></div>`;
  $('#confirmTransfer').disabled=false;
 }catch(error){if(request!==transferPreviewRequest)return;$('#transferConsequence').innerHTML=`<div class="alert">Could not load target details: ${esc(error.message)}</div>`}
}
let transferPreviewRequest=0;
async function renderTransferConsequence(){
 const request=++transferPreviewRequest,out=state.transferOut,target=state.players.find(p=>p.id===Number($('#targetPlayer').value)),bank=plannedBank(),salePrice=Math.max(0,Number($('#sellingPrice').value||out?.price||0));
 if(state.transferWorkspace==='freehit'){await renderFreeHitTransferConsequence(request,out,target);return}
 $('#budgetBefore').innerHTML=`<div class="budget-grid"><div><span>Bank now</span><b>£${bank.toFixed(1)}</b></div><div><span>Selling</span><b>£${salePrice.toFixed(1)}</b></div><div><span>Max spend</span><b>£${(bank+salePrice).toFixed(1)}</b></div></div>`;
 if(!out||!target){$('#transferConsequence').innerHTML='';$('#confirmTransfer').disabled=true;return}
 const after=bank+salePrice-target.price,diff=target.price-salePrice,f=fixture({...target,player_id:target.id}),poolCount=Number($('#targetPlayer').dataset.poolCount||0);
 $('#confirmTransfer').disabled=true;$('#transferConsequence').innerHTML=`<div class="consequence"><div class="consequence-row"><span>Available from club</span><b>${poolCount}</b></div><div class="consequence-row"><span>Price difference</span><b>${diff>0?'+':''}£${diff.toFixed(1)}</b></div><div class="consequence-row"><span>Bank after transfer</span><b class="${after<0?'over':'under'}">£${after.toFixed(1)}</b></div><div class="consequence-row"><span>Next fixture</span><b>${f?`${esc(f.opponent)} ${f.home?'H':'A'}`:'—'}</b></div><p class="hint">Loading target form, projections and fixture outlook…</p>${after<0?`<div class="alert">£${Math.abs(after).toFixed(1)}m over budget. Visible for comparison, but cannot be added.</div>`:''}</div>`;
 try{
  const detail=state.details[target.id]||await endpoints.player(target.id);if(request!==transferPreviewRequest)return;state.details[target.id]=detail;
  const player={...target,player_id:Number(target.id)},one=project(player,detail,fixture(player),modelContext(player)),multi=multiProject(player,5),outMulti=state.multiProjections[out.player_id],gain3=outMulti&&Number.isFinite(outMulti.xPts3)&&Number.isFinite(multi.xPts3)?multi.xPts3-outMulti.xPts3:null,gain5=outMulti&&Number.isFinite(outMulti.xPts5)&&Number.isFinite(multi.xPts5)?multi.xPts5-outMulti.xPts5:null,used=Number(state.plan.transfers?.length||0),free=Math.max(0,Number(state.plan.freeTransfers||0)),additionalHits=Math.max(0,used+1-free)-Math.max(0,used-free);
  const decision=decisionMetrics(player,one,multi,false,true),out3=Number(outMulti?.xPts3),out5=Number(outMulti?.xPts5),gainText=value=>`${value>=0?'+':''}${value.toFixed(1)}`;
  if(request!==transferPreviewRequest)return;
  $('#transferConsequence').innerHTML=`<div class="consequence"><div class="consequence-row"><span>Available from club</span><b>${poolCount}</b></div><div class="consequence-row"><span>Price difference</span><b>${diff>0?'+':''}£${diff.toFixed(1)}</b></div><div class="consequence-row"><span>Bank after transfer</span><b class="${after<0?'over':'under'}">£${after.toFixed(1)}</b></div><div class="consequence-row"><span>Next fixture</span><b>${f?`${esc(f.opponent)} ${f.home?'H':'A'}`:'—'}</b></div><section class="transfer-decision"><h4>Target decision profile</h4><div class="transfer-gain"><span>3GW gain</span><b>${gain3==null?'—':`${gainText(gain3)} xPts`}</b><small>${multi.xPts3.toFixed(1)} target · ${Number.isFinite(out3)?out3.toFixed(1):'—'} current</small></div>${gain5==null?'':`<div class="transfer-gain"><span>5GW gain</span><b>${gainText(gain5)} xPts</b><small>${multi.xPts5.toFixed(1)} target · ${Number.isFinite(out5)?out5.toFixed(1):'—'} current</small></div>`}${decision}${additionalHits?`<p class="transfer-hit">This transfer would incur a ${additionalHits*4}-point hit.</p>`:''}</section>${after<0?`<div class="alert">£${Math.abs(after).toFixed(1)}m over budget. Visible for comparison, but cannot be added.</div>`:''}</div>`;
  $('#confirmTransfer').disabled=after<0;
 }catch(error){if(request!==transferPreviewRequest)return;$('#transferConsequence').innerHTML=`<div class="consequence"><div class="alert">Could not load target details: ${esc(error.message)}</div>${after<0?`<p class="over">£${Math.abs(after).toFixed(1)}m over budget.</p>`:''}</div>`;$('#confirmTransfer').disabled=true}
}
$('#freeTransfers').oninput=()=>{if(!state.plan)return;state.plan.freeTransfers=Math.max(0,Math.min(5,Math.floor(Number($('#freeTransfers').value)||0)));updatePlanMeta();invalidateFuturePlans();persist();renderPlanningStatus();renderPlanSummary()};
$('#targetTeam').onchange=renderTargetPlayers;
$('#targetPlayer').onchange=renderTransferConsequence;
$('#topPerformersBtn').onclick=()=>{state.transferTop15Only=!state.transferTop15Only;renderTargetPlayers();};
$('#sellingPrice').oninput=renderTransferConsequence;
$('#closeTransfer').onclick=()=>$('#transferDialog').close();
$('#transferDialog').addEventListener('close',()=>{state.transferOut=null;state.transferAddPosition=null});
$('#confirmTransfer').onclick=async()=>{
 const out=state.transferOut,target=state.players.find(p=>p.id===Number($('#targetPlayer').value)),salePrice=Math.max(0,Number($('#sellingPrice').value||out?.price||0));
 if(state.transferWorkspace==='freehit'){
  const plan=state.freeHitPlan,addPosition=state.transferAddPosition,position=addPosition||out?.position;if((!out&&!addPosition)||!target||!plan||target.position!==position)return;
  const currentCost=plan.players.reduce((sum,player)=>sum+Number(player.price||0),0),clubs=new Map();for(const player of plan.players)if(!out||Number(player.player_id)!==Number(out.player_id))clubs.set(player.team,(clubs.get(player.team)||0)+1);
  const positionLimit={GK:2,DEF:5,MID:5,FWD:3}[position],positionCount=plan.players.filter(player=>player.position===position&&(!out||Number(player.player_id)!==Number(out.player_id))).length;
  if(currentCost-Number(out?.price||0)+Number(target.price||0)>Number(plan.budget)+.001||(clubs.get(target.team)||0)>=3||positionCount>=(positionLimit||0)||plan.players.some(player=>Number(player.player_id)===Number(target.id)))return;
  if(!state.details[target.id]){ $('#transferConsequence').insertAdjacentHTML('beforeend','<div class="alert">Target details are not loaded yet. Please wait or choose the player again.</div>');return}
  const incoming={player_id:Number(target.id),name:target.name,team:target.team,team_name:target.team_name,team_id:target.team_id,team_code:target.team_code,position:target.position,position_order:out?.position_order??plan.players.length+1,price:Number(target.price),status:target.status,news:target.news||''};
  const snapshot=structuredClone(plan);
  if(out){
   plan.players=plan.players.map(player=>Number(player.player_id)===Number(out.player_id)?incoming:player);
   plan.starters=plan.starters.map(id=>Number(id)===Number(out.player_id)?incoming.player_id:id);plan.bench=plan.bench.map(id=>Number(id)===Number(out.player_id)?incoming.player_id:id);
   if(Number(plan.captain)===Number(out.player_id))plan.captain=incoming.player_id;if(Number(plan.vice)===Number(out.player_id))plan.vice=incoming.player_id;
  }else{
   plan.players.push(incoming);if(plan.starters.length<11)plan.starters.push(incoming.player_id);else plan.bench.push(incoming.player_id);
  }
  plan.bank=Number(plan.budget)-plan.players.reduce((sum,player)=>sum+Number(player.price||0),0);
  if(!persistFreeHit()){state.freeHitPlan=snapshot;$('#transferConsequence').insertAdjacentHTML('beforeend',`<div class="alert">${esc(state.freeHitSaveError)}</div>`);return}
  state.transferOut=null;state.transferAddPosition=null;calculateFreeHit();renderFreeHit();$('#transferDialog').close();return;
 }
 if(!out||!target||plannedBank()+salePrice-target.price<0)return;
 const detail=state.details[target.id];if(!detail){$('#transferConsequence').insertAdjacentHTML('beforeend','<div class="alert">Target details are not loaded yet. Please wait or choose the player again.</div>');$('#confirmTransfer').disabled=true;return}
 const incoming={player_id:target.id,name:target.name,team:target.team,team_name:target.team_name,team_id:target.team_id,team_code:target.team_code,position:target.position,price:target.price,status:target.status,news:target.news||''};
 const snapshot=structuredClone(state.plan),originalPlans=structuredClone(db.managers?.[state.managerId]?.plans||{});
 state.plan.players=state.plan.players.map(p=>p.player_id===out.player_id?incoming:p);
 state.plan.starters=state.plan.starters.map(id=>id===out.player_id?incoming.player_id:id);
 state.plan.bench=state.plan.bench.map(id=>id===out.player_id?incoming.player_id:id);
 if(state.plan.captain===out.player_id)state.plan.captain=incoming.player_id;
 if(state.plan.vice===out.player_id)state.plan.vice=incoming.player_id;
 state.plan.transfers.push({out,in:incoming,salePrice,buyPrice:Number(incoming.price),gameweek:state.gw});
 updatePlanMeta();invalidateFuturePlans();
 if(!persist()){db.managers[state.managerId].plans=originalPlans;state.plan=db.managers[state.managerId].plans[state.gw]||snapshot;calculate();render();return}
 calculate();$('#transferDialog').close();render()
}
function reviewRows(detail,gw){return(detail?.recent_history||[]).filter(row=>Number(row.gameweek??row.round??row.event)===Number(gw))}
function sumRows(rows,...keys){return rows.reduce((total,row)=>total+Number(keys.map(key=>row?.[key]).find(value=>value!=null)||0),0)}
function scoringBreakdown(player,rows){const pos=player.position,minutes=sumRows(rows,'minutes'),parts=[],goals=sumRows(rows,'goals_scored','goals'),assists=sumRows(rows,'assists'),clean=sumRows(rows,'clean_sheets','clean_sheet'),saves=sumRows(rows,'saves'),ps=sumRows(rows,'penalties_saved'),pm=sumRows(rows,'penalties_missed'),og=sumRows(rows,'own_goals'),yc=sumRows(rows,'yellow_cards'),rc=sumRows(rows,'red_cards'),conceded=sumRows(rows,'goals_conceded'),bonus=sumRows(rows,'bonus'),defcon=sumRows(rows,'defensive_contribution');if(minutes>0)parts.push(['Appearance',minutes>=60?2:1]);if(goals)parts.push([`${goals} goal${goals===1?'':'s'}`,goals*(pos==='FWD'?4:pos==='MID'?5:6)]);if(assists)parts.push([`${assists} assist${assists===1?'':'s'}`,assists*3]);if(clean&&minutes>=60&&['GK','DEF','MID'].includes(pos))parts.push(['Clean sheet',pos==='MID'?1:4]);if(pos==='GK'&&saves>=3)parts.push([`${saves} saves`,Math.floor(saves/3)]);if(ps)parts.push(['Penalty saved',ps*5]);if(pm)parts.push(['Penalty missed',-pm*2]);if(og)parts.push(['Own goal',-og*2]);if(yc)parts.push(['Yellow card',-yc]);if(rc)parts.push(['Red card',-rc*3]);if(['GK','DEF'].includes(pos)&&minutes>=60&&conceded>=2)parts.push([`${conceded} goals conceded`,-Math.floor(conceded/2)]);if(bonus)parts.push(['Bonus',bonus]);const threshold=pos==='DEF'?10:['MID','FWD'].includes(pos)?12:Infinity;if(defcon>=threshold)parts.push(['Defensive contributions',2]);const actual=sumRows(rows,'points','total_points'),known=parts.reduce((n,item)=>n+item[1],0);if(actual-known)parts.push(['Other scoring',actual-known]);return parts}
async function refreshCompletedGameweeks(){
 const g=await endpoints.gameweek();state.completedEvents=(g.events||[]).filter(x=>x.finished).slice(-8).reverse();state.events=(g.events||[]).filter(x=>!x.finished).slice(0,6);setupReview();return g
}
async function hydrateReviewPlayers(players,{force=false}={}){
 await Promise.allSettled(players.map(async player=>{if(force||!state.reviewDetails[player.player_id])state.reviewDetails[player.player_id]=await endpoints.player(player.player_id)}))
}
async function refreshReview({force=true}={}){
 const button=$('#refreshReview');if(button){button.disabled=true;button.textContent='Refreshing…'}
 $('#reviewStatus').innerHTML='<span>Checking official FPL Gameweek status and refreshing player histories…</span>';
 try{await refreshCompletedGameweeks();const gw=Number(state.reviewGw||$('#reviewGw').value||state.completedEvents?.[0]?.id);if(!gw)throw new Error('No completed Gameweek is available yet.');state.reviewGw=gw;const squad=await endpoints.squad(state.managerId,gw);state.reviewSquad=squad.squad;await hydrateReviewPlayers(state.reviewSquad,{force});renderReview();settlePredictions();renderCalibration();const event=state.completedEvents.find(e=>Number(e.id)===gw),settled=state.predictionLog.filter(row=>Number(row.gameweek)===gw&&row.actualPoints!=null).length,total=state.predictionLog.filter(row=>Number(row.gameweek)===gw).length;$('#reviewStatus').innerHTML=`<b class="${event?.finished?'review-final':''}">${event?.finished?'Final':'Provisional'} GW${gw}</b> · player histories refreshed${total?` · Calibration settled ${settled}/${total}`:''}`}
 catch(error){$('#reviewStatus').innerHTML=`<div class="alert">${esc(error.message)}</div>`}
 finally{if(button){button.disabled=false;button.textContent='Refresh'}}
}
async function openReview(gw){state.reviewGw=Number(gw);$('#reviewGw').value=String(gw);$('#reviewPlayers').innerHTML='<div class="card">Loading review…</div>';$('#reviewStatus').innerHTML='<span>Loading official squad and player history…</span>';try{const squad=await endpoints.squad(state.managerId,gw);state.reviewSquad=squad.squad;const final=state.completedEvents.some(event=>Number(event.id)===Number(gw)&&event.finished);await hydrateReviewPlayers(state.reviewSquad,{force:final});renderReview();settlePredictions();const settled=state.predictionLog.filter(row=>Number(row.gameweek)===Number(gw)&&row.actualPoints!=null).length,total=state.predictionLog.filter(row=>Number(row.gameweek)===Number(gw)).length;$('#reviewStatus').innerHTML=`<b class="${final?'review-final':''}">${final?'Final':'Provisional'} GW${gw}</b>${total?` · Calibration settled ${settled}/${total}`:''}`}catch(error){$('#reviewPlayers').innerHTML=`<div class="alert">${esc(error.message)}</div>`;$('#reviewStatus').innerHTML=''}}
function reviewFixture(player,gw){const matches=state.fixtures.filter(f=>Number(f.gameweek)===Number(gw)&&(f.home===player.team||f.away===player.team));if(!matches.length)return null;const f=matches[0];return{...f,difficulty:f.home===player.team?f.home_difficulty:f.away_difficulty,opponent:f.home===player.team?f.away:f.home,home:f.home===player.team}}
function reviewXpts(player,detail,gw){try{return project(player,detail,reviewFixture(player,gw),modelContext(player,gw)).xPts}catch{return 0}}
function renderReview(){const gw=state.reviewGw,players=state.reviewSquad||[],cards=players.map(player=>{const detail=state.reviewDetails[player.player_id],rows=reviewRows(detail,gw),minutes=sumRows(rows,'minutes'),points=sumRows(rows,'points','total_points'),xg=sumRows(rows,'expected_goals','xG'),xa=sumRows(rows,'expected_assists','xA'),defcon=sumRows(rows,'defensive_contribution'),bonus=sumRows(rows,'bonus'),bps=sumRows(rows,'bps'),xpts=reviewXpts(player,detail,gw),fixtureText=rows.map(row=>row.opponent_name||row.opponent||'').filter(Boolean).join(' / '),breakdown=scoringBreakdown(player,rows);return{player,minutes,points,xg,xa,defcon,bonus,bps,xpts,fixtureText,breakdown}});const starters=cards.filter(c=>Number(c.player.position_order)<=11),benchCards=cards.filter(c=>Number(c.player.position_order)>11),startersRaw=starters.reduce((n,c)=>n+c.points,0),captain=starters.find(c=>c.player.captain),gwScore=startersRaw+(captain?.points||0),bench=benchCards.reduce((n,c)=>n+c.points,0),reviewProjections=Object.fromEntries(starters.map(card=>[card.player.player_id,{xPts:card.xpts}])),starterXpts=lineupXptsTotals(starters.map(card=>card.player.player_id),reviewProjections,captain?.player.player_id).total;$('#reviewTotals').innerHTML=`<div class="review-total"><b>${gwScore}</b><span>GW SCORE</span></div><div class="review-total"><b>${bench}</b><span>BENCH POINTS</span></div><div class="review-total"><b class="review-xpts">${starterXpts.toFixed(1)}</b><span>XI xPTS</span></div>`;$('#reviewPlayers').innerHTML=`<p class="review-note">GW score shows the starting XI plus the captain multiplier. Bench points are shown separately and are not included. xPts uses the current planner model and will be refined next.</p>`+cards.sort((a,b)=>Number(a.player.position_order)-Number(b.player.position_order)).map(c=>`<details class="review-player"><summary><div class="review-player-name"><strong>${esc(c.player.name)}${c.player.captain?' (C)':c.player.vice_captain?' (V)':''}</strong><small>${esc(c.player.position)}${c.fixtureText?` · ${esc(c.fixtureText)}`:''}${Number(c.player.position_order)>11?' · Bench':''}</small></div><div class="review-points"><b>${c.points}</b><span>POINTS</span><small>${c.xpts.toFixed(1)} xPts</small></div></summary><div class="review-metrics"><div class="review-metric"><b>${c.minutes}</b><span>MIN</span></div><div class="review-metric"><b class="review-xpts">${c.xpts.toFixed(1)}</b><span>xPTS</span></div><div class="review-metric"><b>${c.xg.toFixed(2)}</b><span>xG</span></div><div class="review-metric"><b>${c.xa.toFixed(2)}</b><span>xA</span></div><div class="review-metric"><b>${c.defcon}</b><span>DEFCON</span></div><div class="review-metric"><b>${c.bonus}</b><span>BONUS</span></div><div class="review-metric"><b>${c.bps}</b><span>BPS</span></div></div><div class="points-breakdown">${c.breakdown.length?c.breakdown.map(item=>`<div class="points-row"><span>${esc(item[0])}</span><b>${item[1]>0?'+':''}${item[1]}</b></div>`).join(''):'<div class="points-row"><span>No scoring events recorded</span><b>0</b></div>'}</div></details>`).join('')}
async function loadPerformance(){
  let data=null;try{data=await endpoints.managerHistory(state.managerId)}catch{}
  const source=data?.current||data?.history||data?.gameweeks||state.manager?.history||[];
  const avgValue=e=>{const v=e?.average_score??e?.average_entry_score??e?.avg_score??e?.average;return Number.isFinite(Number(v))?Number(v):null};
  const averages=new Map((state.completedEvents||[]).map(e=>[Number(e.id),avgValue(e)]));
  state.performanceHistory=(Array.isArray(source)?source:[]).map(row=>{const gw=Number(row.event??row.gameweek??row.id),direct=avgValue(row),fallback=averages.get(gw);return{gw,points:Number(row.points??row.event_points??0),total:Number(row.total_points??row.total??0),rank:Number(row.overall_rank??row.rank??0),average:direct??fallback??null}}).filter(row=>row.gw&&row.rank).sort((a,b)=>a.gw-b.gw);
  renderPerformance();renderSummary();
}
function rankSvg(rows){if(!rows.length)return'<div class="empty-performance">No ranking history returned by the Worker.</div>';const w=520,h=190,p=28,min=Math.min(...rows.map(r=>r.rank)),max=Math.max(...rows.map(r=>r.rank)),range=Math.max(1,max-min),x=i=>p+i*(w-2*p)/Math.max(1,rows.length-1),y=v=>p+(v-min)*(h-2*p)/range,points=rows.map((r,i)=>`${x(i)},${y(r.rank)}`).join(' ');return`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Overall rank by Gameweek"><polyline points="${points}" fill="none" stroke="#781D32" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${rows.map((r,i)=>`<circle cx="${x(i)}" cy="${y(r.rank)}" r="4" fill="#151515"><title>GW${r.gw}: ${r.rank.toLocaleString()}</title></circle>`).join('')}<text x="${p}" y="${h-5}" class="axis-text">GW${rows[0].gw}</text><text x="${w-p}" y="${h-5}" text-anchor="end" class="axis-text">GW${rows.at(-1).gw}</text></svg>`}
function scoreBars(rows){if(!rows.length)return'<div class="empty-performance">No score history returned by the Worker.</div>';const max=Math.max(1,...rows.flatMap(r=>[r.points,Number.isFinite(r.average)?r.average:0]));return`<div class="score-bars">${rows.map(r=>`<div class="score-week"><div class="bar-pair"><span class="bar own" style="height:${Math.max(2,r.points/max*120)}px" title="Your score ${r.points}"></span>${Number.isFinite(r.average)?`<span class="bar avg" style="height:${Math.max(2,r.average/max*120)}px" title="Average ${r.average}"></span>`:''}</div><small>GW${r.gw}</small></div>`).join('')}</div><div class="chart-legend"><span><i class="own-key"></i>Your score</span><span><i class="avg-key"></i>Average</span></div>`}
function renderPerformance(){const rows=state.performanceHistory||[],last=rows.at(-1),best=rows.length?rows.reduce((a,b)=>a.rank<b.rank?a:b):null,above=rows.filter(r=>Number.isFinite(r.average)&&r.points>r.average).length;$('#performanceSummary').innerHTML=last?`<div class="performance-stat"><b>${last.total}</b><span>Total points</span></div><div class="performance-stat"><b>${last.rank.toLocaleString()}</b><span>Current rank</span></div><div class="performance-stat"><b>${best.rank.toLocaleString()}</b><span>Best rank</span></div><div class="performance-stat"><b>${above}/${rows.filter(r=>Number.isFinite(r.average)).length||0}</b><span>Above average</span></div>`:'<div class="empty-performance">Performance history is unavailable.</div>';$('#rankChart').innerHTML=rankSvg(rows);$('#scoreChart').innerHTML=scoreBars(rows);$('#performanceRows').innerHTML=rows.slice().reverse().map(r=>`<div class="performance-row"><b>GW${r.gw}</b><span>${r.points} pts</span><span class="${Number.isFinite(r.average)&&r.points>=r.average?'above':'below'}">${Number.isFinite(r.average)?`${r.points-r.average>=0?'+':''}${r.points-r.average} vs avg`:'Average unavailable'}</span><small>${r.rank.toLocaleString()} rank</small></div>`).join('')}
const PREDICTION_KEY='fpl.predictions.v29';
function predictionDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open('fplPlannerCalibration',1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('snapshots'))db.createObjectStore('snapshots',{keyPath:'id'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function loadPredictionLog(){try{const db=await predictionDb();state.predictionLog=await new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readonly'),req=tx.objectStore('snapshots').getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)});db.close()}catch(error){console.warn('Calibration database unavailable',error);state.predictionLog=[]}}
async function savePredictionLog(){const db=await predictionDb();await new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots');for(const row of state.predictionLog)store.put(row);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});db.close()}
async function freezePredictions(){
 if(!state.plan||!state.plan.players?.length){$('#calibrationRows').innerHTML='<div class="alert">No active Gameweek plan is loaded.</div>';return}
 const gw=Number(state.gw),createdAt=new Date().toISOString();let added=0,existing=0;
 for(const p of state.plan.players){const x=state.projections[p.player_id],multi=state.multiProjections[p.player_id];if(!x){continue}const id=`3.1-${gw}-${p.player_id}`;if(state.predictionLog.some(row=>row.id===id)){existing++;continue}state.predictionLog.push({id,modelVersion:'3.1',createdAt,gameweek:gw,playerId:p.player_id,name:p.name,position:p.position,predictedPoints:x.xPts,predictedMinutes:x.xMin,pStart:x.minutes?.pStart||0,horizon3:multi?.xPts3||0,weighted3:multi?.weighted3||0,horizon5:multi?.xPts5||0,weighted5:multi?.weighted5||0,actualPoints:null,actualMinutes:null});added++}
 try{await savePredictionLog()}catch(error){$('#calibrationRows').innerHTML=`<div class="alert">Could not save predictions: ${esc(error.message)}</div>`;return}
 renderCalibration();$('#freezeStatus').innerHTML=added?`<b>Frozen GW${gw}</b><span>${added} player predictions saved at ${new Date(createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}.</span>`:`<b>GW${gw} already frozen</b><span>${existing} predictions already exist. They were not overwritten.</span>`
}
function settlePredictions(){let changed=false;for(const row of state.predictionLog.filter(x=>x.actualPoints==null)){const detail=state.details[row.playerId]||state.reviewDetails[row.playerId],actual=reviewRows(detail,row.gameweek);if(actual.length){row.actualPoints=sumRows(actual,'points','total_points');row.actualMinutes=sumRows(actual,'minutes');changed=true}}if(changed)savePredictionLog().catch(error=>console.warn('Could not persist settled predictions',error))}
function calibrationStats(rows){const settled=rows.filter(r=>r.actualPoints!=null);if(!settled.length)return{n:0,mae:0,bias:0,rmse:0,minMae:0};const errors=settled.map(r=>r.actualPoints-r.predictedPoints);return{n:settled.length,mae:errors.reduce((n,e)=>n+Math.abs(e),0)/settled.length,bias:errors.reduce((n,e)=>n+e,0)/settled.length,rmse:Math.sqrt(errors.reduce((n,e)=>n+e*e,0)/settled.length),minMae:settled.reduce((n,r)=>n+Math.abs((r.actualMinutes||0)-r.predictedMinutes),0)/settled.length}}
function renderCalibration(){settlePredictions();const stats=calibrationStats(state.predictionLog),bands=[[0,2],[2,3],[3,4],[4,5],[5,99]];$('#calibrationSummary').innerHTML=`<div class="performance-stat"><b>${stats.n}</b><span>Settled predictions</span></div><div class="performance-stat"><b>${stats.mae.toFixed(2)}</b><span>Points MAE</span></div><div class="performance-stat"><b>${stats.bias>=0?'+':''}${stats.bias.toFixed(2)}</b><span>Bias actual minus xPts</span></div><div class="performance-stat"><b>${stats.minMae.toFixed(1)}</b><span>Minutes MAE</span></div>`;$('#calibrationBands').innerHTML=bands.map(([a,b])=>{const rows=state.predictionLog.filter(r=>r.actualPoints!=null&&r.predictedPoints>=a&&r.predictedPoints<b),avg=rows.length?rows.reduce((n,r)=>n+r.actualPoints,0)/rows.length:0,pred=rows.length?rows.reduce((n,r)=>n+r.predictedPoints,0)/rows.length:0;return`<div class="calibration-band"><b>${a}-${b===99?'5+':b} xPts</b><small>N ${rows.length}</small><span>Pred ${pred.toFixed(2)}</span><span>Actual ${avg.toFixed(2)}</span></div>`}).join('');$('#calibrationRows').innerHTML=state.predictionLog.slice().reverse().slice(0,50).map(r=>`<div class="performance-row"><b>GW${r.gameweek}</b><span>${esc(r.name)}</span><span>${r.predictedPoints.toFixed(2)} xPts</span><small>${r.actualPoints==null?'Pending':`${r.actualPoints} actual`}</small></div>`).join('')||'<div class="empty-performance">Freeze a Gameweek before its deadline to start testing.</div>'}
function setupReview(){const select=$('#reviewGw'),selected=Number(state.reviewGw||select.value||state.completedEvents?.[0]?.id);select.innerHTML=(state.completedEvents||[]).map(event=>`<option value="${event.id}">GW${event.id}${event.finished?' · Final':''}</option>`).join('');if(selected&&[...select.options].some(option=>Number(option.value)===selected))select.value=String(selected);select.onchange=()=>openReview(Number(select.value));$('#refreshReview').onclick=()=>refreshReview({force:true})}
function setActiveView(view){
 const previous=state.activeView;if(previous!==view)clearSwitchMode();state.activeView=view;updateSwitchPrompt();document.querySelectorAll('.bottom-nav button').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
 document.querySelectorAll('main > :not(#reviewView):not(#performanceView):not(#calibrationView):not(#freeHitView)').forEach(element=>element.hidden=view!=='planner');
 $('#freeHitView').hidden=view!=='freehit';$('#reviewView').hidden=view!=='review';$('#performanceView').hidden=view!=='performance';$('#calibrationView').hidden=view!=='calibration';
 $('#gwNav').hidden=view!=='planner'&&view!=='freehit';
 if(view==='planner'&&state.gw&&(previous==='freehit'||previous==='review'||previous==='performance'||previous==='calibration'))openGw(state.gw);
 if(view==='freehit'&&state.gw)openFreeHit(state.gw);
 if(view==='review'){const gw=Number($('#reviewGw').value||state.completedEvents?.[0]?.id);if(gw)openReview(gw)}
 if(view==='performance')renderPerformance();if(view==='calibration')renderCalibration();
}
$('#syncCurrentTeam').addEventListener('click',syncCurrentTeam);document.querySelectorAll('.bottom-nav button').forEach(button=>button.addEventListener('click',()=>setActiveView(button.dataset.view)));$('#freezePredictions').addEventListener('click',e=>{e.preventDefault();freezePredictions()});setActiveView('planner');loadPredictionLog().finally(()=>boot());

function safeTransferNumber(value,fallback=0){
 if(value===null||value===undefined||value==='')return fallback;
 const number=Number(value);return Number.isFinite(number)?number:fallback;
}
function transferClubKey(player){
 const team=String(player?.team_code||player?.team||player?.team_name||'').trim().toUpperCase();
 return team?`team:${team}`:`id:${player?.team_id??'unknown'}`;
}
function transferCandidateErrors(out,target,freeHitMode=state.transferWorkspace==='freehit'){
 const plan=freeHitMode?state.freeHitPlan:state.plan;
 const addPosition=freeHitMode?state.transferAddPosition:null,position=addPosition||out?.position;
 if((!out&&!addPosition)||!target||!plan||!Array.isArray(plan.players))return['Choose a player to replace or add and an incoming player.'];
 const outId=Number(out?.player_id),targetId=Number(target.id??target.player_id),errors=[];
 if(!Number.isSafeInteger(targetId)||targetId<1)return['Invalid player selection.'];
 if(target.position!==position)return['Replacement must play the selected position.'];
 if(targetId===outId||plan.players.some(player=>(!out||Number(player.player_id)!==outId)&&Number(player.player_id)===targetId))errors.push('Already in your squad.');
 const remaining=out?plan.players.filter(player=>Number(player.player_id)!==outId):plan.players;
 if(out&&!plan.players.some(player=>Number(player.player_id)===outId))errors.push('Outgoing player is no longer in the squad.');
 const incoming={...target,player_id:targetId,position_order:out?.position_order??plan.players.length+1},resulting=out?[...remaining,incoming]:[...remaining,incoming];
 const structuralPlan={...plan,players:resulting,starters:out?(plan.starters||[]).map(id=>Number(id)===outId?targetId:id):[...(plan.starters||[]),...(plan.starters?.length<11?[targetId]:[])],bench:out?(plan.bench||[]).map(id=>Number(id)===outId?targetId:id):[...(plan.bench||[]),...(plan.starters?.length>=11?[targetId]:[])],captain:Number(plan.captain)===outId?targetId:plan.captain,vice:Number(plan.vice)===outId?targetId:plan.vice};
 const structureErrors=freeHitMode?freeHitDraftErrors(structuralPlan):plannerIntegrityErrors(structuralPlan);
 if(structureErrors.length)errors.push(structureErrors[0]);
 const clubCount=remaining.filter(player=>transferClubKey(player)===transferClubKey(target)).length;
 if(clubCount>=3)errors.push('Max 3 players from this club.');
 const targetPrice=safeTransferNumber(target.price,NaN);
 if(!Number.isFinite(targetPrice)||targetPrice<0)errors.push('Price unavailable.');
 else{
  const salePrice=freeHitMode?safeTransferNumber(out?.price):Math.max(0,safeTransferNumber($('#sellingPrice')?.value,out?.price));
  const available=freeHitMode
   ?safeTransferNumber(plan.budget)-plan.players.reduce((sum,player)=>sum+safeTransferNumber(player.price),0)+salePrice
   :plannedBank()+salePrice;
  const after=available-targetPrice;
  if(after<-.001)errors.push(`£${Math.abs(after).toFixed(1)}m over budget.`);
 }
 return[...new Set(errors)];
}
function renderTransferMatchup(out,target){
 const box=$('#transferMatchup');if(!box)return;
 const side=(label,player,kind)=>`<div class="transfer-side transfer-side-${kind}"><small>${label}</small><b>${esc(player?.name||'Choose incoming player')}</b><span>${player?`${esc(player.team_name||player.team||'Club')} · ${esc(player.position||'')} · £${safeTransferNumber(player.price).toFixed(1)}m`:''}</span></div>`;
 const outgoing=state.transferAddPosition?`<div class="transfer-side transfer-side-out"><small>ADD</small><b>${esc(state.transferAddPosition)} slot</b><span>Free Hit squad</span></div>`:side('OUT',out,'out');
 box.innerHTML=`${outgoing}<span class="transfer-arrow" aria-hidden="true">→</span>${side('IN',target,'in')}`;
}
function rankedTopPerformers(position){
 const points=player=>{const value=player?.total_points;if(value===null||value===undefined||value===''||!Number.isFinite(Number(value)))return 0;return Number(value)};
 const price=player=>{const value=Number(player?.price);return Number.isFinite(value)&&value>=0?value:Number.POSITIVE_INFINITY};
 const id=player=>{const value=Number(player?.id);return Number.isSafeInteger(value)&&value>0?value:Number.POSITIVE_INFINITY};
 return state.players.filter(player=>player?.position===position).slice().sort((a,b)=>{
  const pointDifference=points(b)-points(a);if(pointDifference)return pointDifference;
  const priceDifference=price(a)-price(b);if(Number.isFinite(priceDifference)&&priceDifference)return priceDifference;
  const idDifference=id(a)-id(b);if(Number.isFinite(idDifference)&&idDifference)return idDifference;
  return String(a?.name||'').localeCompare(String(b?.name||''))||String(a?.team||'').localeCompare(String(b?.team||''));
 }).slice(0,15);
}
renderTargetPlayers=function(){
 const out=state.transferOut,addPosition=state.transferAddPosition,position=addPosition||out?.position,team=Number($('#targetTeam').value),freeHitMode=state.transferWorkspace==='freehit',plan=freeHitMode?state.freeHitPlan:state.plan;
 if((!out&&!addPosition)||!plan)return;
 const outgoingId=Number(out?.player_id),ids=new Set(plan.players.map(player=>Number(player.player_id))),clubs=new Map();
 for(const player of plan.players)if(!out||Number(player.player_id)!==outgoingId)clubs.set(transferClubKey(player),(clubs.get(transferClubKey(player))||0)+1);
 const rows=state.players.filter(player=>Number(player.team_id)===team&&player.position===position&&!ids.has(Number(player.id)));
 const eligibleRows=freeHitMode?rows.filter(player=>{
  const bank=Number(plan.budget)-plan.players.reduce((sum,item)=>sum+Number(item.price||0),0);
  const maxPosition={GK:2,DEF:5,MID:5,FWD:3}[position],positionCount=plan.players.filter(item=>item.position===position&&(!out||Number(item.player_id)!==outgoingId)).length;
  return Number(player.price)<=bank+Number(out?.price||0)+.001&&(clubs.get(transferClubKey(player))||0)<3&&positionCount<(maxPosition||0);
 }):rows;
 eligibleRows.sort((a,b)=>rankTransferCandidate(b)-rankTransferCandidate(a)||safeTransferNumber(a.price,Number.POSITIVE_INFINITY)-safeTransferNumber(b.price,Number.POSITIVE_INFINITY)||Number(a.id)-Number(b.id));
 const select=$('#targetPlayer'),previous=Number(select.value);
 select.innerHTML=eligibleRows.length?eligibleRows.map(player=>`<option value="${player.id}">${esc(player.name)} · £${safeTransferNumber(player.price).toFixed(1)}${freeHitMode?` · ${esc(freeHitTargetFixtureLabel(player))}`:''}</option>`).join(''):'<option value="">No eligible players</option>';
 const fallback=eligibleRows.find(player=>Number(player.id)===previous)||eligibleRows[0];
 if(fallback)select.value=String(fallback.id);
 select.dataset.poolCount=String(eligibleRows.length);
 const panel=$('#topPerformersPanel'),button=$('#topPerformersBtn');
 const topRows=rankedTopPerformers(position);
 panel.innerHTML=`<div class="top-performers-heading"><div><b>Top 15 performers</b><span>Based on actual FPL points · ${esc(position)} · all clubs</span></div><b class="top-performers-count">${topRows.length}/15</b></div><ol class="top-performers-list">${topRows.map((player,index)=>{
  const reasons=transferCandidateErrors(out,player,freeHitMode),disabled=reasons.length>0;
  return`<li><button type="button" class="top-performer${disabled?' is-disabled':''}" data-top-performer="${player.id}" ${disabled?'disabled':''} aria-label="${esc(`Rank ${index+1}: ${player.name}, ${player.team_name||player.team}, ${player.position}, £${safeTransferNumber(player.price).toFixed(1)}m, ${safeTransferNumber(player.total_points)} FPL points${disabled?`, unavailable: ${reasons.join(', ')}`:''}`)}"><span class="top-performer-rank">${index+1}</span><span class="top-performer-details"><b>${esc(player.name)}</b><small>${esc(player.team_name||player.team||'Club')} · ${esc(player.position)} · £${safeTransferNumber(player.price).toFixed(1)}m</small></span><span class="top-performer-points"><b>${safeTransferNumber(player.total_points)}</b><small>PTS</small></span>${disabled?`<span class="top-performer-reason">${esc(reasons.join(' · '))}</span>`:'<span class="top-performer-available">Select</span>'}</button></li>`;
 }).join('')}</ol>`;
 panel.hidden=!state.transferTop15Only;
 button.textContent=state.transferTop15Only?'Hide Top 15':'Top 15 performers';
 button.dataset.active=state.transferTop15Only?'1':'0';
 button.setAttribute('aria-expanded',String(state.transferTop15Only));
 renderTransferMatchup(out,state.players.find(player=>Number(player.id)===Number(select.value)));
 renderTransferConsequence();
 panel.querySelectorAll('[data-top-performer]:not(:disabled)').forEach(candidateButton=>candidateButton.addEventListener('click',()=>{
  const candidate=state.players.find(player=>Number(player.id)===Number(candidateButton.dataset.topPerformer));
  if(!candidate)return;
  $('#targetTeam').value=String(candidate.team_id);
  renderTargetPlayers();
  select.value=String(candidate.id);
  renderTransferMatchup(out,candidate);
  renderTransferConsequence();
 }));
};
function renderTargetValidation(){
 const out=state.transferOut,target=state.players.find(player=>Number(player.id)===Number($('#targetPlayer').value));
 renderTransferMatchup(out,target);
 const errors=transferCandidateErrors(out,target,state.transferWorkspace==='freehit');
 if(errors.length){
  $('#confirmTransfer').disabled=true;
  $('#transferConsequence').innerHTML=`<div class="transfer-validation-message" role="status">${errors.map(error=>`<span>${esc(error)}</span>`).join('')}</div>`;
  return false;
 }
 return true;
}
const originalRenderTransferConsequence=renderTransferConsequence;
renderTransferConsequence=async function(){
 if(!renderTargetValidation())return;
 await originalRenderTransferConsequence();
 renderTransferMatchup(state.transferOut,state.players.find(player=>Number(player.id)===Number($('#targetPlayer').value)));
};
$('#targetPlayer').onchange=renderTransferConsequence;
$('#sellingPrice').oninput=renderTransferConsequence;
$('#topPerformersBtn').onclick=()=>{
 state.transferTop15Only=!state.transferTop15Only;
 renderTargetPlayers();
};
const originalConfirmTransfer=$('#confirmTransfer').onclick;
$('#confirmTransfer').onclick=async function(event){
 const out=state.transferOut,target=state.players.find(player=>Number(player.id)===Number($('#targetPlayer').value));
 if(!renderTargetValidation())return;
 if(transferCandidateErrors(out,target).length)return;
 return originalConfirmTransfer.call(this,event);
};
renderGwNav=function(){
 const nav=$('#gwNav');
 nav.setAttribute('aria-label','Select Gameweek');
 nav.innerHTML=state.events.map(event=>`<button type="button" data-gw="${event.id}" class="${Number(event.id)===Number(state.gw)?'active':''}" aria-pressed="${Number(event.id)===Number(state.gw)}">GW${event.id}</button>`).join('');
 nav.onclick=event=>{
  const button=event.target.closest('[data-gw]');
  if(!button)return;
  const gw=Number(button.dataset.gw);
  if(state.activeView==='freehit')openFreeHit(gw);else openGw(gw);
 };
};
render=function(){
 updateSwitchPrompt();if(!ensurePlannerIntegrity())return;
 renderSummary();renderPlanningStatus();renderPlanSummary();
 const by=position=>state.plan.starters.filter(id=>state.plan.players.find(player=>Number(player.player_id)===Number(id))?.position===position),positions=['GK','DEF','MID','FWD'];
 $('#pitch').innerHTML=positions.map(position=>{const players=by(position);return`<div class="line" data-position="${position}" style="--line-count:${players.length}" aria-label="${position}">${players.map(playerCard).join('')}</div>`}).join('');
 $('#bench').innerHTML=state.plan.bench.map(playerCard).join('');
 const totals=lineupXptsTotals(state.plan.starters,state.projections,state.plan.captain);
 $('#lineupScore').innerHTML=`<span>Projected XI <b>${totals.total.toFixed(1)}</b></span><span>Formation <b>${by('DEF').length}-${by('MID').length}-${by('FWD').length}</b></span>`;
 document.querySelectorAll('#pitch [data-player],#bench [data-player]').forEach(button=>button.onclick=()=>pick(Number(button.dataset.player)));
};
const originalSetActiveView=setActiveView;
setActiveView=function(view){
 originalSetActiveView(view);
 document.body.dataset.view=view;
 document.querySelectorAll('.bottom-nav button').forEach(button=>{
  if(button.dataset.view===view)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
 });
};
setActiveView(state.activeView);
$('#playerSwitchAction').addEventListener('click',event=>{
 event.preventDefault();
 const id=Number($('#playerMenu').dataset.id),freeHitMode=state.activeView==='freehit';
 $('#playerMenu').close('switch');
 state.readOnlyPlayerMenu=false;
 beginSwitchMode(id);
 if(freeHitMode)renderFreeHit();else render();
});
$('#playerReplaceAction').addEventListener('click',event=>{
 event.preventDefault();
 const id=Number($('#playerMenu').dataset.id);
 $('#playerMenu').close('close');
 openTransfer(id);
});
