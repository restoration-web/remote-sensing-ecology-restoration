import {NextResponse} from 'next/server';

export const runtime='nodejs';
export const maxDuration=60;
const ee=require('@google/earthengine');

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

export async function GET(){
  try{
    try{process.chdir('/tmp')}catch{}
    await initEE();
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
