'use client';

import {useEffect, useMemo, useRef, useState} from 'react';

type AnalysisResult = {
  status: string;
  note?: string;
  stage?: string;
  areaHa?: number;
  sceneCount?: number;
  period?: {start:number; end:number};
  summary?: Record<string, number | null>;
  stdDev?: Record<string, number | null>;
  annualNDVI?: Array<{year:number; NDVI:number | null; sceneCount:number}>;
  annualStats?: Array<Record<string, number | null>>;
  annualRainfall?: Array<{year:number; Rainfall:number | null}>;
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
  const [sensor,setSensor]=useState('Landsat 5/7/8/9');
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

    const startYear=Number(period.start);
    const endYear=Number(period.end);
    const currentYear=new Date().getUTCFullYear();
    if(!Number.isInteger(startYear)||!Number.isInteger(endYear)||startYear<1984||endYear>currentYear||startYear>endYear){
      setResult({status:'invalid-period',note:`Use whole years between 1984 and ${currentYear}, with start year less than or equal to end year.`});
      return;
    }

    setRunning(true);
    setResult(null);

    try{
      const batchSize=4;
      const batches:Array<{start:number;end:number}>=[];
      for(let y=startYear;y<=endYear;y+=batchSize){
        batches.push({start:y,end:Math.min(y+batchSize-1,endYear)});
      }

      const batchResults:any[]=[];
      for(let i=0;i<batches.length;i++){
        const batch=batches[i];
        setResult({
          status:'running',
          note:`Processing batch ${i+1}/${batches.length}: ${batch.start}–${batch.end}`,
          stage:'earth-engine-batch'
        });

        const res=await fetch('/api/analyze',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            period:{start:String(batch.start),end:String(batch.end)},
            sensor,
            variables,
            aoi:aoi.geometry,
            aoiName:aoi.name,
            clipToAoi:true,
            analysisExtent:'uploaded-aoi-only'
          })
        });

        const raw=await res.text();
        let data:any;
        try{
          data=raw?JSON.parse(raw):{};
        }catch{
          throw new Error(`Batch ${batch.start}–${batch.end} returned HTTP ${res.status} with a non-JSON response: ${raw.slice(0,240)||'empty response'}`);
        }

        if(!res.ok){
          throw new Error(data?.note||data?.message||`Batch ${batch.start}–${batch.end} failed with HTTP ${res.status}.`);
        }
        if(data?.status!=='success'){
          throw new Error(data?.note||`Batch ${batch.start}–${batch.end} did not return success.`);
        }
        batchResults.push(data);
      }

      const annualStats=batchResults
        .flatMap(x=>Array.isArray(x.annualStats)?x.annualStats:[])
        .sort((a:any,b:any)=>Number(a.year)-Number(b.year));

      const annualRainfall=batchResults
        .flatMap(x=>Array.isArray(x.annualRainfall)?x.annualRainfall:[])
        .sort((a:any,b:any)=>Number(a.year)-Number(b.year));

      const hasFinite=(v:any)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
      const keys=['NDVI','EVI','SAVI','NDMI','NDWI','BSI','LST'];
      const summary:any={};
      const stdDev:any={};

      for(const k of keys){
        const vals=annualStats.filter((r:any)=>hasFinite(r[k])).map((r:any)=>Number(r[k]));
        if(vals.length){
          const mean=vals.reduce((a:number,b:number)=>a+b,0)/vals.length;
          summary[k]=mean;
          stdDev[k]=Math.sqrt(vals.reduce((acc:number,v:number)=>acc+Math.pow(v-mean,2),0)/vals.length);
        }else{
          summary[k]=null;
          stdDev[k]=null;
        }
      }

      const ndviVals=annualStats.filter((r:any)=>hasFinite(r.NDVI)).map((r:any)=>Number(r.NDVI)).sort((a:number,b:number)=>a-b);
      const q=(arr:number[],p:number)=>{
        if(!arr.length) return NaN;
        const idx=(arr.length-1)*p;
        const lo=Math.floor(idx), hi=Math.ceil(idx);
        return lo===hi?arr[lo]:arr[lo]+(arr[hi]-arr[lo])*(idx-lo);
      };
      const p5=q(ndviVals,0.05);
      const p95=q(ndviVals,0.95);
      summary.FVC=Number.isFinite(summary.NDVI)&&Number.isFinite(p5)&&Number.isFinite(p95)&&p95>p5
        ? Math.max(0,Math.min(1,Math.pow((summary.NDVI-p5)/(p95-p5),2)))
        : null;
      stdDev.FVC=null;

      const rainVals=annualRainfall.filter((r:any)=>hasFinite(r.Rainfall)).map((r:any)=>Number(r.Rainfall));
      summary.Rainfall=rainVals.length?rainVals.reduce((a:number,b:number)=>a+b,0)/rainVals.length:null;
      stdDev.Rainfall=null;

      const first=batchResults[0]||{};
      const terrainKeys=['Elevation','Slope'];
      for(const k of terrainKeys){
        const vals=batchResults.map(x=>x?.summary?.[k]).filter((v:any)=>hasFinite(v)).map((v:any)=>Number(v));
        summary[k]=vals.length?vals.reduce((a:number,b:number)=>a+b,0)/vals.length:null;
        stdDev[k]=null;
      }

      const sceneCount=batchResults.reduce((acc:number,x:any)=>acc+Number(x?.sceneCount||0),0);
      const areaVals=batchResults.map(x=>x?.areaHa).filter((v:any)=>hasFinite(v)).map((v:any)=>Number(v));
      const areaHa=areaVals.length?areaVals[0]:null;

      setResult({
        status:'success',
        note:`Completed ${batches.length} Earth Engine batches for ${startYear}–${endYear}.`,
        stage:'merged-client-result',
        areaHa:areaHa??undefined,
        sceneCount,
        period:{start:startYear,end:endYear},
        summary,
        stdDev,
        annualStats,
        annualRainfall,
        annualNDVI:annualStats.map((r:any)=>({
          year:Number(r.year),
          NDVI:hasFinite(r.NDVI)?Number(r.NDVI):null,
          sceneCount:Number(r.sceneCount||0)
        }))
      });
    }catch(e:any){
      setResult({
        status:'error',
        note:e?.message||String(e),
        stage:'batch-or-merge'
      });
    }finally{
      setRunning(false);
    }
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
      {tab==='Publication Maps'?<PublicationMaps mapType={mapType} setMapType={setMapType} layout={layout} setLayout={setLayout} dpi={dpi} setDpi={setDpi} aoi={aoi}/>:tab==='Paper Report'?<PaperReport period={period} sensor={sensor} result={result} aoi={aoi}/>:<AnalysisWorkspace tab={tab} period={period} setPeriod={setPeriod} sensor={sensor} setSensor={setSensor} result={result} aoi={aoi} setAoi={setAoi} runAnalysis={runAnalysis} running={running}/>} 
    </main>
  </div>
}

function Metric({label,value}:{label:string,value:string}){return <div className="metric"><span>{label}</span><b>{value}</b></div>}

function AnalysisWorkspace({tab,period,setPeriod,sensor,setSensor,result,aoi,setAoi,runAnalysis,running}:any){
  if(tab!=='Map & AOI'){
    return <div className="moduleShell">
      <section className="card moduleIntro">
        <div><h3>{tab}</h3><p>{moduleText(tab)}</p></div>
        <button onClick={runAnalysis} disabled={running}>{running?'Running…':`Refresh ${tab}`}</button>
      </section>
      {result&&<div className="statusbox"><b>Backend status:</b> {result.status}{result.stage?<> • <b>Stage:</b> {result.stage}</>:null}<br/><span>{result.note||'Request completed.'}</span></div>}
      {result?.status==='success'?<ModuleDashboard tab={tab} result={result}/>:<div className="card emptyState">Run the analysis first to populate this module with real Earth Engine results.</div>}
    </div>
  }

  return <div className="grid">
    <section className="card"><AoiMap aoi={aoi}/></section>
    <aside className="card"><div className="form">
      <AoiUploader aoi={aoi} setAoi={setAoi}/>
      <div className="field"><label>Analysis period</label><div className="twocol"><input value={period.start} onChange={e=>setPeriod({...period,start:e.target.value})}/><input value={period.end} onChange={e=>setPeriod({...period,end:e.target.value})}/></div></div>
      <div className="field"><label>Satellite</label><select value={sensor} onChange={e=>setSensor(e.target.value)}><option>Landsat 5/7/8/9</option><option disabled>Sentinel-2 — harmonization pending</option><option disabled>Landsat + Sentinel-2 — harmonization pending</option></select><div className="hint">Current reproducible backend uses Landsat Collection 2 Level 2 only. Sentinel-2 will be enabled after a declared harmonization method is implemented.</div></div>
      <div className="field"><label>Variables</label><div className="chips">{variables.map(x=><span className="chip" key={x}>{x}</span>)}</div></div>
      <div className="field"><label>Current module</label><div className="hint">{moduleText(tab)}</div></div>
      {result&&<div className="statusbox"><b>Backend status:</b> {result.status}{result.stage?<> • <b>Stage:</b> {result.stage}</>:null}<br/><span>{result.note||'Request completed.'}</span></div>}
      {result?.status==='success'&&<ResultSummary result={result}/>}
      <button onClick={runAnalysis} disabled={running}>{running?'Running…':'Run Map & AOI'}</button>
    </div></aside>
  </div>
}

function ResultSummary({result}:any){
  const keys=['NDVI','EVI','SAVI','FVC','NDMI','NDWI','BSI','LST','Rainfall','Elevation','Slope'];
  return <div className="resultPanel">
    <div className="resultHead"><b>Analysis Results</b><span>{Number(result.areaHa||0).toLocaleString(undefined,{maximumFractionDigits:1})} ha • {result.sceneCount||0} Landsat scenes</span></div>
    <div className="resultGrid">{keys.map(k=><div className="resultItem" key={k}><span>{k}</span><b>{result.summary?.[k]==null?'NA':Number(result.summary[k]).toFixed(k==='LST'?2:3)}</b></div>)}</div>
    {Array.isArray(result.annualNDVI)&&result.annualNDVI.length>0&&<div className="trendMini">
      <div className="trendTitle">Annual NDVI trajectory</div>
      <div className="trendBars">{result.annualNDVI.filter((x:any)=>x.NDVI!=null).map((x:any)=><div key={x.year} title={`${x.year}: ${Number(x.NDVI).toFixed(3)}`} className="trendBar" style={{height:`${Math.max(4,Math.min(60,(Number(x.NDVI)+0.2)*55))}px`}}></div>)}</div>
      <div className="trendYears"><span>{result.period?.start}</span><span>{result.period?.end}</span></div>
    </div>}
  </div>
}


function ModuleDashboard({tab,result}:any){
  const annual=mergeAnnual(result);
  if(tab==='Ecological Indices') return <EcologicalIndicesDashboard result={result} annual={annual}/>;
  if(tab==='Environmental Drivers') return <DriversDashboard result={result} annual={annual}/>;
  if(tab==='Recovery Trajectory') return <RecoveryDashboard result={result} annual={annual}/>;
  if(tab==='Statistics') return <StatisticsDashboard result={result} annual={annual}/>;
  if(tab==='Validation') return <ValidationDashboard result={result} annual={annual}/>;
  return <ResultSummary result={result}/>;
}

function mergeAnnual(result:any){
  const rain=new Map((result?.annualRainfall||[]).map((r:any)=>[Number(r.year),r.Rainfall]));
  return (result?.annualStats||[]).map((r:any)=>({...r,Rainfall:rain.get(Number(r.year))??null})).sort((a:any,b:any)=>Number(a.year)-Number(b.year));
}

function EcologicalIndicesDashboard({result,annual}:any){
  return <div className="moduleGrid">
    <section className="card span2"><h3>Vegetation recovery indices</h3><p className="muted">Annual AOI means from Landsat Collection 2 Level 2.</p><MultiLineChart rows={annual} keys={['NDVI','EVI','SAVI']} /></section>
    <section className="card"><h3>Moisture & surface condition</h3><MultiLineChart rows={annual} keys={['NDMI','NDWI','BSI']} /></section>
    <section className="card"><h3>Thermal trajectory</h3><MultiLineChart rows={annual} keys={['LST']} /></section>
    <section className="card span2"><ResultSummary result={result}/></section>
  </div>
}

function DriversDashboard({result,annual}:any){
  return <div className="moduleGrid">
    <section className="card span2"><h3>Annual rainfall</h3><p className="muted">CHIRPS mean annual rainfall over the AOI.</p><MultiLineChart rows={annual} keys={['Rainfall']} /></section>
    <section className="card"><h3>Terrain</h3><div className="bigMetric">{fmt(result?.summary?.Elevation,2)} <small>m elevation</small></div><div className="bigMetric">{fmt(result?.summary?.Slope,2)} <small>° mean slope</small></div></section>
    <section className="card"><h3>Reclamation age</h3><div className="naBox">NA</div><p className="muted">Requires a reclamation-year layer or user-supplied attribute. No value is inferred.</p></section>
    <section className="card span2"><h3>Driver-response view</h3><ScatterPlot rows={annual} xKey="Rainfall" yKey="NDVI" xLabel="Rainfall (mm/year)" yLabel="NDVI"/></section>
  </div>
}

function RecoveryDashboard({result,annual}:any){
  const vars=['NDVI','EVI','SAVI','NDMI','BSI','LST'];
  const stats=vars.map(k=>({variable:k,...trendStats(annual,k)}));
  return <div className="moduleGrid">
    <section className="card span2"><h3>Annual NDVI recovery trajectory</h3><MultiLineChart rows={annual} keys={['NDVI']} /></section>
    <section className="card span2"><h3>Mann–Kendall & Sen’s slope</h3><div className="tableWrap"><table className="dataTable"><thead><tr><th>Variable</th><th>n</th><th>Sen slope/year</th><th>Kendall S</th><th>Z</th><th>p (approx.)</th></tr></thead><tbody>{stats.map((r:any)=><tr key={r.variable}><td>{r.variable}</td><td>{r.n}</td><td>{fmt(r.sen,5)}</td><td>{r.S}</td><td>{fmt(r.z,3)}</td><td>{fmt(r.p,4)}</td></tr>)}</tbody></table></div></section>
  </div>
}

function StatisticsDashboard({result,annual}:any){
  const statKeys=['NDVI','EVI','SAVI','NDMI','NDWI','BSI','LST','Rainfall'];
  const desc=statKeys.map(k=>({k,...describe(annual,k)}));
  const corrKeys=['NDVI','NDMI','BSI','LST','Rainfall'];
  const reg=multipleRegression(annual,'NDVI',['NDMI','BSI','LST','Rainfall']);
  const pca=pca2(annual,['NDVI','EVI','SAVI','NDMI','NDWI','BSI','LST','Rainfall']);
  return <div className="moduleGrid">
    <section className="card span2"><h3>Descriptive statistics</h3><div className="tableWrap"><table className="dataTable"><thead><tr><th>Variable</th><th>n</th><th>Mean</th><th>SD</th><th>Min</th><th>Max</th></tr></thead><tbody>{desc.map((r:any)=><tr key={r.k}><td>{r.k}</td><td>{r.n}</td><td>{fmt(r.mean,3)}</td><td>{fmt(r.sd,3)}</td><td>{fmt(r.min,3)}</td><td>{fmt(r.max,3)}</td></tr>)}</tbody></table></div></section>
    <section className="card span2"><h3>Pearson correlation matrix</h3><CorrelationMatrix rows={annual} keys={corrKeys}/></section>
    <section className="card"><h3>NDVI vs LST</h3><ScatterPlot rows={annual} xKey="LST" yKey="NDVI" xLabel="LST (°C)" yLabel="NDVI"/></section>
    <section className="card"><h3>NDVI vs NDMI</h3><ScatterPlot rows={annual} xKey="NDMI" yKey="NDVI" xLabel="NDMI" yLabel="NDVI"/></section>
    <section className="card span2"><h3>Multiple regression</h3><p className="muted">Response: annual NDVI; predictors: NDMI, BSI, LST and rainfall. This is a temporal AOI-mean model, not a pixel-level spatial regression.</p>{reg.ok?<><div className="metricStrip"><span>R² <b>{fmt(reg.r2,3)}</b></span><span>RMSE <b>{fmt(reg.rmse,4)}</b></span><span>MAE <b>{fmt(reg.mae,4)}</b></span><span>n <b>{reg.n}</b></span></div><div className="tableWrap"><table className="dataTable"><thead><tr><th>Term</th><th>Coefficient</th></tr></thead><tbody>{reg.coefs.map((x:any)=><tr key={x.term}><td>{x.term}</td><td>{fmt(x.value,6)}</td></tr>)}</tbody></table></div></>:<div className="naBox">Regression unavailable: {reg.note}</div>}</section>
    <section className="card span2"><h3>PCA (standardized annual observations)</h3>{pca.ok?<><div className="metricStrip"><span>PC1 variance <b>{fmt(pca.pc1Pct,1)}%</b></span><span>PC2 variance <b>{fmt(pca.pc2Pct,1)}%</b></span><span>n <b>{pca.n}</b></span></div><div className="tableWrap"><table className="dataTable"><thead><tr><th>Variable</th><th>PC1 loading</th><th>PC2 loading</th></tr></thead><tbody>{pca.loadings.map((x:any)=><tr key={x.variable}><td>{x.variable}</td><td>{fmt(x.pc1,3)}</td><td>{fmt(x.pc2,3)}</td></tr>)}</tbody></table></div></>:<div className="naBox">PCA unavailable: {pca.note}</div>}</section>
  </div>
}

function ValidationDashboard({result,annual}:any){
  const hold=temporalHoldout(annual);
  const validYears=annual.filter((r:any)=>finite(r.NDVI)).length;
  const totalYears=annual.length;
  return <div className="moduleGrid">
    <section className="card"><h3>Data completeness</h3><div className="bigMetric">{validYears}/{totalYears} <small>years with valid NDVI</small></div><div className="bigMetric">{result?.sceneCount||0} <small>Landsat scenes</small></div></section>
    <section className="card"><h3>Cross-sensor validation</h3><div className="naBox">Pending</div><p className="muted">Sentinel-2 harmonization is not yet implemented; no cross-sensor metric is fabricated.</p></section>
    <section className="card span2"><h3>Temporal holdout diagnostic</h3><p className="muted">First 80% of valid annual NDVI observations fit a linear year trend; final 20% are held out. This is an internal temporal diagnostic, not independent field validation.</p>{hold.ok?<div className="metricStrip"><span>R² <b>{fmt(hold.r2,3)}</b></span><span>RMSE <b>{fmt(hold.rmse,4)}</b></span><span>MAE <b>{fmt(hold.mae,4)}</b></span><span>Bias <b>{fmt(hold.bias,4)}</b></span></div>:<div className="naBox">{hold.note}</div>}</section>
    <section className="card span2"><h3>Reference ecosystem validation</h3><div className="naBox">Needs reference AOI</div><p className="muted">A reference ecosystem boundary or field plots must be supplied before calculating recovery distance or project-level validation claims.</p></section>
  </div>
}

function MultiLineChart({rows,keys}:{rows:any[];keys:string[]}){
  const data=rows.filter(r=>keys.some(k=>finite(r[k])));
  if(!data.length) return <div className="naBox">No annual observations available.</div>;
  const W=760,H=260,p=38;
  const vals=data.flatMap(r=>keys.map(k=>Number(r[k])).filter(Number.isFinite));
  let min=Math.min(...vals),max=Math.max(...vals); if(min===max){min-=1;max+=1}
  const x=(i:number)=>p+(i/(Math.max(1,data.length-1)))*(W-2*p);
  const y=(v:number)=>H-p-((v-min)/(max-min))*(H-2*p);
  return <div className="svgWrap"><svg viewBox={`0 0 ${W} ${H}`} role="img">
    <line x1={p} y1={H-p} x2={W-p} y2={H-p} className="axisLine"/><line x1={p} y1={p} x2={p} y2={H-p} className="axisLine"/>
    {[0,.25,.5,.75,1].map(t=><g key={t}><line x1={p} y1={p+t*(H-2*p)} x2={W-p} y2={p+t*(H-2*p)} className="gridSvg"/><text x={5} y={p+t*(H-2*p)+4} className="svgText">{fmt(max-t*(max-min),2)}</text></g>)}
    {keys.map((k,ki)=>{const pts=data.map((r,i)=>finite(r[k])?`${x(i)},${y(Number(r[k]))}`:null).filter(Boolean).join(' ');return <polyline key={k} points={pts} className={`seriesLine s${ki%6}`} fill="none"/>})}
    <text x={p} y={H-8} className="svgText">{data[0]?.year}</text><text x={W-p-30} y={H-8} className="svgText">{data[data.length-1]?.year}</text>
  </svg><div className="chartLegend">{keys.map((k,i)=><span key={k}><i className={`legendDot s${i%6}`}></i>{k}</span>)}</div></div>
}

function ScatterPlot({rows,xKey,yKey,xLabel,yLabel}:any){
  const pts=rows.filter((r:any)=>finite(r[xKey])&&finite(r[yKey])).map((r:any)=>({x:Number(r[xKey]),y:Number(r[yKey]),year:r.year}));
  if(pts.length<3) return <div className="naBox">Insufficient paired observations.</div>;
  const W=520,H=260,p=40; const xs=pts.map(x=>x.x),ys=pts.map(x=>x.y);
  let xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys); if(xmin===xmax){xmin-=1;xmax+=1} if(ymin===ymax){ymin-=1;ymax+=1}
  const X=(v:number)=>p+((v-xmin)/(xmax-xmin))*(W-2*p); const Y=(v:number)=>H-p-((v-ymin)/(ymax-ymin))*(H-2*p);
  const rr=pearsonPairs(pts.map(o=>[o.x,o.y]));
  return <div className="svgWrap"><svg viewBox={`0 0 ${W} ${H}`}><line x1={p} y1={H-p} x2={W-p} y2={H-p} className="axisLine"/><line x1={p} y1={p} x2={p} y2={H-p} className="axisLine"/>{pts.map((o,i)=><circle key={i} cx={X(o.x)} cy={Y(o.y)} r="4" className="scatterDot"><title>{o.year}: {xLabel}={fmt(o.x,3)}, {yLabel}={fmt(o.y,3)}</title></circle>)}<text x={W/2-40} y={H-7} className="svgText">{xLabel}</text><text x={8} y={18} className="svgText">{yLabel}</text></svg><div className="chartFooter">Pearson r = <b>{fmt(rr,3)}</b> • n = {pts.length}</div></div>
}

function CorrelationMatrix({rows,keys}:any){
  return <div className="tableWrap"><table className="dataTable corrTable"><thead><tr><th></th>{keys.map((k:string)=><th key={k}>{k}</th>)}</tr></thead><tbody>{keys.map((a:string)=><tr key={a}><th>{a}</th>{keys.map((b:string)=><td key={b}>{fmt(correlation(rows,a,b),2)}</td>)}</tr>)}</tbody></table></div>
}

function finite(v:any){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))}
function fmt(v:any,d=3){return finite(v)?Number(v).toFixed(d):'NA'}
function values(rows:any[],k:string){return rows.filter(r=>finite(r[k])).map(r=>Number(r[k]))}
function describe(rows:any[],k:string){const a=values(rows,k);if(!a.length)return{n:0,mean:null,sd:null,min:null,max:null};const mean=a.reduce((x,y)=>x+y,0)/a.length;const sd=Math.sqrt(a.reduce((s,v)=>s+(v-mean)**2,0)/Math.max(1,a.length-1));return{n:a.length,mean,sd,min:Math.min(...a),max:Math.max(...a)}}
function pearsonPairs(pairs:number[][]){if(pairs.length<3)return null;const xs=pairs.map(p=>p[0]),ys=pairs.map(p=>p[1]);const mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length;let num=0,dx=0,dy=0;for(let i=0;i<xs.length;i++){const a=xs[i]-mx,b=ys[i]-my;num+=a*b;dx+=a*a;dy+=b*b}return dx>0&&dy>0?num/Math.sqrt(dx*dy):null}
function correlation(rows:any[],a:string,b:string){return pearsonPairs(rows.filter(r=>finite(r[a])&&finite(r[b])).map(r=>[Number(r[a]),Number(r[b])]))}

function trendStats(rows:any[],k:string){
  const pts=rows.filter(r=>finite(r[k])&&finite(r.year)).map(r=>({x:Number(r.year),y:Number(r[k])}));
  const n=pts.length;if(n<3)return{n,S:null,z:null,p:null,sen:null};
  let S=0;const slopes:number[]=[];for(let i=0;i<n-1;i++)for(let j=i+1;j<n;j++){S+=Math.sign(pts[j].y-pts[i].y);slopes.push((pts[j].y-pts[i].y)/(pts[j].x-pts[i].x))}
  const variance=n*(n-1)*(2*n+5)/18;const z=S>0?(S-1)/Math.sqrt(variance):S<0?(S+1)/Math.sqrt(variance):0;const p=2*(1-normalCdf(Math.abs(z)));slopes.sort((a,b)=>a-b);const m=Math.floor(slopes.length/2);const sen=slopes.length%2?slopes[m]:(slopes[m-1]+slopes[m])/2;return{n,S,z,p,sen};
}
function normalCdf(x:number){return .5*(1+erf(x/Math.sqrt(2)))}
function erf(x:number){const sign=x<0?-1:1;const a=Math.abs(x),t=1/(1+.3275911*a);const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-a*a);return sign*y}

function solve(A:number[][],b:number[]){const n=A.length;const M=A.map((r,i)=>[...r,b[i]]);for(let i=0;i<n;i++){let m=i;for(let j=i+1;j<n;j++)if(Math.abs(M[j][i])>Math.abs(M[m][i]))m=j;[M[i],M[m]]=[M[m],M[i]];if(Math.abs(M[i][i])<1e-10)return null;const d=M[i][i];for(let j=i;j<=n;j++)M[i][j]/=d;for(let r=0;r<n;r++)if(r!==i){const f=M[r][i];for(let j=i;j<=n;j++)M[r][j]-=f*M[i][j]}}return M.map(r=>r[n])}
function multipleRegression(rows:any[],yKey:string,xKeys:string[]){
  const clean=rows.filter(r=>finite(r[yKey])&&xKeys.every(k=>finite(r[k])));if(clean.length<xKeys.length+3)return{ok:false,n:clean.length,note:'insufficient complete annual observations'};
  const X=clean.map(r=>[1,...xKeys.map(k=>Number(r[k]))]),y=clean.map(r=>Number(r[yKey]));const p=X[0].length;const XtX=Array.from({length:p},()=>Array(p).fill(0)),Xty=Array(p).fill(0);
  for(let i=0;i<X.length;i++)for(let a=0;a<p;a++){Xty[a]+=X[i][a]*y[i];for(let b=0;b<p;b++)XtX[a][b]+=X[i][a]*X[i][b]}
  const beta=solve(XtX,Xty);if(!beta)return{ok:false,n:clean.length,note:'singular predictor matrix'};
  const pred=X.map(r=>r.reduce((s,v,j)=>s+v*beta[j],0)),mean=y.reduce((a,b)=>a+b,0)/y.length;const ssr=y.reduce((s,v,i)=>s+(v-pred[i])**2,0),sst=y.reduce((s,v)=>s+(v-mean)**2,0);return{ok:true,n:y.length,r2:sst>0?1-ssr/sst:null,rmse:Math.sqrt(ssr/y.length),mae:y.reduce((s,v,i)=>s+Math.abs(v-pred[i]),0)/y.length,coefs:[{term:'Intercept',value:beta[0]},...xKeys.map((k,i)=>({term:k,value:beta[i+1]}))]};
}
function temporalHoldout(rows:any[]){
  const pts=rows.filter(r=>finite(r.year)&&finite(r.NDVI)).map(r=>({x:Number(r.year),y:Number(r.NDVI)}));if(pts.length<8)return{ok:false,note:'At least 8 valid annual observations are required.'};const cut=Math.max(3,Math.floor(pts.length*.8));const train=pts.slice(0,cut),test=pts.slice(cut);const mx=train.reduce((s,p)=>s+p.x,0)/train.length,my=train.reduce((s,p)=>s+p.y,0)/train.length;const den=train.reduce((s,p)=>s+(p.x-mx)**2,0);if(!den)return{ok:false,note:'Year variance is zero.'};const slope=train.reduce((s,p)=>s+(p.x-mx)*(p.y-my),0)/den,intercept=my-slope*mx;const pred=test.map(p=>intercept+slope*p.x),ys=test.map(p=>p.y),mean=ys.reduce((a,b)=>a+b,0)/ys.length;const sse=ys.reduce((s,v,i)=>s+(v-pred[i])**2,0),sst=ys.reduce((s,v)=>s+(v-mean)**2,0);return{ok:true,r2:sst>0?1-sse/sst:null,rmse:Math.sqrt(sse/ys.length),mae:ys.reduce((s,v,i)=>s+Math.abs(v-pred[i]),0)/ys.length,bias:ys.reduce((s,v,i)=>s+(pred[i]-v),0)/ys.length};
}

function pca2(rows:any[],keys:string[]){
  const clean=rows.filter(r=>keys.every(k=>finite(r[k])));const n=clean.length,m=keys.length;if(n<Math.max(6,m))return{ok:false,n,note:'insufficient complete annual observations'};
  const Z=clean.map(r=>keys.map(k=>Number(r[k])));for(let j=0;j<m;j++){const a=Z.map(r=>r[j]),mu=a.reduce((x,y)=>x+y,0)/n,sd=Math.sqrt(a.reduce((s,v)=>s+(v-mu)**2,0)/(n-1));if(sd===0)return{ok:false,n,note:`zero variance in ${keys[j]}`};for(let i=0;i<n;i++)Z[i][j]=(Z[i][j]-mu)/sd}
  const C=Array.from({length:m},()=>Array(m).fill(0));for(let a=0;a<m;a++)for(let b=0;b<m;b++)C[a][b]=Z.reduce((s,r)=>s+r[a]*r[b],0)/(n-1);
  const eig=(M:number[][],seed:number[])=>{let v=seed.slice();for(let it=0;it<100;it++){const w=M.map(r=>r.reduce((s,x,j)=>s+x*v[j],0));const norm=Math.sqrt(w.reduce((s,x)=>s+x*x,0))||1;v=w.map(x=>x/norm)}const Mv=M.map(r=>r.reduce((s,x,j)=>s+x*v[j],0));const val=v.reduce((s,x,i)=>s+x*Mv[i],0);return{v,val}};
  const e1=eig(C,Array(m).fill(1));const D=C.map((r,i)=>r.map((x,j)=>x-e1.val*e1.v[i]*e1.v[j]));const e2=eig(D,Array.from({length:m},(_,i)=>i%2?1:-1));const total=C.reduce((s,r,i)=>s+r[i],0);return{ok:true,n,pc1Pct:100*e1.val/total,pc2Pct:100*e2.val/total,loadings:keys.map((k,i)=>({variable:k,pc1:e1.v[i],pc2:e2.v[i]}))};
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
