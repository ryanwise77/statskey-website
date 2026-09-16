import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {nutritionRuntime} from './nutrition-test-runtime.mjs'
const m = await nutritionRuntime()
const fixture = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/nutrition/${name}.json`, import.meta.url)))
const captured = fixture('observed-web-photo'), legacy = fixture('legacy-web-photo'), reference = fixture('sourced-reference')
const recognized = () => m.toFoodItem(m.parseGeminiFoods(captured.content)[0], 'photoLibrary', 'food')
const completed = () => m.applySourceNutrition(recognized(), reference)

test('actual old website response does not promote per100g guesses to serving nutrition', () => {
  const item = m.toFoodItem(m.parseGeminiFoods(legacy.content)[0], 'photoLibrary', 'food')
  assert.deepEqual(item.nutrients, {})
  assert.equal(item.printedLabel, undefined)
})
test('actual photo observation uses literal NET 16 fl oz over model default 1 serving without inventing grams or brand', () => {
  const item = recognized(), request=m.sourceNutritionRequest(item).food
  assert.equal(item.servingSize,16);assert.equal(item.servingUnit,'fl oz')
  assert.equal(item.gramWeight,undefined);assert.equal(item.brand,undefined)
  assert.equal(item.photoPackageQuantityContext,'single_serving_package');assert.equal(item.photoPackageObservations.packageNetVolumeText,'16 FL OZ')
  assert.equal(request.gramWeight,undefined);assert.ok(Math.abs(request.servingVolumeMl-473.176473)<.001)
  assert.equal(request.ingredients,'Organic Orange.');assert.equal(request.preparation,'raw');assert.deepEqual(request.productClaims,['Organic','NON-PASTEURIZED']);assert.equal(request.labelNutrition,undefined)
})
test('new callable observation contract states whole package, explicit user quantity and no invented source facts', () => {
  const req=m.buildNutritionRecognitionRequest({query:'half the bottle',images:['test-image']})
  assert.equal(req.nativeContext.version,1);assert.match(req.nativeContext.prompt,/Preserve the user's explicit consumed quantity/)
  assert.match(req.nativeContext.prompt,/nutrients must be \{\}/);assert.deepEqual(req.images,['test-image'])
})
test('explicit consumed half package quantity is not replaced by NET amount', () => {
  const food=m.parseGeminiFoods(captured.content)[0]
  const item=m.toFoodItem({...food,servingSize:8,servingUnit:'fl oz',consumedQuantityBasis:'user_explicit'},'photoLibrary','food')
  assert.equal(item.servingSize,8);assert.equal(item.quantityWasUserAdjusted,true)
})
test('literal fluid ounces and mass ounces cannot substitute for one another', () => {
  assert.deepEqual(m.readPrintedPackageServing('16 FL OZ',undefined),{size:16,unit:'fl oz'})
  assert.equal(m.readPrintedPackageServing('16 OZ',undefined),undefined)
  const item=recognized();assert.equal(m.convertServingAmount(item,16,'fl oz','oz'),undefined)
  assert.equal(m.sourceNutritionRequest({...item,servingUnit:'oz'}).food.servingVolumeMl,undefined)
})
test('real USDA response lands once at 223.2 calories with explicit reference provenance and unknown product grams', () => {
  const item=completed();assert.equal(item.nutrients.calories,223.2)
  assert.equal(item.baseNutrients.calories,223.2);assert.equal(item.gramWeight,undefined)
  assert.equal(item.nutrientFillSources.calories,'usda_analog')
  assert.equal(item.nutrientProvenance.calories,'analog_row')
  assert.equal(item.nutritionSourceCompletion,'partial')
  assert.equal(item.commodityReferenceBasis.requestedGramWeight,496)
  assert.equal(item.enrichmentIngredients,'Organic Orange.')
  assert.equal(item.nutrients.caffeine,0);assert.equal(item.nutrients.iodine,undefined)
  assert.ok(item.nutrientUnknownReason.iodine)
})
test('volume unit conversion keeps full amount and half/full/double nutrients correctly', () => {
  const item=completed(), ml=m.convertServingAmount(item,16,'fl oz','ml')
  assert.ok(Math.abs(ml-473.176)<.001)
  assert.ok(Math.abs(m.nutrientsForServing(item,ml,'ml').calories-223.2)<1e-9)
  for(const factor of [.5,1,2]) assert.equal(m.nutrientsForServing(item,16*factor,'fl oz').calories,223.2*factor)
})
test('manual/printed values and zeros plus existing base values survive missing-only completion', () => {
  const initial={...recognized(),nutrients:{calories:200,sodium:0},baseNutrients:{calories:100,sodium:0},baseServingSize:8,
    nutrientFillSources:{calories:'product_claim'},nutrientProvenance:{calories:'label_declared'},
    nutrientEvidenceIDs:{calories:'printed-1'},nutritionEvidence:[{id:'printed-1'}]}
  const item=m.applySourceNutrition(initial,reference)
  assert.equal(item.nutrients.calories,200);assert.equal(item.nutrients.sodium,0)
  assert.equal(item.baseNutrients.calories,100);assert.equal(item.baseServingSize,8)
  assert.equal(item.baseNutrients.protein,item.nutrients.protein/2)
  assert.equal(item.nutrientProvenance.calories,'label_declared')
  assert.deepEqual(item.nutritionEvidence,initial.nutritionEvidence)
})
test('wrong product or incompatible response serving cannot populate nutrition', () => {
  for(const bad of [{...reference,wrongProductSuspect:true},{...reference,servingSize:8,servingUnit:'fl oz'},
    {...reference,sourceSelectedDefaultServing:true},{...reference,commodityReferenceBasis:{...reference.commodityReferenceBasis,targetServing:{size:16,unit:'oz'}}}]) {
    assert.deepEqual(m.applySourceNutrition(recognized(),bad).nutrients,{})
  }
})
test('unsourced and omitted zero values stay unknown', () => {
  const item=m.applySourceNutrition(recognized(),{nutrients:{calories:220,iodine:0},nutrientSources:{calories:'ai',iodine:'ai'}})
  assert.deepEqual(item.nutrients,{})
})
test('printed panel values retain column basis and printed zero even when source unavailable', () => {
  const item=m.toFoodItem({name:'Label drink',servingSize:16,servingUnit:'fl oz',labelServingSize:8,labelServingUnit:'fl oz',
    visibleLabelNutrition:{calories:90,sodium:0},visibleLabelNutritionBasis:'per_serving',nutrients:{calories:400}},'labelScan','food')
  assert.deepEqual(item.nutrients,{calories:180,sodium:0})
  assert.equal(item.printedLabel.nutrients.calories,90)
  assert.equal(m.sourceNutritionRequest(item).food.labelNutrition.basis,'per_serving')
})
test('actual draft, writer and decoder retain rich proof/current/base/partial metadata and explicit zeros', () => {
  const item={...completed(),defaultNutrientEvidenceID:'reference-1',nutritionEvidence:[{id:'reference-1'}],nutritionSearchTrace:{version:1},householdUnitGramWeights:{'fl oz':31}};const saved=m.encodeFoodItem(m.draftToFoodItem(m.itemToDraft(item)))
  const decoded=m.decodeFoodItem(saved,item.id)
  for(const key of ['defaultNutrientEvidenceID','nutritionEvidence','nutritionSearchTrace','householdUnitGramWeights','nutrients','baseNutrients','nutrientFillSources','nutrientCitations','nutrientProvenance','nutrientRanges','nutrientUnknownReason','commodityReferenceBasis','photoPackageQuantityContext','photoPackageObservations','nutritionSourceCompletion','explicitZeroNutrientKeys']) {
    assert.deepEqual(saved[key],item[key],`writer ${key}`);assert.deepEqual(decoded[key],item[key],`decoder ${key}`)
  }
  assert.equal(saved.gramWeight,undefined)
})
test('manual edit clears per-key source IDs and uncertainty without clearing other facts', () => {
  const item=completed();item.nutrientEvidenceIDs={calories:'source-1',protein:'source-2'}
  const edited=m.clearFillProvenance({...item,nutrients:{...item.nutrients,calories:0}},['calories'])
  assert.equal(edited.nutrients.calories,0);assert.equal(edited.nutrientEvidenceIDs.calories,undefined)
  assert.equal(edited.nutrientCitations.calories,undefined);assert.equal(edited.nutrientRanges.calories,undefined)
  assert.equal(edited.nutrientEvidenceIDs.protein,'source-2')
})
test('actual analyze→source→draft→save path uses authenticated SDK callables and one serving basis', async () => {
  const calls=[];globalThis.__nutritionCall=async(name,data,options)=>{calls.push({name,data,options});return{data:name==='geminiNutrition'?captured:reference}}
  const [item]=await m.analyzeNutritionInput({query:'Food photo nutrition analysis',images:['test-image']},'photoLibrary')
  assert.deepEqual(calls.map(v=>v.name),['geminiNutrition','webEnrichFood'])
  assert.equal(calls[1].data.food.servingSize,16);assert.equal(calls[1].data.food.servingUnit,'fl oz')
  assert.equal(item.nutrients.calories,223.2)
  let write;globalThis.__nutritionSave=async(...args)=>{write=args}
  const now=new Date();await m.saveMeal('nutrition-test-user',{id:'meal',userId:'nutrition-test-user',items:[m.draftToFoodItem(m.itemToDraft(item))],date:now,multiplier:1,isFavorite:false,createdAt:now,updatedAt:now})
  assert.deepEqual(write[0].slice(1),['users','nutrition-test-user','meals','meal'])
  assert.equal(write[1].items[0].nutrients.calories,223.2)
  assert.equal(write[1].items[0].nutritionSourceCompletion,'partial')
})
test('source failure keeps recognizable item and unknown nutrition for saved completion', async () => {
  globalThis.__nutritionCall=async name=>{if(name==='geminiNutrition')return{data:captured};throw new Error('temporarily unavailable')}
  const [item]=await m.analyzeNutritionInput({query:'Food photo nutrition analysis'},'photoLibrary')
  assert.equal(item.name,'Organic Orange Juice');assert.deepEqual(item.nutrients,{})
  assert.equal(item.nutritionSourceCompletion,'unavailable')
})

test('observed NON-PASTEURIZED excludes the actual canned source mismatch', () => {
  const item=m.applySourceNutrition(recognized(), {...reference,resolvedName:'Orange juice, canned, unsweetened'})
  assert.deepEqual(item.nutrients,{})
  assert.deepEqual(item.visibleProductClaims,['Organic','NON-PASTEURIZED'])
})

test('verified literal source default can fill an unchanged typed item but never a protected quantity', () => {
  const item={...recognized(),source:'aiSearch',quantityBasis:'model_default',servingSize:1,servingUnit:'serving',baseServingSize:1,baseServingUnit:'serving',photoPackageQuantityContext:undefined,preparation:undefined}
  const source={sourceSelectedDefaultServing:true,basisChecked:true,matchType:'exact',labelVerification:'source_page',sourceServingReadVersion:2,
    selectedServingSize:3,selectedServingUnit:'cracker',sourceHouseholdServingCount:3,sourceHouseholdServingUnit:'cracker',sourceServingGramWeight:30,resolvedServingGramWeight:30,
    referenceServingText:'3 crackers (30 g)',citation:'https://example.com/food',nutrients:{calories:120,protein:3,carbohydrates:20,total_fat:3},nutrientSources:{calories:'web',protein:'web',carbohydrates:'web',total_fat:'web'}}
  const completed=m.applySourceNutrition(item,source)
  assert.equal(completed.servingSize,3);assert.equal(completed.servingUnit,'cracker');assert.equal(completed.gramWeight,30);assert.equal(completed.nutrients.calories,120)
  for(const patch of [{quantityWasUserAdjusted:true},{gramWeight:40},{photoPackageQuantityContext:{}},{source:'photoLibrary'},{quantityBasis:'printed_package'},{nutrients:{sodium:0}}]) {
    const held={...item,...patch};assert.deepEqual(m.applySourceNutrition(held,source).nutrients,held.nutrients)
  }
  assert.deepEqual(m.applySourceNutrition(item,{...source,referenceServingText:'3 crackers (60 g)'}).nutrients,{})
})

test('serving adjustment scales current ranges while retaining original source evidence', () => {
  const item=completed(), next={...item,...m.rescaleCurrentNutritionMetadata(item,.5)}
  assert.equal(next.nutrientRanges.calories.min,item.nutrientRanges.calories.min/2)
  assert.equal(next.nutrientRanges.calories.max,item.nutrientRanges.calories.max/2)
  assert.deepEqual(next.commodityReferenceBasis,item.commodityReferenceBasis)
})

test('fresh recognition cannot attach nested half-serving mass to the flat full serving', () => {
  const food={name:'bread',servingSize:1,servingUnit:'slice',serving:{amount:.5,unit:'slice',grams:14}}
  assert.equal(m.toFoodItem(food,'photoLibrary','food').gramWeight,undefined)
  assert.equal(m.toFoodItem({...food,servingSize:.5},'photoLibrary','food').gramWeight,14)
  assert.equal(m.toFoodItem({name:'bread',serving:food.serving},'photoLibrary','food').gramWeight,14)
})
test('printed whole-package mass overrides an unrelated model label-serving mass', () => {
  const item=m.toFoodItem({name:'cracker',servingSize:1,servingUnit:'serving',gramWeight:20,
    packageNetMassText:'NET WT 200 g',packageNetWeightGrams:200,consumedQuantityBasis:'single_serving_package'},'photoLibrary','food')
  assert.equal(item.servingSize,200);assert.equal(item.servingUnit,'g');assert.equal(item.gramWeight,200)
})


test('manual zero on imported native food overrides default source only for the edited key across save', () => {
  const imported={...completed(),defaultNutrientEvidenceID:'native-default',
    nutritionEvidence:[{id:'native-default',source:'usdaAnalog',reusePolicy:'publicDomain'}]}
  const draft=m.itemToDraft(imported)
  const edited=m.markNutrientsAsUserEntered({...draft,nutrients:{...draft.nutrients,calories:0}},['calories'])
  const decoded=m.decodeFoodItem(m.encodeFoodItem(m.draftToFoodItem(edited)),imported.id)
  const sourceFor=key=>decoded.nutritionEvidence.find(record=>record.id===(decoded.nutrientEvidenceIDs?.[key]??decoded.defaultNutrientEvidenceID))
  assert.equal(decoded.nutrients.calories,0)
  assert.equal(sourceFor('calories').source,'userEntered')
  assert.equal(sourceFor('calories').sourcePolicyID,'user-provided-entry-v1')
  assert.equal(sourceFor('calories').basis,'userProvided')
  assert.equal(sourceFor('protein').source,'usdaAnalog')
  assert.equal(decoded.defaultNutrientEvidenceID,'native-default')
  assert.equal(decoded.nutrients.protein,imported.nutrients.protein)
  assert.equal(decoded.nutrientCitations.calories,undefined)
  assert.ok(decoded.explicitZeroNutrientKeys.includes('calories'))
  assert.equal(m.resolvedNutrientSource(decoded,'calories').source,'userEntered')
  const absent={...decoded,nutrients:{...decoded.nutrients}};delete absent.nutrients.calories
  const cleared=m.markNutrientsAsUserEntered(absent,['calories'])
  assert.equal(cleared.nutrientEvidenceIDs?.calories,undefined)
  assert.ok(!cleared.explicitZeroNutrientKeys.includes('calories'))
})
