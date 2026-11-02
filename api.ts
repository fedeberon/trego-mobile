import { getLocale } from './i18n'

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://trego-eta.vercel.app').replace(/\/$/, '')

export type MobileUser = {
  id: string
  name: string
  email: string
  roles: string[]
  image?: string | null
  profileBio?: string | null
  vehicles?: Array<{ id?: string; type: string; brand: string; model: string; plate?: string | null; maxCapacity?: number | null; capacityUnit?: string | null }>
}

export type DeliveryReview = {
  rating: number
  highlights: string[]
  comment: string | null
  createdAt: string
}

export type TransporterProfileResponse = {
  user?: MobileUser
  reviews: DeliveryReview[]
  reviewsCount: number
  averageRating: number | null
}

type AuthResponse = { token: string; user: MobileUser }

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': getLocale(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) { const error = new Error(body.error || `Error ${response.status}`) as Error & { status?: number }; error.status = response.status; throw error }
  return body as T
}

export function loginWithCredentials(email: string, password: string) {
  return request<AuthResponse>('/api/mobile/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export function loginWithGoogle(idToken: string) {
  return request<AuthResponse>('/api/mobile/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) })
}

export function registerUser(data: { name: string; email: string; password: string; role: 'transporter' | 'shipper' }) {
  return request<{ id: string }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function registerDevice(token: string, pushToken: string, platform: 'ios' | 'android', locale = getLocale()) {
  return request<{ id: string }>('/api/mobile/register-device', { method: 'POST', body: JSON.stringify({ token: pushToken, platform, locale }) }, token)
}

export function getTransporterProfile(token: string, userId?: string) {
  return request<TransporterProfileResponse>(`/api/mobile/profile${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`, {}, token)
}

export function getTransporterAvailability(token: string) {
  return request<{ available: boolean }>('/api/mobile/disponibilidad', {}, token)
}

export function setTransporterAvailability(token: string, available: boolean) {
  return request<{ available: boolean }>('/api/mobile/disponibilidad', { method: 'PATCH', body: JSON.stringify({ available }) }, token)
}

export type CancellationCase = { id: string; cargoId: string; shipperId: string; transporterId?: string | null; matchId?: string | null; tripId?: string | null; status: string; reason: string; response?: string | null; restricted: boolean; createdAt: string; updatedAt: string; cargo: { id: string; origin: string; destination: string; status: string }; events: Array<{ id: string; actorId: string; action: string; detail: string; createdAt: string }> }

export function getCancellationCases(token: string) {
  return request<{ cases: CancellationCase[]; userId: string; restricted: boolean }>('/api/mobile/cancelaciones', {}, token)
}

export function mutateCancellation(token: string, input: { cargoId: string; caseId?: string; action: 'request' | 'direct' | 'accept' | 'reject' | 'withdraw' | 'force' | 'comment'; detail?: string; confirmed?: boolean }) {
  return request<{ case: CancellationCase }>('/api/mobile/cancelaciones', { method: 'POST', body: JSON.stringify(input) }, token)
}

export function archiveCargo(token: string, cargoId: string) {
  return request<{ cargo: AvailableCargo }>(`/api/mobile/cargas/${encodeURIComponent(cargoId)}`, { method: 'PATCH' }, token)
}

export type MatchAcceptance = {
  matchId: string
  status?: string
  tripId?: string
  cargoId?: string
  notification?: { push?: { configured?: boolean; devices?: number; mobileDevices?: number; sent?: number; failed?: number } }
}

export function acceptMatch(token: string, matchId: string) {
  return request<MatchAcceptance>(`/api/mobile/matches/${encodeURIComponent(matchId)}/accept`, { method: 'POST' }, token)
}

export type MatchRecord = {
  id: string
  cargoId: string
  tripId: string | null
  status: string
  rejectionReason?: string | null
  offeredPrice?: number | null
  cargo?: { id: string; origin: string; destination: string; cargoType: string; weight: number; weightUnit: string; volume?: number | null; packages?: number | null; date?: string | null; approximateTime?: string | null; description?: string | null; offeredPrice?: number | null; deliveryReview?: DeliveryReview | null }
  transporter?: { id: string; name: string }
  shipper?: { id: string; name: string }
  trip?: { id: string; origin?: string; destination?: string; date?: string; status?: string; completedAt?: string | null; deliveryReview?: DeliveryReview | null }
}

export type MatchesResponse = {
  matches?: MatchRecord[]
} | MatchRecord[]

export function getMatches(token: string) {
  return request<MatchesResponse>('/api/mobile/matches', {}, token)
}

export type CommissionQuote = {
  enabled: boolean
  priceRequired?: boolean
  requiresConsent?: boolean
  amountCents: number
  currency?: string
  token: string | null
  consentToken?: string | null
  commissionConsentToken?: string | null
  terms?: { baseCents: number; rateBps: number; dueDays: number } | null
}

export async function getCommissionQuote(token: string, cargoId: string, price: number) {
  const result = await request<CommissionQuote & { consentToken?: string | null; commissionConsentToken?: string | null; requiresConsent?: boolean }>(`/api/mobile/billing/quote?cargoId=${encodeURIComponent(cargoId)}&price=${encodeURIComponent(String(price))}`, {}, token)
  const consentToken = result.token || result.commissionConsentToken || result.consentToken || null
  return { ...result, token: consentToken, enabled: Boolean(result.enabled || result.priceRequired || result.requiresConsent || consentToken) }
}

export function createMatch(token: string, data: { cargoId: string; tripId?: string; offeredPrice?: number; commissionConsentToken?: string | null }) {
  return request<{ match: MatchRecord }>('/api/mobile/matches', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token)
}

export type AvailableCargo = {
  id: string
  origin: string
  destination: string
  cargoType?: string | null
  weight?: number | null
  weightUnit?: string | null
  volume?: number | null
  packages?: number | null
  offeredPrice?: number | null
  date?: string | null
  approximateTime?: string | null
  description?: string | null
  status?: string
}

export function getAvailableCargos(token: string) {
  return request<{ cargos: AvailableCargo[] }>('/api/mobile/cargas', {}, token)
}

export type TripRecord = {
  id: string
  origin: string
  destination: string
  date: string
  status: string
  createdAt?: string
  startedAt?: string | null
  pickedUpAt?: string | null
  completedAt?: string | null
  locationSharingRequested?: boolean
  locationSharingRequestedAt?: string | null
  locationSharingActive?: boolean
  locationSharingStoppedAt?: string | null
  lastLocationAt?: string | null
  availableCapacity: number
  capacityUnit: string
  transporter?: { id: string; name: string }
  vehicle?: { type: string; brand: string; model: string; plate?: string }
  matches?: Array<{ id: string; cargo?: { id: string; origin: string; destination: string; cargoType?: string | null; weight?: number | null; weightUnit?: string | null; volume?: number | null; packages?: number | null; date?: string | null; approximateTime?: string | null; description?: string | null; offeredPrice?: number | null; status?: string; deliveryReview?: DeliveryReview | null }; shipper?: { id: string; name: string }; transporter?: { id: string; name: string } }>
  deliveryReview?: DeliveryReview | null
}

export function getTrips(token: string) {
  return request<{ trips: TripRecord[] }>('/api/mobile/viajes', {}, token)
}

export function createTransporterTrip(token: string, data: { vehicleId: string; origin: string; destination: string; originLat?: number; originLng?: number; destinationLat?: number; destinationLng?: number; date: string; approximateTime?: string; availableCapacity: number; capacityUnit?: string; maxDetourKm?: number; acceptedCargoTypes: string[] }) {
  return request<{ trip: TripRecord; routeId: string }>('/api/mobile/viajes', { method: 'POST', body: JSON.stringify(data) }, token)
}

export type RouteCargo = {
  id: string
  matchId: string
  tripId: string | null
  tripStatus: string | null
  shipperName: string
  state: 'ASSIGNED' | 'TO_PICKUP' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED' | string
  cargo: { id: string; cargoType: string; origin: string; destination: string; date: string; approximateTime?: string | null; weight: number; weightUnit: string; status: string; deliveryReview?: DeliveryReview | null }
}

export type RouteStop = { id: string; routeCargoId: string; kind: 'PICKUP' | 'DROPOFF' | string; position: number; address?: string }

export type TransporterRoute = {
  id: string
  name: string
  origin: string | null
  destination: string | null
  originLat: number | null
  originLng: number | null
  destinationLat: number | null
  destinationLng: number | null
  status: 'OPEN' | 'CLOSED' | string
  serviceType?: 'FREIGHT' | 'DELIVERY' | string | null
  createdAt: string
  closedAt: string | null
  cargos: RouteCargo[]
  stops: RouteStop[]
}

export function getTransporterRoutes(token: string) {
  return request<{ routes: TransporterRoute[] }>('/api/mobile/recorridos', {}, token)
}

export type RouteMutation = { action: 'sync' | 'create' | 'create-delivery' | 'update' | 'close' | 'reorder'; routeId?: string; name?: string; origin?: string; destination?: string; originLat?: number | null; originLng?: number | null; destinationLat?: number | null; destinationLng?: number | null; stopIds?: string[] }

export function mutateTransporterRoute(token: string, input: RouteMutation) {
  return request<{ routeId: string | null }>('/api/mobile/recorridos', { method: 'POST', body: JSON.stringify(input) }, token)
}

export type RouteSuggestion = {
  cargo: {
    id: string
    origin: string
    destination: string
    cargoType?: string | null
    weight?: number | null
    weightUnit?: string | null
    volume?: number | null
    packages?: number | null
    date?: string | null
    approximateTime?: string | null
    offeredPrice?: number | null
    status?: string | null
  }
  extraKm?: number | null
  pickupExtraKm?: number | null
  dropoffExtraKm?: number | null
  extraMinutes?: number | null
  capacityCompatible?: boolean | null
  pickupDistanceKm?: number | null
  deliveryDistanceKm?: number | null
  warning?: string | null
  warnings?: string[]
  match?: { id: string; status?: string }
}

export type RouteSuggestionMap = {
  pickup?: { lat: number; lng: number }
  delivery?: { lat: number; lng: number }
  routeGeometry?: { original?: unknown; withCargo?: unknown } | unknown
  originalGeometry?: unknown
  suggestedGeometry?: unknown
  expiresAt?: string | null
}

export function getRouteSuggestions(token: string, routeId: string, force = false) {
  return request<{ suggestions: RouteSuggestion[]; routeGeometry?: unknown; generatedAt?: string; examined?: number; excluded?: unknown[] }>(`/api/mobile/recorridos/${encodeURIComponent(routeId)}/sugerencias`, { method: 'POST', body: JSON.stringify({ action: 'preview', ...(force ? { force: true } : {}) }) }, token)
}

export function getRouteSuggestionMap(token: string, routeId: string, cargoId: string) {
  return request<RouteSuggestionMap>(`/api/mobile/recorridos/${encodeURIComponent(routeId)}/sugerencias`, { method: 'POST', body: JSON.stringify({ action: 'map', cargoId }) }, token)
}

export function proposeRouteSuggestion(token: string, routeId: string, cargoId: string, offeredPrice?: number | null) {
  return request<{ match: { id: string; status?: string }; alreadyExists?: boolean }>(`/api/mobile/recorridos/${encodeURIComponent(routeId)}/sugerencias`, { method: 'POST', body: JSON.stringify({ action: 'propose', cargoId, ...(offeredPrice === undefined ? {} : { offeredPrice }) }) }, token)
}

export function refreshRouteSuggestionPlan(token: string, routeId: string, cargoId: string, offeredPrice?: number | null) {
  return request<{ match: { id: string; status?: string }; alreadyExists?: boolean }>(`/api/mobile/recorridos/${encodeURIComponent(routeId)}/sugerencias`, { method: 'POST', body: JSON.stringify({ action: 'refresh-plan', cargoId, ...(offeredPrice === undefined ? {} : { offeredPrice }) }) }, token)
}

export type AddressSuggestion = { label: string; lat: number; lng: number }

export function searchAddresses(query: string) {
  return request<AddressSuggestion[]>(`/api/geocode?q=${encodeURIComponent(query)}`)
}

export type TripLocationPayload = { lat: number; lng: number; accuracy?: number | null; heading?: number | null; speed?: number | null; capturedAt: string }

export function sendTripLocation(token: string, tripId: string, location: TripLocationPayload) {
  return request<{ location: { id: string; lat: number; lng: number; capturedAt: string } }>(`/api/mobile/viajes/${encodeURIComponent(tripId)}/ubicacion`, { method: 'POST', body: JSON.stringify(location) }, token)
}

export type TripLocationState = { sharing: boolean; sharingStopped: boolean; stoppedAt?: string | null; requested: boolean; requestedAt?: string | null; lastLocationAt?: string | null; location?: { lat: number; lng: number; accuracy?: number | null; capturedAt: string } | null }

export function setTripLocationSharing(token: string, tripId: string, sharing: boolean) {
  return request<{ sharing: boolean }>(`/api/mobile/viajes/${encodeURIComponent(tripId)}/ubicacion`, { method: sharing ? 'PATCH' : 'DELETE' }, token)
}

export function getTripLocationState(token: string, tripId: string) {
  return request<TripLocationState>(`/api/mobile/viajes/${encodeURIComponent(tripId)}/ubicacion`, {}, token)
}

export type MobileNotification = { id: string; title: string; body: string; kind: string; read: boolean; createdAt: string }

export function getNotifications(token: string) {
  return request<{ notifications: MobileNotification[] }>('/api/mobile/notifications', {}, token)
}

export type TripAction = 'start' | 'pickup' | 'complete'

export function updateTripStatus(token: string, tripId: string, action: TripAction) {
  return request<{ trip: TripRecord; notification: { notified: number; configured?: boolean; devices?: number; sent?: number; failed?: number } }>(`/api/mobile/viajes/${encodeURIComponent(tripId)}`, { method: 'PATCH', body: JSON.stringify({ action }) }, token)
}

export function markTripArrived(token: string, tripId: string) {
  return updateTripStatus(token, tripId, 'pickup')
}

export type ConversationMessage = {
  id: string
  senderId: string
  body: string
  createdAt: string
  sender?: { id: string; name: string }
}

export type ConversationResponse = {
  currentUserId: string
  match: {
    cargo: { id: string; origin: string; destination: string }
    shipper: { name: string }
    transporter: { name: string }
  }
  conversation: {
    id: string
    messages: ConversationMessage[]
  }
}

export function getConversation(token: string, matchId: string) {
  return request<ConversationResponse>(`/api/mobile/messages?matchId=${encodeURIComponent(matchId)}`, {}, token)
}

export function sendMessage(token: string, matchId: string, body: string) {
  return request<{ message: ConversationMessage }>('/api/mobile/messages', { method: 'POST', body: JSON.stringify({ matchId, body }) }, token)
}

export function createCargo(token: string, data: { origin: string; destination: string; weight: number; description?: string; date: string; cargoType: string }) {
  return request('/api/mobile/cargas', { method: 'POST', body: JSON.stringify(data) }, token)
}
