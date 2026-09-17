import {NextRequest,NextResponse} from 'next/server';

export const runtime='nodejs';
export const maxDuration=60;

const ee=require('@google/earthengine');

function initEarthEngine(){
  return new Promise<void>((resolve,reject)=>{
    const project=process.env.GEE_PROJECT_ID;
    const serviceAccount=process.env.GEE_SERVICE_ACCOUNT;
    const rawKey=process.env.GEE_PRIVATE_KEY;
    if(!project||!serviceAccount||!rawKey){
      reject(new Error('Missing GEE credentials. Add GEE_PROJECT_ID, GEE_SERVICE_ACCOUNT, and GEE_PRIVATE_KEY in Vercel Environment Variables.'));
      return;
    }
    let key:any;
    try{
      key=rawKey.trim().startsWith('{')
        ? JSON.parse(rawKey)
        : {type:'service_account',client_email:serviceAccount,private_key:rawKey.replace(/\\n/g,'\n')};
      if(!key.client_email) key.client_email=serviceAccount;
      if(key.private_key) key.private_key=String(key.private_key).replace(/\\n/g,'\n');
    }catch(err){
      reject(new Error('GEE_PRIVATE_KEY could not be parsed. Use the complete service-account JSON or the PEM private key.'));
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
  const mask=qa.bitwiseAnd(1<<1).eq(0)
    .and(qa.bitwiseAnd(1<<3).eq(0))
    .and(qa.bitwiseAnd(1<<4).eq(0))
    .and(qa.bitwiseAnd(1<<5).eq(0));
  return img.updateMask(mask);
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
    if(!payload?.aoi){
      return NextResponse.json({status:'AOI required',note:'Upload SHP/GeoJSON before running analysis.'},{status:400});
    }
    await initEarthEngine();

    const startYear=Math.max(1984,Number(payload?.period?.start||2000));
    const endYear=Math.min(new Date().getUTCFullYear()+1,Number(payload?.period?.end||2026));
    const start=`${startYear}-01-01`;
    const end=`${endYear+1}-01-01`;
    const aoi=aoiFromGeoJSON(payload.aoi);
    const geom=aoi.geometry();
    const collection=landsatCollection(start,end,geom);
    const count=await evaluate(collection.size());

    if(!count){
      return NextResponse.json({status:'no-data',note:'No Landsat Level-2 scenes were found for this AOI and period.'},{status:422});
    }

    const composite=collection.median().clip(geom);
    const ndviPct=composite.select('NDVI').reduceRegion({
      reducer:ee.Reducer.percentile([5,95]),
      geometry:geom,
      scale:30,
      maxPixels:1e9,
      bestEffort:true
    });
    const p5=ee.Number(ndviPct.get('NDVI_p5'));
    const p95=ee.Number(ndviPct.get('NDVI_p95'));
    const fvc=composite.select('NDVI').subtract(p5).divide(p95.subtract(p5))
      .clamp(0,1).pow(2).rename('FVC');

    const years=Math.max(1,endYear-startYear+1);
    const rain=ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
      .filterDate(start,end).filterBounds(geom).sum().divide(years).rename('Rainfall');
    const elev=ee.Image('USGS/SRTMGL1_003').select('elevation').rename('Elevation');
    const slope=ee.Terrain.slope(elev).rename('Slope');

    const stack=composite.select(['NDVI','EVI','SAVI','NDMI','NDWI','BSI','LST'])
      .addBands(fvc).addBands(rain).addBands(elev).addBands(slope).clip(geom);

    const means=stack.reduceRegion({
      reducer:ee.Reducer.mean(),
      geometry:geom,
      scale:30,
      maxPixels:1e9,
      bestEffort:true
    });

    const std=stack.reduceRegion({
      reducer:ee.Reducer.stdDev(),
      geometry:geom,
      scale:30,
      maxPixels:1e9,
      bestEffort:true
    });

    const areaHa=geom.area(1).divide(10000);

    const yearList=ee.List.sequence(startYear,endYear);
    const annual=ee.FeatureCollection(yearList.map((y:any)=>{
      y=ee.Number(y);
      const ys=ee.Date.fromYMD(y,1,1);
      const ye=ys.advance(1,'year');
      const yearly=collection.filterDate(ys,ye);
      const n=yearly.size();
      const img=ee.Image(ee.Algorithms.If(n.gt(0),yearly.median(),ee.Image.constant(0).rename('NDVI')));
      const val=ee.Algorithms.If(
        n.gt(0),
        img.select('NDVI').reduceRegion({reducer:ee.Reducer.mean(),geometry:geom,scale:30,maxPixels:1e9,bestEffort:true}).get('NDVI'),
        null
      );
      return ee.Feature(null,{year:y,NDVI:val,sceneCount:n});
    }));

    const [meanValues,stdValues,area,annualInfo]=await Promise.all([
      evaluate(means),evaluate(std),evaluate(areaHa),evaluate(annual)
    ]);

    return NextResponse.json({
      status:'success',
      engine:'Google Earth Engine',
      analysisExtent:'uploaded-aoi-only',
      aoiName:payload.aoiName||'AOI',
      areaHa:area,
      period:{start:startYear,end:endYear},
      sceneCount:count,
      summary:meanValues,
      stdDev:stdValues,
      annualNDVI:(annualInfo?.features||[]).map((f:any)=>f.properties),
      notes:{
        reclamationAge:'NA — requires a reclamation-year layer or user-supplied attribute.',
        fvc:'Derived from AOI-specific NDVI 5th and 95th percentiles.',
        rainfall:'Mean annual CHIRPS rainfall across the selected period.',
        spatialScale:'30 m nominal for Landsat-derived summaries.'
      }
    });
  }catch(err:any){
    return NextResponse.json({
      status:'error',
      note:err?.message||String(err)
    },{status:500});
  }
}
