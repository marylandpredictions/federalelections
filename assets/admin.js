(() => {
  const state = {
    secret: sessionStorage.getItem("feaAdminSecret") || "",
    latestRaces: [],
    allRaces: [],
    showAllRaces: false,
    calls: { races: {} },
    notes: { races: {} },
    overlay: { tickerItems: [], producerNote: "" },
    noteIndex: null,
    testMode: "pre_election",
    simulationState: "pre_election"
  };

  const $ = (id) => document.getElementById(id);
  const loginPanel = $("loginPanel");
  const adminApp = $("adminApp");
  const secretInput = $("adminSecret");
  const raceSelect = $("raceSelect");
  const candidateList = $("candidateList");
  const callRows = $("callRows");
  const callStatus = $("callStatus");
  const noteStatus = $("noteStatus");
  const overlayStatus = $("overlayStatus");
  const noteSelect = $("noteSelect");
  const showAllRaces = $("showAllRaces");
  const raceModeLabel = $("raceModeLabel");
  const callPreview = $("callPreview");
  const testMode = $("testMode");
  const simulationState = $("simulationState");
  const applyTestMode = $("applyTestMode");
  const openElectionNightTest = $("openElectionNightTest");
  const testModeStatus = $("testModeStatus");

  let controlSnapshot = null, controlTimer = null, dirty = false, noteDirty = false, overlayDirty = false, refreshingControl = false;
  const stateNames = {AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming"};
  async function confirmAction(message) {
    const dialog = $("control-confirm"); if (dialog.open) return false;
    $("confirm-message").textContent = message;
    dialog.returnValue = "cancel";
    return new Promise(resolve => { dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), {once:true}); dialog.showModal(); });
  }
  async function runButton(button, work) {
    if(button.disabled) return; button.disabled = true; button.setAttribute("aria-busy","true");
    try { await work(); } catch(e) { setStatus($("control-status"),e.message,true); }
    finally { button.disabled = false; button.removeAttribute("aria-busy"); }
  }
  function showWorkspace(name) {
    document.querySelectorAll("[data-view]").forEach(node => node.hidden = node.dataset.view !== name);
    document.querySelectorAll("[data-workspace]").forEach(button => { if(button.dataset.workspace === name) button.setAttribute("aria-current","page"); else button.removeAttribute("aria-current"); });
  }
  async function controlAction(action, raceId) {
    const verbs={publish:"Publish this NBC call",hold:"Hold this call for review",ignore:"Ignore this NBC call",auto:"Clear your call and use NBC calls again",pause:"Pause automatic publishing",resume:"Resume automatic publishing","hold-all":"Hold all waiting NBC calls","return-all":"Use NBC calls again for eligible races; keep manual overrides"};
    const race=state.allRaces.find(r=>r.id===raceId);
    if (!await confirmAction(`${verbs[action] || action}${race?` — ${race.label}`:""}?`)) return;
    const payload = await adminFetch("/api/admin/results-control", {method:"POST",body:JSON.stringify({action,raceId})});
    controlSnapshot = payload; state.calls.races = payload.states; state.allRaces = payload.races.map(r=>({...r,label:FEAResultsUI.raceLabel({...r,stateName:stateNames[r.state]}),watch:state.watchlist?.get(r.id)})); renderControl(); if(currentRace()){renderRaceMeta(currentRace());renderCandidateList(currentRace());}
    setStatus($("control-status"), "Saved.");backupStatus(payload);
  }
  function relativeTime(value) {
    if(!value || !Number.isFinite(Date.parse(value)))return "Awaiting results";
    const seconds=Math.max(0,Math.floor((Date.now()-Date.parse(value))/1000));
    return seconds<60?`${seconds} sec ago`:seconds<3600?`${Math.floor(seconds/60)} min ago`:new Date(value).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
  }
  function backupStatus(payload) {
    const problem=payload.persistence?.warning || payload.persistence?.error;
    if(!problem)return;
    setStatus($("control-status"),"Saved on this server. Backup sync failed.",true);
    $("backup-details").hidden=false;$("backup-error").textContent=String(problem);
  }
  function callCard(id,s,actions=false) {
    const race=controlSnapshot.races.find(r=>r.id===id),name=race?FEAResultsUI.raceLabel({...race,stateName:stateNames[race.state]}):"Race";
    const presentation=FEAResultsUI.callPresentation(s),candidate=presentation.candidate;
    const party=race?.candidates.find(c=>c.name===candidate)?.party || "";
    return `<article class="queue-card" data-call-state="${escapeHtml(s.callState || "UNCALLED")}"><span class="queue-eyebrow">${presentation.label==="NBC call"?"NBC projects":candidate==="Not called"?"FEA override":"FEA projects"}</span><button class="queue-race" type="button" data-open-race="${escapeHtml(id)}">${escapeHtml(name)}</button><strong>${escapeHtml(candidate)}${party?` (${escapeHtml(party)})`:""}</strong><p>${FEAResultsUI.stateLabel(s.callState)}</p>${presentation.nbcCandidate?`<p>NBC projects ${escapeHtml(presentation.nbcCandidate)}</p>`:""}${s.attentionReason?'<p>Please review NBC’s latest projection.</p>':""}${s.callState==="NBC_PENDING"?`<p class="queue-clock" data-deadline="${escapeHtml(s.publishAt)}"></p>`:s.calls?.[0]?.calledAt?`<p>Published ${relativeTime(s.calls[0].calledAt)}</p>`:""}${actions?`<div class="admin-actions">${[["publish","Publish now"],["hold","Hold"],["override","Override"]].map(([action,label])=>`<button class="admin-button ${action==="publish"?"":"secondary"}" type="button" data-call-action="${action}" data-race-id="${escapeHtml(id)}">${label}</button>`).join("")}<details class="queue-more"><summary>More</summary><button class="admin-button secondary" type="button" data-call-action="ignore" data-race-id="${escapeHtml(id)}">Ignore NBC call</button></details></div>`:""}${s.manualOverride||["NBC_HELD","NBC_IGNORED"].includes(s.callState)?`<button class="admin-button secondary" data-call-action="auto" data-race-id="${escapeHtml(id)}">Use NBC calls again</button>`:""}</article>`;
  }
  function updateQueueClocks() {
    const skew=controlSnapshot ? Date.parse(controlSnapshot.serverTime)-controlSnapshot.receivedAt : 0;
    const now=Date.now()+skew;
    document.querySelectorAll("[data-deadline]").forEach(node=>{const id=node.closest('.queue-card')?.querySelector('[data-open-race]')?.dataset.openRace,healthy=controlSnapshot?.health.lastHealthyRaceIds;node.textContent=Array.isArray(healthy)&&!healthy.includes(id)?'Waiting for a verified race update':controlSnapshot?.health.automation === "ACTIVE" ? `Auto-publishes in ${Math.max(0,Math.ceil((Date.parse(node.dataset.deadline)-now)/1000))}s` : controlSnapshot?.health.automation === "PAUSED" ? "Automatic publishing is paused" : "Waiting for the results feed";});
    document.querySelectorAll("[data-detected]").forEach(node=>node.textContent=`${Math.max(0,Math.floor((now-Date.parse(node.dataset.detected))/1000))}s`);
  }
  function renderControl() {
    if(!controlSnapshot) return;
    controlSnapshot.receivedAt ||= Date.now();
    const signature = JSON.stringify([controlSnapshot.health,controlSnapshot.states,controlSnapshot.audit,controlSnapshot.races]);
    if(renderControl.signature === signature) {updateQueueClocks();return;}
    renderControl.signature = signature;
    const h=controlSnapshot.health, entries=Object.entries(controlSnapshot.states);
    const rosterNode=document.getElementById('candidate-roster-review');
    if(rosterNode&&controlSnapshot.rosterAudit){const a=controlSnapshot.rosterAudit;rosterNode.textContent=`Candidate roster ${a.reviewed} / ${a.total} reviewed · ${a.official} official-source verified · ${a.needsReview} need review · ${a.placeholders} generic placeholders. ${a.issues.slice(0,8).map(i=>i.race+': '+i.message).join('; ')}`;}
    if(rosterNode&&!controlSnapshot.rosterAudit)rosterNode.textContent='Candidate audit unavailable. Run npm run audit:results-candidates before deployment.';
    const pending=entries.filter(([,s])=>["NBC_PENDING","NBC_HELD"].includes(s.callState) && !s.manualOverride);
    $("control-top-status").textContent=`Results feed: ${FEAResultsUI.feedLabel(h)}`;
    $("queue-count").textContent=h.pending;
    $("automation-status").textContent=h.automation === "ACTIVE" ? `NBC calls publish automatically after ${h.graceSeconds} seconds. You can hold a call before it publishes.` : h.automation === "PAUSED" ? "Automatic publishing is paused." : "Automatic publishing is waiting for the results feed. Manual calls are available.";
    $("control-summary").innerHTML=[["Results feed",`${FEAResultsUI.feedLabel(h)} · ${relativeTime(h.lastUpstreamUpdate)}`],["Calls waiting",h.pending],["FEA overrides",h.overrides]].map(([label,value])=>`<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");
    $("pending-calls").innerHTML=pending.map(([id,s])=>callCard(id,s,true)).join("")||"No calls waiting.";
    $("dashboard-pending").innerHTML=pending.slice(0,4).map(([id,s])=>callCard(id,s,true)).join("")||"No calls need attention.";
    $("published-calls").innerHTML=entries.filter(([,s])=>s.calls?.length&&!s.manualOverride).sort((a,b)=>String(b[1].calls[0]?.calledAt).localeCompare(String(a[1].calls[0]?.calledAt))).slice(0,15).map(([id,s])=>callCard(id,s)).join("")||"No published NBC calls.";
    $("override-calls").innerHTML=entries.filter(([,s])=>s.manualOverride||s.callState==='NBC_IGNORED').map(([id,s])=>callCard(id,s)).join("")||"No overrides or ignored projections.";
    $("provider-health").innerHTML=Object.entries({"NBC status":h.status,"Sources":h.sources.map(s=>s.url).join("; ")||"No confirmed general-election endpoint configured","Last attempt":h.lastAttempt,"Last success":h.lastSuccess,"Last upstream timestamp":h.lastUpstreamUpdate,"Last changed result":h.lastChangedResult,"Public result version":controlSnapshot.versionInfo?.publicVersion,"Retained change snapshots":controlSnapshot.versionInfo?.retainedSnapshots,"Poll interval":`${h.pollSeconds}s`,"Next attempt":h.nextAttemptAt,"House / Senate / Governor":Object.values(h.counts).join(" / "),"Pending / overrides":`${h.pending} / ${h.overrides}`,"Data stale":h.stale?"Yes":"No","Latest provider error":h.error||"None"}).map(([label,value])=>`<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "Not yet available")}</dd></div>`).join("");
    $("control-audit").innerHTML=controlSnapshot.audit.slice(0,100).map(e=>`<p>${escapeHtml(e.timestamp)} • ${escapeHtml(e.race)} • ${escapeHtml(e.candidate)} • ${escapeHtml(e.action)} • ${escapeHtml(e.actor)} • ${escapeHtml(e.previousState)} → ${escapeHtml(e.newState)}</p>`).join("")||"No call actions recorded.";
    updateQueueClocks();
  }
  async function refreshControl() {
    if(refreshingControl) return; refreshingControl=true;
    try { const payload=await adminFetch("/api/admin/results-control"); controlSnapshot={...payload,receivedAt:Date.now()}; state.allRaces=payload.races.map(r=>({...r,label:FEAResultsUI.raceLabel({...r,stateName:stateNames[r.state]}),watch:state.watchlist?.get(r.id)})); state.latestRaces=state.allRaces; state.calls.races=payload.states; renderControl(); if(currentRace()){renderRaceMeta(currentRace());renderCandidateList(currentRace());} }
    catch(e) { setStatus($("control-status"),"Unable to refresh results. Your edits are still here.",true); }
    finally { refreshingControl=false; }
  }
  document.addEventListener("click", event=>{
    if(event.target.closest('[data-results-self-test]'))runButton(event.target,async()=>{const report=await adminFetch('/api/admin/results-self-test');const node=document.getElementById('results-self-test-output');node.textContent=report.status+'\n'+report.checks.map(c=>c.status+' · '+c.name+': '+c.explanation).join('\n');});
    const nav=event.target.closest("[data-workspace]"); if(nav) showWorkspace(nav.dataset.workspace);
    const global=event.target.closest("[data-global]"); if(global) runButton(global,()=>controlAction(global.dataset.global));
    const action=event.target.closest("[data-call-action]");
    const open=event.target.closest("[data-open-race]");
    if(open || action?.dataset.callAction === "override") {
      if(dirty || noteDirty) {setStatus($("control-status"),"Save your current race edits before selecting another race.",true);return;}
      $("raceSearch").value="";$("raceOffice").value="";$("raceFilter").value=""; renderApp();raceSelect.value=open?.dataset.openRace || action.dataset.raceId;renderRace();showWorkspace("races");$("candidateList").querySelector("button")?.focus();
    } else if(action) runButton(action,()=>controlAction(action.dataset.callAction,action.dataset.raceId));
  });
  for(const id of ["raceSearch","raceOffice","raceFilter"]) $(id).addEventListener(id === "raceSearch" ? "input" : "change",()=>{if(dirty || noteDirty){setStatus($("control-status"),"Save current race edits before filtering.",true);return;}renderApp();});
  $("returnRaceAuto").addEventListener("click",()=>runButton($("returnRaceAuto"),()=>controlAction("auto",currentRace()?.id)));
  $("lockAdmin").addEventListener("click",async()=>{if((dirty||noteDirty||overlayDirty)&&!await confirmAction("Lock and discard unsaved edits?"))return;sessionStorage.removeItem("feaAdminSecret");state.secret="";secretInput.value="";dirty=false;noteDirty=false;overlayDirty=false;adminApp.hidden=true;loginPanel.hidden=false;clearInterval(controlTimer);controlTimer=null;});
  document.addEventListener("keydown", event=>{
    if(["INPUT","TEXTAREA","SELECT"].includes(event.target.tagName)||$("control-confirm").open||event.ctrlKey||event.metaKey||event.altKey) return;
    if(event.key === "/"){event.preventDefault();showWorkspace("races");$("raceSearch").focus();}
    if(["p","h"].includes(event.key.toLowerCase())&&currentRace()) {
      const action=event.key.toLowerCase()==="p"?"publish":"hold";
      controlAction(action,currentRace().id).catch(e=>setStatus($("control-status"),e.message,true));
    }
  });
  callRows.addEventListener("change",()=>dirty=true);
  for (const id of ["noteText","noteAuthor","noteRole","noteDate","noteImage","noteEmbed"]) $(id).addEventListener("input",()=>noteDirty=true);
  for (const id of ["tickerText","producerNote"]) $(id).addEventListener("input",()=>overlayDirty=true);
  window.addEventListener("beforeunload",e=>{if(dirty || noteDirty || overlayDirty){e.preventDefault();e.returnValue="";}});
  setInterval(updateQueueClocks,1000);

  const PHOTO_FOLDERS = {
    "79777": "california-governor",
    "79779": "california-lieutenant-governor",
    "79778": "california-insurance-commissioner",
    "79881": "california-superintendent",
    "79893": "california-us-house-1",
    "79884": "california-us-house-11",
    "79896": "california-us-house-22",
    "79907": "california-us-house-32",
    "79916": "california-us-house-40",
    "79932": "california-us-house-7"
  };

  function setStatus(element, message, error = false) {
    element.textContent = message;
    element.classList.toggle("error", error);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function currentRace() {
    return state.allRaces.find((race) => race.id === raceSelect.value) || null;
  }

  function activeRaces() {
    const term = ($("raceSearch")?.value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const office = $("raceOffice")?.value; const filter = $("raceFilter")?.value;
    return state.allRaces.filter(race => {
      const status = controlSnapshot?.states?.[race.id] || {};
      const officeName = race.type === "governor" ? "Governor" : race.type === "senate" ? "Senate" : "House";
      const district = race.district === "AL" ? "AL" : String(race.district || "").padStart(2,"0");
      const alias = `${race.state}-${race.type === "senate" ? "SEN" : race.type === "governor" ? "GOV" : district}`;
      const haystack = `${race.id} ${race.label} ${alias} ${stateNames[race.state] || race.state} ${race.district || ""} ${officeName} ${(race.candidates || []).map(c=>c.name).join(" ")}`.toLowerCase().replace(/[^a-z0-9]/g, "");
      return (!term || haystack.includes(term)) && (!office || race.type === office) &&
        (!filter || (filter === "called" && !!status.calls?.length) || (filter === "uncalled" && !status.calls?.length) || (filter === "pending" && status.callState === "NBC_PENDING") || (filter === "override" && status.manualOverride) || (filter === "key" && !!race.watch));
    });
  }

  function slugify(value) {
    return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function initials(name) {
    const parts = String(name || "").replace(/\([^)]*\)/g, " ").split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts.at(-1)[0]}`.toUpperCase();
  }

  const DEM_PALETTE = [
    "#0391FF", "#5FC529", "#5560F5", "#32EBEB", "#2AE19F",
    "#214BE1", "#9FE121", "#5E21E1", "#72A2FF", "#A985F8",
    "#CA58F9", "#12A500", "#0033A5"
  ];

  const GOP_PALETTE = [
    "#A50000", "#C66518", "#DFC30E", "#C00F79", "#E14F50",
    "#FE9745", "#620000", "#FF8686", "#FF68B1"
  ];

  function stringToHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  function candidateColor(candidate = {}, race = {}) {
    if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(candidate.color || "")) return candidate.color;
    
    const partyCode = candidate.partyCode || "";
    const candidateName = String(candidate.name || "").toLowerCase();
    const hash = stringToHash(candidateName + String(race.id || ""));
    
    if (partyCode === "R" || partyCode === "Republican") {
      return GOP_PALETTE[hash % GOP_PALETTE.length];
    }
    if (partyCode === "D" || partyCode === "Democrat") {
      return DEM_PALETTE[hash % DEM_PALETTE.length];
    }
    if (partyCode === "I" || partyCode === "Independent") return "#2ec6a3";
    return "#7c6cff";
  }

  function candidatePhoto(candidate = {}, race = {}) {
    if (candidate.headshotUrl) return candidate.headshotUrl;
    const folder = PHOTO_FOLDERS[String(race.id)];
    if (folder) return `assets/img/candidates/${folder}/${slugify(candidate.name)}.webp`;
    return `assets/img/candidates/live-results/${slugify(candidate.name)}.webp`;
  }

  function authHeaders() {
    return {
      "Content-Type": "application/json",
      "X-Admin-Secret": state.secret
    };
  }

  async function adminFetch(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...authHeaders(),
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Admin request failed.");
    return payload;
  }

  function callRowMarkup(call = {}) {
    const candidates = currentRace()?.candidates || [];
    return `
      <div class="admin-call-row">
        <select aria-label="Call candidate" class="admin-select call-candidate">
          <option value="">Choose candidate</option>
          ${candidates.map((candidate) => `
            <option value="${escapeHtml(candidate.name)}" ${candidate.name === call.candidate ? "selected" : ""}>
              ${escapeHtml(candidate.name)}${candidate.partyCode ? ` (${escapeHtml(candidate.partyCode)})` : ""}
            </option>
          `).join("")}
        </select>
        <select aria-label="Call type" class="admin-select call-status">
          ${[
            ["projected", "Projected winner"],
            ["winner", "Winner"],
            ["advances", "Advances"],
            ["advanced", "Advanced"]
          ].map(([value, label]) => `<option value="${value}" ${value === call.status ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        <button class="admin-button secondary remove-call" type="button" title="Remove row">x</button>
      </div>
    `;
  }

  function renderCalls() {
    const raceId = currentRace()?.id;
    const calls = state.calls.races?.[raceId]?.calls || [];
    callRows.innerHTML = calls.length ? calls.map(callRowMarkup).join("") : callRowMarkup();
    renderCallPreview();
  }

  function currentNotes() {
    const raceId = currentRace()?.id;
    const notes = state.notes.races?.[raceId];
    return Array.isArray(notes) ? notes : [];
  }

  function renderNoteSelect() {
    if (!noteSelect) return;
    const notes = currentNotes();
    noteSelect.innerHTML = `
      <option value="">Add a new note</option>
      ${notes.map((note, index) => `
        <option value="${index}">${escapeHtml(note.date || `Note ${index + 1}`)} - ${escapeHtml(note.author || "FEA")}</option>
      `).join("")}
    `;
    noteSelect.value = state.noteIndex === null ? "" : String(state.noteIndex);
  }

  function clearNoteForm() {
    state.noteIndex = null;
    $("noteAuthor").value = "FEA Analysis Desk";
    $("noteRole").value = "Analysis desk";
    $("noteText").value = "";
    $("noteImage").value = "";
    $("noteEmbed").value = "";
    const now = new Date();
    $("noteDate").value = now.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
    renderNoteSelect();
    $("saveNote").textContent = "Add newest note";
  }

  function loadSelectedNote() {
    const index = Number(noteSelect?.value);
    const note = Number.isInteger(index) ? currentNotes()[index] : null;
    if (!note) {
      clearNoteForm();
      return;
    }
    state.noteIndex = index;
    $("noteAuthor").value = note.author || "FEA Analysis Desk";
    $("noteRole").value = note.role || "Analysis desk";
    $("noteDate").value = note.date || "";
    $("noteText").value = note.text || "";
    $("noteImage").value = typeof note.image === "string" ? note.image : note.image ? JSON.stringify(note.image) : "";
    $("noteEmbed").value = typeof note.embed === "string" ? note.embed : note.embed ? JSON.stringify(note.embed) : "";
    renderNoteSelect();
    $("saveNote").textContent = "Save selected note";
  }

  function renderRaceMeta(race) {
    const state=controlSnapshot?.states?.[race.id] || {};
    const advancedOpen=$("race-control-meta").querySelector("details")?.open;
    $("admin-race-title").textContent=FEAResultsUI.raceLabel({...race,stateName:stateNames[race.state]});
    const expected=race.expectedVotePercent??race.estimatedVoteReporting;
    const facts=[["Expected vote",expected!=null?`${Number(expected).toFixed(1)}%`:"Not available yet"],["NBC",state.providerCall?`${state.providerCall.candidate} projected`:"Not called"],["FEA",state.calls?.length?state.calls.map(c=>c.candidate).join(", "):"Not called"],["Your choice",state.manualOverride?"Manual override":FEAResultsUI.stateLabel(state.callState)]];
    $("race-control-meta").innerHTML=`<dl class="operator-race-facts">${facts.map(([label,value])=>`<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><details class="race-advanced" ${advancedOpen?"open":""}><summary>Advanced details</summary><dl>${Object.entries({"Race ID":race.id,"Provider race ID":race.providerRaceId,"Source":race.sourceUrl,"Last update":race.lastUpdated,"Call state":state.callState||"UNCALLED","County areas":race.countyCount||0}).map(([label,value])=>`<div><dt>${label}</dt><dd>${escapeHtml(value??"Not available")}</dd></div>`).join("")}</dl></details>`;
  }

  function renderCandidateList(race) {
    const focused=candidateList.contains(document.activeElement)?document.activeElement.dataset.candidate:null;
    candidateList.innerHTML = (race.candidates || []).map((candidate) => `
      <button class="admin-candidate" type="button" data-candidate="${escapeHtml(candidate.name)}">
        <strong>${escapeHtml(candidate.name)}</strong>
        <span class="operator-candidate-party">${escapeHtml(candidate.party || candidate.partyCode || "")}</span><span class="operator-candidate-total">${(candidate.votes || 0).toLocaleString()} votes</span><b>${Number(candidate.percent || 0).toFixed(1)}%</b>
      </button>
    `).join("");
    if(focused) [...candidateList.querySelectorAll("[data-candidate]")].find(button=>button.dataset.candidate===focused)?.focus();
  }

  function renderRace() {
    const race = currentRace();
    if (!race) { candidateList.innerHTML = "No matching races."; callRows.innerHTML = ""; return; }
    renderRaceMeta(race);
    renderCandidateList(race);
    renderCalls();
    clearNoteForm();
    renderNoteSelect();
  }

  function renderApp() {
    const races = activeRaces();
    const previousValue = raceSelect.value;
    raceModeLabel.textContent = "2026 races";
    raceSelect.innerHTML = races.map((race) => `
      <option value="${escapeHtml(race.id)}">${escapeHtml(race.state ? `${race.state} - ${race.label}` : race.label)}</option>
    `).join("");
    if (races.some((race) => race.id === previousValue)) raceSelect.value = previousValue;
    renderRace();
  }

  function renderOverlayForm() {
    const overlay = state.overlay || {};
    $("tickerText").value = (overlay.tickerItems || [])
      .map((item) => {
        const text = String(item?.text || "").trim();
        if (!text) return "";
        const tag = String(item?.tag || "").trim();
        return tag && tag !== "FEA" ? `${tag}: ${text}` : text;
      })
      .filter(Boolean)
      .join("\n");
    $("producerNote").value = overlay.producerNote || "";
  }

  function callVerb(label, race, count) {
    const text = String(label || "").toLowerCase();
    const raceText = String(race?.label || "").toLowerCase();
    if (text.includes("advance") || raceText.includes("primary") || count > 1) return count > 1 ? "advance" : "advances";
    if (text.includes("project")) return "is projected to win";
    return "wins";
  }

  function callLabel(call) {
    const status = String(call?.status || "").toLowerCase();
    if (call?.label) return call.label;
    if (status === "winner") return "Winner";
    if (status === "advanced") return "Advanced to general election";
    if (status === "advances") return "Advances";
    return "Projected winner";
  }

  function renderCallPreview() {
    const race = currentRace();
    const calls = state.calls.races?.[race?.id]?.calls || [];
    if (!race || !calls.length) {
      callPreview.className = "admin-preview-empty";
      callPreview.innerHTML = "Call a race to see the broadcast graphic here.";
      return;
    }
    const calledCandidates = calls.map((call) => ({
      call,
      candidate: (race.candidates || []).find((candidate) => candidate.name.toLowerCase() === call.candidate.toLowerCase()) || { name: call.candidate, partyCode: "" }
    }));
    const color = candidateColor(calledCandidates[0]?.candidate);
    const names = calledCandidates.map((item) => item.candidate.name);
    const label = callLabel(calls[0]);
    const verb = callVerb(label, race, names.length);
    const text = names.length === 1
      ? `${names[0]} ${verb} in the ${race.label}.`
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)} ${verb} in the ${race.label}.`;
    const avatars = calledCandidates.map((item) => {
      const photo = candidatePhoto(item.candidate, race);
      return `
        <span class="admin-preview-avatar" style="--candidate-color:${escapeHtml(candidateColor(item.candidate))}">
          <img src="${escapeHtml(photo)}" alt="" onerror="this.remove()">
          <span>${escapeHtml(initials(item.candidate.name))}</span>
        </span>
      `;
    }).join("");
    callPreview.className = "admin-preview-card";
    callPreview.style.setProperty("--candidate-color", color);
    callPreview.innerHTML = `
      <div class="admin-preview-card-inner">
        <div>
          <p class="admin-preview-label">${escapeHtml(label)}</p>
          <h3>${escapeHtml(text)}</h3>
          <small>${calls.some(c=>c.provider === "NBC") ? "NBC projects • FEA results via NBC" : "FEA manual call"}</small>
        </div>
        <div class="admin-preview-avatars">${avatars}</div>
      </div>
    `;
  }

  async function unlock() {
    state.secret = secretInput.value.trim();
    if (!state.secret || state.unlocking) return;
    state.unlocking = true;
    let payload;
    try { payload = await adminFetch("/api/admin/bootstrap"); } finally { state.unlocking = false; }
    // bootstrap succeeded
    try { const response=await fetch("data/election-night-watchlist.json",{cache:"no-store"});state.watchlist=FEAResultsUI.watchMetadata(response.ok?await response.json():null,payload.races||[]); } catch {state.watchlist=new Map();}
    sessionStorage.setItem("feaAdminSecret", state.secret);
    state.latestRaces = payload.latestRaces || payload.races || [];
    state.allRaces = payload.allRaces || state.latestRaces;
    state.calls = payload.calls || { races: {} };
    state.notes = payload.notes || { races: {} };
    state.overlay = payload.overlay || { tickerItems: [], producerNote: "" };
    loginPanel.hidden = true;
    adminApp.hidden = false;
    await refreshControl();
    showWorkspace("dashboard");
    if (!controlTimer) controlTimer = setInterval(refreshControl, 5000);
    renderControl.signature = null; renderControl();
    renderOverlayForm();
    renderApp();
  }

  function collectCalls() {
    return [...callRows.querySelectorAll(".admin-call-row")]
      .map((row) => ({
        candidate: row.querySelector(".call-candidate")?.value || "",
        status: row.querySelector(".call-status")?.value || "projected"
      }))
      .filter((call) => call.candidate);
  }

  async function saveCalls() {
    const race = currentRace();
    if (!race) return;
    const calls = collectCalls();
    if (!await confirmAction(calls.length ? `Call ${race.label} for ${calls.map(c=>c.candidate).join(" and ")}? Automatic NBC calls stop for this race until you choose to use them again.` : `Clear the FEA call for ${race.label} and keep NBC automation overridden?`)) return;
    setStatus(callStatus, "Saving...");
    try {
      const payload = await adminFetch("/api/admin/calls", {
        method: "POST",
        body: JSON.stringify({ raceId: race.id, calls: collectCalls() })
      });
      state.calls.races[race.id] = { calls: payload.calls || [] };
      dirty = false;
      await refreshControl();
      renderCalls();
      backupStatus(payload);
      setStatus(callStatus,"Call saved.");
    } catch (error) {
      setStatus(callStatus, error.message, true);
    }
  }

  async function saveOverlay() {
    setStatus(overlayStatus, "Saving...");
    try {
      const payload = await adminFetch("/api/admin/overlay", {
        method: "POST",
        body: JSON.stringify({
          tickerText: $("tickerText").value,
          producerNote: $("producerNote").value
        })
      });
      state.overlay = payload.overlay || state.overlay;
      overlayDirty = false;
      backupStatus(payload);
      setStatus(overlayStatus,"Ticker saved. Your broadcast will update shortly.");
    } catch (error) {
      setStatus(overlayStatus, error.message, true);
    }
  }

  async function saveNote() {
    const race = currentRace();
    if (!race) return;
    setStatus(noteStatus, "Saving...");
    try {
      const wasEditing = state.noteIndex !== null;
      const payload = await adminFetch("/api/admin/notes", {
        method: "POST",
        body: JSON.stringify({
          raceId: race.id,
          author: $("noteAuthor").value,
          role: $("noteRole").value,
          date: $("noteDate").value,
          text: $("noteText").value,
          image: $("noteImage").value,
          embed: $("noteEmbed").value,
          noteIndex: state.noteIndex
        })
      });
      state.notes.races[race.id] = payload.notes || [];
      noteDirty = false;
      state.noteIndex = null;
      $("noteText").value = "";
      $("noteImage").value = "";
      $("noteEmbed").value = "";
      renderNoteSelect();
      $("saveNote").textContent = "Add newest note";
      backupStatus(payload);
      const message = wasEditing ? "Analyst note updated" : "Analyst note added as newest note";
      setStatus(noteStatus,`${message}.`);
    } catch (error) {
      setStatus(noteStatus, error.message, true);
    }
  }

  $("unlockAdmin").addEventListener("click", () => unlock().catch((error) => {
    const status = document.createElement("p");
    status.className = "admin-status error";
    status.textContent = "Unable to sign in. Check your password and try again.";
    loginPanel.querySelector(".admin-status")?.remove();
    status.setAttribute("role","alert");
    loginPanel.append(status);
  }));
  secretInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("unlockAdmin").click();
  });
  let previousRace = "";
  raceSelect.addEventListener("focus", () => { previousRace = raceSelect.value; });
  raceSelect.addEventListener("change", async () => {
    if ((dirty || noteDirty) && !await confirmAction("Discard unsaved race call or analysis edits?")) { raceSelect.value = previousRace; return; }
    dirty = false; noteDirty = false; previousRace = raceSelect.value; renderRace();
  });
  showAllRaces?.addEventListener("change", () => {
    state.showAllRaces = Boolean(showAllRaces.checked);
    renderApp();
  });
  $("addCallRow").addEventListener("click", () => {
    callRows.insertAdjacentHTML("beforeend", callRowMarkup());
    dirty = true;
  });
  $("saveCalls").addEventListener("click", () => runButton($("saveCalls"), saveCalls));
  $("saveOverlay").addEventListener("click", () => runButton($("saveOverlay"), saveOverlay));
  $("saveNote").addEventListener("click", () => runButton($("saveNote"), saveNote));
  $("loadNote")?.addEventListener("click", async()=>{if(noteDirty && !await confirmAction("Discard unsaved analysis edits?"))return;noteDirty=false;loadSelectedNote();});
  $("newNote")?.addEventListener("click", async()=>{if(noteDirty && !await confirmAction("Discard unsaved analysis edits?"))return;noteDirty=false;clearNoteForm();});
  noteSelect?.addEventListener("change", async () => {
    if(noteDirty && !await confirmAction("Discard unsaved analysis edits?"))return;
    noteDirty=false;
    if (noteSelect.value === "") clearNoteForm();
    else loadSelectedNote();
  });
  callRows.addEventListener("click", (event) => {
    if (event.target.closest(".remove-call")) {
      dirty = true;
      event.target.closest(".admin-call-row")?.remove();
      if (!callRows.querySelector(".admin-call-row")) callRows.innerHTML = callRowMarkup();
    }
  });
  candidateList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-candidate]");
    if (!button) return;
    const emptySelect = callRows.querySelector(".call-candidate");
    const target = emptySelect || (() => {
      callRows.insertAdjacentHTML("beforeend", callRowMarkup());
      return [...callRows.querySelectorAll(".call-candidate")].at(-1);
    })();
    target.value = button.dataset.candidate;
    dirty = true;
  });

  // Election Night Testing Panel
  applyTestMode?.addEventListener("click", () => {
    const selectedMode = testMode.value;
    const selectedState = simulationState.value;
    
    state.testMode = selectedMode;
    state.simulationState = selectedState;
    
    // Keep the public results URL out of testing. This unlisted route serves the
    // same page so staff can try calls/maps without sharing the lab address.
    let testUrl = "/fea-results-lab-26";
    if (selectedMode === "live") {
      testUrl += "?live=true";
    } else if (selectedMode === "mock") {
      testUrl += "?mock=true";
    } else if (selectedMode === "simulation") {
      testUrl += `?simulation=true&phase=${encodeURIComponent(selectedState)}&speed=fast`;
    } else {
      testUrl += "?phase=pre_election";
    }
    openElectionNightTest.href = testUrl;
    
    setStatus(testModeStatus, "Test board ready. Open it to try this scenario.");
  });

  if (state.secret) {
    secretInput.value = state.secret;
  }
})();
