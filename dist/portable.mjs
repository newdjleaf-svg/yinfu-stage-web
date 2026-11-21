import {palette,validateCue,newCue,uid} from './model.mjs';
import {createZip,readZip} from './zip.mjs';

export const PACK_FORMAT='yinfu.cuepack';
export const PACK_VERSION=1;
const MAX_AUDIO_BYTES=64*1024*1024;
const MAX_PACK_BYTES=256*1024*1024;

export function validatePack(pack){
 if(pack?.format!==PACK_FORMAT||pack.version!==PACK_VERSION||!Array.isArray(pack.cues)||!pack.cues.length)throw Error('不是支援的音芙場控曲目套件');
 if(pack.cues.length>100)throw Error('單一套件最多 100 首');
 if(typeof pack.pageName!=='string')throw Error('套件頁面名稱無效');
 let totalBytes=0;
 for(const cue of pack.cues){
  if(typeof cue.name!=='string'||!cue.name.trim()||typeof cue.audio!=='string'||!cue.audio.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(cue.audio))throw Error('套件中有無效的曲目或音檔');
  if(cue.audio.length>Math.ceil(MAX_AUDIO_BYTES*4/3)+8)throw Error('單首音檔超過 64 MB，請分批轉移');
  const bytes=cue.audio.length*3/4-(cue.audio.endsWith('==')?2:cue.audio.endsWith('=')?1:0);
  if(bytes>MAX_AUDIO_BYTES)throw Error('單首音檔超過 64 MB，請分批轉移');
  totalBytes+=bytes;if(totalBytes>MAX_PACK_BYTES)throw Error('套件音檔合計超過 256 MB，請分批轉移');
  if(!Number.isFinite(cue.duration)||cue.duration<=0)throw Error('套件曲長無效');
  const candidate=newCue(cue.name,'',cue.duration,cue.width,cue.height);
  Object.assign(candidate,{fontSize:cue.fontSize,start:cue.start,end:cue.end});
  if(validateCue(candidate))throw Error(`「${cue.name}」的播放或格子設定無效`);
  if(typeof cue.color!=='string'||(!palette.includes(cue.color.toLowerCase())&&cue.color.toLowerCase()!=='#454582'))throw Error('格子顏色不在固定色票內');
  if(cue.textColor!==null&&cue.textColor!==undefined&&!palette.includes(cue.textColor.toLowerCase()))throw Error('文字顏色不在固定色票內');
  if(!['left','center','right'].includes(cue.alignment)||typeof cue.loop!=='boolean'||!/^\.?[a-z0-9]{1,8}$/i.test(cue.audioExtension))throw Error('套件的外觀或音訊格式欄位無效');
 }
 return pack;
}

export async function encodePack(cues,pageName,readAudio){
 if(!cues.length)throw Error('目前沒有可打包的曲目');
 const entries=[];let total=0;
 for(const cue of cues){
  const blob=await readAudio(cue.mediaID);
  if(!blob)throw Error(`找不到「${cue.name}」的音檔`);
  if(blob.size>MAX_AUDIO_BYTES)throw Error(`「${cue.name}」超過 64 MB，請分批轉移`);
  total+=blob.size;if(total>MAX_PACK_BYTES)throw Error('套件音檔合計超過 256 MB，請分批轉移');
  const audio=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)});
  entries.push({name:cue.name,duration:cue.duration,color:cue.color,textColor:cue.textColor??null,fontSize:cue.fontSize,alignment:cue.alignment,width:cue.width,height:cue.height,start:cue.start,end:cue.end,loop:!!cue.loop,audioExtension:cue.audioExtension||'mp3',audio});
 }
 return JSON.stringify({format:PACK_FORMAT,version:PACK_VERSION,pageName,cues:entries});
}

export async function decodePack(text,writeAudio){
 if(text.length>Math.ceil(MAX_PACK_BYTES*4/3)+5_000_000)throw Error('套件超過 256 MB 上限');
 const pack=validatePack(JSON.parse(text));
 const cues=[];
 for(const entry of pack.cues){
  const binary=atob(entry.audio),bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  const mediaID=uid();await writeAudio(mediaID,new Blob([bytes]));
  const cue=newCue(entry.name,mediaID,entry.duration,entry.width,entry.height);
  Object.assign(cue,{color:entry.color.toLowerCase(),textColor:entry.textColor?.toLowerCase()??null,fontSize:entry.fontSize,alignment:entry.alignment,start:entry.start,end:entry.end,loop:entry.loop,audioExtension:entry.audioExtension.replace(/^\./,'').toLowerCase()});
  cues.push(cue);
 }
 return {pageName:pack.pageName,cues};
}

export async function encodeZipPack(cues,pageName,readAudio){
 if(!cues.length||cues.length>500)throw Error('ZIP 歌單需有 1–500 首曲目');
 const entries=[],manifest={format:'yinfu.zipplaylist',version:1,pageName,cues:[]};let total=0;
 for(const [index,cue] of cues.entries()){
  const blob=await readAudio(cue.mediaID);
  if(!(blob instanceof Blob))throw Error(`找不到「${cue.name}」的音檔`);
  total+=blob.size;if(blob.size>512*1024*1024||total>1024*1024*1024)throw Error('ZIP 歌單超過 1 GB，請分頁轉移');
  const ext=(cue.audioExtension||'mp3').replace(/^\./,'').toLowerCase();
  const item={name:cue.name,duration:cue.duration,color:cue.color,textColor:cue.textColor??null,fontSize:cue.fontSize,alignment:cue.alignment,width:cue.width,height:cue.height,start:cue.start,end:cue.end,loop:!!cue.loop,audioExtension:ext,audioPath:`audio/${String(index+1).padStart(4,'0')}.${ext}`};
  validatePack({format:PACK_FORMAT,version:PACK_VERSION,pageName,cues:[{...item,audio:'AA=='}]});
  manifest.cues.push(item);entries.push([item.audioPath,blob]);
 }
 entries.unshift(['manifest.json',new Blob([JSON.stringify(manifest)],{type:'application/json'})]);
 return createZip(entries);
}

export async function decodeZipPack(file,writeAudio){
 const entries=await readZip(file),manifestBlob=entries.get('manifest.json');
 if(!manifestBlob||manifestBlob.size>1024*1024)throw Error('ZIP 歌單缺少設定檔');
 const manifest=JSON.parse(await manifestBlob.text());
 if(manifest?.format!=='yinfu.zipplaylist'||manifest.version!==1||typeof manifest.pageName!=='string'||!Array.isArray(manifest.cues)||!manifest.cues.length||manifest.cues.length>500||entries.size!==manifest.cues.length+1)throw Error('不是支援的音芙場控 ZIP 歌單');
 const paths=new Set(),cues=[];
 for(const item of manifest.cues){
  if(typeof item.audioPath!=='string'||!/^audio\/[0-9]{4}\.[a-z0-9]{1,8}$/.test(item.audioPath)||paths.has(item.audioPath)||!entries.has(item.audioPath))throw Error('ZIP 歌單音檔清單無效');
  paths.add(item.audioPath);
  validatePack({format:PACK_FORMAT,version:PACK_VERSION,pageName:manifest.pageName,cues:[{...item,audio:'AA=='}]});
  const mediaID=uid();await writeAudio(mediaID,entries.get(item.audioPath));
  const cue=newCue(item.name,mediaID,item.duration,item.width,item.height);
  Object.assign(cue,{color:item.color.toLowerCase(),textColor:item.textColor?.toLowerCase()??null,fontSize:item.fontSize,alignment:item.alignment,start:item.start,end:item.end,loop:item.loop,audioExtension:item.audioExtension});
  cues.push(cue);
 }
 return {pageName:manifest.pageName,cues};
}
