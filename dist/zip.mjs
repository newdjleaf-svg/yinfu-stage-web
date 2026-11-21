const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const MAX_ZIP=1024*1024*1024;
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function crcUpdate(crc,bytes){for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);return crc>>>0}
async function crcBlob(blob){let crc=0xffffffff;for(let offset=0;offset<blob.size;offset+=1024*1024)crc=crcUpdate(crc,new Uint8Array(await blob.slice(offset,offset+1024*1024).arrayBuffer()));return(crc^0xffffffff)>>>0}
function header(length){return new DataView(new ArrayBuffer(length))}
function put(view,offset,value,size){if(size===2)view.setUint16(offset,value,true);else view.setUint32(offset,value,true)}
function safeName(name){return typeof name==='string'&&name.length>0&&name.length<200&&!name.includes('..')&&!name.startsWith('/')&&!name.includes('\\')&&!name.includes('\0')}

export async function createZip(entries){
 if(!entries.length||entries.length>501)throw Error('ZIP 曲目數量無效');
 const parts=[],central=[];let offset=0,total=0;
 for(const [name,source]of entries){
  if(!safeName(name)||!(source instanceof Blob))throw Error('ZIP 檔案項目無效');
  const bytes=encoder.encode(name),size=source.size;
  total+=size;if(size>512*1024*1024||total>MAX_ZIP)throw Error('ZIP 歌單超過 1 GB 上限');
  const crc=await crcBlob(source);
  const local=header(30);put(local,0,0x04034b50,4);put(local,4,20,2);put(local,6,0x800,2);put(local,14,crc,4);put(local,18,size,4);put(local,22,size,4);put(local,26,bytes.length,2);
  parts.push(local.buffer,bytes,source);
  const record=header(46);put(record,0,0x02014b50,4);put(record,4,20,2);put(record,6,20,2);put(record,8,0x800,2);put(record,16,crc,4);put(record,20,size,4);put(record,24,size,4);put(record,28,bytes.length,2);put(record,42,offset,4);
  central.push(record.buffer,bytes);offset+=30+bytes.length+size;
 }
 const centralSize=central.reduce((sum,item)=>sum+(item.byteLength??item.length),0);
 const end=header(22);put(end,0,0x06054b50,4);put(end,8,entries.length,2);put(end,10,entries.length,2);put(end,12,centralSize,4);put(end,16,offset,4);
 return new Blob([...parts,...central,end.buffer],{type:'application/zip'});
}

export async function readZip(file){
 if(!(file instanceof Blob)||file.size>MAX_ZIP+1024*1024||file.size<22)throw Error('ZIP 歌單大小無效');
 const tail=new DataView(await file.slice(Math.max(0,file.size-65557)).arrayBuffer());let end=-1;
 for(let i=tail.byteLength-22;i>=0;i--)if(tail.getUint32(i,true)===0x06054b50){end=i;break}
 if(end<0)throw Error('找不到 ZIP 歌單目錄');
 const count=tail.getUint16(end+10,true),centralSize=tail.getUint32(end+12,true),centralOffset=tail.getUint32(end+16,true);
 if(!count||count>501||centralOffset+centralSize>file.size)throw Error('ZIP 歌單目錄無效');
 const central=new DataView(await file.slice(centralOffset,centralOffset+centralSize).arrayBuffer());
 const entries=new Map();let pos=0,total=0;
 for(let i=0;i<count;i++){
  if(pos+46>central.byteLength||central.getUint32(pos,true)!==0x02014b50)throw Error('ZIP 項目格式無效');
  const flags=central.getUint16(pos+8,true),method=central.getUint16(pos+10,true),crc=central.getUint32(pos+16,true),packed=central.getUint32(pos+20,true),size=central.getUint32(pos+24,true),nameLength=central.getUint16(pos+28,true),extra=central.getUint16(pos+30,true),comment=central.getUint16(pos+32,true),localOffset=central.getUint32(pos+42,true);
  if(method!==0||flags&1||packed!==size||size>512*1024*1024||pos+46+nameLength+extra+comment>central.byteLength)throw Error('ZIP 歌單含不支援的項目');
  const name=decoder.decode(new Uint8Array(central.buffer,central.byteOffset+pos+46,nameLength));
  if(!safeName(name)||entries.has(name))throw Error('ZIP 檔名無效或重複');
  const local=new DataView(await file.slice(localOffset,localOffset+30).arrayBuffer());
  if(local.byteLength<30||local.getUint32(0,true)!==0x04034b50)throw Error('ZIP 音檔位置無效');
  const start=localOffset+30+local.getUint16(26,true)+local.getUint16(28,true);
  if(start+size>centralOffset)throw Error('ZIP 音檔長度無效');
  const blob=file.slice(start,start+size);
  if(await crcBlob(blob)!==crc)throw Error('ZIP 音檔校驗失敗');
  entries.set(name,blob);total+=size;if(total>MAX_ZIP)throw Error('ZIP 歌單超過 1 GB 上限');
  pos+=46+nameLength+extra+comment;
 }
 if(pos!==central.byteLength)throw Error('ZIP 歌單目錄尾端無效');
 return entries;
}
