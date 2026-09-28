(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const APP = {
  map:null, points:{start:null,end:null,vias:[]}, markers:{start:null,end:null,vias:[]}, route:null,
  poiMarkers:[], routeLayerReady:false, pickMode:null, weather:'good', categories:new Set(['nature','sights','family','museum','water','view']),
  nav:{watchId:null,voice:true,lastHint:-1,lastPos:null,follow:true},
  endpoints:{brouter:'https://brouter.de/brouter',overpass:['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'],nominatim:'https://nominatim.openstreetmap.org/search'}
};

function toast(msg, ms=2800){ const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(t._tm);t._tm=setTimeout(()=>t.classList.add('hidden'),ms); }
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function fmtKm(m){return m<1000?`${Math.round(m)} m`:`${(m/1000).toFixed(m<10000?1:0)} km`;}
function fmtTime(sec){ if(!sec||!isFinite(sec)) return '–'; const h=Math.floor(sec/3600),m=Math.round((sec%3600)/60); return h?`${h} h ${m} min`:`${m} min`; }
function hav(a,b){const R=6371000,p=Math.PI/180,dLat=(b[1]-a[1])*p,dLon=(b[0]-a[0])*p,s=Math.sin(dLat/2)**2+Math.cos(a[1]*p)*Math.cos(b[1]*p)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(s));}
function nearestIndex(coords,p){let best=0,d=Infinity;for(let i=0;i<coords.length;i+=Math.max(1,Math.floor(coords.length/1500))){const x=hav(coords[i],p);if(x<d){d=x;best=i}}return {index:best,distance:d};}

function initMap(){
  APP.map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/liberty',center:[7.64,51.11],zoom:9,attributionControl:false});
  APP.map.addControl(new maplibregl.NavigationControl({showCompass:true}), 'bottom-right');
  APP.map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'© OpenStreetMap-Mitwirkende · OpenFreeMap'}),'bottom-right');
  APP.map.on('load',()=>{ensureRouteLayers();loadUtilityPois(false);});
  APP.map.on('click', e=>{ if(APP.pickMode){setPickedPoint(APP.pickMode,[e.lngLat.lng,e.lngLat.lat]);APP.pickMode=null;$('#clickHint').classList.add('hidden');} });
}

function ensureRouteLayers(){
  if(APP.map.getSource('route')) return;
  APP.map.addSource('route',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:[]},properties:{}}});
  APP.map.addLayer({id:'route-shadow',type:'line',source:'route',paint:{'line-color':'#ffffff','line-width':9,'line-opacity':.88}});
  APP.map.addLayer({id:'route-line',type:'line',source:'route',paint:{'line-color':'#1f7a57','line-width':6,'line-opacity':.95}});
  APP.routeLayerReady=true;
}

function setPickedPoint(type,coord,label=''){ if(type==='start'||type==='end'){APP.points[type]=coord; setMarker(type,coord);$(`#${type}Input`).value=label||`${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`;} else if(type.startsWith('via')){const idx=+type.slice(3);APP.points.vias[idx]=coord; setViaMarker(idx,coord);const inp=document.querySelector(`[data-via-index="${idx}"]`);if(inp)inp.value=label||`${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`;} }
function makePointEl(cls){const d=document.createElement('div');d.className=`point-marker ${cls}`;return d;}
function setMarker(type,coord){ if(APP.markers[type])APP.markers[type].remove();APP.markers[type]=new maplibregl.Marker({element:makePointEl(type),anchor:'center'}).setLngLat(coord).addTo(APP.map); }
function setViaMarker(idx,coord){if(APP.markers.vias[idx])APP.markers.vias[idx].remove();APP.markers.vias[idx]=new maplibregl.Marker({element:makePointEl('via'),anchor:'center'}).setLngLat(coord).addTo(APP.map);}

async function geocode(text){ const url=`${APP.endpoints.nominatim}?format=jsonv2&limit=1&countrycodes=de,at,ch,nl,be,pl,cz&q=${encodeURIComponent(text)}`; const r=await fetch(url,{headers:{'Accept':'application/json'}});if(!r.ok)throw new Error('Ortssuche nicht erreichbar');const j=await r.json();if(!j.length)throw new Error('Ort nicht gefunden');return {coord:[+j[0].lon,+j[0].lat],label:j[0].display_name};}
async function resolveInputs(){
  for(const type of ['start','end']){const inp=$(`#${type}Input`);if(inp.value.trim()&&!APP.points[type]){const g=await geocode(inp.value.trim());setPickedPoint(type,g.coord,g.label);}}
  const viaInputs=$$('[data-via-index]'); for(const inp of viaInputs){const i=+inp.dataset.viaIndex;if(inp.value.trim()&&!APP.points.vias[i]){const g=await geocode(inp.value.trim());setPickedPoint(`via${i}`,g.coord,g.label);}}
}
function profileConfig(){const t=$('#bikeType').value;const base={ebike:['trekking',23],emtb:['mtb',18],trekking:['trekking',18],gravel:['gravel',21],mtb:['mtb',16],road:['fastbike-verylowtraffic',27],city:['trekking',16]}[t]||['trekking',18];return {profile:base[0],fallbackSpeed:base[1]};}

async function planRoute(){
  const btn=$('#planBtn');btn.disabled=true;btn.textContent='Berechne …';$('#routeStatus').textContent='Orte werden aufgelöst …';
  try{
    await resolveInputs(); if(!APP.points.start||!APP.points.end)throw new Error('Bitte Start und Ziel festlegen.');
    const coords=[APP.points.start,...APP.points.vias.filter(Boolean),APP.points.end];const cfg=profileConfig();
    $('#routeStatus').textContent='Fahrradroute wird berechnet …';
    let f=null,lastError=null;
    for(const profile of cfg.profiles){
      try{
        const p=new URLSearchParams({lonlats:coords.map(c=>`${c[0]},${c[1]}`).join('|'),profile,alternativeidx:'0',format:'geojson',timode:'3'});
        if($('#avoidUnsafe').checked)p.set('profile:avoid_unsafe','1');
        if($('#avoidHills').checked)p.set('profile:hills','2');
        if($('#avoidFerries').checked)p.set('profile:allow_ferries','0');
        const r=await fetch(`${APP.endpoints.brouter}?${p}`);if(!r.ok)throw new Error(`Routing-Server meldet ${r.status}`);
        const data=await r.json();f=data.features?.find(x=>x.geometry?.type==='LineString')||null;
        if(f)break;
      }catch(e){lastError=e;console.warn(`Profil ${profile} nicht verfügbar`,e);}
    }
    if(!f)throw (lastError||new Error('Keine Route gefunden.'));
    APP.route=f;ensureRouteLayers();APP.map.getSource('route').setData(f);
    const bounds=f.geometry.coordinates.reduce((b,c)=>b.extend(c),new maplibregl.LngLatBounds(f.geometry.coordinates[0],f.geometry.coordinates[0]));APP.map.fitBounds(bounds,{padding:70,duration:700});
    const pr=f.properties||{};const dist=+(pr['track-length']||0);const sec=+(pr['total-time']||0)||(dist/(cfg.fallbackSpeed*1000/3600));const asc=+(pr['filtered ascend']||0);
    $('#sumDistance').textContent=fmtKm(dist);$('#sumTime').textContent=fmtTime(sec);$('#sumAscent').textContent=`${Math.round(asc)} m`;$('#sumStops').textContent=String(Math.max(0,coords.length-2));
    $('#routeSummary').classList.remove('hidden');$('#routeActions').classList.remove('hidden');$('#routeStatus').textContent=`Route mit ${bikeLabel()} berechnet.`;
    if($('#showCamping').checked||$('#showCharging').checked)loadUtilityPois(true);
  }catch(e){console.error(e);$('#routeStatus').textContent=e.message||'Route konnte nicht berechnet werden.';toast($('#routeStatus').textContent,4200);}finally{btn.disabled=false;btn.textContent='Route berechnen';}
}
function bikeLabel(){return $('#bikeType').selectedOptions[0].textContent;}

function buildOverpassQuery(center,radius,mode='utility'){
  const [lon,lat]=center;const r=Math.min(radius,200000);let parts=[];
  if(mode==='utility'){
    if($('#showCamping').checked)parts.push(`nwr(around:${r},${lat},${lon})[tourism~"camp_site|caravan_site"]`);
    if($('#showCharging').checked){parts.push(`nwr(around:${r},${lat},${lon})[amenity="charging_station"][bicycle~"yes|designated"]`);parts.push(`nwr(around:${r},${lat},${lon})["service:bicycle:charging"~"yes|free|fee|only"]`);}
  }else{
    const cats=APP.categories; const weather=APP.weather;
    if(weather!=='bad'){
      if(cats.has('nature')){parts.push(`nwr(around:${r},${lat},${lon})[leisure~"nature_reserve|park|garden"]`);parts.push(`nwr(around:${r},${lat},${lon})[natural~"waterfall|beach|peak"]`);}
      if(cats.has('sights')){parts.push(`nwr(around:${r},${lat},${lon})[tourism="attraction"]`);parts.push(`nwr(around:${r},${lat},${lon})[historic~"castle|ruins|monument|memorial"]`);}
      if(cats.has('family')){parts.push(`nwr(around:${r},${lat},${lon})[tourism="zoo"]`);parts.push(`nwr(around:${r},${lat},${lon})[leisure~"playground|water_park"]`);parts.push(`nwr(around:${r},${lat},${lon})[tourism="theme_park"]`);}
      if(cats.has('water'))parts.push(`nwr(around:${r},${lat},${lon})[natural="water"]`);
      if(cats.has('view'))parts.push(`nwr(around:${r},${lat},${lon})[tourism="viewpoint"]`);
    }
    if(weather!=='good'){
      if(cats.has('museum')||cats.has('sights'))parts.push(`nwr(around:${r},${lat},${lon})[tourism="museum"]`);
      if(cats.has('family')){parts.push(`nwr(around:${r},${lat},${lon})[leisure="indoor_play"]`);parts.push(`nwr(around:${r},${lat},${lon})[leisure="bowling_alley"]`);}
    }
  }
  return `[out:json][timeout:30];(${parts.map(x=>x+';').join('')});out center tags 120;`;
}
function buildRouteUtilityQuery(route,corridor=4000){
  const coords=route?.geometry?.coordinates||[];if(!coords.length)return buildOverpassQuery(centerPoint(),20000,'utility');
  const sampleCount=Math.min(10,Math.max(2,Math.ceil(coords.length/250)));const samples=[];
  for(let i=0;i<sampleCount;i++){const idx=Math.min(coords.length-1,Math.round(i*(coords.length-1)/(sampleCount-1)));samples.push(coords[idx]);}
  const parts=[];
  for(const [lon,lat] of samples){
    if($('#showCamping').checked)parts.push(`nwr(around:${corridor},${lat},${lon})[tourism~"camp_site|caravan_site"]`);
    if($('#showCharging').checked){parts.push(`nwr(around:${corridor},${lat},${lon})[amenity="charging_station"][bicycle~"yes|designated"]`);parts.push(`nwr(around:${corridor},${lat},${lon})["service:bicycle:charging"~"yes|free|fee|only"]`);}
  }
  return `[out:json][timeout:30];(${parts.map(x=>x+';').join('')});out center tags 180;`;
}
async function overpass(query){let last;for(const ep of APP.endpoints.overpass){try{const r=await fetch(ep,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:`data=${encodeURIComponent(query)}`});if(!r.ok)throw new Error(`${r.status}`);return await r.json();}catch(e){last=e}}throw new Error(`OpenStreetMap-Suche derzeit nicht erreichbar${last?` (${last.message})`:''}`);}
function centerPoint(){if(APP.nav.lastPos)return APP.nav.lastPos;const c=APP.map.getCenter();return [c.lng,c.lat];}
function clearPois(kind){APP.poiMarkers=APP.poiMarkers.filter(x=>{if(!kind||x.kind===kind){x.marker.remove();return false}return true});}
function poiCoord(el){return el.type==='node'?[el.lon,el.lat]:el.center?[el.center.lon,el.center.lat]:null;}
function poiName(t,kind){return t.name||t['name:de']||(kind==='camp'?'Campingplatz':kind==='charge'?'E-Bike-Lademöglichkeit':'Ausflugsziel');}
function addPoiMarker(item){const el=document.createElement('div');el.className=`poi-marker ${item.kind}`;el.textContent=item.kind==='camp'?'🏕️':item.kind==='charge'?'🔌':'★';const m=new maplibregl.Marker({element:el}).setLngLat(item.coord).setPopup(new maplibregl.Popup({offset:18}).setHTML(`<strong>${esc(item.name)}</strong><br><small>${esc(item.desc||'')}</small>`)).addTo(APP.map);APP.poiMarkers.push({marker:m,kind:item.kind,item});}
async function loadUtilityPois(routeAware=false){
  if(!APP.map?.loaded())return;clearPois('camp');clearPois('charge');
  if(!$('#showCamping').checked&&!$('#showCharging').checked)return;
  const center=centerPoint(),radius=20000;const query=routeAware&&APP.route?buildRouteUtilityQuery(APP.route,4000):buildOverpassQuery(center,radius,'utility');
  try{const data=await overpass(query);const items=[],seen=new Set();for(const x of data.elements||[]){const key=`${x.type}-${x.id}`;if(seen.has(key))continue;seen.add(key);const c=poiCoord(x);if(!c)continue;const t=x.tags||{};let kind=t.tourism==='camp_site'||t.tourism==='caravan_site'?'camp':'charge';if(kind==='camp'&&!$('#showCamping').checked)continue;if(kind==='charge'&&!$('#showCharging').checked)continue;items.push({coord:c,kind,name:poiName(t,kind),desc:kind==='camp'?'Übernachtungsmöglichkeit entlang der Route':'E-Bike-Lademöglichkeit entlang der Route'});}items.slice(0,120).forEach(addPoiMarker);}catch(e){console.warn(e);}
}

async function discover(){
  const btn=$('#discoverBtn');btn.disabled=true;btn.textContent='Suche …';$('#discoverStatus').textContent='Ausflugsziele werden geladen …';clearPois('trip');$('#poiResults').innerHTML='';
  try{const center=centerPoint(),radius=+$('#radius').value*1000;const data=await overpass(buildOverpassQuery(center,radius,'trips'));let items=[];for(const x of data.elements||[]){const c=poiCoord(x);if(!c)continue;const t=x.tags||{};const name=t.name||t['name:de'];if(!name)continue;if($('#bikeFriendly').checked&&(t.bicycle==='no'||t.access==='private'||t.access==='no'))continue;items.push({id:`${x.type}-${x.id}`,coord:c,kind:'trip',name,dist:hav(center,c),tags:t,desc:describePoi(t)});}items.sort((a,b)=>a.dist-b.dist);const uniq=new Map();for(const i of items)if(!uniq.has(i.name))uniq.set(i.name,i);items=[...uniq.values()].slice(0,35);items.forEach(addPoiMarker);renderResults(items);$('#discoverStatus').textContent=`${items.length} passende Ziele gefunden.`;}catch(e){console.error(e);$('#discoverStatus').textContent=e.message;toast(e.message,4200);}finally{btn.disabled=false;btn.textContent='Ausflüge suchen';}
}
function describePoi(t){if(t.tourism==='museum')return '🏛️ Indoor / Museum';if(t.tourism==='viewpoint')return '📷 Aussichtspunkt';if(t.tourism==='zoo')return '🦁 Tierpark / Zoo';if(t.tourism==='camp_site')return '🏕️ Camping';if(t.leisure==='playground')return '🛝 Spielplatz';if(t.natural==='waterfall')return '💧 Wasserfall';if(t.historic)return '🏰 Historischer Ort';return APP.weather==='bad'?'🌧️ Ausflugsziel':'☀️ Ausflugsziel';}
function renderResults(items){const box=$('#poiResults');box.innerHTML=items.length?'':'<div class="infoCard">Keine passenden Ziele gefunden. Radius oder Filter ändern.</div>';for(const i of items.slice(0,18)){const card=document.createElement('div');card.className='resultCard';card.innerHTML=`<h3>${esc(i.name)}</h3><p>${esc(i.desc)} · ${fmtKm(i.dist)}</p><div class="resultActions"><button data-go="${i.id}">Auf Karte</button><button data-route="${i.id}">Route hierher</button><button data-save="${i.id}">☆ Merken</button></div>`;card._item=i;box.appendChild(card);}box.onclick=e=>{const b=e.target.closest('button');if(!b)return;const card=b.closest('.resultCard'),i=card?._item;if(!i)return;if(b.dataset.go){APP.map.flyTo({center:i.coord,zoom:14});APP.sidebarClose?.();}else if(b.dataset.route){if(APP.nav.lastPos)setPickedPoint('start',APP.nav.lastPos,'Mein Standort');setPickedPoint('end',i.coord,i.name);showPanel('routePanel');APP.map.flyTo({center:i.coord,zoom:12});toast('Ziel übernommen. Route kann berechnet werden.');}else if(b.dataset.save)saveItem(i);};}
function saveItem(item){const saved=JSON.parse(localStorage.getItem('tourscout_saved')||'[]');if(!saved.some(x=>x.id===item.id))saved.push({id:item.id,name:item.name,coord:item.coord,desc:item.desc});localStorage.setItem('tourscout_saved',JSON.stringify(saved));renderSaved();toast('Gespeichert');}
function renderSaved(){const box=$('#savedResults');const s=JSON.parse(localStorage.getItem('tourscout_saved')||'[]');box.innerHTML=s.length?'':'<div class="infoCard">Noch keine Favoriten gespeichert.</div>';for(const i of s){const d=document.createElement('div');d.className='resultCard';d.innerHTML=`<h3>${esc(i.name)}</h3><p>${esc(i.desc||'Gespeichertes Ziel')}</p><div class="resultActions"><button>Auf Karte</button></div>`;d.onclick=()=>{APP.map.flyTo({center:i.coord,zoom:14});};box.appendChild(d);}}

function commandText(cmd,exitNo=0){return ({1:'Geradeaus weiter',2:'Links abbiegen',3:'Leicht links abbiegen',4:'Scharf links abbiegen',5:'Rechts abbiegen',6:'Leicht rechts abbiegen',7:'Scharf rechts abbiegen',8:'Links halten',9:'Rechts halten',10:'Wenden',11:'Wenden',12:'Offroad weiter',13:`Im Kreisverkehr Ausfahrt ${exitNo} nehmen`,14:`Im Kreisverkehr Ausfahrt ${Math.abs(exitNo)} nehmen`,15:'Wenden',16:'Luftlinie folgen',17:'Links abfahren',18:'Rechts abfahren'})[cmd]||'Dem Weg folgen';}
function commandArrow(cmd){return ({1:'↑',2:'←',3:'↖',4:'↰',5:'→',6:'↗',7:'↱',8:'↖',9:'↗',10:'↶',11:'↷',13:'⟳',14:'⟲',15:'↶',17:'←',18:'→'})[cmd]||'↑';}
function say(text){if(!APP.nav.voice||!('speechSynthesis'in window))return;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='de-DE';u.rate=1.03;window.speechSynthesis.speak(u);}
function startNavigation(){if(!APP.route)return toast('Zuerst eine Route berechnen.');if(!navigator.geolocation)return toast('GPS wird von diesem Browser nicht unterstützt.');$('#navOverlay').classList.remove('hidden');document.body.classList.add('navigating');APP.nav.lastHint=-1;APP.nav.follow=true;say('Navigation gestartet. Gute Fahrt.');APP.nav.watchId=navigator.geolocation.watchPosition(updateNav,e=>{toast(`GPS: ${e.message}`,4000);},{enableHighAccuracy:true,maximumAge:1500,timeout:12000});}
function stopNavigation(){if(APP.nav.watchId!=null)navigator.geolocation.clearWatch(APP.nav.watchId);APP.nav.watchId=null;$('#navOverlay').classList.add('hidden');window.speechSynthesis?.cancel();}
function updateNav(pos){const p=[pos.coords.longitude,pos.coords.latitude];APP.nav.lastPos=p;const coords=APP.route.geometry.coordinates;const near=nearestIndex(coords,p);if(APP.nav.follow)APP.map.easeTo({center:p,zoom:16,bearing:pos.coords.heading||0,duration:700});const pr=APP.route.properties||{};const total=+(pr['track-length']||0);let remain=0;for(let i=near.index;i<coords.length-1;i++)remain+=hav(coords[i],coords[i+1]);$('#navRemain').textContent=fmtKm(remain);$('#navSpeed').textContent=`${Math.round(Math.max(0,pos.coords.speed||0)*3.6)} km/h`;const totalTime=+(pr['total-time']||0);$('#navEta').textContent=fmtTime(total?totalTime*(remain/total):0);const hints=pr.voicehints||[];let next=null,nextIdx=-1;for(let i=0;i<hints.length;i++){if(hints[i][0]>=near.index){next=hints[i];nextIdx=i;break}}if(!next){$('#navDistance').textContent=fmtKm(remain);$('#navText').textContent=remain<40?'Ziel erreicht':'Dem Weg folgen';$('#navArrow').textContent='↑';if(remain<40&&APP.nav.lastHint!==9999){say('Du hast dein Ziel erreicht.');APP.nav.lastHint=9999;}return;}const hc=coords[next[0]],d=hav(p,hc),cmd=next[1],exit=next[2];$('#navDistance').textContent=d<20?'Jetzt':`In ${fmtKm(d)}`;$('#navText').textContent=commandText(cmd,exit);$('#navArrow').textContent=commandArrow(cmd);if(nextIdx!==APP.nav.lastHint&&d<140){say(`${d<35?'Jetzt':'In '+Math.round(d/10)*10+' Metern'} ${commandText(cmd,exit).toLowerCase()}.`);APP.nav.lastHint=nextIdx;}}

function downloadGpx(){if(!APP.route)return;const c=APP.route.geometry.coordinates;const pts=c.map(x=>`<trkpt lat="${x[1]}" lon="${x[0]}">${x.length>2?`<ele>${x[2]}</ele>`:''}</trkpt>`).join('');const g=`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="TourScout" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>TourScout Route</name></metadata><trk><name>TourScout Route</name><trkseg>${pts}</trkseg></trk></gpx>`;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([g],{type:'application/gpx+xml'}));a.download='TourScout-Route.gpx';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);}
function buildStages(){if(!APP.route)return toast('Bitte zuerst eine Route planen.');const days=Math.max(2,+$('#days').value||3),c=APP.route.geometry.coordinates,total=+(APP.route.properties?.['track-length']||0);const box=$('#stageResults');box.innerHTML='';for(let d=1;d<=days;d++){const target=total*d/days;let acc=0,idx=0;for(let i=0;i<c.length-1;i++){acc+=hav(c[i],c[i+1]);if(acc>=target){idx=i;break}}const div=document.createElement('div');div.className='resultCard';div.innerHTML=`<h3>Tag ${d}</h3><p>Etappenziel bei ca. ${fmtKm(total*d/days)} Gesamtstrecke${d<days?' · Camping/Laden in Kartennähe anzeigen':''}</p><div class="resultActions"><button>Etappenziel zeigen</button></div>`;div.onclick=()=>APP.map.flyTo({center:c[idx||c.length-1],zoom:13});box.appendChild(div);}toast('Etappen erstellt.');}

function showPanel(id){$$('.panel').forEach(p=>p.classList.toggle('activePanel',p.id===id));$$('[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel===id));if(innerWidth<=820)$('#sidebar').classList.add('open');if(id==='savedPanel')renderSaved();}
function addVia(){const idx=APP.points.vias.length;APP.points.vias.push(null);const row=document.createElement('div');row.className='waypointRow';row.dataset.rowIndex=idx;row.innerHTML=`<span class="dot viaDot"></span><input class="field" data-via-index="${idx}" placeholder="Zwischenpunkt"><button class="smallButton" data-via-pick="${idx}">Karte</button>`;$('#viaList').appendChild(row);}
function swapPoints(){[APP.points.start,APP.points.end]=[APP.points.end,APP.points.start];const a=$('#startInput').value;$('#startInput').value=$('#endInput').value;$('#endInput').value=a;if(APP.points.start)setMarker('start',APP.points.start);if(APP.points.end)setMarker('end',APP.points.end);}
function locate(setAsStart=false){if(!navigator.geolocation)return toast('Standortzugriff nicht unterstützt.');navigator.geolocation.getCurrentPosition(p=>{const c=[p.coords.longitude,p.coords.latitude];APP.nav.lastPos=c;APP.map.flyTo({center:c,zoom:14});if(setAsStart)setPickedPoint('start',c,'Mein Standort');toast('Standort gefunden.');},e=>toast(`Standort nicht verfügbar: ${e.message}`,4000),{enableHighAccuracy:true,timeout:10000});}
function initEvents(){
  $$('.navItem,.bottomNav button').forEach(b=>b.addEventListener('click',()=>showPanel(b.dataset.panel)));
  $('#menuBtn').onclick=()=>$('#sidebar').classList.toggle('open'); APP.sidebarClose=()=>$('#sidebar').classList.remove('open');
  $$('[data-point]').forEach(b=>b.onclick=()=>{APP.pickMode=b.dataset.point;$('#clickHint').classList.remove('hidden');APP.sidebarClose();});
  $('#viaList').addEventListener('click',e=>{const b=e.target.closest('[data-via-pick]');if(!b)return;APP.pickMode=`via${b.dataset.viaPick}`;$('#clickHint').classList.remove('hidden');APP.sidebarClose();});
  $('#viaList').addEventListener('input',e=>{const inp=e.target.closest('[data-via-index]');if(!inp)return;const i=+inp.dataset.viaIndex;APP.points.vias[i]=null;if(APP.markers.vias[i]){APP.markers.vias[i].remove();APP.markers.vias[i]=null;}});
  ['start','end'].forEach(type=>$(`#${type}Input`).addEventListener('input',()=>{APP.points[type]=null;if(APP.markers[type]){APP.markers[type].remove();APP.markers[type]=null;}}));
  $('#cancelPick').onclick=()=>{APP.pickMode=null;$('#clickHint').classList.add('hidden')};
  $('#addViaBtn').onclick=addVia;$('#swapBtn').onclick=swapPoints;$('#planBtn').onclick=planRoute;$('#locateBtn').onclick=()=>locate(false);$('#gpxBtn').onclick=downloadGpx;$('#startNavBtn').onclick=startNavigation;$('#stopNavBtn').onclick=stopNavigation;$('#centerNavBtn').onclick=()=>{APP.nav.follow=true;if(APP.nav.lastPos)APP.map.flyTo({center:APP.nav.lastPos,zoom:16})};
  $('#voiceBtn').onclick=()=>{APP.nav.voice=!APP.nav.voice;$('#voiceBtn').classList.toggle('active',APP.nav.voice);$('#voiceBtn').textContent=APP.nav.voice?'🔊 Stimme':'🔇 Stimme';if(APP.nav.voice)say('Sprachausgabe eingeschaltet.');};
  $('#themeBtn').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem('tourscout_dark',document.body.classList.contains('dark')?'1':'0');};
  $('#showCamping').onchange=()=>{$('#campBtn').classList.toggle('active',$('#showCamping').checked);loadUtilityPois(!!APP.route)};$('#showCharging').onchange=()=>{$('#chargeBtn').classList.toggle('active',$('#showCharging').checked);loadUtilityPois(!!APP.route)};
  $('#campBtn').onclick=()=>{$('#showCamping').checked=!$('#showCamping').checked;$('#campBtn').classList.toggle('active',$('#showCamping').checked);loadUtilityPois(!!APP.route)};$('#chargeBtn').onclick=()=>{$('#showCharging').checked=!$('#showCharging').checked;$('#chargeBtn').classList.toggle('active',$('#showCharging').checked);loadUtilityPois(!!APP.route)};
  $$('#weatherSegment button').forEach(b=>b.onclick=()=>{$$('#weatherSegment button').forEach(x=>x.classList.remove('active'));b.classList.add('active');APP.weather=b.dataset.weather;});
  $$('#categoryChips button').forEach(b=>b.onclick=()=>{b.classList.toggle('active');b.classList.contains('active')?APP.categories.add(b.dataset.cat):APP.categories.delete(b.dataset.cat);});
  $('#radius').oninput=e=>$('#radiusValue').textContent=e.target.value;$('#discoverBtn').onclick=discover;$('#buildStagesBtn').onclick=buildStages;
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&APP.map)APP.map.resize();});window.addEventListener('orientationchange',()=>setTimeout(()=>APP.map?.resize(),250));
}
function initCounter(){let n=+(localStorage.getItem('tourscout_visits')||0)+1;localStorage.setItem('tourscout_visits',n);$('#visitCount').textContent=n.toLocaleString('de-DE');}
function init(){if(localStorage.getItem('tourscout_dark')==='1'||(!localStorage.getItem('tourscout_dark')&&matchMedia('(prefers-color-scheme: dark)').matches))document.body.classList.add('dark');initCounter();initMap();initEvents();renderSaved();if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./service-worker.js').catch(console.warn);}
init();
})();
