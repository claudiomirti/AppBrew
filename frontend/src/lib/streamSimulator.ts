/**
 * Browser-side mirror of the `04_RT_Eventstream_Simulator` Fabric notebook.
 *
 * Dimensions, probabilities and batch volumes are kept identical to the notebook so the
 * charts on the Stream Analytics page explain the *same* data that lands in the
 * `mybrew_eventhouse` KQL database via `mybrew_rt_eventstream`.
 *
 * Notebook -> Eventstream -> Eventhouse tables mirrored here:
 *   POSTransactions | AdImpressions | WeatherEvents | ROIMetrics
 */

export interface PosEvent {
  txn_id: string
  customer_id: string
  store_id: string
  campaign_id: string
  product_id: string
  amount_gbp: number
  event_time: string
}

export interface ImpressionEvent {
  impression_id: string
  campaign_id: string
  customer_id: string
  publisher: string
  creative_id: string
  clicked: boolean
  converted: boolean
  spend_amount_gbp: number
  event_time: string
}

export interface WeatherEvent {
  city: string
  temp_c: number
  condition: string
  precip_mm: number
  event_time: string
}

export interface RoiEvent {
  campaign_id: string
  publisher: string
  region: string
  attributed_revenue_gbp: number
  total_spend_gbp: number
  roi: number
  conversions: number
  event_time: string
}

export interface Batch {
  index: number
  time: number
  pos: PosEvent[]
  impressions: ImpressionEvent[]
  weather: WeatherEvent[]
  roi: RoiEvent[]
  coldTriggers: number
}

/** Batch cadence of the notebook loop (seconds). */
export const INTERVAL_SECONDS = 5

export const CUSTOMERS = [
  'C-000001', 'C-000002', 'C-000003', 'C-000004', 'C-000005',
  'C-000006', 'C-000007', 'C-000008', 'C-000009', 'C-000010',
  'C-000011', 'C-000012', 'C-000015', 'C-000018', 'C-000020',
]

export const STORES: Record<string, string[]> = {
  London: ['STR-LDN-001', 'STR-LDN-002', 'STR-LDN-003', 'STR-LDN-004', 'STR-LDN-005'],
  Manchester: ['STR-MAN-001', 'STR-MAN-002'],
  'Los Angeles': ['STR-LA-001', 'STR-LA-002'],
  'San Francisco': ['STR-SF-001'],
  'New York': ['STR-NYC-001', 'STR-NYC-002'],
  Seattle: ['STR-SEA-001'],
}

interface Product { id: string; name: string; price: number }

export const PRODUCTS_HOT: Product[] = [
  { id: 'PRD-001', name: 'Hazelnut Flat White', price: 4.75 },
  { id: 'PRD-005', name: 'Chai Tea Latte', price: 4.5 },
  { id: 'PRD-006', name: 'Toffee Nut Crunch', price: 5.5 },
  { id: 'PRD-008', name: 'Matcha Oat Latte', price: 5.25 },
  { id: 'PRD-010', name: 'Gingerbread Latte', price: 5.5 },
  { id: 'PRD-011', name: 'Americano', price: 3.5 },
]

export const PRODUCTS_COLD: Product[] = [
  { id: 'PRD-002', name: 'Iced Caramel Macchiato', price: 5.25 },
  { id: 'PRD-004', name: 'Mango Dragonfruit', price: 4.95 },
  { id: 'PRD-007', name: 'Cold Brew Nitro', price: 5.0 },
  { id: 'PRD-009', name: 'Vanilla Sweet Cream', price: 5.25 },
]

export const HOT_PRODUCT_IDS = new Set(PRODUCTS_HOT.map(p => p.id))

const PRODUCT_NAMES: Record<string, string> = Object.fromEntries(
  [...PRODUCTS_HOT, ...PRODUCTS_COLD].map(p => [p.id, p.name]),
)

export function productName(id: string): string {
  return PRODUCT_NAMES[id] ?? id
}

interface Campaign { name: string; publisher: string; cpa_base: number }

export const CAMPAIGNS: Record<string, Campaign> = {
  'CMP-WW-2026': { name: 'Winter Warmth', publisher: 'Meta', cpa_base: 21.14 },
  'CMP-WW-2026-G': { name: 'Winter Warmth', publisher: 'Google', cpa_base: 32.0 },
  'CMP-WW-2026-A': { name: 'Winter Warmth', publisher: 'Amazon', cpa_base: 26.92 },
  'CMP-SS-2026': { name: 'Summer Sips', publisher: 'Meta', cpa_base: 18.5 },
  'CMP-WB-2026': { name: 'Win-Back Q3', publisher: 'Direct', cpa_base: 5.0 },
  'CMP-TN-2026': { name: 'Tier Nudge', publisher: 'Direct', cpa_base: 3.5 },
}

const CAMPAIGN_IDS = Object.keys(CAMPAIGNS)

export const CREATIVES: Record<string, string> = {
  Meta: 'CR-WW-Stories-01',
  Google: 'CR-WW-Display-01',
  Amazon: 'CR-WW-Sponsored-01',
  Direct: 'CR-WB-Push-01',
}

/** Click-through rate baked into the generator, per publisher. */
export const PUBLISHER_CTR: Record<string, number> = {
  Meta: 0.18, Google: 0.07, Amazon: 0.12, Direct: 0.4,
}

/** Return-on-ad-spend baseline used by the ROIMetrics generator. */
export const PUBLISHER_ROAS: Record<string, number> = {
  Meta: 4.2, Google: 2.8, Amazon: 3.4, Direct: 4.9,
}

/** Probability that a click converts (applied only to clicked impressions). */
export const CONVERSION_RATE = 0.14

/** Share of POS rows carrying a campaign attribution (the rest are organic). */
export const ATTRIBUTED_SHARE = 0.7

interface WeatherProfile { city: string; temp_base: number; condition: string; precip_base: number }

export const WEATHER_CITIES: WeatherProfile[] = [
  { city: 'London', temp_base: 3, condition: 'Snow/Sleet', precip_base: 12.0 },
  { city: 'London', temp_base: 4, condition: 'Rain', precip_base: 8.5 },
  { city: 'Manchester', temp_base: 4, condition: 'Rain', precip_base: 9.8 },
  { city: 'Manchester', temp_base: 5, condition: 'Sleet', precip_base: 7.2 },
  { city: 'Los Angeles', temp_base: 28, condition: 'Sunny', precip_base: 0.0 },
  { city: 'San Francisco', temp_base: 18, condition: 'Fog', precip_base: 0.0 },
  { city: 'New York', temp_base: 20, condition: 'Cloudy', precip_base: 2.0 },
  { city: 'Seattle', temp_base: 17, condition: 'Overcast', precip_base: 0.8 },
]

/** Traffic split used when picking a store for a POS event (London-heavy by design). */
const CITY_WEIGHTS: Array<[string, number]> = [
  ['London', 50], ['Manchester', 10], ['Los Angeles', 15],
  ['San Francisco', 8], ['New York', 12], ['Seattle', 5],
]

const REGIONS = ['London', 'Manchester', 'West Coast', 'East Coast']

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function randInt(min: number, max: number) {
  return Math.floor(rand(min, max + 1))
}

function round(value: number, digits: number) {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

function weightedCity(): string {
  const total = CITY_WEIGHTS.reduce((s, [, w]) => s + w, 0)
  let roll = Math.random() * total
  for (const [city, weight] of CITY_WEIGHTS) {
    roll -= weight
    if (roll <= 0) return city
  }
  return CITY_WEIGHTS[0][0]
}

/**
 * Resolve a city from a store_id prefix.
 * Mirrors the `case(store_id startswith ...)` expression used in the KQL visuals, so the
 * page and the dashboard bucket revenue identically.
 */
export function cityFromStore(storeId: string): string {
  if (storeId.startsWith('STR-LDN')) return 'London'
  if (storeId.startsWith('STR-MAN')) return 'Manchester'
  if (storeId.startsWith('STR-LA')) return 'Los Angeles'
  if (storeId.startsWith('STR-SF')) return 'San Francisco'
  if (storeId.startsWith('STR-NYC')) return 'New York'
  if (storeId.startsWith('STR-SEA')) return 'Seattle'
  return 'Other'
}

function iso(time: number) {
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function genPosEvent(time: number): PosEvent {
  const city = weightedCity()
  const store = pick(STORES[city])

  // Cold cities only sell hot drinks - this is the weather -> product-mix link.
  const profile = WEATHER_CITIES.find(w => w.city === city) ?? WEATHER_CITIES[0]
  const product = profile.temp_base < 10
    ? pick(PRODUCTS_HOT)
    : pick([...PRODUCTS_HOT, ...PRODUCTS_COLD])

  return {
    txn_id: `TXN-${time}${randInt(10, 99)}`,
    customer_id: pick(CUSTOMERS),
    store_id: store,
    campaign_id: Math.random() < ATTRIBUTED_SHARE ? pick(CAMPAIGN_IDS) : '',
    product_id: product.id,
    amount_gbp: round(product.price + rand(-0.2, 1.5), 2),
    event_time: iso(time),
  }
}

function genImpressionEvent(time: number): ImpressionEvent {
  const campaignId = pick(CAMPAIGN_IDS)
  const publisher = CAMPAIGNS[campaignId].publisher
  const clicked = Math.random() < PUBLISHER_CTR[publisher]
  const converted = clicked && Math.random() < CONVERSION_RATE

  return {
    impression_id: `IMP-${time}${randInt(10, 99)}`,
    campaign_id: campaignId,
    customer_id: pick(CUSTOMERS),
    publisher,
    creative_id: CREATIVES[publisher],
    clicked,
    converted,
    spend_amount_gbp: publisher !== 'Direct' ? round(rand(0.15, 2.5), 2) : round(rand(0.01, 0.05), 2),
    event_time: iso(time),
  }
}

function genWeatherEvent(time: number): { event: WeatherEvent; cold: boolean } {
  const w = pick(WEATHER_CITIES)
  const temp = round(w.temp_base + rand(-2, 2), 1)
  return {
    event: {
      city: w.city,
      temp_c: temp,
      condition: w.condition,
      precip_mm: round(Math.max(0, w.precip_base + rand(-2, 4)), 1),
      event_time: iso(time),
    },
    cold: temp < 5,
  }
}

function genRoiEvent(time: number): RoiEvent {
  const campaignId = pick(CAMPAIGN_IDS)
  const campaign = CAMPAIGNS[campaignId]
  const spend = round(rand(5000, 50000), 2)
  const roas = PUBLISHER_ROAS[campaign.publisher] + rand(-0.5, 0.5)

  return {
    campaign_id: campaignId,
    publisher: campaign.publisher,
    region: pick(REGIONS),
    attributed_revenue_gbp: round(spend * roas, 2),
    total_spend_gbp: spend,
    roi: round(roas, 2),
    conversions: Math.floor((spend / campaign.cpa_base) * rand(0.8, 1.2)),
    event_time: iso(time),
  }
}

/**
 * Build one batch using the notebook's per-batch volumes:
 * 4-10 POS, 12-25 impressions, 1-3 weather, and one ROI row every third batch.
 */
export function generateBatch(index: number, time: number): Batch {
  const weatherResults = Array.from({ length: randInt(1, 3) }, () => genWeatherEvent(time))

  return {
    index,
    time,
    pos: Array.from({ length: randInt(4, 10) }, () => genPosEvent(time)),
    impressions: Array.from({ length: randInt(12, 25) }, () => genImpressionEvent(time)),
    weather: weatherResults.map(w => w.event),
    roi: index % 3 === 0 ? [genRoiEvent(time)] : [],
    coldTriggers: weatherResults.filter(w => w.cold).length,
  }
}

/** Pre-fill the charts with `count` batches of history so nothing starts empty. */
export function seedBatches(count: number): Batch[] {
  const now = Date.now()
  return Array.from({ length: count }, (_, i) =>
    generateBatch(i + 1, now - (count - i) * INTERVAL_SECONDS * 1000),
  )
}
