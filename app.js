"use strict";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const wide = matchMedia("(min-width: 700px)");

const link = {
  google: p => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`,
  waze: p => `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`,
  apple: (p, words) => `https://maps.apple.com/?ll=${p.lat},${p.lng}&q=${encodeURIComponent("///" + words)}`,
  w3w: words => `https://w3w.co/${words}`,
};

const PIN_SVG = `<svg viewBox="0 0 30 38" aria-hidden="true"><line class="stem" x1="15" y1="29" x2="15" y2="37"/><path class="body" d="M15 2c5 0 8 6 8 14s-3 13-8 13-8-5-8-13 3-14 8-14z"/><path class="tip" d="M15 2c5 0 8 6 8 11H7c0-5 3-11 8-11z"/></svg>`;
// Closed now: a closure notice in the venue news, or today falls in its stated close season.
function inCloseSeason(v, today = new Date()) {
  const m = /(\d+) Mar – (\d+) Jun/.exec(v.closeSeason || "");
  if (!m) return false;
  const y = today.getFullYear();
  return today >= new Date(y, 2, +m[1]) && today < new Date(y, 5, +m[2] + 1);
}
const closedNow = v => v.closedNotice || inCloseSeason(v);

const pinIcon = (v, selected) => L.divIcon({
  className: `pin t-${v.type}` + (selected ? " sel" : "") + (v.venue.at.approx ? " approx" : "") + (closedNow(v) ? " closed" : ""),
  html: PIN_SVG, iconSize: [30, 38], iconAnchor: [15, 38],
});

const TYPES = { river: ["Rivers", "River"], lake: ["Lakes", "Lake"], canal: ["Canals", "Canal"] };
let venues = [], sel = null, query = "";
const shown = new Set(Object.keys(TYPES));
const markers = new Map();

const map = L.map("map", { zoomControl: false, minZoom: 8, maxZoom: 19, zoomSnap: 0.5 }).setView([51.5, -1.08], 10);
L.control.zoom({ position: "topright" }).addTo(map);
map.attributionControl.addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');

// Zoomed out: a simple sketch of the rivers and towns. Zoomed in: the street map.
const DETAIL_ZOOM = 12;
const LABELS_ZOOM = 10;   // below this, only the main towns are labelled
const MAIN_TOWNS = new Set(["Oxford", "Reading", "Wallingford", "Henley", "Newbury"]);
const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 });
const overview = L.layerGroup();
let hasOverview = false;
map.createPane("overview").style.zIndex = 250;
map.createPane("overviewLabels").style.zIndex = 450;
map.getPane("overviewLabels").style.pointerEvents = "none";

function drawOverview(o) {
  const renderer = L.svg({ pane: "overview" });
  for (const ring of o.lakes || []) {
    L.polygon(ring, { pane: "overview", renderer, interactive: false, className: "ov-lake", weight: 1 }).addTo(overview);
  }
  for (const r of o.rivers) {
    for (const line of r.lines) {
      L.polyline(line, {
        pane: "overview", renderer, interactive: false,
        className: r.canal ? "ov-canal" : "ov-river", weight: r.weight * 1.3,
      }).addTo(overview);
    }
  }
  const label = cls => t => L.marker([t.lat, t.lng], {
    pane: "overviewLabels", interactive: false, keyboard: false,
    icon: L.divIcon({ className: cls(t), html: `<span>${esc(t.name)}</span>`, iconSize: [0, 0] }),
  }).addTo(overview);
  o.towns.forEach(label(t => "ov-town" + (MAIN_TOWNS.has(t.name) ? "" : " minor")));
  o.riverLabels.forEach(label(() => "ov-riv minor"));
  hasOverview = true;
  applyMode();
}

function applyMode() {
  const detail = !hasOverview || map.getZoom() >= DETAIL_ZOOM;
  map.getContainer().classList.toggle("overview", !detail);
  map.getContainer().classList.toggle("far", map.getZoom() < LABELS_ZOOM);
  if (detail) {
    if (!map.hasLayer(tiles)) tiles.addTo(map);
    map.removeLayer(overview);
  } else {
    map.removeLayer(tiles);
    if (!map.hasLayer(overview)) overview.addTo(map);
  }
  $("hint").hidden = detail;
}
map.on("zoomend", applyMode);
const cluster = L.markerClusterGroup({
  // Group less as you zoom in, so the lakes and individual pins show through.
  maxClusterRadius: z => (z >= 11 ? 22 : 40), showCoverageOnHover: false, spiderfyOnMaxZoom: true,
  iconCreateFunction: c => L.divIcon({
    html: `<div class="cl" style="width:34px;height:34px">${c.getChildCount()}</div>`,
    className: "", iconSize: [34, 34],
  }),
}).addTo(map);
map.on("click", closeSheet);

// Keep the selected pin clear of the card: below it on phones, beside it on wider screens.
function sheetPadding() {
  const s = $("sheet");
  if (s.hidden) return { paddingTopLeft: [40, 40], paddingBottomRight: [40, 40] };
  return wide.matches
    ? { paddingTopLeft: [s.offsetWidth + 40, 40], paddingBottomRight: [40, 40] }
    : { paddingTopLeft: [30, 50], paddingBottomRight: [30, s.offsetHeight + 30] };
}

// Pan so the pin sits in the part of the map the card doesn't cover.
// center=true always centres it there; otherwise only pan if it's hidden.
function reveal(m, center) {
  const { paddingTopLeft: tl, paddingBottomRight: br } = sheetPadding();
  const size = map.getSize();
  const box = { x0: tl[0], y0: tl[1], x1: size.x - br[0], y1: size.y - br[1] };
  const p = map.latLngToContainerPoint(m.getLatLng()).subtract([0, 19]);
  const hidden = p.x < box.x0 || p.x > box.x1 || p.y < box.y0 || p.y > box.y1;
  if (center || hidden) map.panBy([p.x - (box.x0 + box.x1) / 2, p.y - (box.y0 + box.y1) / 2]);
}

const matches = v => shown.has(v.type) && (!query ||
  [v.name, TYPES[v.type][1], v.postcodes.join(" "), v.info, v.ticket, v.news].join(" ").toLowerCase().includes(query));

function renderTypeChips() {
  $("types").innerHTML = Object.entries(TYPES).map(([t, [label]]) =>
    `<button class="chip t-${t}" type="button" data-type="${t}" aria-pressed="${shown.has(t)}"><i></i>${label} · ${venues.filter(v => v.type === t).length}</button>`).join("");
  $("types").querySelectorAll("[data-type]").forEach(b => b.onclick = () => {
    const t = b.dataset.type;
    shown.has(t) ? shown.delete(t) : shown.add(t);
    b.setAttribute("aria-pressed", shown.has(t));
    if (sel && !matches(sel)) closeSheet();
    drawMarkers();
    if (!$("list").hidden) renderList();
  });
}

function drawMarkers() {
  cluster.clearLayers();
  markers.clear();
  for (const v of venues) {
    if (!v.venue.at || !matches(v)) continue;
    const m = L.marker([v.venue.at.lat, v.venue.at.lng], {
      icon: pinIcon(v, v === sel), title: v.name, alt: v.name, keyboard: true,
    }).on("click", e => { L.DomEvent.stopPropagation(e); select(v); });
    markers.set(v, m);
    cluster.addLayer(m);
  }
}

function fitAll() {
  const pts = venues.filter(v => v.venue.at && matches(v)).map(v => [v.venue.at.lat, v.venue.at.lng]);
  if (pts.length) map.fitBounds(pts, { ...sheetPadding(), maxZoom: 15 });
}

function ticketText(t) {
  return t.toLowerCase().replace(/^\w/, c => c.toUpperCase()).replace(/\bbronze\b/g, "Bronze");
}

function w3wRow(label, words, at, withDrive, clubSays) {
  const pos = at && !at.approx;
  const acts = pos
    ? `<a class="apple" href="${link.apple(at, words)}" target="_blank" rel="noopener">Apple Maps</a>` +
      (withDrive ? `<a href="${link.google(at)}" target="_blank" rel="noopener">Google</a><a href="${link.waze(at)}" target="_blank" rel="noopener">Waze</a>` : "")
    : `<a href="${link.w3w(words)}" target="_blank" rel="noopener">what3words</a>`;
  const fix = clubSays ? `<span class="fix">Club page says ///${esc(clubSays)}, which looks mistyped</span>` : "";
  return `<li><span class="lab">${esc(label)}</span><a class="words" href="${pos ? link.apple(at, words) : link.w3w(words)}" target="_blank" rel="noopener"><i>///</i>${esc(words)}</a><span class="acts">${acts}</span>${fix}</li>`;
}

function newsBanner(v) {
  if (v.closedNotice) return `<div class="news bad"><b>Closed</b>${esc(v.news)}</div>`;
  if (inCloseSeason(v)) {
    return `<div class="news bad"><b>Closed</b>Close season, ${esc(v.closeSeason.replace(" – ", " to "))}.${v.news ? " " + esc(v.news) : ""}</div>`;
  }
  return v.news ? `<div class="news"><b>Venue news</b>${esc(v.news)}</div>` : "";
}

function select(v, { zoomTo = false } = {}) {
  const prev = sel;
  sel = v;
  showMap();
  if (prev && markers.has(prev)) markers.get(prev).setIcon(pinIcon(prev, false));

  const drive = v.parking.find(p => p.at) || (v.venue.at ? { label: "Venue", at: v.venue.at } : null);
  const anyApprox = [v.venue.at, ...v.parking.map(p => p.at)].some(p => p && p.approx);
  const meta = [
    `<span class="m type t-${v.type}"><i></i>${TYPES[v.type][1]}</span>`,
    v.ticket && `<span class="m">${esc(ticketText(v.ticket))}</span>`,
    v.closeSeason && `<span class="m warn">Close season ${esc(v.closeSeason)}</span>`,
    ...v.postcodes.map(pc => `<span class="m">${esc(pc)}</span>`),
  ].filter(Boolean).join("");

  const sheet = $("sheet");
  sheet.innerHTML = `
    <div class="grab"></div>
    <div class="sh-head"><h2>${esc(v.name)}</h2><button class="x" type="button" aria-label="Close" id="close">✕</button></div>
    <div class="meta">${meta}</div>
    ${newsBanner(v)}
    ${drive
      ? `<p class="navlbl">Drive to: ${esc(drive.label)}</p>
         <div class="nav"><a class="go" href="${link.google(drive.at)}" target="_blank" rel="noopener">Google Maps</a><a class="go alt" href="${link.waze(drive.at)}" target="_blank" rel="noopener">Waze</a></div>`
      : `<div class="nav"><span class="go off">No position yet. Use the what3words links below.</span></div>`}
    ${anyApprox ? `<p class="approx-note">Positions are from the postcode until the what3words addresses are converted.</p>` : ""}
    <div class="sec"><b>what3words</b><span>Apple Maps opens at the 3 m square</span></div>
    <ul class="w3">
      ${w3wRow("Venue", v.venue.w3w, v.venue.at, false, v.venue.clubSays)}
      ${v.parking.map(p => w3wRow(p.label, p.w3w, p.at, true, p.clubSays)).join("")}
    </ul>
    ${v.directions ? `<div class="sec"><b>Directions</b></div><p class="txt muted">${esc(v.directions)}</p>` : ""}
    ${v.info ? `<div class="sec"><b>About</b></div><p class="txt">${esc(v.info)}</p>` : ""}
    <a class="src" href="${esc(v.url)}" target="_blank" rel="noopener">Venue page on rdaa.co.uk ↗</a>`;
  sheet.hidden = false;
  sheet.scrollTop = 0;
  $("close").onclick = closeSheet;
  history.replaceState(null, "", "#" + v.slug);

  const m = markers.get(v);
  if (!m) return;
  m.setIcon(pinIcon(v, true));
  // From the list or a link, zoom in on the venue; from a pin tap, keep the view unless the card hides it.
  if (zoomTo) map.setView(m.getLatLng(), Math.max(map.getZoom(), 14), { animate: false });
  cluster.zoomToShowLayer(m, () => reveal(m, zoomTo));
}

function closeSheet() {
  if (sel && markers.has(sel)) markers.get(sel).setIcon(pinIcon(sel, false));
  sel = null;
  $("sheet").hidden = true;
  history.replaceState(null, "", location.pathname + location.search);
}

function renderList() {
  const rows = venues.filter(matches);
  $("list").innerHTML = (rows.length
    ? rows.map(v => `<button class="row" type="button" data-slug="${esc(v.slug)}"><b>${esc(v.name)}</b><small><i class="dot t-${v.type}"></i>${esc([TYPES[v.type][1], v.postcodes[0] || "No postcode", v.ticket && ticketText(v.ticket)].filter(Boolean).join(" · "))}</small><span class="r${!v.venue.at ? " miss" : closedNow(v) ? " shut" : ""}">${!v.venue.at ? "Not on map" : closedNow(v) ? "Closed" : "Map ›"}</span></button>`).join("")
    : `<p class="empty">${query ? `No venue matches “${esc(query)}”.` : "No venue types selected. Turn on Rivers, Lakes or Canals above."}</p>`)
    + `<p class="foot">${venues.length} venues from rdaa.co.uk, last checked ${esc(window.scraped || "")}.</p>`;
  $("list").querySelectorAll("[data-slug]").forEach(b =>
    b.onclick = () => select(venues.find(v => v.slug === b.dataset.slug), { zoomTo: true }));
}

function showMap() {
  $("list").hidden = true;
  $("vMap").setAttribute("aria-pressed", "true");
  $("vList").setAttribute("aria-pressed", "false");
  map.invalidateSize();
}
function showList() {
  renderList();
  $("list").hidden = false;
  $("sheet").hidden = true;
  $("vMap").setAttribute("aria-pressed", "false");
  $("vList").setAttribute("aria-pressed", "true");
}

$("vMap").onclick = showMap;
$("vList").onclick = showList;
$("fitAll").onclick = fitAll;
$("q").addEventListener("input", e => {
  query = e.target.value.trim().toLowerCase();
  drawMarkers();
  if (!$("list").hidden) renderList();
});

// My location: the phone asks permission on the first tap. The dot follows you while
// the app is open and stops while it's in the background, to save battery.
const LOCATE = { watch: true, setView: false, enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 };
let locating = false, centreOnFix = false, meDot = null, meAcc = null, toastTimer = null;

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 12000);
}
$("toast").onclick = () => { $("toast").hidden = true; };

function locate() {
  if (!navigator.geolocation) return toast("This browser can't share your location.");
  centreOnFix = true;
  if (meDot) map.setView(meDot.getLatLng(), Math.max(map.getZoom(), 14));
  if (!locating) {
    locating = true;
    $("locate").classList.add("busy");
    map.locate(LOCATE);
  }
}

map.on("locationfound", e => {
  $("locate").classList.remove("busy");
  $("locate").classList.add("on");
  if (!meDot) {
    meAcc = L.circle(e.latlng, { radius: e.accuracy, className: "me-acc", interactive: false }).addTo(map);
    meDot = L.circleMarker(e.latlng, { radius: 8, className: "me-dot", interactive: false }).addTo(map);
  } else {
    meDot.setLatLng(e.latlng);
    meAcc.setLatLng(e.latlng).setRadius(e.accuracy);
  }
  if (centreOnFix) {
    centreOnFix = false;
    map.setView(e.latlng, Math.max(map.getZoom(), 14));
  }
});

// What to do when location fails, worded for the device and browser in use.
// code 1 = permission refused; anything else = no fix (location off, no signal, timed out).
function locationHelp(code, ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints || 0) {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  const android = /Android/.test(ua);
  const mac = /Macintosh/.test(ua) && !ios;
  const browser = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome"
    : /FxiOS|Firefox\//.test(ua) ? "Firefox" : "Safari";
  const macSettings = `${browser} is turned on in System Settings › Privacy & Security › Location Services`;

  if (code !== 1) {
    if (ios || android) return "Couldn't find your location. Check Location Services is on, or try again with a better signal.";
    return "Couldn't find your location. " + (mac ? `Check ${macSettings}.` : "Check location is turned on for your browser.");
  }
  if (ios) {
    const app = browser === "Safari" ? "Safari Websites" : browser;
    return `Location is turned off for ${browser === "Safari" ? "this site" : browser}. Open Settings › Privacy & Security › Location Services › ${app}, then try again.`;
  }
  if (android) return "Location is blocked for this site. Tap the icon to the left of the address bar, allow Location, then try again.";
  const onMac = mac ? ` On a Mac, also check ${macSettings}.` : "";
  if (browser === "Safari") return "Location is blocked for this site. In Safari › Settings › Websites › Location, allow this site, then try again." + onMac;
  return "Location is blocked for this site. Click the icon to the left of the address bar, allow Location, then try again." + onMac;
}

map.on("locationerror", e => {
  map.stopLocate();
  locating = false;
  $("locate").classList.remove("busy", "on");
  toast(locationHelp(e.code));
});

document.addEventListener("visibilitychange", () => {
  if (!locating) return;
  if (document.hidden) map.stopLocate();
  else map.locate(LOCATE);
});
$("locate").onclick = locate;

// Without the overview file the app still works, just with the street map at every zoom.
fetch("overview.json")
  .then(r => r.json())
  .then(drawOverview)
  .catch(applyMode);

fetch("venues.json", { cache: "no-cache" })
  .then(r => r.json())
  .then(data => {
    venues = data.venues;
    window.scraped = data.scraped;
    renderTypeChips();
    drawMarkers();
    const start = venues.find(v => "#" + v.slug === decodeURIComponent(location.hash));
    if (start) select(start, { zoomTo: true });
    else fitAll();
  })
  .catch(() => {
    $("sheet").innerHTML = `<p class="txt">Couldn't load the venue list. Check your connection and reload.</p>`;
    $("sheet").hidden = false;
  });
