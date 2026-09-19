'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import styles from './page.module.css';

type AOI={name:string;featureCount:number;geometry:any}|null;
type LegendItem={class:number;label:string;color:string;min:number|null;max:number|null};
type MapResult={
 status:string;note?:string;analysisId?:string;layer?:string;imageUrl?:string;bounds?:[[number,number],[number,number]];
 legend?:LegendItem[];stats?:{mean?:number;stdDev?:number;thresholds?:number[]};
 classArea?:Array<{class:number;areaHa:number}>;methodology?:any;provenance?:any;
};
type Analytics={
 status:string;note?:string;analysisId?:string;temporalResolution?:string;rows?:any[];descriptive?:Record<string,any>;
 correlations?:any[];focus?:any[];multipleRegression?:any;provenance?:any;limitations?:string;
};

const layers=[
 {id:'NDVI',name:'NDVI',group:'Vegetation',desc:'Vegetation greenness'},
 {id:'NDRE',name:'NDRE',group:'Vegetation',desc:'Red-edge vegetation response'},
 {id:'NDWI',name:'NDWI',group:'Water',desc:'Surface-water spectral response'},
 {id:'NDMI',name:'NDMI',group:'Moisture',desc:'Vegetation/canopy moisture response'},
 {id:'BSI',name:'BSI',group:'Land Condition',desc:'Bare-soil-like spectral response'},
 {id:'LST',name:'LST',group:'Thermal',desc:'Land Surface Temperature'},
 {id:'EROSION',name:'Erosion Susceptibility',group:'Land Degradation',desc:'Relative screening model'},
 {id:'FLOOD',name:'Flood Susceptibility',group:'Disaster',desc:'Relative screening model'},
 {id:'LANDSLIDE',name:'Landslide Susceptibility',group:'Disaster',desc:'Relative screening model'},
];

export default function GeoEco(){
 const [tab,setTab]=useState('Analysis');
 const [aoi,setAoi]=useState<AOI>(null);
 const [start,setStart]=useState('2024-01-01');
 const [end,setEnd]=useState('2026-09-19');
 const [layer,setLayer]=useState('NDVI');
 const [result,setResult]=useState<MapResult|null>(null);
 const [analytics,setAnalytics]=useState<Analytics|null>(null);
 const [running,setRunning]=useState(false);
 const [perspective,setPerspective]=useState(false);
 const selected=useMemo(()=>layers.find(x=>x.id===layer)!,[layer]);

 async function run(target=layer){
   if(!aoi?.geometry){
     setResult({status:'error',note:'Upload GeoJSON or zipped Shapefile before running analysis.'});
     return;
   }
   setLayer(target);setRunning(true);
   setResult({status:'running',note:'Generating classified '+target+' map…'});
   setAnalytics({status:'running',note:'Calculating quarterly statistics, correlations and regression models…'});
   try{
     const payload={aoi:aoi.geometry,start,end,layer:target};
     const [mapRes,anaRes]=await Promise.all([
       fetch('/api/geoeco/analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),
       fetch('/api/geoeco/analytics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({aoi:aoi.geometry,start,end})})
     ]);
     const [mapData,anaData]=await Promise.all([mapRes.json(),anaRes.json()]);
     setResult(mapData);setAnalytics(anaData);
   }catch(e:any){
     const note=e?.message||String(e);setResult({status:'error',note});setAnalytics({status:'error',note});
   }finally{setRunning(false)}
 }

 return <main className={styles.shell}>
  <aside className={styles.sidebar}>
   <div><div className={styles.brand}>GeoEco AI</div><div className={styles.tag}>Geospatial Environmental Intelligence</div></div>
   <nav className={styles.nav}>{['Dashboard','Analysis','Scientific Library','Help'].map(x=><button key={x} className={tab===x?styles.active:''} onClick={()=>setTab(x)}>{x}</button>)}</nav>
   <div className={styles.sideFoot}>Engine v1.3<br/><span>Maps + statistics + models</span></div>
  </aside>

  <section className={styles.content}>
   <header className={styles.header}>
    <div><div className={styles.kicker}>SCIENTIFIC WEB-GIS</div><h1>{tab}</h1><p>Classified thematic maps, temporal analytics, correlation, regression, transparent model assumptions, and reproducible provenance.</p></div>
    <div className={styles.actions}><button className={styles.secondary} onClick={()=>setPerspective(v=>!v)}>{perspective?'2D View':'Perspective View'}</button><button disabled={running} onClick={()=>run()}>{running?'Running full analysis…':'Run Full Analysis'}</button></div>
   </header>

   {tab==='Dashboard'&&<Dashboard result={result} analytics={analytics} selected={selected}/>}
   {tab==='Analysis'&&<AnalysisWorkspace aoi={aoi} setAoi={setAoi} start={start} setStart={setStart} end={end} setEnd={setEnd} layer={layer} setLayer={setLayer} result={result} analytics={analytics} run={run} running={running} perspective={perspective}/>}
   {tab==='Scientific Library'&&<ScientificLibrary layer={layer} setLayer={setLayer}/>}
   {tab==='Help'&&<Help/>}
  </section>
 </main>
}

function Dashboard({result,analytics,selected}:any){
 return <div className={styles.stack}>
  <div className={styles.metrics}>
   <Metric label="Active layer" value={selected.name}/>
   <Metric label="Map status" value={result?.status||'Ready'}/>
   <Metric label="Temporal records" value={String(analytics?.rows?.length||0)}/>
   <Metric label="Analysis ID" value={result?.analysisId||'—'}/>
  </div>
  <div className={styles.grid2}>
   <section className={styles.card}><h2>Scientific output standard</h2><ul className={styles.checks}><li>Map classes and thresholds are explicit.</li><li>Every class reports area in hectares.</li><li>Correlation and regression use the same AOI and declared dates.</li><li>Model performance metrics are displayed with sample size.</li><li>Analysis ID and engine version support reproducibility.</li></ul></section>
   <section className={styles.card}><h2>Current result</h2>{result?.status==='success'?<Stats result={result}/>:<div className={styles.empty}>Run an analysis to populate real results.</div>}</section>
  </div>
  {analytics?.status==='success'&&<section className={styles.card}><h2>Key relationships</h2><FocusTable analytics={analytics}/></section>}
 </div>
}

function AnalysisWorkspace(props:any){
 const {aoi,setAoi,start,setStart,end,setEnd,layer,setLayer,result,analytics,run,running,perspective}=props;
 return <div className={styles.analysisLayout}>
  <section className={styles.controlBar}>
   <AOIUploader aoi={aoi} setAoi={setAoi}/>
   <label className={styles.compactLabel}>Start<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
   <label className={styles.compactLabel}>End<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
  </section>

  <div className={styles.layerTabs}>{layers.map(x=><button key={x.id} className={layer===x.id?styles.layerActive:''} onClick={()=>setLayer(x.id)}><b>{x.name}</b><span>{x.group}</span></button>)}</div>

  <section className={styles.mapResultCard}>
   <div className={styles.mapTitleRow}><div><h2>{layers.find((x:any)=>x.id===layer)?.name}</h2><p>{layers.find((x:any)=>x.id===layer)?.desc}</p></div><button disabled={running} onClick={()=>run(layer)}>{running?'Processing…':'Generate + Analyze'}</button></div>
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

  {analytics?.status==='running'&&<div className={styles.processing}>{analytics.note}</div>}
  {analytics?.status==='error'&&<div className={styles.errorBox}>Analytics: {analytics.note}</div>}
  {analytics?.status==='success'&&<AnalyticsDashboard analytics={analytics}/>}
 </div>
}

function AnalyticsDashboard({analytics}:{analytics:Analytics}){
 const rows=analytics.rows||[];
 return <div className={styles.analyticsStack}>
  <section className={styles.card}>
   <div className={styles.sectionHead}><div><h2>Temporal trajectories</h2><p>Quarterly AOI means from the declared analysis period.</p></div><span className={styles.pill}>{analytics.analysisId}</span></div>
   <div className={styles.grid2}>
    <div><h3>Spectral recovery indicators</h3><LineChart rows={rows} keys={['NDVI','NDRE','NDMI','BSI']}/></div>
    <div><h3>LST & rainfall</h3><LineChart rows={rows} keys={['LST']}/><LineChart rows={rows} keys={['Rainfall']}/></div>
   </div>
  </section>

  <div className={styles.grid2}>
   <section className={styles.card}><h2>Correlation matrix</h2><CorrelationMatrix analytics={analytics}/></section>
   <section className={styles.card}><h2>Key bivariate models</h2><FocusTable analytics={analytics}/></section>
  </div>

  <section className={styles.card}><h2>Scatterplots & fitted relationships</h2><div className={styles.scatterGrid}>
   {['NDRE','NDMI','BSI','LST','Rainfall'].map(k=><ScatterPlot key={k} rows={rows} xKey={k} yKey="NDVI" model={(analytics.focus||[]).find((x:any)=>x.x===k&&x.y==='NDVI')||(analytics.focus||[]).find((x:any)=>x.x==='NDVI'&&x.y===k)}/>)}
  </div></section>

  <section className={styles.card}><h2>Descriptive statistics</h2><DescriptiveTable analytics={analytics}/></section>

  <div className={styles.grid2}>
   <section className={styles.card}><h2>Multiple regression: NDVI response</h2><MultipleRegression analytics={analytics}/></section>
   <section className={styles.card}><h2>Analytics provenance & limitation</h2><ProvenanceAnalytics analytics={analytics}/></section>
  </div>

  <section className={styles.card}><h2>Quarterly analysis table</h2><RawTable rows={rows}/></section>
 </div>
}

function LineChart({rows,keys}:{rows:any[];keys:string[]}){
 const W=620,H=230,pad=34;
 const validValues=rows.flatMap(r=>keys.map(k=>r[k])).filter(finite).map(Number);
 if(validValues.length<2)return <div className={styles.empty}>Insufficient temporal observations.</div>;
 let min=Math.min(...validValues),max=Math.max(...validValues);if(min===max){min-=1;max+=1}
 const x=(i:number)=>pad+(rows.length<=1?0:i*(W-2*pad)/(rows.length-1));
 const y=(v:number)=>H-pad-(v-min)*(H-2*pad)/(max-min);
 return <div className={styles.svgWrap}><svg viewBox={'0 0 '+W+' '+H} role="img">
  <line x1={pad} y1={H-pad} x2={W-pad} y2={H-pad} className={styles.axis}/><line x1={pad} y1={pad} x2={pad} y2={H-pad} className={styles.axis}/>
  {keys.map((k,ki)=>{const pts=rows.map((r,i)=>finite(r[k])?x(i)+','+y(Number(r[k])):null).filter(Boolean).join(' ');return <polyline key={k} points={pts} fill="none" className={styles['series'+(ki%5)]}/>})}
 </svg><div className={styles.chartLegend}>{keys.map((k,i)=><span key={k}><i className={styles['seriesDot'+(i%5)]}></i>{k}</span>)}</div></div>
}

function ScatterPlot({rows,xKey,yKey,model}:{rows:any[];xKey:string;yKey:string;model:any}){
 const pts=rows.filter(r=>finite(r[xKey])&&finite(r[yKey])).map(r=>({x:Number(r[xKey]),y:Number(r[yKey])}));
 const W=300,H=220,pad=32;if(pts.length<3)return <div className={styles.scatterCard}><b>{yKey} vs {xKey}</b><div className={styles.empty}>Insufficient data</div></div>;
 let xmin=Math.min(...pts.map(p=>p.x)),xmax=Math.max(...pts.map(p=>p.x)),ymin=Math.min(...pts.map(p=>p.y)),ymax=Math.max(...pts.map(p=>p.y));
 if(xmin===xmax){xmin-=1;xmax+=1}if(ymin===ymax){ymin-=1;ymax+=1}
 const sx=(v:number)=>pad+(v-xmin)*(W-2*pad)/(xmax-xmin),sy=(v:number)=>H-pad-(v-ymin)*(H-2*pad)/(ymax-ymin);
 const line=model&&finite(model.slope)&&finite(model.intercept)?[{x:xmin,y:Number(model.intercept)+Number(model.slope)*xmin},{x:xmax,y:Number(model.intercept)+Number(model.slope)*xmax}]:[];
 return <div className={styles.scatterCard}><div className={styles.scatterTitle}><b>{yKey} vs {xKey}</b><span>r={num(model?.r,3)} • R²={num(model?.r2,3)}</span></div><svg viewBox={'0 0 '+W+' '+H}><line x1={pad} y1={H-pad} x2={W-pad} y2={H-pad} className={styles.axis}/><line x1={pad} y1={pad} x2={pad} y2={H-pad} className={styles.axis}/>{pts.map((p,i)=><circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="4" className={styles.point}/>)}
 {line.length===2&&<line x1={sx(line[0].x)} y1={sy(line[0].y)} x2={sx(line[1].x)} y2={sy(line[1].y)} className={styles.regLine}/>}</svg></div>
}

function CorrelationMatrix({analytics}:{analytics:Analytics}){
 const keys=['NDVI','NDRE','NDWI','NDMI','BSI','LST','Rainfall'];
 const corr=(a:string,b:string)=>{if(a===b)return 1;const x=(analytics.correlations||[]).find((r:any)=>(r.x===a&&r.y===b)||(r.x===b&&r.y===a));return x?.r};
 return <div className={styles.matrix}><div></div>{keys.map(k=><b key={'h'+k}>{k}</b>)}{keys.map(a=><div className={styles.matrixRow} key={a}><b>{a}</b>{keys.map(b=>{const r=corr(a,b);const alpha=finite(r)?Math.min(.85,.12+Math.abs(Number(r))*.7):.05;return <span key={b} style={{background:'rgba(44,112,89,'+alpha+')'}}>{finite(r)?Number(r).toFixed(2):'NA'}</span>})}</div>)}</div>
}

function FocusTable({analytics}:{analytics:Analytics}){return <div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr><th>Relationship</th><th>n</th><th>r</th><th>R²</th><th>Slope</th><th>Intercept</th><th>RMSE</th></tr></thead><tbody>{(analytics.focus||[]).map((x:any,i:number)=><tr key={i}><td>{x.y} vs {x.x}</td><td>{x.n}</td><td>{num(x.r,3)}</td><td>{num(x.r2,3)}</td><td>{num(x.slope,4)}</td><td>{num(x.intercept,4)}</td><td>{num(x.rmse,4)}</td></tr>)}</tbody></table></div>}

function DescriptiveTable({analytics}:{analytics:Analytics}){const d=analytics.descriptive||{};return <div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr><th>Variable</th><th>n</th><th>Mean</th><th>SD</th><th>Min</th><th>Q1</th><th>Median</th><th>Q3</th><th>Max</th></tr></thead><tbody>{Object.entries(d).map(([k,v]:any)=><tr key={k}><td>{k}</td><td>{v.n}</td><td>{num(v.mean,3)}</td><td>{num(v.sd,3)}</td><td>{num(v.min,3)}</td><td>{num(v.q1,3)}</td><td>{num(v.median,3)}</td><td>{num(v.q3,3)}</td><td>{num(v.max,3)}</td></tr>)}</tbody></table></div>}

function MultipleRegression({analytics}:{analytics:Analytics}){const m=analytics.multipleRegression||{};if(!m.ok)return <div className={styles.notice}>Model not estimated: {m.note||'insufficient complete observations'} (n={m.n||0}).</div>;return <div><div className={styles.metricStrip}><span>n <b>{m.n}</b></span><span>R² <b>{num(m.r2,3)}</b></span><span>RMSE <b>{num(m.rmse,4)}</b></span><span>MAE <b>{num(m.mae,4)}</b></span></div><div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr><th>Term</th><th>Coefficient</th></tr></thead><tbody>{m.coefficients.map((x:any)=><tr key={x.term}><td>{x.term}</td><td>{num(x.value,6)}</td></tr>)}</tbody></table></div><div className={styles.notice}>Exploratory temporal AOI-mean model. Coefficients can be unstable under multicollinearity and must not be interpreted causally.</div></div>}

function ProvenanceAnalytics({analytics}:{analytics:Analytics}){return <div><div className={styles.kv}>{Object.entries(analytics.provenance||{}).map(([k,v])=><div key={k}><span>{k}</span><b>{String(v)}</b></div>)}<div><span>Analysis ID</span><b>{analytics.analysisId||'—'}</b></div></div><div className={styles.notice}>{analytics.limitations}</div></div>}

function RawTable({rows}:{rows:any[]}){const keys=['period','s2Scenes','landsatScenes','NDVI','NDRE','NDWI','NDMI','BSI','LST','Rainfall'];return <div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr>{keys.map(k=><th key={k}>{k}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{keys.map(k=><td key={k}>{typeof r[k]==='number'?num(r[k],k.includes('Scenes')?0:3):String(r[k]??'NA')}</td>)}</tr>)}</tbody></table></div>}

function GeoMap({aoi,result,perspective}:{aoi:AOI;result:MapResult|null;perspective:boolean}){
 const el=useRef<HTMLDivElement>(null),mapRef=useRef<any>(null),aoiLayer=useRef<any>(null),imgLayer=useRef<any>(null);
 useEffect(()=>{let dead=false;(async()=>{if(!el.current||mapRef.current)return;const L=await import('leaflet');if(dead||!el.current)return;const map=L.map(el.current,{zoomControl:true}).setView([-2.2,115.5],6);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);mapRef.current=map;setTimeout(()=>map.invalidateSize(),150)})();return()=>{dead=true;if(mapRef.current){mapRef.current.remove();mapRef.current=null}}},[]);
 useEffect(()=>{let dead=false;(async()=>{const map=mapRef.current;if(!map)return;const L=await import('leaflet');if(dead)return;if(aoiLayer.current){map.removeLayer(aoiLayer.current);aoiLayer.current=null}if(aoi?.geometry){const x=L.geoJSON(aoi.geometry,{style:{color:'#f7d154',weight:3,fillOpacity:0}}).addTo(map);aoiLayer.current=x;const b=x.getBounds();if(b.isValid())map.fitBounds(b.pad(.05),{maxZoom:14})}})();return()=>{dead=true}},[aoi]);
 useEffect(()=>{let dead=false;(async()=>{const map=mapRef.current;if(!map)return;const L=await import('leaflet');if(dead)return;if(imgLayer.current){map.removeLayer(imgLayer.current);imgLayer.current=null}if(result?.imageUrl&&result.bounds){imgLayer.current=L.imageOverlay(result.imageUrl,result.bounds,{opacity:.78,interactive:false}).addTo(map);if(aoiLayer.current)aoiLayer.current.bringToFront?.()}})();return()=>{dead=true}},[result]);
 return <div className={perspective?styles.perspectiveFrame:styles.flatFrame}><div ref={el} className={styles.realMap}/>{result?.legend&&<div className={styles.floatingLegend}><b>{result.layer}</b>{result.legend.map(x=><div key={x.class}><i style={{background:x.color}}></i><span>{x.label}</span></div>)}</div>}</div>
}

function LegendArea({result}:{result:MapResult}){const area=new Map((result.classArea||[]).map(x=>[Number(x.class),Number(x.areaHa)]));const max=Math.max(1,...Array.from(area.values()));return <div className={styles.legendArea}>{(result.legend||[]).map(x=>{const a=area.get(x.class)||0;return <div key={x.class} className={styles.legendRow}><div className={styles.legendName}><i style={{background:x.color}}></i><div><b>{x.label}</b><span>{rangeText(x,result)}</span></div></div><div className={styles.areaBar}><div style={{width:(a/max*100)+'%',background:x.color}}></div></div><strong>{a.toLocaleString(undefined,{maximumFractionDigits:1})} ha</strong></div>})}</div>}
function rangeText(x:LegendItem,result:MapResult){const f=(n:number|null)=>n==null?'∞':Number(n).toFixed(result.layer==='LST'?2:3);if(x.min==null)return '≤ '+f(x.max);if(x.max==null)return '> '+f(x.min);return f(x.min)+' – '+f(x.max)}
function Stats({result}:{result:MapResult}){return <div className={styles.statsGrid}><div><span>Mean</span><b>{fmt(result.stats?.mean)}</b></div><div><span>Standard deviation</span><b>{fmt(result.stats?.stdDev)}</b></div><div><span>Classification</span><b>{result.methodology?.classes||'—'}</b></div><div><span>Scale</span><b>{result.provenance?.scale?result.provenance.scale+' m':'—'}</b></div><div><span>Analysis ID</span><b>{result.analysisId||'—'}</b></div></div>}
function Methodology({result}:{result:MapResult}){const m=result.methodology||{};return <div className={styles.kv}><div><span>Model type</span><b>{m.type||'—'}</b></div><div><span>Classification</span><b>{m.classes||'—'}</b></div><div><span>Validation</span><b>{m.validation||'—'}</b></div>{m.weights&&<div><span>Weights</span><b>{Object.entries(m.weights).map(([k,v])=>k+' '+Math.round(Number(v)*100)+'%').join(' • ')}</b></div>}</div>}
function Provenance({result}:{result:MapResult}){const p=result.provenance||{};return <div className={styles.kv}><div><span>Analysis ID</span><b>{result.analysisId||'—'}</b></div>{Object.entries(p).map(([k,v])=><div key={k}><span>{k}</span><b>{String(v)}</b></div>)}</div>}

function AOIUploader({aoi,setAoi}:any){const [msg,setMsg]=useState('GeoJSON or zipped Shapefile');async function load(file?:File){if(!file)return;try{let geo:any;const n=file.name.toLowerCase();if(n.endsWith('.zip')){const shp=(await import('shpjs')).default;geo=await shp(await file.arrayBuffer());if(Array.isArray(geo))geo={type:'FeatureCollection',features:geo.flatMap((g:any)=>g?.features||[])}}else if(n.endsWith('.geojson')||n.endsWith('.json'))geo=JSON.parse(await file.text());else throw new Error('Use .geojson/.json or .zip');const fc=geo?.type==='FeatureCollection'?geo:{type:'FeatureCollection',features:geo?.type==='Feature'?[geo]:[]};if(!fc.features?.length)throw new Error('No valid features');setAoi({name:file.name,featureCount:fc.features.length,geometry:fc});setMsg(file.name+' • '+fc.features.length+' feature(s)')}catch(e:any){setAoi(null);setMsg(e?.message||'Failed')}}return <label className={styles.uploadCompact}><span>AOI</span><input type="file" accept=".zip,.geojson,.json" onChange={e=>load(e.target.files?.[0])}/><small>{aoi?msg:'Upload study boundary'}</small></label>}

function ScientificLibrary({layer,setLayer}:any){const x=layers.find((z:any)=>z.id===layer)||layers[0];return <div className={styles.gridMap}><section className={styles.card}><h2>Scientific methods</h2><div className={styles.libraryList}>{layers.map(m=><button key={m.id} className={m.id===layer?styles.libActive:''} onClick={()=>setLayer(m.id)}><b>{m.name}</b><span>{m.group}</span></button>)}</div></section><section className={styles.card}><div className={styles.pill}>{x.group}</div><h2>{x.name}</h2><p>{x.desc}</p><div className={styles.docGrid}>{['Scientific definition','Formula/model','Datasets','Preprocessing','Classification rule','Validation status','Uncertainty','Interpretation boundary','Limitations','References','Method version','Provenance fields'].map(t=><div key={t}><b>{t}</b><span>Version-controlled and exposed with each result.</span></div>)}</div><div className={styles.notice}>Spectral-index classes are AOI-relative unless a literature-backed ecological threshold is explicitly selected. Flood, landslide and erosion outputs remain screening-level susceptibility until locally calibrated and validated.</div></section></div>}
function Help(){return <div className={styles.grid2}><section className={styles.card}><h2>How to use</h2><ol className={styles.steps}><li>Upload AOI.</li><li>Select dates.</li><li>Choose a thematic layer.</li><li>Run Full Analysis.</li><li>Inspect classes, legend and area.</li><li>Review trajectories, correlation matrix and scatterplots.</li><li>Inspect bivariate and multiple-regression metrics.</li><li>Record Analysis ID and provenance for reproducibility.</li></ol></section><section className={styles.card}><h2>Statistical interpretation</h2><p>Correlations and regressions describe temporal AOI-mean associations. They do not establish causality. Results should be interpreted with sample size, model diagnostics, ecological context and local validation data.</p></section></div>}
function Metric({label,value}:{label:string;value:string}){return <div className={styles.metric}><span>{label}</span><b>{value}</b></div>}
function finite(v:any){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))}
function fmt(v:any){return finite(v)?Number(v).toFixed(3):'NA'}
function num(v:any,d=3){return finite(v)?Number(v).toFixed(d):'NA'}
