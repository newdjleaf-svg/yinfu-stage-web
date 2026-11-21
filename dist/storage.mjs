let connection;
const request=value=>new Promise((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error)});
export async function openStore(){if(connection)return connection;const task=indexedDB.open('fuyin-stage-library',1);task.onupgradeneeded=()=>{task.result.createObjectStore('library');task.result.createObjectStore('audio')};connection=await request(task);return connection}
export async function read(store,key){const db=await openStore();return request(db.transaction(store).objectStore(store).get(key))}
export async function write(store,key,value){const db=await openStore();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('儲存取消'))})}
