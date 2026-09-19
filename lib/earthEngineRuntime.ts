import fs from 'fs';

type EEType = any;

declare global {
  // eslint-disable-next-line no-var
  var __geoecoEE: EEType | undefined;
  // eslint-disable-next-line no-var
  var __geoecoEEInit: Promise<EEType> | undefined;
}

function cleanupSyncArtifacts(){
  try{
    process.chdir('/tmp');
    for(const name of fs.readdirSync('/tmp')){
      if(name.startsWith('.node-xmlhttprequest-sync-')){
        try{fs.unlinkSync('/tmp/'+name)}catch{}
      }
    }
  }catch{}
}

export function getEarthEngine():Promise<EEType>{
  if(globalThis.__geoecoEE) return Promise.resolve(globalThis.__geoecoEE);
  if(globalThis.__geoecoEEInit) return globalThis.__geoecoEEInit;

  globalThis.__geoecoEEInit=new Promise<EEType>((resolve,reject)=>{
    try{
      cleanupSyncArtifacts();
      const ee=require('@google/earthengine');
      const raw=process.env.GEE_PRIVATE_KEY;
      const email=process.env.GEE_SERVICE_ACCOUNT;
      let project=process.env.GEE_PROJECT_ID;
      if(!raw) throw new Error('Missing GEE_PRIVATE_KEY');

      let key:any;
      if(raw.trim().startsWith('{')){
        key=JSON.parse(raw);
        project=key.project_id||project;
      }else{
        key={type:'service_account',client_email:email,private_key:raw.replace(/\\n/g,'\n')};
      }
      if(!key.client_email&&email) key.client_email=email;
      if(key.private_key) key.private_key=String(key.private_key).replace(/\\n/g,'\n').trim();
      if(!project) throw new Error('Missing GEE project ID');
      if(!key.client_email) throw new Error('Missing GEE service-account email');

      ee.data.authenticateViaPrivateKey(
        key,
        ()=>ee.initialize(
          null,
          null,
          ()=>{
            globalThis.__geoecoEE=ee;
            resolve(ee);
          },
          (e:any)=>{
            globalThis.__geoecoEEInit=undefined;
            reject(new Error('Earth Engine initialization failed: '+String(e)));
          },
          null,
          project
        ),
        (e:any)=>{
          globalThis.__geoecoEEInit=undefined;
          reject(new Error('Earth Engine authentication failed: '+String(e)));
        }
      );
    }catch(e){
      globalThis.__geoecoEEInit=undefined;
      reject(e);
    }
  });
  return globalThis.__geoecoEEInit;
}
