import {NextRequest,NextResponse} from 'next/server';
import {createHash} from 'crypto';

export const runtime='nodejs';
export const maxDuration=300;
try{process.chdir('/tmp')}catch{}
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
function evalEE(obj:any){return new Promise<any>((resolve,reject)=>obj.evaluate((v:any,e:any)=>e?reject(new Error(String(e))):resolve(v)))}
function aoiFC(fc:any){return ee.FeatureCollection((fc?.features||[]).map((f:any)=>ee.Feature(ee.Geometry(f.geometry),f.properties||{})))}
function maskS2(img:any){
  const scl=img.select('SCL');
  const mask=scl.neq(0).and(scl.neq(1)).and(scl.neq(3)).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
  return img.updateMask(mask).divide(10000).copyProperties(img,['system:time_start']);
}
function s2Bands(img:any){
  const ndvi=img.normalizedDifference(['B8','B4']).rename('NDVI');
  const ndre=img.normalizedDifference(['B8A','B5']).rename('NDRE');
  const ndwi=img.normalizedDifference(['B3','B8']).rename('NDWI');
  const ndmi=img.normalizedDifference(['B8A','B11']).rename('NDMI');
  const bsi=img.expression('((s+r)-(n+b))/((s+r)+(n+b))',{s:img.select('B11'),r:img.select('B4'),n:img.select('B8'),b:img.select('B2')}).rename('BSI');
  return ee.Image.cat([ndvi,ndre,ndwi,ndmi,bsi]);
}
function emptyS2(){return ee.Image.constant([0,0,0,0,0]).rename(['NDVI','NDRE','NDWI','NDMI','BSI']).updateMask(ee.Image.constant(0))}
function emptyOne(name:string){return ee.Image.constant(0).rename(name).updateMask(ee.Image.constant(0))}
function prepLST(img:any){
  const qa=img.select('QA_PIXEL');
  const m=qa.bitwiseAnd(1<<3).eq(0).and(qa.bitwiseAnd(1<<4).eq(0)).and(img.select('QA_RADSAT').eq(0));
  return img.updateMask(m).select('ST_B10').multiply(0.00341802).add(149).subtract(273.15).rename('LST');
}
function finite(v:any){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))}
function mean(a:number[]){return a.reduce((x,y)=>x+y,0)/a.length}
function quantile(a:number[],p:number){
  if(!a.length)return null;
  const s=[...a].sort((x,y)=>x-y),i=(s.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);
  return lo===hi?s[lo]:s[lo]+(s[hi]-s[lo])*(i-lo);
}
function describe(rows:any[],key:string){
  const a=rows.map(r=>r[key]).filter(finite).map(Number);
  if(!a.length)return {n:0,mean:null,sd:null,min:null,q1:null,median:null,q3:null,max:null};
  const m=mean(a),sd=a.length>1?Math.sqrt(a.reduce((acc,v)=>acc+(v-m)**2,0)/(a.length-1)):0;
  return {n:a.length,mean:m,sd,min:Math.min(...a),q1:quantile(a,.25),median:quantile(a,.5),q3:quantile(a,.75),max:Math.max(...a)};
}
function pair(rows:any[],xKey:string,yKey:string){
  const pts=rows.filter(r=>finite(r[xKey])&&finite(r[yKey])).map(r=>({x:Number(r[xKey]),y:Number(r[yKey])}));
  const n=pts.length;if(n<3)return {x:xKey,y:yKey,n,r:null,r2:null,slope:null,intercept:null,rmse:null};
  const mx=mean(pts.map(p=>p.x)),my=mean(pts.map(p=>p.y));
  const sxx=pts.reduce((a,p)=>a+(p.x-mx)**2,0),syy=pts.reduce((a,p)=>a+(p.y-my)**2,0),sxy=pts.reduce((a,p)=>a+(p.x-mx)*(p.y-my),0);
  if(sxx===0||syy===0)return {x:xKey,y:yKey,n,r:null,r2:null,slope:null,intercept:null,rmse:null};
  const slope=sxy/sxx,intercept=my-slope*mx,r=sxy/Math.sqrt(sxx*syy);
  const rmse=Math.sqrt(mean(pts.map(p=>(p.y-(intercept+slope*p.x))**2)));
  return {x:xKey,y:yKey,n,r,r2:r*r,slope,intercept,rmse};
}
function invert(M:number[][]){
  const n=M.length,A=M.map((r,i)=>[...r,...Array.from({length:n},(_,j)=>i===j?1:0)]);
  for(let i=0;i<n;i++){
    let p=i;for(let k=i+1;k<n;k++)if(Math.abs(A[k][i])>Math.abs(A[p][i]))p=k;
    if(Math.abs(A[p][i])<1e-10)throw new Error('singular');
    [A[i],A[p]]=[A[p],A[i]];
    const d=A[i][i];for(let j=0;j<2*n;j++)A[i][j]/=d;
    for(let k=0;k<n;k++)if(k!==i){const f=A[k][i];for(let j=0;j<2*n;j++)A[k][j]-=f*A[i][j]}
  }
  return A.map(r=>r.slice(n));
}
function multipleRegression(rows:any[],yKey:string,xKeys:string[]){
  const clean=rows.filter(r=>finite(r[yKey])&&xKeys.every(k=>finite(r[k])));
  const p=xKeys.length+1;if(clean.length<p+4)return {ok:false,n:clean.length,note:'Need at least '+(p+4)+' complete temporal observations.'};
  try{
    const X=clean.map(r=>[1,...xKeys.map(k=>Number(r[k]))]),y=clean.map(r=>Number(r[yKey]));
    const Xt=X[0].map((_,j)=>X.map(r=>r[j]));
    const XtX=Xt.map(row=>X[0].map((_,j)=>row.reduce((a,v,i)=>a+v*X[i][j],0)));
    const Xty=Xt.map(row=>row.reduce((a,v,i)=>a+v*y[i],0));
    const inv=invert(XtX);const beta=inv.map(row=>row.reduce((a,v,i)=>a+v*Xty[i],0));
    const pred=X.map(r=>r.reduce((a,v,i)=>a+v*beta[i],0)),ym=mean(y);
    const sse=y.reduce((a,v,i)=>a+(v-pred[i])**2,0),sst=y.reduce((a,v)=>a+(v-ym)**2,0);
    const r2=sst?1-sse/sst:null,rmse=Math.sqrt(sse/y.length),mae=mean(y.map((v,i)=>Math.abs(v-pred[i])));
    return {ok:true,n:y.length,r2,rmse,mae,coefficients:[{term:'Intercept',value:beta[0]},...xKeys.map((k,i)=>({term:k,value:beta[i+1]}))]};
  }catch{return {ok:false,n:clean.length,note:'Predictors are collinear or matrix is singular.'}}
}
function makePeriods(start:string,end:string){
  const s=new Date(start+'T00:00:00Z'),e=new Date(end+'T00:00:00Z');
  const out:any[]=[];let d=new Date(Date.UTC(s.getUTCFullYear(),Math.floor(s.getUTCMonth()/3)*3,1));
  while(d<=e&&out.length<40){
    const next=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+3,1));
    const stop=next>e?new Date(e.getTime()+86400000):next;
    out.push({start:d.toISOString().slice(0,10),end:stop.toISOString().slice(0,10),label:'Q'+(Math.floor(d.getUTCMonth()/3)+1)+' '+d.getUTCFullYear()});
    d=next;
  }
  return out;
}
export async function POST(req:NextRequest){
 try{
  const p=await req.json();if(!p?.aoi?.features?.length)return NextResponse.json({status:'error',note:'AOI required'},{status:400});
  const start=String(p.start||'2024-01-01'),end=String(p.end||'2026-09-19'),periods=makePeriods(start,end);
  const analysisId='GEOECO-A-'+createHash('sha256').update(JSON.stringify({aoi:p.aoi,start,end,version:'1.0.1'})).digest('hex').slice(0,12).toUpperCase();
  if(!periods.length)return NextResponse.json({status:'error',note:'Invalid date range'},{status:400});
  await initEE();const geom=aoiFC(p.aoi).geometry();
  const features=periods.map((t:any)=>{
    const s2c=ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterDate(t.start,t.end).filterBounds(geom).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',30)).map(maskS2);
    const s2=ee.Image(ee.Algorithms.If(s2c.size().gt(0),s2Bands(s2c.median()),emptyS2()));
    const l8=ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')).filterDate(t.start,t.end).filterBounds(geom).filter(ee.Filter.eq('PROCESSING_LEVEL','L2SP')).map(prepLST);
    const lst=ee.Image(ee.Algorithms.If(l8.size().gt(0),l8.median(),emptyOne('LST')));
    const rain=ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY').filterDate(t.start,t.end).filterBounds(geom).sum().rename('Rainfall');
    const spectral=ee.Dictionary(ee.Image.cat([s2,lst]).reduceRegion({reducer:ee.Reducer.mean(),geometry:geom,scale:60,maxPixels:1e8,bestEffort:true,tileScale:8}));
    const rainVal=rain.reduceRegion({reducer:ee.Reducer.mean(),geometry:geom,scale:5000,maxPixels:1e7,bestEffort:true,tileScale:4}).get('Rainfall');
    return ee.Feature(null,spectral.set('Rainfall',rainVal).set('period',t.label).set('start',t.start).set('s2Scenes',s2c.size()).set('landsatScenes',l8.size()));
  });
  const info=await evalEE(ee.FeatureCollection(features));
  const rows=(info?.features||[]).map((f:any)=>f.properties||{}).map((r:any)=>({
    period:r.period,start:r.start,s2Scenes:Number(r.s2Scenes||0),landsatScenes:Number(r.landsatScenes||0),
    NDVI:finite(r.NDVI)?Number(r.NDVI):null,NDRE:finite(r.NDRE)?Number(r.NDRE):null,NDWI:finite(r.NDWI)?Number(r.NDWI):null,
    NDMI:finite(r.NDMI)?Number(r.NDMI):null,BSI:finite(r.BSI)?Number(r.BSI):null,LST:finite(r.LST)?Number(r.LST):null,Rainfall:finite(r.Rainfall)?Number(r.Rainfall):null
  }));
  const keys=['NDVI','NDRE','NDWI','NDMI','BSI','LST','Rainfall'];
  const descriptive=Object.fromEntries(keys.map(k=>[k,describe(rows,k)]));
  const correlations:any[]=[];for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++)correlations.push(pair(rows,keys[i],keys[j]));
  const focus=[
    pair(rows,'NDVI','NDRE'),pair(rows,'NDVI','NDMI'),pair(rows,'NDVI','BSI'),pair(rows,'NDVI','LST'),pair(rows,'NDVI','Rainfall'),
    pair(rows,'NDRE','LST'),pair(rows,'NDMI','LST'),pair(rows,'BSI','LST')
  ];
  const multiple=multipleRegression(rows,'NDVI',['NDRE','NDMI','BSI','LST','Rainfall']);
  return NextResponse.json({
    status:'success',analysisId,temporalResolution:'quarterly',rows,descriptive,correlations,focus,multipleRegression:multiple,
    provenance:{analysisVersion:'GEOECO-ANALYTICS-1.0.0',datasets:'Sentinel-2 SR Harmonized + Landsat 8/9 C2 L2 + CHIRPS',start,end,periods:rows.length},
    limitations:'Temporal AOI-mean correlations and regressions describe association, not causation. Small sample sizes and multicollinearity can make coefficients unstable.'
  });
 }catch(e:any){return NextResponse.json({status:'error',note:e?.message||String(e)},{status:500})}
}
