'use client';

import {useMemo, useState} from 'react';
import styles from './page.module.css';

const methods = [
  {id:'GEOECO-NDVI-001',name:'NDVI',group:'Earth Observation',status:'Established',evidence:'A',res:'10 m',note:'Vegetation greenness from Sentinel-2 B8/B4.'},
  {id:'GEOECO-NDRE-001',name:'NDRE',group:'Earth Observation',status:'Literature-supported',evidence:'A',res:'20 m',note:'Red-edge response using B8A/B5.'},
  {id:'GEOECO-NDMI-001',name:'NDMI',group:'Earth Observation',status:'Established',evidence:'A',res:'20 m',note:'Canopy/moisture spectral response using B8A/B11.'},
  {id:'GEOECO-BSI-001',name:'BSI',group:'Land Condition',status:'Literature-supported',evidence:'A',res:'20 m',note:'Bare-soil-like spectral response.'},
  {id:'GEOECO-LST-001',name:'LST',group:'Thermal',status:'Established',evidence:'A',res:'30 m',note:'Landsat Collection 2 Level-2 surface temperature.'},
  {id:'GEOECO-RUSLE-001',name:'RUSLE Soil Erosion',group:'Land Degradation',status:'Established',evidence:'A',res:'Model-dependent',note:'Annual sheet and rill erosion estimate.'},
  {id:'GEOECO-FLOOD-001',name:'Flood Susceptibility',group:'Disaster Susceptibility',status:'Literature-supported',evidence:'C/B',res:'Model-dependent',note:'Relative susceptibility; not flood depth or return period.'},
  {id:'GEOECO-LANDSLIDE-001',name:'Landslide Susceptibility',group:'Disaster Susceptibility',status:'Literature-supported',evidence:'C/B',res:'Model-dependent',note:'Relative susceptibility; not event timing or loss.'},
];

const nav = ['Dashboard','Map & AOI','Analysis','Scientific Library','Projects','My Data','Help'];

export default function GeoEcoPage(){
  const [active,setActive]=useState('Dashboard');
  const [selected,setSelected]=useState(methods[0].id);
  const method=useMemo(()=>methods.find(m=>m.id===selected)!,[selected]);

  return <main className={styles.shell}>
    <aside className={styles.sidebar}>
      <div>
        <div className={styles.brand}>GeoEco AI</div>
        <div className={styles.tag}>Geospatial Environmental Intelligence</div>
      </div>
      <nav className={styles.nav}>{nav.map(n=><button key={n} className={active===n?styles.active:''} onClick={()=>setActive(n)}>{n}</button>)}</nav>
      <div className={styles.sideFoot}>Scientific Core v1.0<br/><span>Transparent • Traceable • Reproducible</span></div>
    </aside>

    <section className={styles.content}>
      <header className={styles.header}>
        <div><div className={styles.kicker}>SCIENTIFIC WEB-GIS PLATFORM</div><h1>{active}</h1><p>Remote sensing, environmental modelling, provenance, validation, and scientific interpretation in one reproducible workflow.</p></div>
        <div className={styles.actions}><button className={styles.secondary}>New Project</button><button>Run Analysis</button></div>
      </header>

      {active==='Dashboard' && <Dashboard setActive={setActive}/>}
      {active==='Map & AOI' && <MapWorkspace/>}
      {active==='Analysis' && <Analysis selected={selected} setSelected={setSelected} method={method}/>}
      {active==='Scientific Library' && <Library selected={selected} setSelected={setSelected}/>}
      {active==='Projects' && <Simple title="Projects" body="Project IDs, AOIs, method versions, parameters, timestamps, outputs, and reproducibility packages will be stored here."/>}
      {active==='My Data' && <Simple title="My Data" body="User-owned AOIs, generated results, exports, and archived analysis packages will appear here after authentication and database integration."/>}
      {active==='Help' && <Help/>}
    </section>
  </main>
}

function Dashboard({setActive}:{setActive:(x:string)=>void}){
  return <div className={styles.stack}>
    <div className={styles.metrics}>
      <Metric label="Scientific methods" value="8"/>
      <Metric label="Evidence levels" value="A–D"/>
      <Metric label="Core sensors" value="S2 + Landsat"/>
      <Metric label="System status" value="Core v1"/>
    </div>
    <div className={styles.grid2}>
      <section className={styles.card}>
        <div className={styles.cardHead}><div><h2>Integrated analysis workflow</h2><p>Every result follows the same auditable scientific chain.</p></div><button onClick={()=>setActive('Analysis')}>Open analysis</button></div>
        <div className={styles.flow}>
          {['AOI','Method Registry','QA/QC','Earth Engine','Statistics','Validation','Interpretation','Provenance'].map((x,i)=><div key={x} className={styles.flowItem}><b>{i+1}</b><span>{x}</span></div>)}
        </div>
      </section>
      <section className={styles.card}>
        <h2>Scientific safeguards</h2>
        <ul className={styles.checks}>
          <li>No universal threshold presented as fact.</li>
          <li>Native, analysis, and display resolution are separated.</li>
          <li>Susceptibility is not labelled as hazard or risk.</li>
          <li>NoData and masked pixels are not treated as zero.</li>
          <li>GeoAI interprets calculated outputs; it does not invent numbers.</li>
          <li>Every analysis stores method version and provenance.</li>
        </ul>
      </section>
    </div>
    <section className={styles.card}>
      <div className={styles.cardHead}><div><h2>Core scientific modules</h2><p>Methods currently locked for MVP development.</p></div><button className={styles.secondary} onClick={()=>setActive('Scientific Library')}>Scientific Library</button></div>
      <div className={styles.methodGrid}>{methods.map(m=><div className={styles.methodCard} key={m.id}><div className={styles.methodTop}><span>{m.group}</span><b>Level {m.evidence}</b></div><h3>{m.name}</h3><p>{m.note}</p><div className={styles.meta}><span>{m.id}</span><span>{m.res}</span></div></div>)}</div>
    </section>
  </div>
}

function MapWorkspace(){
  return <div className={styles.gridMap}>
    <section className={styles.mapCard}>
      <div className={styles.mapToolbar}><span>Interactive AOI Workspace</span><div><button className={styles.secondary}>Draw AOI</button><button className={styles.secondary}>Upload GeoJSON/SHP</button></div></div>
      <div className={styles.mapFake}>
        <div className={styles.gridLines}></div>
        <div className={styles.landA}></div><div className={styles.landB}></div><div className={styles.aoiShape}></div>
        <div className={styles.mapLegend}><b>AOI</b><span><i></i> Selected boundary</span><span>CRS / scale recorded at analysis time</span></div>
      </div>
    </section>
    <aside className={styles.card}>
      <h2>AOI controls</h2>
      <label className={styles.label}>Project name<input placeholder="e.g. Post-Mining Restoration 2026"/></label>
      <label className={styles.label}>Start date<input type="date" defaultValue="2026-01-01"/></label>
      <label className={styles.label}>End date<input type="date" defaultValue="2026-09-19"/></label>
      <label className={styles.label}>Composite<select defaultValue="Median"><option>Median</option><option>Mean</option><option>Single best scene</option></select></label>
      <div className={styles.notice}>Geometry validation, CRS, scale, valid-pixel coverage, and scene metadata will be checked before production analysis.</div>
      <button>Validate AOI</button>
    </aside>
  </div>
}

function Analysis({selected,setSelected,method}:{selected:string;setSelected:(x:string)=>void;method:any}){
  return <div className={styles.gridMap}>
    <section className={styles.card}>
      <h2>Select scientific method</h2>
      <div className={styles.selectGrid}>{methods.map(m=><button key={m.id} className={selected===m.id?styles.selectedMethod:''} onClick={()=>setSelected(m.id)}><b>{m.name}</b><span>{m.group}</span></button>)}</div>
      <div className={styles.resultMock}>
        <div className={styles.cardHead}><div><h2>Result workspace</h2><p>Production output will combine map, QA/QC, statistics, charts, validation, interpretation, limitations, and references.</p></div><span className={styles.pill}>Preview</span></div>
        <div className={styles.chart}><div style={{height:'32%'}}></div><div style={{height:'48%'}}></div><div style={{height:'71%'}}></div><div style={{height:'60%'}}></div><div style={{height:'84%'}}></div><div style={{height:'75%'}}></div><div style={{height:'90%'}}></div></div>
      </div>
    </section>
    <aside className={styles.card}>
      <div className={styles.pill}>{method.status}</div><h2>{method.name}</h2><p>{method.note}</p>
      <dl className={styles.details}><div><dt>Method ID</dt><dd>{method.id}</dd></div><div><dt>Evidence</dt><dd>Level {method.evidence}</dd></div><div><dt>Resolution</dt><dd>{method.res}</dd></div><div><dt>Output status</dt><dd>Scientific method locked</dd></div></dl>
      <div className={styles.notice}>Production runs will store AOI hash, parameter hash, method version, sensor/dataset IDs, cloud-mask method, analysis grid, valid coverage, processing timestamp, and code version.</div>
      <button>Run {method.name}</button>
    </aside>
  </div>
}

function Library({selected,setSelected}:{selected:string;setSelected:(x:string)=>void}){
  const m=methods.find(x=>x.id===selected) || methods[0];
  return <div className={styles.gridMap}>
    <section className={styles.card}><h2>Method Registry</h2><div className={styles.libraryList}>{methods.map(x=><button className={selected===x.id?styles.libActive:''} key={x.id} onClick={()=>setSelected(x.id)}><b>{x.name}</b><span>{x.id}</span></button>)}</div></section>
    <article className={styles.card}><div className={styles.pill}>Evidence Level {m.evidence}</div><h2>{m.name}</h2><p>{m.note}</p>
      <h3>Scientific documentation structure</h3>
      <div className={styles.docGrid}>{['Definition','Formula / Model','Dataset & Sensor','Band / Variables','Native Resolution','Pre-processing','Quality Control','Validation','Interpretation Boundary','Limitations','References','Method Version'].map(x=><div key={x}><b>{x}</b><span>Version-controlled in production registry.</span></div>)}</div>
      <div className={styles.notice}>Scientific Library references will be limited to verified peer-reviewed literature, foundational publications, and official dataset documentation.</div>
    </article>
  </div>
}

function Help(){
 return <div className={styles.grid2}><section className={styles.card}><h2>How to use GeoEco AI</h2><ol className={styles.steps}><li>Create a project.</li><li>Draw or upload a valid AOI.</li><li>Select a scientific method.</li><li>Set dates and method parameters.</li><li>Review data-quality checks.</li><li>Run the analysis.</li><li>Inspect map, statistics, charts, validation, and limitations.</li><li>Export the reproducibility package and report.</li></ol></section><section className={styles.card}><h2>Scientific principle</h2><p>GeoEco AI is designed as a decision-support and research platform. Outputs are explicitly labelled according to what a method actually estimates. A susceptibility model is not presented as event probability, NDVI is not presented as biomass, and LST is not presented as air temperature.</p><div className={styles.notice}>Scientific outputs remain open to evaluation and critique; the platform is designed to make the evidence, assumptions, and limitations transparent.</div></section></div>
}

function Simple({title,body}:{title:string;body:string}){return <section className={styles.card}><h2>{title}</h2><p>{body}</p><div className={styles.empty}>Backend integration is the next implementation step.</div></section>}
function Metric({label,value}:{label:string;value:string}){return <div className={styles.metric}><span>{label}</span><b>{value}</b></div>}
