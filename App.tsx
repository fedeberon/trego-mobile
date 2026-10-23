// @ts-nocheck
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Application from 'expo-application'
import * as Device from 'expo-device'
import * as Google from 'expo-auth-session/providers/google'
import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import { getApp } from '@react-native-firebase/app'
import { AuthorizationStatus, getInitialNotification, getMessaging, getToken, isDeviceRegisteredForRemoteMessages, onMessage, onNotificationOpenedApp, onTokenRefresh, registerDeviceForRemoteMessages, requestPermission, setBackgroundMessageHandler } from '@react-native-firebase/messaging'
import React, { useEffect, useRef, useState } from 'react'
import { Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { acceptMatch, archiveCargo, AvailableCargo, ConversationMessage, createCargo, createMatch, DeliveryReview, getAvailableCargos, getConversation, getMatches, getNotifications, getTransporterProfile, getTrips, loginWithCredentials, loginWithGoogle, markTripArrived, MatchRecord, MobileNotification, MobileUser, registerDevice, sendMessage, sendTripLocation, TripAction, TripRecord, updateTripStatus } from './api'

WebBrowser.maybeCompleteAuthSession()
const firebaseMessaging = getMessaging(getApp())
const APP_VERSION = Application.nativeApplicationVersion || '1.0.0'
const APP_BUILD = Application.nativeBuildVersion || '1'
const APP_COMMIT = process.env.EXPO_PUBLIC_GIT_COMMIT || 'local'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

const cargoDemo = [{ id: '1', origin: 'Bolívar', destination: 'Cañuelas', type: 'Carga general', weight: '3.2 tn', price: '$320.000', score: 92 }, { id: '2', origin: 'Olavarría', destination: 'Buenos Aires', type: 'Pallets', weight: '5 tn', price: '$410.000', score: 86 }]
type Screen = 'home' | 'publish' | 'matches' | 'proposals' | 'chat' | 'notifications' | 'trips' | 'profile'
type NotificationData = { type?: string; notificationId?: string; matchId?: string; tripId?: string; cargoId?: string; conversationId?: string; [key: string]: string | object | undefined }

const tripStatusLabel = (status?: string) => ({ AVAILABLE: 'Disponible', MATCHED: 'Match confirmado', IN_PROGRESS: 'En camino al retiro', ARRIVED: 'Carga retirada', COMPLETED: 'Entregado', CANCELLED: 'Cancelado' } as Record<string, string>)[status || ''] || 'Estado pendiente'

const notificationScreen = (data?: NotificationData): Screen => {
  switch (data?.type) {
    case 'cargo': return 'matches'
    case 'match': return 'matches'
    case 'acceptance': return 'trips'
    case 'delivery': return 'trips'
    case 'location_request': return 'trips'
    case 'message': return 'chat'
    default: return 'notifications'
  }
}

const pushCopy = (type?: string) => {
  switch (type) {
    case 'cancellation_request':
    case 'cancel_request':
      return { title: 'Solicitud de cancelación', body: 'Tenés una solicitud de cancelación para revisar.' }
    case 'cancellation_accepted':
    case 'cancel_accepted':
      return { title: 'Cancelación aceptada', body: 'La solicitud de cancelación fue aceptada.' }
    case 'cancellation_rejected':
    case 'cancel_rejected':
      return { title: 'Cancelación rechazada', body: 'La solicitud de cancelación fue rechazada y el viaje continúa activo.' }
    default:
      return { title: 'Nueva oportunidad', body: 'Hay una actualización en Trego.' }
  }
}

async function markNotificationAsSeen(data?: NotificationData) {
  const key = data?.notificationId || data?.matchId
  if (data?.matchId) await AsyncStorage.setItem('trego.activeMatchId', data.matchId)
  if (!key) return false
  const stored = await AsyncStorage.getItem('trego.seenNotificationIds')
  const seen = stored ? JSON.parse(stored) as string[] : []
  if (seen.includes(key)) return true
  await AsyncStorage.setItem('trego.seenNotificationIds', JSON.stringify([...seen, key].slice(-100)))
  return false
}

async function queueLocationShare(data?: NotificationData) {
  if (data?.type === 'location_request' && data.tripId) {
    await AsyncStorage.setItem('trego.pendingLocationShareTripId', data.tripId)
  }
}

async function preparePushToken(authToken: string, pushToken?: string) {
  if (!Device.isDevice) return
  if (!isDeviceRegisteredForRemoteMessages(firebaseMessaging)) {
    await registerDeviceForRemoteMessages(firebaseMessaging)
  }
  const permission = await requestPermission(firebaseMessaging)
  if (permission === AuthorizationStatus.DENIED) return
  const resolvedToken = pushToken || await getToken(firebaseMessaging)
  await AsyncStorage.setItem('trego.pendingPushToken', resolvedToken)
  await registerDevice(authToken, resolvedToken, Platform.OS === 'ios' ? 'ios' : 'android')
}

setBackgroundMessageHandler(firebaseMessaging, async remoteMessage => {
  await queueLocationShare(remoteMessage.data as NotificationData | undefined)
  if (__DEV__) console.log('[push] background notification received', remoteMessage.data?.type || 'unknown')
})
function Login({ onAuthenticated }: { onAuthenticated: (result: { token: string; user: MobileUser }) => Promise<void> }) { const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const [request, response, promptAsync] = Google.useAuthRequest({ iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID, androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID, webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID }); useEffect(() => { if (response?.type !== 'success') return; const idToken = response.authentication?.idToken || response.params?.id_token; if (!idToken) { setError('Google no devolvió un token válido.'); return } setLoading(true); loginWithGoogle(idToken).then(onAuthenticated).catch(error => setError(error.message)).finally(() => setLoading(false)) }, [response, onAuthenticated]); async function submit() { setError(''); setLoading(true); try { await onAuthenticated(await loginWithCredentials(email, password)) } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo iniciar sesión.') } finally { setLoading(false) } } return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={18}><ScrollView contentContainerStyle={[styles.loginContent, { flexGrow: 1 }]} keyboardShouldPersistTaps="handled"><Image source={require('./assets/brand/ios/Icon-1024.png')} style={styles.loginLogo} /><Text style={styles.loginTitle}>Ingresá a Trego.</Text><Text style={styles.lead}>Usá Google o tus credenciales personales para continuar.</Text>{error ? <Text style={styles.loginError}>{error}</Text> : null}<Pressable disabled={!request || loading} onPress={() => promptAsync()} style={styles.googleButton}><Text style={styles.googleButtonText}>{loading ? 'Ingresando…' : 'Continuar con Google'}</Text></Pressable><View style={styles.loginDivider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>o con email</Text><View style={styles.dividerLine} /></View><TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email" style={styles.input} /><TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Contraseña" style={styles.input} /><Button label={loading ? 'Ingresando…' : 'Ingresar'} onPress={submit} /></ScrollView></KeyboardAvoidingView> }
function Button({ label, onPress, light = false, icon, tone = 'default' }: { label: string; onPress: () => void; light?: boolean; icon?: string; tone?: 'default' | 'location' | 'stop' | 'propose' | 'accept' | 'status' | 'chat' | 'detail' }) { const [confirming, setConfirming] = useState(false); const resolvedTone = tone !== 'default' ? tone : label.includes('Proponer') || label.includes('Postular') ? 'propose' : label.includes('Aceptar') ? 'accept' : label.includes('detalle') ? 'detail' : label.includes('chat') ? 'chat' : label.includes('Ir a buscar') || label.includes('retirada') || label.includes('entregado') || label.includes('Actualizando') ? 'status' : tone; const needsConfirmation = label.includes('Ir a buscar') || label.includes('retirada') || label.includes('entregado') || label.includes('Actualizando'); const confirmationTitle = label.includes('Ir a buscar') ? '¿Estás listo para ir a buscarla?' : label.includes('retirada') ? '¿Confirmás que retiraste la carga?' : '¿Confirmás que entregaste la carga?'; const confirmationMessage = label.includes('Ir a buscar') ? 'Al confirmar, el cargador recibirá el aviso y el viaje pasará a “En camino al retiro”.' : label.includes('retirada') ? 'Al confirmar, la carga quedará registrada como retirada y continuará el traslado.' : 'Al confirmar, el viaje quedará marcado como entregado y cerrado.'; return <><Pressable onPress={() => needsConfirmation ? setConfirming(true) : onPress()} style={[styles.button, light && styles.buttonLight, resolvedTone === 'location' && styles.locationButton, resolvedTone === 'stop' && styles.stopButton, resolvedTone === 'propose' && styles.proposeButton, resolvedTone === 'accept' && styles.acceptButton, resolvedTone === 'status' && styles.statusButton, resolvedTone === 'chat' && styles.chatButton, resolvedTone === 'detail' && styles.detailButton]}><View style={styles.buttonContent}>{icon ? <Text style={[styles.buttonIcon, resolvedTone === 'stop' && styles.stopButtonText, resolvedTone === 'detail' && styles.detailButtonText]}>{icon}</Text> : null}<Text style={[styles.buttonText, light && styles.buttonTextLight, (resolvedTone === 'location' || resolvedTone === 'propose' || resolvedTone === 'accept' || resolvedTone === 'status' || resolvedTone === 'chat') && styles.coloredButtonText, resolvedTone === 'stop' && styles.stopButtonText, resolvedTone === 'detail' && styles.detailButtonText]}>{label}</Text></View></Pressable><TregoModal visible={confirming} title={confirmationTitle} message={confirmationMessage} actionLabel="Confirmar cambio" onClose={() => setConfirming(false)} onAction={onPress} /></> }
function TripActionTile({ icon, title, subtitle, tone, onPress, confirmation }: { icon: string; title: string; subtitle: string; tone: 'route' | 'share' | 'status' | 'chat'; onPress: () => void; confirmation?: { title: string; message: string } }) { const [confirming, setConfirming] = useState(false); const lightTone = tone === 'share' || tone === 'chat'; const colors = tone === 'route' ? styles.tripActionRoute : tone === 'share' ? styles.tripActionShare : tone === 'status' ? styles.tripActionStatus : styles.tripActionChat; return <><Pressable onPress={() => confirmation ? setConfirming(true) : onPress()} style={[styles.tripActionTile, colors]}><Text style={[styles.tripActionIcon, lightTone && styles.tripActionLightText]}>{icon}</Text><View style={styles.tripActionCopy}><Text style={[styles.tripActionTitle, lightTone && styles.tripActionLightText]}>{title}</Text><Text style={[styles.tripActionSubtitle, lightTone && styles.tripActionLightSubtitle]}>{subtitle}</Text></View><Text style={[styles.tripActionArrow, lightTone && styles.tripActionLightText]}>›</Text></Pressable>{confirmation ? <TregoModal visible={confirming} title={confirmation.title} message={confirmation.message} actionLabel="Confirmar cambio" onClose={() => setConfirming(false)} onAction={onPress} /> : null}</> }
type TregoModalPayload = { title: string; message: string; actionLabel?: string; onAction?: () => void }
let openGlobalTregoModal: ((payload: TregoModalPayload) => void) | null = null
function showTregoModal(payload: TregoModalPayload) { openGlobalTregoModal?.(payload) }
const Alert = { alert: (title: string, message: string, buttons?: { text: string; onPress?: () => void }[]) => { const primary = buttons?.[0]; showTregoModal({ title, message, actionLabel: primary?.text || 'Entendido', onAction: primary?.onPress }) } }
function TregoModal({ visible, title, message, actionLabel = 'Entendido', onClose, onAction }: { visible: boolean; title: string; message: string; actionLabel?: string; onClose: () => void; onAction?: () => void }) { return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.tregoModal}><View style={styles.modalIcon}><Text style={styles.modalIconText}>✓</Text></View><Text style={styles.modalTitle}>{title}</Text><Text style={styles.modalMessage}>{message}</Text><Button label={actionLabel} onPress={() => { onClose(); onAction?.() }} /></View></View></Modal> }
function Header({ title, onBack }: { title: string; onBack?: () => void }) { return <View style={styles.header}>{onBack && <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹</Text></Pressable>}<Image source={require('./assets/brand/ios/Icon-1024.png')} style={styles.headerLogo} /><Text style={styles.title}>{title}</Text></View> }
function Card({ children, onPress, kind, variant }: { children: React.ReactNode; onPress?: () => void; kind?: 'chat'; variant?: 'proposalActive' | 'proposalClosed' }) { const Component = onPress ? Pressable : View; return <Component onPress={onPress} style={[styles.card, onPress && styles.tripCard, kind === 'chat' && styles.chatCard, variant === 'proposalActive' && styles.proposalCardActive, variant === 'proposalClosed' && styles.proposalCardClosed]}>{children}</Component> }
function SkeletonCard({ lines = 3 }: { lines?: number }) { return <Card><View style={styles.skeletonTitle} />{Array.from({ length: lines }).map((_, index) => <View key={index} style={[styles.skeletonLine, index === lines - 1 && styles.skeletonShort]} />)}</Card> }
function HomeLegacy({ go, user }: { go: (screen: Screen) => void; user: MobileUser }) { const firstName = user.name.split(' ')[0] || 'Federico'; return <ScrollView style={{ backgroundColor: '#F5F8FA' }} contentContainerStyle={[styles.content, { paddingTop: 22, paddingBottom: 132 }]}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}><View style={styles.brandRow}><Image source={require('./assets/brand/ios/Icon-1024.png')} style={styles.brandLogo} /><Text style={styles.brand}>trego<Text style={styles.brandDot}>.</Text></Text></View><View style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 3, borderColor: '#18C968', alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F7EF' }}><Text style={{ color: '#173B59', fontSize: 20, fontWeight: '900' }}>{firstName.charAt(0).toUpperCase()}</Text></View></View><Text style={{ color: '#173B59', fontSize: 34, lineHeight: 40, fontWeight: '900', marginBottom: 20 }}>Hola, {firstName}</Text><Card><Text style={styles.eyebrow}>TU VIAJE ACTUAL</Text><Text style={styles.cardTitle}>Buenos Aires, BA → Rosario, SF</Text></Card></ScrollView> }

function HomeLegacyMock({ go, user, token }: { go: (screen: Screen) => void; user: MobileUser; token: string }) {
  const firstName = user.name.split(' ')[0] || 'Federico'
  const [trip, setTrip] = useState<TripRecord | null>(null)
  const [arrivalBusy, setArrivalBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { getTrips(token).then(result => setTrip(result.trips.find(item => ['MATCHED', 'IN_PROGRESS', 'ARRIVED'].includes(item.status)) ?? result.trips[0] ?? null)).catch(cause => setError(cause instanceof Error ? cause.message : 'No se pudo cargar el viaje.')) }, [token])
  async function markArrival() { if (!trip) return; setArrivalBusy(true); setError(''); try { const result = await markTripArrived(token, trip.id); setTrip(result.trip); Alert.alert('Llegada informada', result.notification.notified > 0 ? 'El cargador recibió una notificación.' : 'El estado del viaje fue actualizado.') } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo informar la llegada.') } finally { setArrivalBusy(false) } }
  const arrived = trip?.status === 'ARRIVED'
  return <ScrollView style={{ backgroundColor: '#F5F8FA' }} contentContainerStyle={[styles.content, { paddingTop: 22, paddingBottom: 132 }]}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}><View style={styles.brandRow}><Image source={require('./assets/brand/ios/Icon-1024.png')} style={styles.brandLogo} /><Text style={styles.brand}>trego<Text style={styles.brandDot}>.</Text></Text></View><View style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 3, borderColor: '#18C968', alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F7EF' }}><Text style={{ color: '#173B59', fontSize: 20, fontWeight: '900' }}>{firstName.charAt(0).toUpperCase()}</Text></View></View><Text style={{ color: '#173B59', fontSize: 34, lineHeight: 40, fontWeight: '900', marginBottom: 20 }}>Hola, {firstName}</Text><Card><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}><Text style={styles.eyebrow}>TU VIAJE ACTUAL</Text><View style={{ backgroundColor: arrived ? '#DDF7E8' : '#FFF0D9', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 9 }}><Text style={{ color: arrived ? '#118443' : '#9A5B00', fontSize: 14, fontWeight: '900' }}>● {arrived ? 'Llegada informada' : 'En tránsito'}</Text></View></View>{trip ? <><View style={{ flexDirection: 'row', gap: 14 }}><View style={{ alignItems: 'center', paddingTop: 5 }}><Text style={{ color: '#18C968', fontSize: 28, lineHeight: 28 }}>●</Text><View style={{ width: 3, height: 40, backgroundColor: '#B7C7D1' }} /><Text style={{ color: arrived ? '#18C968' : '#AABBC5', fontSize: 28, lineHeight: 28 }}>●</Text></View><View style={{ flex: 1, gap: 18 }}><View><Text style={styles.cardTitle}>{trip.origin}</Text><Text style={styles.mutedText}>Salida programada</Text></View><View><Text style={styles.cardTitle}>{trip.destination}</Text><Text style={styles.mutedText}>{arrived ? 'Llegada informada' : 'Entrega estimada'}</Text></View></View></View><View style={{ borderTopWidth: 1, borderTopColor: '#DDE7EC', marginTop: 18, paddingTop: 14, flexDirection: 'row', justifyContent: 'space-between' }}><View><Text style={styles.label}>CAPACIDAD</Text><Text style={styles.cardTitle}>{trip.availableCapacity} {trip.capacityUnit === 'TONNES' ? 'tn' : trip.capacityUnit === 'M3' ? 'm³' : 'kg'}</Text></View><View><Text style={styles.label}>VEHÍCULO</Text><Text style={styles.cardTitle}>{trip.vehicle?.model || '—'}</Text></View><View><Text style={styles.label}>ESTADO</Text><Text style={styles.cardTitle}>{arrived ? 'Llegó' : 'Activo'}</Text></View></View><Pressable disabled={arrivalBusy || arrived} onPress={() => void markArrival()} style={[styles.arrivalButton, (arrivalBusy || arrived) && styles.arrivalButtonDisabled]}><Text style={styles.arrivalButtonText}>{arrived ? 'Llegada informada' : arrivalBusy ? 'Informando llegada…' : 'MARCAR LLEGADA'}</Text></Pressable></> : <Text style={styles.mutedText}>No tenés un viaje activo. Publicá un recorrido para gestionar su estado.</Text>}</Card>{error ? <Text style={styles.loginError}>{error}</Text> : null}<View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 2 }}><Text style={styles.eyebrow}>OPORTUNIDADES CERCA TUYO</Text><Pressable onPress={() => go('matches')}><Text style={{ color: '#18B95D', fontWeight: '900', fontSize: 16 }}>Ver todas ›</Text></Pressable></View><Card>{cargoDemo.map(c => <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, gap: 12, borderBottomWidth: c.id === '1' ? 1 : 0, borderBottomColor: '#DDE7EC' }}><View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: '#F0F5F7', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 24 }}>□</Text></View><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{c.origin} → {c.destination}</Text><Text style={styles.mutedText}>{c.weight} · {c.type}</Text></View><Text style={{ color: '#118443', backgroundColor: '#DDF7E8', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, fontWeight: '900' }}>{c.price}</Text></View>)}</Card><Pressable onPress={() => go('matches')} style={{ backgroundColor: '#18C968', borderRadius: 34, paddingHorizontal: 22, paddingVertical: 22, flexDirection: 'row', alignItems: 'center', gap: 16, shadowColor: '#18C968', shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 5 }}><Text style={{ color: '#fff', fontSize: 38 }}>▣</Text><View style={{ flex: 1 }}><Text style={{ color: '#fff', fontSize: 26, fontWeight: '900' }}>Ver cargas</Text><Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>12 nuevas propuestas</Text></View><Text style={{ color: '#fff', fontSize: 44 }}>›</Text></Pressable></ScrollView>
}

function HomeLegacyCurrent({ go, user, token }: { go: (screen: Screen) => void; user: MobileUser; token: string }) {
  const firstName = user.name.split(' ')[0] || 'Usuario'
  const isTransporter = user.roles.some(role => role.toLowerCase() === 'transporter' || role.toLowerCase() === 'transportista')
  const [trip, setTrip] = useState<TripRecord | null>(null)
  const [cargos, setCargos] = useState<AvailableCargo[]>([])
  const [arrivalBusy, setArrivalBusy] = useState(false)
  const [error, setError] = useState('')
  const [cargoBusy, setCargoBusy] = useState<string | null>(null)

  useEffect(() => {
    getAvailableCargos(token).then(result => setCargos(result.cargos)).catch(cause => setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las cargas.'))
  }, [token])

  useEffect(() => {
    if (!isTransporter) {
      setTrip(null)
      return
    }
    getTrips(token).then(result => setTrip(result.trips.find(item => ['MATCHED', 'IN_PROGRESS', 'ARRIVED'].includes(item.status)) ?? result.trips[0] ?? null)).catch(cause => setError(cause instanceof Error ? cause.message : 'No se pudo cargar el viaje.'))
  }, [isTransporter, token])

  async function advanceTrip() {
    if (!trip) return
    setArrivalBusy(true); setError('')
    const action: TripAction | null = trip.status === 'MATCHED' ? 'start' : trip.status === 'IN_PROGRESS' ? 'pickup' : trip.status === 'ARRIVED' ? 'complete' : null
    if (!action) { setArrivalBusy(false); return }
    try { const result = await updateTripStatus(token, trip.id, action); setTrip(result.trip); Alert.alert(action === 'start' ? 'Viaje iniciado' : action === 'pickup' ? 'Carga retirada' : 'Entrega confirmada', result.notification.notified > 0 ? 'El usuario que publicó la carga recibió una notificación.' : 'El estado del viaje fue actualizado.') } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el viaje.') } finally { setArrivalBusy(false) }
  }

  async function archive(cargoId: string) {
    setCargoBusy(cargoId); setError('')
    try { await archiveCargo(token, cargoId); setCargos(current => current.filter(cargo => cargo.id !== cargoId)); Alert.alert('Carga dada de baja', 'La publicación ya no se muestra ni recibe nuevas propuestas.') } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo dar de baja la carga.') } finally { setCargoBusy(null) }
  }

  const tripStatus = trip?.status === 'MATCHED' ? 'Listo para buscar' : trip?.status === 'IN_PROGRESS' ? 'En camino a buscar' : trip?.status === 'ARRIVED' ? 'Carga retirada' : trip?.status === 'COMPLETED' ? 'Entregado · cerrado' : 'Sin match'
  const actionLabel = trip?.status === 'MATCHED' ? 'IR A BUSCAR CARGA' : trip?.status === 'IN_PROGRESS' ? 'MARCAR CARGA RETIRADA' : trip?.status === 'ARRIVED' ? 'MARCAR ENTREGADO Y CERRAR' : 'SIN ACCIONES PENDIENTES'
  const actionDisabled = arrivalBusy || !trip || !['MATCHED', 'IN_PROGRESS', 'ARRIVED'].includes(trip.status)
  return <ScrollView style={{ backgroundColor: '#F5F8FA' }} contentContainerStyle={[styles.content, { paddingTop: 22, paddingBottom: 132 }]}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}><View style={styles.brandRow}><Image source={require('./assets/brand/ios/Icon-1024.png')} style={styles.brandLogo} /><Text style={styles.brand}>trego<Text style={styles.brandDot}>.</Text></Text></View><View style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 3, borderColor: '#18C968', alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F7EF' }}><Text style={{ color: '#173B59', fontSize: 20, fontWeight: '900' }}>{firstName.charAt(0).toUpperCase()}</Text></View></View><Text style={{ color: '#173B59', fontSize: 34, lineHeight: 40, fontWeight: '900', marginBottom: 20 }}>Hola, {firstName}</Text>{isTransporter && <Card><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}><Text style={styles.eyebrow}>TU VIAJE ACTUAL</Text>{trip && <View style={{ backgroundColor: trip.status === 'COMPLETED' ? '#DDF7E8' : '#FFF0D9', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 9 }}><Text style={{ color: trip.status === 'COMPLETED' ? '#118443' : '#9A5B00', fontSize: 14, fontWeight: '900' }}>● {tripStatus}</Text></View>}</View>{trip ? <><View style={{ flexDirection: 'row', gap: 14 }}><View style={{ alignItems: 'center', paddingTop: 5 }}><Text style={{ color: '#18C968', fontSize: 28, lineHeight: 28 }}>●</Text><View style={{ width: 3, height: 40, backgroundColor: '#B7C7D1' }} /><Text style={{ color: trip.status === 'COMPLETED' ? '#18C968' : '#AABBC5', fontSize: 28, lineHeight: 28 }}>●</Text></View><View style={{ flex: 1, gap: 18 }}><View><Text style={styles.cardTitle}>{trip.origin}</Text><Text style={styles.mutedText}>{trip.status === 'MATCHED' ? 'Match confirmado' : 'Salida programada'}</Text></View><View><Text style={styles.cardTitle}>{trip.destination}</Text><Text style={styles.mutedText}>{trip.status === 'COMPLETED' ? 'Viaje cerrado' : 'Entrega estimada'}</Text></View></View></View><View style={{ borderTopWidth: 1, borderTopColor: '#DDE7EC', marginTop: 18, paddingTop: 14, flexDirection: 'row', justifyContent: 'space-between' }}><View><Text style={styles.label}>CAPACIDAD</Text><Text style={styles.cardTitle}>{trip.availableCapacity} {trip.capacityUnit === 'TONNES' ? 'tn' : trip.capacityUnit === 'M3' ? 'm³' : 'kg'}</Text></View><View><Text style={styles.label}>VEHÍCULO</Text><Text style={styles.cardTitle}>{trip.vehicle?.model || '—'}</Text></View><View><Text style={styles.label}>ESTADO</Text><Text style={styles.cardTitle}>{tripStatus}</Text></View></View><Pressable disabled={actionDisabled} onPress={() => void advanceTrip()} style={[styles.arrivalButton, actionDisabled && styles.arrivalButtonDisabled]}><Text style={styles.arrivalButtonText}>{arrivalBusy ? 'ACTUALIZANDO…' : actionLabel}</Text></Pressable></> : <Text style={styles.mutedText}>No tenés un viaje activo.</Text>}</Card>}{error ? <Text style={styles.loginError}>{error}</Text> : null}<View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 2 }}><Text style={styles.eyebrow}>{isTransporter ? 'CARGAS DISPONIBLES' : 'TUS CARGAS PUBLICADAS'}</Text><Pressable onPress={() => go('matches')}><Text style={{ color: '#18B95D', fontWeight: '900', fontSize: 16 }}>Ver todas ›</Text></Pressable></View>{cargos.length === 0 ? <Card><Text style={styles.mutedText}>{isTransporter ? 'No hay cargas abiertas disponibles.' : 'Todavía no publicaste cargas activas.'}</Text></Card> : <Card>{cargos.slice(0, 3).map((cargo, index) => <View key={cargo.id} style={{ paddingVertical: 10, borderBottomWidth: index < Math.min(cargos.length, 3) - 1 ? 1 : 0, borderBottomColor: '#DDE7EC' }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: '#F0F5F7', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 24 }}>□</Text></View><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{cargo.origin} → {cargo.destination}</Text><Text style={styles.mutedText}>{cargo.weight ?? '—'} {cargo.weightUnit === 'TONNES' ? 'tn' : cargo.weightUnit === 'M3' ? 'm³' : 'kg'} · {cargo.cargoType}</Text></View>{cargo.offeredPrice != null && <Text style={{ color: '#118443', backgroundColor: '#DDF7E8', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, fontWeight: '900' }}>${cargo.offeredPrice.toLocaleString('es-AR')}</Text>}</View>{!isTransporter && cargo.status === 'OPEN' && <Pressable disabled={cargoBusy === cargo.id} onPress={() => void archive(cargo.id)} style={{ alignSelf: 'flex-end', marginTop: 8, paddingVertical: 6, paddingHorizontal: 10 }}><Text style={{ color: '#B42318', fontWeight: '800', fontSize: 12 }}>{cargoBusy === cargo.id ? 'Dando de baja…' : 'Dar de baja'}</Text></Pressable>}</View>)}</Card>}<Pressable onPress={() => go('matches')} style={{ backgroundColor: '#18C968', borderRadius: 34, paddingHorizontal: 22, paddingVertical: 22, flexDirection: 'row', alignItems: 'center', gap: 16, shadowColor: '#18C968', shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 5 }}><Text style={{ color: '#fff', fontSize: 38 }}>▣</Text><View style={{ flex: 1 }}><Text style={{ color: '#fff', fontSize: 26, fontWeight: '900' }}>{isTransporter ? 'Ver cargas disponibles' : 'Ver mis cargas'}</Text><Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{cargos.length} cargas reales</Text></View><Text style={{ color: '#fff', fontSize: 44 }}>›</Text></Pressable></ScrollView>
}
function Publish({ go, token }: { go: (screen: Screen) => void; token: string }) { const [origin, setOrigin] = useState('Bolívar'); const [destination, setDestination] = useState('Cañuelas'); const [weight, setWeight] = useState('3.2'); const [description, setDescription] = useState(''); const [saving, setSaving] = useState(false); async function submit() { setSaving(true); try { await createCargo(token, { origin, destination, weight: Number(weight.replace(',', '.')), description, date: new Date().toISOString(), cargoType: 'Carga general' }); Alert.alert('Carga publicada', 'La carga fue enviada y se notificó a los transportistas compatibles.'); go('matches') } catch (cause) { Alert.alert('No se pudo publicar', cause instanceof Error ? cause.message : 'Revisá los datos e intentá nuevamente.') } finally { setSaving(false) } } return <ScrollView contentContainerStyle={styles.content}><Header title="Mové tu carga" onBack={() => go('home')} /><Text style={styles.lead}>Publicá los detalles y recibí propuestas compatibles.</Text><Text style={styles.label}>Origen</Text><TextInput value={origin} onChangeText={setOrigin} style={styles.input} /><Text style={styles.label}>Destino</Text><TextInput value={destination} onChangeText={setDestination} style={styles.input} /><Text style={styles.label}>Peso en toneladas</Text><TextInput value={weight} onChangeText={setWeight} keyboardType="decimal-pad" style={styles.input} /><Text style={styles.label}>Descripción</Text><TextInput value={description} onChangeText={setDescription} style={[styles.input, styles.textarea]} multiline placeholder="Mercadería lista para cargar" /><Button label={saving ? 'Publicando…' : 'Publicar carga'} onPress={submit} /></ScrollView> }
const routeStyles = StyleSheet.create({ cargoId: { color: '#087C70', backgroundColor: '#DDF7EC', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, fontWeight: '900' }, routeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#18B95D' }, routeDotDestination: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#173B59' }, routeLine: { width: 2, height: 20, backgroundColor: '#B7CBD8' }, routeLabel: { color: '#8BA0AC', fontSize: 10, fontWeight: '800', letterSpacing: 1 }, routeAddress: { color: '#173B59', fontSize: 17, lineHeight: 22, fontWeight: '800' } })
function RouteSummary({ id, origin, destination }: { id?: string; origin?: string; destination?: string }) { return <View style={{ marginVertical: 8, gap: 7 }}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><Text style={styles.label}>CARGA</Text>{id ? <Text style={routeStyles.cargoId}>#${id.slice(-8).toUpperCase()}</Text> : null}</View><View style={{ gap: 0 }}><View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}><View style={{ width: 10, alignItems: 'center', paddingTop: 4 }}><View style={routeStyles.routeDot} /></View><View style={{ flex: 1 }}><Text style={routeStyles.routeLabel}>ORIGEN</Text><Text style={routeStyles.routeAddress}>{origin || 'Origen'}</Text></View></View><View style={{ flexDirection: 'row', gap: 10, height: 20 }}><View style={{ width: 10, alignItems: 'center' }}><View style={routeStyles.routeLine} /></View><View style={{ flex: 1 }} /></View><View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}><View style={{ width: 10, alignItems: 'center', paddingTop: 4 }}><View style={routeStyles.routeDotDestination} /></View><View style={{ flex: 1 }}><Text style={routeStyles.routeLabel}>DESTINO</Text><Text style={routeStyles.routeAddress}>{destination || 'Destino'}</Text></View></View></View></View> }
function isDeliveryCargo(cargo?: { cargoType?: string | null }) {
  const value = (cargo?.cargoType || '').toLowerCase()
  return value.includes('delivery') || value.includes('última milla') || value.includes('ultima milla') || ['paquete', 'documentación', 'documentacion', 'encomienda'].includes(value)
}

function proposalStatusLabel(match: MatchRecord) {
  if (match.status === 'ACCEPTED') return 'Tomada · match confirmado'
  if (match.status === 'REJECTED') {
    const reason = (match.rejectionReason || '').toLowerCase()
    if (reason.includes('eligió otra') || reason.includes('eligio otra') || reason.includes('otra propuesta')) return 'Asignada a otro transportista'
    return 'Propuesta rechazada'
  }
  return 'Pendiente de confirmación'
}

function deliveryDetails(description?: string | null) {
  const text = description || ''
  const read = (label: string) => text.match(new RegExp(`${label}:\\s*([^·]+)`, 'i'))?.[1]?.trim() || ''
  return { recipient: read('Recibe'), phone: read('Teléfono') || read('Telefono'), instructions: read('Indicaciones') }
}

function formatCargoWeight(cargo?: { weight?: number | null; weightUnit?: string | null; packages?: number | null }) {
  if (cargo?.packages != null) return `${cargo.packages} bulto${cargo.packages === 1 ? '' : 's'}`
  if (cargo?.weight == null) return 'Peso no informado'
  return `${cargo.weight} ${cargo.weightUnit === 'TONNES' ? 'tn' : cargo.weightUnit === 'M3' ? 'm³' : 'kg'}`
}

function Matches({ go, token, roles, refreshKey = 0, onlyProposals = false }: { go: (screen: Screen) => void; token: string; roles: string[]; refreshKey?: number; onlyProposals?: boolean }) {
  const isTransporter = roles.some(role => role.toLowerCase() === 'transporter' || role.toLowerCase() === 'transportista')
  const [cargos, setCargos] = useState<AvailableCargo[]>([])
  const [activeTripId, setActiveTripId] = useState<string | undefined>()
  const [trips, setTrips] = useState<TripRecord[]>([])
  const [proposals, setProposals] = useState<MatchRecord[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [proposedCargoIds, setProposedCargoIds] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'available' | 'proposals'>('proposals')
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null)
  const [selectedCargoId, setSelectedCargoId] = useState<string | null>(null)
  useEffect(() => {
    async function loadMatches() {
      setLoading(true)
      setError(null)
      try {
        if (isTransporter) {
          const [cargoResult, tripResult, matchResult] = await Promise.all([
            getAvailableCargos(token),
            getTrips(token),
            getMatches(token),
          ])
          setCargos(cargoResult.cargos)
          setTrips(tripResult.trips)
          setActiveTripId(tripResult.trips.find(trip => trip.status === 'AVAILABLE')?.id)
          const matches = Array.isArray(matchResult) ? matchResult : matchResult.matches ?? []
          setProposals(onlyProposals ? matches : matches.filter(match => match.status === 'ACCEPTED'))
        } else {
          const result = await getMatches(token)
          setProposals(Array.isArray(result) ? result : result.matches ?? [])
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los datos.')
      }
    }

    void loadMatches().finally(() => setLoading(false))
  }, [isTransporter, onlyProposals, token, refreshKey])
  async function proposeCargo(cargoId: string) { setBusy(cargoId); setError(null); try { const result = await createMatch(token, { cargoId, tripId: activeTripId }); setProposals(current => current.some(match => match.id === result.match.id) ? current : [result.match, ...current]); setProposedCargoIds(current => new Set(current).add(cargoId)); Alert.alert('Propuesta enviada', activeTripId ? 'La propuesta quedó asociada a tu viaje y el usuario recibió una notificación.' : 'La propuesta quedó pendiente de aceptación del usuario que publicó la carga.') } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo proponer la carga.') } finally { setBusy(null) } }
  async function acceptProposal(matchId: string) { setBusy(matchId); setError(null); try { await acceptMatch(token, matchId); await AsyncStorage.setItem('trego.activeMatchId', matchId); setProposals(current => current.map(match => match.id === matchId ? { ...match, status: 'ACCEPTED' } : match)); Alert.alert('Match confirmado', 'El transportista recibió una notificación.', [{ text: 'Ver chat', onPress: () => go('chat') }]) } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo aceptar la propuesta.') } finally { setBusy(null) } }
  async function openChat(matchId: string, tripId?: string | null) { const resolvedTripId = tripId || proposals.find(match => match.id === matchId)?.tripId; await AsyncStorage.setItem('trego.activeMatchId', matchId); if (resolvedTripId) await AsyncStorage.setItem('trego.activeTripId', resolvedTripId); else await AsyncStorage.removeItem('trego.activeTripId'); go('chat') }
  async function openTripDetail(tripId?: string | null) { if (!tripId) return; await AsyncStorage.setItem('trego.activeTripId', tripId); go('trips') }
  function tripForMatch(match: MatchRecord) { return match.tripId ? trips.find(trip => trip.id === match.tripId) : undefined }
  function actionForTrip(trip?: TripRecord): TripAction | null { return trip?.status === 'MATCHED' ? 'start' : trip?.status === 'IN_PROGRESS' ? 'pickup' : trip?.status === 'ARRIVED' ? 'complete' : null }
  function actionLabelForTrip(trip?: TripRecord) { return trip?.status === 'MATCHED' ? 'Ir a buscar la carga' : trip?.status === 'IN_PROGRESS' ? 'Marcar carga retirada' : trip?.status === 'ARRIVED' ? 'Marcar entregado y cerrar' : trip?.status === 'COMPLETED' ? 'Viaje entregado' : 'Esperando estado del viaje' }
  function proposalForCargo(cargoId: string) { return proposals.find(match => (match.cargo?.id || match.cargoId) === cargoId) }
  async function advanceMatch(match: MatchRecord) { const trip = tripForMatch(match); const action = actionForTrip(trip); if (!trip || !action) return; setBusy(match.id); setError(null); try { const result = await updateTripStatus(token, trip.id, action); setTrips(current => current.map(item => item.id === trip.id ? { ...item, ...result.trip, matches: item.matches } : item)); Alert.alert(action === 'start' ? 'Viaje iniciado' : action === 'pickup' ? 'Carga retirada' : 'Entrega confirmada', result.notification.sent && result.notification.sent > 0 ? 'El cargador recibió una notificación push.' : 'El estado fue actualizado, pero el cargador no tiene un dispositivo web registrado o el push no pudo enviarse.') } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el estado del viaje.') } finally { setBusy(null) } }
  async function openCargoRoute(cargo: AvailableCargo) { const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(cargo.origin)}&travelmode=driving`; try { await Linking.openURL(mapsUrl) } catch { setError('No se pudo abrir el mapa. Verificá que tengas una app de mapas instalada.') } }
  const selectedProposal = selectedProposalId ? proposals.find(match => match.id === selectedProposalId) : null
  if (selectedProposal) { const trip = tripForMatch(selectedProposal); const closed = selectedProposal.status === 'REJECTED' || selectedProposal.status === 'CANCELLED' || trip?.status === 'COMPLETED'; return <ScrollView contentContainerStyle={styles.content}><Header title="Detalle de la carga" onBack={() => setSelectedProposalId(null)} /><Card variant={closed ? 'proposalClosed' : 'proposalActive'}><Text style={styles.label}>PROPUESTA DE CARGA</Text><RouteSummary id={selectedProposal.cargo?.id} origin={selectedProposal.cargo?.origin} destination={selectedProposal.cargo?.destination} /><Text style={closed ? styles.proposalStatusClosed : styles.proposalStatus}>{selectedProposal.status === 'ACCEPTED' ? 'Tomada · match confirmado' : selectedProposal.status === 'REJECTED' ? 'Rechazada' : 'Pendiente de confirmación'}</Text><Text style={styles.mutedText}>{selectedProposal.cargo?.cargoType || 'Carga general'} · {selectedProposal.cargo?.weight ?? '—'} {selectedProposal.cargo?.weightUnit === 'TONNES' ? 'tn' : selectedProposal.cargo?.weightUnit === 'M3' ? 'm³' : 'kg'}</Text>{selectedProposal.cargo?.offeredPrice != null ? <Text style={styles.score}>${selectedProposal.cargo.offeredPrice.toLocaleString('es-AR')}</Text> : null}{trip ? <Button label="Ver detalle del viaje" tone="detail" onPress={() => void openTripDetail(trip.id)} /> : null}{selectedProposal.status === 'ACCEPTED' ? <Button label="Abrir chat" tone="chat" onPress={() => void openChat(selectedProposal.id, trip?.id)} /> : null}</Card></ScrollView> }
  const displayedCargos = viewMode === 'available' ? cargos : []
  const takenByMe = !isTransporter ? proposals.filter(match => match.status === 'ACCEPTED') : []
  const displayedProposals = viewMode === 'proposals' ? (isTransporter ? proposals : proposals.filter(match => match.status !== 'ACCEPTED')) : []
  const renderTakenCargo = (match: MatchRecord) => { const trip = tripForMatch(match); const closed = trip?.status === 'COMPLETED'; return <Card key={`taken-${match.id}`} onPress={() => setSelectedProposalId(match.id)} variant={closed ? 'proposalClosed' : 'proposalActive'}><Text style={styles.label}>TOMADA POR MÍ</Text><RouteSummary id={match.cargo?.id} origin={match.cargo?.origin} destination={match.cargo?.destination} /><Text style={closed ? styles.proposalStatusClosed : styles.proposalStatus}>Match confirmado</Text><Text style={styles.mutedText}>{trip?.status === 'MATCHED' ? 'Estado: listo para ir a buscar la carga.' : trip?.status === 'IN_PROGRESS' ? 'Estado: en camino al retiro.' : trip?.status === 'ARRIVED' ? 'Estado: carga retirada.' : trip?.status === 'COMPLETED' ? 'Estado: entregada y cerrada.' : 'Estado: viaje asignado.'}</Text>{trip ? <Button label="Ver detalle del viaje" tone="detail" onPress={() => void openTripDetail(trip.id)} /> : null}<Button label="Abrir chat" tone="chat" onPress={() => void openChat(match.id, trip?.id)} /></Card> }
  if (!onlyProposals && isTransporter) {
    return <ScrollView contentContainerStyle={styles.content}>
      <Header title="Cargas tomadas" onBack={() => go('home')} />
      <Text style={styles.lead}>Cargas que tomaste y su estado, incluidas las ya entregadas.</Text>
      {error ? <Text style={styles.loginError}>{error}</Text> : null}
      {loading ? <><SkeletonCard lines={4} /><SkeletonCard lines={3} /></> : proposals.length === 0 ? <Card><Text style={styles.mutedText}>Todavía no tomaste ninguna carga.</Text></Card> : proposals.map(renderTakenCargo)}
    </ScrollView>
  }
  const selectedCargo = selectedCargoId ? cargos.find(cargo => cargo.id === selectedCargoId) : null
  if (selectedCargo) {
    const details = deliveryDetails(selectedCargo.description)
    const proposal = proposalForCargo(selectedCargo.id)
    const waiting = proposedCargoIds.has(selectedCargo.id) || proposal?.status === 'PROPOSED' || proposal?.status === 'PENDING'
    const rejected = proposal?.status === 'REJECTED'
    return <ScrollView contentContainerStyle={styles.content}><Header title={isDeliveryCargo(selectedCargo) ? 'Detalle del delivery' : 'Detalle de la carga'} onBack={() => setSelectedCargoId(null)} /><Card><Text style={styles.label}>{isDeliveryCargo(selectedCargo) ? 'DELIVERY DISPONIBLE' : 'CARGA DISPONIBLE'}</Text><RouteSummary id={selectedCargo.id} origin={selectedCargo.origin} destination={selectedCargo.destination} /><DistanceToPickup address={selectedCargo.origin} /><View style={styles.deliveryInfoGrid}><Text style={styles.mutedText}>Paquete: <Text style={styles.strongText}>{selectedCargo.cargoType || 'Carga general'}</Text></Text><Text style={styles.mutedText}>Cantidad/peso: <Text style={styles.strongText}>{formatCargoWeight(selectedCargo)}</Text></Text>{selectedCargo.date ? <Text style={styles.mutedText}>Fecha: <Text style={styles.strongText}>{new Date(selectedCargo.date).toLocaleDateString('es-AR')}</Text></Text> : null}{selectedCargo.approximateTime ? <Text style={styles.mutedText}>Horario: <Text style={styles.strongText}>{selectedCargo.approximateTime}</Text></Text> : null}{selectedCargo.offeredPrice != null ? <Text style={styles.mutedText}>Precio ofrecido: <Text style={styles.priceText}>${selectedCargo.offeredPrice.toLocaleString('es-AR')}</Text></Text> : null}</View>{details.recipient ? <Text style={styles.mutedText}>Receptor: <Text style={styles.strongText}>{details.recipient}</Text></Text> : null}{details.phone ? <Text style={styles.mutedText}>Teléfono: <Text style={styles.strongText}>{details.phone}</Text></Text> : null}{details.instructions ? <Text style={styles.mutedText}>Indicaciones: <Text style={styles.strongText}>{details.instructions}</Text></Text> : null}{selectedCargo.description && !details.recipient && !details.phone && !details.instructions ? <Text style={styles.mutedText}>{selectedCargo.description}</Text> : null}<TripActionTile icon="⌖" title="Mostrar ruta al retiro" subtitle="Abrir el mapa y comenzar la navegación" tone="route" onPress={() => void openCargoRoute(selectedCargo)} />{proposal?.status === 'ACCEPTED' ? <Button label="Delivery tomado" tone="accept" onPress={() => go('proposals')} /> : waiting ? <Button label="Esperando confirmación" tone="detail" onPress={() => go('proposals')} /> : rejected ? <Button label="Propuesta rechazada · Proponer nuevamente" tone="stop" onPress={() => void proposeCargo(selectedCargo.id)} /> : <Button label={busy === selectedCargo.id ? 'Enviando…' : 'Tomar delivery'} tone="propose" onPress={() => void proposeCargo(selectedCargo.id)} />}</Card></ScrollView>
  }
  return <ScrollView contentContainerStyle={styles.content}><Header title={onlyProposals ? 'Mis propuestas' : 'Cargas'} onBack={() => go('home')} /><Text style={styles.lead}>{onlyProposals ? 'Revisá tus propuestas y el estado de cada carga.' : isTransporter ? 'Explorá cargas y deliveries disponibles para tomar.' : 'Revisá qué transportistas quieren realizar tus cargas y confirmá el match.'}</Text>{!onlyProposals ? <View style={styles.segmentedControl}><Pressable onPress={() => setViewMode('available')} style={[styles.segmentButton, viewMode === 'available' && styles.segmentButtonActive]}><Text style={[styles.segmentButtonText, viewMode === 'available' && styles.segmentButtonTextActive]}>Cargas disponibles</Text></Pressable><Pressable onPress={() => go('proposals')} style={styles.segmentButton}><Text style={styles.segmentButtonText}>Mis propuestas</Text></Pressable></View> : null}{error ? <Text style={styles.loginError}>{error}</Text> : null}{loading ? <><SkeletonCard lines={4} /><SkeletonCard lines={3} /></> : <>{viewMode === 'available' && isTransporter ? displayedCargos.map(cargo => { const delivery = isDeliveryCargo(cargo); const proposal = proposalForCargo(cargo.id); const waiting = proposedCargoIds.has(cargo.id) || proposal?.status === 'PROPOSED' || proposal?.status === 'PENDING'; return <Card key={cargo.id} onPress={delivery ? () => setSelectedCargoId(cargo.id) : undefined} variant="proposalActive"><Text style={styles.label}>{delivery ? 'DELIVERY' : cargo.cargoType || 'CARGA GENERAL'}</Text><RouteSummary id={cargo.id} origin={cargo.origin} destination={cargo.destination} /><Text style={styles.mutedText}>{formatCargoWeight(cargo)}{cargo.offeredPrice != null ? ` · $${cargo.offeredPrice.toLocaleString('es-AR')}` : ''}</Text>{delivery ? <Button label={waiting ? 'Esperando confirmación' : 'Ver delivery'} tone={waiting ? 'detail' : 'location'} onPress={() => setSelectedCargoId(cargo.id)} /> : <>{proposal?.status === 'ACCEPTED' ? <Button label="Propuesta aceptada" tone="accept" onPress={() => go('proposals')} /> : proposal?.status === 'REJECTED' ? <Button label="Propuesta rechazada · Proponer nuevamente" tone="stop" onPress={() => void proposeCargo(cargo.id)} /> : waiting ? <Button label="Esperando confirmación" tone="detail" onPress={() => go('proposals')} /> : <Button label={busy === cargo.id ? 'Enviando…' : 'Proponer tomar carga'} tone="propose" onPress={() => void proposeCargo(cargo.id)} />}{proposal ? <Button label="Revisar propuesta" tone="detail" onPress={() => go('proposals')} /> : null}</>}</Card> }) : null}{!isTransporter && viewMode === 'proposals' && takenByMe.length > 0 ? <><Text style={styles.detailSectionTitle}>Tomadas por mí</Text>{takenByMe.map(renderTakenCargo)}</> : null}{viewMode === 'proposals' ? displayedProposals.map(match => { const trip = tripForMatch(match); const action = actionForTrip(trip); const closed = match.status === 'REJECTED' || match.status === 'CANCELLED' || trip?.status === 'COMPLETED'; return <Card key={match.id} onPress={() => setSelectedProposalId(match.id)} variant={closed ? 'proposalClosed' : 'proposalActive'}><Text style={styles.label}>{isDeliveryCargo(match.cargo) ? 'PROPUESTA DE DELIVERY' : 'PROPUESTA DE CARGA'}</Text><RouteSummary id={match.cargo?.id} origin={match.cargo?.origin} destination={match.cargo?.destination} /><Text style={closed ? styles.proposalStatusClosed : styles.proposalStatus}>{proposalStatusLabel(match)}</Text>{match.status === 'ACCEPTED' ? <><Text style={[styles.label, { marginTop: 8 }]}>ESTADO DEL VIAJE</Text><Text style={styles.mutedText}>{trip?.status === 'MATCHED' ? 'Listo para ir a buscar la carga.' : trip?.status === 'IN_PROGRESS' ? 'En camino a buscar la carga.' : trip?.status === 'ARRIVED' ? 'Carga retirada: viaje en curso.' : trip?.status === 'COMPLETED' ? 'Entregado: viaje cerrado.' : 'Match confirmado. Cargando estado del viaje…'}</Text>{action ? <Button label={busy === match.id ? 'Actualizando…' : actionLabelForTrip(trip)} onPress={() => void advanceMatch(match)} /> : null}<Button label="Ver detalle del viaje" tone="detail" onPress={() => void openTripDetail(match.tripId)} /><Button label="Abrir chat" tone="chat" onPress={() => void openChat(match.id)} /></> : null}</Card>}) : null}{viewMode === 'proposals' && displayedProposals.length === 0 ? <Card><Text style={styles.mutedText}>Todavía no enviaste propuestas.</Text></Card> : null}</>}</ScrollView>
}
function Chat({ go, token: providedToken, matchId: providedMatchId = '', refreshKey = 0 }: { go: (screen: Screen) => void; token?: string; matchId?: string; refreshKey?: number }) {
  const [token, setToken] = useState(providedToken || '')
  const [activeMatchId, setActiveMatchId] = useState(providedMatchId)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [conversationTitle, setConversationTitle] = useState('Chat')
  const [routeLabel, setRouteLabel] = useState('Cargando conversación…')
  const [cargoId, setCargoId] = useState('')
  const [activeTripId, setActiveTripId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [matchReady, setMatchReady] = useState(Boolean(providedMatchId))

  useEffect(() => { Promise.all([AsyncStorage.getItem('trego.activeMatchId'), AsyncStorage.getItem('trego.activeTripId')]).then(([storedMatchId, storedTripId]) => { const resolvedMatchId = providedMatchId || storedMatchId || ''; if (resolvedMatchId) setActiveMatchId(resolvedMatchId); if (storedTripId) setActiveTripId(storedTripId); setMatchReady(true) }) }, [providedMatchId])

  useEffect(() => { if (providedToken) return; SecureStore.getItemAsync('trego.mobileToken').then(savedToken => { if (savedToken) setToken(savedToken) }) }, [providedToken])

  const loadConversation = async (silent = false) => {
    if (!token || !matchReady || !activeMatchId) return
    if (!silent) setLoading(true)
    try {
      const result = await getConversation(token, activeMatchId)
      setCurrentUserId(result.currentUserId)
      setMessages(result.conversation.messages)
      setConversationTitle(`${result.match.shipper.name} · ${result.match.transporter.name}`)
      setCargoId(result.match.cargo.id)
      setRouteLabel(`${result.match.cargo.origin} → ${result.match.cargo.destination}`)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la conversación.')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    void loadConversation()
  }, [activeMatchId, matchReady, token, refreshKey])

  async function submitMessage() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const result = await sendMessage(token, activeMatchId, body)
      setMessages(current => [...current, result.message])
      setDraft('')
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar el mensaje.')
    } finally {
      setSending(false)
    }
  }

  async function openRelatedTrip() {
    if (!activeTripId) return
    await AsyncStorage.setItem('trego.returnScreen', 'chat')
    go('trips')
  }

  return <View style={styles.chatScreen}><View style={styles.chatHeader}><Header title="Chat de la carga" onBack={() => go('chat')} />{activeTripId ? <Pressable onPress={() => void openRelatedTrip()} style={styles.chatHeaderAction} accessibilityLabel="Ver detalle del viaje"><Text style={styles.chatHeaderActionIcon}>⌖</Text><Text style={styles.chatHeaderActionText}>Ver carga</Text></Pressable> : null}</View><Card><Text style={styles.label}>CHAT DE CARGA</Text><Text style={styles.cardTitle}>Carga #{cargoId ? cargoId.slice(-8).toUpperCase() : '…'}</Text><Text style={styles.mutedText}>{routeLabel}</Text><Text style={styles.mutedText}>{conversationTitle}</Text></Card>{loading ? <Text style={styles.mutedText}>Cargando mensajes…</Text> : null}{error ? <Text style={styles.loginError}>{error}</Text> : null}<ScrollView contentContainerStyle={styles.chatMessages}>{messages.map(message => { const mine = message.senderId === currentUserId; return <View key={message.id} style={[styles.chatBubble, mine ? styles.chatBubbleMine : styles.chatBubbleOther]}><Text style={[styles.chatText, mine && styles.chatTextMine]}>{message.body}</Text><Text style={[styles.mutedText, mine && styles.chatTextMine]}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text></View> })}</ScrollView><View style={styles.chatComposer}><TextInput value={draft} onChangeText={setDraft} onSubmitEditing={submitMessage} placeholder="Escribí un mensaje" returnKeyType="send" style={styles.chatInput} editable={!sending} /><Pressable onPress={submitMessage} style={styles.chatSend}><Text style={styles.chatSendText}>{sending ? '…' : 'Enviar'}</Text></Pressable></View></View>
}

function ChatHub({ go, token, refreshKey = 0 }: { go: (screen: Screen) => void; token: string; refreshKey?: number }) {
  const [matches, setMatches] = useState<MatchRecord[]>([])
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const scrollRef = useRef<ScrollView>(null)
  const scrollOffset = useRef(0)

  useEffect(() => {
    Promise.all([getMatches(token), AsyncStorage.multiGet(['trego.chatSearch', 'trego.chatScrollY'])]).then(([result, stored]) => {
      setMatches(Array.isArray(result) ? result : result.matches ?? [])
      const storedSearch = stored.find(([key]) => key === 'trego.chatSearch')?.[1]
      const storedScroll = stored.find(([key]) => key === 'trego.chatScrollY')?.[1]
      if (storedSearch) setSearch(storedSearch)
      const offset = Number(storedScroll || 0)
      scrollOffset.current = Number.isFinite(offset) ? offset : 0
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: scrollOffset.current, animated: false }))
    }).catch(cause => setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los chats.')).finally(() => setLoading(false))
  }, [token, refreshKey])

  if (selectedMatchId) return <Chat go={next => { if (next === 'chat') setSelectedMatchId(null); else go(next) }} token={token} matchId={selectedMatchId} refreshKey={refreshKey} />
  const accepted = matches.filter(match => match.status === 'ACCEPTED')
  const shortId = (id?: string | null) => id ? id.slice(-8).toUpperCase() : 'SIN ID'
  async function openTripDetail(tripId?: string | null) {
    if (!tripId) return
    await AsyncStorage.setItem('trego.returnScreen', 'chat')
    await AsyncStorage.setItem('trego.chatSearch', search)
    await AsyncStorage.setItem('trego.chatScrollY', String(scrollOffset.current))
    await AsyncStorage.setItem('trego.activeTripId', tripId)
    go('trips')
  }
  async function openChat(match: MatchRecord) {
    await AsyncStorage.setItem('trego.activeMatchId', match.id)
    if (match.tripId) await AsyncStorage.setItem('trego.activeTripId', match.tripId)
    else await AsyncStorage.removeItem('trego.activeTripId')
    setSelectedMatchId(match.id)
  }
  const normalizeSearch = (value?: string | null) => (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const normalizedSearch = normalizeSearch(search.trim())
  const filtered = accepted.filter(match => [match.transporter?.name, match.shipper?.name, match.cargo?.origin, match.cargo?.destination, match.tripId, match.cargo?.id].filter(Boolean).map(normalizeSearch).join(' ').includes(normalizedSearch))
  return <ScrollView ref={scrollRef} contentContainerStyle={styles.content} onScroll={event => { scrollOffset.current = event.nativeEvent.contentOffset.y }} scrollEventThrottle={16}><Header title="Chats" onBack={() => go('home')} /><Text style={styles.lead}>Todas tus conversaciones, organizadas por carga y viaje.</Text><TextInput value={search} onChangeText={value => { setSearch(value); void AsyncStorage.setItem('trego.chatSearch', value) }} placeholder="Buscar por nombre o dirección" placeholderTextColor="#8BA0AC" style={styles.chatSearchInput} />{error ? <Text style={styles.loginError}>{error}</Text> : null}{loading ? <><SkeletonCard lines={3} /><SkeletonCard lines={3} /></> : filtered.length === 0 ? <Card><Text style={styles.mutedText}>{accepted.length === 0 ? 'Todavía no tenés chats activos. Aparecerán cuando se confirme un match.' : 'No encontramos chats con esa búsqueda.'}</Text></Card> : filtered.map(match => <Card key={match.id} kind="chat"><View style={styles.chatCardHeader}><Text style={styles.label}>CHAT DE CARGA</Text><Text style={styles.chatReference}>{match.tripId ? `#${shortId(match.tripId)}` : `#${shortId(match.cargo?.id)}`}</Text></View><Text style={styles.cardTitle}>{match.transporter?.name || match.shipper?.name || 'Transportista'}</Text><Text style={styles.chatSubtitle}>{match.cargo?.destination || 'Destino pendiente'}</Text><Text style={styles.mutedText}>{match.cargo?.origin || 'Origen'} → {match.cargo?.destination || 'Destino'}</Text><Text style={styles.mutedText}>Match confirmado</Text>{match.tripId ? <Button label="Ver carga / viaje" tone="detail" onPress={() => void openTripDetail(match.tripId)} /> : null}<Button label="Abrir chat" tone="chat" onPress={() => void openChat(match)} /></Card>)}</ScrollView>
}

function Home({ go, user, token, refreshKey = 0 }: { go: (screen: Screen) => void; user: MobileUser; token: string; refreshKey?: number }) {
  const isTransporter = user.roles.some(role => role.toLowerCase() === 'transporter' || role.toLowerCase() === 'transportista')
  const firstName = user.name.split(' ')[0] || 'Usuario'
  const [cargos, setCargos] = useState<AvailableCargo[]>([])
  const [availableTripId, setAvailableTripId] = useState<string | undefined>()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ title: string; message: string } | null>(null)
  const [proposedCargoIds, setProposedCargoIds] = useState<Set<string>>(new Set())
  const [rejectedCargoIds, setRejectedCargoIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    Promise.all([getAvailableCargos(token), isTransporter ? getTrips(token) : Promise.resolve({ trips: [] as TripRecord[] }), isTransporter ? getMatches(token) : Promise.resolve({ matches: [] as MatchRecord[] })]).then(([cargoResult, tripResult, matchResult]) => {
      setCargos(cargoResult.cargos)
      setAvailableTripId(tripResult.trips.find(trip => trip.status === 'AVAILABLE')?.id)
      const matches = Array.isArray(matchResult) ? matchResult : matchResult.matches ?? []
      setProposedCargoIds(new Set(matches.filter(match => !['REJECTED', 'DECLINED'].includes(match.status)).map(match => match.cargo?.id || match.cargoId)))
      setRejectedCargoIds(new Set(matches.filter(match => ['REJECTED', 'DECLINED'].includes(match.status)).map(match => match.cargo?.id || match.cargoId)))
  }).catch(cause => setError(cause instanceof Error ? cause.message : 'No se pudo cargar el marketplace.')).finally(() => setLoading(false))
  }, [isTransporter, token, refreshKey])

  async function propose(cargoId: string) {
    setBusy(cargoId); setError('')
    try {
      await createMatch(token, { cargoId, tripId: availableTripId })
      setRejectedCargoIds(current => { const next = new Set(current); next.delete(cargoId); return next })
      setProposedCargoIds(current => new Set(current).add(cargoId))
      setModal({ title: 'Postulación enviada', message: 'La persona que publicó la carga recibió una notificación y debe aceptar tu propuesta.' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar la postulación.')
    } finally { setBusy(null) }
  }

  return <><ScrollView contentContainerStyle={styles.content}><View style={styles.homeTopBar}><View style={styles.homeTitleRow}><Image source={require('./assets/brand/ios/Icon-1024.png')} style={styles.headerLogo} /><Text style={styles.homeTitle}>Inicio</Text></View><View style={styles.homeActions}><Pressable onPress={() => go('notifications')} style={styles.homeBell} accessibilityLabel="Abrir notificaciones"><Text style={styles.homeBellText}>🔔</Text></Pressable><Pressable onPress={() => go('profile')} style={styles.homeAvatar} accessibilityLabel="Abrir perfil"><Text style={styles.homeAvatarText}>{firstName.charAt(0).toUpperCase()}</Text></Pressable></View></View><Text style={styles.eyebrow}>MARKETPLACE TREGO</Text><Text style={styles.hero}>Cargas de la comunidad</Text><Text style={styles.lead}>{isTransporter ? 'Explorá cargas abiertas y postuláte para llevarlas.' : 'Publicá una carga y recibí propuestas de transportistas.'}</Text>{!isTransporter ? <Button label="Publicar una carga" onPress={() => go('publish')} /> : null}{loading ? <><SkeletonCard lines={4} /><SkeletonCard lines={3} /></> : <><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}><Text style={styles.cardTitle}>Cargas disponibles</Text><Text style={styles.mutedText}>{cargos.length} abiertas</Text></View>{error ? <Text style={styles.loginError}>{error}</Text> : null}{cargos.length === 0 ? <Card><Text style={styles.mutedText}>{isTransporter ? 'No hay cargas abiertas para postularse en este momento.' : 'Todavía no publicaste cargas.'}</Text></Card> : cargos.map(cargo => <Card key={cargo.id} variant="proposalActive"><Text style={styles.label}>{cargo.cargoType || 'CARGA GENERAL'}</Text><Text style={styles.cardTitle}>{cargo.origin}</Text><Text style={styles.cardTitle}>↓ {cargo.destination}</Text><View style={styles.row}><Text style={styles.mutedText}>Peso</Text><Text style={styles.cardTitle}>{cargo.weight ?? '—'} {cargo.weightUnit === 'TONNES' ? 'tn' : cargo.weightUnit === 'M3' ? 'm³' : 'kg'}</Text></View>{cargo.description ? <Text style={styles.mutedText}>{cargo.description}</Text> : null}{cargo.offeredPrice != null ? <Text style={styles.score}>${cargo.offeredPrice.toLocaleString('es-AR')}</Text> : null}{isTransporter ? rejectedCargoIds.has(cargo.id) ? <Button label="Propuesta rechazada · Proponer nuevamente" tone="stop" onPress={() => void propose(cargo.id)} /> : proposedCargoIds.has(cargo.id) ? <Button label="Esperando confirmación" tone="detail" onPress={() => go('proposals')} /> : <Button label={busy === cargo.id ? 'Enviando…' : 'Postularme para llevarla'} onPress={() => void propose(cargo.id)} /> : <Text style={styles.mutedText}>Esperando propuestas de transportistas</Text>}</Card>)}</>}</ScrollView><TregoModal visible={Boolean(modal)} title={modal?.title || ''} message={modal?.message || ''} onClose={() => setModal(null)} /></>
}
function TripList({ go, token, refreshKey = 0 }: { go: (screen: Screen) => void; token: string; refreshKey?: number }) {
  const [trips, setTrips] = useState<TripRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const alertedLocationRequests = useRef(new Set<string>())
  const locationWatcher = useRef<Location.LocationSubscription | null>(null)
  const sharingTripId = useRef<string | null>(null)
  const [sharingLocationTripId, setSharingLocationTripId] = useState<string | null>(null)
  const [locationError, setLocationError] = useState('')

  async function stopLocationSharing() {
    locationWatcher.current?.remove()
    locationWatcher.current = null
    sharingTripId.current = null
    setSharingLocationTripId(null)
  }

  async function startLocationSharing(trip: TripRecord) {
    if (sharingTripId.current === trip.id) return
    await stopLocationSharing()
    setLocationError('')
    const permission = await Location.requestForegroundPermissionsAsync()
    if (permission.status !== Location.PermissionStatus.GRANTED) {
      setLocationError('Necesitamos permiso de ubicación para compartir el recorrido.')
      return
    }
    sharingTripId.current = trip.id
    setSharingLocationTripId(trip.id)
    try {
      locationWatcher.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 25 }, location => {
        void sendTripLocation(token, trip.id, { lat: location.coords.latitude, lng: location.coords.longitude, accuracy: location.coords.accuracy, heading: location.coords.heading, speed: location.coords.speed, capturedAt: new Date(location.timestamp).toISOString() }).then(() => setTrips(current => current.map(item => item.id === trip.id ? { ...item, lastLocationAt: new Date(location.timestamp).toISOString() } : item))).catch(cause => {
          const status = cause instanceof Error ? (cause as Error & { status?: number }).status : undefined
          if (status === 409) setLocationError('El cargador ya no está solicitando ubicación o el viaje no está activo.')
          else setLocationError(cause instanceof Error ? cause.message : 'No se pudo enviar la ubicación.')
          if (status === 409) void stopLocationSharing()
        })
      })
    } catch (cause) {
      await stopLocationSharing()
      setLocationError(cause instanceof Error ? cause.message : 'No se pudo iniciar el compartir ubicación.')
    }
  }

  useEffect(() => {
    let mounted = true
    const loadTrips = async () => {
      try {
        const result = await getTrips(token)
        if (!mounted) return
        setTrips(result.trips)
        const storedRequestKeys = await AsyncStorage.getItem('trego.locationRequestAlerts')
        if (storedRequestKeys) JSON.parse(storedRequestKeys).forEach((key: string) => alertedLocationRequests.current.add(key))
        result.trips.filter(trip => trip.locationSharingRequested && ['MATCHED', 'IN_PROGRESS', 'ARRIVED'].includes(trip.status)).forEach(trip => {
          const requestKey = `${trip.id}:${trip.locationSharingRequestedAt || ''}`
          if (alertedLocationRequests.current.has(requestKey)) return
          alertedLocationRequests.current.add(requestKey)
          void AsyncStorage.setItem('trego.locationRequestAlerts', JSON.stringify(Array.from(alertedLocationRequests.current).slice(-100)))
          Alert.alert('Solicitud de ubicación', 'El cargador solicita que compartas la ubicación de este viaje.', [{ text: 'Ver viaje' }])
        })
      } catch (cause) { if (mounted) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los viajes.') } finally { if (mounted) setLoading(false) }
    }
    void loadTrips()
    const interval = setInterval(() => { void loadTrips() }, 10000)
    return () => { mounted = false; clearInterval(interval); void stopLocationSharing() }
  }, [token, refreshKey])

  const actionFor = (status: string): TripAction | null => status === 'MATCHED' ? 'start' : status === 'IN_PROGRESS' ? 'pickup' : status === 'ARRIVED' ? 'complete' : null
  const actionLabel = (status: string) => status === 'MATCHED' ? 'Ir a buscar la carga' : status === 'IN_PROGRESS' ? 'Marcar carga retirada' : status === 'ARRIVED' ? 'Marcar entregado y cerrar' : status === 'COMPLETED' ? 'Viaje entregado' : 'Esperando que acepten una propuesta'
  const statusLabel = (status: string) => status === 'MATCHED' ? 'Match confirmado' : status === 'IN_PROGRESS' ? 'En camino al retiro' : status === 'ARRIVED' ? 'Carga retirada · en viaje' : status === 'COMPLETED' ? 'Entregado' : 'Disponible'
  const stepFor = (status: string) => status === 'MATCHED' ? 0 : status === 'IN_PROGRESS' ? 1 : status === 'ARRIVED' ? 2 : status === 'COMPLETED' ? 3 : -1

  async function advance(trip: TripRecord) {
    const action = actionFor(trip.status)
    if (!action) return
    setBusy(trip.id)
    setError('')
    try {
      const result = await updateTripStatus(token, trip.id, action)
      setTrips(current => current.map(item => item.id === trip.id ? { ...item, ...result.trip, matches: item.matches } : item))
      Alert.alert(action === 'start' ? 'Viaje iniciado' : action === 'pickup' ? 'Carga retirada' : 'Entrega confirmada', result.notification.sent && result.notification.sent > 0 ? 'El cargador recibió una notificación push.' : 'El estado fue actualizado, pero no se pudo enviar el push al cargador.')
      Alert.alert(action === 'complete' ? 'Viaje entregado' : 'Estado actualizado', action === 'start' ? 'El cargador recibió el aviso de que vas a buscar la carga.' : action === 'pickup' ? 'La carga quedó marcada como retirada.' : 'La carga fue entregada y el viaje quedó cerrado.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el viaje.')
    } finally {
      setBusy(null)
    }
  }

  async function openChat(trip: TripRecord) {
    const matchId = trip.matches?.[0]?.id
    if (!matchId) return
    await AsyncStorage.setItem('trego.activeMatchId', matchId)
    await AsyncStorage.setItem('trego.activeTripId', trip.id)
    go('chat')
  }

  async function openPickupRoute(trip: TripRecord) {
    const cargo = trip.matches?.[0]?.cargo
    const pickupAddress = cargo?.origin || trip.origin
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pickupAddress)}&travelmode=driving`
    try {
      await Linking.openURL(mapsUrl)
    } catch {
      setError('No se pudo abrir el mapa. Verificá que tengas una app de mapas instalada.')
    }
  }

  async function closeTripDetail() {
    const returnScreen = await AsyncStorage.getItem('trego.returnScreen')
    if (returnScreen === 'chat') {
      await AsyncStorage.removeItem('trego.returnScreen')
      setSelectedTripId(null)
      go('chat')
      return
    }
    setSelectedTripId(null)
  }

  return <ScrollView contentContainerStyle={styles.content}><Header title="Mis viajes" onBack={() => go('home')} /><Text style={styles.lead}>Seguimiento de cada traslado, desde el match hasta la entrega.</Text>{error ? <Text style={styles.loginError}>{error}</Text> : null}{loading ? <><SkeletonCard lines={5} /><SkeletonCard lines={4} /></> : trips.length === 0 ? <Card><Text style={styles.mutedText}>Todavía no tenés viajes publicados.</Text></Card> : trips.map(trip => { const step = stepFor(trip.status); const cargo = trip.matches?.[0]?.cargo; const matchId = trip.matches?.[0]?.id; const active = ['AVAILABLE', 'MATCHED', 'IN_PROGRESS', 'ARRIVED'].includes(trip.status); return <Card key={trip.id} variant={active ? 'proposalActive' : 'proposalClosed'}><Text style={styles.label}>{statusLabel(trip.status)}</Text><RouteBlocks origin={cargo?.origin || trip.origin} destination={cargo?.destination || trip.destination} /><Text style={styles.mutedText}>{cargo?.cargoType || 'Viaje'} · {trip.availableCapacity} {trip.capacityUnit === 'TONNES' ? 'tn' : trip.capacityUnit === 'M3' ? 'm³' : 'kg'}{trip.matches?.[0]?.shipper?.name ? ` · Cargador: ${trip.matches[0].shipper.name}` : ''}</Text><View style={{ marginTop: 12, gap: 8 }}>{['Match confirmado', 'En camino al retiro', 'Carga retirada', 'Entregado'].map((label, index) => <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: index <= step ? '#18B95D' : '#DDE7EC', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '900' }}>{index <= step ? '✓' : ''}</Text></View><Text style={{ color: index <= step ? '#173B59' : '#8BA0AC', fontWeight: index === step ? '900' : '600' }}>{label}</Text></View>)}</View>{trip.startedAt ? <Text style={styles.mutedText}>Retiro iniciado: {new Date(trip.startedAt).toLocaleString()}</Text> : null}{trip.pickedUpAt ? <Text style={styles.mutedText}>Carga retirada: {new Date(trip.pickedUpAt).toLocaleString()}</Text> : null}{trip.completedAt ? <Text style={styles.mutedText}>Entregado: {new Date(trip.completedAt).toLocaleString()}</Text> : null}{actionFor(trip.status) ? <Button label={busy === trip.id ? 'Actualizando…' : actionLabel(trip.status)} onPress={() => void advance(trip)} /> : null}{matchId ? <Button label="Abrir chat con el cargador" light onPress={() => void openChat(trip)} /> : null}</Card>})}</ScrollView>
}

function RouteBlocks({ origin, destination }: { origin: string; destination: string }) {
  const splitLocation = (value: string) => {
    const parts = value.split(',').map(part => part.trim()).filter(Boolean)
    if (parts.length === 0) return { city: value, address: 'Dirección no especificada' }
    const partidoIndex = parts.findIndex(part => /^partido\s+de\s+/i.test(part))
    const cityIndex = partidoIndex > 0 ? partidoIndex - 1 : /^\d/.test(parts[0]) && parts.length > 2 ? 2 : 0
    return { city: parts[cityIndex] || parts[0], address: parts.filter((_, index) => index !== cityIndex).join(', ') || 'Dirección no especificada' }
  }
  const from = splitLocation(origin)
  const to = splitLocation(destination)
  return <View style={styles.routeBox}><View style={styles.routePoint}><Text style={styles.routeLabel}>ORIGEN</Text><Text style={styles.routeCity}>{from.city}</Text><Text style={styles.routeAddress}>{from.address}</Text></View><Text style={styles.routeArrow}>→</Text><View style={styles.routePoint}><Text style={styles.routeLabel}>DESTINO</Text><Text style={styles.routeCity}>{to.city}</Text><Text style={styles.routeAddress}>{to.address}</Text></View></View>
}

function DistanceToPickup({ address }: { address: string }) {
  const [label, setLabel] = useState('Distancia al retiro disponible al abrir la ruta')

  useEffect(() => {
    let mounted = true
    const resolveDistance = async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync()
        if (permission.status !== Location.PermissionStatus.GRANTED) return
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        const places = await Location.geocodeAsync(address)
        const place = places[0]
        if (!place || !mounted) return
        const distance = distanceInKm(position.coords.latitude, position.coords.longitude, place.latitude, place.longitude)
        setLabel(`Estás a ${distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`} del retiro · aproximadamente ${etaMinutes(distance)} min`)
      } catch {
        // La ruta externa seguirá mostrando el cálculo exacto aunque no haya geocodificación disponible.
      }
    }
    void resolveDistance()
    return () => { mounted = false }
  }, [address])

  return <View style={styles.distanceHint}><Text style={styles.distanceHintIcon}>⌖</Text><Text style={styles.distanceHintText}>{label}</Text></View>
}

function distanceInKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radians = (value: number) => value * Math.PI / 180
  const earthRadius = 6371
  const dLat = radians(lat2 - lat1)
  const dLng = radians(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function etaMinutes(distanceKm: number) {
  return Math.max(1, Math.ceil(distanceKm / 35 * 60))
}

function TripListWithLocation({ go, token, refreshKey = 0 }: { go: (screen: Screen) => void; token: string; refreshKey?: number }) {
  const [trips, setTrips] = useState<TripRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [locationError, setLocationError] = useState('')
  const [sharingTripId, setSharingTripId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  const [pendingStatusChange, setPendingStatusChange] = useState<{ trip: TripRecord; action: TripAction } | null>(null)
  const watcher = useRef<Location.LocationSubscription | null>(null)
  const sharingTripRef = useRef<string | null>(null)
  const alertedRequests = useRef(new Set<string>())

  const stopSharing = async () => {
    watcher.current?.remove()
    watcher.current = null
    sharingTripRef.current = null
    setSharingTripId(null)
  }

  const startSharing = async (trip: TripRecord) => {
    if (sharingTripRef.current === trip.id) return
    await stopSharing()
    setLocationError('')
    const permission = await Location.requestForegroundPermissionsAsync()
    if (permission.status !== Location.PermissionStatus.GRANTED) {
      setLocationError('Necesitamos permiso de ubicación para compartir el recorrido.')
      return
    }
    sharingTripRef.current = trip.id
    setSharingTripId(trip.id)
    try {
      watcher.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 25 }, location => {
        const capturedAt = new Date(location.timestamp).toISOString()
        void sendTripLocation(token, trip.id, { lat: location.coords.latitude, lng: location.coords.longitude, accuracy: location.coords.accuracy, heading: location.coords.heading, speed: location.coords.speed, capturedAt }).then(() => setTrips(current => current.map(item => item.id === trip.id ? { ...item, lastLocationAt: capturedAt } : item))).catch(cause => {
          const status = cause instanceof Error ? (cause as Error & { status?: number }).status : undefined
          setLocationError(status === 409 ? 'El cargador ya no está solicitando ubicación o el viaje no está activo' : cause instanceof Error ? cause.message : 'No se pudo enviar la ubicación.')
          if (status === 409) void stopSharing()
        })
      })
    } catch (cause) {
      await stopSharing()
      setLocationError(cause instanceof Error ? cause.message : 'No se pudo iniciar el compartir ubicación.')
    }
  }

  async function startPendingLocationShare(items: TripRecord[]) {
    const pendingTripId = await AsyncStorage.getItem('trego.pendingLocationShareTripId')
    if (!pendingTripId) return
    const trip = items.find(item => item.id === pendingTripId)
    if (!trip || !activeStatus(trip.status)) return
    await AsyncStorage.removeItem('trego.pendingLocationShareTripId')
    setSelectedTripId(trip.id)
    await startSharing(trip)
  }

  const actionFor = (status: string): TripAction | null => status === 'MATCHED' ? 'start' : status === 'IN_PROGRESS' ? 'pickup' : status === 'ARRIVED' ? 'complete' : null
  const actionLabel = (status: string) => status === 'MATCHED' ? 'Ir a buscar la carga' : status === 'IN_PROGRESS' ? 'Marcar carga retirada' : status === 'ARRIVED' ? 'Marcar entregado y cerrar' : 'Viaje entregado'
  const activeStatus = (status: string) => ['MATCHED', 'IN_PROGRESS', 'ARRIVED'].includes(status)

  async function applyStatusChange(trip: TripRecord, action: TripAction) {
    setBusy(trip.id)
    setError('')
    try {
      const result = await updateTripStatus(token, trip.id, action)
      setTrips(current => current.map(item => item.id === trip.id ? { ...item, ...result.trip, matches: item.matches } : item))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el viaje.')
    } finally {
      setBusy(null)
    }
  }

  function advance(trip: TripRecord) {
    const action = actionFor(trip.status)
    if (action) void applyStatusChange(trip, action)
  }

  const confirmationTitle = pendingStatusChange?.action === 'start' ? '¿Estás listo para ir a buscarla?' : pendingStatusChange?.action === 'pickup' ? '¿Confirmás que retiraste la carga?' : '¿Confirmás que entregaste la carga?'
  const confirmationMessage = pendingStatusChange?.action === 'start' ? 'Al confirmar, el cargador recibirá el aviso y el viaje pasará a “En camino al retiro”.' : pendingStatusChange?.action === 'pickup' ? 'Al confirmar, la carga quedará registrada como retirada y continuará el traslado.' : 'Al confirmar, el viaje quedará marcado como entregado y cerrado.'

  async function openChat(trip: TripRecord) {
    const matchId = trip.matches?.[0]?.id
    if (!matchId) return
    await AsyncStorage.setItem('trego.activeMatchId', matchId)
    go('chat')
  }

  async function openPickupRoute(trip: TripRecord) {
    const cargo = trip.matches?.[0]?.cargo
    const pickupAddress = cargo?.origin || trip.origin
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pickupAddress)}&travelmode=driving`
    try {
      await Linking.openURL(mapsUrl)
    } catch {
      setError('No se pudo abrir el mapa. Verificá que tengas una app de mapas instalada.')
    }
  }

  useEffect(() => () => { void stopSharing() }, [])
  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const result = await getTrips(token)
        if (!mounted) return
        setTrips(result.trips)
        await startPendingLocationShare(result.trips)
        const requestedTripId = await AsyncStorage.getItem('trego.activeTripId')
        if (requestedTripId && result.trips.some(trip => trip.id === requestedTripId)) {
          setSelectedTripId(requestedTripId)
          await AsyncStorage.removeItem('trego.activeTripId')
        }
        const stored = await AsyncStorage.getItem('trego.locationRequestAlerts')
        if (stored) JSON.parse(stored).forEach((key: string) => alertedRequests.current.add(key))
        for (const trip of result.trips) {
          if (!trip.locationSharingRequested || !['MATCHED', 'IN_PROGRESS', 'ARRIVED'].includes(trip.status)) continue
          const key = `${trip.id}:${trip.locationSharingRequestedAt || ''}`
          if (alertedRequests.current.has(key)) continue
          alertedRequests.current.add(key)
          await AsyncStorage.setItem('trego.locationRequestAlerts', JSON.stringify(Array.from(alertedRequests.current).slice(-100)))
          Alert.alert('Solicitud de ubicación', 'El cargador solicita compartir tu ubicación.', [{ text: 'Ver viaje' }])
        }
      } catch (cause) { if (mounted) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los viajes.') } finally { if (mounted) setLoading(false) }
    }
    void load()
    const interval = setInterval(() => { void load() }, 10000)
    return () => { mounted = false; clearInterval(interval); void stopSharing() }
  }, [token, refreshKey])

  const selectedTrip = selectedTripId ? trips.find(trip => trip.id === selectedTripId) : null
  const confirmationModal = <TregoModal visible={Boolean(pendingStatusChange)} title={confirmationTitle || ''} message={confirmationMessage || ''} actionLabel="Confirmar cambio" onClose={() => setPendingStatusChange(null)} onAction={() => { if (pendingStatusChange) void applyStatusChange(pendingStatusChange.trip, pendingStatusChange.action) }} />
  if (selectedTrip) {
    const cargo = selectedTrip.matches?.[0]?.cargo
    const active = activeStatus(selectedTrip.status)
    const sharing = sharingTripId === selectedTrip.id
    const step = selectedTrip.status === 'MATCHED' ? 0 : selectedTrip.status === 'IN_PROGRESS' ? 1 : selectedTrip.status === 'ARRIVED' ? 2 : selectedTrip.status === 'COMPLETED' ? 3 : -1
    return <><ScrollView contentContainerStyle={styles.content}><Header title="Detalle del viaje" onBack={() => void closeTripDetail()} /><Card><Text style={styles.label}>VIAJE #{selectedTrip.id.slice(-8).toUpperCase()}</Text><Text style={styles.cardTitle}>{tripStatusLabel(selectedTrip.status)}</Text><RouteBlocks origin={cargo?.origin || selectedTrip.origin} destination={cargo?.destination || selectedTrip.destination} />{active && ['MATCHED', 'IN_PROGRESS'].includes(selectedTrip.status) ? <TripActionTile icon="➤" title="Abrir ruta al retiro" subtitle="Ver el mapa y comenzar la navegación" tone="route" onPress={() => void openPickupRoute(selectedTrip)} /> : null}<Text style={styles.mutedText}>{cargo?.cargoType || 'Viaje'} · {selectedTrip.availableCapacity} {selectedTrip.capacityUnit === 'TONNES' ? 'tn' : selectedTrip.capacityUnit === 'M3' ? 'm³' : 'kg'}</Text>{selectedTrip.matches?.[0]?.shipper?.name ? <Text style={styles.mutedText}>Cargador: {selectedTrip.matches[0].shipper.name}</Text> : null}<Text style={styles.detailSectionTitle}>Seguimiento del traslado</Text><View style={styles.timeline}>{['Match confirmado', 'En camino al retiro', 'Carga retirada', 'Entregado'].map((label, index) => <View key={label} style={styles.timelineRow}><View style={[styles.timelineDot, index <= step && styles.timelineDotActive]}><Text style={styles.timelineCheck}>{index <= step ? '✓' : ''}</Text></View><Text style={[styles.timelineLabel, index <= step && styles.timelineLabelActive]}>{label}</Text></View>)}</View>{selectedTrip.startedAt ? <Text style={styles.mutedText}>Retiro iniciado: {new Date(selectedTrip.startedAt).toLocaleString()}</Text> : null}{selectedTrip.pickedUpAt ? <Text style={styles.mutedText}>Carga retirada: {new Date(selectedTrip.pickedUpAt).toLocaleString()}</Text> : null}{selectedTrip.completedAt ? <Text style={styles.mutedText}>Entregado: {new Date(selectedTrip.completedAt).toLocaleString()}</Text> : null}{selectedTrip.locationSharingRequested && active ? <View style={styles.locationRequest}><Text style={styles.locationRequestTitle}>Solicitud de ubicación</Text><Text style={styles.mutedText}>El cargador solicita compartir tu ubicación.</Text></View> : null}{active ? sharing ? <TripActionTile icon="↗" title="Dejar de compartir" subtitle="La ubicación se está enviando al cargador" tone="share" onPress={() => void stopSharing()} /> : <TripActionTile icon="↗" title="Compartir ubicación" subtitle="Compartir mi ubicación actual" tone="share" onPress={() => void startSharing(selectedTrip)} /> : null}{selectedTrip.lastLocationAt ? <Text style={styles.mutedText}>Última ubicación enviada: {new Date(selectedTrip.lastLocationAt).toLocaleString()}</Text> : null}{actionFor(selectedTrip.status) ? <TripActionTile icon="⌕" title={busy === selectedTrip.id ? 'Actualizando…' : actionLabel(selectedTrip.status)} subtitle="Ver detalle de la carga y del cargador" tone="status" onPress={() => advance(selectedTrip)} confirmation={{ title: selectedTrip.status === 'MATCHED' ? '¿Estás listo para ir a buscarla?' : selectedTrip.status === 'IN_PROGRESS' ? '¿Confirmás que retiraste la carga?' : '¿Confirmás que entregaste la carga?', message: selectedTrip.status === 'MATCHED' ? 'Al confirmar, el cargador recibirá el aviso y el viaje pasará a “En camino al retiro”.' : selectedTrip.status === 'IN_PROGRESS' ? 'Al confirmar, la carga quedará registrada como retirada y continuará el traslado.' : 'Al confirmar, el viaje quedará marcado como entregado y cerrado.' }} /> : null}{selectedTrip.matches?.[0]?.id ? <TripActionTile icon="◯" title="Abrir chat con el cargador" subtitle="Coordinar horarios y detalles" tone="chat" onPress={() => void openChat(selectedTrip)} /> : null}</Card></ScrollView>{confirmationModal}</>
  }

  return <><ScrollView contentContainerStyle={styles.content}><Header title="Mis viajes" onBack={() => go('home')} /><Text style={styles.lead}>Seguimiento de cada traslado, desde el match hasta la entrega.</Text>{error ? <Text style={styles.loginError}>{error}</Text> : null}{locationError ? <Text style={styles.loginError}>{locationError}</Text> : null}{loading ? <><SkeletonCard lines={5} /><SkeletonCard lines={4} /></> : trips.length === 0 ? <Card><Text style={styles.mutedText}>Todavía no tenés viajes publicados.</Text></Card> : trips.map(trip => { const cargo = trip.matches?.[0]?.cargo; const active = activeStatus(trip.status); const sharing = sharingTripId === trip.id; return <Card key={trip.id} onPress={() => setSelectedTripId(trip.id)}><Text style={styles.label}>VIAJE #{trip.id.slice(-8).toUpperCase()}</Text><Text style={styles.cardTitle}>{tripStatusLabel(trip.status)}</Text><RouteBlocks origin={cargo?.origin || trip.origin} destination={cargo?.destination || trip.destination} /><Text style={styles.mutedText}>{cargo?.cargoType || 'Viaje'} · {trip.availableCapacity} {trip.capacityUnit === 'TONNES' ? 'tn' : trip.capacityUnit === 'M3' ? 'm³' : 'kg'}</Text>{trip.locationSharingRequested && active ? <View style={styles.locationRequest}><Text style={styles.locationRequestTitle}>Solicitud de ubicación</Text><Text style={styles.mutedText}>El cargador solicita compartir tu ubicación.</Text></View> : null}{sharing ? <Text style={styles.locationSharingText}>● Compartiendo ubicación</Text> : null}<Text style={styles.openDetailHint}>Tocá para ver el detalle completo</Text></Card>})}</ScrollView>{confirmationModal}</>
}

function TransporterReviews({ reviews, reviewsCount, averageRating, loading, error }: { reviews: DeliveryReview[]; reviewsCount: number; averageRating: number | null; loading: boolean; error: string }) {
  if (loading) return <><SkeletonCard lines={3} /><SkeletonCard lines={3} /></>
  if (error) return <Text style={styles.loginError}>{error}</Text>
  if (reviews.length === 0) return <Card><Text style={styles.detailSectionTitle}>Referencias de clientes</Text><Text style={styles.mutedText}>Todavía no hay reseñas de deliveries.</Text></Card>
  return <View style={styles.reviewsSection}><View style={styles.reviewsSummary}><View><Text style={styles.detailSectionTitle}>Referencias de clientes</Text><Text style={styles.reviewAverage}>{averageRating == null ? '—' : averageRating.toFixed(1)} <Text style={styles.reviewStar}>★</Text></Text><Text style={styles.mutedText}>{reviewsCount} {reviewsCount === 1 ? 'reseña' : 'reseñas'} de deliveries entregados</Text></View><Text style={styles.reviewStars}>{'★'.repeat(Math.max(0, Math.min(5, Math.round(averageRating || 0))))}{'☆'.repeat(Math.max(0, 5 - Math.min(5, Math.round(averageRating || 0))))}</Text></View>{reviews.map((review, index) => <Card key={`${review.createdAt}-${index}`} kind="review"><View style={styles.reviewCardHeader}><Text style={styles.reviewStars}>{'★'.repeat(Math.max(0, Math.min(5, Math.round(review.rating))))}{'☆'.repeat(Math.max(0, 5 - Math.min(5, Math.round(review.rating))))}</Text><Text style={styles.reviewDate}>{new Date(review.createdAt).toLocaleDateString('es-AR')}</Text></View>{review.comment ? <Text style={styles.reviewComment}>“{review.comment}”</Text> : null}{review.highlights?.length ? <View style={styles.reviewPills}>{review.highlights.map(highlight => <Text key={highlight} style={styles.reviewPill}>{highlight}</Text>)}</View> : null}</Card>)}</View>
}

function Simple({ screen, go, onSignOut, refreshKey = 0 }: { screen: Exclude<Screen, 'home' | 'publish' | 'matches' | 'chat'>; go: (screen: Screen) => void; onSignOut?: () => void; refreshKey?: number }) {
  const [token, setToken] = useState('')
  const [user, setUser] = useState<MobileUser | null>(null)
  const [trips, setTrips] = useState<TripRecord[]>([])
  const [notifications, setNotifications] = useState<MobileNotification[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reviews, setReviews] = useState<DeliveryReview[]>([])
  const [reviewsCount, setReviewsCount] = useState(0)
  const [averageRating, setAverageRating] = useState<number | null>(null)
  const [reviewsLoading, setReviewsLoading] = useState(true)
  const [reviewsError, setReviewsError] = useState('')

  useEffect(() => {
    Promise.all([SecureStore.getItemAsync('trego.mobileToken'), SecureStore.getItemAsync('trego.mobileUser')]).then(([savedToken, savedUser]) => {
      if (savedToken) setToken(savedToken)
      if (savedUser) setUser(JSON.parse(savedUser))
    }).catch(() => setError('No se pudo cargar el perfil.'))
    .finally(() => { if (screen !== 'profile') setLoading(false) })
  }, [screen])

  useEffect(() => {
    if (screen !== 'profile' || !token) return
    setReviewsLoading(true)
    setReviewsError('')
    getTransporterProfile(token).then(result => {
      setReviews(result.reviews ?? [])
      setReviewsCount(result.reviewsCount ?? result.reviews?.length ?? 0)
      setAverageRating(result.averageRating ?? null)
    }).catch(cause => setReviewsError(cause instanceof Error ? cause.message : 'No se pudieron cargar las referencias.')).finally(() => { setReviewsLoading(false); setLoading(false) })
  }, [screen, token, refreshKey])

  useEffect(() => {
    if (!token || screen === 'profile') return
    const load = screen === 'trips' ? getTrips(token).then(result => setTrips(result.trips)) : getNotifications(token).then(result => setNotifications(result.notifications))
    load.catch(cause => setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los datos.')).finally(() => setLoading(false))
  }, [screen, token, refreshKey])

  const title = screen === 'notifications' ? 'Alertas' : screen === 'trips' ? 'Mis viajes' : 'Mi perfil'
  const isTransporter = user?.roles?.some(role => ['transporter', 'transportista'].includes(role.toLowerCase()))
  return <ScrollView contentContainerStyle={styles.content}><Header title={title} onBack={() => go('home')} />{error ? <Text style={styles.loginError}>{error}</Text> : null}{loading ? <><SkeletonCard lines={3} /><SkeletonCard lines={2} /></> : screen === 'notifications' ? <>{notifications.length === 0 ? <Card><Text style={styles.mutedText}>No hay notificaciones nuevas.</Text></Card> : notifications.map(notification => <Card key={notification.id}><Text style={styles.cardTitle}>{notification.title}</Text><Text style={styles.mutedText}>{notification.body}</Text></Card>)}</> : screen === 'trips' ? <>{trips.length === 0 ? <Card><Text style={styles.mutedText}>Todavía no tenés viajes publicados.</Text></Card> : trips.map(trip => <Card key={trip.id}><Text style={styles.cardTitle}>{trip.origin} → {trip.destination}</Text><Text style={styles.mutedText}>{trip.availableCapacity} {trip.capacityUnit === 'TONNES' ? 'tn' : trip.capacityUnit === 'M3' ? 'm³' : 'kg'} · {tripStatusLabel(trip.status)}</Text></Card>)}</> : <><Card><Text style={styles.cardTitle}>{user?.name || 'Tu perfil'}</Text><Text style={styles.mutedText}>{user?.email || 'Cuenta autenticada'}</Text><Text style={styles.appVersion}>Versión {APP_VERSION} · build {APP_BUILD} · commit {APP_COMMIT}</Text></Card>{isTransporter ? <TransporterReviews reviews={reviews} reviewsCount={reviewsCount} averageRating={averageRating} loading={reviewsLoading} error={reviewsError} /> : null}<Button label="Cerrar sesión" onPress={() => onSignOut?.()} light /></>}</ScrollView>
}
function ProposalNavItem({ active, onPress, token, refreshKey }: { active: boolean; onPress: () => void; token: string; refreshKey: number }) {
  return <Pressable onPress={onPress} style={[styles.navItem, active && styles.navItemActive]}><Text style={[styles.navIcon, active && styles.navActive]}>▤</Text><Text style={[styles.navText, active && styles.navActive]}>Propuestas</Text></Pressable>
}
function AppContent() {
  const [screen, setScreen] = useState<Screen>('home')
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<MobileUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [pushRevision, setPushRevision] = useState(0)
  const [globalModal, setGlobalModal] = useState<TregoModalPayload | null>(null)
  const insets = useSafeAreaInsets()
  const go = (next: Screen) => setScreen(next)
  useEffect(() => { openGlobalTregoModal = setGlobalModal; return () => { openGlobalTregoModal = null } }, [])
  const onAuthenticated = async (result: { token: string; user: MobileUser }) => {
    await SecureStore.setItemAsync('trego.mobileToken', result.token)
    await SecureStore.setItemAsync('trego.mobileUser', JSON.stringify(result.user))
    setToken(result.token)
    setUser(result.user)
  }
  useEffect(() => { Promise.all([SecureStore.getItemAsync('trego.mobileToken'), SecureStore.getItemAsync('trego.mobileUser')]).then(([savedToken, savedUser]) => { if (savedToken && savedUser) { setToken(savedToken); setUser(JSON.parse(savedUser)) } }).finally(() => setAuthLoading(false)) }, [])
  useEffect(() => { if (Platform.OS !== 'android') return; void Notifications.setNotificationChannelAsync('trego-default', { name: 'Trego', importance: Notifications.AndroidImportance.MAX, sound: 'default' }) }, [])
  useEffect(() => {
    if (!token) return
    let mounted = true
    preparePushToken(token).catch(error => { if (__DEV__) console.warn('[push] No se pudo registrar el dispositivo', error) })
    const openNotification = async (data?: NotificationData) => { if (!mounted || await markNotificationAsSeen(data)) return; await queueLocationShare(data); go(notificationScreen(data)) }
    const unsubscribeMessage = onMessage(firebaseMessaging, async remoteMessage => { const data = remoteMessage.data as NotificationData | undefined; if (await markNotificationAsSeen(data)) return; await queueLocationShare(data); const copy = pushCopy(data?.type); await Notifications.scheduleNotificationAsync({ content: { title: remoteMessage.notification?.title || copy.title, body: remoteMessage.notification?.body || copy.body, sound: 'default', data }, trigger: null }); setPushRevision(current => current + 1); if (data?.type === 'location_request') go('trips') })
    const unsubscribeOpened = onNotificationOpenedApp(firebaseMessaging, remoteMessage => { void openNotification(remoteMessage.data) })
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(response => { void openNotification(response.notification.request.content.data as NotificationData) })
    const unsubscribeToken = onTokenRefresh(firebaseMessaging, pushToken => { if (mounted) void preparePushToken(token, pushToken).catch(error => { if (__DEV__) console.warn('[push] No se pudo actualizar el dispositivo', error) }) })
    void getInitialNotification(firebaseMessaging).then(remoteMessage => { if (remoteMessage) void openNotification(remoteMessage.data) })
    return () => { mounted = false; unsubscribeMessage(); unsubscribeOpened(); responseSubscription.remove(); unsubscribeToken() }
  }, [token])
  const signOut = async () => { await SecureStore.deleteItemAsync('trego.mobileToken'); await SecureStore.deleteItemAsync('trego.mobileUser'); setToken(null); setUser(null); setScreen('home') }
  if (authLoading) return <View style={styles.loading}><Text style={styles.loadingText}>Cargando Trego…</Text></View>
  if (!token || !user) return <Login onAuthenticated={onAuthenticated} />
  const content = screen === 'home' ? <Home go={go} user={user} token={token} refreshKey={pushRevision} /> : screen === 'publish' ? <Publish go={go} token={token} /> : screen === 'matches' ? <Matches go={go} token={token} roles={user.roles} refreshKey={pushRevision} /> : screen === 'proposals' ? <Matches go={go} token={token} roles={user.roles} refreshKey={pushRevision} onlyProposals /> : screen === 'chat' ? <ChatHub go={go} token={token} refreshKey={pushRevision} /> : screen === 'trips' ? <TripListWithLocation go={go} token={token} refreshKey={pushRevision} /> : <Simple screen={screen} go={go} onSignOut={signOut} refreshKey={pushRevision} />
  return <SafeAreaView style={styles.safe}>{content}<View style={[styles.nav, { height: 86 + insets.bottom, paddingBottom: insets.bottom }]}>{[['home', 'Inicio', '⌂'], ['matches', 'Cargas', '▱'], ['trips', 'Viajes', '⌖'], ['chat', 'Chats', '◯']].map(([key, label, icon]) => <Pressable key={key} onPress={() => go(key as Screen)} style={[styles.navItem, screen === key && styles.navItemActive]}><Text style={[styles.navIcon, screen === key && styles.navActive]}>{icon}</Text><Text style={[styles.navText, screen === key && styles.navActive]}>{label}</Text></Pressable>)}<ProposalNavItem active={screen === 'proposals'} onPress={() => go('proposals')} token={token} refreshKey={pushRevision} /></View><TregoModal visible={Boolean(globalModal)} title={globalModal?.title || ''} message={globalModal?.message || ''} actionLabel={globalModal?.actionLabel} onClose={() => setGlobalModal(null)} onAction={globalModal?.onAction} /></SafeAreaView>
}
export default function App() { return <SafeAreaProvider><AppContent /></SafeAreaProvider> }
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#F5F8FA' }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F8FA' }, loadingText: { color: '#173B59', fontSize: 16, fontWeight: '700' }, loginContent: { flexGrow: 1, justifyContent: 'center', padding: 26, gap: 14, backgroundColor: '#F5F8FA' }, loginLogo: { width: 76, height: 76, borderRadius: 22, alignSelf: 'center', marginBottom: 12 }, loginTitle: { fontSize: 40, fontWeight: '900', letterSpacing: -1.8, color: '#173B59', textAlign: 'center' }, loginError: { color: '#B42318', backgroundColor: '#FEE4E2', borderRadius: 12, padding: 12, fontSize: 14 }, googleButton: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#C9D7DE', paddingVertical: 15, borderRadius: 999, alignItems: 'center', marginTop: 12 }, googleButtonText: { color: '#173B59', fontWeight: '800', fontSize: 15 }, loginDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 8 }, dividerLine: { flex: 1, height: 1, backgroundColor: '#DDE7EC' }, dividerText: { color: '#8BA0AC', fontSize: 12 }, content: { padding: 22, paddingTop: 26, paddingBottom: 122, gap: 16 }, brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }, brandLogo: { width: 34, height: 34, borderRadius: 10 }, brand: { fontSize: 28, fontWeight: '900', letterSpacing: -2.2, color: '#173B59' }, brandDot: { color: '#E86A5B' }, header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, marginBottom: 10 }, headerLogo: { width: 30, height: 30, borderRadius: 9 }, back: { fontSize: 36, lineHeight: 36, color: '#647985' }, title: { fontSize: 34, fontWeight: '900', letterSpacing: -1.4, color: '#173B59', flexShrink: 1 }, eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, color: '#6C7D88', marginTop: 18 }, hero: { fontSize: 44, lineHeight: 47, fontWeight: '900', letterSpacing: -2, marginTop: 16, color: '#173B59' }, lead: { fontSize: 16, lineHeight: 23, color: '#647985', marginBottom: 10 }, muted: { color: '#8BA0AC' }, card: { backgroundColor: '#fff', borderRadius: 18, padding: 18, gap: 8, borderWidth: 2, borderColor: '#B9D8E5', shadowColor: '#173B59', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 }, cardTitle: { fontSize: 18, fontWeight: '800', color: '#173B59' }, mutedText: { color: '#647985', fontSize: 14, lineHeight: 21 }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: 7 }, score: { fontSize: 24, fontWeight: '900', color: '#168F83' }, button: { backgroundColor: '#DCECF0', paddingVertical: 14, paddingHorizontal: 18, borderRadius: 999, alignItems: 'center', marginTop: 10 }, buttonLight: { backgroundColor: '#F8FBFC', borderWidth: 1, borderColor: '#C9D7DE' }, buttonText: { color: '#173B59', fontWeight: '800' }, buttonTextLight: { color: '#173B59' }, label: { fontSize: 12, fontWeight: '800', color: '#6C7D88', textTransform: 'uppercase', letterSpacing: 1, marginTop: 6 }, input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#C9D7DE', borderRadius: 12, padding: 14, fontSize: 16, color: '#173B59' }, textarea: { minHeight: 110, textAlignVertical: 'top' }, signOut: { position: 'absolute', top: 20, right: 22, padding: 8 }, signOutText: { color: '#647985', fontWeight: '700' }, chatScreen: { flex: 1, padding: 22, paddingTop: 26, paddingBottom: 100, gap: 12 }, chatMessages: { flexGrow: 1, justifyContent: 'flex-end', gap: 10, paddingVertical: 12 }, chatBubble: { maxWidth: '82%', padding: 13, borderRadius: 16 }, chatBubbleMine: { alignSelf: 'flex-end', backgroundColor: '#173B59', borderBottomRightRadius: 4 }, chatBubbleOther: { alignSelf: 'flex-start', backgroundColor: '#E8F1F3', borderBottomLeftRadius: 4 }, chatText: { color: '#173B59', fontSize: 15, lineHeight: 21 }, chatTextMine: { color: '#fff' }, chatComposer: { flexDirection: 'row', alignItems: 'center', gap: 8 }, chatInput: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#C9D7DE', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: '#173B59' }, chatSend: { backgroundColor: '#E86A5B', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 13 }, chatSendText: { color: '#fff', fontWeight: '800' }, nav: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#DDE7EC', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }, navItem: { minWidth: 62, minHeight: 48, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, navItemActive: { backgroundColor: '#E8F1F3' }, navText: { fontSize: 14, fontWeight: '800', color: '#8BA0AC' }, navActive: { color: '#173B59' }, arrivalButton: { backgroundColor: '#18C968', borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 18 }, arrivalButtonDisabled: { backgroundColor: '#B7CBD8' }, arrivalButtonText: { color: '#fff', fontWeight: '900', fontSize: 15, letterSpacing: 0.5 } })
Object.assign(styles, { arrivalButton: { backgroundColor: '#18C968', borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 18 }, arrivalButtonDisabled: { backgroundColor: '#B7CBD8' }, arrivalButtonText: { color: '#fff', fontWeight: '900', fontSize: 15, letterSpacing: 0.5 }, cargoId: { color: '#087C70', backgroundColor: '#DDF7EC', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, fontWeight: '900' }, routeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#18B95D' }, routeDotDestination: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#173B59' }, routeLine: { width: 2, height: 20, backgroundColor: '#B7CBD8' }, routeLabel: { color: '#8BA0AC', fontSize: 10, fontWeight: '800', letterSpacing: 1 }, routeAddress: { color: '#173B59', fontSize: 17, lineHeight: 22, fontWeight: '800' }, homeTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }, homeTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, homeTitle: { color: '#173B59', fontSize: 34, fontWeight: '900' }, homeActions: { flexDirection: 'row', alignItems: 'center', gap: 10 }, homeBell: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', borderWidth: 1, borderColor: '#DDE7EC', alignItems: 'center', justifyContent: 'center' }, homeBellText: { fontSize: 20 }, homeAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#168F83', alignItems: 'center', justifyContent: 'center' }, homeAvatarText: { color: '#fff', fontSize: 18, fontWeight: '900' } })
Object.assign(styles, { skeletonTitle: { width: '62%', height: 18, borderRadius: 9, backgroundColor: '#E3EDF0', marginBottom: 14 }, skeletonLine: { width: '100%', height: 12, borderRadius: 6, backgroundColor: '#EAF1F3', marginBottom: 10 }, skeletonShort: { width: '42%' }, navText: { fontSize: 14, fontWeight: '800', color: '#5F7483' }, navItemActive: { backgroundColor: '#DCECF0' }, navActive: { color: '#173B59', fontWeight: '900' }, locationRequest: { marginTop: 12, padding: 14, borderRadius: 14, backgroundColor: '#EAF9F4', borderWidth: 1, borderColor: '#B9EED7', gap: 4 }, locationRequestTitle: { color: '#087C70', fontWeight: '900', fontSize: 14 }, locationSharingText: { color: '#087C70', fontWeight: '900', marginTop: 12 }, routeBox: { flexDirection: 'row', alignItems: 'stretch', gap: 10, borderWidth: 1, borderColor: '#C9D7DE', borderRadius: 16, padding: 14, marginTop: 8, backgroundColor: '#F8FBFC' }, routePoint: { flex: 1, minWidth: 0 }, routeLabel: { color: '#6C7D88', fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginBottom: 4 }, routeCity: { color: '#173B59', fontSize: 17, lineHeight: 21, fontWeight: '900' }, routeAddress: { color: '#647985', fontSize: 12, lineHeight: 17, marginTop: 3 }, routeArrow: { alignSelf: 'center', color: '#8BA0AC', fontSize: 26, fontWeight: '800' }, appVersion: { color: '#8BA0AC', fontSize: 12, marginTop: 12, letterSpacing: 0.2 }, chatCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, chatReference: { color: '#087C70', backgroundColor: '#DDF7E8', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, fontSize: 12, fontWeight: '900', letterSpacing: 0.4 }, chatSubtitle: { color: '#087C70', fontSize: 16, fontWeight: '900', letterSpacing: 0.2 }, openDetailHint: { color: '#173B59', fontSize: 12, fontWeight: '800', marginTop: 8 }, detailSectionTitle: { color: '#173B59', fontSize: 16, fontWeight: '900', marginTop: 16, marginBottom: 4 }, timeline: { gap: 10, marginVertical: 8 }, timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, timelineDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#DDE7EC', alignItems: 'center', justifyContent: 'center' }, timelineDotActive: { backgroundColor: '#18B95D' }, timelineCheck: { color: '#fff', fontSize: 12, fontWeight: '900' }, timelineLabel: { color: '#8BA0AC', fontSize: 14, fontWeight: '700' }, timelineLabelActive: { color: '#173B59', fontWeight: '900' }, tripCard: { borderWidth: 2, borderColor: '#8AD9BF', shadowOpacity: 0.1, shadowRadius: 10 }, chatCard: { borderWidth: 2, borderColor: '#B9D8E5', shadowOpacity: 0.08, shadowRadius: 8 } })
Object.assign(styles, { buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, buttonIcon: { color: '#173B59', fontSize: 16, fontWeight: '900' }, locationButton: { backgroundColor: '#18B95D', borderColor: '#18B95D' }, stopButton: { backgroundColor: '#FDE8E7', borderWidth: 1, borderColor: '#E86A5B' }, coloredButtonText: { color: '#fff' }, stopButtonText: { color: '#B42318' } })
Object.assign(styles, { button: { backgroundColor: '#173B59', paddingVertical: 14, paddingHorizontal: 18, borderRadius: 999, alignItems: 'center', marginTop: 10, borderWidth: 1.5, borderColor: '#0D2C45' }, buttonLight: { backgroundColor: '#E8F1F3', borderWidth: 1.5, borderColor: '#8DB8C9' }, buttonText: { color: '#fff', fontWeight: '800' }, buttonTextLight: { color: '#173B59' }, buttonIcon: { color: '#fff', fontSize: 16, fontWeight: '900' } })
Object.assign(styles, { modalBackdrop: { flex: 1, backgroundColor: 'rgba(23, 59, 89, 0.42)', alignItems: 'center', justifyContent: 'center', padding: 24 }, tregoModal: { width: '100%', maxWidth: 360, backgroundColor: '#F8FBFC', borderRadius: 26, padding: 24, borderWidth: 2, borderColor: '#B9D8E5', shadowColor: '#173B59', shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 }, modalIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#DDF7E8', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 12 }, modalIconText: { color: '#118443', fontSize: 26, fontWeight: '900' }, modalTitle: { color: '#173B59', fontSize: 22, lineHeight: 27, fontWeight: '900', textAlign: 'center' }, modalMessage: { color: '#647985', fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10 } })
Object.assign(styles, { actionButton: { borderWidth: 1.5 }, proposeButton: { backgroundColor: '#168F83', borderColor: '#087C70' }, acceptButton: { backgroundColor: '#18B95D', borderColor: '#118443' }, statusButton: { backgroundColor: '#173B59', borderColor: '#0D2C45' }, chatButton: { backgroundColor: '#6F8FA3', borderColor: '#587687' }, detailButton: { backgroundColor: '#E8F1F3', borderColor: '#8DB8C9' }, detailButtonText: { color: '#173B59' } })
Object.assign(styles, { segmentedControl: { flexDirection: 'row', backgroundColor: '#E8F1F3', borderRadius: 16, padding: 4, gap: 4, marginBottom: 4 }, segmentButton: { flex: 1, minHeight: 44, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, segmentButtonActive: { backgroundColor: '#173B59' }, segmentButtonText: { color: '#5F7483', fontSize: 13, fontWeight: '800', textAlign: 'center' }, segmentButtonTextActive: { color: '#fff' } })
Object.assign(styles, { reviewsSection: { gap: 12, marginTop: 4 }, reviewsSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderRadius: 18, backgroundColor: '#EAF9F4', borderWidth: 2, borderColor: '#B9EED7' }, reviewAverage: { color: '#173B59', fontSize: 28, fontWeight: '900', marginTop: 4 }, reviewStar: { color: '#F1A83B', fontSize: 24 }, reviewStars: { color: '#F1A83B', fontSize: 18, fontWeight: '900', letterSpacing: 1 }, reviewCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, reviewDate: { color: '#8BA0AC', fontSize: 12, fontWeight: '700' }, reviewComment: { color: '#173B59', fontSize: 15, lineHeight: 22, fontWeight: '600', marginTop: 4 }, reviewPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 4 }, reviewPill: { color: '#087C70', backgroundColor: '#DDF7E8', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: '800' }, reviewCard: { borderColor: '#C9DDE5', borderRadius: 16 } })
Object.assign(styles, { deliveryInfoGrid: { marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: '#F2F8FA', borderWidth: 1, borderColor: '#C9DDE5', gap: 7 }, strongText: { color: '#173B59', fontWeight: '900' }, priceText: { color: '#087C70', fontWeight: '900', fontSize: 16 } })
Object.assign(styles, { distanceHint: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: '#EAF9F4', borderWidth: 1, borderColor: '#B9EED7' }, distanceHintIcon: { color: '#087C70', fontSize: 20, fontWeight: '900' }, distanceHintText: { flex: 1, color: '#087C70', fontSize: 13, fontWeight: '800' } })
Object.assign(styles, { navIcon: { color: '#173B59', fontSize: 26, lineHeight: 29, fontWeight: '900', marginBottom: 2 }, navIconRow: { height: 31, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 4 }, navBadge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: '#E85C53', color: '#fff', fontSize: 11, fontWeight: '900', textAlign: 'center', lineHeight: 18 }, navItem: { minWidth: 58, minHeight: 60, paddingHorizontal: 5, paddingVertical: 5, borderRadius: 15, alignItems: 'center', justifyContent: 'center', gap: 1 }, navItemActive: { minWidth: 72, minHeight: 68, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: '#D8E4E8' }, navText: { fontSize: 13, fontWeight: '900', color: '#173B59' }, navActive: { color: '#087C70', fontWeight: '900' }, proposalStatus: { color: '#087C70', fontSize: 14, fontWeight: '900', marginTop: 4 }, proposalStatusClosed: { color: '#7C8B95', fontSize: 14, fontWeight: '900', marginTop: 4 }, proposalCardActive: { borderColor: '#52C99B', shadowColor: '#087C70', shadowOpacity: 0.12, shadowRadius: 10 }, proposalCardClosed: { borderColor: '#B8C2C8', backgroundColor: '#F0F3F4', opacity: 0.78, shadowOpacity: 0 } })
Object.assign(styles, { tripActionTile: { flexDirection: 'row', alignItems: 'center', minHeight: 72, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 28, marginTop: 10, gap: 14 }, tripActionRoute: { backgroundColor: '#08A878', borderWidth: 1, borderColor: '#078E68' }, tripActionShare: { backgroundColor: '#E3F6EF', borderWidth: 1, borderColor: '#B9EED7' }, tripActionStatus: { backgroundColor: '#073C61', borderWidth: 1, borderColor: '#062F4C' }, tripActionChat: { backgroundColor: '#E3EAF0', borderWidth: 1, borderColor: '#C5D3DC' }, tripActionIcon: { width: 34, textAlign: 'center', color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '900' }, tripActionCopy: { flex: 1, gap: 2 }, tripActionTitle: { color: '#fff', fontSize: 16, fontWeight: '900' }, tripActionSubtitle: { color: '#E9F7F2', fontSize: 13, lineHeight: 18 }, tripActionArrow: { color: '#fff', fontSize: 32, lineHeight: 32, fontWeight: '400' }, tripActionLightText: { color: '#087C70' }, tripActionLightSubtitle: { color: '#168F83' } })
Object.assign(styles, { chatHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, chatHeaderAction: { marginTop: 18, minWidth: 72, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14, backgroundColor: '#E3F6EF', borderWidth: 1, borderColor: '#B9EED7' }, chatHeaderActionIcon: { color: '#087C70', fontSize: 22, lineHeight: 22, fontWeight: '900' }, chatHeaderActionText: { color: '#087C70', fontSize: 11, fontWeight: '900', marginTop: 2 } })
Object.assign(styles, { chatSearchInput: { backgroundColor: '#fff', borderWidth: 2, borderColor: '#B9D8E5', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13, color: '#173B59', fontSize: 15, marginBottom: 2 } })
