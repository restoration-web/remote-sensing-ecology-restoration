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
 const selected=useMemo(()=>layers.find(x=>x.id===layer)!,[layer]);

 async function run(target=layer){
   if(!aoi?.geometry){setResult({status:'error',note:'Upload GeoJSON or zipped Shapefile before running analysis.'});return;}
   setLayer(target);setRunning(true);setResult({status:'running',note:'Processing '+target+' in Google Earth Engine…'});
   try{
     const res=await fetch('/api/geoeco/analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({aoi:aoi.geometry,start,end,layer:target})});
     const data=await res.json();setResult(data);
   }catch(e:any){setResult({status:'error',note:e?.message||String(e)})}finally{setRunning(false)}
 }

 return <main className={styles.shell}>
  <aside className={styles.sidebar}>
   <div><div className={styles.brand}>GeoEco AI</div><div className={styles.tag}>Geospatial Environmental Intelligence</div></div>
   <nav className={styles.nav}>{['Dashboard','Analysis','Scientific Library','Help'].map(x=><button key={x} className={tab===x?styles.active:''} onClick={()=>setTab(x)}>{x}</button>)}</nav>
   <div className={styles.sideFoot}>Engine v1.2<br/><span>Classified maps + provenance</span></div>
  </aside>

  <section className={styles.content}>
   <header className={styles.header}>
    <div><div className={styles.kicker}>SCIENTIFIC WEB-GIS</div><h1>{tab}</h1><p>Classified thematic maps, legends, class-area statistics, transparent model assumptions, and reproducible provenance.</p></div>
    <div className={styles.actions}><button className={styles.secondary} onClick={()=>setPerspective(v=>!v)}>{perspective?'2D View':'Perspective View'}</button><button disabled={running} onClick={()=>run()}>{running?'Running…':'Run '+selected.name}</button></div>
   </header>

   {tab==='Dashboard'&&<Dashboard result={result} selected={selected}/>}
   {tab==='Analysis'&&<AnalysisWorkspace aoi={aoi} setAoi={setAoi} start={start} setStart={setStart} end={end} setEnd={setEnd} layer={layer} setLayer={setLayer} result={result} run={run} running={running} perspective={perspective}/>}
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
 const {aoi,setAoi,start,setStart,end,setEnd,layer,setLayer,result,run,running,perspective}=props;
 return <div className={styles.analysisLayout}>
  <section className={styles.controlBar}>
   <AOIUploader aoi={aoi} setAoi={setAoi}/>
   <label className={styles.compactLabel}>Start<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
   <label className={styles.compactLabel}>End<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
  </section>

  <div className={styles.layerTabs}>{layers.map(x=><button key={x.id} className={layer===x.id?styles.layerActive:''} onClick={()=>setLayer(x.id)}><b>{x.name}</b><span>{x.group}</span></button>)}</div>

  <section className={styles.mapResultCard}>
   <div className={styles.mapTitleRow}><div><h2>{layers.find((x:any)=>x.id===layer)?.name}</h2><p>{layers.find((x:any)=>x.id===layer)?.desc}</p></div><button disabled={running} onClick={()=>run(layer)}>{running?'Processing…':'Generate Map'}</button></div>
   <GeoMap aoi={aoi} result={result?.layer===layer?result:null} perspective={perspective}/>
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
 </div>
}

function GeoMap({aoi,result,perspective}:{aoi:AOI;result:MapResult|null;perspective:boolean}){
 const el=useRef<HTMLDivElement>(null),mapRef=useRef<any>(null),aoiLayer=useRef<any>(null),imgLayer=useRef<any>(null);
 useEffect(()=>{let dead=false;(async()=>{if(!el.current||mapRef.current)return;const L=await import('leaflet');if(dead||!el.current)return;
  const map=L.map(el.current,{zoomControl:true}).setView([-2.2,115.5],6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
  mapRef.current=map;setTimeout(()=>map.invalidateSize(),150);
 })();return()=>{dead=true;if(mapRef.current){mapRef.current.remove();mapRef.current=null}}},[]);
 useEffect(()=>{let dead=false;(async()=>{const map=mapRef.current;if(!map)return;const L=await import('leaflet');if(dead)return;
  if(aoiLayer.current){map.removeLayer(aoiLayer.current);aoiLayer.current=null}
  if(aoi?.geometry){const x=L.geoJSON(aoi.geometry,{style:{color:'#f7d154',weight:3,fillOpacity:0}}).addTo(map);aoiLayer.current=x;const b=x.getBounds();if(b.isValid())map.fitBounds(b.pad(.05),{maxZoom:14});}
 })();return()=>{dead=true}},[aoi]);
 useEffect(()=>{let dead=false;(async()=>{const map=mapRef.current;if(!map)return;const L=await import('leaflet');if(dead)return;
  if(imgLayer.current){map.removeLayer(imgLayer.current);imgLayer.current=null}
  if(result?.imageUrl&&result.bounds){imgLayer.current=L.imageOverlay(result.imageUrl,result.bounds,{opacity:.78,interactive:false}).addTo(map);imgLayer.current.bringToFront?.();if(aoiLayer.current)aoiLayer.current.bringToFront?.();}
 })();return()=>{dead=true}},[result]);
 return <div className={perspective?styles.perspectiveFrame:styles.flatFrame}><div ref={el} className={styles.realMap}/>{result?.legend&&<div className={styles.floatingLegend}><b>{result.layer}</b>{result.legend.map(x=><div key={x.class}><i style={{background:x.color}}></i><span>{x.label}</span></div>)}</div>}</div>
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

function ScientificLibrary({layer,setLayer}:any){const x=layers.find((z:any)=>z.id===layer)||layers[0];return <div className={styles.gridMap}><section className={styles.card}><h2>Scientific methods</h2><div className={styles.libraryList}>{layers.map(m=><button key={m.id} className={m.id===layer?styles.libActive:''} onClick={()=>setLayer(m.id)}><b>{m.name}</b><span>{m.group}</span></button>)}</div></section><section className={styles.card}><div className={styles.pill}>{x.group}</div><h2>{x.name}</h2><p>{x.desc}</p><div className={styles.docGrid}>{['Scientific definition','Formula/model','Datasets','Preprocessing','Classification rule','Validation status','Uncertainty','Interpretation boundary','Limitations','References','Method version','Provenance fields'].map(t=><div key={t}><b>{t}</b><span>Version-controlled and exposed with each result.</span></div>)}</div><div className={styles.notice}>For spectral indices the default classes are AOI-relative quintiles, not universal ecological-health thresholds. Flood, landslide and erosion outputs are explicitly labelled screening-level relative susceptibility until locally calibrated and validated.</div></section></div>}
function Help(){return <div className={styles.grid2}><section className={styles.card}><h2>How to use</h2><ol className={styles.steps}><li>Upload AOI.</li><li>Select dates.</li><li>Choose NDVI, NDRE, NDWI, NDMI, BSI, LST, erosion, flood or landslide.</li><li>Generate the map.</li><li>Read classes and legend.</li><li>Review area by class and statistics.</li><li>Check method, validation status and provenance before interpretation.</li></ol></section><section className={styles.card}><h2>About perspective view</h2><p>The optional perspective view is a cartographic 2.5D presentation. It does not alter raster values and is not presented as a true terrain-elevation model. A true DEM-driven 3D terrain renderer can be added as a separate visualization layer.</p></section></div>}
function Metric({label,value}:{label:string;value:string}){return <div className={styles.metric}><span>{label}</span><b>{value}</b></div>}
function fmt(v:any){return v==null||!Number.isFinite(Number(v))?'NA':Number(v).toFixed(3)}
