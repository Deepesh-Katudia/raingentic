// Backend layer. getAgents()/getDashboardStats() are still fully mocked — no real
// backend for those exists yet. sendChatMessage() now calls a real Groq relay
// (see /server) and falls back to a mocked product-card reply if that relay is
// unreachable, so the chat still works even without the relay running.

export interface Agent {
  id: string
  name: string
  description: string
  pricePerCall: number
  greeting: string
  suggestions: string[]
}

export interface ProductMatch {
  name: string
  price: number
  retailer: string
}

export interface ChatReply {
  reply: string
  cost: number
  product?: ProductMatch
  real: boolean
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export type ExpenseCategory = 'Hosting' | 'AI API' | 'Manual'
export type ExpenseStatus = 'Approved' | 'Confirmed' | 'Denied'

export interface ExpenseEntry {
  id: string
  category: ExpenseCategory
  amount: number
  status: ExpenseStatus
  timestamp: number
}

export interface DashboardStats {
  totalEarnings: number
  spendLimit: number
  expenseLog: ExpenseEntry[]
}

const AGENTS: Agent[] = [
  {
    id: 'price-check',
    name: 'Price-Check Agent',
    description: 'Ask for any product and get a matched result with the best price found.',
    pricePerCall: 0.02,
    greeting: "Hi, I'm the Price-Check Agent. Tell me a product and I'll find the best price for it.",
    suggestions: ['wireless earbuds', 'a coffee maker', 'running shoes'],
  },
  {
    id: 'shopping',
    name: 'Shopping Agent',
    description: 'Compares options across retailers and adds the best pick to your cart.',
    pricePerCall: 0.03,
    greeting: "Hi, I'm the Shopping Agent. Tell me what you want to buy and I'll compare it across retailers.",
    suggestions: ['a 65-inch TV', 'a winter jacket', 'a standing desk'],
  },
  {
    id: 'flight-search',
    name: 'Flight Search Agent',
    description: 'Finds the cheapest flights for your dates and route.',
    pricePerCall: 0.03,
    greeting: "Hi, I'm the Flight Search Agent. Give me a route and dates and I'll find the cheapest flights.",
    suggestions: ['JFK to LAX next weekend', 'a one-way flight to Chicago', 'a round trip to Miami in March'],
  },
  {
    id: 'hotel-deals',
    name: 'Hotel Deals Agent',
    description: 'Scans hotel listings and surfaces the best rate for your stay.',
    pricePerCall: 0.03,
    greeting: "Hi, I'm the Hotel Deals Agent. Tell me your destination and dates and I'll find the best rate.",
    suggestions: ['a hotel in Austin this weekend', 'a beachfront hotel in Miami', '3 nights in downtown Seattle'],
  },
  {
    id: 'grocery-price',
    name: 'Grocery Price Agent',
    description: 'Checks grocery prices across stores near you.',
    pricePerCall: 0.01,
    greeting: "Hi, I'm the Grocery Price Agent. Tell me an item and I'll check prices near you.",
    suggestions: ['a dozen eggs', 'organic milk', 'chicken breast'],
  },
  {
    id: 'restaurant-finder',
    name: 'Restaurant Finder Agent',
    description: 'Finds restaurants matching your taste, budget, and location.',
    pricePerCall: 0.02,
    greeting: "Hi, I'm the Restaurant Finder Agent. Tell me what you're craving and I'll find a spot.",
    suggestions: ['Italian food nearby', 'a cheap sushi spot', 'a restaurant with outdoor seating'],
  },
  {
    id: 'coupon-hunter',
    name: 'Coupon Hunter Agent',
    description: 'Digs up active discount codes for any store.',
    pricePerCall: 0.01,
    greeting: "Hi, I'm the Coupon Hunter Agent. Tell me a store and I'll dig up an active discount code.",
    suggestions: ['a coupon for Nike', 'a discount code for Sephora', 'any deals at Target'],
  },
  {
    id: 'subscription-optimizer',
    name: 'Subscription Optimizer Agent',
    description: 'Reviews your subscriptions and flags ones you should cancel.',
    pricePerCall: 0.02,
    greeting:
      "Hi, I'm the Subscription Optimizer Agent. Tell me a subscription you're unsure about and I'll check if it's worth keeping.",
    suggestions: ['review my streaming subscriptions', 'is my gym app worth it', 'check my software subscriptions'],
  },
  {
    id: 'bill-negotiator',
    name: 'Bill Negotiator Agent',
    description: 'Calls providers on your behalf to negotiate lower bills.',
    pricePerCall: 0.04,
    greeting: "Hi, I'm the Bill Negotiator Agent. Tell me which bill you want lowered and I'll work on it.",
    suggestions: ['negotiate my internet bill', 'lower my phone bill', 'negotiate my cable bill'],
  },
  {
    id: 'rental-car',
    name: 'Rental Car Agent',
    description: 'Finds the best rental car rate for your trip.',
    pricePerCall: 0.03,
    greeting: "Hi, I'm the Rental Car Agent. Tell me your dates and location and I'll find the best rate.",
    suggestions: ['a rental car in Denver next week', 'an SUV for a weekend trip', 'a cheap rental at LAX'],
  },
  {
    id: 'event-ticket',
    name: 'Event Ticket Agent',
    description: 'Tracks down tickets at face value for sold-out events.',
    pricePerCall: 0.02,
    greeting: "Hi, I'm the Event Ticket Agent. Tell me the event and I'll track down tickets at face value.",
    suggestions: ['Coldplay tickets', 'a Lakers game this month', 'tickets to a Broadway show'],
  },
  {
    id: 'insurance-quote',
    name: 'Insurance Quote Agent',
    description: 'Gathers quotes across insurers for your coverage needs.',
    pricePerCall: 0.03,
    greeting: "Hi, I'm the Insurance Quote Agent. Tell me what you need covered and I'll gather quotes.",
    suggestions: ['auto insurance quote', 'renters insurance', 'quotes for a 2020 Honda Civic'],
  },
  {
    id: 'warranty-checker',
    name: 'Warranty Checker Agent',
    description: 'Looks up warranty status and coverage for any product.',
    pricePerCall: 0.01,
    greeting: "Hi, I'm the Warranty Checker Agent. Tell me a product and I'll look up its warranty status.",
    suggestions: ['check my laptop warranty', 'warranty on my washing machine', 'is my TV still covered'],
  },
  {
    id: 'fashion-stylist',
    name: 'Fashion Stylist Agent',
    description: 'Builds outfit picks from your size, budget, and style.',
    pricePerCall: 0.02,
    greeting: "Hi, I'm the Fashion Stylist Agent. Tell me the occasion and your budget and I'll build a look.",
    suggestions: ['an outfit for a wedding', 'a casual weekend look', 'business casual under $150'],
  },
  {
    id: 'electronics-finder',
    name: 'Electronics Finder Agent',
    description: 'Finds the best specs-to-price match in electronics.',
    pricePerCall: 0.03,
    greeting:
      "Hi, I'm the Electronics Finder Agent. Tell me what you need and I'll find the best specs for the price.",
    suggestions: ['a laptop under $800', 'noise-cancelling headphones', 'a 4K monitor'],
  },
  {
    id: 'travel-itinerary',
    name: 'Travel Itinerary Agent',
    description: 'Plans a day-by-day itinerary for your destination and budget.',
    pricePerCall: 0.04,
    greeting: "Hi, I'm the Travel Itinerary Agent. Tell me your destination and I'll plan a day-by-day trip.",
    suggestions: ['a 5-day trip to Lisbon', 'a weekend in New Orleans', 'a family trip to Orlando'],
  },
  {
    id: 'pet-supplies',
    name: 'Pet Supplies Agent',
    description: 'Finds the best deals on pet food and supplies.',
    pricePerCall: 0.02,
    greeting: "Hi, I'm the Pet Supplies Agent. Tell me what your pet needs and I'll find the best deal.",
    suggestions: ['dog food for a large breed', 'a cat scratching post', 'flea treatment for cats'],
  },
  {
    id: 'job-listings',
    name: 'Job Listings Agent',
    description: 'Surfaces matching job openings for your role and location.',
    pricePerCall: 0.03,
    greeting: "Hi, I'm the Job Listings Agent. Tell me your role and location and I'll surface matching openings.",
    suggestions: ['remote frontend engineer roles', 'marketing jobs in Austin', 'entry-level data analyst roles'],
  },
  {
    id: 'real-estate',
    name: 'Real Estate Agent',
    description: 'Finds listings that match your budget and must-haves.',
    pricePerCall: 0.04,
    greeting: "Hi, I'm the Real Estate Agent. Tell me your budget and must-haves and I'll find listings.",
    suggestions: ['a 3-bedroom under $450k', 'condos near downtown', 'houses with a big backyard'],
  },
  {
    id: 'moving-quote',
    name: 'Moving Quote Agent',
    description: 'Gathers moving quotes from local providers.',
    pricePerCall: 0.03,
    greeting: "Hi, I'm the Moving Quote Agent. Tell me about your move and I'll gather quotes from local providers.",
    suggestions: ['a 2-bedroom local move', 'a cross-country move quote', 'movers for a studio apartment'],
  },
  {
    id: 'gym-membership',
    name: 'Gym Membership Agent',
    description: 'Compares gym plans and finds intro offers near you.',
    pricePerCall: 0.02,
    greeting: "Hi, I'm the Gym Membership Agent. Tell me your area and I'll compare plans and intro offers.",
    suggestions: ['gyms near downtown', 'a gym with a pool', 'month-to-month gym plans'],
  },
  {
    id: 'meal-kit',
    name: 'Meal Kit Agent',
    description: 'Finds the best meal kit deal for your diet and budget.',
    pricePerCall: 0.02,
    greeting: "Hi, I'm the Meal Kit Agent. Tell me your diet and budget and I'll find the best meal kit deal.",
    suggestions: ['a vegetarian meal kit', 'a meal kit for 2 people', 'a low-carb meal kit'],
  },
  {
    id: 'streaming-bundle',
    name: 'Streaming Bundle Agent',
    description: 'Finds the cheapest bundle for the shows you watch.',
    pricePerCall: 0.01,
    greeting: "Hi, I'm the Streaming Bundle Agent. Tell me what you watch and I'll find the cheapest bundle.",
    suggestions: ['a bundle with live sports', 'the cheapest bundle with Disney content', 'a bundle under $20/month'],
  },
  {
    id: 'furniture-finder',
    name: 'Furniture Finder Agent',
    description: 'Matches furniture picks to your room and budget.',
    pricePerCall: 0.03,
    greeting: "Hi, I'm the Furniture Finder Agent. Tell me your room and budget and I'll match furniture picks.",
    suggestions: ['a sofa for a small living room', 'a desk for a home office', 'a dining table under $500'],
  },
  {
    id: 'car-buying',
    name: 'Car Buying Agent',
    description: 'Finds the best price on your target car across dealers.',
    pricePerCall: 0.05,
    greeting: "Hi, I'm the Car Buying Agent. Tell me the car you want and I'll find the best price across dealers.",
    suggestions: ['a used Honda CR-V', 'a new Toyota Camry', 'an electric SUV under $40k'],
  },
  {
    id: 'pharmacy-price',
    name: 'Pharmacy Price Agent',
    description: 'Compares prescription prices across pharmacies.',
    pricePerCall: 0.02,
    greeting:
      "Hi, I'm the Pharmacy Price Agent. Tell me your prescription and I'll compare prices across pharmacies.",
    suggestions: ['price for a generic statin', 'compare prices for amoxicillin', 'cheapest pharmacy near me'],
  },
  {
    id: 'wedding-vendor',
    name: 'Wedding Vendor Agent',
    description: 'Finds vendors that fit your date, style, and budget.',
    pricePerCall: 0.03,
    greeting: "Hi, I'm the Wedding Vendor Agent. Tell me your date and style and I'll find vendors that fit.",
    suggestions: ['a wedding photographer', 'a venue for 100 guests', 'a florist for a fall wedding'],
  },
  {
    id: 'home-repair',
    name: 'Home Repair Agent',
    description: 'Finds and quotes local contractors for repair jobs.',
    pricePerCall: 0.03,
    greeting: "Hi, I'm the Home Repair Agent. Tell me the job and I'll find and quote local contractors.",
    suggestions: ['fix a leaking water heater', 'repair a broken garage door', 'patch a roof leak'],
  },
]

const RETAIL_RESULTS: ProductMatch[] = [
  { name: 'Wilson Pro Staff Tennis Racket', price: 89.99, retailer: 'SportsDirect' },
  { name: 'Callaway Golf Iron Set (7-pc)', price: 449.0, retailer: 'GolfGalaxy' },
  { name: 'Nike Air Zoom Pegasus 41', price: 129.95, retailer: 'Nike.com' },
  { name: 'Yeti Rambler 20oz Tumbler', price: 34.99, retailer: 'Amazon' },
  { name: 'Sony WH-1000XM5 Headphones', price: 328.0, retailer: 'BestBuy' },
  { name: 'Patagonia Better Sweater Fleece', price: 139.0, retailer: 'REI' },
  { name: 'Anker 737 Power Bank 24000mAh', price: 89.99, retailer: 'Amazon' },
  { name: 'Le Creuset Dutch Oven 5.5qt', price: 380.0, retailer: 'Williams Sonoma' },
  { name: 'Garmin Forerunner 265', price: 449.99, retailer: 'Garmin.com' },
  { name: 'Osprey Talon 22 Backpack', price: 149.95, retailer: 'REI' },
]

const TRAVEL_RESULTS: ProductMatch[] = [
  { name: 'Nonstop flight, JFK → LAX, Sat 8:15am', price: 214.0, retailer: 'Delta.com' },
  { name: 'Hilton Garden Inn Downtown, 2 nights', price: 189.0, retailer: 'Hotels.com' },
  { name: 'Midsize SUV rental, 3 days', price: 156.0, retailer: 'Enterprise' },
  { name: 'Round-trip flight to Miami, nonstop', price: 268.0, retailer: 'United.com' },
  { name: 'Boutique hotel near French Quarter, 3 nights', price: 342.0, retailer: 'Booking.com' },
  { name: '5-day Lisbon trip (flight + hotel budget)', price: 890.0, retailer: 'Kayak.com' },
]

const FOOD_RESULTS: ProductMatch[] = [
  { name: 'Organic large eggs, 12-ct', price: 4.49, retailer: 'Whole Foods' },
  { name: '2% Milk, half gallon', price: 3.29, retailer: 'Kroger' },
  { name: 'Boneless chicken breast, per lb', price: 3.99, retailer: 'Costco' },
  { name: 'The Grove Kitchen — Italian, 4.6★ (avg/person)', price: 22.0, retailer: 'Yelp' },
  { name: 'Sakura Sushi — 4.4★, outdoor seating (avg/person)', price: 18.5, retailer: 'Yelp' },
  { name: 'HelloFresh 3-meal box, serves 2', price: 59.94, retailer: 'HelloFresh' },
]

const COUPON_RESULTS: ProductMatch[] = [
  { name: 'Code SAVE20 — 20% off entire order', price: 24.0, retailer: 'Nike.com' },
  { name: 'Code WELCOME15 — 15% off first order', price: 18.75, retailer: 'Sephora' },
  { name: 'Code SUMMER10 — 10% off + free shipping', price: 12.0, retailer: 'Target' },
]

const AGENT_RESULTS: Record<string, ProductMatch[]> = {
  'price-check': RETAIL_RESULTS,
  shopping: RETAIL_RESULTS,
  'electronics-finder': RETAIL_RESULTS,
  'fashion-stylist': RETAIL_RESULTS,
  'furniture-finder': RETAIL_RESULTS,
  'pet-supplies': RETAIL_RESULTS,
  'warranty-checker': RETAIL_RESULTS,
  'coupon-hunter': COUPON_RESULTS,
  'flight-search': TRAVEL_RESULTS,
  'hotel-deals': TRAVEL_RESULTS,
  'rental-car': TRAVEL_RESULTS,
  'travel-itinerary': TRAVEL_RESULTS,
  'grocery-price': FOOD_RESULTS,
  'restaurant-finder': FOOD_RESULTS,
  'meal-kit': FOOD_RESULTS,
  'job-listings': [
    { name: 'Senior Frontend Engineer, Remote', price: 145000, retailer: 'LinkedIn (annual)' },
    { name: 'Marketing Coordinator, Austin TX', price: 58000, retailer: 'Indeed (annual)' },
  ],
  'event-ticket': [
    { name: 'Coldplay — Music of the Spheres, Sec 112', price: 189.0, retailer: 'StubHub' },
    { name: 'Lakers vs. Warriors, Upper Level', price: 145.0, retailer: 'SeatGeek' },
  ],
  'streaming-bundle': [
    { name: 'Disney+ / Hulu / ESPN+ Trio Bundle', price: 14.99, retailer: 'Disney.com' },
    { name: 'YouTube TV (incl. live sports)', price: 72.99, retailer: 'YouTube TV' },
  ],
  'subscription-optimizer': [
    { name: 'Cancel unused Adobe Creative Cloud plan', price: 54.99, retailer: 'monthly savings' },
    { name: 'Downgrade unused Spotify Family plan', price: 9.0, retailer: 'monthly savings' },
  ],
  'bill-negotiator': [
    { name: 'Comcast internet bill negotiated down', price: 25.0, retailer: 'monthly savings' },
    { name: 'Verizon phone plan negotiated down', price: 18.0, retailer: 'monthly savings' },
  ],
  'insurance-quote': [
    { name: 'Progressive — Full coverage auto policy', price: 118.0, retailer: 'Progressive (monthly)' },
    { name: 'Lemonade — Renters insurance', price: 14.0, retailer: 'Lemonade (monthly)' },
  ],
  'gym-membership': [
    { name: 'Equinox — intro month, no enrollment fee', price: 99.0, retailer: 'Equinox' },
    { name: 'Planet Fitness — Black Card membership', price: 24.99, retailer: 'Planet Fitness' },
  ],
  'car-buying': [
    { name: '2023 Honda CR-V EX-L, 18k mi', price: 28450.0, retailer: 'CarMax' },
    { name: '2024 Toyota Camry SE, 3k mi', price: 26900.0, retailer: 'CarGurus' },
  ],
  'pharmacy-price': [
    { name: 'Atorvastatin 20mg, 30-day supply', price: 11.5, retailer: 'Costco Pharmacy' },
    { name: 'Amoxicillin 500mg, 30-day supply', price: 8.0, retailer: 'GoodRx' },
  ],
  'wedding-vendor': [
    { name: 'Willow & Oak Photography — full day package', price: 2400.0, retailer: 'WeddingWire' },
    { name: 'Bloom & Co. Florist — medium package', price: 850.0, retailer: 'The Knot' },
  ],
  'home-repair': [
    { name: 'Licensed plumber — water heater replacement', price: 1150.0, retailer: 'Angi' },
    { name: 'Garage door repair, same-day', price: 220.0, retailer: 'TaskRabbit' },
  ],
  'moving-quote': [
    { name: '2-bed local move, 2 movers + truck', price: 640.0, retailer: 'Moving.com' },
    { name: 'Studio apartment move, 1 mover + van', price: 280.0, retailer: 'HireAHelper' },
  ],
  'real-estate': [
    { name: '3bd/2ba, Maple Grove neighborhood', price: 415000.0, retailer: 'Zillow' },
    { name: '2bd condo, downtown high-rise', price: 329000.0, retailer: 'Redfin' },
  ],
}

const CHAT_API_URL = 'http://localhost:8787'

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function getAgents(): Promise<Agent[]> {
  await delay(300)
  return AGENTS
}

function buildSystemPrompt(agent: Agent): string {
  return (
    `You are ${agent.name}, an AI service agent on the PayHive platform. ${agent.description} ` +
    'Stay strictly in character and only help with tasks related to your role. Reply in 1-3 short, ' +
    'natural sentences. Do not use markdown, asterisks, bullet points, or headers — plain conversational ' +
    "text only. You do not have real-time internet access, so give a plausible, specific-sounding answer " +
    "(a realistic product, price, or vendor) rather than saying you can't look things up."
  )
}

function fallbackMockReply(agentId: string, message: string, agent: Agent | undefined): ChatReply {
  const pool = AGENT_RESULTS[agentId] ?? RETAIL_RESULTS
  const product = pool[Math.floor(Math.random() * pool.length)]

  return {
    reply: `Here's what I found for "${message}":`,
    cost: agent?.pricePerCall ?? 0.05,
    product,
    real: false,
  }
}

export interface ChatAttachment {
  name: string
  textContent?: string
}

export async function sendChatMessage(
  agentId: string,
  message: string,
  history: ChatTurn[] = [],
  attachment?: ChatAttachment,
): Promise<ChatReply> {
  const agent = AGENTS.find((a) => a.id === agentId)

  const fullMessage = attachment?.textContent
    ? `${message}\n\n[Attached document "${attachment.name}"]\n${attachment.textContent.slice(0, 4000)}`
    : message

  try {
    const response = await fetch(`${CHAT_API_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt: agent ? buildSystemPrompt(agent) : undefined,
        message: fullMessage,
        history,
      }),
    })

    if (!response.ok) throw new Error(`Chat relay responded with ${response.status}`)

    const data: { reply?: string } = await response.json()
    if (!data.reply) throw new Error('Chat relay returned no reply')

    return { reply: data.reply, cost: agent?.pricePerCall ?? 0.05, real: true }
  } catch (err) {
    console.warn('Groq relay unreachable, falling back to a mocked reply.', err)
    await delay(500)
    return fallbackMockReply(agentId, message, agent)
  }
}

let mockTotalEarnings = 182.4
const mockExpenseLog: ExpenseEntry[] = [
  { id: 'exp-1', category: 'Hosting', amount: 24.0, status: 'Confirmed', timestamp: Date.now() - 1000 * 60 * 60 * 4 },
  { id: 'exp-2', category: 'AI API', amount: 12.5, status: 'Confirmed', timestamp: Date.now() - 1000 * 60 * 60 * 3 },
  { id: 'exp-3', category: 'Manual', amount: 8.0, status: 'Approved', timestamp: Date.now() - 1000 * 60 * 60 * 2 },
  { id: 'exp-4', category: 'AI API', amount: 15.75, status: 'Approved', timestamp: Date.now() - 1000 * 60 * 55 },
  { id: 'exp-5', category: 'Hosting', amount: 24.0, status: 'Denied', timestamp: Date.now() - 1000 * 60 * 30 },
]
let expenseCounter = mockExpenseLog.length

const EXPENSE_CATEGORIES: ExpenseCategory[] = ['Hosting', 'AI API', 'Manual']
const EXPENSE_STATUSES: ExpenseStatus[] = ['Approved', 'Confirmed', 'Denied']

function tickMockLedger() {
  mockTotalEarnings += Math.random() * 0.8

  if (Math.random() < 0.35) {
    expenseCounter += 1
    mockExpenseLog.unshift({
      id: `exp-${expenseCounter}`,
      category: EXPENSE_CATEGORIES[Math.floor(Math.random() * EXPENSE_CATEGORIES.length)],
      amount: Number((Math.random() * 30 + 3).toFixed(2)),
      status: EXPENSE_STATUSES[Math.floor(Math.random() * EXPENSE_STATUSES.length)],
      timestamp: Date.now(),
    })
    if (mockExpenseLog.length > 30) mockExpenseLog.pop()
  }
}

export async function getDashboardStats(): Promise<DashboardStats> {
  tickMockLedger()
  await delay(150)

  return {
    totalEarnings: mockTotalEarnings,
    spendLimit: mockTotalEarnings * 0.7,
    expenseLog: mockExpenseLog,
  }
}
