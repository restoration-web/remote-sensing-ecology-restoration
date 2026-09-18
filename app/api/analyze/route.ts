import {NextRequest,NextResponse} from 'next/server';

export const runtime='nodejs';
export const maxDuration=60;

const ee=require('@google/earthengine');

function initEarthEngine(){
  return new Promise<void>((resolve,reject)=>{
    const envProject=process.env.GEE_PROJECT_ID;
    const envServiceAccount=process.env.GEE_SERVICE_ACCOUNT;
    const rawKey=process.env.GEE_PRIVATE_KEY;
    if(!rawKey){
      reject(new Error('Missing GEE_PRIVATE_KEY in Vercel Environment Variables.'));
      return;
    }
    let key:any;
    let project=envProject;
    try{
      if(rawKey.trim().startsWith('{')){
        key=JSON.parse(rawKey);
        project=key.project_id||envProject;
      }else{
        if(!envProject||!envServiceAccount){
          throw new Error('GEE_PROJECT_ID and GEE_SERVICE_ACCOUNT are required when GEE_PRIVATE_KEY contains only the PEM key.');
        }
        key={type:'service_account',client_email:envServiceAccount,private_key:rawKey.replace(/\\n/g,'\n')};
      }
      if(!key.client_email && envServiceAccount) key.client_email=envServiceAccount;
      if(key.private_key) key.private_key=String(key.private_key).replace(/\\n/g,'\n').trim();
      if(!project) throw new Error('Earth Engine project ID is missing.');
      if(!key.client_email) throw new Error('Service account email is missing.');
      if(!String(key.private_key||'').includes('BEGIN PRIVATE KEY')) throw new Error('Private key PEM header is missing.');
    }catch(err:any){
      reject(new Error('GEE credentials could not be parsed: '+(err?.message||String(err))));
      return;
    }
    ee.data.authenticateViaPrivateKey(
      key,
      ()=>ee.initialize(null,null,()=>resolve(),(e:any)=>reject(new Error('Earth Engine initialization failed: '+String(e))),null,project),
      (e:any)=>reject(new Error('Earth Engine authentication failed: '+String(e)))
    );
  });
}

function evaluate(obj:any){
  return new Promise<any>((resolve,reject)=>{
    obj.evaluate((value:any,error:any)=>error?reject(new Error(String(error))):resolve(value));
  });
}

function aoiFromGeoJSON(fc:any){
  const feats=(fc?.features||[]).map((f:any)=>ee.Feature(ee.Geometry(f.geometry),f.properties||{}));
  return ee.FeatureCollection(feats);
}

function maskLandsat(img:any){
  const qa=img.select('QA_PIXEL');
  const mask=qa.bitwiseAnd(1<<0).eq(0)
    .and(qa.bitwiseAnd(1<<1).eq(0))
    .and(qa.bitwiseAnd(1<<3).eq(0))
    .and(qa.bitwiseAnd(1<<4).eq(0))
    .and(qa.bitwiseAnd(1<<5).eq(0));
  const saturation=img.select('QA_RADSAT').eq(0);
  return img.updateMask(mask).updateMask(saturation);
}

function prepL57(img:any){
  img=maskLandsat(img);
  const optical=img.select(['SR_B1','SR_B2','SR_B3','SR_B4','SR_B5'])
    .multiply(0.0000275).add(-0.2)
    .rename(['Blue','Green','Red','NIR','SWIR1']);
  const lst=img.select('ST_B6').multiply(0.00341802).add(149.0).subtract(273.15).rename('LST');
  return optical.addBands(lst).copyProperties(img,['system:time_start']);
}

function prepL89(img:any){
  img=maskLandsat(img);
  const optical=img.select(['SR_B2','SR_B3','SR_B4','SR_B5','SR_B6'])
    .multiply(0.0000275).add(-0.2)
    .rename(['Blue','Green','Red','NIR','SWIR1']);
  const lst=img.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15).rename('LST');
  return optical.addBands(lst).copyProperties(img,['system:time_start']);
}

function addIndices(img:any){
  const ndvi=img.normalizedDifference(['NIR','Red']).rename('NDVI');
  const ndmi=img.normalizedDifference(['NIR','SWIR1']).rename('NDMI');
  const ndwi=img.normalizedDifference(['Green','NIR']).rename('NDWI');
  const evi=img.expression(
    '2.5*((n-r)/(n+6*r-7.5*b+1))',
    {n:img.select('NIR'),r:img.select('Red'),b:img.select('Blue')}
  ).rename('EVI');
  const savi=img.expression(
    '1.5*((n-r)/(n+r+0.5))',
    {n:img.select('NIR'),r:img.select('Red')}
  ).rename('SAVI');
  const bsi=img.expression(
    '((s+r)-(n+b))/((s+r)+(n+b))',
    {s:img.select('SWIR1'),r:img.select('Red'),n:img.select('NIR'),b:img.select('Blue')}
  ).rename('BSI');
  return img.addBands([ndvi,ndmi,ndwi,evi,savi,bsi]);
}

function landsatCollection(start:string,end:string,aoi:any){
  const l5=ee.ImageCollection('LANDSAT/LT05/C02/T1_L2').filterDate(start,end).filterBounds(aoi).map(prepL57);
  const l7=ee.ImageCollection('LANDSAT/LE07/C02/T1_L2').filterDate(start,end).filterBounds(aoi).map(prepL57);
  const l8=ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').filterDate(start,end).filterBounds(aoi).map(prepL89);
  const l9=ee.ImageCollection('LANDSAT/LC09/C02/T1_L2').filterDate(start,end).filterBounds(aoi).map(prepL89);
  return l5.merge(l7).merge(l8).merge(l9).map(addIndices);
}

export async function POST(req:NextRequest){
  try{
    const payload=await req.json();
    if(!payload?.aoi || payload.aoi?.type!=='FeatureCollection' || !Array.isArray(payload.aoi?.features) || payload.aoi.features.length===0){
      return NextResponse.json({status:'AOI required',note:'Upload a non-empty Shapefile/GeoJSON FeatureCollection before running analysis.'},{status:400});
    }

    const requestedSensor=String(payload?.sensor||'Landsat 5/7/8/9');
    if(requestedSensor!=='Landsat 5/7/8/9'){
      return NextResponse.json({
        status:'unsupported-sensor',
        note:'The current reproducible backend is implemented for Landsat 5/7/8/9 only. Sentinel-2 harmonization has not yet been implemented, so the backend will not silently substitute Landsat.'
      },{status:400});
    }

    const rawStart=Number(payload?.period?.start);
    const rawEnd=Number(payload?.period?.end);
    const currentYear=new Date().getUTCFullYear();
    if(!Number.isInteger(rawStart)||!Number.isInteger(rawEnd)||rawStart<1984||rawEnd>currentYear||rawStart>rawEnd){
      return NextResponse.json({
        status:'invalid-period',
        note:`Use whole years between 1984 and ${currentYear}, with start year less than or equal to end year.`
      },{status:400});
    }

    await initEarthEngine();

    const startYear=rawStart;
    const endYear=rawEnd;
    const start=`${startYear}-01-01`;
    const end=`${endYear+1}-01-01`;
    const aoi=aoiFromGeoJSON(payload.aoi);
    const geom=aoi.geometry();
    const collection=landsatCollection(start,end,geom);
    const count=await evaluate(collection.size());

    if(!count){
      return NextResponse.json({status:'no-data',note:'No Landsat Level-2 scenes were found for this AOI and period.'},{status:422});
    }

    const areaHa=geom.area(1).divide(10000);
    const yearList=ee.List.sequence(startYear,endYear);

    // Memory-safe strategy: reduce one annual composite at a time instead of
    // constructing a 26-year multiband median over the whole AOI.
    const annual=ee.FeatureCollection(yearList.map((y:any)=>{
      y=ee.Number(y);
      const ys=ee.Date.fromYMD(y,1,1);
      const ye=ys.advance(1,'year');
      const yearly=collection.filterDate(ys,ye);
      const n=yearly.size();

      const empty=ee.Image.constant([0,0,0,0,0,0,0])
        .rename(['NDVI','EVI','SAVI','NDMI','NDWI','BSI','LST'])
        .updateMask(ee.Image.constant(0));

      const img=ee.Image(ee.Algorithms.If(
        n.gt(0),
        yearly.select(['NDVI','EVI','SAVI','NDMI','NDWI','BSI','LST']).median(),
        empty
      )).clip(geom);

      const stats=ee.Dictionary(img.reduceRegion({
        reducer:ee.Reducer.mean(),
        geometry:geom,
        scale:60,
        maxPixels:1e8,
        bestEffort:true,
        tileScale:8
      }));

      return ee.Feature(null,stats
        .set('year',y)
        .set('sceneCount',n));
    }));

    const annualInfo=await evaluate(annual);
    const rows=(annualInfo?.features||[]).map((f:any)=>f.properties||{});
    const hasFinite=(v:any)=>v!==null && v!==undefined && v!=='' && Number.isFinite(Number(v));
    const sceneRows=rows.filter((r:any)=>Number(r.sceneCount||0)>0);
    const validRows=sceneRows.filter((r:any)=>hasFinite(r.NDVI));

    if(!validRows.length){
      return NextResponse.json({status:'no-data',note:'Landsat scenes were found, but no valid NDVI observations remained inside the AOI after QA masking.'},{status:422});
    }

    const keys=['NDVI','EVI','SAVI','NDMI','NDWI','BSI','LST'];
    const summary:any={};
    const stdDev:any={};
    for(const k of keys){
      const vals=validRows.filter((r:any)=>hasFinite(r[k])).map((r:any)=>Number(r[k]));
      if(vals.length){
        const mean=vals.reduce((x:number,y:number)=>x+y,0)/vals.length;
        summary[k]=mean;
        stdDev[k]=Math.sqrt(vals.reduce((acc:number,v:number)=>acc+Math.pow(v-mean,2),0)/vals.length);
      }else{
        summary[k]=null;
        stdDev[k]=null;
      }
    }

    // FVC is derived from annual mean NDVI using robust temporal percentiles.
    const ndviVals=validRows.filter((r:any)=>hasFinite(r.NDVI)).map((r:any)=>Number(r.NDVI)).sort((x:number,y:number)=>x-y);
    const q=(arr:number[],p:number)=>{
      if(!arr.length) return NaN;
      const i=(arr.length-1)*p;
      const lo=Math.floor(i), hi=Math.ceil(i);
      return lo===hi?arr[lo]:arr[lo]+(arr[hi]-arr[lo])*(i-lo);
    };
    const p5=q(ndviVals,0.05), p95=q(ndviVals,0.95);
    if(Number.isFinite(summary.NDVI)&&Number.isFinite(p5)&&Number.isFinite(p95)&&p95>p5){
      summary.FVC=Math.max(0,Math.min(1,Math.pow((summary.NDVI-p5)/(p95-p5),2)));
    }else{
      summary.FVC=null;
    }
    stdDev.FVC=null;

    // Static terrain variables are evaluated separately.
    const elev=ee.Image('USGS/SRTMGL1_003').select('elevation').rename('Elevation');
    const slope=ee.Terrain.slope(elev).rename('Slope');
    const terrain=ee.Image.cat([elev,slope]).reduceRegion({
      reducer:ee.Reducer.mean(),
      geometry:geom,
      scale:90,
      maxPixels:1e8,
      bestEffort:true,
      tileScale:8
    });

    // CHIRPS is already coarse-resolution; calculate annual rainfall at 5 km.
    const rainYears=ee.FeatureCollection(yearList.map((y:any)=>{
      y=ee.Number(y);
      const ys=ee.Date.fromYMD(y,1,1);
      const ye=ys.advance(1,'year');
      const rain=ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
        .filterDate(ys,ye).filterBounds(geom).sum().rename('Rainfall');
      const val=rain.reduceRegion({
        reducer:ee.Reducer.mean(),
        geometry:geom,
        scale:5000,
        maxPixels:1e7,
        bestEffort:true,
        tileScale:4
      }).get('Rainfall');
      return ee.Feature(null,{year:y,Rainfall:val});
    }));

    const [area,terrainInfo,rainInfo]=await Promise.all([
      evaluate(areaHa),
      evaluate(terrain),
      evaluate(rainYears)
    ]);

    summary.Elevation=terrainInfo?.Elevation??null;
    summary.Slope=terrainInfo?.Slope??null;
    const rainVals=(rainInfo?.features||[]).map((f:any)=>f.properties?.Rainfall).filter((v:any)=>hasFinite(v)).map((v:any)=>Number(v));
    summary.Rainfall=rainVals.length?rainVals.reduce((x:number,y:number)=>x+y,0)/rainVals.length:null;
    stdDev.Elevation=null;
    stdDev.Slope=null;
    stdDev.Rainfall=null;

    return NextResponse.json({
      status:'success',
      engine:'Google Earth Engine',
      sensor:'Landsat 5/7/8/9 Collection 2 Level 2',
      analysisExtent:'uploaded-aoi-only',
      aoiName:payload.aoiName||'AOI',
      areaHa:area,
      period:{start:startYear,end:endYear},
      sceneCount:count,
      summary:summary,
      stdDev:stdDev,
      annualNDVI:sceneRows.map((r:any)=>({year:r.year,NDVI:hasFinite(r.NDVI)?Number(r.NDVI):null,sceneCount:Number(r.sceneCount||0)})),
      notes:{
        reclamationAge:'NA — requires a reclamation-year layer or user-supplied attribute.',
        fvc:'Temporal NDVI-normalized FVC proxy derived from the 5th and 95th percentiles of annual AOI-mean NDVI; do not interpret as pixel-level fractional vegetation cover until a publication-specific FVC calibration is declared.',
        rainfall:'Mean annual CHIRPS rainfall across the selected period.',
        spatialScale:'Annual Landsat composites summarized at 60 m for memory-safe AOI statistics; terrain at 90 m; rainfall at 5 km.'
      }
    });
  }catch(err:any){
    const message=err?.message||String(err);
    return NextResponse.json({
      status:'error',
      note:message,
      stage:'earth-engine-analysis'
    },{status:500});
  }
}
