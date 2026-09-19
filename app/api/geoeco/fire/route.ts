import {NextRequest,NextResponse} from 'next/server';
import {getEarthEngine} from '../../../../lib/earthEngineRuntime';

export const runtime='nodejs';
export const maxDuration=300;
let ee:any;

function evalEE(obj:any){return new Promise<any>((resolve,reject)=>obj.evaluate((v:any,e:any)=>e?reject(new Error(String(e))):resolve(v)))}
function aoiFC(fc:any){return ee.FeatureCollection((fc?.features||[]).map((f:any)=>ee.Feature(ee.Geometry(f.geometry),f.properties||{})))}
function maskS2(img:any){
  const scl=img.select('SCL');
  const mask=scl.neq(0).and(scl.neq(1)).and(scl.neq(3)).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
  return img.updateMask(mask).divide(10000).copyProperties(img,['system:time_start']);
}
function recentS2(end:string,geom:any){
  const e=ee.Date(end).advance(1,'day'),s=e.advance(-45,'day');
  const c=ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate(s,e).filterBounds(geom).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',35)).map(maskS2);
  const comp=c.median().clip(geom);
  const ndvi=comp.normalizedDifference(['B8','B4']).rename('NDVI');
  const ndmi=comp.normalizedDifference(['B8A','B11']).rename('NDMI');
  const bsi=comp.expression('((sw+r)-(n+b))/((sw+r)+(n+b))',{sw:comp.select('B11'),r:comp.select('B4'),n:comp.select('B8'),b:comp.select('B2')}).rename('BSI');
  return ee.Image.cat([ndvi,ndmi,bsi]);
}
function boundsFromGeoJSON(fc:any){
  const pts:number[][]=[];const walk=(x:any)=>{if(!Array.isArray(x))return;if(typeof x[0]==='number'&&typeof x[1]==='number')pts.push([x[0],x[1]]);else x.forEach(walk)};
  (fc?.features||[]).forEach((f:any)=>walk(f?.geometry?.coordinates));
  if(!pts.length)return null;const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
  return [[Math.min(...ys),Math.min(...xs)],[Math.max(...ys),Math.max(...xs)]];
}
function haversineKm(a:any,b:any){
  const R=6371,toRad=(d:number)=>d*Math.PI/180;
  const dLat=toRad(b.lat-a.lat),dLon=toRad(b.lon-a.lon);
  const x=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

export async function POST(req:NextRequest){
 try{
  ee=await getEarthEngine();
  const p=await req.json();
  if(!p?.aoi?.features?.length)return NextResponse.json({status:'error',note:'AOI required'},{status:400});
  const geom=aoiFC(p.aoi).geometry();
  const end=String(p.end||new Date().toISOString().slice(0,10));
  const days=Math.min(30,Math.max(1,Number(p.days||7)));
  const responseWindowMinutes=Math.min(720,Math.max(15,Number(p.responseWindowMinutes||60)));
  const e=ee.Date(end).advance(1,'day'),s=e.advance(-days,'day');

  const snpp=ee.ImageCollection('NASA/LANCE/SNPP_VIIRS/C2').filterDate(s,e).filterBounds(geom);
  const noaa=ee.ImageCollection('NASA/LANCE/NOAA20_VIIRS/C2').filterDate(s,e).filterBounds(geom);
  const col=snpp.merge(noaa).sort('system:time_start');
  const imageCount=Number(await evalEE(col.size()));

  if(!imageCount){
    return NextResponse.json({
      status:'success',source:'NASA FIRMS / VIIRS 375 m NRT via Google Earth Engine',
      period:{days,end},bounds:boundsFromGeoJSON(p.aoi),points:[],
      summary:{count:0,frpMean:null,frpMax:null,highConfidenceCount:0,nominalOrHighCount:0,latestEpoch:null},
      goldenTime:null,
      spreadProxy:{available:false,note:'No VIIRS hotspot detections are available in the AOI and selected period.'},
      vegetationContext:null,
      scientificNote:'No active-fire detections were found for the AOI and selected period. Zero detections do not prove that no fire occurred; cloud, overpass timing, sensor limits, and fire size can affect detection.',
      provenance:{datasets:['NASA/LANCE/SNPP_VIIRS/C2','NASA/LANCE/NOAA20_VIIRS/C2'],hotspotResolutionM:375,responseWindowMinutes,imageCount:0}
    });
  }

  const frpMax=col.select('frp').max().rename('frp').clip(geom);
  const validCountRaw=await evalEE(frpMax.gt(0).selfMask().reduceRegion({
    reducer:ee.Reducer.count(),geometry:geom,scale:375,maxPixels:1e7,bestEffort:true,tileScale:4
  }).get('frp'));
  const validHotspotPixels=Number(validCountRaw||0);

  if(!validHotspotPixels){
    return NextResponse.json({
      status:'success',source:'NASA FIRMS / VIIRS 375 m NRT via Google Earth Engine',
      period:{days,end},bounds:boundsFromGeoJSON(p.aoi),points:[],
      summary:{count:0,frpMean:null,frpMax:null,highConfidenceCount:0,nominalOrHighCount:0,latestEpoch:null},
      goldenTime:null,
      spreadProxy:{available:false,note:'No VIIRS hotspot pixels were detected in the AOI and selected period.'},
      vegetationContext:null,
      scientificNote:'No active-fire detections were found for the AOI and selected period. Zero detections do not prove that no fire occurred; cloud, overpass timing, sensor limits, and fire size can affect detection.',
      provenance:{datasets:['NASA/LANCE/SNPP_VIIRS/C2','NASA/LANCE/NOAA20_VIIRS/C2'],hotspotResolutionM:375,responseWindowMinutes,imageCount,validHotspotPixels:0}
    });
  }

  const hotspotMask=frpMax.gt(0).selfMask();
  const latest=col.qualityMosaic('acq_epoch').clip(geom);
  const fireBands=latest.select(['frp','confidence','Bright_ti4','acq_epoch']).updateMask(hotspotMask);

  const pts=fireBands.addBands(ee.Image.pixelLonLat()).sample({
    region:geom,scale:375,geometries:true,numPixels:600,seed:42,tileScale:4
  });

  const pointInfo=await evalEE(pts);
  const points=(pointInfo?.features||[]).map((f:any)=>{
    const pr=f.properties||{},co=f.geometry?.coordinates||[];
    return {
      lon:Number(co[0]),lat:Number(co[1]),
      frp:Number(pr.frp||0),confidence:Number(pr.confidence??-1),
      brightness:Number(pr.Bright_ti4||0),epoch:Number(pr.acq_epoch||0)
    };
  }).filter((x:any)=>Number.isFinite(x.lat)&&Number.isFinite(x.lon)&&x.frp>0);

  // Observed spread proxy from earliest/latest sampled hotspot detections.
  // This is intentionally labelled a proxy, not a physical flame-front ROS.
  const temporalPts=[...points].filter((x:any)=>x.epoch>0).sort((a:any,b:any)=>a.epoch-b.epoch);
  let spreadProxy:any={available:false,note:'At least two time-separated hotspot detections are required.'};
  if(temporalPts.length>=2){
    const a=temporalPts[0],b=temporalPts[temporalPts.length-1];
    const dist=haversineKm(a,b),hours=(b.epoch-a.epoch)/3600;
    spreadProxy={available:hours>0,distanceKm:dist,elapsedHours:hours,centroidDisplacementKmPerHour:hours>0?dist/hours:null,
      note:'Displacement proxy between earliest and latest sampled satellite hotspot detections; not physical flame-front rate of spread.'};
  }

  const latestEpoch=points.length?Math.max(...points.map((x:any)=>x.epoch)):null;
  const endEpoch=Date.parse(end+'T23:59:59Z')/1000;
  const ageHours=latestEpoch?Math.max(0,(endEpoch-latestEpoch)/3600):null;
  const goldenTime=latestEpoch?{
    responseWindowMinutes,elapsedSinceLatestDetectionMinutes:ageHours!*60,
    withinWindow:ageHours!*60<=responseWindowMinutes,
    status:ageHours!*60<=responseWindowMinutes?'WITHIN CONFIGURED RESPONSE WINDOW':'CONFIGURED RESPONSE WINDOW EXCEEDED',
    note:'Operational response-window proxy, not a universal ecological threshold.'
  }:null;

  let context:any=null;
  if(points.length){
    const spectral=recentS2(end,geom);
    const hotspotSpectral=spectral.updateMask(hotspotMask.reproject({crs:'EPSG:4326',scale:375}));
    context=await evalEE(hotspotSpectral.reduceRegion({
      reducer:ee.Reducer.mean().combine({reducer2:ee.Reducer.stdDev(),sharedInputs:true}),
      geometry:geom,scale:750,maxPixels:5e6,bestEffort:true,tileScale:8
    }));
  }

  const summary=points.length?{
    count:points.length,
    frpMean:points.reduce((a:number,x:any)=>a+x.frp,0)/points.length,
    frpMax:Math.max(...points.map((x:any)=>x.frp)),
    highConfidenceCount:points.filter((x:any)=>x.confidence>=2).length,
    nominalOrHighCount:points.filter((x:any)=>x.confidence>=1).length,
    latestEpoch
  }:{count:0,frpMean:null,frpMax:null,highConfidenceCount:0,nominalOrHighCount:0,latestEpoch:null};

  return NextResponse.json({
    status:'success',source:'NASA FIRMS / VIIRS 375 m NRT via Google Earth Engine',
    period:{days,end},bounds:boundsFromGeoJSON(p.aoi),points:points.slice(0,600),summary,goldenTime,spreadProxy,
    vegetationContext:context,
    scientificNote:'VIIRS NRT active-fire detections support monitoring but are not science-quality final products. Hotspot pixels do not directly represent burned area or flame perimeter.',
    provenance:{datasets:['NASA/LANCE/SNPP_VIIRS/C2','NASA/LANCE/NOAA20_VIIRS/C2','COPERNICUS/S2_SR_HARMONIZED'],hotspotResolutionM:375,responseWindowMinutes,imageCount,validHotspotPixels}
  });
 }catch(e:any){
  return NextResponse.json({status:'error',note:e?.message||String(e),stage:'fire-intelligence'},{status:500});
 }
}
