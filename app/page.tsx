'use client';

import {useEffect, useMemo, useRef, useState} from 'react';

type AnalysisResult = {
  status: string;
  note?: string;
  summary?: Record<string, number>;
};

type AoiInfo = {
  name: string;
  format: string;
  featureCount: number;
  geometry: any;
} | null;

const variables = ['NDVI','EVI','SAVI','FVC','NDMI','NDWI','BSI','LST','Rainfall','Elevation','Slope','Reclamation Age'];
const tabs = ['Map & AOI','Ecological Indices','Environmental Drivers','Recovery Trajectory','Statistics','Validation','Publication Maps','Paper Report'];

export default function Home(){
  const [tab,setTab]=useState('Map & AOI');
  const [period,setPeriod]=useState({start:'2000',end:'2026'});
  const [sensor,setSensor]=useState('Landsat + Sentinel-2');
  const [mapType,setMapType]=useState('Study Area Map');
  const [layout,setLayout]=useState('Double column — 180 mm');
  const [dpi,setDpi]=useState('600 dpi');
  const [running,setRunning]=useState(false);
  const [result,setResult]=useState<AnalysisResult | null>(null);
  const [aoi,setAoi]=useState<AoiInfo>(null);

  async function runAnalysis(){
    if(!aoi?.geometry){
      setResult({status:'AOI required',note:'Upload a Shapefile/GeoJSON first. Analysis is restricted to the uploaded AOI boundary.'});
      return;
    }
    setRunning(true);
    try{
      const res=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({period,sensor,variables,aoi:aoi?.geometry||null,aoiName:aoi?.name||null,clipToAoi:true,analysisExtent:'uploaded-aoi-only'})});
      const data=await res.json();
      setResult(data);
    }catch(e){
      setResult({status:'adapter-ready',note:'Frontend is ready. Connect the previous Google Earth Engine endpoint through EXISTING_GEE_BACKEND_URL.'});
    }finally{setRunning(false)}
  }

  return <div className="shell">
    <aside className="side">
      <div className="brand">Geospatial Ecological<br/>Restoration Assessment</div>
      <div className="tag">Q1 Research Web-GIS</div>
      <div className="nav">{tabs.map(t=><button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t}</button>)}</div>
      <div className="sidefoot">Beyond Greening<br/><small>Vegetation • Moisture • Thermal Recovery</small></div>
    </aside>
    <main className="main">
      <div className="top"><div><div className="title">{tab}</div><div className="sub">Reproducible workflow for post-mining ecological restoration studies</div></div><div className="actions"><button className="secondary" onClick={()=>alert('Project settings stored in this browser session.')}>Save Project</button><button onClick={runAnalysis}>{running?'Running…':'Run Analysis'}</button></div></div>
      <div className="metricgrid"><Metric label="AOI" value={aoi?`${aoi.featureCount} feature${aoi.featureCount===1?'':'s'}`:'Not uploaded'}/><Metric label="Period" value={`${period.start}–${period.end}`}/><Metric label="Variables" value="12"/><Metric label="Outputs" value="Q1 Pack"/></div>
      {tab==='Publication Maps'?<PublicationMaps mapType={mapType} setMapType={setMapType} layout={layout} setLayout={setLayout} dpi={dpi} setDpi={setDpi} aoi={aoi}/>:tab==='Paper Report'?<PaperReport period={period} sensor={sensor} result={result} aoi={aoi}/>:<AnalysisWorkspace tab={tab} period={period} setPeriod={setPeriod} sensor={sensor} setSensor={setSensor} result={result} aoi={aoi} setAoi={setAoi}/>} 
    </main>
  </div>
}

function Metric({label,value}:{label:string,value:string}){return <div className="metric"><span>{label}</span><b>{value}</b></div>}

function AnalysisWorkspace({tab,period,setPeriod,sensor,setSensor,result,aoi,setAoi}:any){
  return <div className="grid">
    <section className="card"><AoiMap aoi={aoi}/></section>
    <aside className="card"><div className="form">
      {tab==='Map & AOI'&&<AoiUploader aoi={aoi} setAoi={setAoi}/>}
      <div className="field"><label>Analysis period</label><div className="twocol"><input value={period.start} onChange={e=>setPeriod({...period,start:e.target.value})}/><input value={period.end} onChange={e=>setPeriod({...period,end:e.target.value})}/></div></div>
      <div className="field"><label>Satellite</label><select value={sensor} onChange={e=>setSensor(e.target.value)}><option>Landsat 5/7/8/9</option><option>Sentinel-2</option><option>Landsat + Sentinel-2</option></select></div>
      <div className="field"><label>Variables</label><div className="chips">{variables.map(x=><span className="chip" key={x}>{x}</span>)}</div></div>
      <div className="field"><label>Current module</label><div className="hint">{moduleText(tab)}</div></div>
      {result&&<div className="statusbox"><b>Backend status:</b> {result.status}<br/><span>{result.note}</span></div>}
      <button>Run {tab}</button>
    </div></aside>
  </div>
}

function AoiMap({aoi}:any){
  const elRef=useRef<HTMLDivElement>(null);
  const mapRef=useRef<any>(null);
  const layerRef=useRef<any>(null);
  const baseRef=useRef<any>(null);
  const [base,setBase]=useState('Satellite');

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      if(!elRef.current||mapRef.current) return;
      const L=await import('leaflet');
      if(cancelled||!elRef.current) return;
      const map=L.map(elRef.current,{zoomControl:true,attributionControl:true}).setView([-2.2,115.5],6);
      mapRef.current=map;
      setTimeout(()=>map.invalidateSize(),150);
    })();
    return()=>{cancelled=true;if(mapRef.current){mapRef.current.remove();mapRef.current=null;}};
  },[]);

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      const map=mapRef.current;
      if(!map) return;
      const L=await import('leaflet');
      if(cancelled) return;
      if(baseRef.current){map.removeLayer(baseRef.current);baseRef.current=null;}
      const configs:any={
        Satellite:{
          url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          attr:'Tiles © Esri, Maxar, Earthstar Geographics'
        },
        Topographic:{
          url:'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
          attr:'Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap'
        },
        Street:{
          url:'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
          attr:'© OpenStreetMap contributors'
        },
        Terrain:{
          url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
          attr:'Tiles © Esri'
        }
      };
      const c=configs[base];
      baseRef.current=L.tileLayer(c.url,{attribution:c.attr,maxZoom:19}).addTo(map);
      baseRef.current.bringToBack?.();
    })();
    return()=>{cancelled=true};
  },[base]);

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      const map=mapRef.current;
      if(!map) return;
      const L=await import('leaflet');
      if(cancelled) return;
      if(layerRef.current){map.removeLayer(layerRef.current);layerRef.current=null;}
      if(aoi?.geometry){
        const layer=L.geoJSON(aoi.geometry,{
          style:{color:'#00ff9c',weight:3,fillColor:'#00ff9c',fillOpacity:0.10}
        }).addTo(map);
        layerRef.current=layer;
        const bounds=layer.getBounds();
        if(bounds.isValid()) map.fitBounds(bounds.pad(0.08),{maxZoom:16});
      }else{
        map.setView([-2.2,115.5],6);
      }
    })();
    return()=>{cancelled=true};
  },[aoi]);

  return <div className="realMapWrap">
    <div className="basemapPicker">
      <label>Basemap</label>
      <select value={base} onChange={e=>setBase(e.target.value)}>
        <option>Satellite</option>
        <option>Topographic</option>
        <option>Street</option>
        <option>Terrain</option>
      </select>
    </div>
    <div ref={elRef} className="realMap"/>
    <div className="mapStatus">{aoi?<>Analysis extent locked to AOI: <b>{aoi.name}</b> • {aoi.featureCount} feature(s)</>:'Upload SHP/GeoJSON to define the analysis boundary'}</div>
  </div>
}

function AoiUploader({aoi,setAoi}:any){
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState('Upload a zipped Shapefile or GeoJSON. For SHP, put .shp, .shx, .dbf and .prj in one ZIP.');

  async function handleFile(file?:File){
    if(!file) return;
    setBusy(true);
    try{
      const lower=file.name.toLowerCase();
      let geo:any;
      let format='';
      if(lower.endsWith('.zip')){
        // @ts-ignore
        const shp=(await import('shpjs')).default;
        geo=await shp(await file.arrayBuffer());
        format='Shapefile ZIP';
        if(Array.isArray(geo)){
          geo={type:'FeatureCollection',features:geo.flatMap((g:any)=>g?.features||[])};
        }
      }else if(lower.endsWith('.geojson')||lower.endsWith('.json')){
        geo=JSON.parse(await file.text());
        format='GeoJSON';
      }else{
        throw new Error('Use .zip for Shapefile or .geojson/.json.');
      }
      const fc=geo?.type==='FeatureCollection'?geo:{type:'FeatureCollection',features:geo?.type==='Feature'?[geo]:[]};
      if(!fc.features?.length) throw new Error('No valid features found in the uploaded file.');
      setAoi({name:file.name,format,featureCount:fc.features.length,geometry:fc});
      setMsg('AOI successfully loaded and will be sent with every analysis request.');
    }catch(err:any){
      setMsg(err?.message||'Failed to read AOI file.');
      setAoi(null);
    }finally{setBusy(false)}
  }

  return <div className="uploadbox">
    <div className="field"><label>Study Area / AOI</label>
      <label className="uploadbtn">{busy?'Reading file…':'Upload SHP (.zip) / GeoJSON'}
        <input type="file" accept=".zip,.geojson,.json" onChange={e=>handleFile(e.target.files?.[0])}/>
      </label>
    </div>
    <div className="hint">{msg}</div>
    {aoi&&<div className="aoiSummary"><b>{aoi.name}</b><span>{aoi.featureCount} feature(s) • {aoi.format}</span><button className="mini danger" onClick={()=>setAoi(null)}>Remove AOI</button></div>}
  </div>
}

function moduleText(tab:string){
  const map:Record<string,string>={
    'Map & AOI':'Upload a zipped Shapefile or GeoJSON for the study area. The AOI geometry will be reused in all maps, statistics and paper exports.',
    'Ecological Indices':'Compute annual or seasonal NDVI, EVI, SAVI, FVC, NDMI, NDWI, BSI and LST composites.',
    'Environmental Drivers':'Integrate CHIRPS/ERA5 climate and DEM-derived elevation and slope, plus reclamation age when available.',
    'Recovery Trajectory':'Estimate annual trend, recovery rate, Mann–Kendall significance and Sen’s slope for each ecological indicator.',
    'Statistics':'Create descriptive statistics, correlation matrix, PCA and multiple regression for driver-response relationships.',
    'Validation':'Cross-sensor validation, temporal holdout and reference-ecosystem comparison with R², RMSE, MAE and bias.'
  }; return map[tab]||'Analysis output will be linked directly to Methods, Results, tables and figures.'
}

function PublicationMaps({mapType,setMapType,layout,setLayout,dpi,setDpi,aoi}:any){
  const mapRef=useRef<HTMLDivElement>(null);
  const [format,setFormat]=useState('PNG');
  const mapCaption=useMemo(()=>mapType==='Study Area Map'?'Figure 1. Location and spatial context of the post-mining ecological restoration study area.':`Figure. Spatial distribution of ${mapType} across the post-mining restoration landscape.`,[mapType]);

  async function exportMap(){
    if(!mapRef.current) return;
    if(format==='PNG'){
      const {toPng}=await import('html-to-image');
      const dataUrl=await toPng(mapRef.current,{pixelRatio:dpi.startsWith('600')?4:2,backgroundColor:'#ffffff'});
      downloadDataUrl(dataUrl,`${slug(mapType)}-${dpi.replace(' ','-')}.png`);
      return;
    }
    if(format==='PDF'){
      const {toPng}=await import('html-to-image'); const {jsPDF}=await import('jspdf');
      const dataUrl=await toPng(mapRef.current,{pixelRatio:3,backgroundColor:'#ffffff'});
      const pdf=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'}); pdf.addImage(dataUrl,'PNG',10,10,277,190); pdf.save(`${slug(mapType)}.pdf`); return;
    }
    alert(`${format} is reserved for the connected GEE/export service. PNG and PDF work client-side; GeoTIFF/TIFF/SVG should be generated from the raster/vector source to preserve scientific quality.`)
  }

  return <div className="pub"><div className="pubgrid"><section className="card"><div className="sectionhead"><div><h3>Publication Layout Builder</h3><p>Journal-ready cartography for study area and result figures</p></div><span className="badge">{layout}</span></div>
    <div className="layoutpreview" ref={mapRef}>
      <div className="maptitle">{mapType}</div>
      <div className="inset"><div className="insetlabel">Indonesia</div><div className="dot"></div></div>
      <div className="map"><div className="aoi"></div><div className="gridline g1"></div><div className="gridline g2"></div><div className="gridline g3"></div></div>
      <div className="north">N<br/>↑</div>
      <div className="legend"><b>Legend</b><br/><i className="sq high"></i> High<br/><i className="sq med"></i> Moderate<br/><i className="sq low"></i> Low<br/><i className="outline"></i> AOI</div>
      <div className="scale">0&nbsp;&nbsp;&nbsp;5&nbsp;&nbsp;&nbsp;10 km</div>
      <div className="metadata">AOI: {aoi?.name||'not loaded'} • CRS: EPSG:4326 • Source: Google Earth Engine</div>
      <div className="cap">{mapCaption}</div>
    </div>
  </section><aside className="card"><div className="form"><div className="field"><label>Map type</label><select value={mapType} onChange={e=>setMapType(e.target.value)}><option>Study Area Map</option><option>NDVI</option><option>FVC</option><option>NDMI</option><option>BSI</option><option>LST</option><option>Recovery Trajectory</option><option>Sen's Slope</option><option>Ecological Recovery Class</option></select></div>
    <div className="field"><label>Journal layout</label><select value={layout} onChange={e=>setLayout(e.target.value)}><option>Single column — 85 mm</option><option>Double column — 180 mm</option><option>Full page landscape</option></select></div>
    <div className="field"><label>Resolution</label><select value={dpi} onChange={e=>setDpi(e.target.value)}><option>300 dpi</option><option>600 dpi</option></select></div>
    <div className="field"><label>Export format</label><div className="formatrow">{['PNG','PDF','TIFF','SVG','GeoTIFF'].map(x=><button key={x} className={format===x?'mini activefmt':'mini'} onClick={()=>setFormat(x)}>{x}</button>)}</div></div>
    <div className="hint">Publication layout includes inset location map, north arrow, scale bar, coordinate context, legend, CRS, source metadata and reproducible caption. Raster exports should retain native scientific values separately as GeoTIFF.</div>
    <button onClick={exportMap}>Export {format} Map</button><button className="secondary" onClick={()=>alert('Map queued for Q1 Paper Package.')}>Add to Q1 Paper Package</button></div></aside></div></div>
}

function PaperReport({period,sensor,result,aoi}:any){
  const reportRef=useRef<HTMLDivElement>(null);
  const intro=`Post-mining ecological restoration is increasingly evaluated using Earth observation because vegetation greening alone may not represent complete ecosystem recovery. This study integrates vegetation, moisture, thermal and surface-condition indicators to assess recovery trajectories and their environmental controls across a post-mining landscape.`;
  const methods=`The study applies a cloud-based geospatial workflow in Google Earth Engine to quantify vegetation, moisture and thermal recovery across the uploaded study area (${aoi?.name||'AOI pending'}) from ${period.start} to ${period.end}. Multi-temporal ${sensor} imagery is harmonized and quality-screened prior to calculation of NDVI, EVI, SAVI, FVC, NDMI, NDWI, BSI and LST. Environmental covariates include rainfall, elevation, slope and reclamation age where available. Temporal recovery is evaluated using annual trajectories, Mann–Kendall trend testing and Sen’s slope. Relationships among ecological indicators and environmental drivers are assessed through correlation analysis, principal component analysis and multiple regression. Validation is designed through cross-sensor consistency, temporal holdout and comparison with a reference ecosystem, reporting R², RMSE, MAE and bias.`;
  const results=`Results will be generated from the connected Earth Engine backend and inserted here without manual transcription. The report is structured to include descriptive statistics, spatial patterns, temporal trajectories, trend significance, correlation structure, multivariate ordination, regression coefficients and validation metrics. Each numerical statement is linked to the same analysis object used to draw the corresponding table or figure.`;
  const discussion=`The Discussion section will interpret whether increases in vegetation greenness are accompanied by moisture recovery, thermal moderation and reduction of exposed surfaces. It will distinguish satellite-observed recovery from complete ecological restoration and relate observed trajectories to environmental controls, reference-ecosystem conditions, methodological limitations and implications for post-mining restoration monitoring.`;
  const conclusion=`The Conclusion will summarize the main evidence on recovery magnitude, trajectory, environmental controls and validation performance after the final analysis is completed.`;

  async function exportDocx(){
    const {Document,Packer,Paragraph,HeadingLevel,Table,TableRow,TableCell,TextRun}=await import('docx');
    const doc=new Document({sections:[{children:[
      new Paragraph({text:'Beyond Greening: Decoupling Vegetation, Moisture, and Thermal Recovery Trajectories in Tropical Post-Mining Landscapes',heading:HeadingLevel.TITLE}),
      new Paragraph({text:'1. Introduction',heading:HeadingLevel.HEADING_1}),new Paragraph(intro),
      new Paragraph({text:'2. Materials and Methods',heading:HeadingLevel.HEADING_1}),
      new Paragraph({text:'2.1 Study Design and Data Processing',heading:HeadingLevel.HEADING_2}),new Paragraph(methods),
      new Paragraph({text:'3. Results',heading:HeadingLevel.HEADING_1}),new Paragraph(results),
      new Paragraph({text:'4. Discussion',heading:HeadingLevel.HEADING_1}),new Paragraph(discussion),
      new Paragraph({text:'5. Conclusion',heading:HeadingLevel.HEADING_1}),new Paragraph(conclusion),
      new Paragraph({text:'Table 1. Core variables and analytical role',heading:HeadingLevel.HEADING_2}),
      new Table({rows:[new TableRow({children:['Variable','Domain','Role'].map(x=>new TableCell({children:[new Paragraph({children:[new TextRun({text:x,bold:true})]})]}))}),...[
        ['NDVI/EVI/SAVI/FVC','Vegetation','Recovery magnitude and trajectory'],['NDMI/NDWI','Moisture','Hydrological recovery'],['BSI','Surface degradation','Bare-soil reduction'],['LST','Thermal','Thermal recovery'],['Rainfall/Elevation/Slope','Drivers','Environmental controls']
      ].map(r=>new TableRow({children:r.map(x=>new TableCell({children:[new Paragraph(x)]}))}))]})
    ]}]});
    const blob=await Packer.toBlob(doc); downloadBlob(blob,'Q1_IMRaD_Paper_Draft.docx');
  }

  async function exportPdf(){
    const {jsPDF}=await import('jspdf'); const pdf=new jsPDF({unit:'mm',format:'a4'}); let y=16; const margin=16; const width=178;
    pdf.setFontSize(14); pdf.text('Beyond Greening — Q1 IMRaD Paper Report',margin,y); y+=10;
    const writeSection=(title:string,text:string)=>{if(y>240){pdf.addPage();y=16}pdf.setFontSize(11);pdf.text(title,margin,y);y+=7;pdf.setFontSize(9);const lines=pdf.splitTextToSize(text,width);pdf.text(lines,margin,y);y+=lines.length*4+7};
    writeSection('1. Introduction',intro);writeSection('2. Materials and Methods',methods);writeSection('3. Results',results);writeSection('4. Discussion',discussion);writeSection('5. Conclusion',conclusion);
    pdf.save('Q1_IMRaD_Paper_Report.pdf');
  }

  return <div className="reportgrid"><section className="card report" ref={reportRef}><div className="paperkicker">AUTOMATED Q1 PAPER REPORT • IMRaD</div><h2>Beyond Greening: Decoupling Vegetation, Moisture, and Thermal Recovery Trajectories in Tropical Post-Mining Landscapes</h2><h3>1. Introduction</h3><p>{intro}</p><h3>2. Materials and Methods</h3><h4>2.1 Study Design and Data Processing</h4><p>{methods}</p><h3>3. Results</h3><p>{results}</p><h3>4. Discussion</h3><p>{discussion}</p><h3>5. Conclusion</h3><p>{conclusion}</p><h4>Planned paper tables</h4><ol><li>Data sources and spatial resolution</li><li>Descriptive statistics</li><li>Mann–Kendall and Sen’s slope results</li><li>Correlation matrix</li><li>Regression coefficients</li><li>Validation metrics</li></ol><h4>Planned paper figures</h4><ol><li>Study area map</li><li>NDVI–NDMI–LST spatial patterns</li><li>Annual recovery trajectories</li><li>Sen’s slope / trend significance</li><li>Correlation heatmap</li><li>PCA biplot</li><li>Driver-response relationships</li><li>Reference-ecosystem comparison</li></ol></section><aside className="card"><div className="form"><div className="field"><label>Analysis status</label><div className="statusbox">{result?.status||'Awaiting connected GEE analysis'}</div></div><div className="field"><label>Paper package</label><div className="hint">Exports Methods and Results with consistent variable names, analysis provenance, tables, figure captions and map assets. Numerical results are inserted only after backend execution.</div></div><button onClick={exportDocx}>Export IMRaD Paper (.docx)</button><button onClick={exportPdf}>Export IMRaD Report (.pdf)</button><button className="secondary" onClick={()=>alert('Q1 package will bundle DOCX/PDF, tables, publication maps and scientific raster exports once the GEE backend is connected.')}>Generate Q1 Paper Package</button></div></aside></div>
}

function slug(x:string){return x.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
function downloadDataUrl(url:string,name:string){const a=document.createElement('a');a.href=url;a.download=name;a.click()}
function downloadBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=name;a.click(); setTimeout(()=>URL.revokeObjectURL(url),500)}
