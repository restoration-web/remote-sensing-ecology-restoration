import {NextResponse} from 'next/server';

export const runtime='nodejs';
export const maxDuration=60;
let ee:any;

function evaluate(obj:any){return new Promise<any>((resolve,reject)=>obj.evaluate((v:any,e:any)=>e?reject(new Error(String(e))):resolve(v)))}

export async function GET(){
  try{
    ee=await getEarthEngine();
        const geom=ee.Geometry.Rectangle([114.55,-3.45,114.65,-3.35]);
    const col=ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
      .filterDate('2026-01-01','2026-09-01').filterBounds(geom)
      .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',30));
    const count=await evaluate(col.size());
    if(!count)throw new Error('No Sentinel-2 scenes found for runtime test.');
    const img=col.median().normalizedDifference(['B8','B4']).rename('NDVI').clip(geom);
    const mean=await evaluate(img.reduceRegion({reducer:ee.Reducer.mean(),geometry:geom,scale:20,maxPixels:1e6}).get('NDVI'));
    const thumb=img.getThumbURL({region:geom,dimensions:256,format:'png',min:-.2,max:.9,palette:['#8c510a','#f6e8c3','#01665e']});
    return NextResponse.json({status:'success',sceneCount:count,meanNDVI:mean,thumbGenerated:Boolean(thumb)});
  }catch(e:any){
    return NextResponse.json({status:'error',note:e?.message||String(e)},{status:500});
  }
}
