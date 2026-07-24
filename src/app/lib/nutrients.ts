// Nutrient catalog — TypeScript mirror of
// biometrics/StatsKey/Utilities/NutrientDatabase.swift (103 nutrients across
// 8 categories). Ids are the canonical snake_case keys used in
// FoodItem.nutrients; RDIs and sort order match iOS exactly so the web
// nutrition facts label renders identical %DV values.

export type NutrientCategory =
  | 'Energy'
  | 'Macros'
  | 'Vitamins'
  | 'Minerals'
  | 'Fats & Lipids'
  | 'Amino Acids'
  | 'Carotenoids'
  | 'Other'

/** Category display order, matching NutrientCategory.allCases on iOS. */
export const NUTRIENT_CATEGORIES: NutrientCategory[] = [
  'Energy',
  'Macros',
  'Vitamins',
  'Minerals',
  'Fats & Lipids',
  'Amino Acids',
  'Carotenoids',
  'Other',
]

export type NutrientUnit = 'kcal' | 'kj' | 'g' | 'mg' | 'mcg' | 'iu' | 'fl oz' | 'ml' | 'L'

export interface NutrientDefinition {
  id: string
  name: string
  unit: NutrientUnit
  category: NutrientCategory
  rdiMale?: number
  rdiFemale?: number
  sortOrder: number
}

function def(
  id: string,
  name: string,
  unit: NutrientUnit,
  category: NutrientCategory,
  rdiMale: number | undefined,
  rdiFemale: number | undefined,
  sortOrder: number
): NutrientDefinition {
  return { id, name, unit, category, rdiMale, rdiFemale, sortOrder }
}

// MARK: - Energy (2)

const ENERGY: NutrientDefinition[] = [
  def('calories', 'Calories', 'kcal', 'Energy', 2600, 2000, 0),
  def('energy_kj', 'Energy', 'kj', 'Energy', 10878, 8368, 1),
]

// MARK: - Macros (10)

const MACROS: NutrientDefinition[] = [
  def('protein', 'Protein', 'g', 'Macros', 56, 46, 10),
  def('carbohydrates', 'Carbohydrates', 'g', 'Macros', 275, 275, 11),
  def('total_fat', 'Total Fat', 'g', 'Macros', 78, 78, 12),
  def('dietary_fiber', 'Dietary Fiber', 'g', 'Macros', 38, 25, 13),
  def('total_sugars', 'Total Sugars', 'g', 'Macros', undefined, undefined, 14),
  def('added_sugars', 'Added Sugars', 'g', 'Macros', 50, 50, 15),
  def('sugar_alcohols', 'Sugar Alcohols', 'g', 'Macros', undefined, undefined, 16),
  def('alcohol', 'Alcohol', 'g', 'Macros', 28, 14, 17),
  def('caffeine', 'Caffeine', 'mg', 'Macros', 400, 400, 18),
  def('water', 'Water', 'ml', 'Macros', 3700, 2700, 19),
]

// MARK: - Vitamins (14)

const VITAMINS: NutrientDefinition[] = [
  def('vitamin_a', 'Vitamin A', 'mcg', 'Vitamins', 900, 700, 20),
  def('vitamin_c', 'Vitamin C', 'mg', 'Vitamins', 90, 75, 21),
  def('vitamin_d', 'Vitamin D', 'mcg', 'Vitamins', 20, 20, 22),
  def('vitamin_e', 'Vitamin E', 'mg', 'Vitamins', 15, 15, 23),
  def('vitamin_k', 'Vitamin K', 'mcg', 'Vitamins', 120, 90, 24),
  def('vitamin_b1', 'Thiamin (B1)', 'mg', 'Vitamins', 1.2, 1.1, 25),
  def('vitamin_b2', 'Riboflavin (B2)', 'mg', 'Vitamins', 1.3, 1.1, 26),
  def('vitamin_b3', 'Niacin (B3)', 'mg', 'Vitamins', 16, 14, 27),
  def('vitamin_b5', 'Pantothenic Acid (B5)', 'mg', 'Vitamins', 5, 5, 28),
  def('vitamin_b6', 'Vitamin B6', 'mg', 'Vitamins', 1.3, 1.3, 29),
  def('vitamin_b7', 'Biotin (B7)', 'mcg', 'Vitamins', 30, 30, 30),
  def('vitamin_b9', 'Folate (B9)', 'mcg', 'Vitamins', 400, 400, 31),
  def('vitamin_b12', 'Vitamin B12', 'mcg', 'Vitamins', 2.4, 2.4, 32),
  def('choline', 'Choline', 'mg', 'Vitamins', 550, 425, 33),
]

// MARK: - Minerals (14)

const MINERALS: NutrientDefinition[] = [
  def('calcium', 'Calcium', 'mg', 'Minerals', 1000, 1000, 40),
  def('iron', 'Iron', 'mg', 'Minerals', 8, 18, 41),
  def('magnesium', 'Magnesium', 'mg', 'Minerals', 420, 320, 42),
  def('phosphorus', 'Phosphorus', 'mg', 'Minerals', 700, 700, 43),
  def('potassium', 'Potassium', 'mg', 'Minerals', 3400, 2600, 44),
  def('sodium', 'Sodium', 'mg', 'Minerals', 2300, 2300, 45),
  def('zinc', 'Zinc', 'mg', 'Minerals', 11, 8, 46),
  def('copper', 'Copper', 'mg', 'Minerals', 0.9, 0.9, 47),
  def('manganese', 'Manganese', 'mg', 'Minerals', 2.3, 1.8, 48),
  def('selenium', 'Selenium', 'mcg', 'Minerals', 55, 55, 49),
  def('chromium', 'Chromium', 'mcg', 'Minerals', 35, 25, 50),
  def('molybdenum', 'Molybdenum', 'mcg', 'Minerals', 45, 45, 51),
  def('iodine', 'Iodine', 'mcg', 'Minerals', 150, 150, 52),
  def('fluoride', 'Fluoride', 'mg', 'Minerals', 4, 3, 53),
]

// MARK: - Fats & Lipids (11)

const FATS_AND_LIPIDS: NutrientDefinition[] = [
  def('saturated_fat', 'Saturated Fat', 'g', 'Fats & Lipids', 20, 20, 60),
  def('monounsaturated_fat', 'Monounsaturated Fat', 'g', 'Fats & Lipids', undefined, undefined, 61),
  def('polyunsaturated_fat', 'Polyunsaturated Fat', 'g', 'Fats & Lipids', undefined, undefined, 62),
  def('trans_fat', 'Trans Fat', 'g', 'Fats & Lipids', undefined, undefined, 63),
  def('cholesterol', 'Cholesterol', 'mg', 'Fats & Lipids', 300, 300, 64),
  def('omega_3', 'Omega-3 (Total)', 'g', 'Fats & Lipids', 1.6, 1.1, 65),
  def('omega_6', 'Omega-6 (Total)', 'g', 'Fats & Lipids', 17, 12, 66),
  def('dha', 'DHA', 'mg', 'Fats & Lipids', undefined, undefined, 67),
  def('epa', 'EPA', 'mg', 'Fats & Lipids', undefined, undefined, 68),
  def('ala', 'ALA (Alpha-Linolenic)', 'g', 'Fats & Lipids', 1.6, 1.1, 69),
  def('cla', 'CLA (Conjugated Linoleic)', 'mg', 'Fats & Lipids', undefined, undefined, 70),
]

// MARK: - Amino Acids (20)
// RDIs: absolute mg based on WHO/FAO/UNU 2007 (mg/kg/day × 70kg male / 57.5kg female)

const AMINO_ACIDS: NutrientDefinition[] = [
  def('histidine', 'Histidine', 'mg', 'Amino Acids', 700, 575, 80),
  def('isoleucine', 'Isoleucine', 'mg', 'Amino Acids', 1400, 1150, 81),
  def('leucine', 'Leucine', 'mg', 'Amino Acids', 2730, 2243, 82),
  def('lysine', 'Lysine', 'mg', 'Amino Acids', 2100, 1725, 83),
  def('methionine', 'Methionine', 'mg', 'Amino Acids', 1050, 863, 84),
  def('phenylalanine', 'Phenylalanine', 'mg', 'Amino Acids', 1750, 1438, 85),
  def('threonine', 'Threonine', 'mg', 'Amino Acids', 1050, 863, 86),
  def('tryptophan', 'Tryptophan', 'mg', 'Amino Acids', 280, 230, 87),
  def('valine', 'Valine', 'mg', 'Amino Acids', 1820, 1495, 88),
  def('alanine', 'Alanine', 'mg', 'Amino Acids', undefined, undefined, 89),
  def('arginine', 'Arginine', 'mg', 'Amino Acids', undefined, undefined, 90),
  def('aspartic_acid', 'Aspartic Acid', 'mg', 'Amino Acids', undefined, undefined, 91),
  def('cysteine', 'Cysteine', 'mg', 'Amino Acids', undefined, undefined, 92),
  def('glutamic_acid', 'Glutamic Acid', 'mg', 'Amino Acids', undefined, undefined, 93),
  def('glycine', 'Glycine', 'mg', 'Amino Acids', undefined, undefined, 94),
  def('proline', 'Proline', 'mg', 'Amino Acids', undefined, undefined, 95),
  def('serine', 'Serine', 'mg', 'Amino Acids', undefined, undefined, 96),
  def('tyrosine', 'Tyrosine', 'mg', 'Amino Acids', undefined, undefined, 97),
  def('hydroxyproline', 'Hydroxyproline', 'mg', 'Amino Acids', undefined, undefined, 98),
  def('taurine', 'Taurine', 'mg', 'Amino Acids', undefined, undefined, 99),
]

// MARK: - Carotenoids (7)

const CAROTENOIDS: NutrientDefinition[] = [
  def('beta_carotene', 'Beta-Carotene', 'mcg', 'Carotenoids', undefined, undefined, 100),
  def('alpha_carotene', 'Alpha-Carotene', 'mcg', 'Carotenoids', undefined, undefined, 101),
  def('beta_cryptoxanthin', 'Beta-Cryptoxanthin', 'mcg', 'Carotenoids', undefined, undefined, 102),
  def('lycopene', 'Lycopene', 'mcg', 'Carotenoids', undefined, undefined, 103),
  def('lutein_zeaxanthin', 'Lutein + Zeaxanthin', 'mcg', 'Carotenoids', undefined, undefined, 104),
  def('retinol', 'Retinol', 'mcg', 'Carotenoids', undefined, undefined, 105),
  def('zeaxanthin', 'Zeaxanthin', 'mcg', 'Carotenoids', undefined, undefined, 106),
]

// MARK: - Other (25)

const OTHER: NutrientDefinition[] = [
  def('starch', 'Starch', 'g', 'Other', undefined, undefined, 110),
  def('sucrose', 'Sucrose', 'g', 'Other', undefined, undefined, 111),
  def('glucose_sugar', 'Glucose', 'g', 'Other', undefined, undefined, 112),
  def('fructose', 'Fructose', 'g', 'Other', undefined, undefined, 113),
  def('lactose', 'Lactose', 'g', 'Other', undefined, undefined, 114),
  def('maltose', 'Maltose', 'g', 'Other', undefined, undefined, 115),
  def('galactose', 'Galactose', 'g', 'Other', undefined, undefined, 116),
  def('ash', 'Ash', 'g', 'Other', undefined, undefined, 117),
  def('theobromine', 'Theobromine', 'mg', 'Other', undefined, undefined, 118),
  def('net_carbs', 'Net Carbs', 'g', 'Other', undefined, undefined, 119),
  def('soluble_fiber', 'Soluble Fiber', 'g', 'Other', undefined, undefined, 120),
  def('insoluble_fiber', 'Insoluble Fiber', 'g', 'Other', undefined, undefined, 121),
  def('resistant_starch', 'Resistant Starch', 'g', 'Other', undefined, undefined, 122),
  def('beta_glucan', 'Beta-Glucan', 'g', 'Other', undefined, undefined, 123),
  def('pectin', 'Pectin', 'g', 'Other', undefined, undefined, 124),
  def('phytosterols', 'Phytosterols', 'mg', 'Other', undefined, undefined, 125),
  def('butyric_acid', 'Butyric Acid (4:0)', 'g', 'Other', undefined, undefined, 126),
  def('capric_acid', 'Capric Acid (10:0)', 'g', 'Other', undefined, undefined, 127),
  def('lauric_acid', 'Lauric Acid (12:0)', 'g', 'Other', undefined, undefined, 128),
  def('myristic_acid', 'Myristic Acid (14:0)', 'g', 'Other', undefined, undefined, 129),
  def('palmitic_acid', 'Palmitic Acid (16:0)', 'g', 'Other', undefined, undefined, 130),
  def('stearic_acid', 'Stearic Acid (18:0)', 'g', 'Other', undefined, undefined, 131),
  def('oleic_acid', 'Oleic Acid (18:1)', 'g', 'Other', undefined, undefined, 132),
  def('linoleic_acid', 'Linoleic Acid (18:2)', 'g', 'Other', undefined, undefined, 133),
  def('linolenic_acid', 'Linolenic Acid (18:3)', 'g', 'Other', undefined, undefined, 134),
]

export const NUTRIENT_DB: NutrientDefinition[] = [
  ...ENERGY,
  ...MACROS,
  ...VITAMINS,
  ...MINERALS,
  ...FATS_AND_LIPIDS,
  ...AMINO_ACIDS,
  ...CAROTENOIDS,
  ...OTHER,
]

const INDEX_BY_ID = new Map(NUTRIENT_DB.map((d) => [d.id, d]))

export function nutrientById(id: string): NutrientDefinition | undefined {
  return INDEX_BY_ID.get(id)
}

export function nutrientsInCategory(category: NutrientCategory): NutrientDefinition[] {
  return NUTRIENT_DB.filter((d) => d.category === category).sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * Reference daily intake used for the nutrition facts label's %DV column.
 * Mirrors NutrientDefinition.rdi on iOS, which uses the male RDI constant.
 */
export function labelRdi(defn: NutrientDefinition): number | undefined {
  return defn.rdiMale
}
