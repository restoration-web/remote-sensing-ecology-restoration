import {NextRequest,NextResponse} from 'next/server';
import {getEarthEngine} from '../../../../lib/earthEngineRuntime';
import {createHash} from 'crypto';

export const runtime='nodejs';
export const maxDuration=300;

let ee:any;

function evaluate(obj:any){return new Promise<any>((resolve,reject)=>obj.evaluate((v:any,e:any)=>e?reject(new Error(String(e))):resolve(v)))}
function aoiFC(fc:any){return ee.FeatureCollection((fc?.features||[]).map((f:any)=>ee.Feature(ee.Geometry(f.geometry),f.properties||{})))}
function finite(v:any){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))}
function maskS2(img:any){
  const scl=img.select('SCL');
  const mask=scl.neq(0).and(scl.neq(1)).and(scl.neq(3)).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
  return img.updateMask(mask).divide(10000).copyProperties(img,['system:time_start']);
}
function spectral(img:any){
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

async function compute(body:any){
  ee=await getEarthEngine();
  if(!body?.aoi?.features?.length)throw new Error('AOI required');
  const start=String(body.start||'2024-01-01'),end=String(body.end||'2026-09-19');
  const geom=aoiFC(body.aoi).geometry();
  const areaHa=Number(await evaluate(geom.area(1).divide(10000)));
  const sampleScale=areaHa>1000000?300:(areaHa>250000?180:(areaHa>50000?120:90));
  const sampleCount=areaHa>1000000?900:(areaHa>250000?1000:1200);

  const s2c=ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate(start,end).filterBounds(geom)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',30)).map(maskS2);
  const s2=ee.Image(ee.Algorithms.If(
    s2c.size().gt(0),
    spectral(s2c.median()),
    ee.Image.constant([0,0,0,0,0,0,0]).rename(['NDVI','NDRE','NDWI','NDMI','EVI','SAVI','BSI']).updateMask(ee.Image.constant(0))
  ));

  const lc=ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
    .filterDate(start,end).filterBounds(geom)
    .filter(ee.Filter.eq('PROCESSING_LEVEL','L2SP')).map(prepLST);
  const lst=ee.Image(ee.Algorithms.If(lc.size().gt(0),lc.median(),ee.Image.constant(0).rename('LST').updateMask(ee.Image.constant(0))));

  const days=ee.Date(end).difference(ee.Date(start),'day').max(1);
  const annualFactor=ee.Number(365.25).divide(days);
  const rainfall=ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY').filterDate(start,end).filterBounds(geom).sum().multiply(annualFactor).rename('Rainfall');

  const dem=ee.Image('USGS/SRTMGL1_003').select('elevation').rename('Elevation');
  const slope=ee.Terrain.slope(dem).rename('Slope');

  const stack=ee.Image.cat([s2,lst,rainfall,dem,slope]).clip(geom);
  const samples=stack.sample({
    region:geom,
    scale:sampleScale,
    numPixels:sampleCount,
    seed:42,
    geometries:false,
    tileScale:8,
    dropNulls:true
  });

  const info=await evaluate(samples.limit(sampleCount));
  const keys=['NDVI','NDRE','NDWI','NDMI','EVI','SAVI','BSI','LST','Rainfall','Elevation','Slope'];
  const rows=(info?.features||[]).map((f:any)=>f.properties||{}).map((r:any)=>{
    const out:any={};
    for(const k of keys)out[k]=finite(r[k])?Number(r[k]):null;
    return out;
  }).filter((r:any)=>keys.some(k=>r[k]!==null));

  const analysisId='GEOECO-S-'+createHash('sha256').update(JSON.stringify({aoi:body.aoi,start,end,scale:sampleScale,seed:42,version:'1.0.0'})).digest('hex').slice(0,12).toUpperCase();
  return {
    status:'success',
    mode:'spatial-sample',
    analysisId,
    rows,
    variables:keys,
    areaHa,
    sampleCountRequested:sampleCount,
    sampleCountReturned:rows.length,
    provenance:{
      version:'GEOECO-SPATIAL-STATS-1.0.0',
      datasets:['Sentinel-2 SR Harmonized','Landsat 8/9 Collection 2 Level-2','CHIRPS','SRTM'],
      start,end,sampleScale,seed:42
    },
    limitations:'Statistics use a reproducible spatial sample from the AOI. Correlation/regression describe spatial association, not causality. Spatial autocorrelation and differing native resolutions should be considered.'
  };
}

export async function POST(req:NextRequest){
  try{return NextResponse.json(await compute(await req.json()))}
  catch(e:any){return NextResponse.json({status:'error',note:e?.message||String(e),stage:'geoeco-spatial-stats'},{status:500})}
}

export async function GET(){
  const aoi={type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[114.55,-3.45],[114.65,-3.45],[114.65,-3.35],[114.55,-3.35],[114.55,-3.45]]]}}]};
  try{
    const x=await compute({aoi,start:'2026-01-01',end:'2026-09-01'});
    return NextResponse.json({status:x.status,analysisId:x.analysisId,sampleCountReturned:x.sampleCountReturned,variables:x.variables,provenance:x.provenance});
  }catch(e:any){return NextResponse.json({status:'error',note:e?.message||String(e),stage:'geoeco-spatial-stats-selftest'},{status:500})}
}
