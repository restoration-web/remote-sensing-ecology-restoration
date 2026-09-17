import {NextRequest,NextResponse} from 'next/server';

export const runtime='nodejs';

export async function POST(req:NextRequest){
  const payload=await req.json();
  const backend=process.env.EXISTING_GEE_BACKEND_URL;
  if(!backend){
    return NextResponse.json({
      status:'adapter-ready',
      note:'Set EXISTING_GEE_BACKEND_URL in Vercel to forward analysis requests to the previous Google Earth Engine backend.',
      received:{period:payload.period,sensor:payload.sensor,variables:payload.variables?.length||0}
    });
  }
  const upstream=await fetch(backend,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'});
  const text=await upstream.text();
  try{return NextResponse.json(JSON.parse(text),{status:upstream.status})}
  catch{return new NextResponse(text,{status:upstream.status,headers:{'Content-Type':'text/plain'}})}
}
