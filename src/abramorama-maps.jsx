import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG — replace these before deploying
// ─────────────────────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID  = "945891790401-fb328mkkbjmgvimscf2gj8jh6qjpjpff.apps.googleusercontent.com";
const GOOGLE_MAPS_KEY   = "AIzaSyDzg5YYRxCwyci5DFVXLrUbOPLZQo_H8cM";
const GOOGLE_SHEETS_KEY = "AIzaSyDv3PowHsC6MuIoM_9jObjcVwSuHDBaO1E"; // Sheets-only key, no referrer restriction

// Static fallback films — used if master sheet is unavailable or before it loads
const FALLBACK_FILMS = [
  { id:"film_1", title:"Eraserheads", sheetId:"1zDOAA46yeaGH31gQMorBoXcSlI1y251beqV8Cn45Kuw" },
  { id:"film_2", title:"Just Sing",   sheetId:"18hIKsURCB6_rc0lcp_naNvEZvCkN9ttPOC8eDM6NvXU" },
];

// Master sheet stores the film list — Sterling manages films from the Film Manager tab
// Set this to the ID of your master "Films" Google Sheet (tab named "Films")
// Columns: ID | Title | Sheet ID | Active (yes/no)
const MASTER_SHEET_ID = "1Yao5pZc-pnZO1RbcIEBed9idJbEkhNtV1JrIYRAZeUQ";

// Runtime film list — starts with fallback, replaced by master sheet data when loaded
let FILM_SHEETS = [...FALLBACK_FILMS];

// ─────────────────────────────────────────────────────────────────────────────
// URL PARAM HELPERS  (?film=film_2&mode=widget  or  ?mode=admin)
// ─────────────────────────────────────────────────────────────────────────────
const _params       = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
const URL_FILM_ID   = _params.get("film");   // e.g. "film_2"
const URL_MODE      = _params.get("mode");   // "admin" | "widget" | null
const URL_FILM_IDX  = Math.max(0, FILM_SHEETS.findIndex(f => f.id === URL_FILM_ID));

// Post height to parent so Squarespace iframe auto-resizes
function postHeight() {
  try { window.parent.postMessage({ type:"abramorama-height", height:document.body.scrollHeight }, "*"); } catch{}
}

const SCOPES      = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DATA_RANGE  = "Screenings!A2:H";
const HDR_RANGE   = "Screenings!A1:H1";
const HDR_VALUES  = [["Theater","Address","City","State","ZIP","Start Date","End Date","Ticket URL"]];

// Demo data shown before real credentials are wired up
const DEMO = [
  { id:"d1", theater:"IFC Center",        address:"323 Sixth Ave, New York, NY 10014",              startDate:"2026-04-04", endDate:"2026-04-17", ticketUrl:"https://ifccenter.com",         lat:40.7308,  lng:-74.0014,  _rowIndex:1 },
  { id:"d2", theater:"Laemmle Royal",     address:"11523 Santa Monica Blvd, Los Angeles, CA 90025", startDate:"2026-04-11", endDate:"2026-04-24", ticketUrl:"https://laemmle.com",           lat:34.0499,  lng:-118.4481, _rowIndex:2 },
  { id:"d3", theater:"Music Box Theatre", address:"3733 N Southport Ave, Chicago, IL 60613",        startDate:"2026-04-18", endDate:"2026-05-01", ticketUrl:"https://musicboxtheatre.com",   lat:41.9494,  lng:-87.6634,  _rowIndex:3 },
  { id:"d4", theater:"SIFF Cinema Uptown",address:"511 Queen Anne Ave N, Seattle, WA 98109",        startDate:"2026-04-25", endDate:"2026-05-08", ticketUrl:"https://siff.net",              lat:47.6230,  lng:-122.3565, _rowIndex:4 },
  { id:"d5", theater:"Alamo Drafthouse",  address:"320 E 3rd St, Austin, TX 78701",                 startDate:"2026-05-02", endDate:"2026-05-15", ticketUrl:"https://drafthouse.com",        lat:30.2626,  lng:-97.7404,  _rowIndex:5 },
];

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const css = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Mono:wght@300;400&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --ink:#0d0d0d;--paper:#f5f0e8;--cream:#ede8dc;
  --gold:#b8942a;--gold-l:#d4af5a;--red:#8b1a1a;
  --green:#4caf76;--blue:#1a6ef5;
  --muted:#7a7468;--border:#c8c0b0;
  --mono:'DM Mono',monospace;--serif:'Cormorant Garamond',Georgia,serif;
}
body{background:var(--ink);font-family:var(--serif)}

/* SHELL */
.shell{min-height:100vh;background:var(--ink);color:var(--paper);overflow-x:hidden;position:relative}
.shell::before{content:'';position:fixed;inset:0;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.05'/%3E%3C/svg%3E");pointer-events:none;z-index:998;opacity:.55}

/* NAV */
.nav{display:flex;align-items:center;justify-content:space-between;padding:16px 36px;border-bottom:1px solid rgba(200,192,176,.18);position:sticky;top:0;background:rgba(13,13,13,.95);backdrop-filter:blur(16px);z-index:200;gap:14px;flex-wrap:wrap}
.brand{font-family:var(--mono);font-size:11px;letter-spacing:.32em;color:var(--gold);text-transform:uppercase;white-space:nowrap}
.nav-r{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.tabs{display:flex;border:1px solid rgba(200,192,176,.28)}
.tab{padding:8px 20px;background:transparent;border:none;color:var(--muted);font-family:var(--mono);font-size:10px;letter-spacing:.15em;text-transform:uppercase;cursor:pointer;transition:all .18s}
.tab.on{background:var(--gold);color:var(--ink)}
.tab:hover:not(.on){background:rgba(184,148,42,.1);color:var(--paper)}
.auth-btn{display:flex;align-items:center;gap:7px;padding:7px 14px;border:1px solid rgba(200,192,176,.28);background:transparent;color:var(--paper);font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;transition:all .18s;white-space:nowrap}
.auth-btn:hover{border-color:var(--gold);color:var(--gold)}
.auth-btn.on{border-color:rgba(76,175,118,.5);color:var(--green);cursor:default}
.auth-btn.sm{font-size:9px;padding:6px 11px}
.adot{width:7px;height:7px;border-radius:50%;background:currentColor;flex-shrink:0}

/* MAIN */
.main{padding:0 36px 80px;max-width:1140px;margin:0 auto}
.ph{padding:44px 0 28px;border-bottom:1px solid rgba(200,192,176,.14);margin-bottom:32px}
.ph h1{font-family:var(--serif);font-size:clamp(2rem,4.5vw,3.2rem);font-weight:300;font-style:italic;line-height:1.1}
.ph h1 em{color:var(--gold);font-style:normal}
.ph-sub{margin-top:7px;font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--muted);text-transform:uppercase}

/* SETUP BANNER */
.sbanner{border:1px solid rgba(184,148,42,.38);background:rgba(184,148,42,.055);padding:18px 22px;margin-bottom:24px}
.sbanner h4{font-family:var(--mono);font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin-bottom:9px}
.sbanner ol{padding-left:17px}
.sbanner li{font-family:var(--mono);font-size:10px;color:rgba(245,240,232,.68);line-height:2}
.sbanner code{background:rgba(255,255,255,.08);padding:1px 5px;font-size:9px}
.dismiss{margin-top:12px;background:transparent;border:1px solid rgba(200,192,176,.28);color:var(--muted);font-family:var(--mono);font-size:9px;letter-spacing:.14em;text-transform:uppercase;padding:5px 12px;cursor:pointer}
.dismiss:hover{color:var(--paper)}

/* FILM ROW */
.film-row{display:flex;align-items:center;gap:12px;margin-bottom:24px;flex-wrap:wrap}
.flbl{font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--muted);text-transform:uppercase;white-space:nowrap}
.fsel{background:rgba(255,255,255,.04);border:1px solid rgba(200,192,176,.28);color:var(--paper);font-family:var(--serif);font-size:15px;padding:9px 13px;flex:1;min-width:180px;appearance:none;cursor:pointer}
.fsel option{background:#1a1a1a}

/* BTN */
.btn{padding:9px 20px;font-family:var(--mono);font-size:10px;letter-spacing:.15em;text-transform:uppercase;border:none;cursor:pointer;transition:all .18s;white-space:nowrap}
.btn-g{background:var(--gold);color:var(--ink)}
.btn-g:hover{background:var(--gold-l)}
.btn-o{background:transparent;border:1px solid rgba(200,192,176,.38);color:var(--paper)}
.btn-o:hover{border-color:var(--gold);color:var(--gold)}
.btn-d{background:transparent;border:1px solid rgba(139,26,26,.5);color:#c0392b;padding:5px 12px;font-size:9px}
.btn-d:hover{background:rgba(139,26,26,.14)}
.btn:disabled{opacity:.38;cursor:not-allowed}

/* SYNC ROW */
.sync-row{display:flex;align-items:center;gap:8px;margin-bottom:16px}
.sbadge{font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--muted);display:flex;align-items:center;gap:5px}
.sbadge.ok{color:var(--green)}.sbadge.err{color:#e74c3c}

/* FORM CARD */
.fc{border:1px solid rgba(200,192,176,.18);background:rgba(255,255,255,.02);padding:26px;margin-bottom:24px;animation:fs .2s ease}
@keyframes fs{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
.fc h3{font-family:var(--serif);font-size:1rem;font-weight:300;font-style:italic;color:var(--gold);margin-bottom:18px}
.fg{display:grid;grid-template-columns:1fr 1fr;gap:13px}
.fg .full{grid-column:1/-1}
.field{display:flex;flex-direction:column;gap:4px}
.field label{font-family:var(--mono);font-size:9px;letter-spacing:.2em;color:var(--muted);text-transform:uppercase}
.field input{background:rgba(255,255,255,.04);border:1px solid rgba(200,192,176,.22);color:var(--paper);font-family:var(--serif);font-size:15px;padding:8px 12px;outline:none;transition:border-color .18s;width:100%}
.field input:focus{border-color:var(--gold)}
.field input::placeholder{color:rgba(200,192,176,.28)}
.fa{display:flex;gap:9px;margin-top:16px;justify-content:flex-end}

/* TABLE */
.slbl{font-family:var(--mono);font-size:10px;letter-spacing:.25em;color:var(--muted);text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:10px}
.slbl::after{content:'';flex:1;height:1px;background:rgba(200,192,176,.13)}
.tbl{display:flex;flex-direction:column;gap:1px}
.tr{display:grid;grid-template-columns:1.7fr 1.4fr 1fr 1fr auto;gap:12px;align-items:center;padding:13px 16px;background:rgba(255,255,255,.02);border:1px solid rgba(200,192,176,.09);transition:background .14s}
.tr:hover{background:rgba(255,255,255,.042)}
.tr.hdr{background:transparent;border-color:transparent;padding-bottom:5px}
.tr.hdr span{font-family:var(--mono);font-size:9px;letter-spacing:.18em;color:var(--muted);text-transform:uppercase}
.tn{font-family:var(--serif);font-size:15px;color:var(--paper)}
.ta{font-family:var(--mono);font-size:10px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.td{font-family:var(--mono);font-size:11px;color:var(--paper)}
.tl{font-family:var(--mono);font-size:10px;color:var(--gold);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;max-width:155px}
.tl:hover{color:var(--gold-l);text-decoration:underline}
.sd{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px}
.sd.active{background:var(--green)}.sd.upcoming{background:var(--gold)}.sd.ended{background:var(--muted)}

/* EMPTY */
.empty{text-align:center;padding:72px 20px;color:var(--muted)}
.empty .big{font-family:var(--serif);font-size:5rem;font-weight:300;font-style:italic;opacity:.1;line-height:1;margin-bottom:12px}
.empty p{font-family:var(--mono);font-size:11px;letter-spacing:.15em;text-transform:uppercase}

/* ── WIDGET ── */
.wwrap{border:1px solid rgba(200,192,176,.18);background:var(--paper);color:var(--ink);padding:28px;margin-top:18px}
.wt{font-family:var(--serif);font-size:2.1rem;font-weight:300;font-style:italic;color:var(--ink);margin-bottom:3px}
.wtag{font-family:var(--mono);font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin-bottom:22px}
.wf{display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap}
.wf label{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.wf input{border:1px solid var(--border);background:white;color:var(--ink);font-family:var(--mono);font-size:11px;padding:6px 10px;outline:none}
.wf input:focus{border-color:var(--gold)}
.geo-btn{margin-left:auto;background:var(--ink);color:var(--paper);border:none;padding:8px 16px;font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background .18s}
.geo-btn:hover{background:var(--gold);color:var(--ink)}
.geo-btn:disabled{opacity:.5;cursor:not-allowed}

/* MAP CONTAINER */
.map-wrap{position:relative;margin-bottom:20px}
.map-el{width:100%;height:380px;border:1px solid var(--border)}
.map-key-note{margin-top:6px;font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:.1em}

/* CARDS */
.wcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(225px,1fr));gap:1px;background:var(--border);align-items:stretch}
.wcard{background:white;padding:15px;position:relative;display:flex;flex-direction:column}
.wcdist{font-family:var(--mono);font-size:9px;color:var(--gold);margin-bottom:8px}
.wctkt{display:inline-block;background:var(--ink);color:white;font-family:var(--mono);font-size:9px;letter-spacing:.14em;text-transform:uppercase;padding:6px 13px;text-decoration:none;transition:background .15s;margin-top:auto;align-self:flex-start}
.wcn{font-family:var(--serif);font-size:15px;font-weight:600;color:var(--ink);margin-bottom:3px}
.wca{font-family:var(--mono);font-size:9px;color:var(--muted);margin-bottom:8px;line-height:1.55}
.wcd{font-family:var(--mono);font-size:10px;color:var(--ink);margin-bottom:9px;padding:5px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.wcdist{font-family:var(--mono);font-size:9px;color:var(--gold);margin-bottom:8px}
.wctkt{display:inline-block;background:var(--ink);color:white;font-family:var(--mono);font-size:9px;letter-spacing:.14em;text-transform:uppercase;padding:6px 13px;text-decoration:none;transition:background .15s}
.wctkt:hover{background:var(--gold)}
.nbadge{position:absolute;top:10px;right:10px;background:var(--gold);color:var(--ink);font-family:var(--mono);font-size:8px;letter-spacing:.1em;padding:2px 7px;text-transform:uppercase}

/* TOAST */
.toast{position:fixed;bottom:26px;right:26px;background:var(--gold);color:var(--ink);font-family:var(--mono);font-size:11px;letter-spacing:.11em;padding:10px 17px;z-index:9999;animation:ti .18s ease;max-width:300px;line-height:1.4}
.toast.err{background:#c0392b;color:white}
@keyframes ti{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

/* LOADING OVERLAY on map */
.map-loading{position:absolute;inset:0;background:rgba(232,228,220,.82);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);z-index:10;border:1px solid var(--border)}
.spin{animation:spin .7s linear infinite;display:inline-block;margin-right:8px}
@keyframes spin{to{transform:rotate(360deg)}}

@media(max-width:660px){
  .nav,.main{padding-left:16px;padding-right:16px}
  .fg{grid-template-columns:1fr}.fg .full{grid-column:1}
  .tr{grid-template-columns:1fr;gap:3px}.tr.hdr{display:none}
  .map-el{height:260px}
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = d => { if(!d) return "—"; const [,m,day]=d.split("-"); return `${MONTHS[+m-1]} ${+day}`; };
const status  = s => { const t=new Date().toISOString().slice(0,10); return s.endDate<t?"ended":s.startDate>t?"upcoming":"active"; };
const haversineKm = (a,b,c,d) => { const R=6371,dL=(c-a)*Math.PI/180,dG=(d-b)*Math.PI/180,x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dG/2)**2; return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); };
const milesAway   = (a,b,c,d) => (haversineKm(a,b,c,d)*0.621371).toFixed(1);
const demoMode    = () => GOOGLE_CLIENT_ID.startsWith("YOUR_") || GOOGLE_MAPS_KEY.startsWith("YOUR_");

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE MAPS LOADER
// ─────────────────────────────────────────────────────────────────────────────
let mapsPromise = null;
function loadMaps() {
  if (mapsPromise) return mapsPromise;
  if (demoMode()) { mapsPromise = Promise.reject(new Error("demo")); return mapsPromise; }
  mapsPromise = new Promise((resolve, reject) => {
    if (window.google?.maps?.places) { resolve(window.google.maps); return; }
    const cb = `_gmInit_${Date.now()}`;
    window[cb] = () => { resolve(window.google.maps); delete window[cb]; };
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&callback=${cb}&libraries=marker,places`;
    s.async = true;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return mapsPromise;
}

// Kick off Maps + Places load immediately on app start (needed for autocomplete)
if (!demoMode()) loadMaps();

// ─────────────────────────────────────────────────────────────────────────────
// GEOCODING
// ─────────────────────────────────────────────────────────────────────────────
const geocache = {};
async function geocodeAddress(address) {
  if (!address) return null;
  if (geocache[address]) return geocache[address];
  try {
    if (demoMode()) {
      // Nominatim fallback for demo mode
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
        { headers:{"Accept-Language":"en"} }
      );
      const d = await r.json();
      if (!d.length) return null;
      const g = { lat:parseFloat(d[0].lat), lng:parseFloat(d[0].lon) };
      geocache[address] = g; return g;
    }
    // Use Google Geocoding API — wait for Maps to be loaded first
    await loadMaps();
    return new Promise((resolve) => {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ address }, (results, status) => {
        if (status !== "OK" || !results.length) { resolve(null); return; }
        const { lat, lng } = results[0].geometry.location;
        const g = { lat: lat(), lng: lng() };
        geocache[address] = g;
        resolve(g);
      });
    });
  } catch(e) {
    console.warn("Geocode failed for:", address, e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHEETS API
// ─────────────────────────────────────────────────────────────────────────────
async function sheetsGet(token, sheetId, range) {
  const r = await fetch(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}`,
    { headers:{Authorization:`Bearer ${token}`} });
  if(!r.ok) throw new Error(`GET ${r.status}`);
  return r.json();
}
async function sheetsAppend(token, sheetId, range, values) {
  const r = await fetch(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method:"POST", headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"}, body:JSON.stringify({values}) });
  if(!r.ok) throw new Error(`APPEND ${r.status}`);
  return r.json();
}
async function sheetsDelete(token, sheetId, tabGid, rowIndex) {
  const r = await fetch(`${SHEETS_BASE}/${sheetId}:batchUpdate`,
    { method:"POST", headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
      body:JSON.stringify({ requests:[{ deleteDimension:{ range:{ sheetId:tabGid, dimension:"ROWS", startIndex:rowIndex, endIndex:rowIndex+1 } } }] }) });
  if(!r.ok) throw new Error(`DELETE ${r.status}`);
  return r.json();
}
async function ensureHeader(token, sheetId) {
  const d = await sheetsGet(token, sheetId, HDR_RANGE);
  if(d.values?.[0]?.[0]==="Theater") return;
  await fetch(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(HDR_RANGE)}?valueInputOption=RAW`,
    { method:"PUT", headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"}, body:JSON.stringify({values:HDR_VALUES}) });
}
// Public read — no auth, uses Sheets API with key (CORS-safe)
async function readScreeningsPublic(sheetId) {
  // Small delay ensures page referrer header is set before the API call
  await new Promise(r => setTimeout(r, 200));
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Screenings!A2:H?key=${GOOGLE_SHEETS_KEY}`;
  const r = await fetch(url, {
    headers: { "Referer": typeof window !== "undefined" ? window.location.origin : "" }
  });
  if(!r.ok) throw new Error(`Public read failed: ${r.status}`);
  const d = await r.json();
  if(!d.values) return [];
  return d.values.map((row, i) => parseRow(row, i, sheetId)).filter(r=>r.theater);
}

function parseRow(row, i, sheetId) {
  // Detect old 5-column format: Theater|Address|StartDate|EndDate|TicketURL
  // vs new 8-column format: Theater|Address|City|State|ZIP|StartDate|EndDate|TicketURL
  // A date looks like 2026-04-24; if col[2] is a date it's the old format
  const isOldFormat = /^\d{4}-\d{2}-\d{2}$/.test(row[2]||"") || (!row[5] && !row[6]);
  if (isOldFormat) {
    return {
      _rowIndex:i+1, id:`${sheetId}_${i}`,
      theater:row[0]||"", address:row[1]||"",
      city:"", state:"", zip:"",
      startDate:row[2]||"", endDate:row[3]||"", ticketUrl:row[4]||"",
      lat:null, lng:null,
    };
  }
  return {
    _rowIndex:i+1, id:`${sheetId}_${i}`,
    theater:row[0]||"", address:row[1]||"",
    city:row[2]||"", state:row[3]||"", zip:row[4]||"",
    startDate:row[5]||"", endDate:row[6]||"", ticketUrl:row[7]||"",
    lat:null, lng:null,
  };
}

async function readScreenings(token, sheetId) {
  if(!token) return readScreeningsPublic(sheetId);
  const d = await sheetsGet(token, sheetId, DATA_RANGE);
  if(!d.values) return [];
  return d.values.map((row,i) => parseRow(row, i, sheetId));
}

// ─────────────────────────────────────────────────────────────────────────────
// MASTER FILM LIST — read/write to master Sheet
// ─────────────────────────────────────────────────────────────────────────────
function parseFilmRows(values) {
  return values
    .filter(row => row[1] && row[2])
    .filter(row => (row[3]||"yes").toLowerCase() !== "no")
    .map((row) => {
      const title = row[1].trim();
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
      const id = (row[0]||"").trim() || `film_${slug}`;
      return { id, title, sheetId: row[2].trim() };
    });
}

// Public film list read — uses Sheets key, no auth needed
// Called by the widget so it can show any film without Sterling being signed in
async function readFilmListPublic() {
  if(MASTER_SHEET_ID.startsWith("YOUR_")) return [...FALLBACK_FILMS];
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/Films!A2:D?key=${GOOGLE_SHEETS_KEY}`;
    const r = await fetch(url);
    if(!r.ok) throw new Error(`Film list read failed: ${r.status}`);
    const d = await r.json();
    if(!d.values) return [...FALLBACK_FILMS];
    return parseFilmRows(d.values);
  } catch(e) {
    console.warn("Could not read film list publicly:", e);
    return [...FALLBACK_FILMS];
  }
}

async function readFilmList(token) {
  if(!token || MASTER_SHEET_ID.startsWith("YOUR_")) return [...FALLBACK_FILMS];
  try {
    await ensureFilmListHeader(token);
    const d = await sheetsGet(token, MASTER_SHEET_ID, "Films!A2:D");
    if(!d.values) return [...FALLBACK_FILMS];
    return parseFilmRows(d.values);
  } catch(e) {
    console.warn("Could not read film list:", e);
    return [...FALLBACK_FILMS];
  }
}

async function ensureFilmListHeader(token) {
  try {
    const d = await sheetsGet(token, MASTER_SHEET_ID, "Films!A1:D1");
    if(d.values?.[0]?.[0] === "ID") return;
    await fetch(`${SHEETS_BASE}/${MASTER_SHEET_ID}/values/${encodeURIComponent("Films!A1:D1")}?valueInputOption=RAW`, {
      method:"PUT", headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
      body: JSON.stringify({ values:[["ID","Title","Sheet ID","Active"]] }),
    });
  } catch(e) {}
}

async function addFilmToMaster(token, film) {
  await sheetsAppend(token, MASTER_SHEET_ID, "Films!A2:D", [[film.id, film.title, film.sheetId, "yes"]]);
}

async function removeFilmFromMaster(token, rowIndex) {
  const meta = await fetch(`${SHEETS_BASE}/${MASTER_SHEET_ID}?fields=sheets.properties`,
    {headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json());
  const tab = meta.sheets?.find(sh=>sh.properties.title==="Films");
  if(!tab) throw new Error("No Films tab");
  await sheetsDelete(token, MASTER_SHEET_ID, tab.properties.sheetId, rowIndex);
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE AUTH HOOK
// ─────────────────────────────────────────────────────────────────────────────
function useGoogleAuth() {
  const [token, setToken] = useState(null);
  const [user, setUser]   = useState(null);
  const [loading, setLoading] = useState(false);
  const clientRef = useRef(null);

  const initClient = useCallback(() => new Promise((resolve, reject) => {
    if(!window.google) { reject(new Error("GIS not loaded")); return; }
    clientRef.current = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: async resp => {
        if(resp.error) { reject(resp.error); return; }
        setToken(resp.access_token);
        try {
          const ui = await fetch("https://www.googleapis.com/oauth2/v3/userinfo",
            { headers:{Authorization:`Bearer ${resp.access_token}`} });
          setUser(await ui.json());
        } catch{}
        resolve(resp.access_token);
      },
    });
    resolve(null);
  }), []);

  const signIn  = useCallback(async () => {
    setLoading(true);
    try { if(!clientRef.current) await initClient(); clientRef.current.requestAccessToken(); }
    catch(e){ console.error(e); }
    finally { setLoading(false); }
  }, [initClient]);

  const signOut = useCallback(() => {
    if(token) window.google?.accounts.oauth2.revoke(token);
    setToken(null); setUser(null);
  }, [token]);

  useEffect(() => {
    if(demoMode()) return;
    if(document.getElementById("gis")) { initClient(); return; }
    const s = document.createElement("script");
    s.id="gis"; s.src="https://accounts.google.com/gsi/client"; s.async=true;
    s.onload = () => initClient();
    document.head.appendChild(s);
  }, [initClient]);

  return { token, user, loading, signIn, signOut };
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE MAP COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
function GoogleMap({ screenings, userPos, onMarkerClick, activeId }) {
  const mapRef    = useRef(null);
  const mapObj    = useRef(null);
  const markers   = useRef([]);
  const infoRef   = useRef(null);
  const [mapErr,  setMapErr]  = useState(false);
  const [mapLoad, setMapLoad] = useState(true);

  // Init map
  useEffect(() => {
    loadMaps()
      .then(maps => {
        if(!mapRef.current) return;
        mapObj.current = new maps.Map(mapRef.current, {
          center: { lat:39.5, lng:-98.35 },
          zoom: 4,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          styles: [
            { featureType:"all", elementType:"labels.text.fill", stylers:[{color:"#4a4037"}] },
            { featureType:"water", elementType:"geometry", stylers:[{color:"#c9d8e8"}] },
            { featureType:"landscape", elementType:"geometry", stylers:[{color:"#f0ece0"}] },
            { featureType:"road", elementType:"geometry", stylers:[{color:"#ddd5c0"}] },
            { featureType:"road.highway", elementType:"geometry", stylers:[{color:"#c8b89a"}] },
            { featureType:"poi", elementType:"geometry", stylers:[{color:"#ddd5c0"}] },
            { featureType:"transit", elementType:"geometry", stylers:[{color:"#ddd5c0"}] },
            { featureType:"administrative", elementType:"geometry.stroke", stylers:[{color:"#c0b498"}] },
          ],
        });
        infoRef.current = new maps.InfoWindow();
        setMapLoad(false);
      })
      .catch(() => { setMapErr(true); setMapLoad(false); });
  }, []);

  // Sync markers whenever screenings change
  useEffect(() => {
    if(!mapObj.current || !window.google?.maps) return;
    const maps = window.google.maps;

    // Clear old markers
    markers.current.forEach(m => m.setMap(null));
    markers.current = [];

    const placed = screenings.filter(s => s.lat && s.lng);
    placed.forEach(s => {
      const isNear = userPos && parseFloat(milesAway(userPos.lat,userPos.lng,s.lat,s.lng)) < 80;
      const marker = new maps.Marker({
        position: { lat:s.lat, lng:s.lng },
        map: mapObj.current,
        title: s.theater,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: activeId===s.id ? 12 : 9,
          fillColor: isNear ? "#b8942a" : "#8b1a1a",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
        animation: activeId===s.id ? maps.Animation.BOUNCE : null,
        zIndex: activeId===s.id ? 10 : 1,
      });
      marker.addListener("click", () => {
        infoRef.current.setContent(`
          <div style="font-family:'DM Mono',monospace;padding:6px 2px;min-width:180px">
            <div style="font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:600;margin-bottom:4px">${s.theater}</div>
            <div style="font-size:10px;color:#7a7468;margin-bottom:8px;line-height:1.5">${s.address}</div>
            <div style="font-size:10px;color:#333;margin-bottom:10px;border-top:1px solid #ddd;border-bottom:1px solid #ddd;padding:5px 0">
              ${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}
            </div>
            ${userPos && s.lat ? `<div style="font-size:9px;color:#b8942a;margin-bottom:8px">📍 ${milesAway(userPos.lat,userPos.lng,s.lat,s.lng)} mi away</div>` : ""}
            <a href="${s.ticketUrl}" target="_blank" style="display:inline-block;background:#0d0d0d;color:white;font-size:9px;letter-spacing:.12em;text-transform:uppercase;padding:6px 12px;text-decoration:none">Get Tickets →</a>
          </div>
        `);
        infoRef.current.open(mapObj.current, marker);
        onMarkerClick(s.id);
      });
      markers.current.push(marker);
    });

    // Fit bounds to placed theaters — always constrain to US view
    if(placed.length > 0) {
      const bounds = new maps.LatLngBounds();
      placed.forEach(s => bounds.extend({ lat:s.lat, lng:s.lng }));
      if(userPos) bounds.extend(userPos);
      mapObj.current.fitBounds(bounds, 48);
      if(placed.length===1) mapObj.current.setZoom(12);
      // After fitBounds, enforce min zoom of 4 (US view) and max zoom of 3 never
      maps.event.addListenerOnce(mapObj.current, "idle", () => {
        const z = mapObj.current.getZoom();
        if(z < 4) mapObj.current.setZoom(4);
        // Also constrain center to continental US
        const c = mapObj.current.getCenter();
        const lat = Math.max(24, Math.min(50, c.lat()));
        const lng = Math.max(-130, Math.min(-60, c.lng()));
        mapObj.current.setCenter({ lat, lng });
      });
    } else {
      mapObj.current.setCenter({ lat:39.5, lng:-98.35 });
      mapObj.current.setZoom(4);
    }
  }, [screenings, userPos, activeId]);

  // User position marker
  const userMarkerRef = useRef(null);
  useEffect(() => {
    if(!mapObj.current || !window.google?.maps || !userPos) return;
    if(userMarkerRef.current) userMarkerRef.current.setMap(null);
    userMarkerRef.current = new window.google.maps.Marker({
      position: userPos,
      map: mapObj.current,
      title: "Your location",
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#1a6ef5",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      },
      zIndex: 20,
    });
  }, [userPos]);

  if(mapErr) return (
    <div className="map-el" style={{display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:10,background:"#e8e4dc",border:"1px solid var(--border)"}}>
      <div style={{fontFamily:"var(--mono)",fontSize:11,letterSpacing:".15em",textTransform:"uppercase",color:"var(--muted)"}}>Map unavailable in demo mode</div>
      <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--muted)"}}>Add a real Maps API key to enable</div>
    </div>
  );

  return (
    <div className="map-wrap">
      <div ref={mapRef} className="map-el" />
      {mapLoad && (
        <div className="map-loading"><span className="spin">⟳</span> Loading map…</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STATIC FALLBACK MAP  (shown in demo mode)
// ─────────────────────────────────────────────────────────────────────────────
const B = { minLat:24,maxLat:50,minLng:-125,maxLng:-66 };
function toP(lat,lng) {
  return {
    x: Math.max(2,Math.min(97,((lng-B.minLng)/(B.maxLng-B.minLng))*100)),
    y: Math.max(3,Math.min(94,((B.maxLat-lat)/(B.maxLat-B.minLat))*100)),
  };
}
const US_OUTLINE = "M60,78 L88,64 L138,56 L200,50 L262,48 L322,50 L372,54 L412,60 L444,70 L464,82 L470,100 L464,120 L448,134 L426,144 L398,150 L368,154 L338,157 L308,158 L278,157 L248,153 L218,146 L188,136 L162,124 L136,110 L110,96 L84,84 Z M60,78 L42,86 L36,100 L44,114 L58,120 L72,116 L76,102 L68,90 Z M378,158 L396,174 L410,186 L418,200 L410,212 L396,216 L382,212 L372,198 L368,182 Z";

function StaticMap({ screenings, userPos, activeId, onMarkerClick }) {
  const [tooltip, setTooltip] = useState(null);
  const filtered = screenings.filter(s=>s.lat&&s.lng);
  return (
    <div className="map-wrap">
      <div className="map-el" style={{position:"relative",overflow:"hidden",background:"#eae5d8",cursor:"default"}}>
        {/* Light topo-style background */}
        <svg viewBox="0 0 530 300" style={{position:"absolute",inset:0,width:"100%",height:"100%"}}>
          <rect width="530" height="300" fill="#ddd8cc"/>
          <path d={US_OUTLINE} fill="#e8e3d4" stroke="#b8b09a" strokeWidth="1.2"/>
        </svg>

        {/* Pins */}
        {filtered.map(s => {
          const p = toP(s.lat,s.lng);
          const near = userPos && parseFloat(milesAway(userPos.lat,userPos.lng,s.lat,s.lng))<80;
          const active = activeId===s.id;
          return (
            <div key={s.id}
              onClick={()=>{ onMarkerClick(s.id); setTooltip(tooltip===s.id?null:s.id); }}
              style={{
                position:"absolute", left:`${p.x}%`, top:`${p.y}%`,
                transform:`translate(-50%,-100%) scale(${active?1.2:1})`,
                cursor:"pointer", zIndex:active?10:2, transition:"transform .15s",
              }}>
              <div style={{
                width:13,height:13,borderRadius:"50% 50% 50% 0",transform:"rotate(-45deg)",
                background:near?"#b8942a":"#8b1a1a",border:"2px solid white",
                boxShadow:"0 2px 6px rgba(0,0,0,.32)",
              }}/>
              {tooltip===s.id && (
                <div style={{
                  position:"absolute",bottom:"calc(100% + 6px)",left:"50%",transform:"translateX(-50%)",
                  background:"#0d0d0d",color:"white",fontFamily:"var(--mono)",fontSize:9,
                  padding:"6px 10px",whiteSpace:"nowrap",zIndex:20,letterSpacing:".1em",
                  boxShadow:"0 4px 16px rgba(0,0,0,.4)",
                }}>
                  <div style={{fontFamily:"var(--serif)",fontSize:13,marginBottom:3}}>{s.theater}</div>
                  <div style={{color:"#b8942a",marginBottom:4}}>{fmtDate(s.startDate)} – {fmtDate(s.endDate)}</div>
                  {near && <div style={{color:"#b8942a",marginBottom:4}}>📍 {milesAway(userPos.lat,userPos.lng,s.lat,s.lng)} mi away</div>}
                  <a href={s.ticketUrl} target="_blank" rel="noreferrer"
                    style={{color:"#d4af5a",textDecoration:"none",fontSize:9,letterSpacing:".12em",textTransform:"uppercase"}}>
                    Get Tickets →
                  </a>
                </div>
              )}
            </div>
          );
        })}

        {/* User dot */}
        {userPos && (() => {
          const p = toP(userPos.lat,userPos.lng);
          return (
            <div style={{position:"absolute",left:`${p.x}%`,top:`${p.y}%`,transform:"translate(-50%,-50%)",zIndex:15}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:"#1a6ef5",border:"2px solid white",boxShadow:"0 0 0 4px rgba(26,110,245,.22)"}}/>
            </div>
          );
        })()}

        {/* Legend */}
        <div style={{position:"absolute",bottom:8,right:10,fontFamily:"var(--mono)",fontSize:8,color:"#8a8278",letterSpacing:".08em",lineHeight:1.8}}>
          <span style={{color:"#b8942a"}}>●</span> Near you &nbsp;<span style={{color:"#8b1a1a"}}>●</span> Other
        </div>
        <div style={{position:"absolute",bottom:8,left:10,fontFamily:"var(--mono)",fontSize:8,color:"#8a8278",letterSpacing:".08em"}}>
          Demo map — click pins for details
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function Toast({ msg, isErr, onDone }) {
  useEffect(() => { const t=setTimeout(onDone,3000); return ()=>clearTimeout(t); },[]);
  return <div className={`toast${isErr?" err":""}`}>{msg}</div>;
}

function SetupBanner() {
  const [gone, setGone] = useState(false);
  if(gone) return null;
  return (
    <div className="sbanner">
      <h4>⚙ One-time setup — replace placeholder keys in the file header</h4>
      <ol>
        <li>Google Cloud Console → enable <code>Maps JavaScript API</code>, <code>Geocoding API</code>, <code>Sheets API</code>, <code>Drive API</code></li>
        <li>Create an API key → replace <code>GOOGLE_MAPS_KEY</code></li>
        <li>Create OAuth 2.0 credentials → replace <code>GOOGLE_CLIENT_ID</code></li>
        <li>Create one Sheet per film with a tab named <code>Screenings</code> → replace each <code>YOUR_SHEET_ID_*</code></li>
        <li>Add the Squarespace domain to <em>Authorized JavaScript Origins</em></li>
      </ol>
      <button className="dismiss" onClick={()=>setGone(true)}>Got it — dismiss</button>
    </div>
  );
}

// ── PLACES AUTOCOMPLETE HOOK ──────────────────────────────────────────────────
function usePlacesAutocomplete(inputRef, onSelect) {
  const acRef = useRef(null);
  useEffect(() => {
    if (!inputRef.current || demoMode()) return;
    // Wait for Maps + Places to be ready before attaching autocomplete
    loadMaps().then(() => {
      if (!inputRef.current || acRef.current) return;
      acRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
        types: ["establishment", "geocode"],
        fields: ["name", "formatted_address", "address_components", "geometry"],
      });
      acRef.current.addListener("place_changed", () => {
        const place = acRef.current.getPlace();
        if (!place.geometry) return;
        const get = (type) => {
          const comp = place.address_components?.find(c => c.types.includes(type));
          return comp ? comp.short_name : "";
        };
        const streetNum = get("street_number");
        const route     = get("route");
        const city      = get("locality") || get("sublocality") || get("administrative_area_level_2");
        const state     = get("administrative_area_level_1");
        const zip       = get("postal_code");
        const fullAddr  = [streetNum, route].filter(Boolean).join(" ") + `, ${city}, ${state} ${zip}`;
        onSelect({
          name:    place.name || "",
          address: fullAddr.trim(),
          city, state, zip,
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng(),
        });
      });
    }).catch(() => {}); // silently skip in demo mode
    return () => {
      if (acRef.current) {
        window.google?.maps?.event.clearInstanceListeners(acRef.current);
        acRef.current = null;
      }
    };
  }, []);
}

function AddForm({ onSave, onCancel, saving }) {
  const [f, setF] = useState({ theater:"", address:"", city:"", state:"", zip:"", startDate:"", endDate:"", ticketUrl:"", lat:null, lng:null });
  const [suggestions, setSuggestions] = useState([]);
  const addrRef = useRef(null);
  const set = (k,v) => setF(p => ({...p, [k]:v}));

  // Wire up Places Autocomplete on the address input
  const handlePlaceSelect = useCallback((place) => {
    setF(p => ({
      ...p,
      theater: p.theater || place.name, // auto-fill theater name if empty
      address: place.address,
      city:    place.city,
      state:   place.state,
      zip:     place.zip,
      lat:     place.lat,
      lng:     place.lng,
    }));
  }, []);

  usePlacesAutocomplete(addrRef, handlePlaceSelect);

  const ok = f.theater && f.address && f.startDate && f.endDate && f.ticketUrl;

  return (
    <div className="fc">
      <h3>New Screening</h3>
      <div className="fg">
        <div className="field">
          <label>Theater Name</label>
          <input placeholder="e.g. IFC Center" value={f.theater} onChange={e=>set("theater",e.target.value)}/>
        </div>
        <div className="field" style={{position:"relative"}}>
          <label>Address <span style={{color:"var(--gold)",fontSize:8,letterSpacing:".1em"}}> AUTOCOMPLETE</span></label>
          <input
            ref={addrRef}
            placeholder="Start typing address or theater name…"
            value={f.address}
            onChange={e=>set("address",e.target.value)}
            style={{paddingRight:28}}
          />
          {f.lat && f.lng && (
            <span style={{position:"absolute",right:10,bottom:10,fontSize:12}} title="Location confirmed">✓</span>
          )}
        </div>
        <div className="field">
          <label>City</label>
          <input placeholder="Auto-filled" value={f.city} onChange={e=>set("city",e.target.value)}/>
        </div>
        <div className="field" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div className="field">
            <label>State</label>
            <input placeholder="Auto" value={f.state} onChange={e=>set("state",e.target.value)}/>
          </div>
          <div className="field">
            <label>ZIP</label>
            <input placeholder="Auto" value={f.zip} onChange={e=>set("zip",e.target.value)}/>
          </div>
        </div>
        <div className="field">
          <label>Start Date</label>
          <input type="date" value={f.startDate} onChange={e=>set("startDate",e.target.value)}/>
        </div>
        <div className="field">
          <label>End Date</label>
          <input type="date" value={f.endDate} onChange={e=>set("endDate",e.target.value)}/>
        </div>
        <div className="field full">
          <label>Ticket Purchase URL</label>
          <input placeholder="https://..." value={f.ticketUrl} onChange={e=>set("ticketUrl",e.target.value)}/>
        </div>
      </div>
      {f.lat && f.lng && (
        <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--green)",letterSpacing:".12em",marginTop:8}}>
          ✓ Location confirmed — geocoordinates captured ({f.lat.toFixed(4)}, {f.lng.toFixed(4)})
        </div>
      )}
      <div className="fa">
        <button className="btn btn-o" onClick={onCancel}>Cancel</button>
        <button className="btn btn-g" disabled={!ok||saving} onClick={()=>onSave(f)}>
          {saving?"Saving…":"Save to Sheet"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN VIEW
// ─────────────────────────────────────────────────────────────────────────────
function AdminView({ token, toast, films=FALLBACK_FILMS }) {
  const [fi, setFi]         = useState(0);
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [sync, setSync]     = useState(null);
  const [syncErr, setSyncErr] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const film = films[fi];

  const load = useCallback(async()=>{
    if(demoMode()||!token) { setRows(DEMO.slice(0,3)); setSync("Demo data — connect Google to sync"); return; }
    setLoading(true); setSync("Syncing…"); setSyncErr(false);
    try {
      await ensureHeader(token,film.sheetId);
      const r = await readScreenings(token,film.sheetId);
      setRows(r); setSync(`Synced ${r.length} screening${r.length!==1?"s":""}`);
    } catch(e){ setSync("Sync failed"); setSyncErr(true); toast("Could not read Sheet.",true); }
    finally { setLoading(false); }
  },[token,fi]);

  useEffect(()=>{ load(); },[load]);

  const handleSave = async fd => {
    if(demoMode()||!token){
      setRows(p=>[...p,{...fd,id:`dm${Date.now()}`,_rowIndex:p.length+1}]);
      setShowForm(false); toast("Added (demo — connect Google to persist)"); return;
    }
    setSaving(true);
    try {
      await sheetsAppend(token,film.sheetId,DATA_RANGE,[[fd.theater,fd.address,fd.city||"",fd.state||"",fd.zip||"",fd.startDate,fd.endDate,fd.ticketUrl]]);
      await load(); setShowForm(false); toast("Saved to Google Sheets ✓");
    } catch{ toast("Save failed — check permissions.",true); }
    finally { setSaving(false); }
  };

  const handleDelete = async s => {
    if(demoMode()||!token){ setRows(p=>p.filter(x=>x.id!==s.id)); toast("Removed (demo)."); return; }
    try {
      const meta = await fetch(`${SHEETS_BASE}/${film.sheetId}?fields=sheets.properties`,
        {headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json());
      const tab = meta.sheets?.find(sh=>sh.properties.title==="Screenings");
      if(!tab) throw new Error("No Screenings tab");
      await sheetsDelete(token,film.sheetId,tab.properties.sheetId,s._rowIndex);
      await load(); toast("Removed from Sheet.");
    } catch{ toast("Delete failed.",true); }
  };

  return (
    <div>
      <div className="ph">
        <h1>Screening <em>Manager</em></h1>
        <div className="ph-sub">Abramorama · Admin — {token?"Google Sheets live":"Demo mode"}</div>
      </div>
      <SetupBanner/>
      <div className="film-row">
        <span className="flbl">Film</span>
        <select className="fsel" value={fi} onChange={e=>{setFi(+e.target.value);setShowForm(false);}}>
          {films.map((f,i)=><option key={f.id} value={i}>{f.title}</option>)}
        </select>
        <button className="btn btn-g" onClick={()=>setShowForm(v=>!v)}>{showForm?"✕ Cancel":"+ Add Screening"}</button>
        <button className="btn btn-o" onClick={load} disabled={loading}>↻ Refresh</button>
      </div>
      {sync && <div className="sync-row"><div className={`sbadge ${syncErr?"err":"ok"}`}><span>{syncErr?"✕":"✓"}</span><span>{sync}</span></div></div>}
      {showForm && <AddForm onSave={handleSave} onCancel={()=>setShowForm(false)} saving={saving}/>}
      <div className="slbl">Screenings — {film.title}</div>
      {rows.length===0?(
        <div className="empty"><div className="big">∅</div><p>{loading?"Loading…":"No screenings yet"}</p></div>
      ):(
        <div className="tbl">
          <div className="tr hdr"><span>Theater</span><span>Address</span><span>Dates</span><span>Tickets</span><span/></div>
          {rows.map(s=>{
            const st=status(s);
            return (
              <div className="tr" key={s.id||s._rowIndex}>
                <div><div className="tn"><span className={`sd ${st}`}/>{s.theater}</div></div>
                <div className="ta">{s.city && s.state ? `${s.city}, ${s.state}` : s.address}</div>
                <div className="td">{fmtDate(s.startDate)} – {fmtDate(s.endDate)}</div>
                <a className="tl" href={s.ticketUrl} target="_blank" rel="noreferrer">{s.ticketUrl.replace(/^https?:\/\//,"").split("/")[0]}</a>
                <button className="btn btn-d" onClick={()=>handleDelete(s)}>Remove</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WIDGET VIEW
// ─────────────────────────────────────────────────────────────────────────────
function WidgetView({ token, toast, defaultFilmIdx=0, films=FALLBACK_FILMS }) {
  // Re-evaluate film index when master sheet loads — URL param may match a film
  // not in the fallback list (e.g. film_american_agitators)
  const getFilmIdx = (filmList) => {
    if (!URL_FILM_ID) return defaultFilmIdx;
    const idx = filmList.findIndex(f => f.id === URL_FILM_ID);
    return idx >= 0 ? idx : defaultFilmIdx;
  };
  const [fi, setFi]             = useState(()=>getFilmIdx(films));
  const isEmbedded              = URL_MODE === "widget";

  // Re-sync film index when films list updates from master sheet
  useEffect(() => {
    if(URL_FILM_ID) setFi(getFilmIdx(films));
  }, [films]);
  const [screenings, setScreenings] = useState([]);
  const [filterStart, setFS]    = useState("");
  const [filterEnd, setFE]      = useState("");
  const [userPos, setUserPos]   = useState(null);
  const [geoLoading, setGeoL]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [sheetError, setSheetError] = useState(null);
  const film = films[fi];

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      setLoading(true); setScreenings([]); setSheetError(null);
      let rows;
      if(demoMode()){
        rows=[...DEMO];
      } else {
        try{
          rows=await readScreenings(token,film.sheetId);
          if(rows.length===0) setSheetError("Sheet returned 0 rows — check the Screenings tab has data.");
        } catch(e){
          console.error("Sheet read failed:",e);
          setSheetError(`Sheet read failed: ${e.message}. Check API key restrictions and Sheet sharing settings.`);
          rows=[];
        }
      }
      if(cancelled) return;
      setScreenings(rows); setLoading(false);
      // Geocode each address
      for(const s of rows){
        if(s.lat&&s.lng) continue;
        const g=await geocodeAddress(s.address).catch(()=>null);
        if(!cancelled && g) setScreenings(p=>p.map(x=>x.id===s.id?{...x,...g}:x));
        await new Promise(r=>setTimeout(r,demoMode()?320:80));
      }
    })();
    return()=>{cancelled=true;};
  },[token,fi]);

  const filtered = screenings.filter(s=>{
    if(filterStart && s.endDate<filterStart) return false;
    if(filterEnd   && s.startDate>filterEnd) return false;
    return true;
  });

  const { sorted, nearIds } = useMemo(() => {
    const withDist = filtered.map(s => ({
      ...s,
      distMi: (userPos && s.lat && s.lng)
        ? parseFloat(milesAway(userPos.lat, userPos.lng, s.lat, s.lng))
        : null,
    }));
    const sorted = userPos
      ? [...withDist].sort((a, b) => (a.distMi ?? 9999) - (b.distMi ?? 9999))
      : withDist;
    const nearIds = userPos
      ? sorted.filter(s => s.distMi !== null && s.distMi < 80).map(s => s.id)
      : [];
    return { sorted, nearIds };
  // Re-run whenever screenings update (geocoding fills in lat/lng) or userPos changes
  }, [screenings, userPos, filterStart, filterEnd]);

  const handleGeo = ()=>{
    if(!navigator.geolocation){ toast("Geolocation not supported.",true); return; }
    setGeoL(true);
    navigator.geolocation.getCurrentPosition(
      pos=>{
        const pos2 = {lat:pos.coords.latitude, lng:pos.coords.longitude};
        setUserPos(pos2);
        setGeoL(false);
        // Count how many theaters still need geocoding
        const pending = screenings.filter(s=>!s.lat||!s.lng).length;
        if(pending > 0){
          toast(`Found you! Geocoding ${pending} theater${pending!==1?"s":""} — distances will update shortly.`);
        } else {
          toast("Showing theaters nearest you.");
        }
      },
      ()=>{ setGeoL(false); toast("Location access denied.",true); }
    );
  };

  const MapComp = demoMode() ? StaticMap : GoogleMap;

  return (
    <div>
      {!isEmbedded && (
        <div className="ph">
          <h1>Public <em>Widget</em> Preview</h1>
          <div className="ph-sub">As it will appear on the Squarespace site</div>
        </div>
      )}
      {!isEmbedded && (
        <div className="film-row">
          <span className="flbl">Preview film</span>
          <select className="fsel" value={fi} onChange={e=>setFi(+e.target.value)}>
            {films.map((f,i)=><option key={f.id} value={i}>{f.title}</option>)}
          </select>
        </div>
      )}

      <div className="wwrap">
        {sheetError && (
          <div style={{
            background:"#fef2f2",border:"1px solid #fca5a5",padding:"12px 16px",
            marginBottom:16,fontFamily:"var(--mono)",fontSize:10,color:"#991b1b",
            letterSpacing:".1em",lineHeight:1.7,
          }}>
            <strong>⚠ Sheet Error:</strong> {sheetError}
          </div>
        )}
        <div className="wt">Find a Theater</div>
        <div className="wtag">{film.title} · Now Playing</div>
        {/* Debug panel — visible only when ?debug=1 is in the URL */}
        {typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1" && (
          <div style={{
            background:"#0d0d0d",border:"1px solid #333",padding:"12px 16px",
            marginBottom:16,fontFamily:"var(--mono)",fontSize:10,color:"#4caf76",
            letterSpacing:".08em",lineHeight:2,
          }}>
            <div style={{color:"#b8942a",marginBottom:6,letterSpacing:".15em"}}>⚙ DEBUG INFO</div>
            <div>Film: <span style={{color:"white"}}>{film.title}</span></div>
            <div>Sheet ID: <span style={{color:"white"}}>{film.sheetId}</span></div>
            <div>Token: <span style={{color:"white"}}>{token ? "✓ OAuth signed in" : "None (using API key)"}</span></div>
            <div>Screenings loaded: <span style={{color:"white"}}>{screenings.length}</span></div>
            <div>Demo mode: <span style={{color:"white"}}>{demoMode() ? "YES — replace placeholder keys" : "No"}</span></div>
            <div>Sheet URL: <a href={`https://docs.google.com/spreadsheets/d/${film.sheetId}`} target="_blank" rel="noreferrer" style={{color:"#b8942a"}}>Open Sheet ↗</a></div>
            <div>API test: <a href={`https://sheets.googleapis.com/v4/spreadsheets/${film.sheetId}/values/Screenings!A2:E?key=${GOOGLE_MAPS_KEY}`} target="_blank" rel="noreferrer" style={{color:"#b8942a"}}>Test API call ↗</a></div>
          </div>
        )}

        <div className="wf">
          <label>From</label>
          <input type="date" value={filterStart} onChange={e=>setFS(e.target.value)}/>
          <label>To</label>
          <input type="date" value={filterEnd} onChange={e=>setFE(e.target.value)}/>
          <button className="geo-btn" onClick={handleGeo} disabled={geoLoading}>
            {geoLoading?"Locating…":"📍 Near Me"}
          </button>
        </div>

        <MapComp
          screenings={filtered}
          userPos={userPos}
          activeId={activeId}
          onMarkerClick={setActiveId}
        />
        {demoMode() && (
          <div className="map-key-note">
            Demo map — add a real <code style={{fontFamily:"var(--mono)",fontSize:9,background:"#f0ece0",padding:"1px 4px"}}>GOOGLE_MAPS_KEY</code> for the full interactive map with satellite/street view.
          </div>
        )}

        {loading && (
          <div style={{textAlign:"center",padding:"28px 0",fontFamily:"var(--mono)",fontSize:11,letterSpacing:".15em",textTransform:"uppercase",color:"var(--muted)"}}>
            <span className="spin">⟳</span> Loading screenings…
          </div>
        )}

        {!loading && sorted.length===0 ? (
          <div style={{textAlign:"center",padding:"36px 0",fontFamily:"var(--mono)",fontSize:11,letterSpacing:".15em",textTransform:"uppercase",color:"var(--muted)"}}>
            No screenings match this date range.
          </div>
        ) : (
          <div className="wcards">
            {sorted.map(s=>(
              <div className="wcard" key={s.id||s._rowIndex}
                style={{outline:activeId===s.id?"2px solid var(--gold)":"none",outlineOffset:-2}}
                onClick={()=>setActiveId(activeId===s.id?null:s.id)}>
                {nearIds.includes(s.id) && <div className="nbadge">Near You</div>}
                <div className="wcn">{s.theater}</div>
                <div className="wca">{s.city && s.state ? `${s.city}, ${s.state} ${s.zip}` : s.address}</div>
                <div className="wcd">{fmtDate(s.startDate)} – {fmtDate(s.endDate)}</div>
                {s.distMi!==null && <div className="wcdist">📍 {s.distMi} mi away</div>}
                <a className="wctkt" href={s.ticketUrl} target="_blank" rel="noreferrer">Get Tickets →</a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EMBED VIEW
// ─────────────────────────────────────────────────────────────────────────────
function EmbedView({ films=FALLBACK_FILMS }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-app.vercel.app";
  const [copied, setCopied] = useState(null);

  const copy = (id, text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const iframeCode = (filmId, filmTitle) =>
`<!-- ${filmTitle} — Abramorama Screening Widget -->
<iframe
  src="${origin}?film=${filmId}&mode=widget"
  width="100%"
  height="680"
  frameborder="0"
  allow="geolocation"
  style="border:none;display:block;width:100%"
  title="${filmTitle} Screening Locations">
</iframe>
<script>
  window.addEventListener("message", function(e) {
    if (e.data && e.data.type === "abramorama-height") {
      var iframes = document.querySelectorAll('iframe[title="${filmTitle} Screening Locations"]');
      iframes.forEach(function(f){ f.style.height = e.data.height + "px"; });
    }
  });
<\/script>`;

  return (
    <div>
      <div className="ph">
        <h1>Squarespace <em>Embed Code</em></h1>
        <div className="ph-sub">Copy the snippet for each film page · paste into a Squarespace Code Block</div>
      </div>

      <div style={{marginBottom:12,fontFamily:"var(--mono)",fontSize:10,letterSpacing:".15em",color:"var(--muted)",textTransform:"uppercase"}}>
        Detected app URL: <span style={{color:"var(--gold)"}}>{origin}</span>
      </div>

      {films.map(film => (
        <div key={film.id} style={{marginBottom:32}}>
          <div className="slbl">{film.title}</div>
          <div style={{position:"relative"}}>
            <pre style={{
              background:"rgba(255,255,255,.03)",
              border:"1px solid rgba(200,192,176,.18)",
              padding:"20px 22px",
              fontFamily:"var(--mono)",
              fontSize:11,
              lineHeight:1.75,
              color:"rgba(245,240,232,.75)",
              overflowX:"auto",
              whiteSpace:"pre-wrap",
              wordBreak:"break-all",
            }}>
              {iframeCode(film.id, film.title)}
            </pre>
            <button
              className="btn btn-g"
              onClick={() => copy(film.id, iframeCode(film.id, film.title))}
              style={{position:"absolute",top:14,right:14,padding:"6px 14px",fontSize:9}}
            >
              {copied === film.id ? "✓ Copied!" : "Copy"}
            </button>
          </div>
          <div style={{marginTop:8,fontFamily:"var(--mono)",fontSize:9,color:"var(--muted)",letterSpacing:".12em"}}>
            Paste this into a <strong style={{color:"var(--paper)"}}>Code Block</strong> on the <strong style={{color:"var(--paper)"}}>{film.title}</strong> page in Squarespace.
          </div>
        </div>
      ))}

      <div style={{border:"1px solid rgba(184,148,42,.3)",background:"rgba(184,148,42,.05)",padding:"18px 22px",marginTop:8}}>
        <div style={{fontFamily:"var(--mono)",fontSize:10,letterSpacing:".18em",textTransform:"uppercase",color:"var(--gold)",marginBottom:10}}>
          How to add a Code Block in Squarespace
        </div>
        <ol style={{paddingLeft:18,fontFamily:"var(--mono)",fontSize:10,color:"rgba(245,240,232,.65)",lineHeight:2.2,letterSpacing:".05em"}}>
          <li>Open the film's page in the Squarespace editor</li>
          <li>Click <strong style={{color:"var(--paper)"}}>+</strong> to add a block → choose <strong style={{color:"var(--paper)"}}>Code</strong></li>
          <li>Paste the snippet above → click <strong style={{color:"var(--paper)"}}>Apply</strong></li>
          <li>Save and preview — the map and theater list will appear</li>
        </ol>
      </div>

      <div style={{marginTop:24,border:"1px solid rgba(200,192,176,.15)",padding:"16px 22px"}}>
        <div style={{fontFamily:"var(--mono)",fontSize:10,letterSpacing:".18em",textTransform:"uppercase",color:"var(--muted)",marginBottom:10}}>
          Admin URL — share with Sterling
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <code style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--gold)",background:"rgba(255,255,255,.04)",padding:"8px 14px",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {origin}?mode=admin
          </code>
          <button className="btn btn-o" style={{fontSize:9,padding:"8px 14px"}}
            onClick={() => copy("admin", `${origin}?mode=admin`)}>
            {copied === "admin" ? "✓ Copied!" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FILM MANAGER VIEW
// ─────────────────────────────────────────────────────────────────────────────
function FilmManagerView({ token, films, setFilms, toast }) {
  const [adding, setAdding]   = useState(false);
  const [saving, setSaving]   = useState(false);
  const [removing, setRemoving] = useState(null);
  const [form, setForm]       = useState({ title:"", sheetId:"" });
  const masterReady = !MASTER_SHEET_ID.startsWith("YOUR_");

  const handleAdd = async () => {
    if(!form.title || !form.sheetId) return;
    setSaving(true);
    const slug = form.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const newFilm = {
      id: `film_${slug}`,
      title: form.title.trim(),
      sheetId: form.sheetId.trim(),
    };
    try {
      if(masterReady && token) await addFilmToMaster(token, newFilm);
      FILM_SHEETS = [...films, newFilm];
      setFilms([...films, newFilm]);
      setForm({ title:"", sheetId:"" });
      setAdding(false);
      toast(`"${newFilm.title}" added successfully.`);
    } catch(e) {
      toast("Failed to save film.", true);
    } finally { setSaving(false); }
  };

  const handleRemove = async (film, idx) => {
    setRemoving(film.id);
    try {
      if(masterReady && token) await removeFilmFromMaster(token, idx + 1);
      const updated = films.filter(f => f.id !== film.id);
      FILM_SHEETS = updated;
      setFilms(updated);
      toast(`"${film.title}" removed.`);
    } catch(e) {
      toast("Failed to remove film.", true);
    } finally { setRemoving(null); }
  };

  return (
    <div>
      <div className="ph">
        <h1>Film <em>Manager</em></h1>
        <div className="ph-sub">Add or remove films — each film links to its own Google Sheet</div>
      </div>

      {!masterReady && (
        <div className="sbanner" style={{marginBottom:24}}>
          <h4>⚙ Set up a master Sheet to persist film changes</h4>
          <ol>
            <li>Create a new Google Sheet → rename the default tab to <code>Films</code></li>
            <li>Copy the Sheet ID from its URL</li>
            <li>Replace <code>YOUR_MASTER_SHEET_ID</code> in the app file with that ID</li>
            <li>Until then, films added here persist only for this session</li>
          </ol>
          <button className="dismiss" onClick={()=>{}}>Got it</button>
        </div>
      )}

      <div className="slbl">Active Films ({films.length})</div>

      <div className="tbl" style={{marginBottom:28}}>
        <div className="tr hdr">
          <span>Title</span><span>Sheet ID</span><span>Sheet Link</span><span>Screenings</span><span></span>
        </div>
        {films.map((film, idx) => (
          <div className="tr" key={film.id}>
            <div className="tn">{film.title}</div>
            <div className="ta" style={{fontFamily:"var(--mono)",fontSize:10}}>{film.sheetId.slice(0,24)}…</div>
            <a
              href={`https://docs.google.com/spreadsheets/d/${film.sheetId}`}
              target="_blank" rel="noreferrer"
              className="tl"
            >Open Sheet ↗</a>
            <a
              href={`?film=${film.id}&mode=widget`}
              target="_blank" rel="noreferrer"
              className="tl"
            >Preview widget ↗</a>
            <button
              className="btn btn-d"
              disabled={removing === film.id}
              onClick={() => handleRemove(film, idx)}
            >{removing===film.id ? "…" : "Remove"}</button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="fc">
          <h3>Add New Film</h3>
          <div className="fg">
            <div className="field">
              <label>Film Title</label>
              <input
                placeholder="e.g. Ghost Elephants"
                value={form.title}
                onChange={e=>setForm(p=>({...p,title:e.target.value}))}
              />
            </div>
            <div className="field">
              <label>Google Sheet ID</label>
              <input
                placeholder="Paste Sheet ID from URL"
                value={form.sheetId}
                onChange={e=>setForm(p=>({...p,sheetId:e.target.value}))}
              />
            </div>
          </div>
          <div style={{marginTop:8,fontFamily:"var(--mono)",fontSize:9,color:"var(--muted)",letterSpacing:".1em"}}>
            Sheet ID is the string between /d/ and /edit in the Sheet URL. The Sheet must have a tab named <strong style={{color:"var(--paper)"}}>Screenings</strong>.
          </div>
          <div className="fa">
            <button className="btn btn-o" onClick={()=>setAdding(false)}>Cancel</button>
            <button
              className="btn btn-g"
              disabled={!form.title||!form.sheetId||saving}
              onClick={handleAdd}
            >{saving?"Saving…":"Add Film"}</button>
          </div>
        </div>
      ) : (
        <button className="btn btn-g" onClick={()=>setAdding(true)}>+ Add New Film</button>
      )}

      <div style={{marginTop:36,border:"1px solid rgba(200,192,176,.15)",padding:"18px 22px"}}>
        <div style={{fontFamily:"var(--mono)",fontSize:10,letterSpacing:".18em",textTransform:"uppercase",color:"var(--muted)",marginBottom:12}}>
          Squarespace embed codes for active films
        </div>
        {films.map(film => {
          const origin = typeof window!=="undefined" ? window.location.origin : "https://abramorama-widget.vercel.app";
          const snippet = `<iframe src="${origin}?film=${film.id}&mode=widget" width="100%" height="900" frameborder="0" scrolling="yes" allow="geolocation" style="width:100%;min-height:900px;border:none;display:block;"></iframe>`;
          return (
            <div key={film.id} style={{marginBottom:14}}>
              <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--gold)",letterSpacing:".12em",marginBottom:4}}>{film.title}</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <code style={{fontFamily:"var(--mono)",fontSize:9,color:"rgba(245,240,232,.5)",background:"rgba(255,255,255,.03)",padding:"6px 10px",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {snippet}
                </code>
                <button className="btn btn-o" style={{fontSize:9,padding:"6px 12px",flexShrink:0}}
                  onClick={()=>{navigator.clipboard.writeText(snippet);toast(`Copied embed for ${film.title}`);}}>
                  Copy
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [mode, setMode] = useState(URL_MODE === "widget" ? "widget" : "admin");
  const isEmbedded = URL_MODE === "widget";

  useEffect(() => { postHeight(); });

  const { token, user, loading:authLoading, signIn, signOut } = useGoogleAuth();
  const [toastMsg, setToast] = useState(null);
  const [toastErr, setTE]    = useState(false);
  const [films, setFilms]    = useState([...FALLBACK_FILMS]);

  const toast = (msg,isErr=false)=>{ setToast(null); setTimeout(()=>{ setToast(msg); setTE(isErr); },10); };

  // Load film list publicly on startup — no sign-in needed
  // This lets the widget show any film including ones added via Film Manager
  useEffect(() => {
    readFilmListPublic().then(list => {
      if(list.length > 0) { FILM_SHEETS = list; setFilms(list); }
    }).catch(()=>{});
  }, []);

  // Reload film list from master sheet when signed in (gets write access too)
  useEffect(() => {
    if(!token) return;
    readFilmList(token).then(list => {
      if(list.length > 0) { FILM_SHEETS = list; setFilms(list); }
    }).catch(()=>{});
  }, [token]);

  return (
    <>
      <style>{css}</style>
      <div className="shell">
        <nav className="nav">
          <div className="brand">Abramorama · Screenings</div>
          {!isEmbedded && (
            <div className="nav-r">
              <div className="tabs">
                <button className={`tab ${mode==="admin"?"on":""}`}  onClick={()=>setMode("admin")}>Admin</button>
                <button className={`tab ${mode==="widget"?"on":""}`} onClick={()=>setMode("widget")}>Widget Preview</button>
                <button className={`tab ${mode==="films"?"on":""}`}  onClick={()=>setMode("films")}>Films</button>
                <button className={`tab ${mode==="embed"?"on":""}`}  onClick={()=>setMode("embed")}>Embed Code</button>
              </div>
              {token ? (
                <>
                  <button className="auth-btn on">
                    <span className="adot"/>{user?.name?.split(" ")[0]||"Connected"}
                  </button>
                  <button className="auth-btn sm" onClick={signOut}>Sign out</button>
                </>
              ) : (
                <button className="auth-btn" onClick={signIn} disabled={authLoading||demoMode()}>
                  <span className="adot" style={{background:"var(--muted)"}}/>
                  {authLoading?"Loading…":demoMode()?"Demo mode":"Connect Google"}
                </button>
              )}
            </div>
          )}
        </nav>
        <div className="main">
          {mode==="admin"  && <AdminView token={token} toast={toast} films={films}/>}
          {mode==="widget" && <WidgetView token={token} toast={toast} defaultFilmIdx={URL_FILM_IDX} films={films}/>}
          {mode==="films"  && <FilmManagerView token={token} films={films} setFilms={setFilms} toast={toast}/>}
          {mode==="embed"  && <EmbedView films={films}/>}
        </div>
        {toastMsg && <Toast msg={toastMsg} isErr={toastErr} onDone={()=>setToast(null)}/>}
      </div>
    </>
  );
}
