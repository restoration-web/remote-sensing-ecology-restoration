import {NextRequest,NextResponse} from 'next/server';

export const runtime='nodejs';
export const maxDuration=300;
try{process.chdir('/tmp')}catch{}\nconst ee=require('@google/earthengine');

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
function evalEE(obj:any){return new Promise<any>((resolve,reject)=>obj.evaluate((v:any,e:any)=>e?reject(new Error(String(e))):resolve(v)))}
function aoiFC(fc:any){return ee.FeatureCollection((fc?.features||[]).map((f:any)=>ee.Feature(ee.Geometry(f.geometry),f.properties||{})))}
function boundsFromGeoJSON(fc:any){
  const pts:number[][]=[];
  const walk=(x:any)=>{if(!Array.isArray(x))return;if(typeof x[0]==='number'&&typeof x[1]==='number')pts.push([x[0],x[1]]);else x.forEach(walk)};
  (fc?.features||[]).forEach((f:any)=>walk(f?.geometry?.coordinates));
  if(!pts.length)return null;
  const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
  return [[Math.min(...ys),Math.min(...xs)],[Math.max(...ys),Math.max(...xs)]];
}
function maskS2(img:any){
  const scl=img.select('SCL');
  const mask=scl.neq(0).and(scl.neq(1)).and(scl.neq(3)).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
  return img.updateMask(mask).divide(10000).copyProperties(img,['system:time_start']);
}
function s2Composite(start:string,end:string,geom:any){
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterDate(start,end).filterBounds(geom).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',30)).map(maskS2).median().clip(geom);
}
function indicatorImage(name:string,start:string,end:string,geom:any){
  if(['NDVI','NDRE','NDWI','NDMI','BSI'].includes(name)){
    const s2=s2Composite(start,end,geom);
    if(name==='NDVI')return s2.normalizedDifference(['B8','B4']).rename('value');
    if(name==='NDRE')return s2.normalizedDifference(['B8A','B5']).rename('value');
    if(name==='NDWI')return s2.normalizedDifference(['B3','B8']).rename('value');
    if(name==='NDMI')return s2.normalizedDifference(['B8A','B11']).rename('value');
    return s2.expression('((s+r)-(n+b))/((s+r)+(n+b))',{s:s2.select('B11'),r:s2.select('B4'),n:s2.select('B8'),b:s2.select('B2')}).rename('value');
  }
  if(name==='LST'){
    const prep=(img:any)=>{
      const qa=img.select('QA_PIXEL');
      const m=qa.bitwiseAnd(1<<3).eq(0).and(qa.bitwiseAnd(1<<4).eq(0)).and(img.select('QA_RADSAT').eq(0));
      return img.updateMask(m).select('ST_B10').multiply(0.00341802).add(149).subtract(273.15).rename('value');
    };
    return ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
      .filterDate(start,end).filterBounds(geom).filter(ee.Filter.eq('PROCESSING_LEVEL','L2SP')).map(prep).median().clip(geom);
  }
  throw new Error('Unsupported indicator');
}
function minMax(img:any,geom:any,scale:number){
  return img.reduceRegion({reducer:ee.Reducer.minMax(),geometry:geom,scale,maxPixels:1e8,bestEffort:true,tileScale:4});
}
function normalize(img:any,min:any,max:any){return img.subtract(min).divide(ee.Number(max).subtract(min)).clamp(0,1)}
function modelImage(name:string,start:string,end:string,geom:any){
  const dem=ee.Image('USGS/SRTMGL1_003').select('elevation').clip(geom);
  const slope=ee.Terrain.slope(dem);
  const rain=ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY').filterDate(start,end).filterBounds(geom).sum().rename('rain').clip(geom);
  const ndvi=indicatorImage('NDVI',start,end,geom);
  if(name==='FLOOD'){
    const demMM=minMax(dem,geom,90),slMM=minMax(slope,geom,90),raMM=minMax(rain,geom,5000);
    return ee.Image(ee.Algorithms.If(true,
      normalize(dem,demMM.get('elevation_min'),demMM.get('elevation_max')).multiply(-1).add(1).multiply(.35)
      .add(normalize(slope,slMM.get('slope_min'),slMM.get('slope_max')).multiply(-1).add(1).multiply(.25))
      .add(normalize(rain,raMM.get('rain_min'),raMM.get('rain_max')).multiply(.25))
      .add(normalize(ndvi,-1,1).multiply(-1).add(1).multiply(.15))
    )).rename('value').clamp(0,1);
  }
  if(name==='LANDSLIDE'){
    const demMM=minMax(dem,geom,90),slMM=minMax(slope,geom,90),raMM=minMax(rain,geom,5000);
    return normalize(slope,slMM.get('slope_min'),slMM.get('slope_max')).multiply(.45)
      .add(normalize(rain,raMM.get('rain_min'),raMM.get('rain_max')).multiply(.30))
      .add(normalize(dem,demMM.get('elevation_min'),demMM.get('elevation_max')).multiply(.10))
      .add(normalize(ndvi,-1,1).multiply(-1).add(1).multiply(.15)).rename('value').clamp(0,1);
  }
  if(name==='EROSION'){
    const slMM=minMax(slope,geom,90),raMM=minMax(rain,geom,5000);
    return normalize(slope,slMM.get('slope_min'),slMM.get('slope_max')).multiply(.45)
      .add(normalize(rain,raMM.get('rain_min'),raMM.get('rain_max')).multiply(.30))
      .add(normalize(ndvi,-1,1).multiply(-1).add(1).multiply(.25)).rename('value').clamp(0,1);
  }
  throw new Error('Unsupported model');
}
function classified(img:any,thresholds:number[]){
  let cls=ee.Image(1);
  thresholds.forEach((t,i)=>{cls=cls.where(img.gt(t),i+2)});
  return cls.rename('class').updateMask(img.mask());
}
async function thumb(img:any,geom:any,palette:string[],min:number,max:number){
  return img.getThumbURL({region:geom,bbox:null,dimensions:1200,format:'png',min,max,palette});
}
async function areaByClass(cls:any,geom:any,scale:number){
  const grouped=ee.Image.pixelArea().divide(10000).rename('ha').addBands(cls).reduceRegion({
    reducer:ee.Reducer.sum().group({groupField:1,groupName:'class'}),geometry:geom,scale,maxPixels:1e8,bestEffort:true,tileScale:4
  });
  const x=await evalEE(grouped);return x?.groups||[];
}
const palettes={
  index:['#7f3b08','#b35806','#f1a340','#998ec3','#542788'],
  temp:['#313695','#74add1','#ffffbf','#f46d43','#a50026'],
  risk:['#2c7bb6','#abd9e9','#ffffbf','#fdae61','#d7191c']
};
export async function POST(req:NextRequest){
 try{
  const p=await req.json();
  if(!p?.aoi?.features?.length)return NextResponse.json({status:'error',note:'AOI required'},{status:400});
  await initEE();
  const geom=aoiFC(p.aoi).geometry();
  const start=String(p.start||'2024-01-01'),end=String(p.end||'2026-12-31');
  const layer=String(p.layer||'NDVI').toUpperCase();
  const isModel=['FLOOD','LANDSLIDE','EROSION'].includes(layer);
  const img=isModel?modelImage(layer,start,end,geom):indicatorImage(layer,start,end,geom);
  const scale=layer==='LST'?60:(isModel?90:20);
  const stats=await evalEE(img.reduceRegion({reducer:ee.Reducer.mean().combine({reducer2:ee.Reducer.stdDev(),sharedInputs:true}).combine({reducer2:ee.Reducer.percentile([20,40,60,80]),sharedInputs:true}),geometry:geom,scale,maxPixels:1e8,bestEffort:true,tileScale:4}));
  const thresholds=isModel?[.2,.4,.6,.8]:[stats.value_p20,stats.value_p40,stats.value_p60,stats.value_p80].map(Number);
  if(thresholds.some((x:number)=>!Number.isFinite(x)))throw new Error('Insufficient valid pixels for classification');
  const cls=classified(img,thresholds);
  const palette=isModel?palettes.risk:(layer==='LST'?palettes.temp:palettes.index);
  const [imageUrl,classArea]=await Promise.all([thumb(cls,geom,palette,1,5),areaByClass(cls,geom,scale)]);
  const labels=isModel?['Very Low','Low','Moderate','High','Very High']:['Very Low','Low','Moderate','High','Very High'];
  const legend=labels.map((label,i)=>({class:i+1,label,color:palette[i],min:i===0?null:thresholds[i-1],max:i===4?null:thresholds[i]}));
  return NextResponse.json({
   status:'success',layer,imageUrl,bounds:boundsFromGeoJSON(p.aoi),legend,
   stats:{mean:stats.value_mean,stdDev:stats.value_stdDev,thresholds},
   classArea:classArea.map((g:any)=>({class:g.class,areaHa:g.sum})),
   methodology:isModel?{
     type:'relative susceptibility screening',normalization:'AOI min-max',classes:'fixed 0.2 intervals on 0–1 composite',
     weights:layer==='FLOOD'?{lowElevation:.35,lowSlope:.25,rainfall:.25,lowNDVI:.15}:layer==='LANDSLIDE'?{slope:.45,rainfall:.30,elevation:.10,lowNDVI:.15}:{slope:.45,rainfall:.30,lowNDVI:.25},
     validation:'Not locally validated'
   }:{type:'relative AOI quintile visualization',classes:'P20/P40/P60/P80',validation:'Spectral index; no local ecological threshold implied'},
   provenance:{analysisVersion:'GEOECO-ENGINE-1.2.0',dataset:layer==='LST'?'Landsat 8/9 Collection 2 Level-2':isModel?'SRTM + CHIRPS + Sentinel-2':'Sentinel-2 SR Harmonized',start,end,scale}
  });
 }catch(e:any){return NextResponse.json({status:'error',note:e?.message||String(e)},{status:500})}
}
