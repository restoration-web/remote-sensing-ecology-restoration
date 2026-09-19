import {NextRequest,NextResponse} from 'next/server';

export const runtime='nodejs';
export const maxDuration=300;

let ee:any;
function loadEE(){if(!ee)ee=require('@google/earthengine');return ee;}

function initEE(){
  return new Promise<void>((resolve,reject)=>{
    const raw=process.env.GEE_PRIVATE_KEY;
    const email=process.env.GEE_SERVICE_ACCOUNT;
    let project=process.env.GEE_PROJECT_ID;
    if(!raw){reject(new Error('Missing GEE_PRIVATE_KEY'));return;}
    try{
      let key:any;
      if(raw.trim().startsWith('{')){key=JSON.parse(raw);project=key.project_id||project;}
      else key={type:'service_account',client_email:email,private_key:raw.replace(/\\n/g,'\n')};
      if(!key.client_email&&email)key.client_email=email;
      if(!project)throw new Error('Missing GEE project ID');
      ee.data.authenticateViaPrivateKey(key,
        ()=>ee.initialize(null,null,()=>resolve(),(e:any)=>reject(new Error(String(e))),null,project),
        (e:any)=>reject(new Error(String(e)))
      );
    }catch(e:any){reject(e)}
  });
}
function evaluate(obj:any){return new Promise<any>((resolve,reject)=>obj.evaluate((v:any,e:any)=>e?reject(new Error(String(e))):resolve(v)))}
function aoiFC(fc:any){return ee.FeatureCollection((fc?.features||[]).map((f:any)=>ee.Feature(ee.Geometry(f.geometry),f.properties||{})))}
function maskS2(img:any){
  const scl=img.select('SCL');
  const mask=scl.neq(0).and(scl.neq(1)).and(scl.neq(3)).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
  return img.updateMask(mask).divide(10000).copyProperties(img,['system:time_start']);
}
function s2Indices(img:any){
  const ndvi=img.normalizedDifference(['B8','B4']).rename('NDVI');
  const ndre=img.normalizedDifference(['B8A','B5']).rename('NDRE');
  const ndwi=img.normalizedDifference(['B3','B8']).rename('NDWI');
  const ndmi=img.normalizedDifference(['B8A','B11']).rename('NDMI');
  const evi=img.expression('2.5*((n-r)/(n+6*r-7.5*b+1))',{n:img.select('B8'),r:img.select('B4'),b:img.select('B2')}).rename('EVI');
  const savi=img.expression('1.5*((n-r)/(n+r+0.5))',{n:img.select('B8'),r:img.select('B4')}).rename('SAVI');
  const bsi=img.expression('((s+r)-(n+b))/((s+r)+(n+b))',{s:img.select('B11'),r:img.select('B4'),n:img.select('B8'),b:img.select('B2')}).rename('BSI');
  return ee.Image.cat([ndvi,ndre,ndwi,ndmi,evi,savi,bsi]);
}
function prepLST(img:any){
  const qa=img.select('QA_PIXEL');
  const m=qa.bitwiseAnd(1<<3).eq(0).and(qa.bitwiseAnd(1<<4).eq(0)).and(img.select('QA_RADSAT').eq(0));
  return img.updateMask(m).select('ST_B10').multiply(0.00341802).add(149).subtract(273.15).rename('LST');
}
function periods(start:string,end:string){
  const s=new Date(start+'T00:00:00Z'),e=new Date(end+'T00:00:00Z');
  const out:any[]=[];
  let d=new Date(Date.UTC(s.getUTCFullYear(),Math.floor(s.getUTCMonth()/3)*3,1));
  while(d<=e&&out.length<40){
    const n=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+3,1));
    const stop=n>e?new Date(e.getTime()+86400000):n;
    out.push({start:d.toISOString().slice(0,10),end:stop.toISOString().slice(0,10),period:'Q'+(Math.floor(d.getUTCMonth()/3)+1)+' '+d.getUTCFullYear()});
    d=n;
  }
  return out;
}
function finite(v:any){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))}

export async function POST(req:NextRequest){
  try{
    try{process.chdir('/tmp')}catch{}
    loadEE();
    const p=await req.json();
    if(!p?.aoi?.features?.length)return NextResponse.json({status:'error',note:'AOI required'},{status:400});
    const start=String(p.start||'2024-01-01'),end=String(p.end||'2026-09-19');
    const ps=periods(start,end);
    if(!ps.length)return NextResponse.json({status:'error',note:'Invalid date range'},{status:400});
    await initEE();
    const geom=aoiFC(p.aoi).geometry();
    const areaHa=Number(await evaluate(geom.area(1).divide(10000)));
    const simplifyMeters=areaHa>1000000?250:(areaHa>250000?150:(areaHa>50000?75:30));
    const statGeom=geom.simplify(simplifyMeters);
    const spectralScale=areaHa>1000000?300:(areaHa>250000?180:(areaHa>50000?90:60));

    const feats=ps.map(t=>{
      const s2c=ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterDate(t.start,t.end).filterBounds(statGeom)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',30)).map(maskS2);
      const s2=ee.Image(ee.Algorithms.If(
        s2c.size().gt(0),
        s2Indices(s2c.median()),
        ee.Image.constant([0,0,0,0,0,0,0]).rename(['NDVI','NDRE','NDWI','NDMI','EVI','SAVI','BSI']).updateMask(ee.Image.constant(0))
      ));

      const lc=ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
        .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
        .filterDate(t.start,t.end).filterBounds(statGeom)
        .filter(ee.Filter.eq('PROCESSING_LEVEL','L2SP')).map(prepLST);
      const lst=ee.Image(ee.Algorithms.If(
        lc.size().gt(0),lc.median(),
        ee.Image.constant(0).rename('LST').updateMask(ee.Image.constant(0))
      ));

      const rain=ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY').filterDate(t.start,t.end).filterBounds(statGeom).sum().rename('Rainfall');

      const spectral=ee.Dictionary(ee.Image.cat([s2,lst]).reduceRegion({
        reducer:ee.Reducer.mean(),geometry:statGeom,scale:spectralScale,maxPixels:1e8,bestEffort:true,tileScale:8
      }));
      const rainVal=rain.reduceRegion({
        reducer:ee.Reducer.mean(),geometry:statGeom,scale:5000,maxPixels:1e7,bestEffort:true,tileScale:4
      }).get('Rainfall');

      return ee.Feature(null,spectral
        .set('Rainfall',rainVal)
        .set('period',t.period)
        .set('start',t.start)
        .set('s2Scenes',s2c.size())
        .set('landsatScenes',lc.size()));
    });

    const info=await evaluate(ee.FeatureCollection(feats));
    const rows=(info?.features||[]).map((f:any)=>f.properties||{}).map((r:any)=>({
      period:String(r.period||''),start:String(r.start||''),
      s2Scenes:Number(r.s2Scenes||0),landsatScenes:Number(r.landsatScenes||0),
      NDVI:finite(r.NDVI)?Number(r.NDVI):null,
      NDRE:finite(r.NDRE)?Number(r.NDRE):null,
      NDWI:finite(r.NDWI)?Number(r.NDWI):null,
      NDMI:finite(r.NDMI)?Number(r.NDMI):null,
      EVI:finite(r.EVI)?Number(r.EVI):null,
      SAVI:finite(r.SAVI)?Number(r.SAVI):null,
      BSI:finite(r.BSI)?Number(r.BSI):null,
      LST:finite(r.LST)?Number(r.LST):null,
      Rainfall:finite(r.Rainfall)?Number(r.Rainfall):null
    }));
    return NextResponse.json({
      status:'success',temporalResolution:'quarterly',rows,areaHa,
      provenance:{version:'GEOECO-TEMPORAL-1.0.1',datasets:['Sentinel-2 SR Harmonized','Landsat 8/9 C2 L2','CHIRPS'],start,end,areaHa,spectralScale,simplifyMeters,scalePolicy:'adaptive-by-AOI-area'},
      note:'Quarterly AOI means. Correlation and regression indicate association, not causality.'
    });
  }catch(e:any){
    return NextResponse.json({status:'error',note:e?.message||String(e),stage:'geoeco-temporal'},{status:500});
  }
}
