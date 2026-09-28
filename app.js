(() => {
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v,min,max) => Math.max(min,Math.min(max,v));

const APP = {
  map:null,
  points:{start:null,end:null,vias:[]},
  labels:{start:'',end:'',vias:[]},
  markers:{start:null,end:null,vias:[]},
  route:null,
  routeMeta:null,
  poiMarkers:[],
  pickMode:null,
  weather:'good',
  audience:'all',
  categories:new Set(['nature','sights','museum']),
  discoverCenter:null,
  savedTab:'routes',
  nav:{watchId:null,voice:true,lastHint:-1,lastPos:null,follow:true,lastReroute:0,wakeLock:null,marker:null},
  endpoints:{
    brouter:'https://brouter.de/brouter',
    nominatim:'https://nominatim.openstreetmap.org/search',
    overpass:['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']
  },
  storeKeys:{routes:'tourscout_routes_v2',favorites:'tourscout_favorites_v2',visited:'tourscout_visited_v2'},
  lastGeocode:0
};

const BIKE = {
  ebike:{label:'E-Bike',profiles:['trekking'],speed:23,ebike:true},
  emtb:{label:'E-MTB',profiles:['mtb','trekking'],speed:18,ebike:true},
  trekking:{label:'Trekkingrad',profiles:['trekking'],speed:18},
  gravel:{label:'Gravel',profiles:['gravel','trekking'],speed:21},
  mtb:{label:'Mountainbike',profiles:['mtb','trekking'],speed:16},
  road:{label:'Rennrad',profiles:['fastbike-verylowtraffic','trekking'],speed:27},
  city:{label:'Citybike',profiles:['trekking'],speed:16}
};

function toast(msg,ms=3000){const t=$('#toast');if(!t)return;t.textContent=msg;t.classList.remove('hidden');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.add('hidden'),ms);}
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function fmtKm(m){if(!isFinite(m))return '–';return m<1000?`${Math.round(m)} m`:`${(m/1000).toFixed(m<10000?1:0)} km`;}
function fmtTime(sec){if(!sec||!isFinite(sec))return '–';const h=Math.floor(sec/3600),m=Math.round((sec%3600)/60);return h?`${h} h ${m} min`:`${m} min`;}
function fmtPercent(v){return `${Math.round(v)} %`;}
function hav(a,b){const R=6371000,p=Math.PI/180,dLat=(b[1]-a[1])*p,dLon=(b[0]-a[0])*p,s=Math.sin(dLat/2)**2+Math.cos(a[1]*p)*Math.cos(b[1]*p)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(s));}
function routeDistance(coords){let d=0;for(let i=0;i<coords.length-1;i++)d+=hav(coords[i],coords[i+1]);return d;}
function nearestIndex(coords,p){let best=0,d=Infinity;const step=Math.max(1,Math.floor(coords.length/1800));for(let i=0;i<coords.length;i+=step){const x=hav(coords[i],p);if(x<d){d=x;best=i;}}return {index:best,distance:d};}
function destinationPoint([lon,lat],distance,bearing){const R=6371000,br=bearing*Math.PI/180,p1=lat*Math.PI/180,l1=lon*Math.PI/180,dr=distance/R;const p2=Math.asin(Math.sin(p1)*Math.cos(dr)+Math.cos(p1)*Math.sin(dr)*Math.cos(br));const l2=l1+Math.atan2(Math.sin(br)*Math.sin(dr)*Math.cos(p1),Math.cos(dr)-Math.sin(p1)*Math.sin(p2));return [((l2*180/Math.PI+540)%360)-180,p2*180/Math.PI];}
function getStore(key){try{return JSON.parse(localStorage.getItem(key)||'[]');}catch{return [];}}
function setStore(key,data){localStorage.setItem(key,JSON.stringify(data));}
function uid(prefix='x'){return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;}

function initMap(){
  if(typeof maplibregl==='undefined'){toast('Kartenbibliothek konnte nicht geladen werden.',5000);return;}
  APP.map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/liberty',center:[7.63,51.11],zoom:9,attributionControl:false});
  APP.map.addControl(new maplibregl.NavigationControl({showCompass:true}),'bottom-right');
  APP.map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'© OpenStreetMap-Mitwirkende · OpenFreeMap'}),'bottom-right');
  APP.map.on('load',()=>{ensureRouteLayers();setTimeout(()=>loadUtilityPois(false),700);});
  APP.map.on('click',e=>{if(!APP.pickMode)return;setPickedPoint(APP.pickMode,[e.lngLat.lng,e.lngLat.lat]);APP.pickMode=null;$('#clickHint').classList.add('hidden');});
}

function ensureRouteLayers(){
  if(!APP.map||APP.map.getSource('route'))return;
  APP.map.addSource('route',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:[]},properties:{}}});
  APP.map.addLayer({id:'route-shadow',type:'line',source:'route',paint:{'line-color':'#ffffff','line-width':9,'line-opacity':.9}});
  APP.map.addLayer({id:'route-line',type:'line',source:'route',paint:{'line-color':'#2d7c5a','line-width':6,'line-opacity':.97}});
}

function markerEl(cls){const d=document.createElement('div');d.className=`point-marker ${cls}`;d.title='Ziehen zum Verschieben';return d;}
function routeNeedsRefresh(){if(!APP.route)return;$('#routeStatus').textContent='Routenpunkt verschoben – bitte Route neu berechnen.';$('#routeSummary').classList.add('hidden');}
function setMarker(type,coord){
  if(APP.markers[type])APP.markers[type].remove();
  const marker=new maplibregl.Marker({element:markerEl(type),anchor:'center',draggable:true}).setLngLat(coord).addTo(APP.map);
  marker.on('dragend',()=>{const p=marker.getLngLat(),c=[p.lng,p.lat];APP.points[type]=c;APP.labels[type]=`${c[1].toFixed(5)}, ${c[0].toFixed(5)}`;$(`#${type}Input`).value=APP.labels[type];routeNeedsRefresh();});
  APP.markers[type]=marker;
}
function setViaMarker(i,coord){
  if(APP.markers.vias[i])APP.markers.vias[i].remove();
  const marker=new maplibregl.Marker({element:markerEl('via'),anchor:'center',draggable:true}).setLngLat(coord).addTo(APP.map);
  marker.on('dragend',()=>{const p=marker.getLngLat(),c=[p.lng,p.lat];APP.points.vias[i]=c;APP.labels.vias[i]=`${c[1].toFixed(5)}, ${c[0].toFixed(5)}`;const input=$(`[data-via-index="${i}"]`);if(input)input.value=APP.labels.vias[i];routeNeedsRefresh();});
  APP.markers.vias[i]=marker;
}
function setPickedPoint(type,coord,label=''){
  if(type==='start'||type==='end'){
    APP.points[type]=coord;APP.labels[type]=label||`${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`;setMarker(type,coord);$(`#${type}Input`).value=APP.labels[type];
  }else if(type.startsWith('via')){
    const i=+type.slice(3);APP.points.vias[i]=coord;APP.labels.vias[i]=label||`${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`;setViaMarker(i,coord);const input=$(`[data-via-index="${i}"]`);if(input)input.value=APP.labels.vias[i];
  }
}
function clearPoint(type){if(type==='start'||type==='end'){APP.points[type]=null;APP.labels[type]='';if(APP.markers[type]){APP.markers[type].remove();APP.markers[type]=null;}}}

async function geocode(text){
  const q=text.trim();if(!q)throw new Error('Bitte einen Ort eingeben.');
  const wait=Math.max(0,1100-(Date.now()-APP.lastGeocode));if(wait)await new Promise(r=>setTimeout(r,wait));APP.lastGeocode=Date.now();
  const url=`${APP.endpoints.nominatim}?format=jsonv2&limit=1&countrycodes=de,at,ch,nl,be,pl,cz&q=${encodeURIComponent(q)}`;
  const r=await fetch(url,{headers:{Accept:'application/json'}});if(!r.ok)throw new Error('Ortssuche ist gerade nicht erreichbar.');
  const j=await r.json();if(!j.length)throw new Error('Ort nicht gefunden.');
  return {coord:[+j[0].lon,+j[0].lat],label:j[0].display_name};
}

async function resolveInputs(){
  if($('#roundTrip').checked){
    if(!APP.points.start){const text=$('#startInput').value.trim();if(text){const g=await geocode(text);setPickedPoint('start',g.coord,g.label);}else if(APP.nav.lastPos)setPickedPoint('start',APP.nav.lastPos,'Mein Standort');}
    return;
  }
  for(const type of ['start','end']){
    const input=$(`#${type}Input`);if(input.value.trim()&&!APP.points[type]){const g=await geocode(input.value);setPickedPoint(type,g.coord,g.label);}
  }
  for(const input of $$('[data-via-index]')){
    const i=+input.dataset.viaIndex;if(input.value.trim()&&!APP.points.vias[i]){const g=await geocode(input.value);setPickedPoint(`via${i}`,g.coord,g.label);}
  }
}

function profileParams(profile){
  const mode=$('#routeMode').value,avoidUnsafe=$('#avoidUnsafe').checked,avoidHills=$('#avoidHills').checked,avoidFerries=$('#avoidFerries').checked;
  const p={};
  if(profile==='trekking'){
    p['avoid_unsafe']=mode==='fast'?false:(avoidUnsafe||mode==='safe');p['allow_ferries']=!avoidFerries;
    p['consider_elevation']=avoidHills||mode==='flat';
    if(avoidHills||mode==='flat')p['uphillcost']=140;
    p['consider_forest']=mode==='scenic';p['consider_river']=mode==='scenic';
  }else if(profile==='fastbike-verylowtraffic'){
    p['allow_ferries']=!avoidFerries;p['consider_elevation']=avoidHills||mode==='flat';p['consider_forest']=mode==='scenic';p['consider_river']=mode==='scenic';
  }else if(profile==='mtb'){
    p['avoid_unsafe']=(avoidUnsafe||mode==='safe')?1:0;p['allow_ferries']=avoidFerries?0:1;p['consider_elevation']=1;p['hills']=(avoidHills||mode==='flat')?2:0;
  }else if(profile==='gravel'){
    p['consider_elevation']=avoidHills||mode==='flat';p['avoid_steep_inclines']=avoidHills||mode==='flat';p['prefer_forests']=mode==='scenic';p['prefer_rivers']=mode==='scenic';p['consider_traffic_estimate']=mode==='safe';
  }
  return p;
}

function routePointsForRequest(){
  if($('#roundTrip').checked){
    const start=APP.points.start;if(!start)return [];
    const km=clamp(+$(`#roundKm`).value||40,5,250),bearing=+$(`#roundDirection`).value||0;
    const radius=(km*1000)/(2*Math.PI)*1.02;
    const a=destinationPoint(start,radius,bearing),b=destinationPoint(start,radius,bearing+120),c=destinationPoint(start,radius,bearing+240);
    return [start,a,b,c,start];
  }
  return [APP.points.start,...APP.points.vias.filter(Boolean),APP.points.end].filter(Boolean);
}

async function requestBrouter(coords,bikeType=$('#bikeType').value){
  const cfg=BIKE[bikeType]||BIKE.trekking;let last=null;
  for(const profile of cfg.profiles){
    try{
      const params=new URLSearchParams({lonlats:coords.map(c=>`${c[0]},${c[1]}`).join('|'),profile,alternativeidx:'0',format:'geojson',timode:'3'});
      const extras=profileParams(profile);for(const [k,v] of Object.entries(extras))params.set(`profile:${k}`,String(v));
      const r=await fetch(`${APP.endpoints.brouter}?${params}`);if(!r.ok)throw new Error(`Routing-Server: HTTP ${r.status}`);
      const data=await r.json();const f=data.features?.find(x=>x.geometry?.type==='LineString');if(!f)throw new Error('Keine fahrbare Route gefunden.');
      return {feature:f,profile};
    }catch(e){last=e;console.warn('BRouter profile failed',profile,e);}
  }
  throw last||new Error('Route konnte nicht berechnet werden.');
}

async function planRoute(){
  const btn=$('#planBtn');btn.disabled=true;btn.textContent='Berechne …';$('#routeStatus').textContent='Orte werden aufgelöst …';
  try{
    await resolveInputs();
    if(!APP.points.start)throw new Error('Bitte einen Start festlegen.');
    if(!$('#roundTrip').checked&&!APP.points.end)throw new Error('Bitte ein Ziel festlegen.');
    const coords=routePointsForRequest();if(coords.length<2)throw new Error('Zu wenige Routenpunkte.');
    $('#routeStatus').textContent='Fahrradroute wird berechnet …';
    const result=await requestBrouter(coords);applyRoute(result.feature,{profile:result.profile,plannedPoints:coords,bikeType:$('#bikeType').value,imported:false});
    $('#routeStatus').textContent=`Route mit ${BIKE[$('#bikeType').value].label} berechnet.`;
    if($('#showCamping').checked||$('#showCharging').checked)loadUtilityPois(true);
  }catch(e){console.error(e);$('#routeStatus').textContent=e.message||'Route konnte nicht berechnet werden.';toast($('#routeStatus').textContent,4500);}finally{btn.disabled=false;btn.textContent='Route berechnen';}
}

function applyRoute(feature,meta={},fit=true){
  APP.route=feature;APP.routeMeta={...meta,createdAt:meta.createdAt||new Date().toISOString()};ensureRouteLayers();
  APP.map.getSource('route').setData(feature);if(fit)fitRoute();
  updateRouteSummary();$('#routeSummary').classList.remove('hidden');
}
function fitRoute(){if(!APP.route||!APP.map)return;const c=APP.route.geometry.coordinates;if(!c.length)return;const b=c.reduce((x,p)=>x.extend(p),new maplibregl.LngLatBounds(c[0],c[0]));APP.map.fitBounds(b,{padding:70,duration:650});}

function routeStats(){
  if(!APP.route)return {distance:0,time:0,ascend:0};
  const pr=APP.route.properties||{},coords=APP.route.geometry.coordinates||[],distance=+(pr['track-length']||0)||routeDistance(coords),cfg=BIKE[APP.routeMeta?.bikeType||$('#bikeType').value]||BIKE.trekking,time=+(pr['total-time']||0)||(distance/(cfg.speed*1000/3600));
  let ascend=+(pr['filtered ascend']||0);if(!ascend){ascend=0;for(let i=1;i<coords.length;i++){if(coords[i].length>2&&coords[i-1].length>2)ascend+=Math.max(0,coords[i][2]-coords[i-1][2]);}}
  return {distance,time,ascend};
}
function ebikeRangeKm(){const wh=+$(`#batteryWh`).value||625,use=+$(`#whPerKm`).value||11,reserve=clamp(+$(`#batteryReserve`).value||15,0,80);return (wh/use)*(1-reserve/100);}
function updateRangePreview(){const km=ebikeRangeKm();$('#rangePreview').innerHTML=`Geschätzte nutzbare Reichweite: <b>${Math.round(km)} km</b>. Das ist eine grobe Planung; Temperatur, Gewicht, Wind, Steigung und Unterstützungsstufe können stark abweichen.`;}
function updateRouteSummary(){
  const s=routeStats();$('#sumDistance').textContent=fmtKm(s.distance);$('#sumTime').textContent=fmtTime(s.time);$('#sumAscent').textContent=`${Math.round(s.ascend)} m`;
  const bike=BIKE[APP.routeMeta?.bikeType||$('#bikeType').value]||BIKE.trekking;
  if(bike.ebike){const range=ebikeRangeKm(),need=s.distance/1000;$('#sumRange').textContent=`${Math.round(range)} km`;const bar=$('#rangeWarning');bar.classList.remove('hidden');const pct=clamp(need/range*100,0,100);bar.querySelector('span').style.width=`${pct}%`;bar.querySelector('b').textContent=need<=range?`Geschätzte Reichweite reicht – ca. ${Math.max(0,Math.round(range-need))} km Reserve`:`Ladestopp empfohlen – ca. ${Math.round(need-range)} km über Reichweite`;bar.querySelector('span').style.background=need<=range?'var(--green2)':'var(--red)';
  }else{$('#sumRange').textContent='–';$('#rangeWarning').classList.add('hidden');}
  renderElevation();renderComposition();
}

function renderElevation(){
  const svg=$('#elevationChart'),coords=APP.route?.geometry?.coordinates||[],pts=coords.filter(c=>c.length>2&&isFinite(c[2]));if(pts.length<2){svg.innerHTML='';$('#elevationMeta').textContent='Keine Höhendaten';return;}
  const sample=[];const step=Math.max(1,Math.floor(pts.length/180));for(let i=0;i<pts.length;i+=step)sample.push(pts[i]);if(sample[sample.length-1]!==pts[pts.length-1])sample.push(pts[pts.length-1]);
  const es=sample.map(p=>+p[2]),min=Math.min(...es),max=Math.max(...es),range=Math.max(20,max-min);const xy=sample.map((p,i)=>[i/(sample.length-1)*500,112-(p[2]-min)/range*100]);const line=xy.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');const area=`${line} L500,120 L0,120 Z`;
  svg.innerHTML=`<path d="${area}" fill="rgba(77,184,134,.22)"></path><path d="${line}" fill="none" stroke="currentColor" stroke-width="3" vector-effect="non-scaling-stroke"></path>`;svg.style.color='var(--green)';$('#elevationMeta').textContent=`${Math.round(min)}–${Math.round(max)} m`;
}

function parseWayTag(tags,key){const m=String(tags||'').match(new RegExp(`(?:^|\\s)${key}=([^\\s]+)`));return m?m[1]:'';}
function routeComposition(){
  const msgs=APP.route?.properties?.messages;if(!Array.isArray(msgs)||msgs.length<2)return null;const header=msgs[0],di=header.indexOf('Distance'),wi=header.indexOf('WayTags');if(di<0||wi<0)return null;
  const totals={cycle:0,road:0,path:0,paved:0,unpaved:0,unknown:0},all=msgs.slice(1).reduce((acc,row)=>acc+(+row[di]||0),0)||1;
  for(const row of msgs.slice(1)){const d=+row[di]||0,t=row[wi]||'',h=parseWayTag(t,'highway'),s=parseWayTag(t,'surface');if(h==='cycleway'||/route_bicycle_|cycleway=/.test(t))totals.cycle+=d;if(/^(primary|secondary|tertiary|unclassified|residential|living_street|service|road)/.test(h))totals.road+=d;if(/^(path|track|footway|bridleway)/.test(h))totals.path+=d;if(/^(asphalt|paved|concrete|paving_stones|sett)$/.test(s))totals.paved+=d;else if(/^(gravel|fine_gravel|compacted|ground|earth|dirt|unpaved|grass|sand|mud|pebblestone|cobblestone)$/.test(s))totals.unpaved+=d;else totals.unknown+=d;}
  return {totals,all};
}
function renderComposition(){
  const box=$('#surfaceStats'),c=routeComposition();if(!c){box.innerHTML='<div class="muted compact">Keine detaillierten Weg-Tags verfügbar.</div>';return;}
  const rows=[['Radweg',c.totals.cycle],['Straße',c.totals.road],['Pfad/Track',c.totals.path],['Befestigt',c.totals.paved],['Unbefestigt',c.totals.unpaved]];box.innerHTML=rows.map(([n,v])=>{const p=clamp(v/c.all*100,0,100);return `<div class="statRow"><span>${n}</span><div class="statTrack"><div class="statFill" style="width:${p.toFixed(1)}%"></div></div><b>${Math.round(p)}%</b></div>`;}).join('');
}

async function overpass(query){let last;for(const ep of APP.endpoints.overpass){try{const r=await fetch(ep,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:`data=${encodeURIComponent(query)}`});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}catch(e){last=e;console.warn('Overpass failed',ep,e);}}throw new Error(`OpenStreetMap-Suche nicht erreichbar${last?` (${last.message})`:''}.`);}
function poiCoord(x){return x.type==='node'?[x.lon,x.lat]:x.center?[x.center.lon,x.center.lat]:null;}
function poiName(t,kind){return t['name:de']||t.name||(kind==='camp'?'Campingplatz':kind==='charge'?'E-Bike-Ladepunkt':'Ausflugsziel');}
function clearPois(kind){APP.poiMarkers=APP.poiMarkers.filter(x=>{if(!kind||x.kind===kind){x.marker.remove();return false;}return true;});}
function addPoiMarker(item){if(!APP.map)return;const el=document.createElement('div');el.className=`poi-marker ${item.kind}`;el.textContent=item.kind==='camp'?'🏕️':item.kind==='charge'?'🔌':item.kind==='visited'?'✓':'★';const popup=`<strong>${esc(item.name)}</strong><br><small>${esc(item.desc||'')}</small>`;const marker=new maplibregl.Marker({element:el}).setLngLat(item.coord).setPopup(new maplibregl.Popup({offset:18}).setHTML(popup)).addTo(APP.map);APP.poiMarkers.push({marker,kind:item.kind,item});}

function utilityQueryForRoute(){
  const coords=APP.route?.geometry?.coordinates||[],corridor=+$(`#poiCorridor`).value||3000;if(!coords.length)return '';
  const n=Math.min(14,Math.max(3,Math.ceil(coords.length/250))),samples=[];for(let i=0;i<n;i++)samples.push(coords[Math.min(coords.length-1,Math.round(i*(coords.length-1)/(n-1)))]);
  const parts=[];for(const [lon,lat] of samples){if($('#showCamping').checked)parts.push(`nwr(around:${corridor},${lat},${lon})[tourism~"camp_site|caravan_site"]`);if($('#showCharging').checked){parts.push(`nwr(around:${corridor},${lat},${lon})[amenity="charging_station"][bicycle~"yes|designated"]`);parts.push(`nwr(around:${corridor},${lat},${lon})["service:bicycle:charging"~"yes|free|fee|only"]`);}}
  return `[out:json][timeout:30];(${parts.map(x=>x+';').join('')});out center tags 220;`;
}
function utilityQueryNear(center,radius=15000){
  const [lon,lat]=center,parts=[];if($('#showCamping').checked)parts.push(`nwr(around:${radius},${lat},${lon})[tourism~"camp_site|caravan_site"]`);if($('#showCharging').checked){parts.push(`nwr(around:${radius},${lat},${lon})[amenity="charging_station"][bicycle~"yes|designated"]`);parts.push(`nwr(around:${radius},${lat},${lon})["service:bicycle:charging"~"yes|free|fee|only"]`);}return `[out:json][timeout:25];(${parts.map(x=>x+';').join('')});out center tags 160;`;
}
async function loadUtilityPois(routeAware=true){
  clearPois('camp');clearPois('charge');if(!$('#showCamping').checked&&!$('#showCharging').checked)return;
  const useRoute=routeAware&&!!APP.route,center=APP.nav.lastPos||(APP.map?[APP.map.getCenter().lng,APP.map.getCenter().lat]:null),q=useRoute?utilityQueryForRoute():(center?utilityQueryNear(center):'');if(!q)return;
  try{const data=await overpass(q),seen=new Set(),routeCoords=APP.route?.geometry?.coordinates||[],step=Math.max(1,Math.floor(Math.max(1,routeCoords.length)/500)),sampled=routeCoords.filter((_,i)=>i%step===0),corridor=+$(`#poiCorridor`).value||3000;let items=[];
    for(const x of data.elements||[]){const id=`${x.type}-${x.id}`;if(seen.has(id))continue;seen.add(id);const coord=poiCoord(x);if(!coord)continue;const t=x.tags||{},kind=(t.tourism==='camp_site'||t.tourism==='caravan_site')?'camp':'charge';if(kind==='camp'&&!$('#showCamping').checked)continue;if(kind==='charge'&&!$('#showCharging').checked)continue;let near=useRoute?Infinity:hav(center,coord);if(useRoute){for(const p of sampled)near=Math.min(near,hav(p,coord));if(near>corridor*1.3)continue;}items.push({id,coord,kind,name:poiName(t,kind),desc:useRoute?`${kind==='camp'?'Übernachtung':'Laden'} · ca. ${fmtKm(near)} von der Route`:`${kind==='camp'?'Übernachtung':'Laden'} · ca. ${fmtKm(near)} entfernt`,distRoute:near,tags:t});}
    items.sort((a,b)=>a.distRoute-b.distRoute);items.slice(0,90).forEach(addPoiMarker);
  }catch(e){console.warn(e);toast('Camping/Ladepunkte konnten nicht vollständig geladen werden.',3500);}
}

function discoverQuery(center,radius){
  const [lon,lat]=center,r=Math.min(radius,200000),parts=[],cats=APP.categories,w=APP.weather,a=APP.audience,add=x=>parts.push(`nwr(around:${r},${lat},${lon})${x}`);
  if(w!=='bad'){
    if(cats.has('nature')){add('[leisure~"nature_reserve|park|garden"][name]');add('[natural~"waterfall|peak|beach"][name]');}
    if(cats.has('sights')){add('[historic~"castle|ruins|monument|memorial"][name]');add('[tourism="attraction"][name]');}
    if(cats.has('animals')){add('[tourism~"zoo|aquarium"][name]');add('[leisure="wildlife_hide"][name]');}
    if(cats.has('family')){add('[tourism="theme_park"][name]');add('[leisure~"playground|water_park"][name]');}
    if(cats.has('water')){add('[leisure~"swimming_area|marina"][name]');add('[natural="water"][name]');}
    if(cats.has('view'))add('[tourism="viewpoint"][name]');
    if(cats.has('sport'))add('[leisure~"miniature_golf|sports_centre|pitch"][name]');
    if(cats.has('tech')){add('[tourism="attraction"][industrial][name]');add('[man_made~"tower|works"][name]');}
  }
  if(w!=='good'){
    if(cats.has('museum')||cats.has('sights')||cats.has('tech'))add('[tourism="museum"][name]');
    if(cats.has('indoor')||cats.has('family')){add('[leisure="indoor_play"][name]');add('[amenity="cinema"][name]');add('[leisure="bowling_alley"][name]');add('[leisure="swimming_pool"][indoor="yes"][name]');}
    if(cats.has('animals'))add('[tourism="aquarium"][name]');
    if(cats.has('sport')){add('[leisure="sports_centre"][indoor="yes"][name]');add('[leisure="bowling_alley"][name]');}
  }
  if(a==='kids'||a==='family'){add('[leisure="playground"][name]');add('[tourism~"zoo|theme_park"][name]');}
  return `[out:json][timeout:35];(${parts.map(x=>x+';').join('')});out center tags 240;`;
}
function describePoi(t){
  if(t.tourism==='museum')return '🏛️ Museum / Indoor';if(t.tourism==='viewpoint')return '📷 Aussichtspunkt';if(t.tourism==='zoo')return '🦁 Zoo / Tierpark';if(t.tourism==='aquarium')return '🐠 Aquarium';if(t.tourism==='theme_park')return '🎢 Freizeitpark';if(t.leisure==='playground')return '🛝 Spielplatz';if(t.leisure==='bowling_alley')return '🎳 Bowling';if(t.amenity==='cinema')return '🎬 Kino';if(t.natural==='waterfall')return '💧 Wasserfall';if(t.historic)return '🏰 Historischer Ort';if(t.leisure==='nature_reserve'||t.boundary==='protected_area')return '🌲 Natur';return APP.weather==='bad'?'🌧️ Indoor-/Ausflugsziel':'☀️ Ausflugsziel';
}
async function resolveDiscoverCenter(){
  const text=$('#discoverCenter').value.trim();if(text){const g=await geocode(text);APP.discoverCenter=g.coord;$('#discoverCenterLabel').textContent=`Suchzentrum: ${g.label}`;APP.map.flyTo({center:g.coord,zoom:10});return g.coord;}
  return APP.discoverCenter||APP.nav.lastPos||[APP.map.getCenter().lng,APP.map.getCenter().lat];
}
async function discover(){
  const btn=$('#discoverBtn');btn.disabled=true;btn.textContent='Suche …';$('#discoverStatus').textContent='Ausflugsziele werden geladen …';clearPois('trip');$('#poiResults').innerHTML='';
  try{const center=await resolveDiscoverCenter(),radius=+$(`#radius`).value*1000,data=await overpass(discoverQuery(center,radius));let items=[];
    for(const x of data.elements||[]){const c=poiCoord(x),t=x.tags||{},name=t['name:de']||t.name;if(!c||!name)continue;if($('#bikeFriendly').checked&&(t.bicycle==='no'||t.access==='private'||t.access==='no'))continue;if($('#freeOnly').checked&&t.fee!=='no')continue;items.push({id:`${x.type}-${x.id}`,coord:c,kind:'trip',name,dist:hav(center,c),desc:describePoi(t),tags:t});}
    items.sort((a,b)=>a.dist-b.dist);const uniq=new Map();for(const i of items)if(!uniq.has(i.name.toLowerCase()))uniq.set(i.name.toLowerCase(),i);items=[...uniq.values()].slice(0,45);items.slice(0,80).forEach(addPoiMarker);renderDiscoverResults(items);$('#discoverStatus').textContent=`${items.length} passende Ziele gefunden.`;
  }catch(e){console.error(e);$('#discoverStatus').textContent=e.message;toast(e.message,4500);}finally{btn.disabled=false;btn.textContent='Ausflüge suchen';}
}
function renderDiscoverResults(items){
  const box=$('#poiResults');box.innerHTML=items.length?'':'<div class="infoCard">Keine passenden Ziele gefunden. Radius oder Filter ändern.</div>';
  for(const i of items.slice(0,30)){const card=document.createElement('div');card.className='resultCard';const fee=i.tags?.fee==='no'?' · kostenlos markiert':'';card.innerHTML=`<h3>${esc(i.name)}</h3><p>${esc(i.desc)} · ${fmtKm(i.dist)}${fee}</p><div class="resultActions"><button data-act="map">Karte</button><button data-act="route" class="primaryMini">🚲 Route</button><button data-act="save">☆ Merken</button><button data-act="visit">✓ Besucht</button></div>`;card._item=i;box.appendChild(card);}
  box.onclick=e=>{const b=e.target.closest('button');if(!b)return;const c=b.closest('.resultCard'),i=c?._item;if(!i)return;const a=b.dataset.act;if(a==='map'){APP.map.flyTo({center:i.coord,zoom:14});if(innerWidth<=820)$('#sidebar').classList.remove('open');}else if(a==='route'){if(APP.nav.lastPos)setPickedPoint('start',APP.nav.lastPos,'Mein Standort');setPickedPoint('end',i.coord,i.name);$('#roundTrip').checked=false;toggleRoundTrip();showPanel('routePanel');toast('Ziel übernommen. Route berechnen.');}else if(a==='save')saveFavorite(i);else if(a==='visit')markVisited(i);};
}
function saveFavorite(item){const a=getStore(APP.storeKeys.favorites);if(!a.some(x=>x.id===item.id))a.push({id:item.id,name:item.name,coord:item.coord,desc:item.desc,addedAt:new Date().toISOString()});setStore(APP.storeKeys.favorites,a);toast('Als Favorit gespeichert.');}
function markVisited(item){const a=getStore(APP.storeKeys.visited);if(!a.some(x=>x.id===item.id))a.push({id:item.id,name:item.name,coord:item.coord,desc:item.desc,visitedAt:new Date().toISOString()});setStore(APP.storeKeys.visited,a);toast('Als besucht markiert.');}

function compactRouteFeature(feature){const pr=feature.properties||{};return {type:'Feature',properties:{'track-length':pr['track-length'],'filtered ascend':pr['filtered ascend'],'plain-ascend':pr['plain-ascend'],'total-time':pr['total-time'],'total-energy':pr['total-energy'],voicehints:pr.voicehints||[]},geometry:feature.geometry};}
function saveCurrentRoute(){
  if(!APP.route)return toast('Keine Route vorhanden.');const s=routeStats(),name=prompt('Name der Tour:',`Tour ${new Date().toLocaleDateString('de-DE')}`);if(!name)return;const a=getStore(APP.storeKeys.routes);a.unshift({id:uid('route'),name,feature:compactRouteFeature(APP.route),meta:APP.routeMeta,stats:s,savedAt:new Date().toISOString()});try{setStore(APP.storeKeys.routes,a.slice(0,30));toast('Tour gespeichert.');}catch(e){toast('Speicher ist voll. Bitte alte Touren löschen.',4500);}
}
function renderSaved(){
  const box=$('#savedResults'),tab=APP.savedTab;box.innerHTML='';
  if(tab==='routes'){
    const a=getStore(APP.storeKeys.routes);if(!a.length){box.innerHTML='<div class="infoCard">Noch keine Tour gespeichert.</div>';return;}
    for(const r of a){const d=document.createElement('div');d.className='resultCard';d.innerHTML=`<h3>${esc(r.name)}</h3><p>${fmtKm(r.stats?.distance||0)} · ${fmtTime(r.stats?.time||0)} · gespeichert ${new Date(r.savedAt).toLocaleDateString('de-DE')}</p><div class="resultActions"><button data-act="open" class="primaryMini">Öffnen</button><button data-act="delete">Löschen</button></div>`;d._item=r;box.appendChild(d);}
    box.onclick=e=>{const b=e.target.closest('button'),r=b?.closest('.resultCard')?._item;if(!r)return;if(b.dataset.act==='open'){applyRoute(r.feature,r.meta||{});showPanel('routePanel');toast('Gespeicherte Tour geöffnet.');}else if(b.dataset.act==='delete'){setStore(APP.storeKeys.routes,getStore(APP.storeKeys.routes).filter(x=>x.id!==r.id));renderSaved();}};
  }else{
    const key=tab==='favorites'?APP.storeKeys.favorites:APP.storeKeys.visited,a=getStore(key);if(!a.length){box.innerHTML=`<div class="infoCard">Noch keine ${tab==='favorites'?'Favoriten':'besuchten Orte'}.</div>`;return;}
    for(const i of a){const d=document.createElement('div');d.className='resultCard';d.innerHTML=`<h3>${esc(i.name)}</h3><p>${esc(i.desc||'')}</p><div class="resultActions"><button data-act="map">Karte</button><button data-act="route" class="primaryMini">🚲 Route</button><button data-act="delete">Löschen</button></div>`;d._item=i;box.appendChild(d);}
    box.onclick=e=>{const b=e.target.closest('button'),i=b?.closest('.resultCard')?._item;if(!i)return;if(b.dataset.act==='map')APP.map.flyTo({center:i.coord,zoom:14});else if(b.dataset.act==='route'){if(APP.nav.lastPos)setPickedPoint('start',APP.nav.lastPos,'Mein Standort');setPickedPoint('end',i.coord,i.name);showPanel('routePanel');}else if(b.dataset.act==='delete'){setStore(key,getStore(key).filter(x=>x.id!==i.id));renderSaved();}};
  }
}

function downloadGpx(){
  if(!APP.route)return toast('Keine Route vorhanden.');const c=APP.route.geometry.coordinates,pts=c.map(p=>`<trkpt lat="${p[1]}" lon="${p[0]}">${p.length>2?`<ele>${p[2]}</ele>`:''}</trkpt>`).join(''),g=`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="TourScout" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>TourScout Route</name></metadata><trk><name>TourScout Route</name><trkseg>${pts}</trkseg></trk></gpx>`;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([g],{type:'application/gpx+xml'}));a.download='TourScout-Route.gpx';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function importGpx(file){
  try{const txt=await file.text(),doc=new DOMParser().parseFromString(txt,'application/xml');if(doc.querySelector('parsererror'))throw new Error('GPX-Datei konnte nicht gelesen werden.');let pts=[...doc.querySelectorAll('trkpt')];if(pts.length<2)pts=[...doc.querySelectorAll('rtept')];const coords=pts.map(p=>{const lon=+p.getAttribute('lon'),lat=+p.getAttribute('lat'),ele=+p.querySelector('ele')?.textContent;return isFinite(ele)?[lon,lat,ele]:[lon,lat];}).filter(p=>isFinite(p[0])&&isFinite(p[1]));if(coords.length<2)throw new Error('Keine GPX-Strecke gefunden.');const f={type:'Feature',properties:{'track-length':String(Math.round(routeDistance(coords)))},geometry:{type:'LineString',coordinates:coords}};applyRoute(f,{imported:true,bikeType:$('#bikeType').value});$('#routeStatus').textContent='GPX-Route importiert. Sprach-Abbiegehinweise sind bei importierten GPX-Dateien nicht enthalten.';toast('GPX importiert.');}catch(e){toast(e.message,4500);}
}

function shareState(){
  const state={v:2,bike:APP.routeMeta?.bikeType||$('#bikeType').value,round:$('#roundTrip').checked,start:APP.points.start,end:APP.points.end,vias:APP.points.vias.filter(Boolean),labels:APP.labels,mode:$('#routeMode').value,opts:{unsafe:$('#avoidUnsafe').checked,hills:$('#avoidHills').checked,ferries:$('#avoidFerries').checked},roundKm:+$('#roundKm').value||40,roundDir:+$('#roundDirection').value||0};const json=JSON.stringify(state);return btoa(unescape(encodeURIComponent(json))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function shareUrl(){const u=new URL(location.href);u.search='';u.searchParams.set('tour',shareState());return u.toString();}
async function shareRoute(){if(!APP.route)return toast('Keine Route vorhanden.');const url=shareUrl();try{if(navigator.share)await navigator.share({title:'TourScout Route',text:'Meine TourScout-Fahrradroute',url});else{await navigator.clipboard.writeText(url);toast('Tour-Link kopiert.');}}catch(e){if(e.name!=='AbortError')toast('Teilen nicht möglich.');}}
function showQr(){if(!APP.route)return toast('Keine Route vorhanden.');const url=shareUrl();openModal(`<h2>Tour teilen</h2><p class="muted">Der QR-Code enthält Start, Ziel, Zwischenpunkte und Routeneinstellungen. Auf dem Zielgerät wird die Strecke neu berechnet.</p><div id="qrCode"></div><div class="copyBox"><input id="shareLink" class="field" readonly value="${esc(url)}"><button id="copyShare" class="secondaryButton">Kopieren</button></div>`);if(typeof QRCode!=='undefined')new QRCode($('#qrCode'),{text:url,width:220,height:220,correctLevel:QRCode.CorrectLevel.M});else $('#qrCode').innerHTML='<p>QR-Bibliothek nicht geladen. Der Link kann trotzdem kopiert werden.</p>';$('#copyShare').onclick=async()=>{await navigator.clipboard.writeText(url);toast('Link kopiert.');};}
function loadSharedState(){
  const raw=new URL(location.href).searchParams.get('tour');if(!raw)return;try{const json=decodeURIComponent(escape(atob(raw.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(raw.length/4)*4,'=')))),s=JSON.parse(json);if(s.bike)$('#bikeType').value=s.bike;if(s.mode)$('#routeMode').value=s.mode;$('#roundTrip').checked=!!s.round;$('#roundKm').value=s.roundKm||40;$('#roundDirection').value=String(s.roundDir||0);if(s.opts){$('#avoidUnsafe').checked=!!s.opts.unsafe;$('#avoidHills').checked=!!s.opts.hills;$('#avoidFerries').checked=!!s.opts.ferries;}if(s.start)setPickedPoint('start',s.start,s.labels?.start||'Geteilter Start');if(s.end)setPickedPoint('end',s.end,s.labels?.end||'Geteiltes Ziel');if(Array.isArray(s.vias))for(const [i,p] of s.vias.entries()){addVia();setPickedPoint(`via${i}`,p,s.labels?.vias?.[i]||`Zwischenpunkt ${i+1}`);}toggleRoundTrip();toast('Geteilte Tour geladen – jetzt Route berechnen.',4500);}catch(e){console.warn('Invalid shared route',e);}
}

function stagePointByDistance(coords,target){let acc=0;for(let i=0;i<coords.length-1;i++){const d=hav(coords[i],coords[i+1]);if(acc+d>=target){const f=(target-acc)/Math.max(1,d);return [coords[i][0]+(coords[i+1][0]-coords[i][0])*f,coords[i][1]+(coords[i+1][1]-coords[i][1])*f];}acc+=d;}return coords[coords.length-1];}
function stagePoiQuery(points,r){const parts=[];for(const [lon,lat] of points){if($('#packingCamp').checked)parts.push(`nwr(around:${r},${lat},${lon})[tourism~"camp_site|caravan_site"]`);if($('#packingCharge').checked){parts.push(`nwr(around:${r},${lat},${lon})[amenity="charging_station"][bicycle~"yes|designated"]`);parts.push(`nwr(around:${r},${lat},${lon})["service:bicycle:charging"~"yes|free|fee|only"]`);}}return `[out:json][timeout:35];(${parts.map(x=>x+';').join('')});out center tags 260;`;}
async function buildStages(){
  if(!APP.route)return toast('Bitte zuerst eine Route planen.');const btn=$('#buildStagesBtn');btn.disabled=true;btn.textContent='Erstelle …';$('#stageResults').innerHTML='';$('#stageStatus').textContent='Etappen werden berechnet …';
  try{const coords=APP.route.geometry.coordinates,total=routeStats().distance,mode=$('#stageMode').value;let days=mode==='days'?clamp(+$('#days').value||3,2,21):clamp(Math.ceil(total/(Math.max(20,+$('#dailyKm').value||70)*1000)),2,21);const targets=[];for(let d=1;d<days;d++)targets.push(stagePointByDistance(coords,total*d/days));
    let pois=[];if(targets.length&&($('#packingCamp').checked||$('#packingCharge').checked)){try{const data=await overpass(stagePoiQuery(targets,+$('#stageRadius').value||5000));pois=(data.elements||[]).map(x=>{const c=poiCoord(x);if(!c)return null;const t=x.tags||{},kind=(t.tourism==='camp_site'||t.tourism==='caravan_site')?'camp':'charge';return {coord:c,kind,name:poiName(t,kind)};}).filter(Boolean);}catch(e){console.warn(e);}}
    const box=$('#stageResults');for(let d=1;d<=days;d++){const end=d<days?targets[d-1]:coords[coords.length-1],prev=d===1?coords[0]:targets[d-2],km=total/days/1000;let camp=null,charge=null;if(d<days){for(const p of pois){const dist=hav(end,p.coord);if(p.kind==='camp'&&(!camp||dist<camp.dist))camp={...p,dist};if(p.kind==='charge'&&(!charge||dist<charge.dist))charge={...p,dist};}}
      const card=document.createElement('div');card.className='resultCard';card.innerHTML=`<h3>Tag ${d} · ca. ${km.toFixed(0)} km</h3><p>${d<days?`Etappenziel${camp?` · 🏕️ ${esc(camp.name)} (${fmtKm(camp.dist)})`:$('#packingCamp').checked?' · kein Camping im Suchradius':''}${charge?` · 🔌 ${esc(charge.name)} (${fmtKm(charge.dist)})`:$('#packingCharge').checked?' · kein Ladepunkt im Suchradius':''}`:'Ziel der Gesamttour'}</p><div class="resultActions"><button data-act="map">Etappenziel zeigen</button></div>`;card._coord=end;box.appendChild(card);}
    box.onclick=e=>{const c=e.target.closest('.resultCard');if(c?._coord)APP.map.flyTo({center:c._coord,zoom:13});};$('#stageStatus').textContent=`${days} Etappen erstellt.`;
  }catch(e){$('#stageStatus').textContent=e.message;toast(e.message,4500);}finally{btn.disabled=false;btn.textContent='Etappen erstellen';}
}

function commandText(cmd,exitNo=0){return ({1:'Geradeaus weiter',2:'Links abbiegen',3:'Leicht links abbiegen',4:'Scharf links abbiegen',5:'Rechts abbiegen',6:'Leicht rechts abbiegen',7:'Scharf rechts abbiegen',8:'Links halten',9:'Rechts halten',10:'Wenden',11:'Wenden',12:'Route verlassen',13:`Im Kreisverkehr Ausfahrt ${exitNo||1} nehmen`,14:`Im Kreisverkehr Ausfahrt ${Math.abs(exitNo)||1} nehmen`,15:'Wenden',16:'Luftlinie folgen',17:'Links abfahren',18:'Rechts abfahren',100:'Ziel erreicht'})[cmd]||'Dem Weg folgen';}
function commandArrow(cmd){return ({1:'↑',2:'←',3:'↖',4:'↰',5:'→',6:'↗',7:'↱',8:'↖',9:'↗',10:'↶',11:'↷',12:'⚠',13:'⟳',14:'⟲',15:'↶',17:'←',18:'→',100:'✓'})[cmd]||'↑';}
function say(text){if(!APP.nav.voice||!('speechSynthesis'in window))return;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='de-DE';u.rate=1.02;const de=speechSynthesis.getVoices().find(v=>v.lang?.toLowerCase().startsWith('de'));if(de)u.voice=de;speechSynthesis.speak(u);}
async function requestWakeLock(){try{if('wakeLock'in navigator)APP.nav.wakeLock=await navigator.wakeLock.request('screen');}catch(e){console.warn(e);}}
async function startNavigation(){if(!APP.route)return toast('Zuerst eine Route berechnen oder GPX importieren.');if(!navigator.geolocation)return toast('GPS wird von diesem Browser nicht unterstützt.');$('#navOverlay').classList.remove('hidden');document.body.classList.add('navigating');APP.nav.lastHint=-1;APP.nav.follow=true;await requestWakeLock();say('Navigation gestartet. Gute Fahrt.');APP.nav.watchId=navigator.geolocation.watchPosition(updateNav,e=>toast(`GPS: ${e.message}`,4500),{enableHighAccuracy:true,maximumAge:1000,timeout:15000});}
function stopNavigation(){if(APP.nav.watchId!=null)navigator.geolocation.clearWatch(APP.nav.watchId);APP.nav.watchId=null;APP.nav.wakeLock?.release?.().catch(()=>{});APP.nav.wakeLock=null;$('#navOverlay').classList.add('hidden');$('#offRouteBanner').classList.add('hidden');document.body.classList.remove('navigating');window.speechSynthesis?.cancel();setTimeout(()=>APP.map?.resize(),150);}
async function rerouteFromCurrent(p){if(!$('#autoReroute').checked||Date.now()-APP.nav.lastReroute<20000||APP.routeMeta?.imported)return;APP.nav.lastReroute=Date.now();$('#offRouteBanner').classList.remove('hidden');try{const end=APP.points.end||APP.route.geometry.coordinates.at(-1),res=await requestBrouter([p,end],APP.routeMeta?.bikeType||$('#bikeType').value);applyRoute(res.feature,{...APP.routeMeta,profile:res.profile,rerouted:true},false);say('Route wurde neu berechnet.');}catch(e){console.warn(e);}finally{setTimeout(()=>$('#offRouteBanner').classList.add('hidden'),1800);}}
function updateNav(pos){
  const p=[pos.coords.longitude,pos.coords.latitude];APP.nav.lastPos=p;if(!APP.nav.marker){const el=document.createElement('div');el.className='nav-position';APP.nav.marker=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat(p).addTo(APP.map);}else APP.nav.marker.setLngLat(p);const coords=APP.route.geometry.coordinates,near=nearestIndex(coords,p);if(APP.nav.follow)APP.map.easeTo({center:p,zoom:16,bearing:isFinite(pos.coords.heading)?pos.coords.heading:0,duration:650});if(near.distance>95)rerouteFromCurrent(p);
  let remain=0;for(let i=near.index;i<coords.length-1;i++)remain+=hav(coords[i],coords[i+1]);const stats=routeStats();$('#navRemain').textContent=fmtKm(remain);$('#navEta').textContent=fmtTime(stats.distance?stats.time*(remain/stats.distance):0);$('#navSpeed').textContent=`${Math.round(Math.max(0,pos.coords.speed||0)*3.6)} km/h`;
  const hints=APP.route.properties?.voicehints||[];let next=null,nextIdx=-1;for(let i=0;i<hints.length;i++){if(+hints[i][0]>=near.index){next=hints[i];nextIdx=i;break;}}
  if(!next){$('#navDistance').textContent=fmtKm(remain);$('#navText').textContent=remain<45?'Ziel erreicht':'Dem Weg folgen';$('#navArrow').textContent=remain<45?'✓':'↑';if(remain<45&&APP.nav.lastHint!==9999){say('Du hast dein Ziel erreicht.');APP.nav.lastHint=9999;}return;}
  const hc=coords[+next[0]],d=hav(p,hc),cmd=+next[1],exit=+next[2];$('#navDistance').textContent=d<25?'Jetzt':`In ${fmtKm(d)}`;$('#navText').textContent=commandText(cmd,exit);$('#navArrow').textContent=commandArrow(cmd);if(nextIdx!==APP.nav.lastHint&&d<160){say(`${d<35?'Jetzt':'In '+Math.round(d/10)*10+' Metern'} ${commandText(cmd,exit).toLowerCase()}.`);APP.nav.lastHint=nextIdx;}
}

function locate(setStart=false){return new Promise((resolve,reject)=>{if(!navigator.geolocation){toast('Standortzugriff nicht unterstützt.');reject(new Error('Kein GPS'));return;}navigator.geolocation.getCurrentPosition(p=>{const c=[p.coords.longitude,p.coords.latitude];APP.nav.lastPos=c;APP.map.flyTo({center:c,zoom:14});if(setStart)setPickedPoint('start',c,'Mein Standort');resolve(c);},e=>{toast(`Standort nicht verfügbar: ${e.message}`,4500);reject(e);},{enableHighAccuracy:true,timeout:12000});});}

function addVia(){const i=APP.points.vias.length;APP.points.vias.push(null);APP.labels.vias.push('');const row=document.createElement('div');row.className='waypointRow';row.dataset.rowIndex=i;row.innerHTML=`<span class="dot viaDot"></span><input class="field" data-via-index="${i}" placeholder="Zwischenpunkt"><button class="smallButton" data-via-pick="${i}">Karte</button>`;$('#viaList').appendChild(row);}
function swapPoints(){[APP.points.start,APP.points.end]=[APP.points.end,APP.points.start];[APP.labels.start,APP.labels.end]=[APP.labels.end,APP.labels.start];const a=$('#startInput').value;$('#startInput').value=$('#endInput').value;$('#endInput').value=a;if(APP.points.start)setMarker('start',APP.points.start);if(APP.points.end)setMarker('end',APP.points.end);}
function clearRoute(){APP.route=null;APP.routeMeta=null;if(APP.map?.getSource('route'))APP.map.getSource('route').setData({type:'Feature',geometry:{type:'LineString',coordinates:[]},properties:{}});for(const k of ['start','end'])clearPoint(k);for(const m of APP.markers.vias)m?.remove();APP.points.vias=[];APP.labels.vias=[];APP.markers.vias=[];$('#viaList').innerHTML='';$('#startInput').value='';$('#endInput').value='';$('#routeSummary').classList.add('hidden');$('#routeStatus').textContent='Noch keine Route berechnet.';clearPois('camp');clearPois('charge');}
function toggleRoundTrip(){const on=$('#roundTrip').checked;$('#roundTripBox').classList.toggle('hidden',!on);$('#normalRouteBox').classList.toggle('roundActive',on);$('#endInput').disabled=on;$('#addViaBtn').disabled=on;$('#swapBtn').disabled=on;if(on&&APP.points.start)$('#routeStatus').textContent='Rundtour: Startpunkt und gewünschte Länge wählen.';}
function toggleEbikeOptions(){const bike=BIKE[$('#bikeType').value];$('#ebikeOptions').classList.toggle('hidden',!bike?.ebike);updateRangePreview();if(APP.route)updateRouteSummary();}
function showPanel(id){$$('.panel').forEach(p=>p.classList.toggle('activePanel',p.id===id));$$('[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel===id));if(id==='savedPanel')renderSaved();}

function openModal(html){$('#modalContent').innerHTML=html;$('#modal').classList.remove('hidden');}
function closeModal(){$('#modal').classList.add('hidden');$('#modalContent').innerHTML='';}
function showAbout(){openModal(`<h2>TourScout</h2><p>TourScout nutzt frei nutzbare/Open-Source-Komponenten und kostenlose öffentliche Open-Data-Dienste. Es sind keine kostenpflichtigen API-Schlüssel notwendig.</p><p><b>Karte:</b> OpenFreeMap / MapLibre, Kartendaten © OpenStreetMap-Mitwirkende (ODbL).<br><b>Routing:</b> BRouter (GPLv3), Kartendaten OpenStreetMap.<br><b>Orts- & POI-Suche:</b> Nominatim / Overpass auf Basis von OpenStreetMap.<br><b>QR-Code:</b> QRCode.js (MIT).<br><b>Aufrufzähler:</b> lokal im Browser, ohne externes Tracking.</p><p class="muted">Öffentliche Karten-, Routing- und Suchserver können Fair-Use-Grenzen haben oder zeitweise nicht erreichbar sein. Ein gemeinsamer weltweiter Aufrufzähler wäre bei einer rein statischen GitHub-Pages-App nur mit einem zusätzlichen schreibbaren Backend möglich.</p>`);}

function initCounter(){
  const local=+(localStorage.getItem('tourscout_local_views')||0)+1;localStorage.setItem('tourscout_local_views',String(local));$('#globalVisitCount').textContent=local.toLocaleString('de-DE');$('#counterNote').textContent='Lokaler Aufrufzähler auf diesem Gerät – ohne Trackingdienst.';
}

function initEvents(){
  $$('.navItem,.bottomNav button').forEach(b=>b.addEventListener('click',()=>showPanel(b.dataset.panel)));
  $('#menuBtn').onclick=()=>$('#sidebar').classList.toggle('open');
  $$('[data-point]').forEach(b=>b.onclick=()=>{APP.pickMode=b.dataset.point;$('#clickHint').classList.remove('hidden');if(innerWidth<=820)$('#sidebar').classList.remove('open');});
  $('#viaList').addEventListener('click',e=>{const b=e.target.closest('[data-via-pick]');if(!b)return;APP.pickMode=`via${b.dataset.viaPick}`;$('#clickHint').classList.remove('hidden');if(innerWidth<=820)$('#sidebar').classList.remove('open');});
  $('#viaList').addEventListener('input',e=>{const i=e.target.closest('[data-via-index]');if(!i)return;const n=+i.dataset.viaIndex;APP.points.vias[n]=null;APP.labels.vias[n]=i.value;if(APP.markers.vias[n]){APP.markers.vias[n].remove();APP.markers.vias[n]=null;}});
  ['start','end'].forEach(type=>$(`#${type}Input`).addEventListener('input',e=>{clearPoint(type);APP.labels[type]=e.target.value;}));
  $('#cancelPick').onclick=()=>{APP.pickMode=null;$('#clickHint').classList.add('hidden');};
  $('#addViaBtn').onclick=addVia;$('#swapBtn').onclick=swapPoints;$('#clearRouteBtn').onclick=clearRoute;$('#startHereBtn').onclick=()=>locate(true).catch(()=>{});$('#locateBtn').onclick=()=>locate(false).catch(()=>{});$('#planBtn').onclick=planRoute;$('#fitRouteBtn').onclick=fitRoute;
  $('#roundTrip').onchange=toggleRoundTrip;$('#bikeType').onchange=toggleEbikeOptions;['batteryWh','whPerKm','batteryReserve'].forEach(id=>$(`#${id}`).oninput=()=>{updateRangePreview();if(APP.route)updateRouteSummary();});
  $('#showCamping').onchange=()=>{$('#campBtn').classList.toggle('active',$('#showCamping').checked);loadUtilityPois(true);};$('#showCharging').onchange=()=>{$('#chargeBtn').classList.toggle('active',$('#showCharging').checked);loadUtilityPois(true);};$('#poiCorridor').onchange=()=>loadUtilityPois(true);
  $('#campBtn').onclick=()=>{$('#showCamping').checked=!$('#showCamping').checked;$('#campBtn').classList.toggle('active',$('#showCamping').checked);loadUtilityPois(true);};$('#chargeBtn').onclick=()=>{$('#showCharging').checked=!$('#showCharging').checked;$('#chargeBtn').classList.toggle('active',$('#showCharging').checked);loadUtilityPois(true);};
  $('#startNavBtn').onclick=startNavigation;$('#stopNavBtn').onclick=stopNavigation;$('#centerNavBtn').onclick=()=>{APP.nav.follow=true;if(APP.nav.lastPos)APP.map.flyTo({center:APP.nav.lastPos,zoom:16});};$('#voiceBtn').onclick=()=>{APP.nav.voice=!APP.nav.voice;$('#voiceBtn').classList.toggle('active',APP.nav.voice);$('#voiceBtn').textContent=APP.nav.voice?'🔊':'🔇';if(APP.nav.voice)say('Sprachausgabe eingeschaltet.');};
  $('#saveRouteBtn').onclick=saveCurrentRoute;$('#gpxBtn').onclick=downloadGpx;$('#gpxImport').onchange=e=>{const f=e.target.files?.[0];if(f)importGpx(f);e.target.value='';};$('#shareRouteBtn').onclick=shareRoute;$('#qrRouteBtn').onclick=showQr;
  $('#themeBtn').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem('tourscout_dark',document.body.classList.contains('dark')?'1':'0');};
  $$('#weatherSegment button').forEach(b=>b.onclick=()=>{$$('#weatherSegment button').forEach(x=>x.classList.remove('active'));b.classList.add('active');APP.weather=b.dataset.weather;});
  $$('#audienceSegment button').forEach(b=>b.onclick=()=>{$$('#audienceSegment button').forEach(x=>x.classList.remove('active'));b.classList.add('active');APP.audience=b.dataset.audience;});
  $$('#categoryChips button').forEach(b=>b.onclick=()=>{b.classList.toggle('active');b.classList.contains('active')?APP.categories.add(b.dataset.cat):APP.categories.delete(b.dataset.cat);});
  $('#radius').oninput=e=>$('#radiusValue').textContent=e.target.value;$('#discoverBtn').onclick=discover;$('#discoverCenterBtn').onclick=async()=>{try{await resolveDiscoverCenter();toast('Suchzentrum gesetzt.');}catch(e){toast(e.message);}};$('#discoverHereBtn').onclick=async()=>{try{const c=await locate(false);APP.discoverCenter=c;$('#discoverCenter').value='';$('#discoverCenterLabel').textContent='Suchzentrum: Mein Standort';}catch{}};
  $('#stageMode').onchange=()=>{$('#daysGroup').classList.toggle('hidden',$('#stageMode').value!=='days');$('#dailyKmGroup').classList.toggle('hidden',$('#stageMode').value!=='km');};$('#buildStagesBtn').onclick=buildStages;
  $$('#savedTabs button').forEach(b=>b.onclick=()=>{$$('#savedTabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');APP.savedTab=b.dataset.saved;renderSaved();});
  $('#modalClose').onclick=closeModal;$('#modal').onclick=e=>{if(e.target===$('#modal'))closeModal();};$('#aboutBtn').onclick=showAbout;
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){APP.map?.resize();if(document.body.classList.contains('navigating')&&!APP.nav.wakeLock)requestWakeLock();}});window.addEventListener('orientationchange',()=>setTimeout(()=>APP.map?.resize(),250));window.addEventListener('resize',()=>setTimeout(()=>APP.map?.resize(),100));
}

function init(){
  if(localStorage.getItem('tourscout_dark')==='1'||(!localStorage.getItem('tourscout_dark')&&matchMedia('(prefers-color-scheme: dark)').matches))document.body.classList.add('dark');
  initMap();initEvents();toggleRoundTrip();toggleEbikeOptions();updateRangePreview();renderSaved();initCounter();
  if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./service-worker.js').catch(console.warn);
  APP.map?.once('load',loadSharedState);
}

init();
})();
