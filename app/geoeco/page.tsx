'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import styles from './page.module.css';

type AOI={name:string;featureCount:number;geometry:any}|null;
type Result={status:string;note?:string;areaHa?:number;sceneCount?:number;summary?:Record<string,number|null>;annualNDVI?:Array<{year:number;NDVI:number|null}>;period?:{start:number;end:number}};

const methods=[
{id:'GEOECO-NDVI-001',name:'NDVI',group:'Earth Observation',status:'Established',evidence:'A',res:'30–60 m backend',note:'Vegetation greenness from Landsat Collection 2 Level-2.'},
{id:'GEOECO-NDMI-001',name:'NDMI',group:'Earth Observation',status:'Established',evidence:'A',res:'30–60 m backend',note:'Moisture-sensitive NIR–SWIR response.'},
{id:'GEOECO-BSI-001',name:'BSI',group:'Land Condition',status:'Literature-supported',evidence:'A',res:'30–60 m backend',note:'Bare-soil-like spectral response.'},
{id:'GEOECO-LST-001',name:'LST',group:'Thermal',status:'Established',evidence:'A',res:'30–60 m backend',note:'Landsat Collection 2 Level-2 surface temperature.'},
{id:'GEOECO-RUSLE-001',name:'RUSLE Soil Erosion',group:'Land Degradation',status:'Planned',evidence:'A',res:'Model-dependent',note:'Annual sheet and rill erosion estimate.'},
{id:'GEOECO-FLOOD-001',name:'Flood Susceptibility',group:'Disaster Susceptibility',status:'Planned',evidence:'C/B',res:'Model-dependent',note:'Relative susceptibility; not flood depth or return period.'},
{id:'GEOECO-LANDSLIDE-001',name:'Landslide Susceptibility',group:'Disaster Susceptibility',status:'Planned',evidence:'C/B',res:'Model-dependent',note:'Relative susceptibility; not event timing or loss.'},
];

export default function GeoEcoPage(){
 const [tab,setTab]=useState('Map & AOI');
 const [aoi,setAoi]=useState<AOI>(null);
 const [start,setStart]=useState('2024');
 const [end,setEnd]=useState('2026');
 const [result,setResult]=useState<Result|null>(null);
 const [running,setRunning]=useState(false);
 const [selected,setSelected]=useState(methods[0].id);
 const method=useMemo(()=>methods.find(x=>x.id===selected)!,[selected]);

 async function run(){
  if(!aoi?.geometry){setResult({status:'AOI required',note:'Upload GeoJSON or zipped Shapefile first.'});return;}
  setRunning(true);setResult({status:'running',note:'Sending AOI to Google Earth Engine backend...'});
  try{
   const res=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    period:{start,end},sensor:'Landsat 5/7/8/9',variables:['NDVI','NDMI','BSI','LST','Rainfall','Elevation','Slope'],aoi:aoi.geometry,aoiName:aoi.name
   })});
   const data=await res.json(); setResult(data);
  }catch(e:any){setResult({status:'error',note:e?.message||String(e)})}finally{setRunning(false)}
 }

 return <main className={styles.shell}>
  <aside className={styles.sidebar}>
   <div><div className={styles.brand}>GeoEco AI</div><div className={styles.tag}>Scientific Geospatial Intelligence</div></div>
   <nav className={styles.nav}>{['Dashboard','Map & AOI','Analysis','Scientific Library','Help'].map(x=><button key={x} className={tab===x?styles.active:''} onClick={()=>setTab(x)}>{x}</button>)}</nav>
   <div className={styles.sideFoot}>Core v1.1<br/><span>Earth Engine connected</span></div>
  </aside>

  <section className={styles.content}>
   <header className={styles.header}>
    <div><div className={styles.kicker}>SCIENTIFIC WEB-GIS</div><h1>{tab}</h1><p>Transparent remote-sensing analysis with QA/QC, provenance, scientific boundaries and reproducible outputs.</p></div>
    <div className={styles.actions}><button className={styles.secondary} onClick={()=>setTab('Scientific Library')}>Methods</button><button onClick={run} disabled={running}>{running?'Running…':'Run Analysis'}</button></div>
   </header>

   {tab==='Dashboard'&&<Dashboard result={result}/>}
   {tab==='Map & AOI'&&<MapAOI aoi={aoi} setAoi={setAoi} start={start} end={end} setStart={setStart} setEnd={setEnd} result={result} run={run} running={running}/>}
   {tab==='Analysis'&&<Analysis selected={selected} setSelected={setSelected} method={method} result={result}/>}
   {tab==='Scientific Library'&&<Library selected={selected} setSelected={setSelected}/>}
   {tab==='Help'&&<Help/>}
  </section>
 </main>
}

function Dashboard({result}:{result:Result|null}){
 const s=result?.summary||{};
 return <div className={styles.stack}>
  <div className={styles.metrics}>
   <Metric label="Backend" value="GEE"/>
   <Metric label="Core methods" value="7"/>
   <Metric label="Last status" value={result?.status||'Ready'}/>
   <Metric label="Scenes" value={String(result?.sceneCount??'—')}/>
  </div>
  <div className={styles.grid2}>
   <section className={styles.card}><h2>Latest analysis</h2>
    {result?.status==='success'?<div className={styles.resultGrid}>{['NDVI','NDMI','BSI','LST','Rainfall','Elevation','Slope'].map(k=><div key={k}><span>{k}</span><b>{s[k]==null?'NA':Number(s[k]).toFixed(k==='LST'?2:3)}</b></div>)}</div>:<div className={styles.empty}>Run an AOI analysis to populate real statistics.</div>}
   </section>
   <section className={styles.card}><h2>Scientific safeguards</h2><ul className={styles.checks}><li>AOI is sent explicitly to Earth Engine.</li><li>NoData is not treated as zero.</li><li>LST is surface temperature, not air temperature.</li><li>Susceptibility is not labelled as risk.</li><li>Experimental modules remain clearly marked.</li></ul></section>
  </div>
 </div>
}

function MapAOI({aoi,setAoi,start,end,setStart,setEnd,result,run,running}:any){
 return <div className={styles.gridMap}>
  <section className={styles.mapCard}><div className={styles.mapToolbar}><span>Interactive AOI map</span><span>{aoi?.name||'No AOI loaded'}</span></div><LeafletMap aoi={aoi}/></section>
  <aside className={styles.card}>
   <AOIUploader aoi={aoi} setAoi={setAoi}/>
   <label className={styles.label}>Start year<input value={start} onChange={e=>setStart(e.target.value)}/></label>
   <label className={styles.label}>End year<input value={end} onChange={e=>setEnd(e.target.value)}/></label>
   <div className={styles.notice}>Current live backend uses Landsat 5/7/8/9 Collection 2 Level-2, CHIRPS rainfall and SRTM terrain. Sentinel-2 will be enabled only after the harmonized method is locked.</div>
   <button onClick={run} disabled={running}>{running?'Processing…':'Run AOI Analysis'}</button>
   {result&&<div className={styles.statusBox}><b>Status: {result.status}</b><span>{result.note}</span>{result.areaHa!=null&&<span>AOI area: {Number(result.areaHa).toLocaleString(undefined,{maximumFractionDigits:1})} ha</span>}</div>}
  </aside>
 </div>
}

function LeafletMap({aoi}:{aoi:AOI}){
 const el=useRef<HTMLDivElement>(null); const mapRef=useRef<any>(null); const aoiLayer=useRef<any>(null);
 useEffect(()=>{let cancelled=false;(async()=>{if(!el.current||mapRef.current)return;const L=await import('leaflet');if(cancelled||!el.current)return;
  const map=L.map(el.current,{zoomControl:true,attributionControl:true}).setView([-2.2,115.5],6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
  mapRef.current=map;setTimeout(()=>map.invalidateSize(),100);
 })();return()=>{cancelled=true;if(mapRef.current){mapRef.current.remove();mapRef.current=null}}},[]);
 useEffect(()=>{let cancelled=false;(async()=>{const map=mapRef.current;if(!map)return;const L=await import('leaflet');if(cancelled)return;
  if(aoiLayer.current){map.removeLayer(aoiLayer.current);aoiLayer.current=null}
  if(aoi?.geometry){const layer=L.geoJSON(aoi.geometry,{style:{color:'#f4b942',weight:3,fillColor:'#f4b942',fillOpacity:.12}}).addTo(map);aoiLayer.current=layer;const b=layer.getBounds();if(b.isValid())map.fitBounds(b.pad(.08),{maxZoom:15});}
 })();return()=>{cancelled=true}},[aoi]);
 return <div ref={el} className={styles.realMap}/>;
}

function AOIUploader({aoi,setAoi}:any){
 const [msg,setMsg]=useState('Upload .geojson/.json or zipped Shapefile.');
 async function load(file?:File){if(!file)return;try{let geo:any;const n=file.name.toLowerCase();
  if(n.endsWith('.zip')){const shp=(await import('shpjs')).default;geo=await shp(await file.arrayBuffer());if(Array.isArray(geo))geo={type:'FeatureCollection',features:geo.flatMap((g:any)=>g?.features||[])}}
  else if(n.endsWith('.geojson')||n.endsWith('.json'))geo=JSON.parse(await file.text());else throw new Error('Unsupported format.');
  const fc=geo?.type==='FeatureCollection'?geo:{type:'FeatureCollection',features:geo?.type==='Feature'?[geo]:[]};if(!fc.features?.length)throw new Error('No valid features found.');
  setAoi({name:file.name,featureCount:fc.features.length,geometry:fc});setMsg('AOI loaded successfully.');
 }catch(e:any){setAoi(null);setMsg(e?.message||'Failed to read AOI.')}}
 return <div><label className={styles.label}>Study Area / AOI<input type="file" accept=".zip,.geojson,.json" onChange={e=>load(e.target.files?.[0])}/></label><div className={styles.hint}>{msg}</div>{aoi&&<div className={styles.aoiSummary}><b>{aoi.name}</b><span>{aoi.featureCount} feature(s)</span><button className={styles.secondary} onClick={()=>setAoi(null)}>Remove</button></div>}</div>
}

function Analysis({selected,setSelected,method,result}:any){
 return <div className={styles.gridMap}><section className={styles.card}><h2>Scientific modules</h2><div className={styles.selectGrid}>{methods.map(m=><button key={m.id} className={selected===m.id?styles.selectedMethod:''} onClick={()=>setSelected(m.id)}><b>{m.name}</b><span>{m.group} • {m.status}</span></button>)}</div>
  <div className={styles.resultMock}><h2>Observed result</h2>{result?.status==='success'?<ResultPanel result={result}/>:<div className={styles.empty}>Run an AOI analysis first. Planned modules remain visible but do not fabricate outputs.</div>}</div>
 </section><aside className={styles.card}><div className={styles.pill}>{method.status}</div><h2>{method.name}</h2><p>{method.note}</p><dl className={styles.details}><div><dt>Method ID</dt><dd>{method.id}</dd></div><div><dt>Evidence</dt><dd>Level {method.evidence}</dd></div><div><dt>Resolution</dt><dd>{method.res}</dd></div></dl><div className={styles.notice}>RUSLE, flood susceptibility and landslide susceptibility are visible in the registry but will not return fabricated values until their production engines are implemented.</div></aside></div>
}

function ResultPanel({result}:any){const s=result.summary||{};return <div><div className={styles.resultGrid}>{['NDVI','NDMI','BSI','LST','Rainfall','Elevation','Slope'].map(k=><div key={k}><span>{k}</span><b>{s[k]==null?'NA':Number(s[k]).toFixed(k==='LST'?2:3)}</b></div>)}</div>{Array.isArray(result.annualNDVI)&&result.annualNDVI.length>0&&<div className={styles.chart}>{result.annualNDVI.filter((x:any)=>x.NDVI!=null).map((x:any)=><div key={x.year} title={x.year+': '+Number(x.NDVI).toFixed(3)} style={{height:Math.max(8,Math.min(100,(Number(x.NDVI)+.2)*85))+'%'}}></div>)}</div>}</div>}

function Library({selected,setSelected}:any){const m=methods.find(x=>x.id===selected)||methods[0];return <div className={styles.gridMap}><section className={styles.card}><h2>Method Registry</h2><div className={styles.libraryList}>{methods.map(x=><button key={x.id} className={selected===x.id?styles.libActive:''} onClick={()=>setSelected(x.id)}><b>{x.name}</b><span>{x.id}</span></button>)}</div></section><article className={styles.card}><div className={styles.pill}>{m.status}</div><h2>{m.name}</h2><p>{m.note}</p><div className={styles.docGrid}>{['Definition','Formula / Model','Dataset & Sensor','Variables','Resolution','Pre-processing','Quality Control','Validation','Interpretation Boundary','Limitations','References','Method Version'].map(x=><div key={x}><b>{x}</b><span>Version-controlled in production registry.</span></div>)}</div></article></div>}

function Help(){return <div className={styles.grid2}><section className={styles.card}><h2>How to use</h2><ol className={styles.steps}><li>Open Map & AOI.</li><li>Upload GeoJSON or zipped Shapefile.</li><li>Set start and end year.</li><li>Run the AOI analysis.</li><li>Review actual GEE statistics.</li><li>Open Analysis for method boundaries and planned modules.</li></ol></section><section className={styles.card}><h2>Scientific principle</h2><p>GeoEco AI separates observed values, derived values and scientific interpretation. Planned models remain labelled as planned until their equations, datasets, validation rules and uncertainty framework are implemented.</p></section></div>}

function Metric({label,value}:{label:string;value:string}){return <div className={styles.metric}><span>{label}</span><b>{value}</b></div>}
