import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// Execute the actual homepage module, replacing only module imports and browser/
// Firebase boundaries. No application function is reimplemented or stubbed.
const source = process.env.FOUNDER_LIVE_BASELINE
  ? execFileSync('git', ['show', `${process.env.FOUNDER_LIVE_BASELINE}:src/founderLive.js`], {encoding:'utf8'})
  : readFileSync(new URL('../src/founderLive.js', import.meta.url), 'utf8')
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject} }
const plain = value => JSON.parse(JSON.stringify(value))
function eventTarget() {
  const events=new Map()
  return {addEventListener(name,fn){const list=events.get(name)||[];list.push(fn);events.set(name,list)},dispatch(name,event={}){for(const fn of events.get(name)||[])fn(event)}}
}
function node(id) {
  const classes=new Set(),attrs=new Map()
  return {...eventTarget(),id,dataset:{source:'/statskey-app/founder-live-fallback.json'},style:{},innerHTML:'',textContent:'',hidden:false,disabled:false,scrollTop:0,offsetTop:0,offsetHeight:0,
    classList:{add(...v){v.forEach(x=>classes.add(x))},remove(...v){v.forEach(x=>classes.delete(x))},toggle(x,on){if(on??!classes.has(x))classes.add(x);else classes.delete(x)},contains(x){return classes.has(x)}},
    setAttribute(k,v){attrs.set(k,String(v))},getAttribute(k){return attrs.get(k)},replaceChildren(){this.innerHTML=''},querySelector(){return null},querySelectorAll(){return[]},closest(){return null},scrollIntoView(){},getBoundingClientRect(){return{top:0}}}
}
function harness({fetchImpl,initAuthError,now='2026-09-12T04:30:00Z'}={}) {
  let time=0,id=0,authObserver=null,authError=null
  const timers=new Map(),nodes=new Map(),subscriptions=[],fetches=[],authInits=[],logs=[]
  const getNode=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id)}
  const document={...eventTarget(),hidden:false,getElementById:getNode}
  const schedule=(fn,delay,repeat=false)=>{const key=++id;timers.set(key,{fn,at:time+delay,delay,repeat});return key}
  const window={...eventTarget(),location:{search:'',hostname:'statskey.ai'},setTimeout:(fn,delay)=>schedule(fn,delay),clearTimeout:key=>timers.delete(key),setInterval:(fn,delay)=>schedule(fn,delay,true),clearInterval:key=>timers.delete(key),requestAnimationFrame:fn=>fn(),matchMedia:()=>({matches:false}),scrollBy(){}}
  const app={},auth={currentUser:null},db={}
  const origin=Date.parse(now)
  class ClockDate extends Date {constructor(...args){super(...(args.length?args:[origin+time]))}static now(){return origin+time}}
  const context=vm.createContext({window,document,navigator:{language:'en-US',onLine:true},localStorage:{getItem:()=>null},URLSearchParams,URL,Intl,Date:ClockDate,Math,Map,Set,
    console:{log:(...x)=>logs.push(x),warn:(...x)=>logs.push(x),error:(...x)=>logs.push(x)},__env:{},
    browserLocalPersistence:'local',browserSessionPersistence:'session',inMemoryPersistence:'memory',browserPopupRedirectResolver:'popup',
    initializeApp:()=>app,getApps:()=>[],getApp:()=>app,initializeAppCheck(){},ReCaptchaEnterpriseProvider:class{},getFirestore:()=>db,
    initializeAuth(_app,options){authInits.push(options);if(initAuthError)throw initAuthError;return auth},getAuth:()=>auth,
    onAuthStateChanged(_auth,next,error){authObserver=next;authError=error;return()=>{authObserver=null;authError=null}},
    collection:(_db,...parts)=>({path:parts.join('/')}),doc:(_db,...parts)=>({path:parts.join('/')}),where:(key,op,value)=>({kind:'where',key,op,value}),orderBy:(key,direction)=>({kind:'orderBy',key,direction}),limit:value=>({kind:'limit',value}),query:(ref,...constraints)=>({...ref,constraints}),
    onSnapshot(ref,...args){const next=typeof args[0]==='function'?args[0]:args[1],error=typeof args[0]==='function'?args[1]:args[2];const entry={ref,next,error,active:true};subscriptions.push(entry);return()=>{entry.active=false}},
    currentFounderJourneyNote:()=>null,founderNoteLanguage:()=> 'en-US',founderNoteHeading:()=> 'Journey',
    fetch:async(url,options)=>{fetches.push({url,options});if(fetchImpl)return fetchImpl(url,options);throw new Error(`Unexpected static fetch: ${url}`)},
  })
  const transformed=source.replace(/^import\s+[\s\S]*?\sfrom\s+['"][^'"]+['"]\s*$/gm,'').replaceAll('import.meta.env','__env').replace(/export function /g,'function ')
  vm.runInContext(`${transformed}\nglobalThis.api={state,initFounderLive,workoutsReference,liveMealsReference,openWorkout,loadArchiveMonths,loadFounderArchive,archiveHome,archiveMealPool,renderArchive,selectArchiveMonth,renderLongitudinalRecord,renderScreen,renderNutritionScreen,${source.includes('function refreshConnectionState')?'refreshConnectionState,':''}}`,context,{filename:'actual-founderLive.js'})
  const api=context.api
  const find=(channel,active=true)=>subscriptions.filter(x=>(!active||x.active)&&(channel==='root'?x.ref.path==='publicFounderReplicas/founder':x.ref.path.endsWith('/'+channel))).at(-1)
  const snap=(data,{cache=false,exists=true}={})=>({id:'founder',metadata:{fromCache:cache,hasPendingWrites:false},exists:()=>exists,data:()=>data})
  function root(data={},options={}) { const sub=find('root');assert.ok(sub,'root listener');sub.next(snap({published:true,trainingPublished:true,mealsPublished:true,nutritionPublished:true,trainingPlanPublished:false,updatedAt:new Date().toISOString(),...data},options)) }
  function rows(channel,data,options={}){const sub=find(channel);assert.ok(sub,`${channel} listener`);const docs=data.map((d,i)=>({id:d.workoutId||d.mealId||String(i),data:()=>d}));sub.next({docs,size:docs.length,metadata:{fromCache:options.cache===true,hasPendingWrites:false},docChanges:()=>docs})}
  return {api,nodes,getNode,subscriptions,fetches,authInits,logs,window,document,context,find,snap,root,rows,
    init(){api.initFounderLive()},
    user(value={uid:'adult',isAnonymous:false}){assert.ok(authObserver,'homepage must initialize and observe Auth');auth.currentUser=value;authObserver(value)},
    error(channel,code){const sub=find(channel);assert.ok(sub);sub.error({code})},
    tick(ms){const end=time+ms;for(;;){const next=[...timers].filter(([,x])=>x.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();if(next[1].repeat)timers.set(next[0],{...next[1],at:time+next[1].delay})}time=end},
    timers(){return[...timers.values()]},
    authorize(data={}){this.init();this.user();root(data)},
    live(data={}){this.authorize(data);if(find('workouts'))rows('workouts',[]);if(find('meals'))rows('meals',[])},
  }
}

test('baseline regression: restores matching local/session/memory Auth before reading any record or static snapshot',()=>{
 const h=harness();h.init();assert.equal(h.fetches.length,0);assert.equal(h.subscriptions.length,0)
 assert.deepEqual(plain(h.authInits[0].persistence),['local','session','memory']);assert.equal(h.authInits[0].popupRedirectResolver,'popup')
 h.user(null);assert.equal(h.api.state.source,'signedOut');assert.equal(h.subscriptions.length,0);assert.equal(h.fetches.length,0)
 assert.match(h.getNode('founder-live-screen').innerHTML,/Sign in/);assert.doesNotMatch(h.getNode('founder-live-screen').innerHTML,/live connection pending/)
})
test('anonymous Firebase accounts remain signed out and cannot trigger static archive reads',async()=>{
 const h=harness();h.init();h.user({uid:'anon',isAnonymous:true});await h.api.loadFounderArchive();await h.api.loadArchiveMonths(['2026-08'])
 assert.equal(h.api.state.source,'signedOut');assert.equal(h.subscriptions.length,0);assert.equal(h.fetches.length,0)
})
test('fresh root permission proof is required before cached rows can render or dependent subscriptions start',()=>{
 const h=harness();h.init();h.user();assert.equal(h.subscriptions.filter(x=>x.active).length,1)
 h.root({}, {cache:true});assert.equal(h.api.state.authorized,false);assert.equal(h.api.state.root,null)
 assert.equal(h.subscriptions.filter(x=>x.active).length,1);assert.equal(h.fetches.length,0)
 h.root();assert.equal(h.api.state.authorized,true);assert.ok(h.find('workouts'));assert.ok(h.find('meals'))
})
test('baseline regression: workout query reads the full bounded ordered window',()=>{
 const h=harness();const query=h.api.workoutsReference();assert.deepEqual(plain(query.constraints),[{kind:'where',key:'day',op:'>=',value:'2025-08-25'},{kind:'orderBy',key:'day',direction:'desc'},{kind:'limit',value:1000}])
})
test('live workout query replaces the returned window without resurrecting deleted records',()=>{
 const h=harness();h.authorize()
 h.rows('workouts',[{workoutId:'old',day:'2026-09-10'},{workoutId:'new',day:'2026-09-11'}]);h.rows('meals',[])
 h.api.openWorkout('old');assert.equal(h.api.state.selectedWorkout.workoutId,'old')
 h.rows('workouts',[{workoutId:'new',day:'2026-09-11'}]);assert.deepEqual(plain(h.api.state.historyWorkouts.map(x=>x.workoutId)),['new']);assert.equal(h.api.state.selectedWorkout,null);assert.equal(h.api.state.view,'home');assert.equal(h.fetches.length,0)
})
test('permission denial clears all sensitive state and never automatically retries',()=>{
 const h=harness();h.live();h.rows('workouts',[{workoutId:'a',day:'2026-09-11'}]);h.api.state.archiveMealsByMonth.set('2026-08',[{mealId:'private-old'}]);h.error('root','permission-denied')
 assert.equal(h.api.state.source,'restricted');assert.equal(h.api.state.authorized,false);assert.equal(h.api.state.root,null);assert.equal(h.api.state.workouts.length,0);assert.equal(h.api.state.archiveMealsByMonth.size,0)
 const n=h.subscriptions.length;h.tick(120000);h.window.dispatch('online');assert.equal(h.subscriptions.length,n);assert.match(h.getNode('founder-live-screen').innerHTML,/unavailable for this account/)
})
test('new auth generation ignores delayed root/workout/meal callbacks after sign-out',()=>{
 const h=harness();h.live();const root=h.find('root'),workouts=h.find('workouts'),meals=h.find('meals');h.user(null)
 root.next(h.snap({published:true,trainingPublished:true}));workouts.next({docs:[{id:'late',data:()=>({day:'2026-09-11'})}],size:1,metadata:{fromCache:false},docChanges:()=>[{}]});meals.next({docs:[{id:'late',data:()=>({day:'2026-09-11'})}],metadata:{fromCache:false}})
 assert.equal(h.api.state.root,null);assert.equal(h.api.state.workouts.length,0);assert.equal(h.api.state.liveMeals.length,0);assert.equal(h.api.state.source,'signedOut')
})
test('terminal channel failure stays unhealthy despite other fresh snapshots and retries once with backoff',()=>{
 const h=harness();h.live();assert.equal(h.api.state.source,'live');h.error('workouts','unavailable');const timer=h.api.state.retryTimer;assert.ok(timer)
 h.root();h.rows('meals',[]);assert.notEqual(h.api.state.source,'live');assert.equal(h.api.state.retryTimer,timer)
 const count=h.subscriptions.length;h.tick(4999);assert.equal(h.subscriptions.length,count);h.tick(1);assert.ok(h.subscriptions.length>count);assert.equal(h.api.state.retryTimer,null)
})
test('hidden pages pause retry timers and resubscribe on visibility resume',()=>{
 const h=harness();h.live();h.error('workouts','unavailable');h.document.hidden=true;h.document.dispatch('visibilitychange');const count=h.subscriptions.length;h.tick(70000);assert.equal(h.subscriptions.length,count)
 h.document.hidden=false;h.document.dispatch('visibilitychange');assert.ok(h.subscriptions.length>count)
})
test('late route callbacks cannot populate a different selected workout or a signed-out view',()=>{
 const h=harness();h.live();h.rows('workouts',[{workoutId:'a',day:'2026-09-11',routePublished:true},{workoutId:'b',day:'2026-09-10',routePublished:true}])
 h.api.openWorkout('a');const routeA=h.find('a');h.api.openWorkout('b');const routeB=h.find('b');routeA.next(h.snap({sentinel:'wrong-route'}));assert.equal(h.api.state.route,null)
 h.user(null);routeB.next(h.snap({sentinel:'signed-out-route'}));assert.equal(h.api.state.route,null);assert.match(h.getNode('founder-live-screen').innerHTML,/Sign in/)
})
test('late archive errors and finally blocks cannot replace a newer account request state',async()=>{
 const first=deferred(),second=deferred();let calls=0;const h=harness({fetchImpl:()=>++calls===1?first.promise:second.promise});h.live();const old=h.api.loadFounderArchive();h.user(null);h.user({uid:'adult-two'});h.root();const current=h.api.loadFounderArchive()
 first.reject(new Error('old request failed'));await old;assert.equal(h.api.state.archiveError,null);assert.equal(h.api.state.archiveLoading,true)
 second.resolve({ok:true,json:async()=>({months:[],weeks:[]})});await current;assert.equal(h.api.state.archiveLoading,false);assert.deepEqual(plain(h.api.state.archiveManifest),{months:[],weeks:[]})
})
test('unpublished optional surfaces attach no listeners and do not invalidate allowed root/workouts',()=>{
 const h=harness();h.authorize({trainingPublished:true,mealsPublished:false,trainingPlanPublished:false});assert.equal(h.find('meals'),undefined);assert.equal(h.find('current'),undefined)
 h.rows('workouts',[]);assert.equal(h.api.state.source,'live');assert.equal(h.api.state.authorized,true)
})
test('publication revocation clears channel rows and ignores queued callbacks without losing other allowed surfaces',()=>{
 const h=harness();h.live();h.rows('meals',[{mealId:'withdrawn',day:'2026-09-11'}]);const old=h.find('meals');h.root({mealsPublished:false})
 assert.equal(old.active,false);assert.equal(h.api.state.liveMeals.length,0);old.next({docs:[{id:'late',data:()=>({day:'2026-09-11'})}],metadata:{fromCache:false}});assert.equal(h.api.state.liveMeals.length,0);assert.equal(h.api.state.source,'live')
})
test('connection display follows fresh/cache/failed channel state instead of an unconditional live badge',()=>{
 const h=harness();h.authorize();h.rows('workouts',[],{cache:true});h.rows('meals',[]);assert.notEqual(h.api.state.source,'live');assert.match(h.getNode('founder-live-status').textContent,/Syncing/)
 h.rows('workouts',[]);assert.equal(h.api.state.source,'live');assert.match(h.getNode('founder-longitudinal-record').innerHTML,/Live · listening for updates/)
 h.error('workouts','unavailable');assert.doesNotMatch(h.getNode('founder-live-status').textContent,/Live · listening/)
})
test('recent meal query respects the record timezone rather than the UTC calendar date',()=>{
 const h=harness({now:'2026-09-12T04:59:30Z'});h.authorize({timeZone:'America/Chicago'});const query=h.find('meals').ref
 assert.deepEqual(plain(query.constraints),[{kind:'where',key:'day',op:'<=',value:'2026-09-11'},{kind:'orderBy',key:'day',direction:'desc'},{kind:'limit',value:80}])
})
test('a visible midnight rollover renews the bounded meal query without reconnecting healthy workouts',()=>{
 const h=harness({now:'2026-09-12T04:59:30Z'});h.live({timeZone:'America/Chicago'});const old=h.find('meals'),workouts=h.find('workouts');h.tick(60000)
 const current=h.find('meals');assert.notEqual(current,old);assert.equal(old.active,false);assert.equal(h.find('workouts'),workouts);assert.equal(current.ref.constraints.find(x=>x.kind==='where').value,'2026-09-12')
})
test('browser offline state never keeps a live badge and online resumes a bounded connection',()=>{
 const h=harness();h.live();h.context.navigator.onLine=false;h.window.dispatch('offline');assert.notEqual(h.api.state.source,'live');assert.doesNotMatch(h.getNode('founder-live-status').textContent,/Live · listening/)
 const count=h.subscriptions.length;h.context.navigator.onLine=true;h.window.dispatch('online');assert.ok(h.subscriptions.length>count)
})
test('recent live meals render independently of a pending or failed historical manifest',async()=>{
 const pending=deferred(),h=harness({fetchImpl:()=>pending.promise});h.live();h.rows('meals',[{mealId:'fresh',day:'2026-09-11',title:'Fresh current meal',items:[],nutrients:[]}]);
 h.api.state.archiveMealsByMonth.set('2026-08',[{mealId:'stale',day:'2026-08-09',title:'Old static meal',items:[],nutrients:[]}]);h.api.state.archiveOpen=true
 const loading=h.api.loadFounderArchive();h.api.renderArchive();assert.deepEqual(plain(h.api.archiveMealPool().map(x=>x.mealId)),['fresh'])
 assert.match(h.getNode('founder-history-archive-screen').innerHTML,/Fresh current meal/);assert.doesNotMatch(h.getNode('founder-history-archive-screen').innerHTML,/Old static meal/)
 pending.reject(new Error('historical manifest offline'));await loading;h.api.renderArchive();assert.match(h.getNode('founder-history-archive-screen').innerHTML,/Fresh current meal/);assert.equal(h.api.state.archiveManifest,null)
})
test('recent live replacement removes a deleted meal despite its presence in a loaded old archive',()=>{
 const h=harness();h.live();h.rows('meals',[{mealId:'deleted',day:'2026-09-11'},{mealId:'kept',day:'2026-09-10'}]);h.api.state.archiveMealsByMonth.set('2026-08',[{mealId:'deleted',day:'2026-09-11'}]);
 h.rows('meals',[{mealId:'kept',day:'2026-09-10'}]);assert.deepEqual(plain(h.api.archiveMealPool().map(x=>x.mealId)),['kept'])
})
test('returning from an explicit historical month to recent mode makes no static request and shows current rows',async()=>{
 const h=harness();h.live();h.rows('meals',[{mealId:'fresh',day:'2026-09-11',title:'Fresh current meal',items:[],nutrients:[]}]);
 h.api.state.archiveManifest={months:[{month:'2026-08',path:'/history/aug.json'}],weeks:[],reliableThroughDay:'2026-08-21'};h.api.state.archiveMealsByMonth.set('2026-08',[{mealId:'old',day:'2026-08-09',title:'Old explicit month',items:[],nutrients:[]}]);h.api.state.archiveOpen=true
 await h.api.selectArchiveMonth('2026-08');assert.deepEqual(plain(h.api.archiveMealPool().map(x=>x.mealId)),['old']);const requests=h.fetches.length
 await h.api.selectArchiveMonth('recent');assert.equal(h.api.state.archiveMonth,null);assert.deepEqual(plain(h.api.archiveMealPool().map(x=>x.mealId)),['fresh']);assert.equal(h.fetches.length,requests);assert.match(h.getNode('founder-history-archive-screen').innerHTML,/Fresh current meal/)
})
