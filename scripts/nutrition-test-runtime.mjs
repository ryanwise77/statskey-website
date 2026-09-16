import { build } from 'esbuild'
export async function nutritionRuntime() {
  const output = await build({ stdin: { contents: `
    export * from './src/app/lib/ai/geminiNutrition.ts';
    export * from './src/app/lib/ai/nutritionSourceCompletion.ts';
    export * from './src/app/lib/serving.ts';
    export * from './src/app/lib/nutritionMetadata.ts';
    export * from './src/app/lib/writers.ts';
    export * from './src/app/lib/decoders.ts';
    export * from './src/app/lib/provenance.ts';
    export { itemToDraft, draftToFoodItem } from './src/app/components/log/MealLogForm.tsx';
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
    packages: 'external', plugins: [{name: 'firebase-test-boundary', setup(api) {
      api.onResolve({ filter: /(?:^|\/)firebase$/ }, args => args.path.startsWith('.') ? { path: 'app-firebase', namespace: 'nutrition-test' } : null)
      api.onResolve({filter: /^firebase\/functions$/}, () => ({path:'functions',namespace:'nutrition-test'}))
      api.onResolve({filter: /^firebase\/firestore$/}, () => ({path:'firestore',namespace:'nutrition-test'}))
      api.onLoad({filter: /.*/, namespace:'nutrition-test'}, args => ({contents: args.path==='app-firebase'
        ? `export const auth={currentUser:{uid:'nutrition-test-user'}}; export const firebaseApp={}; export const db={}; export const functions={};`
        : args.path==='functions' ? `export const getFunctions=()=>({}); export const httpsCallable=(_app,name,options)=>data=>globalThis.__nutritionCall(name,data,options);`
        : `export class Timestamp { static fromDate(d){return d} }; export const doc=(...path)=>path; export const setDoc=(...args)=>globalThis.__nutritionSave(...args);
          export const addDoc=()=>{},collection=()=>{},deleteDoc=()=>{},getDoc=()=>{},getDocs=()=>{},increment=()=>{},limit=()=>{},orderBy=()=>{},query=()=>{},where=()=>{},writeBatch=()=>{},onSnapshot=()=>{},startAfter=()=>{},documentId=()=>{},getCountFromServer=()=>{};`, loader:'js'}))
    }}] })
  // Keep external Firebase/React dependencies resolving from this repository.
  const fs=await import('node:fs/promises'); const path=await import('node:path');const url=await import('node:url');
  const dir=await fs.mkdtemp(path.join(process.cwd(),'.nutrition-test-'))
  const file=path.join(dir,'runtime.mjs');await fs.writeFile(file,output.outputFiles[0].text)
  try{return await import(url.pathToFileURL(file))}finally{await fs.rm(dir,{recursive:true,force:true})}
}
