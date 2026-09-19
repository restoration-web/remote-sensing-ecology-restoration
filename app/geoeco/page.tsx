'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import styles from './page.module.css';

type AOI={name:string;featureCount:number;geometry:any}|null;
type LegendItem={class:number;label:string;color:string;min:number|null;max:number|null};
type MapResult={
 status:string;note?:string;layer?:string;imageUrl?:string;bounds?:[[number,number],[number,number]];
 legend?:LegendItem[];stats?:{mean?:number;stdDev?:number;thresholds?:number[]};
 classArea?:Array<{class:number;areaHa:number}>;
 methodology?:any;provenance?:any;
};
type FireResult={
 status:string;note?:string;source?:string;points?:any[];daily?:any[];summary?:any;
 goldenTime?:any;spreadProxy?:any;vegetationContext?:any;provenance?:any;scientificNote?:string;
};
const basemaps:any={
 OSM:{name:'OpenStreetMap',url:'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',attribution:'© OpenStreetMap contributors'},
 Satellite:{name:'Esri Satellite',url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',attribution:'Tiles © Esri'},
 Topo:{name:'OpenTopoMap',url:'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',attribution:'© OpenTopoMap'},
 Light:{name:'Carto Light',url:'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',attribution:'© OpenStreetMap © CARTO'}
};

async function safeJson(res:Response){
 const text=await res.text();
 try{return JSON.parse(text)}
 catch{
  return {status:'error',note:'Server returned non-JSON response (HTTP '+res.status+'). '+text.slice(0,180).replace(/<[^>]*>/g,' ')};
 }
}
async function fetchJsonWithRetry(url:string,options:RequestInit,attempts=3){
 let last:any={status:'error',note:'Request failed'};
 for(let i=0;i<attempts;i++){
  try{
   const res=await fetch(url,options);
   const data=await safeJson(res);
   if(res.ok&&data?.status!=='error') return data;
   last=data;
   if(res.status<500) return data;
  }catch(e:any){last={status:'error',note:e?.message||String(e)}}
  await new Promise(r=>setTimeout(r,800*(i+1)));
 }
 return last;
}

const layers=[
 {id:'NDVI',name:'NDVI',group:'Vegetation',desc:'Vegetation greenness',active:true},
 {id:'NDRE',name:'NDRE',group:'Vegetation',desc:'Red-edge vegetation response',active:true},
 {id:'NDWI',name:'NDWI',group:'Water',desc:'Surface-water spectral response',active:true},
 {id:'NDMI',name:'NDMI',group:'Moisture',desc:'Vegetation/canopy moisture response',active:true},
 {id:'BSI',name:'BSI',group:'Land Condition',desc:'Bare-soil-like spectral response',active:true},
 {id:'LST',name:'LST',group:'Thermal',desc:'Land Surface Temperature',active:true},
 {id:'EROSION',name:'Erosion Susceptibility',group:'Land Degradation',desc:'Relative screening model',active:true},
 {id:'FLOOD',name:'Flood Susceptibility',group:'Disaster',desc:'Relative screening model',active:true},
 {id:'LANDSLIDE',name:'Landslide Susceptibility',group:'Disaster',desc:'Relative screening model',active:true},
];

export default function GeoEco(){
 const [tab,setTab]=useState('Analysis');
 const [aoi,setAoi]=useState<AOI>(null);
 const [start,setStart]=useState('2024-01-01');
 const [end,setEnd]=useState('2026-09-19');
 const [layer,setLayer]=useState('NDVI');
 const [result,setResult]=useState<MapResult|null>(null);
 const [running,setRunning]=useState(false);
 const [perspective,setPerspective]=useState(false);
 const [temporal,setTemporal]=useState<any>(null);
 const [fire,setFire]=useState<FireResult|null>(null);
 const [fireRunning,setFireRunning]=useState(false);
 const [basemap,setBasemap]=useState('OSM');
 const [showAOI,setShowAOI]=useState(true);
 const [showRaster,setShowRaster]=useState(true);
 const [showHotspots,setShowHotspots]=useState(true);
 const [rasterOpacity,setRasterOpacity]=useState(.88);
 const selected=useMemo(()=>layers.find(x=>x.id===layer)!,[layer]);

 async function runFire(){
  if(!aoi?.geometry){setFire({status:'error',note:'Upload AOI before hotspot analysis.'});return;}
  setFireRunning(true);setFire({status:'running',note:'Loading NASA FIRMS / VIIRS hotspots…'});
  const data=await fetchJsonWithRetry('/api/geoeco_engine',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({action:'fire',aoi:aoi.geometry,end,days:7,responseWindowMinutes:60})
  },3);
  setFire(data);setFireRunning(false);
 }

 async function run(target=layer){
   if(!aoi?.geometry){setResult({status:'error',note:'Upload GeoJSON or zipped Shapefile before running analysis.'});return;}
   setLayer(target);setRunning(true);setResult({status:'running',note:'Processing '+target+' in Google Earth Engine…'});
   try{
     setTemporal({status:'running',note:'Waiting for map result before spatial statistics…'});
     const data=await fetchJsonWithRetry('/api/geoeco_engine',{
       method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({action:'map',aoi:aoi.geometry,start,end,layer:target})
     },3);
     setResult(data);
     if(data?.status!=='success'){
       setTemporal({status:'error',note:'Statistics were not started because map generation failed.'});
       return;
     }
     const timeData=await fetchJsonWithRetry('/api/geoeco/temporal',{
       method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({action:'stats',start,end,aoi:aoi.geometry,aoiName:aoi.name})
     },3);
     setTemporal(timeData);
   }catch(e:any){
     const note=e?.message||String(e);
     setResult({status:'error',note});
     setTemporal({status:'error',note});
   }finally{setRunning(false)}
 }

 return <main className={styles.shell}>
  <aside className={styles.sidebar}>
   <div><div className={styles.brand}>GeoEco AI</div><div className={styles.tag}>Geospatial Environmental Intelligence</div></div>
   <nav className={styles.nav}>{['Dashboard','Analysis','Statistics & Models','Fire Intelligence','Scientific Library','Help'].map(x=><button key={x} className={tab===x?styles.active:''} onClick={()=>setTab(x)}>{x}</button>)}</nav>
   <div className={styles.sideFoot}>Engine v1.2<br/><span>Classified maps + provenance</span></div>
  </aside>

  <section className={styles.content}>
   <header className={styles.header}>
    <div><div className={styles.kicker}>SCIENTIFIC WEB-GIS</div><h1>{tab}</h1><p>Classified thematic maps, legends, class-area statistics, transparent model assumptions, and reproducible provenance.</p></div>
    <div className={styles.actions}>{tab==='Analysis'&&<button className={styles.secondary} onClick={()=>setPerspective(v=>!v)}>{perspective?'2D View':'Perspective View'}</button>}{tab==='Fire Intelligence'?<button disabled={fireRunning} onClick={runFire}>{fireRunning?'Loading FIRMS…':'Analyze Hotspots'}</button>:<button disabled={running} onClick={()=>run()}>{running?'Running…':tab==='Statistics & Models'?'Run Full Analysis':'Run '+selected.name}</button>}</div>
   </header>

   {tab==='Dashboard'&&<Dashboard result={result} selected={selected}/>}
   {tab==='Analysis'&&<AnalysisWorkspace aoi={aoi} setAoi={setAoi} start={start} setStart={setStart} end={end} setEnd={setEnd} layer={layer} setLayer={setLayer} result={result} temporal={temporal} run={run} running={running} perspective={perspective} basemap={basemap} setBasemap={setBasemap} showAOI={showAOI} setShowAOI={setShowAOI} showRaster={showRaster} setShowRaster={setShowRaster} showHotspots={showHotspots} setShowHotspots={setShowHotspots} rasterOpacity={rasterOpacity} setRasterOpacity={setRasterOpacity} fire={fire}/>}
   {tab==='Statistics & Models'&&<StatisticsPage temporal={temporal} aoi={aoi} start={start} end={end} run={run} running={running}/>}
   {tab==='Fire Intelligence'&&<FirePage aoi={aoi} fire={fire} runFire={runFire} fireRunning={fireRunning} result={result} basemap={basemap} setBasemap={setBasemap} showAOI={showAOI} setShowAOI={setShowAOI} showRaster={showRaster} setShowRaster={setShowRaster} showHotspots={showHotspots} setShowHotspots={setShowHotspots} rasterOpacity={rasterOpacity} setRasterOpacity={setRasterOpacity}/>}
   {tab==='Scientific Library'&&<ScientificLibrary layer={layer} setLayer={setLayer}/>}
   {tab==='Help'&&<Help/>}
  </section>
 </main>
}

function Dashboard({result,selected}:any){
 return <div className={styles.stack}>
  <div className={styles.metrics}>
   <Metric label="Active layer" value={selected.name}/>
   <Metric label="Status" value={result?.status||'Ready'}/>
   <Metric label="Classes" value={String(result?.legend?.length||5)}/>
   <Metric label="Engine" value="GEE 1.2"/>
  </div>
  <div className={styles.grid2}>
   <section className={styles.card}><h2>Scientific output standard</h2><ul className={styles.checks}><li>Every map has explicit class thresholds and legend.</li><li>Every class reports area in hectares.</li><li>Statistics are calculated from the same raster shown on the map.</li><li>Method version, datasets, dates and analysis scale are stored in provenance.</li><li>Susceptibility classes are not presented as event probabilities.</li></ul></section>
   <section className={styles.card}><h2>Current result</h2>{result?.status==='success'?<Stats result={result}/>:<div className={styles.empty}>Run an analysis to populate real results.</div>}</section>
  </div>
 </div>
}

function AnalysisWorkspace(props:any){
 const {aoi,setAoi,start,setStart,end,setEnd,layer,setLayer,result,temporal,run,running,perspective,basemap,setBasemap,showAOI,setShowAOI,showRaster,setShowRaster,showHotspots,setShowHotspots,rasterOpacity,setRasterOpacity,fire}=props;
 return <div className={styles.analysisLayout}>
  <section className={styles.controlBar}>
   <AOIUploader aoi={aoi} setAoi={setAoi}/>
   <label className={styles.compactLabel}>Start<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
   <label className={styles.compactLabel}>End<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
  </section>
  <MapDisplayControls basemap={basemap} setBasemap={setBasemap} showAOI={showAOI} setShowAOI={setShowAOI} showRaster={showRaster} setShowRaster={setShowRaster} showHotspots={showHotspots} setShowHotspots={setShowHotspots} rasterOpacity={rasterOpacity} setRasterOpacity={setRasterOpacity}/>

  <div className={styles.layerTabs}>{layers.map(x=><button key={x.id} className={layer===x.id?styles.layerActive:''} onClick={()=>setLayer(x.id)}><b>{x.name}</b><span>{x.group}</span></button>)}</div>

  <section className={styles.mapResultCard}>
   <div className={styles.mapTitleRow}><div><h2>{layers.find((x:any)=>x.id===layer)?.name}</h2><p>{layers.find((x:any)=>x.id===layer)?.desc}</p></div><button disabled={running} onClick={()=>run(layer)}>{running?'Processing…':'Generate Map'}</button></div>
   <GeoMap aoi={aoi} result={result?.layer===layer?result:null} perspective={perspective} basemap={basemap} showAOI={showAOI} showRaster={showRaster} rasterOpacity={rasterOpacity} hotspots={showHotspots?(fire?.points||[]):[]}/>
   {result?.status==='running'&&<div className={styles.processing}>{result.note}</div>}
   {result?.status==='error'&&<div className={styles.errorBox}>{result.note}</div>}
  </section>

  {result?.status==='success'&&result.layer===layer&&<>
   <div className={styles.grid2}>
    <section className={styles.card}><h2>Legend & class area</h2><LegendArea result={result}/></section>
    <section className={styles.card}><h2>Raster statistics</h2><Stats result={result}/></section>
   </div>
   <div className={styles.grid2}>
    <section className={styles.card}><h2>Method & validation status</h2><Methodology result={result}/></section>
    <section className={styles.card}><h2>Reproducibility provenance</h2><Provenance result={result}/></section>
   </div>
  </>}
  {temporal?.status==='success'&&<TemporalDashboard temporal={temporal} aoi={aoi} start={start} end={end}/>}
  {temporal&&temporal.status!=='success'&&temporal.status!=='running'&&<div className={styles.errorBox}>Temporal statistics: {temporal.note||temporal.status}</div>}
 </div>
}


function MapDisplayControls({basemap,setBasemap,showAOI,setShowAOI,showRaster,setShowRaster,showHotspots,setShowHotspots,rasterOpacity,setRasterOpacity}:any){
 return <section className={styles.mapControls}>
  <label>Basemap<select value={basemap} onChange={e=>setBasemap(e.target.value)}>{Object.entries(basemaps).map(([k,v]:any)=><option key={k} value={k}>{v.name}</option>)}</select></label>
  <label className={styles.checkControl}><input type="checkbox" checked={showAOI} onChange={e=>setShowAOI(e.target.checked)}/> AOI boundary</label>
  <label className={styles.checkControl}><input type="checkbox" checked={showRaster} onChange={e=>setShowRaster(e.target.checked)}/> Analysis raster</label>
  <label className={styles.checkControl}><input type="checkbox" checked={showHotspots} onChange={e=>setShowHotspots(e.target.checked)}/> NASA hotspots</label>
  <label>Raster opacity<input type="range" min="0.25" max="1" step="0.05" value={rasterOpacity} onChange={e=>setRasterOpacity(Number(e.target.value))}/></label>
 </section>
}

function FirePage({aoi,fire,runFire,fireRunning,result,basemap,setBasemap,showAOI,setShowAOI,showRaster,setShowRaster,showHotspots,setShowHotspots,rasterOpacity,setRasterOpacity}:any){
 return <div className={styles.analysisLayout}>
  <MapDisplayControls basemap={basemap} setBasemap={setBasemap} showAOI={showAOI} setShowAOI={setShowAOI} showRaster={showRaster} setShowRaster={setShowRaster} showHotspots={showHotspots} setShowHotspots={setShowHotspots} rasterOpacity={rasterOpacity} setRasterOpacity={setRasterOpacity}/>
  <section className={styles.mapResultCard}>
   <div className={styles.mapTitleRow}><div><h2>NASA FIRMS Fire Intelligence</h2><p>VIIRS 375 m near-real-time active fire detections clipped to the uploaded AOI.</p></div><button disabled={fireRunning} onClick={runFire}>{fireRunning?'Loading…':'Refresh Hotspots'}</button></div>
   <GeoMap aoi={aoi} result={showRaster?result:null} perspective={false} basemap={basemap} showAOI={showAOI} showRaster={showRaster} rasterOpacity={rasterOpacity} hotspots={showHotspots?(fire?.points||[]):[]}/>
   {fire?.status==='error'&&<div className={styles.errorBox}>{fire.note}</div>}
  </section>
  {fire?.status==='success'&&<>
   <div className={styles.fireMetricGrid}>
    <Metric label="Hotspot pixels" value={String(fire.summary?.count??0)}/>
    <Metric label="Mean FRP" value={isFiniteValue(fire.summary?.frpMean)?nfmt(fire.summary.frpMean,1)+' MW':'NA'}/>
    <Metric label="Max FRP" value={isFiniteValue(fire.summary?.frpMax)?nfmt(fire.summary.frpMax,1)+' MW':'NA'}/>
    <Metric label="High confidence" value={String(fire.summary?.highConfidenceCount??0)}/>
   </div>
   <div className={styles.grid2}>
    <section className={styles.card}><h2>Vegetation context at hotspot pixels</h2><div className={styles.statsGrid}>
     <div><span>Mean NDVI</span><b>{nfmt(fire.vegetationContext?.NDVI_mean)}</b></div>
     <div><span>Mean NDMI</span><b>{nfmt(fire.vegetationContext?.NDMI_mean)}</b></div>
     <div><span>Mean BSI</span><b>{nfmt(fire.vegetationContext?.BSI_mean)}</b></div>
     <div><span>NDVI SD</span><b>{nfmt(fire.vegetationContext?.NDVI_stdDev)}</b></div>
    </div><div className={styles.notice}>This links fire detections to vegetation condition in the AOI. It is contextual association, not proof that an index caused ignition.</div></section>
    <section className={styles.card}><h2>Golden time & observed spread</h2>
     {fire.goldenTime?<div className={styles.kv}><div><span>Status</span><b>{fire.goldenTime.status}</b></div><div><span>Configured window</span><b>{fire.goldenTime.responseWindowMinutes} min</b></div><div><span>Elapsed since latest detection</span><b>{nfmt(fire.goldenTime.elapsedSinceLatestDetectionMinutes,0)} min</b></div></div>:<div className={styles.empty}>No recent detection.</div>}
     {fire.spreadProxy?.available?<div className={styles.kv}><div><span>Centroid displacement</span><b>{nfmt(fire.spreadProxy.distanceKm,2)} km</b></div><div><span>Elapsed</span><b>{nfmt(fire.spreadProxy.elapsedHours,1)} h</b></div><div><span>Observed spread proxy</span><b>{nfmt(fire.spreadProxy.centroidDisplacementKmPerHour,3)} km/h</b></div></div>:<div className={styles.notice}>{fire.spreadProxy?.note}</div>}
     <div className={styles.notice}>Golden time is a configurable operational response window. The spread value is a satellite-hotspot centroid displacement proxy, not physical flame-front rate of spread.</div>
    </section>
   </div>
   <section className={styles.card}><h2>Hotspot table</h2><div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr><th>Latitude</th><th>Longitude</th><th>FRP (MW)</th><th>Confidence</th><th>Brightness (K)</th><th>UTC epoch</th></tr></thead><tbody>{(fire.points||[]).slice(0,150).map((x:any,i:number)=><tr key={i}><td>{nfmt(x.lat,5)}</td><td>{nfmt(x.lon,5)}</td><td>{nfmt(x.frp,1)}</td><td>{x.confidence===2?'High':x.confidence===1?'Nominal':'Low'}</td><td>{nfmt(x.brightness,1)}</td><td>{x.epoch}</td></tr>)}</tbody></table></div><div className={styles.notice}>{fire.scientificNote}</div></section>
  </>}
 </div>
}

function GeoMap({aoi,result,perspective,basemap='OSM',showAOI=true,showRaster=true,rasterOpacity=.88,hotspots=[]}:{aoi:AOI;result:MapResult|null;perspective:boolean;basemap?:string;showAOI?:boolean;showRaster?:boolean;rasterOpacity?:number;hotspots?:any[]}){
 const el=useRef<HTMLDivElement>(null),mapRef=useRef<any>(null),aoiLayer=useRef<any>(null),imgLayer=useRef<any>(null),baseLayer=useRef<any>(null),hotspotLayer=useRef<any>(null);
 const [overlayState,setOverlayState]=useState<'idle'|'loading'|'loaded'|'error'>('idle');
 useEffect(()=>{let dead=false;(async()=>{if(!el.current||mapRef.current)return;const L=await import('leaflet');if(dead||!el.current)return;
  const map=L.map(el.current,{zoomControl:true}).setView([-2.2,115.5],6);
  const bm=basemaps[basemap]||basemaps.OSM;
  baseLayer.current=L.tileLayer(bm.url,{maxZoom:19,attribution:bm.attribution}).addTo(map);
  mapRef.current=map;setTimeout(()=>map.invalidateSize(),150);
 })();return()=>{dead=true;if(mapRef.current){mapRef.current.remove();mapRef.current=null}}},[]);
 useEffect(()=>{let dead=false;(async()=>{const map=mapRef.current;if(!map)return;const L=await import('leaflet');if(dead)return;if(baseLayer.current)map.removeLayer(baseLayer.current);const bm=basemaps[basemap]||basemaps.OSM;baseLayer.current=L.tileLayer(bm.url,{maxZoom:19,attribution:bm.attribution}).addTo(map);baseLayer.current.bringToBack?.();})();return()=>{dead=true}},[basemap]);
 useEffect(()=>{let dead=false;(async()=>{const map=mapRef.current;if(!map)return;const L=await import('leaflet');if(dead)return;
  if(aoiLayer.current){map.removeLayer(aoiLayer.current);aoiLayer.current=null}
  if(aoi?.geometry&&showAOI){const x=L.geoJSON(aoi.geometry,{style:{color:'#f7d154',weight:3,fillOpacity:0}}).addTo(map);aoiLayer.current=x;const b=x.getBounds();if(b.isValid())map.fitBounds(b.pad(.05),{maxZoom:14});}
 })();return()=>{dead=true}},[aoi,showAOI]);
 useEffect(()=>{let dead=false;(async()=>{const map=mapRef.current;if(!map)return;const L=await import('leaflet');if(dead)return;
  if(imgLayer.current){map.removeLayer(imgLayer.current);imgLayer.current=null}
  if(showRaster&&result?.imageUrl&&result.bounds){
    setOverlayState('loading');
    const overlay=L.imageOverlay(result.imageUrl,result.bounds,{opacity:rasterOpacity,interactive:false,className:'geoeco-result-overlay'});
    overlay.on('load',()=>setOverlayState('loaded'));
    overlay.on('error',()=>setOverlayState('error'));
    imgLayer.current=overlay.addTo(map);
    imgLayer.current.bringToFront?.();
    if(aoiLayer.current)aoiLayer.current.bringToFront?.();
    try{map.fitBounds(result.bounds,{padding:[16,16],maxZoom:14})}catch{}
  }else{
    setOverlayState('idle');
  }
 })();return()=>{dead=true}},[result,showRaster,rasterOpacity]);
 useEffect(()=>{let dead=false;(async()=>{const map=mapRef.current;if(!map)return;const L=await import('leaflet');if(dead)return;if(hotspotLayer.current){map.removeLayer(hotspotLayer.current);hotspotLayer.current=null}if(hotspots?.length){const g=L.layerGroup();hotspots.forEach((h:any)=>{const c=h.confidence>=2?'#d7191c':h.confidence>=1?'#fdae61':'#ffffbf';L.circleMarker([h.lat,h.lon],{radius:5,color:'#7f0000',weight:1,fillColor:c,fillOpacity:.9}).bindPopup('FRP: '+Number(h.frp||0).toFixed(1)+' MW<br/>Confidence: '+(h.confidence===2?'High':h.confidence===1?'Nominal':'Low')).addTo(g)});g.addTo(map);hotspotLayer.current=g}})();return()=>{dead=true}},[hotspots]);
 return <div className={perspective?styles.perspectiveFrame:styles.flatFrame}><div ref={el} className={styles.realMap}/>{result?.legend&&<div className={styles.floatingLegend}><b>{result.layer}</b>{result.legend.map(x=><div key={x.class}><i style={{background:x.color}}></i><span>{x.label}</span></div>)}</div>}<div className={styles.overlayStatus} data-state={overlayState}>{overlayState==='loaded'?'Raster loaded':overlayState==='loading'?'Loading raster…':overlayState==='error'?'Raster failed to load':'Base map only'}</div></div>
}

function LegendArea({result}:{result:MapResult}){
 const area=new Map((result.classArea||[]).map(x=>[Number(x.class),Number(x.areaHa)]));
 const max=Math.max(1,...Array.from(area.values()));
 return <div className={styles.legendArea}>{(result.legend||[]).map(x=>{const a=area.get(x.class)||0;return <div key={x.class} className={styles.legendRow}><div className={styles.legendName}><i style={{background:x.color}}></i><div><b>{x.label}</b><span>{rangeText(x,result)}</span></div></div><div className={styles.areaBar}><div style={{width:(a/max*100)+'%',background:x.color}}></div></div><strong>{a.toLocaleString(undefined,{maximumFractionDigits:1})} ha</strong></div>})}</div>
}
function rangeText(x:LegendItem,result:MapResult){
 const f=(n:number|null)=>n==null?'∞':Number(n).toFixed(result.layer==='LST'?2:3);
 if(x.min==null)return '≤ '+f(x.max);
 if(x.max==null)return '> '+f(x.min);
 return f(x.min)+' – '+f(x.max);
}
function Stats({result}:{result:MapResult}){return <div className={styles.statsGrid}><div><span>Mean</span><b>{fmt(result.stats?.mean)}</b></div><div><span>Standard deviation</span><b>{fmt(result.stats?.stdDev)}</b></div><div><span>Classification</span><b>{result.methodology?.classes||'—'}</b></div><div><span>Scale</span><b>{result.provenance?.scale?result.provenance.scale+' m':'—'}</b></div></div>}
function Methodology({result}:{result:MapResult}){const m=result.methodology||{};return <div className={styles.kv}><div><span>Model type</span><b>{m.type||'—'}</b></div><div><span>Classification</span><b>{m.classes||'—'}</b></div><div><span>Validation</span><b>{m.validation||'—'}</b></div>{m.weights&&<div><span>Weights</span><b>{Object.entries(m.weights).map(([k,v])=>k+' '+Math.round(Number(v)*100)+'%').join(' • ')}</b></div>}</div>}
function Provenance({result}:{result:MapResult}){const p=result.provenance||{};return <div className={styles.kv}>{Object.entries(p).map(([k,v])=><div key={k}><span>{k}</span><b>{String(v)}</b></div>)}</div>}

function AOIUploader({aoi,setAoi}:any){
 const [msg,setMsg]=useState('GeoJSON or zipped Shapefile');
 async function load(file?:File){if(!file)return;try{let geo:any;const n=file.name.toLowerCase();if(n.endsWith('.zip')){const shp=(await import('shpjs')).default;geo=await shp(await file.arrayBuffer());if(Array.isArray(geo))geo={type:'FeatureCollection',features:geo.flatMap((g:any)=>g?.features||[])}}else if(n.endsWith('.geojson')||n.endsWith('.json'))geo=JSON.parse(await file.text());else throw new Error('Use .geojson/.json or .zip');const fc=geo?.type==='FeatureCollection'?geo:{type:'FeatureCollection',features:geo?.type==='Feature'?[geo]:[]};if(!fc.features?.length)throw new Error('No valid features');setAoi({name:file.name,featureCount:fc.features.length,geometry:fc});setMsg(file.name+' • '+fc.features.length+' feature(s)')}catch(e:any){setAoi(null);setMsg(e?.message||'Failed')}}
 return <label className={styles.uploadCompact}><span>AOI</span><input type="file" accept=".zip,.geojson,.json" onChange={e=>load(e.target.files?.[0])}/><small>{aoi?msg:'Upload study boundary'}</small></label>
}



function StatisticsPage({temporal,aoi,start,end,run,running}:any){
 if(!aoi?.geometry){
  return <div className={styles.statsLanding}>
   <section className={styles.card}>
    <div className={styles.sectionHead}><div><h2>Statistics & Models</h2><p>Upload an AOI and run an analysis first. This page will then populate automatically from the same analysis object used for the maps.</p></div><span className={styles.pill}>Awaiting AOI</span></div>
    <div className={styles.statsFeatureGrid}>
     {['Descriptive statistics','Correlation matrix','Bivariate regression','Scatterplots','Distribution graphics','Model metrics','Sample data table','Reproducibility fingerprint'].map(x=><div key={x}><b>{x}</b><span>Generated from the declared AOI and period.</span></div>)}
    </div>
   </section>
  </div>
 }
 if(running||temporal?.status==='running'){
  return <div className={styles.processing}>Calculating spatial statistics and models for the selected AOI…</div>
 }
 if(!temporal||temporal.status!=='success'){
  return <div className={styles.statsLanding}>
   <section className={styles.card}>
    <div className={styles.sectionHead}><div><h2>Statistics & Models</h2><p>No completed statistical analysis is available yet for the current AOI.</p></div><button onClick={()=>run()}>Run Full Analysis</button></div>
    {temporal?.note&&<div className={styles.errorBox}>{temporal.note}</div>}
    <div className={styles.statsFeatureGrid}>
     {['NDVI–NDMI correlation','NDVI–BSI regression','NDVI–LST regression','NDVI–Rainfall relationship','NDMI–LST relationship','BSI–LST relationship','Descriptive statistics','Sample observation table'].map(x=><div key={x}><b>{x}</b><span>Available after processing.</span></div>)}
    </div>
   </section>
  </div>
 }
 return temporal?.mode==='spatial-sample'?<SpatialStatsDashboard data={temporal}/>:<TemporalDashboard temporal={temporal} aoi={aoi} start={start} end={end}/>
}


function SpatialStatsDashboard({data}:any){
 const rows=Array.isArray(data?.rows)?data.rows:[];
 const keys=(data?.variables||['NDVI','NDRE','NDWI','NDMI','EVI','SAVI','BSI','LST','Rainfall','Elevation','Slope']).filter((k:string)=>rows.some((r:any)=>isFiniteValue(r[k])));
 const desc=keys.map((k:string)=>({key:k,...describeRows(rows,k)}));
 const focus=[
  regression(rows,'NDRE','NDVI'),
  regression(rows,'NDMI','NDVI'),
  regression(rows,'BSI','NDVI'),
  regression(rows,'LST','NDVI'),
  regression(rows,'Rainfall','NDVI'),
  regression(rows,'LST','NDRE'),
  regression(rows,'LST','NDMI'),
  regression(rows,'LST','BSI'),
  regression(rows,'Slope','NDVI')
 ];
 const multi=multipleOLS(rows,'NDVI',['NDRE','NDMI','BSI','LST','Rainfall','Slope']);
 return <div className={styles.analyticsStack}>
  <div className={styles.metrics}>
   <Metric label="Analysis ID" value={data.analysisId||'—'}/>
   <Metric label="Samples" value={String(data.sampleCountReturned||rows.length)}/>
   <Metric label="AOI area" value={isFiniteValue(data.areaHa)?Number(data.areaHa).toLocaleString(undefined,{maximumFractionDigits:0})+' ha':'—'}/>
   <Metric label="Analysis scale" value={data.provenance?.sampleScale?data.provenance.sampleScale+' m':'—'}/>
  </div>

  <section className={styles.card}>
   <div className={styles.sectionHead}><div><h2>Distribution graphics</h2><p>Spatial distributions from the reproducible AOI sample.</p></div><span className={styles.pill}>Seed 42</span></div>
   <div className={styles.histGrid}>
    {['NDVI','NDRE','NDMI','BSI','LST','Rainfall'].filter(k=>keys.includes(k)).map(k=><Histogram key={k} rows={rows} valueKey={k}/>)}
   </div>
  </section>

  <div className={styles.grid2}>
   <section className={styles.card}><h2>Correlation matrix</h2><CorrelationMatrix rows={rows} keys={keys}/></section>
   <section className={styles.card}><h2>Key bivariate regression models</h2><RegressionTable rows={focus}/></section>
  </div>

  <section className={styles.card}><h2>Scatterplots + fitted regression</h2><div className={styles.scatterGrid}>
   <Scatter rows={rows} xKey="NDRE" yKey="NDVI"/>
   <Scatter rows={rows} xKey="NDMI" yKey="NDVI"/>
   <Scatter rows={rows} xKey="BSI" yKey="NDVI"/>
   <Scatter rows={rows} xKey="LST" yKey="NDVI"/>
   <Scatter rows={rows} xKey="Rainfall" yKey="NDVI"/>
   <Scatter rows={rows} xKey="LST" yKey="NDRE"/>
   <Scatter rows={rows} xKey="LST" yKey="NDMI"/>
   <Scatter rows={rows} xKey="LST" yKey="BSI"/>
  </div></section>

  <div className={styles.grid2}>
   <section className={styles.card}><h2>Multiple regression model</h2><MultipleModel model={multi}/></section>
   <section className={styles.card}><h2>Reproducibility & limitations</h2><div className={styles.kv}>
    <div><span>Analysis ID</span><b>{data.analysisId||'—'}</b></div>
    <div><span>Method version</span><b>{data.provenance?.version||'—'}</b></div>
    <div><span>Datasets</span><b>{Array.isArray(data.provenance?.datasets)?data.provenance.datasets.join(' • '):'—'}</b></div>
    <div><span>Period</span><b>{data.provenance?.start} → {data.provenance?.end}</b></div>
    <div><span>Sample scale</span><b>{data.provenance?.sampleScale||'—'} m</b></div>
    <div><span>Random seed</span><b>{data.provenance?.seed??'—'}</b></div>
   </div><div className={styles.notice}>{data.limitations}</div></section>
  </div>

  <section className={styles.card}><h2>Descriptive statistics</h2><div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr><th>Variable</th><th>n</th><th>Mean</th><th>SD</th><th>Min</th><th>Q1</th><th>Median</th><th>Q3</th><th>Max</th></tr></thead><tbody>{desc.map((d:any)=><tr key={d.key}><td>{d.key}</td><td>{d.n}</td><td>{nfmt(d.mean)}</td><td>{nfmt(d.sd)}</td><td>{nfmt(d.min)}</td><td>{nfmt(d.q1)}</td><td>{nfmt(d.median)}</td><td>{nfmt(d.q3)}</td><td>{nfmt(d.max)}</td></tr>)}</tbody></table></div></section>

  <section className={styles.card}><h2>Sample data table</h2><p>Showing the first {Math.min(rows.length,100)} of {rows.length} reproducible spatial samples.</p><div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr><th>#</th>{keys.map((k:string)=><th key={k}>{k}</th>)}</tr></thead><tbody>{rows.slice(0,100).map((r:any,i:number)=><tr key={i}><td>{i+1}</td>{keys.map((k:string)=><td key={k}>{nfmt(r[k])}</td>)}</tr>)}</tbody></table></div></section>
 </div>
}

function Histogram({rows,valueKey}:{rows:any[];valueKey:string}){
 const vals=rows.map(r=>r[valueKey]).filter(isFiniteValue).map(Number);
 if(vals.length<3)return <div className={styles.histCard}><b>{valueKey}</b><div className={styles.empty}>Insufficient data</div></div>;
 let min=Math.min(...vals),max=Math.max(...vals);if(min===max){min-=.5;max+=.5}
 const nBins=12,bins=Array(nBins).fill(0);
 for(const v of vals){const idx=Math.min(nBins-1,Math.max(0,Math.floor((v-min)/(max-min)*nBins)));bins[idx]++}
 const peak=Math.max(...bins,1);
 return <div className={styles.histCard}><div className={styles.scatterTitle}><b>{valueKey}</b><span>n={vals.length}</span></div><div className={styles.histBars}>{bins.map((b,i)=><div key={i} title={String(b)} style={{height:(b/peak*100)+'%'}}></div>)}</div><div className={styles.histAxis}><span>{nfmt(min,2)}</span><span>{nfmt(max,2)}</span></div></div>
}

function invertMatrix(M:number[][]){
 const n=M.length,A=M.map((r,i)=>[...r,...Array.from({length:n},(_,j)=>i===j?1:0)]);
 for(let i=0;i<n;i++){
  let p=i;for(let k=i+1;k<n;k++)if(Math.abs(A[k][i])>Math.abs(A[p][i]))p=k;
  if(Math.abs(A[p][i])<1e-10)throw new Error('singular');
  [A[i],A[p]]=[A[p],A[i]];
  const d=A[i][i];for(let j=0;j<2*n;j++)A[i][j]/=d;
  for(let k=0;k<n;k++)if(k!==i){const f=A[k][i];for(let j=0;j<2*n;j++)A[k][j]-=f*A[i][j]}
 }
 return A.map(r=>r.slice(n));
}
function multipleOLS(rows:any[],yKey:string,xKeys:string[]){
 const clean=rows.filter(r=>isFiniteValue(r[yKey])&&xKeys.every(k=>isFiniteValue(r[k])));
 const p=xKeys.length+1;
 if(clean.length<p+5)return{ok:false,n:clean.length,note:'Insufficient complete samples.'};
 try{
  const X=clean.map(r=>[1,...xKeys.map(k=>Number(r[k]))]),y=clean.map(r=>Number(r[yKey]));
  const Xt=X[0].map((_,j)=>X.map(r=>r[j]));
  const XtX=Xt.map(row=>X[0].map((_,j)=>row.reduce((a,v,i)=>a+v*X[i][j],0)));
  const Xty=Xt.map(row=>row.reduce((a,v,i)=>a+v*y[i],0));
  const inv=invertMatrix(XtX),beta=inv.map(row=>row.reduce((a,v,i)=>a+v*Xty[i],0));
  const pred=X.map(r=>r.reduce((a,v,i)=>a+v*beta[i],0)),ym=avg(y);
  const sse=y.reduce((a,v,i)=>a+(v-pred[i])**2,0),sst=y.reduce((a,v)=>a+(v-ym)**2,0);
  return{ok:true,n:y.length,r2:sst?1-sse/sst:null,rmse:Math.sqrt(sse/y.length),mae:avg(y.map((v,i)=>Math.abs(v-pred[i]))),coefficients:[{term:'Intercept',value:beta[0]},...xKeys.map((k,i)=>({term:k,value:beta[i+1]}))]};
 }catch{return{ok:false,n:clean.length,note:'Model matrix is singular; predictors are strongly collinear.'}}
}
function MultipleModel({model}:any){
 if(!model?.ok)return <div className={styles.notice}>{model?.note||'Model unavailable'} (n={model?.n||0}).</div>;
 return <div><div className={styles.metricStrip}><span>n <b>{model.n}</b></span><span>R² <b>{nfmt(model.r2)}</b></span><span>RMSE <b>{nfmt(model.rmse,4)}</b></span><span>MAE <b>{nfmt(model.mae,4)}</b></span></div><div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr><th>Term</th><th>Coefficient</th></tr></thead><tbody>{model.coefficients.map((x:any)=><tr key={x.term}><td>{x.term}</td><td>{nfmt(x.value,6)}</td></tr>)}</tbody></table></div><div className={styles.notice}>Exploratory spatial OLS: NDVI ~ NDRE + NDMI + BSI + LST + Rainfall + Slope. Coefficients are associative, not causal.</div></div>
}

function TemporalDashboard({temporal,aoi,start,end}:any){
 const rows=mergeTemporal(temporal);
 const keys=['NDVI','NDRE','EVI','SAVI','NDMI','NDWI','BSI','LST','Rainfall'];
 const desc=keys.map(k=>({key:k,...describeRows(rows,k)}));
 const focus=[
  regression(rows,'NDVI','NDRE'),
  regression(rows,'NDVI','NDMI'),
  regression(rows,'NDVI','BSI'),
  regression(rows,'NDVI','LST'),
  regression(rows,'NDVI','Rainfall'),
  regression(rows,'NDMI','LST'),
  regression(rows,'BSI','LST'),
  regression(rows,'NDVI','EVI')
 ];
 const id='GEOECO-'+hashString(JSON.stringify({aoi:aoi?.geometry,start,end})).toUpperCase();
 return <div className={styles.analyticsStack}>
  <section className={styles.card}>
   <div className={styles.sectionHead}><div><h2>Distribution graphics</h2><p>Quarterly AOI means from the same declared period. Analysis fingerprint: <b>{id}</b></p></div><span className={styles.pill}>{rows.length} quarterly records</span></div>
   <div className={styles.grid2}>
    <div><h3>Vegetation & moisture indices</h3><SimpleLineChart rows={rows} keys={['NDVI','NDRE','EVI','SAVI','NDMI','BSI']}/></div>
    <div><h3>Thermal & rainfall drivers</h3><SimpleLineChart rows={rows} keys={['LST']}/><SimpleLineChart rows={rows} keys={['Rainfall']}/></div>
   </div>
   <div className={styles.notice}>Temporal statistics use Sentinel-2 for NDVI, NDRE, NDWI, NDMI, EVI, SAVI and BSI; Landsat 8/9 for LST; and CHIRPS for rainfall. Correlation and regression describe association, not causality.</div>
  </section>

  <div className={styles.grid2}>
   <section className={styles.card}><h2>Correlation matrix</h2><CorrelationMatrix rows={rows} keys={keys}/></section>
   <section className={styles.card}><h2>Key regression models</h2><RegressionTable rows={focus}/></section>
  </div>

  <section className={styles.card}><h2>Scatterplots</h2><div className={styles.scatterGrid}>
   <Scatter rows={rows} xKey="NDRE" yKey="NDVI"/>
   <Scatter rows={rows} xKey="NDMI" yKey="NDVI"/>
   <Scatter rows={rows} xKey="BSI" yKey="NDVI"/>
   <Scatter rows={rows} xKey="LST" yKey="NDVI"/>
   <Scatter rows={rows} xKey="Rainfall" yKey="NDVI"/>
   <Scatter rows={rows} xKey="LST" yKey="NDMI"/>
   <Scatter rows={rows} xKey="LST" yKey="BSI"/>
  </div></section>

  <section className={styles.card}><h2>Descriptive statistics</h2><div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr><th>Variable</th><th>n</th><th>Mean</th><th>SD</th><th>Min</th><th>Q1</th><th>Median</th><th>Q3</th><th>Max</th></tr></thead><tbody>{desc.map((d:any)=><tr key={d.key}><td>{d.key}</td><td>{d.n}</td><td>{nfmt(d.mean)}</td><td>{nfmt(d.sd)}</td><td>{nfmt(d.min)}</td><td>{nfmt(d.q1)}</td><td>{nfmt(d.median)}</td><td>{nfmt(d.q3)}</td><td>{nfmt(d.max)}</td></tr>)}</tbody></table></div></section>

  <section className={styles.card}><h2>Quarterly analysis table</h2><div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr><th>Period</th>{keys.map(k=><th key={k}>{k}</th>)}</tr></thead><tbody>{rows.map((r:any,i:number)=><tr key={i}><td>{r.period||r.start||i+1}</td>{keys.map(k=><td key={k}>{nfmt(r[k])}</td>)}</tr>)}</tbody></table></div></section>
 </div>
}

function mergeTemporal(t:any){
 return Array.isArray(t?.rows)?t.rows:[];
}
function isFiniteValue(v:any){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))}
function avg(a:number[]){return a.reduce((x,y)=>x+y,0)/a.length}
function quant(a:number[],p:number){if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),i=(s.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return lo===hi?s[lo]:s[lo]+(s[hi]-s[lo])*(i-lo)}
function describeRows(rows:any[],key:string){const a=rows.map(r=>r[key]).filter(isFiniteValue).map(Number);if(!a.length)return{n:0,mean:null,sd:null,min:null,q1:null,median:null,q3:null,max:null};const m=avg(a),sd=a.length>1?Math.sqrt(a.reduce((z,v)=>z+(v-m)**2,0)/(a.length-1)):0;return{n:a.length,mean:m,sd,min:Math.min(...a),q1:quant(a,.25),median:quant(a,.5),q3:quant(a,.75),max:Math.max(...a)}}
function regression(rows:any[],xKey:string,yKey:string){
 const pts=rows.filter(r=>isFiniteValue(r[xKey])&&isFiniteValue(r[yKey])).map(r=>({x:Number(r[xKey]),y:Number(r[yKey])}));
 const n=pts.length;if(n<3)return{x:xKey,y:yKey,n,r:null,r2:null,slope:null,intercept:null,rmse:null};
 const mx=avg(pts.map(p=>p.x)),my=avg(pts.map(p=>p.y)),sxx=pts.reduce((a,p)=>a+(p.x-mx)**2,0),syy=pts.reduce((a,p)=>a+(p.y-my)**2,0),sxy=pts.reduce((a,p)=>a+(p.x-mx)*(p.y-my),0);
 if(!sxx||!syy)return{x:xKey,y:yKey,n,r:null,r2:null,slope:null,intercept:null,rmse:null};
 const slope=sxy/sxx,intercept=my-slope*mx,r=sxy/Math.sqrt(sxx*syy),rmse=Math.sqrt(avg(pts.map(p=>(p.y-(intercept+slope*p.x))**2)));
 return{x:xKey,y:yKey,n,r,r2:r*r,slope,intercept,rmse};
}
function CorrelationMatrix({rows,keys}:{rows:any[];keys:string[]}){
 const get=(a:string,b:string)=>a===b?1:regression(rows,a,b).r;
 return <div className={styles.matrix}><div></div>{keys.map(k=><b key={'h'+k}>{k}</b>)}{keys.map(a=><div className={styles.matrixRow} key={a}><b>{a}</b>{keys.map(b=>{const r=get(a,b);const alpha=isFiniteValue(r)?Math.min(.86,.10+Math.abs(Number(r))*.72):.04;return <span key={b} style={{background:'rgba(45,126,99,'+alpha+')'}}>{nfmt(r,2)}</span>})}</div>)}</div>
}
function RegressionTable({rows}:{rows:any[]}){return <div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr><th>Relationship</th><th>n</th><th>r</th><th>R²</th><th>Slope</th><th>Intercept</th><th>RMSE</th></tr></thead><tbody>{rows.map((x:any,i:number)=><tr key={i}><td>{x.y} vs {x.x}</td><td>{x.n}</td><td>{nfmt(x.r)}</td><td>{nfmt(x.r2)}</td><td>{nfmt(x.slope,4)}</td><td>{nfmt(x.intercept,4)}</td><td>{nfmt(x.rmse,4)}</td></tr>)}</tbody></table></div>}
function SimpleLineChart({rows,keys}:{rows:any[];keys:string[]}){
 const vals=rows.flatMap(r=>keys.map(k=>r[k])).filter(isFiniteValue).map(Number);if(vals.length<2)return <div className={styles.empty}>Insufficient data</div>;
 const W=620,H=220,p=30;let min=Math.min(...vals),max=Math.max(...vals);if(min===max){min-=1;max+=1}
 const sx=(i:number)=>p+(rows.length<=1?0:i*(W-2*p)/(rows.length-1)),sy=(v:number)=>H-p-(v-min)*(H-2*p)/(max-min);
 return <div className={styles.svgWrap}><svg viewBox={'0 0 '+W+' '+H}><line x1={p} y1={H-p} x2={W-p} y2={H-p} className={styles.axis}/><line x1={p} y1={p} x2={p} y2={H-p} className={styles.axis}/>{keys.map((k,ki)=>{const pts=rows.map((r,i)=>isFiniteValue(r[k])?sx(i)+','+sy(Number(r[k])):null).filter(Boolean).join(' ');return <polyline key={k} points={pts} fill="none" className={styles['series'+(ki%5)]}/>})}</svg><div className={styles.chartLegend}>{keys.map((k,i)=><span key={k}><i className={styles['seriesDot'+(i%5)]}></i>{k}</span>)}</div></div>
}
function Scatter({rows,xKey,yKey}:{rows:any[];xKey:string;yKey:string}){
 const m=regression(rows,xKey,yKey),pts=rows.filter(r=>isFiniteValue(r[xKey])&&isFiniteValue(r[yKey])).map(r=>({x:Number(r[xKey]),y:Number(r[yKey])}));if(pts.length<3)return <div className={styles.scatterCard}><b>{yKey} vs {xKey}</b><div className={styles.empty}>Insufficient data</div></div>;
 const W=300,H=210,p=30;let xmin=Math.min(...pts.map(q=>q.x)),xmax=Math.max(...pts.map(q=>q.x)),ymin=Math.min(...pts.map(q=>q.y)),ymax=Math.max(...pts.map(q=>q.y));if(xmin===xmax){xmin-=1;xmax+=1}if(ymin===ymax){ymin-=1;ymax+=1}
 const sx=(v:number)=>p+(v-xmin)*(W-2*p)/(xmax-xmin),sy=(v:number)=>H-p-(v-ymin)*(H-2*p)/(ymax-ymin);
 const y1=isFiniteValue(m.slope)?Number(m.intercept)+Number(m.slope)*xmin:null,y2=isFiniteValue(m.slope)?Number(m.intercept)+Number(m.slope)*xmax:null;
 return <div className={styles.scatterCard}><div className={styles.scatterTitle}><b>{yKey} vs {xKey}</b><span>r={nfmt(m.r)} • R²={nfmt(m.r2)}</span></div><svg viewBox={'0 0 '+W+' '+H}><line x1={p} y1={H-p} x2={W-p} y2={H-p} className={styles.axis}/><line x1={p} y1={p} x2={p} y2={H-p} className={styles.axis}/>{pts.map((q,i)=><circle key={i} cx={sx(q.x)} cy={sy(q.y)} r="4" className={styles.point}/>)}{y1!==null&&y2!==null&&<line x1={sx(xmin)} y1={sy(y1)} x2={sx(xmax)} y2={sy(y2)} className={styles.regLine}/>}</svg></div>
}
function hashString(x:string){let h=2166136261;for(let i=0;i<x.length;i++){h^=x.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')}
function nfmt(v:any,d=3){return isFiniteValue(v)?Number(v).toFixed(d):'NA'}

function ScientificLibrary({layer,setLayer}:any){const x=layers.find((z:any)=>z.id===layer)||layers[0];return <div className={styles.gridMap}><section className={styles.card}><h2>Scientific methods</h2><div className={styles.libraryList}>{layers.map(m=><button key={m.id} className={m.id===layer?styles.libActive:''} onClick={()=>setLayer(m.id)}><b>{m.name}</b><span>{m.group}</span></button>)}</div></section><section className={styles.card}><div className={styles.pill}>{x.group}</div><h2>{x.name}</h2><p>{x.desc}</p><div className={styles.docGrid}>{['Scientific definition','Formula/model','Datasets','Preprocessing','Classification rule','Validation status','Uncertainty','Interpretation boundary','Limitations','References','Method version','Provenance fields'].map(t=><div key={t}><b>{t}</b><span>Version-controlled and exposed with each result.</span></div>)}</div><div className={styles.notice}>For spectral indices the default classes are AOI-relative quintiles, not universal ecological-health thresholds. Flood, landslide and erosion outputs are explicitly labelled screening-level relative susceptibility until locally calibrated and validated.</div></section></div>}
function Help(){return <div className={styles.grid2}><section className={styles.card}><h2>How to use</h2><ol className={styles.steps}><li>Upload AOI.</li><li>Select dates.</li><li>Choose NDVI, NDRE, NDWI, NDMI, BSI, LST, erosion, flood or landslide.</li><li>Generate the map.</li><li>Read classes and legend.</li><li>Review area by class and statistics.</li><li>Check method, validation status and provenance before interpretation.</li></ol></section><section className={styles.card}><h2>About perspective view</h2><p>The optional perspective view is a cartographic 2.5D presentation. It does not alter raster values and is not presented as a true terrain-elevation model. A true DEM-driven 3D terrain renderer can be added as a separate visualization layer.</p></section></div>}
function Metric({label,value}:{label:string;value:string}){return <div className={styles.metric}><span>{label}</span><b>{value}</b></div>}
function fmt(v:any){return v==null||!Number.isFinite(Number(v))?'NA':Number(v).toFixed(3)}
