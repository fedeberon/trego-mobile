const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://trego-eta.vercel.app').replace(/\/$/, '')

export type MobileUser = {
  id: string
  name: string
  email: string
  roles: string[]
  image?: string | null
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

export function registerDevice(token: string, pushToken: string, platform: 'ios' | 'android') {
  return request<{ id: string }>('/api/mobile/register-device', { method: 'POST', body: JSON.stringify({ token: pushToken, platform }) }, token)
}

export function getTransporterProfile(token: string) {
  return request<TransporterProfileResponse>('/api/mobile/profile', {}, token)
}

export function archiveCargo(token: string, cargoId: string) {
  return request<{ cargo: AvailableCargo }>(`/api/mobile/cargas/${encodeURIComponent(cargoId)}`, { method: 'PATCH' }, token)
}

export type MatchAcceptance = {
  matchId: string
  status?: string
  tripId?: string
  cargoId?: string
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
  cargo?: { id: string; origin: string; destination: string; cargoType: string; weight: number; weightUnit: string; volume?: number | null; packages?: number | null; date?: string | null; approximateTime?: string | null; description?: string | null; offeredPrice?: number | null }
  transporter?: { id: string; name: string }
  shipper?: { id: string; name: string }
}

export type MatchesResponse = {
  matches?: MatchRecord[]
} | MatchRecord[]

export function getMatches(token: string) {
  return request<MatchesResponse>('/api/mobile/matches', {}, token)
}

export function createMatch(token: string, data: { cargoId: string; tripId?: string; offeredPrice?: number }) {
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
  lastLocationAt?: string | null
  availableCapacity: number
  capacityUnit: string
  vehicle?: { type: string; brand: string; model: string; plate?: string }
  matches?: Array<{ id: string; cargo?: { id: string; origin: string; destination: string; cargoType?: string | null; weight?: number | null; weightUnit?: string | null; volume?: number | null; packages?: number | null; date?: string | null; approximateTime?: string | null; description?: string | null; offeredPrice?: number | null; status?: string }; shipper?: { id: string; name: string } }>
}

export function getTrips(token: string) {
  return request<{ trips: TripRecord[] }>('/api/mobile/viajes', {}, token)
}

export type TripLocationPayload = { lat: number; lng: number; accuracy?: number | null; heading?: number | null; speed?: number | null; capturedAt: string }

export function sendTripLocation(token: string, tripId: string, location: TripLocationPayload) {
  return request<{ location: { id: string; lat: number; lng: number; capturedAt: string } }>(`/api/mobile/viajes/${encodeURIComponent(tripId)}/ubicacion`, { method: 'POST', body: JSON.stringify(location) }, token)
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
