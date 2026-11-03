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
import { AccessibilityInfo, ActivityIndicator, Animated, AppState, Image, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput as RNTextInput, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { acceptMatch, archiveCargo, AvailableCargo, CancellationCase, CommissionQuote, ConversationMessage, createCargo, createMatch, createTransporterTrip, DeliveryReview, getAvailableCargos, getCancellationCases, getCommissionQuote, getConversation, getMatches, getNotifications, getRouteSuggestions, getRouteSuggestionMap, getTripLocationState, getTransporterAvailability, getTransporterProfile, getTrips, getTransporterRoutes, loginWithCredentials, loginWithGoogle, markTripArrived, MatchRecord, MobileNotification, MobileUser, mutateCancellation, mutateTransporterRoute, proposeRouteSuggestion, registerDevice, searchAddresses, sendMessage, sendTripLocation, setTransporterAvailability, setTripLocationSharing, TripAction, TripRecord, TransporterProfileResponse, TransporterRoute, updateTripStatus } from './api'
import { formatDate, formatDateTime, formatNumber, getLocale, I18nProvider, localeLabels, supportedLocales, translateText, useI18n } from './i18n'

WebBrowser.maybeCompleteAuthSession()
const LayoutAnimation = { configureNext: (_preset?: unknown) => undefined, Presets: { easeInEaseOut: undefined } }
function Text(props: any) { const { locale } = useI18n(); const children = React.Children.map(props.children, child => typeof child === 'string' ? translateText(child, locale) : child); return <RNText {...props}>{children}</RNText> }
function TextInput(props: any) { const { locale } = useI18n(); const placeholder = typeof props.placeholder === 'string' ? translateText(props.placeholder, locale) : props.placeholder; return <RNTextInput {...props} placeholder={placeholder} /> }
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
type Screen = 'home' | 'publish' | 'matches' | 'cargo-routes' | 'proposals' | 'chat' | 'notifications' | 'trips' | 'routes' | 'cancellations' | 'profile' | 'transporter-profile'
let activeRouteToken = ''
type NotificationData = { type?: string; notificationId?: string; matchId?: string; tripId?: string; cargoId?: string; conversationId?: string; [key: string]: string | object | undefined }

const tripStatusLabel = (status?: string) => ({ AVAILABLE: 'Disponible', MATCHED: 'Match confirmado', IN_PROGRESS: 'En camino al retiro', ARRIVED: 'Carga retirada', COMPLETED: 'Entregado', CANCELLED: 'Cancelado' } as Record<string, string>)[status || ''] || 'Estado pendiente'

const notificationScreen = (data?: NotificationData): Screen => {
  switch (data?.type) {
    case 'delivery_request': return 'matches'
    case 'cargo': return 'matches'
    case 'match': return 'matches'
    case 'acceptance': return 'trips'
    case 'delivery': return 'trips'
    case 'location_request': return 'trips'
    case 'location_sharing': return 'trips'
    case 'cancellation_request':
    case 'cancel_request':
    case 'cancellation_accepted':
    case 'cancel_accepted':
    case 'cancellation_rejected':
    case 'cancel_rejected': return 'cancellations'
    case 'message': return 'chat'
    default: return 'notifications'
  }
}

const pushCopy = (type?: string) => {
  switch (type) {
    case 'delivery_request':
      return { title: 'Nuevo pedido de delivery', body: 'Hay un delivery disponible para tomar.' }
    case 'cancellation_request':
    case 'cancel_request':
      return { title: 'Solicitud de cancelación', body: 'Tenés una solicitud de cancelación para revisar.' }
    case 'cancellation_accepted':
    case 'cancel_accepted':
      return { title: 'Cancelación aceptada', body: 'La solicitud de cancelación fue aceptada.' }
    case 'cancellation_rejected':
    case 'cancel_rejected':
      return { title: 'Cancelación rechazada', body: 'La solicitud de cancelación fue rechazada y el viaje continúa activo.' }
    case 'location_sharing':
      return { title: 'Actualización de ubicación', body: 'El transportista dejó de compartir. Se conserva el último punto registrado.' }
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
  if (permission === AuthorizationStatus.DENIED) {
    if (__DEV__) console.warn('[push] Permiso de notificaciones denegado')
    return
  }
  const resolvedToken = pushToken || await getToken(firebaseMessaging)
  if (!resolvedToken) throw new Error('Firebase no devolvió un token de notificaciones.')
  await AsyncStorage.setItem('trego.pendingPushToken', resolvedToken)
  await registerDevice(authToken, resolvedToken, Platform.OS === 'ios' ? 'ios' : 'android', getLocale())
  if (__DEV__) console.log('[push] Token registrado en Trego', { platform: Platform.OS, authorizationStatus: permission })
}

async function showForegroundPush(remoteMessage: { notification?: { title?: string; body?: string }; data?: Record<string, string> }) {
  const title = remoteMessage.notification?.title || 'Actualización de Trego'
  const body = remoteMessage.notification?.body || 'Tenés una nueva actualización.'
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: remoteMessage.data || {}, sound: 'default' },
    trigger: null,
  })
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
function sharedLocationCopy(origin: string, destination: string) {
  const split = (value: string) => value.split(',').map(part => part.trim()).filter(Boolean)
  const normalized = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const isPostalCode = (value: string) => /^\w?\d{4,}$/.test(value.replace(/\s/g, ''))
  const originParts = split(origin)
  const destinationParts = split(destination)
  const originComparable = originParts.filter(part => !isPostalCode(part))
  const destinationComparable = destinationParts.filter(part => !isPostalCode(part))
  let sharedCount = 0
  while (sharedCount < originComparable.length && sharedCount < destinationComparable.length && normalized(originComparable[originComparable.length - 1 - sharedCount]) === normalized(destinationComparable[destinationComparable.length - 1 - sharedCount])) sharedCount += 1
  const shared = originComparable.slice(-sharedCount).filter(part => !/^partido\s+de\s+/i.test(part))
  const sharedNormalized = new Set(shared.map(normalized))
  const address = (parts: string[]) => parts.filter(part => !isPostalCode(part) && !sharedNormalized.has(normalized(part))).join(', ')
  return { originAddress: address(originParts), destinationAddress: address(destinationParts), shared: shared.join(' · ') }
}
function TregoModal({ visible, title, message, actionLabel = 'Entendido', onClose, onAction }: { visible: boolean; title: string; message: string; actionLabel?: string; onClose: () => void; onAction?: () => void }) { const [reduceMotion, setReduceMotion] = useState(false); useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined); const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion); return () => subscription.remove() }, []); return <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.tregoModal}><View style={styles.modalIcon}><Text style={styles.modalIconText}>✓</Text></View><Text style={styles.modalTitle}>{title}</Text><Text style={styles.modalMessage}>{message}</Text><Button label={actionLabel} onPress={() => { onClose(); onAction?.() }} /></View></View></Modal> }
function IncomingDeliveryRequest({ data, token, onClose }: { data: NotificationData; token: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [proposalPrice, setProposalPrice] = useState('')
  const [commissionQuote, setCommissionQuote] = useState<CommissionQuote | null>(null)
  const [proposalModalVisible, setProposalModalVisible] = useState(false)
  const value = (key: string) => typeof data[key] === 'string' ? String(data[key]) : ''
  async function submitDelivery(offeredPrice: number, commissionConsentToken?: string | null) {
    const cargoId = value('cargoId')
    if (!cargoId || busy) return
    if (!commissionConsentToken) { setError('No pudimos obtener la confirmación del costo de Trego. Volvé a consultar el importe antes de enviar la propuesta.'); return }
    setBusy(true); setError('')
    try {
      await createMatch(token, { cargoId, offeredPrice, ...(commissionConsentToken ? { commissionConsentToken } : {}) })
      onClose()
      Alert.alert('Delivery tomado', 'La propuesta fue enviada. Cuando el cargador la acepte, el viaje aparecerá en tus recorridos.', [{ text: 'Entendido' }])
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo tomar el delivery.'
      setError(message)
      Alert.alert('No se pudo enviar la propuesta', message)
    } finally { setBusy(false) }
  }
  async function prepareDeliveryProposal(offeredPrice: number) {
    const cargoId = value('cargoId')
    if (!cargoId || busy) return
    setBusy(true); setError('')
    try {
      const quote = await getCommissionQuote(token, cargoId, offeredPrice)
      if (!quote.enabled || !quote.token) { setError('No pudimos obtener la confirmación del costo de Trego. Volvé a consultar el importe antes de enviar la propuesta.'); return }
      setCommissionQuote(quote)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No pudimos calcular la comisión.'
      setError(message)
      Alert.alert('No se pudo preparar la propuesta', message)
    } finally { setBusy(false) }
  }
  const weight = value('weight')
  const weightUnit = value('weightUnit') === 'TONNES' ? 'tn' : value('weightUnit') === 'M3' ? 'm³' : 'kg'
  const packages = value('packages')
  const price = value('offeredPrice')
  const location = sharedLocationCopy(value('origin'), value('destination'))
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.incomingBackdrop}><View style={styles.incomingDelivery}>
      <View style={styles.incomingHeader}><View><Text style={styles.incomingEyebrow}>NUEVO PEDIDO</Text><Text style={styles.incomingTitle}>Delivery disponible</Text></View><Text style={styles.incomingIcon}>🚚</Text></View>
      <View style={styles.incomingRoute}><View style={styles.incomingPoint}><Text style={styles.incomingLabel}>RETIRO</Text><Text style={styles.incomingAddress}>{location.originAddress || 'Dirección de retiro'}</Text></View><Text style={styles.incomingArrow}>→</Text><View style={styles.incomingPoint}><Text style={styles.incomingLabel}>ENTREGA</Text><Text style={styles.incomingAddress}>{location.destinationAddress || 'Dirección de entrega'}</Text></View></View>
      {location.shared ? <Text style={styles.incomingShared}>📍 {location.shared}</Text> : null}
      <View style={styles.incomingFacts}>{weight ? <Text style={styles.incomingFact}>Peso: <Text style={styles.incomingFactStrong}>{weight} {weightUnit}</Text></Text> : null}{packages ? <Text style={styles.incomingFact}>Bultos: <Text style={styles.incomingFactStrong}>{packages}</Text></Text> : null}{value('approximateTime') ? <Text style={styles.incomingFact}>Horario: <Text style={styles.incomingFactStrong}>{value('approximateTime')}</Text></Text> : null}{price ? <Text style={styles.incomingPrice}>${formatNumber(Number(price))}</Text> : null}</View>
      {error ? <Text style={styles.loginError}>{error}</Text> : null}
      <View style={styles.incomingActions}><Pressable disabled={busy} onPress={onClose} style={[styles.incomingReject, busy && styles.incomingDisabled]}><Text style={styles.incomingRejectText}>No tomar</Text></Pressable><Pressable disabled={busy} onPress={() => { setProposalPrice(price); setCommissionQuote(null); setProposalModalVisible(true) }} style={[styles.incomingAccept, busy && styles.incomingDisabled]}><Text style={styles.incomingAcceptText}>{busy ? 'Enviando…' : 'Tomar delivery'}</Text></Pressable></View>
    </View></View>
    <PriceProposalModal visible={proposalModalVisible} value={proposalPrice} onChange={value => { setProposalPrice(value); setCommissionQuote(null) }} onClose={() => { setProposalModalVisible(false); setCommissionQuote(null) }} onSubmit={value => void prepareDeliveryProposal(value)} onConfirm={quote => void submitDelivery(Number(proposalPrice.replace(',', '.')), quote.token)} quote={commissionQuote} busy={busy} />
  </Modal>
}
function LocaleControl() {
  const { locale, setLocale } = useI18n()
  const [open, setOpen] = useState(false)
  return <><Pressable accessibilityLabel="Idioma" onPress={() => setOpen(true)} style={styles.localeButton}><Text style={styles.localeIcon}>🌐</Text></Pressable><Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}><Pressable style={styles.localeBackdrop} onPress={() => setOpen(false)}><Pressable style={styles.localeMenu} onPress={event => event.stopPropagation()}><Text style={styles.localeTitle}>Idioma</Text>{supportedLocales.map(item => <Pressable key={item} onPress={() => { void setLocale(item); setOpen(false) }} style={styles.localeOption}><Text style={styles.localeOptionText}>{localeLabels[item]}</Text>{locale === item ? <Text style={styles.localeCheck}>✓</Text> : null}</Pressable>)}</Pressable></Pressable></Modal></>
}
function Header({ title, onBack, showLocale = false }: { title: string; onBack?: () => void; showLocale?: boolean }) {
  const { locale, setLocale } = useI18n()
  const [open, setOpen] = useState(false)
  return <><View style={styles.header}>{onBack && <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹</Text></Pressable>}<Image source={require('./assets/brand/ios/Icon-1024.png')} style={styles.headerLogo} /><Text style={styles.title}>{title}</Text>{showLocale ? <Pressable accessibilityLabel="Idioma" onPress={() => setOpen(true)} style={styles.localeButton}><Text style={styles.localeIcon}>🌐</Text></Pressable> : null}</View>{showLocale ? <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}><Pressable style={styles.localeBackdrop} onPress={() => setOpen(false)}><Pressable style={styles.localeMenu} onPress={event => event.stopPropagation()}><Text style={styles.localeTitle}>Idioma</Text>{supportedLocales.map(item => <Pressable key={item} onPress={() => { void setLocale(item); setOpen(false) }} style={styles.localeOption}><Text style={styles.localeOptionText}>{localeLabels[item]}</Text>{locale === item ? <Text style={styles.localeCheck}>✓</Text> : null}</Pressable>)}</Pressable></Pressable></Modal> : null}</>
}
function Card({ children, onPress, kind, variant, style }: { children: React.ReactNode; onPress?: () => void; kind?: 'chat'; variant?: 'proposalActive' | 'proposalClosed'; style?: any }) { const Component = onPress ? Pressable : View; return <Component onPress={onPress} style={[styles.card, onPress && styles.tripCard, kind === 'chat' && styles.chatCard, variant === 'proposalActive' && styles.proposalCardActive, variant === 'proposalClosed' && styles.proposalCardClosed, style]}>{children}</Component> }
function SkeletonCard({ lines = 3 }: { lines?: number }) { const label = lines === 5 ? 'Cargando recorridos…' : lines === 4 ? 'Cargando propuestas…' : lines === 3 ? 'Cargando información…' : 'Cargando…'; return <ScreenLoadingOverlay label={label} /> }
function LinearLoadingBar() { const progress = useRef(new Animated.Value(0)).current; useEffect(() => { const animation = Animated.loop(Animated.timing(progress, { toValue: 1, duration: 900, useNativeDriver: true })); animation.start(); return () => animation.stop() }, [progress]); const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-82, 190] }); return <View style={styles.loadingBarTrack}><Animated.View style={[styles.loadingBarIndicator, { transform: [{ translateX }] }]} /></View> }
function ScreenLoadingOverlay({ label = 'Cargando…' }: { label?: string }) { return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => undefined}><View style={styles.fullLoadingBackdrop}><View style={styles.screenLoadingSurface}><Image source={require('./assets/brand/ios/Icon-1024.png')} style={styles.screenLoadingLogo} /><LinearLoadingBar /><Text style={styles.screenLoadingText}>{label}</Text></View></View></Modal> }
function TransporterAvailability({ token }: { token: string }) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { let mounted = true; getTransporterAvailability(token).then(result => { if (mounted) setAvailable(result.available) }).catch(cause => { if (mounted) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la disponibilidad.') }); return () => { mounted = false } }, [token])
  async function toggle() {
    if (available == null || busy) return
    setBusy(true); setError('')
    try { const result = await setTransporterAvailability(token, !available); setAvailable(result.available) } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la disponibilidad.') } finally { setBusy(false) }
  }
  return <View style={styles.availabilityWrap}><View style={styles.availabilityControl} accessibilityRole="summary"><View style={[styles.availabilityDot, available === true && styles.availabilityDotOn]} /><Text style={styles.availabilityText}>{available == null ? 'Disponibilidad' : available ? 'Estoy disponible' : 'No molestar'}</Text>{busy ? <ActivityIndicator size="small" color="#168F83" style={styles.availabilitySpinner} /> : null}<Pressable accessibilityRole="switch" accessibilityState={{ checked: available === true, disabled: busy || available == null }} disabled={busy || available == null} onPress={() => void toggle()} style={[styles.availabilitySwitch, available === true && styles.availabilitySwitchOn, (busy || available == null) && styles.availabilityDisabled]}><View style={[styles.availabilityThumb, available === true && styles.availabilityThumbOn]} /></Pressable></View>{error ? <Text style={styles.availabilityError}>{error}</Text> : null}</View>
}
function Cancellations({ go, token, refreshKey = 0 }: { go: (screen: Screen) => void; token: string; refreshKey?: number }) {
  const [cases, setCases] = useState<CancellationCase[]>([])
  const [userId, setUserId] = useState('')
  const [restricted, setRestricted] = useState(false)
  const [tab, setTab] = useState<'pending' | 'cancelled'>('pending')
  const [details, setDetails] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  async function load() { try { const result = await getCancellationCases(token); setCases(result.cases); setUserId(result.userId); setRestricted(result.restricted); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las cancelaciones.') } finally { setLoading(false) } }
  useEffect(() => { void load() }, [token, refreshKey])
  async function act(item: CancellationCase, action: 'accept' | 'reject' | 'withdraw') { const detail = details[item.id]?.trim() || (action === 'accept' ? 'Acepto la cancelación.' : ''); if (action === 'reject' && detail.length < 10) { setError('Explicá el rechazo con al menos 10 caracteres.'); return } setBusy(item.id); setError(''); try { await mutateCancellation(token, { cargoId: item.cargoId, caseId: item.id, action, detail }); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la cancelación.') } finally { setBusy(null) } }
  const cancelledStatuses = ['DIRECT', 'AGREED', 'UNILATERAL']
  const visible = cases.filter(item => tab === 'cancelled' ? cancelledStatuses.includes(item.status) : !cancelledStatuses.includes(item.status))
  return <ScrollView contentContainerStyle={styles.content}><Header title="Cancelaciones" onBack={() => go('home')} /><Text style={styles.lead}>Las cancelaciones requieren una decisión explícita. El silencio no acepta una solicitud.</Text>{restricted ? <Text style={styles.loginError}>Tu cuenta tiene una restricción por cancelación sin acuerdo.</Text> : null}<View style={styles.segmentedControl}><Pressable onPress={() => setTab('pending')} style={[styles.segmentButton, tab === 'pending' && styles.segmentButtonActive]}><Text style={[styles.segmentButtonText, tab === 'pending' && styles.segmentButtonTextActive]}>Pendientes</Text></Pressable><Pressable onPress={() => setTab('cancelled')} style={[styles.segmentButton, tab === 'cancelled' && styles.segmentButtonActive]}><Text style={styles.segmentButtonText}>Canceladas</Text></Pressable></View>{error ? <Text style={styles.loginError}>{error}</Text> : null}{loading ? <ScreenLoadingOverlay label="Cargando cancelaciones…" /> : visible.length === 0 ? <Card><Text style={styles.mutedText}>{tab === 'pending' ? 'No hay solicitudes pendientes.' : 'No hay cargas canceladas.'}</Text></Card> : visible.map(item => { const mine = item.transporterId !== userId; const canRespond = item.status === 'PENDING' && item.transporterId === userId; const canWithdraw = item.status === 'PENDING' && item.shipperId === userId; return <Card key={item.id} variant={tab === 'cancelled' ? 'proposalClosed' : 'proposalActive'}><Text style={styles.label}>{item.status === 'PENDING' ? 'SOLICITUD PENDIENTE' : item.status === 'REJECTED' ? 'SOLICITUD RECHAZADA' : item.status}</Text><Text style={styles.cardTitle}>{item.cargo.origin} → {item.cargo.destination}</Text><Text style={styles.mutedText}>Motivo: {item.reason}</Text>{item.response ? <Text style={styles.mutedText}>Respuesta: {item.response}</Text> : null}{canRespond ? <><TextInput value={details[item.id] || ''} onChangeText={value => setDetails(current => ({ ...current, [item.id]: value }))} style={styles.input} placeholder="Comentario opcional o motivo del rechazo" multiline /><View style={{ flexDirection: 'row', gap: 8 }}><Button label={busy === item.id ? 'Guardando…' : 'Aceptar cancelación'} onPress={() => void act(item, 'accept')} /><Button label="Rechazar" light onPress={() => void act(item, 'reject')} /></View></> : null}{canWithdraw ? <Button label="Retirar solicitud" light onPress={() => void act(item, 'withdraw')} /> : null}<Text style={styles.detailSectionTitle}>Historial</Text>{item.events.map(event => <Text key={event.id} style={styles.mutedText}>{event.action}: {event.detail}</Text>)}{mine && item.status === 'UNILATERAL' ? <Text style={styles.loginError}>La cancelación fue unilateral y puede generar una restricción.</Text> : null}</Card>})}</ScrollView>
}
function HomeLegacy({ go, user }: { go: (screen: Screen) => void; user: MobileUser }) { const firstName = user.name.split(' ')[0] || 'Federico'; return <ScrollView style={{ backgroundColor: '#F5F8FA' }} contentContainerStyle={[styles.content, { paddingTop: 22, paddingBottom: 132 }]}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}><View style={styles.brandRow}><Image source={require('./assets/brand/ios/Icon-1024.png')} style={styles.brandLogo} /><Text style={styles.brand}>trego<Text style={styles.brandDot}>.</Text></Text></View><View style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 3, borderColor: '#18C968', alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F7EF' }}><Text style={{ color: '#173B59', fontSize: 20, fontWeight: '900' }}>{firstName.charAt(0).toUpperCase()}</Text></View></View><Text style={{ color: '#173B59', fontSize: 34, lineHeight: 40, fontWeight: '900', marginBottom: 20 }}>Hola, {firstName}</Text><Card><Text style={styles.eyebrow}>TU VIAJE ACTUAL</Text><Text style={styles.cardTitle}>Buenos Aires, BA → Rosario, SF</Text></Card></ScrollView> }

function TransporterProfile({ go, token }: { go: (screen: Screen) => void; token: string }) {
  const [profile, setProfile] = useState<TransporterProfileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    AsyncStorage.getItem('trego.profileUserId').then(userId => getTransporterProfile(token, userId || undefined)).then(setProfile).catch(cause => setError(cause instanceof Error ? cause.message : 'No se pudo cargar el perfil.')).finally(() => setLoading(false))
  }, [token])
  const user = profile?.user
  return <ScrollView contentContainerStyle={styles.content}><Header title="Perfil del transportista" onBack={() => go('matches')} />{loading ? <><SkeletonCard lines={4} /><SkeletonCard lines={3} /></> : error ? <Text style={styles.loginError}>{error}</Text> : user ? <><Card><Text style={styles.cardTitle}>{user.name}</Text><Text style={styles.mutedText}>{user.profileBio || 'Transportista asignado a tu viaje.'}</Text>{user.vehicles?.[0] ? <Text style={styles.mutedText}>Vehículo: {user.vehicles[0].type} · {user.vehicles[0].brand} {user.vehicles[0].model}</Text> : null}{profile?.averageRating != null ? <Text style={styles.score}>{'★'.repeat(Math.round(profile.averageRating))}{'☆'.repeat(Math.max(0, 5 - Math.round(profile.averageRating)))} · {profile.averageRating.toFixed(1)} ({profile.reviewsCount})</Text> : <Text style={styles.mutedText}>Sin calificación</Text>}</Card><Text style={styles.detailSectionTitle}>Reseñas</Text>{profile?.reviews.length ? profile.reviews.map((review, index) => <Card key={`${review.createdAt}-${index}`}><Text style={styles.score}>{'★'.repeat(review.rating)}{'☆'.repeat(Math.max(0, 5 - review.rating))}</Text>{review.comment ? <Text style={styles.mutedText}>{review.comment}</Text> : null}{review.highlights.length > 0 ? <Text style={styles.mutedText}>Aspectos destacados: {review.highlights.join(', ')}</Text> : null}<Text style={styles.mutedText}>{formatDate(review.createdAt)}</Text></Card>) : <Card><Text style={styles.mutedText}>Sin calificación</Text></Card>}</> : null}</ScrollView>
}

function ReviewSummary({ review, onOpen }: { review?: DeliveryReview | null; onOpen: () => void }) {
  if (!review) return <Text style={styles.mutedText}>Sin calificación</Text>
  return <View><Text style={styles.score}>{'★'.repeat(review.rating)}{'☆'.repeat(Math.max(0, 5 - review.rating))} · {review.rating.toFixed(1)}</Text><Button label="Ver reseña" light onPress={onOpen} /></View>
}

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
  return <ScrollView style={{ backgroundColor: '#F5F8FA' }} contentContainerStyle={[styles.content, { paddingTop: 22, paddingBottom: 132 }]}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}><View style={styles.brandRow}><Image source={require('./assets/brand/ios/Icon-1024.png')} style={styles.brandLogo} /><Text style={styles.brand}>trego<Text style={styles.brandDot}>.</Text></Text></View><View style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 3, borderColor: '#18C968', alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F7EF' }}><Text style={{ color: '#173B59', fontSize: 20, fontWeight: '900' }}>{firstName.charAt(0).toUpperCase()}</Text></View></View><Text style={{ color: '#173B59', fontSize: 34, lineHeight: 40, fontWeight: '900', marginBottom: 20 }}>Hola, {firstName}</Text>{isTransporter && <Card><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}><Text style={styles.eyebrow}>TU VIAJE ACTUAL</Text>{trip && <View style={{ backgroundColor: trip.status === 'COMPLETED' ? '#DDF7E8' : '#FFF0D9', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 9 }}><Text style={{ color: trip.status === 'COMPLETED' ? '#118443' : '#9A5B00', fontSize: 14, fontWeight: '900' }}>● {tripStatus}</Text></View>}</View>{trip ? <><View style={{ flexDirection: 'row', gap: 14 }}><View style={{ alignItems: 'center', paddingTop: 5 }}><Text style={{ color: '#18C968', fontSize: 28, lineHeight: 28 }}>●</Text><View style={{ width: 3, height: 40, backgroundColor: '#B7C7D1' }} /><Text style={{ color: trip.status === 'COMPLETED' ? '#18C968' : '#AABBC5', fontSize: 28, lineHeight: 28 }}>●</Text></View><View style={{ flex: 1, gap: 18 }}><View><Text style={styles.cardTitle}>{trip.origin}</Text><Text style={styles.mutedText}>{trip.status === 'MATCHED' ? 'Match confirmado' : 'Salida programada'}</Text></View><View><Text style={styles.cardTitle}>{trip.destination}</Text><Text style={styles.mutedText}>{trip.status === 'COMPLETED' ? 'Viaje cerrado' : 'Entrega estimada'}</Text></View></View></View><View style={{ borderTopWidth: 1, borderTopColor: '#DDE7EC', marginTop: 18, paddingTop: 14, flexDirection: 'row', justifyContent: 'space-between' }}><View><Text style={styles.label}>CAPACIDAD</Text><Text style={styles.cardTitle}>{trip.availableCapacity} {trip.capacityUnit === 'TONNES' ? 'tn' : trip.capacityUnit === 'M3' ? 'm³' : 'kg'}</Text></View><View><Text style={styles.label}>VEHÍCULO</Text><Text style={styles.cardTitle}>{trip.vehicle?.model || '—'}</Text></View><View><Text style={styles.label}>ESTADO</Text><Text style={styles.cardTitle}>{tripStatus}</Text></View></View><Pressable disabled={actionDisabled} onPress={() => void advanceTrip()} style={[styles.arrivalButton, actionDisabled && styles.arrivalButtonDisabled]}><Text style={styles.arrivalButtonText}>{arrivalBusy ? 'ACTUALIZANDO…' : actionLabel}</Text></Pressable></> : <Text style={styles.mutedText}>No tenés un viaje activo.</Text>}</Card>}{error ? <Text style={styles.loginError}>{error}</Text> : null}<View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 2 }}><Text style={styles.eyebrow}>{isTransporter ? 'CARGAS DISPONIBLES' : 'TUS CARGAS PUBLICADAS'}</Text><Pressable onPress={() => go('matches')}><Text style={{ color: '#18B95D', fontWeight: '900', fontSize: 16 }}>Ver todas ›</Text></Pressable></View>{cargos.length === 0 ? <Card><Text style={styles.mutedText}>{isTransporter ? 'No hay cargas abiertas disponibles.' : 'Todavía no publicaste cargas activas.'}</Text></Card> : <Card>{cargos.slice(0, 3).map((cargo, index) => <View key={cargo.id} style={{ paddingVertical: 10, borderBottomWidth: index < Math.min(cargos.length, 3) - 1 ? 1 : 0, borderBottomColor: '#DDE7EC' }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: '#F0F5F7', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 24 }}>□</Text></View><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{cargo.origin} → {cargo.destination}</Text><Text style={styles.mutedText}>{cargo.weight ?? '—'} {cargo.weightUnit === 'TONNES' ? 'tn' : cargo.weightUnit === 'M3' ? 'm³' : 'kg'} · {cargo.cargoType}</Text></View>{cargo.offeredPrice != null && <Text style={{ color: '#118443', backgroundColor: '#DDF7E8', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, fontWeight: '900' }}>${formatNumber(cargo.offeredPrice)}</Text>}</View>{!isTransporter && cargo.status === 'OPEN' && <Pressable disabled={cargoBusy === cargo.id} onPress={() => void archive(cargo.id)} style={{ alignSelf: 'flex-end', marginTop: 8, paddingVertical: 6, paddingHorizontal: 10 }}><Text style={{ color: '#B42318', fontWeight: '800', fontSize: 12 }}>{cargoBusy === cargo.id ? 'Dando de baja…' : 'Dar de baja'}</Text></Pressable>}</View>)}</Card>}<Pressable onPress={() => go('matches')} style={{ backgroundColor: '#18C968', borderRadius: 34, paddingHorizontal: 22, paddingVertical: 22, flexDirection: 'row', alignItems: 'center', gap: 16, shadowColor: '#18C968', shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 5 }}><Text style={{ color: '#fff', fontSize: 38 }}>▣</Text><View style={{ flex: 1 }}><Text style={{ color: '#fff', fontSize: 26, fontWeight: '900' }}>{isTransporter ? 'Ver cargas disponibles' : 'Ver mis cargas'}</Text><Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{cargos.length} cargas reales</Text></View><Text style={{ color: '#fff', fontSize: 44 }}>›</Text></Pressable></ScrollView>
}
function Publish({ go, token }: { go: (screen: Screen) => void; token: string }) { const [origin, setOrigin] = useState('Bolívar'); const [destination, setDestination] = useState('Cañuelas'); const [weight, setWeight] = useState('3.2'); const [description, setDescription] = useState(''); const [saving, setSaving] = useState(false); async function submit() { setSaving(true); try { await createCargo(token, { origin, destination, weight: Number(weight.replace(',', '.')), description, date: new Date().toISOString(), cargoType: 'Carga general' }); Alert.alert('Carga publicada', 'La carga fue enviada y se notificó a los transportistas compatibles.'); go('matches') } catch (cause) { Alert.alert('No se pudo publicar', cause instanceof Error ? cause.message : 'Revisá los datos e intentá nuevamente.') } finally { setSaving(false) } } return <ScrollView contentContainerStyle={styles.content}><Header title="Mové tu carga" onBack={() => go('home')} /><Text style={styles.lead}>Publicá los detalles y recibí propuestas compatibles.</Text><Text style={styles.label}>Origen</Text><TextInput value={origin} onChangeText={setOrigin} style={styles.input} /><Text style={styles.label}>Destino</Text><TextInput value={destination} onChangeText={setDestination} style={styles.input} /><Text style={styles.label}>Peso en toneladas</Text><TextInput value={weight} onChangeText={setWeight} keyboardType="decimal-pad" style={styles.input} /><Text style={styles.label}>Descripción</Text><TextInput value={description} onChangeText={setDescription} style={[styles.input, styles.textarea]} multiline placeholder="Mercadería lista para cargar" /><Button label={saving ? 'Publicando…' : 'Publicar carga'} onPress={submit} /></ScrollView> }
const routeStyles = StyleSheet.create({ cargoId: { color: '#087C70', backgroundColor: '#DDF7EC', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, fontWeight: '900' }, routeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#18B95D' }, routeDotDestination: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#173B59' }, routeLine: { width: 2, height: 20, backgroundColor: '#B7CBD8' }, routeLabel: { color: '#8BA0AC', fontSize: 10, fontWeight: '800', letterSpacing: 1 }, routeAddress: { color: '#173B59', fontSize: 17, lineHeight: 22, fontWeight: '800' }, routeShared: { color: '#087C70', fontSize: 18, lineHeight: 23, fontWeight: '900', marginTop: 8 } })
function RouteSummary({ id, origin, destination }: { id?: string; origin?: string; destination?: string }) {
  const location = sharedLocationCopy(origin || '', destination || '')
  return <View style={{ marginVertical: 8, gap: 7 }}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><Text style={styles.label}>CARGA</Text>{id ? <Text style={routeStyles.cargoId}>#${id.slice(-8).toUpperCase()}</Text> : null}</View><View style={{ gap: 0 }}><View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}><View style={{ width: 10, alignItems: 'center', paddingTop: 4 }}><View style={routeStyles.routeDot} /></View><View style={{ flex: 1 }}><Text style={routeStyles.routeLabel}>ORIGEN</Text><Text style={routeStyles.routeAddress}>{location.originAddress || origin || 'Origen'}</Text></View></View><View style={{ flexDirection: 'row', gap: 10, height: 20 }}><View style={{ width: 10, alignItems: 'center' }}><View style={routeStyles.routeLine} /></View><View style={{ flex: 1 }} /></View><View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}><View style={{ width: 10, alignItems: 'center', paddingTop: 4 }}><View style={routeStyles.routeDotDestination} /></View><View style={{ flex: 1 }}><Text style={routeStyles.routeLabel}>DESTINO</Text><Text style={routeStyles.routeAddress}>{location.destinationAddress || destination || 'Destino'}</Text></View></View>{location.shared ? <Text style={routeStyles.routeShared}>📍 {location.shared}</Text> : null}</View></View>
}
function DeliveryRoutePanel({ origin, destination }: { origin: string; destination: string }) {
  const split = (value: string) => { const parts = value.split(',').map(part => part.trim()).filter(Boolean); return { address: parts[0] || 'Dirección no especificada', place: parts.slice(1).join(', ') || 'Ubicación no especificada' } }
  const from = split(origin)
  const to = split(destination)
  return <View style={styles.deliveryRoutePanel}><View style={styles.deliveryRouteRail}><View style={styles.deliveryRouteCircle} /><View style={styles.deliveryRouteLine} /><View style={[styles.deliveryRouteCircle, styles.deliveryRoutePin]} /></View><View style={styles.deliveryRouteStops}><View style={styles.deliveryRouteStop}><Text style={styles.deliveryRouteLabel}>RETIRO</Text><Text style={styles.deliveryRouteAddress}>{from.address}</Text><Text style={styles.deliveryRoutePlace}>{from.place}</Text></View><View style={styles.deliveryRouteStop}><Text style={styles.deliveryRouteLabel}>ENTREGA</Text><Text style={styles.deliveryRouteAddress}>{to.address}</Text><Text style={styles.deliveryRoutePlace}>{to.place}</Text></View></View></View>
}
function DeliveryFact({ icon, value }: { icon: string; value: string }) { return <View style={styles.deliveryFact}><Text style={styles.deliveryFactIcon}>{icon}</Text><Text style={styles.deliveryFactValue}>{value}</Text></View> }
function PriceProposalModal({ visible, value, onChange, onClose, onSubmit, onConfirm, quote, busy, externalError }: { visible: boolean; value: string; onChange: (value: string) => void; onClose: () => void; onSubmit: (value: number) => void; onConfirm: (quote: CommissionQuote) => void; quote: CommissionQuote | null; busy: boolean; externalError?: string | null }) {
  const [error, setError] = useState('')
  const submit = () => {
    const normalized = value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value.replace(/[^0-9.]/g, '')
    const amount = Number(normalized)
    if (!Number.isFinite(amount) || amount <= 0) { setError('Ingresá un precio mayor a cero.'); return }
    if (amount > 20000000) { setError('El precio no puede superar $20.000.000.'); return }
    setError('')
    onSubmit(amount)
  }
  const money = (cents: number) => `$${formatNumber(cents / 100)}`
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.tregoModal}><Text style={styles.modalTitle}>{quote?.enabled ? 'Revisá tu propuesta' : 'Hacé tu propuesta'}</Text>{quote?.enabled ? <><Text style={styles.modalMessage}>Por una propuesta de {money(Math.round(Number(value.replace(',', '.')) * 100))}, Trego cobra {money(quote.amountCents)}. Tu neto estimado es {money(Math.round(Number(value.replace(',', '.')) * 100) - quote.amountCents)}.</Text>{quote.terms?.dueDays != null ? <Text style={styles.mutedText}>El cargo vence a los {quote.terms.dueDays} días.</Text> : null}{externalError ? <Text style={styles.loginError}>{externalError}</Text> : null}<Button label={busy ? 'Enviando…' : 'Confirmar y enviar propuesta'} onPress={() => onConfirm(quote)} /></> : <><Text style={styles.modalMessage}>Esta carga no tiene un precio acordado. Indicá cuánto querés cobrar para enviarla.</Text><Text style={styles.label}>Precio propuesto</Text><TextInput autoFocus value={value} onChangeText={onChange} keyboardType="decimal-pad" placeholder="$ 0" style={styles.input} />{error || externalError ? <Text style={styles.loginError}>{error || externalError}</Text> : null}<Button label={busy ? 'Consultando…' : 'Continuar'} onPress={submit} /></>}{!quote || !quote.enabled ? null : error ? <Text style={styles.loginError}>{error}</Text> : null}<Button label="Cancelar" light onPress={onClose} /></View></View></Modal>
}
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

function Matches({ go, token, roles, refreshKey = 0, onlyProposals = false, cargoWorkspace = false }: { go: (screen: Screen) => void; token: string; roles: string[]; refreshKey?: number; onlyProposals?: boolean; cargoWorkspace?: boolean }) {
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [priceProposalCargoId, setPriceProposalCargoId] = useState<string | null>(null)
  const [priceProposal, setPriceProposal] = useState('')
  const [commissionQuote, setCommissionQuote] = useState<CommissionQuote | null>(null)
  useEffect(() => { void SecureStore.getItemAsync('trego.mobileUser').then(value => { if (value) setCurrentUserId((JSON.parse(value) as MobileUser).id) }).catch(() => undefined) }, [])
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
  async function proposeCargo(cargoId: string, offeredPrice?: number, commissionConsentToken?: string | null) { setBusy(cargoId); setError(null); if (!commissionConsentToken) { setError('No pudimos obtener la confirmación del costo de Trego. Volvé a consultar el importe antes de enviar la propuesta.'); setBusy(null); return } try { const result = await createMatch(token, { cargoId, tripId: activeTripId, ...(offeredPrice === undefined ? {} : { offeredPrice }), commissionConsentToken }); setProposals(current => current.some(match => match.id === result.match.id) ? current : [result.match, ...current]); setProposedCargoIds(current => new Set(current).add(cargoId)); setPriceProposalCargoId(null); setPriceProposal(''); setCommissionQuote(null); Alert.alert('Propuesta enviada', activeTripId ? 'La propuesta quedó asociada a tu viaje y el usuario recibió una notificación.' : 'La propuesta quedó pendiente de aceptación del usuario que publicó la carga.') } catch (cause) { const message = cause instanceof Error ? cause.message : 'No se pudo proponer la carga.'; setError(message); Alert.alert('No se pudo enviar la propuesta', message) } finally { setBusy(null) } }
  async function prepareCargoProposal(cargoId: string, offeredPrice: number) { setBusy(cargoId); setError(null); try { const quote = await getCommissionQuote(token, cargoId, offeredPrice); if (!quote.enabled || !quote.token) { setError('No pudimos obtener la confirmación del costo de Trego. Volvé a consultar el importe antes de enviar la propuesta.'); return } setCommissionQuote(quote) } catch (cause) { const message = cause instanceof Error ? cause.message : 'No pudimos calcular la comisión.'; setError(message); Alert.alert('No se pudo preparar la propuesta', message) } finally { setBusy(null) } }
  function requestCargoProposal(cargo: AvailableCargo) { setPriceProposalCargoId(cargo.id); setPriceProposal(cargo.offeredPrice != null && cargo.offeredPrice > 0 ? String(cargo.offeredPrice) : ''); setCommissionQuote(null) }
  async function acceptProposal(matchId: string) { setBusy(matchId); setError(null); try { const result = await acceptMatch(token, matchId); await AsyncStorage.setItem('trego.activeMatchId', matchId); setProposals(current => current.map(match => match.id === matchId ? { ...match, status: 'ACCEPTED' } : match)); const push = result.notification?.push; const message = push && push.sent === 0 ? 'El match quedó confirmado, pero el transportista no tiene un dispositivo push registrado o Firebase rechazó el envío.' : 'El transportista recibió una notificación.'; Alert.alert('Match confirmado', message, [{ text: 'Ver chat', onPress: () => go('chat') }]) } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo aceptar la propuesta.') } finally { setBusy(null) } }
  async function openChat(matchId: string, tripId?: string | null) { const resolvedTripId = tripId || proposals.find(match => match.id === matchId)?.tripId; if (!resolvedTripId) { Alert.alert('Chat no disponible', 'El chat se habilita cuando el match está aceptado y tiene un viaje asignado.'); return } await AsyncStorage.setItem('trego.activeMatchId', matchId); await AsyncStorage.setItem('trego.activeTripId', resolvedTripId); go('chat') }
  async function openTripDetail(tripId?: string | null) { if (!tripId) return; await AsyncStorage.setItem('trego.activeTripId', tripId); go('trips') }
  async function openTransporterProfile(transporterId?: string) { if (!transporterId) return; await AsyncStorage.setItem('trego.profileUserId', transporterId); go('transporter-profile') }
  function tripForMatch(match: MatchRecord) { return match.tripId ? trips.find(trip => trip.id === match.tripId) : undefined }
  function actionForTrip(trip?: TripRecord): TripAction | null { return trip?.status === 'MATCHED' ? 'start' : trip?.status === 'IN_PROGRESS' ? 'pickup' : trip?.status === 'ARRIVED' ? 'complete' : null }
  function actionLabelForTrip(trip?: TripRecord) { return trip?.status === 'MATCHED' ? 'Ir a buscar la carga' : trip?.status === 'IN_PROGRESS' ? 'Marcar carga retirada' : trip?.status === 'ARRIVED' ? 'Marcar entregado y cerrar' : trip?.status === 'COMPLETED' ? 'Viaje entregado' : 'Esperando estado del viaje' }
  function proposalForCargo(cargoId: string) { return proposals.find(match => (match.cargo?.id || match.cargoId) === cargoId) }
  async function advanceMatch(match: MatchRecord) { const trip = tripForMatch(match); const action = actionForTrip(trip); if (!trip || !action) return; setBusy(match.id); setError(null); try { const result = await updateTripStatus(token, trip.id, action); setTrips(current => current.map(item => item.id === trip.id ? { ...item, ...result.trip, matches: item.matches } : item)); Alert.alert(action === 'start' ? 'Viaje iniciado' : action === 'pickup' ? 'Carga retirada' : 'Entrega confirmada', result.notification.sent && result.notification.sent > 0 ? 'El cargador recibió una notificación push.' : 'El estado fue actualizado, pero el cargador no tiene un dispositivo web registrado o el push no pudo enviarse.') } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el estado del viaje.') } finally { setBusy(null) } }
  async function openCargoRoute(cargo: AvailableCargo) { const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(cargo.origin)}&travelmode=driving`; try { await Linking.openURL(mapsUrl) } catch { setError('No se pudo abrir el mapa. Verificá que tengas una app de mapas instalada.') } }
  const selectedProposal = selectedProposalId ? proposals.find(match => match.id === selectedProposalId) : null
  if (selectedProposal) { const trip = tripForMatch(selectedProposal); const closed = selectedProposal.status === 'REJECTED' || selectedProposal.status === 'CANCELLED' || trip?.status === 'COMPLETED'; return <ScrollView contentContainerStyle={styles.content}><Header title="Propuesta" onBack={() => setSelectedProposalId(null)} /><Card variant={closed ? 'proposalClosed' : 'proposalActive'}><Text style={styles.label}>PROPUESTA DE CARGA</Text><RouteSummary id={selectedProposal.cargo?.id} origin={selectedProposal.cargo?.origin} destination={selectedProposal.cargo?.destination} /><Text style={closed ? styles.proposalStatusClosed : styles.proposalStatus}>{selectedProposal.status === 'ACCEPTED' ? 'Tomada · match confirmado' : selectedProposal.status === 'REJECTED' ? 'Rechazada' : 'Pendiente de confirmación'}</Text><Text style={styles.mutedText}>{selectedProposal.cargo?.cargoType || 'Carga general'} · {selectedProposal.cargo?.weight ?? '—'} {selectedProposal.cargo?.weightUnit === 'TONNES' ? 'tn' : selectedProposal.cargo?.weightUnit === 'M3' ? 'm³' : 'kg'}</Text>{selectedProposal.cargo?.offeredPrice != null ? <Text style={styles.score}>${formatNumber(selectedProposal.cargo.offeredPrice)}</Text> : null}{(() => { const contact = selectedProposal.shipper?.id === currentUserId ? selectedProposal.transporter : selectedProposal.shipper; return contact ? <Text style={styles.mutedText}>{currentUserId === selectedProposal.transporter?.id ? 'Cargador' : 'Transportista'}: {contact.name}</Text> : null })()}{selectedProposal.shipper?.id === currentUserId && selectedProposal.transporter?.id ? <Button label="Ver perfil del transportista" light onPress={() => void openTransporterProfile(selectedProposal.transporter.id)} /> : null}{trip ? <Button label="Ver detalle del viaje" tone="detail" onPress={() => void openTripDetail(trip.id)} /> : null}{selectedProposal.status === 'ACCEPTED' ? <Button label="Abrir chat" tone="chat" onPress={() => void openChat(selectedProposal.id, trip?.id)} /> : null}</Card></ScrollView> }
  const displayedCargos = viewMode === 'available' ? cargos : []
  const takenByMe = !isTransporter ? proposals.filter(match => match.status === 'ACCEPTED') : []
  const displayedProposals = viewMode === 'proposals' ? (isTransporter ? proposals : proposals.filter(match => match.status !== 'ACCEPTED')) : []
  const renderTakenCargo = (match: MatchRecord) => { const trip = tripForMatch(match); const closed = trip?.status === 'COMPLETED'; return <Card key={`taken-${match.id}`} onPress={() => setSelectedProposalId(match.id)} variant={closed ? 'proposalClosed' : 'proposalActive'}><Text style={styles.label}>TOMADA POR MÍ</Text><RouteSummary id={match.cargo?.id} origin={match.cargo?.origin} destination={match.cargo?.destination} />{match.shipper?.id === currentUserId ? <Text style={styles.mutedText}>Cargador: {match.shipper.name}</Text> : null}<Text style={closed ? styles.proposalStatusClosed : styles.proposalStatus}>Match confirmado</Text><Text style={styles.mutedText}>{trip?.status === 'MATCHED' ? 'Estado: listo para ir a buscar la carga.' : trip?.status === 'IN_PROGRESS' ? 'Estado: en camino al retiro.' : trip?.status === 'ARRIVED' ? 'Estado: carga retirada.' : trip?.status === 'COMPLETED' ? 'Estado: entregada y cerrada.' : 'Estado: viaje asignado.'}</Text>{trip ? <Button label="Ver detalle del viaje" tone="detail" onPress={() => void openTripDetail(trip.id)} /> : null}<Button label="Abrir chat" tone="chat" onPress={() => void openChat(match.id, trip?.id)} /></Card> }
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
    const location = sharedLocationCopy(selectedCargo.origin, selectedCargo.destination)
    const proposal = proposalForCargo(selectedCargo.id)
    const waiting = proposedCargoIds.has(selectedCargo.id) || proposal?.status === 'PROPOSED' || proposal?.status === 'PENDING'
    const rejected = proposal?.status === 'REJECTED'
    return <><ScrollView contentContainerStyle={styles.content}><Header title={isDeliveryCargo(selectedCargo) ? 'Detalle del delivery' : 'Detalle de la carga'} onBack={() => setSelectedCargoId(null)} /><Card style={isDeliveryCargo(selectedCargo) ? styles.deliveryTakeCard : undefined}><View style={styles.deliveryTakeHeader}><View><Text style={styles.label}>{isDeliveryCargo(selectedCargo) ? 'NUEVO DELIVERY' : 'CARGA DISPONIBLE'}</Text><Text style={styles.deliveryTakeTitle}>{isDeliveryCargo(selectedCargo) ? 'Delivery disponible' : 'Carga disponible'}</Text></View><Text style={styles.deliveryTakeIcon}>🚚</Text></View>{isDeliveryCargo(selectedCargo) ? <DeliveryRoutePanel origin={selectedCargo.origin} destination={selectedCargo.destination} /> : <RouteSummary id={selectedCargo.id} origin={selectedCargo.origin} destination={selectedCargo.destination} />}<DistanceToPickup address={selectedCargo.origin} /><View style={styles.deliveryFactsRow}><DeliveryFact icon="📦" value={selectedCargo.packages != null ? `${selectedCargo.packages} bulto${selectedCargo.packages === 1 ? '' : 's'}` : '—'} /><DeliveryFact icon="⌂" value={`${selectedCargo.weight ?? '—'} ${selectedCargo.weightUnit === 'TONNES' ? 'tn' : selectedCargo.weightUnit === 'M3' ? 'm³' : 'kg'}`} /><DeliveryFact icon="◷" value={selectedCargo.approximateTime || '—'} /></View>{location.shared ? <Text style={styles.incomingShared}>📍 {location.shared}</Text> : null}<View style={styles.deliveryInfoGrid}><Text style={styles.mutedText}>Tipo: <Text style={styles.strongText}>{selectedCargo.cargoType || 'Carga general'}</Text></Text>{selectedCargo.date ? <Text style={styles.mutedText}>Fecha: <Text style={styles.strongText}>{formatDate(selectedCargo.date)}</Text></Text> : null}{selectedCargo.offeredPrice != null ? <Text style={styles.mutedText}>Precio ofrecido: <Text style={styles.priceText}>${formatNumber(selectedCargo.offeredPrice)}</Text></Text> : null}</View>{details.recipient ? <Text style={styles.mutedText}>Receptor: <Text style={styles.strongText}>{details.recipient}</Text></Text> : null}{details.phone ? <Text style={styles.mutedText}>Teléfono: <Text style={styles.strongText}>{details.phone}</Text></Text> : null}{details.instructions ? <Text style={styles.mutedText}>Indicaciones: <Text style={styles.strongText}>{details.instructions}</Text></Text> : null}{selectedCargo.description && !details.recipient && !details.phone && !details.instructions ? <Text style={styles.mutedText}>{selectedCargo.description}</Text> : null}<TripActionTile icon="⌖" title="Mostrar ruta al retiro" subtitle="Abrir el mapa y comenzar la navegación" tone="route" onPress={() => void openCargoRoute(selectedCargo)} />{proposal?.status === 'ACCEPTED' ? <Button label="Delivery tomado" tone="accept" onPress={() => go('proposals')} /> : waiting ? <Button label="Esperando confirmación" tone="detail" onPress={() => go('proposals')} /> : rejected ? <Button label="Propuesta rechazada · Proponer nuevamente" tone="stop" onPress={() => requestCargoProposal(selectedCargo)} /> : <Button label={busy === selectedCargo.id ? 'Enviando…' : 'Tomar delivery'} tone="propose" onPress={() => requestCargoProposal(selectedCargo)} />}</Card></ScrollView><PriceProposalModal visible={Boolean(priceProposalCargoId)} value={priceProposal} onChange={value => { setPriceProposal(value); setCommissionQuote(null) }} onClose={() => { setPriceProposalCargoId(null); setPriceProposal(''); setCommissionQuote(null) }} onSubmit={value => { if (priceProposalCargoId) void prepareCargoProposal(priceProposalCargoId, value) }} onConfirm={quote => { if (priceProposalCargoId) void proposeCargo(priceProposalCargoId, Number(priceProposal.replace(',', '.')), quote.token) }} quote={commissionQuote} busy={busy === priceProposalCargoId} /></>
  }
  return <><ScrollView contentContainerStyle={styles.content}><Header title={onlyProposals ? 'Mis propuestas' : cargoWorkspace ? 'Recorrido de mis cargas' : 'Cargas'} onBack={() => go('home')} /><Text style={styles.lead}>{onlyProposals ? 'Revisá tus propuestas y el estado de cada carga.' : cargoWorkspace ? 'Gestioná tus cargas publicadas, sus propuestas y los viajes asignados.' : isTransporter ? 'Explorá cargas y deliveries disponibles para tomar.' : 'Revisá qué transportistas quieren realizar tus cargas y confirmá el match.'}</Text>{!onlyProposals ? <View style={styles.segmentedControl}><Pressable onPress={() => setViewMode('available')} style={[styles.segmentButton, viewMode === 'available' && styles.segmentButtonActive]}><Text style={[styles.segmentButtonText, viewMode === 'available' && styles.segmentButtonTextActive]}>Cargas disponibles</Text></Pressable><Pressable onPress={() => go('proposals')} style={styles.segmentButton}><Text style={styles.segmentButtonText}>Mis propuestas</Text></Pressable></View> : null}{error ? <Text style={styles.loginError}>{error}</Text> : null}{loading ? <ScreenLoadingOverlay label={onlyProposals ? 'Buscando tus propuestas…' : 'Buscando cargas…'} /> : <>{viewMode === 'available' && isTransporter ? displayedCargos.map(cargo => { const delivery = isDeliveryCargo(cargo); const proposal = proposalForCargo(cargo.id); const waiting = proposedCargoIds.has(cargo.id) || proposal?.status === 'PROPOSED' || proposal?.status === 'PENDING'; return <Card key={cargo.id} onPress={delivery ? () => setSelectedCargoId(cargo.id) : undefined} variant="proposalActive"><Text style={styles.label}>{delivery ? '🚚 DELIVERY' : cargo.cargoType || 'CARGA GENERAL'}</Text><RouteSummary id={cargo.id} origin={cargo.origin} destination={cargo.destination} /><Text style={styles.mutedText}>{formatCargoWeight(cargo)}{cargo.offeredPrice != null ? ` · $${formatNumber(cargo.offeredPrice)}` : ''}</Text>{delivery ? <Button label={waiting ? 'Esperando confirmación' : 'Tomar delivery'} tone={waiting ? 'detail' : 'location'} onPress={() => { if (!waiting) requestCargoProposal(cargo) }} /> : <>{proposal?.status === 'ACCEPTED' ? <Button label="Propuesta aceptada" tone="accept" onPress={() => go('proposals')} /> : proposal?.status === 'REJECTED' ? <Button label="Propuesta rechazada · Proponer nuevamente" tone="stop" onPress={() => requestCargoProposal(cargo)} /> : waiting ? <Button label="Esperando confirmación" tone="detail" onPress={() => go('proposals')} /> : <Button label={busy === cargo.id ? 'Enviando…' : 'Proponer tomar carga'} tone="propose" onPress={() => requestCargoProposal(cargo)} />}{proposal ? <Button label="Revisar propuesta" tone="detail" onPress={() => go('proposals')} /> : null}</>}</Card> }) : null}{!isTransporter && viewMode === 'proposals' && takenByMe.length > 0 ? <><Text style={styles.detailSectionTitle}>Tomadas por mí</Text>{takenByMe.map(renderTakenCargo)}</> : null}{viewMode === 'proposals' ? displayedProposals.map(match => { const trip = tripForMatch(match); const contact = match.shipper?.id === currentUserId ? match.transporter : match.shipper; const action = actionForTrip(trip); const closed = match.status === 'REJECTED' || match.status === 'CANCELLED' || trip?.status === 'COMPLETED'; return <Card key={match.id} onPress={() => setSelectedProposalId(match.id)} variant={closed ? 'proposalClosed' : 'proposalActive'}><Text style={styles.label}>{isDeliveryCargo(match.cargo) ? 'PROPUESTA DE DELIVERY' : 'PROPUESTA DE CARGA'}</Text><RouteSummary id={match.cargo?.id} origin={match.cargo?.origin} destination={match.cargo?.destination} />{contact ? <Text style={styles.mutedText}>{currentUserId === match.transporter?.id ? 'Cargador' : 'Transportista'}: {contact.name}</Text> : null}{match.shipper?.id === currentUserId && match.transporter?.id ? <Button label="Ver perfil del transportista" light onPress={() => void openTransporterProfile(match.transporter.id)} /> : null}<Text style={closed ? styles.proposalStatusClosed : styles.proposalStatus}>{proposalStatusLabel(match)}</Text>{match.status === 'ACCEPTED' ? <><Text style={[styles.label, { marginTop: 8 }]}>ESTADO DEL VIAJE</Text><Text style={styles.mutedText}>{trip?.status === 'MATCHED' ? 'Listo para ir a buscar la carga.' : trip?.status === 'IN_PROGRESS' ? 'En camino a buscar la carga.' : trip?.status === 'ARRIVED' ? 'Carga retirada: viaje en curso.' : trip?.status === 'COMPLETED' ? 'Entregado: viaje cerrado.' : 'Match confirmado. Cargando estado del viaje…'}</Text>{action ? <Button label={busy === match.id ? 'Actualizando…' : actionLabelForTrip(trip)} onPress={() => void advanceMatch(match)} /> : null}<Button label="Ver detalle del viaje" tone="detail" onPress={() => void openTripDetail(match.tripId)} /><Button label="Abrir chat" tone="chat" onPress={() => void openChat(match.id)} /></> : null}</Card>}) : null}{viewMode === 'proposals' && displayedProposals.length === 0 ? <Card><Text style={styles.mutedText}>Todavía no enviaste propuestas.</Text></Card> : null}</>}</ScrollView><PriceProposalModal visible={Boolean(priceProposalCargoId)} value={priceProposal} onChange={value => { setPriceProposal(value); setCommissionQuote(null) }} onClose={() => { setPriceProposalCargoId(null); setPriceProposal(''); setCommissionQuote(null) }} onSubmit={value => { if (priceProposalCargoId) void prepareCargoProposal(priceProposalCargoId, value) }} onConfirm={quote => { if (priceProposalCargoId) void proposeCargo(priceProposalCargoId, Number(priceProposal.replace(',', '.')), quote.token) }} quote={commissionQuote} busy={busy === priceProposalCargoId} /></>
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
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [matchReady, setMatchReady] = useState(Boolean(providedMatchId))
  const refreshRunning = useRef(false)
  const refreshPending = useRef(false)
  const chatScroll = useRef<ScrollView>(null)

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardVisible(true))
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardVisible(false))
    return () => { show.remove(); hide.remove() }
  }, [])

  useEffect(() => { Promise.all([AsyncStorage.getItem('trego.activeMatchId'), AsyncStorage.getItem('trego.activeTripId')]).then(([storedMatchId, storedTripId]) => { const resolvedMatchId = providedMatchId || storedMatchId || ''; if (resolvedMatchId) setActiveMatchId(resolvedMatchId); if (storedTripId) setActiveTripId(storedTripId); setMatchReady(true) }) }, [providedMatchId])

  useEffect(() => { if (providedToken) return; SecureStore.getItemAsync('trego.mobileToken').then(savedToken => { if (savedToken) setToken(savedToken) }) }, [providedToken])

  const loadConversation = async (silent = false) => {
    if (!token || !matchReady || !activeMatchId) return
    if (refreshRunning.current) { refreshPending.current = true; return }
    refreshRunning.current = true
    if (!silent) setLoading(true)
    try {
      do {
        refreshPending.current = false
        try {
          const result = await getConversation(token, activeMatchId)
          setCurrentUserId(result.currentUserId)
          setMessages(current => { const merged = new Map(current.map(message => [message.id, message])); result.conversation.messages.forEach(message => merged.set(message.id, message)); return Array.from(merged.values()).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) })
          const otherPerson = result.currentUserId === result.match.shipper.id ? result.match.transporter.name : result.match.shipper.name
          setConversationTitle(otherPerson)
          setCargoId(result.match.cargo.id)
          setRouteLabel(`${result.match.cargo.origin} → ${result.match.cargo.destination}`)
          setError(null)
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar la conversación.') }
      } while (refreshPending.current)
    } finally { refreshRunning.current = false; if (!silent) setLoading(false) }
  }

  useEffect(() => {
    void loadConversation()
    const interval = setInterval(() => { if (AppState.currentState === 'active') void loadConversation(true) }, 5000)
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void loadConversation(true) })
    return () => { clearInterval(interval); subscription.remove() }
  }, [activeMatchId, matchReady, token, refreshKey])

  async function submitMessage() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const result = await sendMessage(token, activeMatchId, body)
      setMessages(current => { if (current.some(message => message.id === result.message.id)) return current; return [...current, result.message] })
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

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}><View style={[styles.chatScreen, { paddingBottom: 12, minHeight: 0 }]}><View style={styles.chatHeader}><Header title={conversationTitle} onBack={() => go('chat')} showLocale={false} />{activeTripId ? <Pressable onPress={() => void openRelatedTrip()} style={styles.chatHeaderAction} accessibilityLabel="Ver detalle del viaje"><Text style={styles.chatHeaderActionText}>Ver carga</Text></Pressable> : null}</View>{loading ? <Text style={styles.mutedText}>Cargando mensajes…</Text> : null}{error ? <Text style={styles.loginError}>{error}</Text> : null}<ScrollView ref={chatScroll} style={{ flex: 1, flexShrink: 1 }} contentContainerStyle={[styles.chatMessages, { paddingBottom: keyboardVisible ? 76 : 130 }]} keyboardShouldPersistTaps="handled" onContentSizeChange={() => chatScroll.current?.scrollToEnd({ animated: false })}><Card><Text style={styles.label}>CHAT DE CARGA</Text><Text style={styles.cardTitle}>Carga #{cargoId ? cargoId.slice(-8).toUpperCase() : '…'}</Text><Text style={styles.mutedText}>{routeLabel}</Text><Text style={styles.mutedText}>{conversationTitle}</Text></Card>{messages.map(message => { const mine = message.senderId === currentUserId; return <View key={message.id} style={[styles.chatBubble, mine ? styles.chatBubbleMine : styles.chatBubbleOther]}><Text style={[styles.chatText, mine && styles.chatTextMine]}>{message.body}</Text><Text style={[styles.mutedText, mine && styles.chatTextMine]}>{formatDateTime(message.createdAt, { hour: '2-digit', minute: '2-digit' })}</Text></View> })}</ScrollView><View style={[styles.chatComposer, { position: 'absolute', left: 22, right: 22, bottom: keyboardVisible ? 12 : 100 }]}><TextInput value={draft} onChangeText={setDraft} onSubmitEditing={submitMessage} placeholder="Escribí un mensaje" returnKeyType="send" style={styles.chatInput} editable={!sending} /><Pressable onPress={submitMessage} style={styles.chatSend}><Text style={styles.chatSendText}>{sending ? '…' : 'Enviar'}</Text></Pressable></View></View></KeyboardAvoidingView>
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
  const accepted = Array.from(new Map(matches.filter(match => match.status === 'ACCEPTED' && Boolean(match.tripId)).map(match => [match.id, match])).values())
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
    if (!match.tripId) return
    await AsyncStorage.setItem('trego.activeMatchId', match.id)
    await AsyncStorage.setItem('trego.activeTripId', match.tripId)
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
  const [priceProposalCargoId, setPriceProposalCargoId] = useState<string | null>(null)
  const [priceProposal, setPriceProposal] = useState('')
  const [commissionQuote, setCommissionQuote] = useState<CommissionQuote | null>(null)
  const [marketplaceSearch, setMarketplaceSearch] = useState('')
  const searchScroll = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Promise.all([getAvailableCargos(token), isTransporter ? getTrips(token) : Promise.resolve({ trips: [] as TripRecord[] }), isTransporter ? getMatches(token) : Promise.resolve({ matches: [] as MatchRecord[] })]).then(([cargoResult, tripResult, matchResult]) => {
      setCargos(cargoResult.cargos)
      setAvailableTripId(tripResult.trips.find(trip => trip.status === 'AVAILABLE')?.id)
      const matches = Array.isArray(matchResult) ? matchResult : matchResult.matches ?? []
      setProposedCargoIds(new Set(matches.filter(match => !['REJECTED', 'DECLINED'].includes(match.status)).map(match => match.cargo?.id || match.cargoId)))
      setRejectedCargoIds(new Set(matches.filter(match => ['REJECTED', 'DECLINED'].includes(match.status)).map(match => match.cargo?.id || match.cargoId)))
  }).catch(cause => setError(cause instanceof Error ? cause.message : 'No se pudo cargar el marketplace.')).finally(() => setLoading(false))
  }, [isTransporter, token, refreshKey])

  async function propose(cargoId: string, offeredPrice?: number, commissionConsentToken?: string | null) {
    setBusy(cargoId); setError('')
    if (!commissionConsentToken) { setError('No pudimos obtener la confirmación del costo de Trego. Volvé a consultar el importe antes de enviar la propuesta.'); setBusy(null); return }
    try {
      await createMatch(token, { cargoId, tripId: availableTripId, ...(offeredPrice === undefined ? {} : { offeredPrice }), ...(commissionConsentToken ? { commissionConsentToken } : {}) })
      setRejectedCargoIds(current => { const next = new Set(current); next.delete(cargoId); return next })
      setProposedCargoIds(current => new Set(current).add(cargoId))
      setPriceProposalCargoId(null); setPriceProposal(''); setCommissionQuote(null)
      setModal({ title: 'Postulación enviada', message: 'La persona que publicó la carga recibió una notificación y debe aceptar tu propuesta.' })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo enviar la postulación.'
      setError(message)
      Alert.alert('No se pudo enviar la propuesta', message)
    } finally { setBusy(null) }
  }
  async function prepareHomeProposal(cargoId: string, offeredPrice: number) { setBusy(cargoId); setError(''); try { const quote = await getCommissionQuote(token, cargoId, offeredPrice); if (!quote.enabled || !quote.token) { setError('No pudimos obtener la confirmación del costo de Trego. Volvé a consultar el importe antes de enviar la propuesta.'); return } setCommissionQuote(quote) } catch (cause) { const message = cause instanceof Error ? cause.message : 'No pudimos calcular la comisión.'; setError(message); Alert.alert('No se pudo preparar la propuesta', message) } finally { setBusy(null) } }
  function requestHomeProposal(cargo: AvailableCargo) { setPriceProposalCargoId(cargo.id); setPriceProposal(cargo.offeredPrice != null && cargo.offeredPrice > 0 ? String(cargo.offeredPrice) : ''); setCommissionQuote(null) }

  const normalizedSearch = marketplaceSearch.trim().toLowerCase()
  const visibleCargos = cargos.filter(cargo => !normalizedSearch || [cargo.id, cargo.description, cargo.origin, cargo.destination, cargo.cargoType].filter(Boolean).join(' ').toLowerCase().includes(normalizedSearch))
  return <>
    <Animated.ScrollView contentContainerStyle={[styles.content, styles.homeContent]} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: searchScroll } } }], { useNativeDriver: false })} scrollEventThrottle={16}>
      <View style={styles.homeTopBar}>
        <View style={styles.homeTitleRow}><Text style={styles.homeBrand}>Trego</Text></View>
        <View style={styles.homeActions}><LocaleControl /><Pressable onPress={() => go('notifications')} style={styles.homeBell} accessibilityLabel="Abrir notificaciones"><Text style={styles.homeBellText}>🔔</Text></Pressable><Pressable onPress={() => go('profile')} style={styles.homeAvatar} accessibilityLabel="Abrir perfil"><Text style={styles.homeAvatarText}>{firstName.charAt(0).toUpperCase()}</Text></Pressable></View>
      </View>
      {!isTransporter ? <View style={styles.homeActionStack}><Button label="＋  Publicar carga" onPress={() => go('publish')} /></View> : null}
      <Text style={styles.eyebrow}>MARKETPLACE TREGO</Text>
      <Text style={styles.hero}>Cargas de la comunidad</Text>
      <Text style={styles.lead}>{isTransporter ? 'Explorá cargas abiertas y postuláte para llevarlas.' : 'Publicá una carga y recibí propuestas de transportistas.'}</Text>
      {isTransporter ? <TransporterAvailability token={token} /> : null}
      <Animated.View style={[styles.marketplaceSearchReveal, { opacity: searchScroll.interpolate({ inputRange: [0, 80, 150], outputRange: [0, 0, 1], extrapolate: 'clamp' }), height: searchScroll.interpolate({ inputRange: [0, 80, 150], outputRange: [0, 0, 54], extrapolate: 'clamp' }) }]}><View style={styles.marketplaceSearchRow}><View style={styles.marketplaceSearchBox}><Text style={styles.marketplaceSearchIcon}>⌕</Text><TextInput value={marketplaceSearch} onChangeText={setMarketplaceSearch} placeholder="Buscar carga por ID o descripción" placeholderTextColor="#8BA0AC" style={styles.marketplaceSearchInput} autoCorrect={false} /></View><Pressable accessibilityLabel="Filtrar cargas" style={styles.marketplaceFilter}><Text style={styles.marketplaceFilterIcon}>⌑</Text></Pressable></View></Animated.View>
      {loading ? <><SkeletonCard lines={4} /><SkeletonCard lines={3} /></> : <><View style={styles.availableHeader}><Text style={styles.cardTitle}>Cargas disponibles</Text><Text style={styles.mutedText}>{visibleCargos.length} abiertas</Text></View>{error ? <Text style={styles.loginError}>{error}</Text> : null}{visibleCargos.length === 0 ? <Card><Text style={styles.mutedText}>{normalizedSearch ? 'No encontramos cargas con esa búsqueda.' : isTransporter ? 'No hay cargas abiertas para postularse en este momento.' : 'Todavía no publicaste cargas.'}</Text></Card> : visibleCargos.map(cargo => <Card key={cargo.id} variant="proposalActive"><Text style={styles.label}>{isDeliveryCargo(cargo) ? '🚚 DELIVERY' : cargo.cargoType || 'CARGA GENERAL'}</Text><RouteSummary id={cargo.id} origin={cargo.origin} destination={cargo.destination} /><View style={styles.row}><Text style={styles.mutedText}>Peso</Text><Text style={styles.cardTitle}>{cargo.weight ?? '—'} {cargo.weightUnit === 'TONNES' ? 'tn' : cargo.weightUnit === 'M3' ? 'm³' : 'kg'}</Text></View>{cargo.description ? <Text style={styles.mutedText}>{cargo.description}</Text> : null}{cargo.offeredPrice != null ? <Text style={styles.score}>${formatNumber(cargo.offeredPrice)}</Text> : null}{isTransporter ? rejectedCargoIds.has(cargo.id) ? <Button label="Propuesta rechazada · Proponer nuevamente" tone="stop" onPress={() => requestHomeProposal(cargo)} /> : proposedCargoIds.has(cargo.id) ? <Button label="Esperando confirmación" tone="detail" onPress={() => go('proposals')} /> : <Button label={busy === cargo.id ? 'Enviando…' : cargo.offeredPrice == null || cargo.offeredPrice <= 0 ? 'Hacer propuesta' : 'Postularme para llevarla'} onPress={() => requestHomeProposal(cargo)} /> : <Text style={styles.mutedText}>Esperando propuestas de transportistas</Text>}</Card>)}</>}
    </Animated.ScrollView>
    <TregoModal visible={Boolean(modal)} title={modal?.title || ''} message={modal?.message || ''} onClose={() => setModal(null)} />
    <PriceProposalModal visible={Boolean(priceProposalCargoId)} value={priceProposal} onChange={value => { setPriceProposal(value); setCommissionQuote(null) }} onClose={() => { setPriceProposalCargoId(null); setPriceProposal(''); setCommissionQuote(null) }} onSubmit={value => { if (priceProposalCargoId) void prepareHomeProposal(priceProposalCargoId, value) }} onConfirm={quote => { if (priceProposalCargoId) void propose(priceProposalCargoId, Number(priceProposal.replace(',', '.')), quote.token) }} quote={commissionQuote} busy={busy === priceProposalCargoId} />
  </>
}
function RouteAddressField({ label, value, onChange, onPick }: { label: string; value: string; onChange: (value: string) => void; onPick: (suggestion: { label: string; lat: number; lng: number }) => void }) {
  const [suggestions, setSuggestions] = useState<{ label: string; lat: number; lng: number }[]>([])
  const selectedRef = useRef(false)
  useEffect(() => {
    const query = value.trim()
    if (query.length < 3) { setSuggestions([]); return }
    let active = true
    const timer = setTimeout(() => { searchAddresses(query).then(result => { if (active) setSuggestions(result) }).catch(() => { if (active) setSuggestions([]) }) }, 350)
    return () => { active = false; clearTimeout(timer) }
  }, [value])
  return <View><Text style={styles.label}>{label} (opcional)</Text><TextInput value={value} onFocus={() => { if (selectedRef.current) { selectedRef.current = false; onChange('') } }} onBlur={() => { setTimeout(() => { if (!selectedRef.current && value.trim()) { onChange(''); setSuggestions([]) } }, 300) }} onChangeText={nextValue => { selectedRef.current = false; onChange(nextValue) }} style={styles.input} placeholder="Calle, ciudad o provincia" autoCorrect={false} autoCapitalize="words" autoComplete="off" spellCheck={false} textContentType="none" /><View style={styles.addressSuggestions}>{suggestions.map(suggestion => { const parts = suggestion.label.split(',').map(part => part.trim()).filter(Boolean); const primary = parts.slice(0, Math.min(2, parts.length)).join(', '); const secondary = parts.slice(2).join(', '); return <Pressable key={`${suggestion.lat}-${suggestion.lng}`} onPressIn={() => { selectedRef.current = true }} onPress={() => { onPick(suggestion); setSuggestions([]) }} style={styles.addressSuggestion}><Text style={styles.addressSuggestionIcon}>⌖</Text><View style={{ flex: 1 }}><Text style={styles.addressSuggestionPrimary}>{primary || suggestion.label}</Text>{secondary ? <Text style={styles.addressSuggestionSecondary}>{secondary}</Text> : null}</View></Pressable>})}</View></View>
}

function RouteCargoRow({ item, saving, stateLabel, actionLabel, onAdvance, onOpenTrip, onOpenChat, onOpenCancellation }: { item: import('./api').RouteCargo; saving: boolean; stateLabel: (state: string) => string; actionLabel: (status: string) => string | null; onAdvance: (tripId: string, status: string) => void; onOpenTrip: (tripId: string) => void; onOpenChat: (matchId: string, tripId?: string | null) => void; onOpenCancellation?: () => void }) {
  const terminal = item.state === 'DELIVERED' || item.state === 'CANCELLED'
  const review = item.cargo.deliveryReview
  const cargoCode = item.cargo.id.slice(-8).toUpperCase()
  return <View style={[styles.routeCargoBlock, item.state === 'CANCELLED' && styles.routeCargoCancelled]}><View style={styles.routeCargoHeader}><Text style={styles.routeCargoCode}>CARGA #{cargoCode}</Text><Text style={styles.routeCargoState}>{stateLabel(item.state)}</Text></View><Text style={styles.cardTitle}>{item.cargo.origin} → {item.cargo.destination}</Text><Text style={styles.mutedText}>{item.cargo.cargoType} · {item.cargo.weight} {item.cargo.weightUnit === 'TONNES' ? 'tn' : item.cargo.weightUnit === 'M3' ? 'm³' : 'kg'} · {item.shipperName}</Text>{review ? <Text style={styles.mutedText}>Reseña: {'★'.repeat(review.rating)}{'☆'.repeat(Math.max(0, 5 - review.rating))}{review.comment ? ` · ${review.comment}` : ''}</Text> : null}{item.tripId && !terminal && actionLabel(item.tripStatus || '') ? <Button label={saving ? 'Actualizando…' : actionLabel(item.tripStatus || '')!} onPress={() => onAdvance(item.tripId!, item.tripStatus || '')} /> : null}{item.tripId && item.state === 'CANCELLED' ? <Button label="Ver detalle de la cancelación" light onPress={() => onOpenCancellation?.()} /> : null}{item.tripId && item.state === 'DELIVERED' ? <Button label="Consultar detalle y reseña" light onPress={() => onOpenTrip(item.tripId!)} /> : null}<Button label="Abrir chat" light onPress={() => onOpenChat(item.matchId, item.tripId)} /></View>
}


function RouteTypeModal({ visible, onClose, onSelect }: { visible: boolean; onClose: () => void; onSelect: (kind: 'FREIGHT' | 'DELIVERY') => void }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.routeTypeBackdrop}>
      <View style={styles.routeTypeModal}>
        <Text style={styles.routeTypeTitle}>¿Qué tipo de recorrido querés crear?</Text>
        <Text style={styles.routeTypeSubtitle}>Elegí una opción para continuar.</Text>
        <View style={styles.routeTypeOptions}>
          <Pressable accessibilityRole="button" onPress={() => onSelect('FREIGHT')} style={[styles.routeTypeOption, styles.serviceFreightOption]}>
            <Text style={styles.routeTypeIcon}>📦</Text>
            <Text style={[styles.routeTypeOptionText, styles.serviceFreightText]}>Cargas y fletes</Text>
            <Text style={styles.routeTypeOptionHint}>Publicar disponibilidad</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => onSelect('DELIVERY')} style={[styles.routeTypeOption, styles.serviceDeliveryOption]}>
            <Text style={styles.routeTypeIcon}>🚚</Text>
            <Text style={[styles.routeTypeOptionText, styles.serviceDeliveryText]}>Delivery</Text>
            <Text style={styles.routeTypeOptionHint}>Crear recorrido vacío</Text>
          </Pressable>
        </View>
        <Button label="Cancelar" light onPress={onClose} />
      </View>
    </View>
  </Modal>
}

function ServiceTypeTag({ serviceType }: { serviceType?: string | null }) {
  const delivery = serviceType === 'DELIVERY'
  return <View style={[styles.serviceTypeTag, delivery ? styles.serviceDeliveryTag : styles.serviceFreightTag]}><Text style={[styles.serviceTypeTagIcon, delivery ? styles.serviceDeliveryText : styles.serviceFreightText]}>{delivery ? '⌁' : '▣'}</Text><Text style={[styles.serviceTypeTagText, delivery ? styles.serviceDeliveryText : styles.serviceFreightText]}>{delivery ? 'Delivery' : 'Cargas y fletes'}</Text></View>
}

function RouteSuggestionCard({ item, onMap, onPropose, busy }: { item: import('./api').RouteSuggestion; onMap: () => void; onPropose: () => void; busy: boolean }) {
  const cargo = item.cargo
  const weight = cargo.weight == null ? '—' : `${formatNumber(cargo.weight)} ${cargo.weightUnit === 'TONNES' ? 'tn' : cargo.weightUnit === 'M3' ? 'm³' : 'kg'}`
  const extra = item.extraKm == null ? null : `${formatNumber(item.extraKm)} km adicionales`
  return <View style={styles.suggestionCard}><View style={styles.suggestionHeader}><Text style={styles.suggestionLabel}>Sugerencia · Sin confirmar</Text><Text style={styles.suggestionSparkle}>✦</Text></View><Text style={styles.cardTitle}>#{cargo.id.slice(-8).toUpperCase()}</Text><RouteBlocks origin={cargo.origin} destination={cargo.destination} /><Text style={styles.mutedText}>{cargo.cargoType || 'Carga general'} · {weight}{cargo.date ? ` · ${formatDate(cargo.date)}` : ''}</Text><Text style={styles.priceText}>{cargo.offeredPrice == null ? 'A convenir' : `$${formatNumber(cargo.offeredPrice)}`}</Text>{item.capacityCompatible === false ? <Text style={styles.warningText}>La capacidad disponible no alcanza para esta carga.</Text> : null}{extra ? <Text style={styles.mutedText}>{extra}{item.extraMinutes != null ? ` · ${formatNumber(item.extraMinutes)} min adicionales` : ''}</Text> : null}{item.warning ? <Text style={styles.warningText}>{item.warning}</Text> : null}{item.warnings?.map(warning => <Text key={warning} style={styles.warningText}>{warning}</Text>)}<View style={styles.suggestionActions}><Button label="Ver mapa" light icon="⌖" onPress={onMap} /><Button label={busy ? 'Enviando…' : 'Proponer en este recorrido'} icon="✦" onPress={onPropose} /></View></View>
}

function TransporterRoutes({ go, token, user, refreshKey = 0 }: { go: (screen: Screen) => void; token: string; user: MobileUser; refreshKey?: number }) {
  const [routes, setRoutes] = useState<TransporterRoute[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createOptions, setCreateOptions] = useState(false)
  const [kind, setKind] = useState<'FREIGHT' | 'DELIVERY'>('FREIGHT')
  const [closedOpen, setClosedOpen] = useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = useState<Record<string, boolean>>({})
  const [name, setName] = useState('')
  const [nameEditing, setNameEditing] = useState(false)
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [originCoordinates, setOriginCoordinates] = useState<{ lat: number; lng: number } | null>(null)
  const [destinationCoordinates, setDestinationCoordinates] = useState<{ lat: number; lng: number } | null>(null)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [vehicleId, setVehicleId] = useState(user.vehicles?.[0]?.id || '')
  const [capacity, setCapacity] = useState('8')
  const [searching, setSearching] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Record<string, import('./api').RouteSuggestion[]>>({})
  const load = async () => { try { await mutateTransporterRoute(token, { action: 'sync' }); setRoutes((await getTransporterRoutes(token)).routes) } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los recorridos.') } finally { setLoading(false) } }
  useEffect(() => { void load(); const interval = setInterval(() => void load(), 15000); return () => clearInterval(interval) }, [token, refreshKey])
  const current = routes.find(route => route.status === 'OPEN')
  const routeNameForDate = (value: string) => { const parts = value.split('-'); return parts.length === 3 ? `Recorrido ${parts[2]}/${parts[1]}/${parts[0]}` : 'Recorrido' }
  const reset = (route?: TransporterRoute, nextKind: 'FREIGHT' | 'DELIVERY' = 'FREIGHT') => { setKind(nextKind); setName(route?.name || routeNameForDate(date)); setNameEditing(false); setOrigin(route?.origin || ''); setDestination(route?.destination || ''); setOriginCoordinates(route?.originLat != null && route?.originLng != null ? { lat: route.originLat, lng: route.originLng } : null); setDestinationCoordinates(route?.destinationLat != null && route?.destinationLng != null ? { lat: route.destinationLat, lng: route.destinationLng } : null) }
  const httpStatus = (cause: unknown) => cause instanceof Error ? (cause as Error & { status?: number }).status : undefined
  const reloadAfterConflict = async (cause: unknown) => { if (httpStatus(cause) !== 409) return false; setError(cause instanceof Error ? cause.message : 'Ya existe un recorrido abierto.'); try { await load() } catch { /* Conservamos el mensaje original si la recarga también falla. */ } return true }
  const saveRoute = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    let creationSucceeded = false
    try {
      if (!current && kind === 'FREIGHT') {
        if (!vehicleId || !originCoordinates || !destinationCoordinates) throw new Error('Elegí el vehículo, el origen y el destino desde las sugerencias.')
        const result = await createTransporterTrip(token, { vehicleId, origin, destination, originLat: originCoordinates.lat, originLng: originCoordinates.lng, destinationLat: destinationCoordinates.lat, destinationLng: destinationCoordinates.lng, date, availableCapacity: Number(capacity), acceptedCargoTypes: ['Carga general', 'Pallets'] })
        const routeId = result.routeId
        if (!routeId) throw new Error('La disponibilidad se creó, pero no se recibió el recorrido.')
        creationSucceeded = true
      } else if (current) {
        await mutateTransporterRoute(token, { action: 'update', routeId: current.id, name, origin: kind === 'DELIVERY' ? '' : origin, destination: kind === 'DELIVERY' ? '' : destination, originLat: kind === 'DELIVERY' ? null : originCoordinates?.lat ?? null, originLng: kind === 'DELIVERY' ? null : originCoordinates?.lng ?? null, destinationLat: kind === 'DELIVERY' ? null : destinationCoordinates?.lat ?? null, destinationLng: kind === 'DELIVERY' ? null : destinationCoordinates?.lng ?? null })
      } else {
        throw new Error('Elegí el tipo de recorrido para continuar.')
      }
      await load()
      setCreating(false)
      setCreateOptions(false)
    } catch (cause) {
      if (!creationSucceeded && await reloadAfterConflict(cause)) return
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el recorrido.')
    } finally { setSaving(false) }
  }
  const createDelivery = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    setCreateOptions(false)
    try {
      const result = await mutateTransporterRoute(token, { action: 'create-delivery', name: 'Recorrido delivery' })
      if (!result.routeId) throw new Error('El recorrido de delivery se creó, pero no se recibió su identificador.')
      await load()
    } catch (cause) {
      if (await reloadAfterConflict(cause)) return
      setError(cause instanceof Error ? cause.message : 'No se pudo crear el recorrido de delivery.')
    } finally { setSaving(false) }
  }
  const search = async (route: TransporterRoute) => { if (searching) return; setSearching(route.id); try { const result = await getRouteSuggestions(token, route.id); setSuggestions(currentSuggestions => ({ ...currentSuggestions, [route.id]: result.suggestions || [] })) } catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos buscar cargas.') } finally { setSearching(null) } }
  const closeRoute = async (route: TransporterRoute) => { if (route.cargos.some(item => !['DELIVERED', 'CANCELLED'].includes(item.state))) { setError('No podés finalizar el recorrido mientras haya cargas pendientes.'); return } setSaving(true); try { await mutateTransporterRoute(token, { action: 'close', routeId: route.id }); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo finalizar el recorrido.') } finally { setSaving(false) } }
  return <><ScrollView stickyHeaderIndices={[3]} contentContainerStyle={styles.content}><View style={styles.routesTopHeader}><Header title="Recorridos" onBack={() => go('home')} /><Pressable accessibilityLabel="Publicar nuevo recorrido" style={styles.routesFloatingAction} onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setCreateOptions(true) }}><Text style={styles.routesFloatingIcon}>＋</Text></Pressable></View><Text style={styles.lead}>Agrupá tus cargas aceptadas y seguí cada entrega.</Text><View>{error ? <Text style={styles.loginError}>{error}</Text> : null}</View>{current ? <View style={{ backgroundColor: '#F5F8FA', paddingHorizontal: 22, paddingVertical: 10, marginHorizontal: -22, borderBottomWidth: 1, borderBottomColor: '#B9D8E5', zIndex: 5 }}><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><View style={{ flex: 1 }}><Text style={{ color: '#173B59', fontSize: 17, fontWeight: '900' }} numberOfLines={1}>{current.name}</Text><Text style={{ color: '#647985', fontSize: 12, marginTop: 2 }}>{current.serviceType === 'DELIVERY' ? 'Delivery' : 'Cargas y fletes'} · {current.cargos.length} {current.cargos.length === 1 ? 'carga' : 'cargas'}</Text></View><Text style={{ color: current.status === 'OPEN' ? '#087C70' : '#647985', fontSize: 12, fontWeight: '900' }}>{current.status === 'OPEN' ? 'Abierto' : 'Finalizado'}</Text></View></View> : <View style={{ height: 1 }} />}{creating ? <Card><View style={styles.routeFormTitleRow}><Text style={styles.cardTitle}>{name || (kind === 'DELIVERY' ? 'Recorrido delivery' : routeNameForDate(date))}</Text><Pressable accessibilityLabel="Editar nombre del recorrido" hitSlop={10} onPress={() => setNameEditing(current => !current)}><Text style={styles.routeEditIcon}>✎</Text></Pressable></View>{nameEditing ? <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Nombre del recorrido" /> : null}{kind === 'DELIVERY' ? <Text style={styles.mutedText}>Las paradas se incorporan con los pedidos confirmados.</Text> : <><RouteAddressField label="Origen" value={origin} onChange={value => { setOrigin(value); setOriginCoordinates(null) }} onPick={suggestion => { setOrigin(suggestion.label); setOriginCoordinates(suggestion) }} /><RouteAddressField label="Destino" value={destination} onChange={value => { setDestination(value); setDestinationCoordinates(null) }} onPick={suggestion => { setDestination(suggestion.label); setDestinationCoordinates(suggestion) }} /><Text style={styles.label}>Fecha</Text><TextInput value={date} onChangeText={value => { setDate(value); if (!nameEditing) setName(routeNameForDate(value)) }} style={styles.input} placeholder="AAAA-MM-DD" /><Text style={styles.label}>Vehículo</Text><TextInput value={vehicleId} onChangeText={setVehicleId} style={styles.input} placeholder="ID del vehículo" /><Text style={styles.label}>Capacidad</Text><TextInput value={capacity} onChangeText={setCapacity} style={styles.input} keyboardType="numeric" /></>}<Button label={saving ? 'Guardando…' : 'Guardar'} onPress={() => void saveRoute()} /><Button label="Cancelar" light onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setCreating(false) }} /></Card> : null}{loading ? <SkeletonCard lines={5} /> : routes.map(route => <RouteWorkspaceCard key={route.id} route={route} expanded={route.status === 'OPEN' || closedOpen === route.id} summaryOpen={Boolean(summaryOpen[route.id])} suggestions={suggestions[route.id] || []} searching={searching === route.id} onToggle={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setClosedOpen(closedOpen === route.id ? null : route.id) }} onSummary={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setSummaryOpen(currentSummary => ({ ...currentSummary, [route.id]: !currentSummary[route.id] })) }} onSearch={() => void search(route)} onClose={() => void closeRoute(route)} onEdit={() => { reset(route, route.serviceType === 'DELIVERY' ? 'DELIVERY' : 'FREIGHT'); LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setCreating(true) }} go={go} saving={saving} />)}</ScrollView><RouteTypeModal visible={createOptions} onClose={() => setCreateOptions(false)} onSelect={selectedKind => { setCreateOptions(false); if (selectedKind === 'DELIVERY') { void createDelivery(); return } reset(undefined, 'FREIGHT'); LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setCreating(true) }} /></>
}

function RouteWorkspaceCard({ route, expanded, summaryOpen, suggestions, searching, onToggle, onSummary, onSearch, onClose, onEdit, go, saving }: { route: TransporterRoute; expanded: boolean; summaryOpen: boolean; suggestions: import('./api').RouteSuggestion[]; searching: boolean; onToggle: () => void; onSummary: () => void; onSearch: () => void; onClose: () => void; onEdit: () => void; go: (screen: Screen) => void; saving: boolean }) {
  const entrance = useRef(new Animated.Value(0)).current
  useEffect(() => { Animated.timing(entrance, { toValue: 1, duration: 280, useNativeDriver: true }).start() }, [entrance])
  const pending = route.cargos.filter(item => !['DELIVERED', 'CANCELLED'].includes(item.state)).length
  const propose = async (cargoId: string) => { try { await proposeRouteSuggestion(activeRouteToken, route.id, cargoId); showTregoModal({ title: 'Propuesta enviada', message: 'La carga fue propuesta en este recorrido.' }) } catch (cause) { showTregoModal({ title: 'No se pudo proponer', message: cause instanceof Error ? cause.message : 'Volvé a intentarlo.' }) } }
  const openMap = async (cargoId: string) => { try { await getRouteSuggestionMap(activeRouteToken, route.id, cargoId); showTregoModal({ title: 'Mapa listo', message: 'La ruta fue calculada por el backend y está disponible para esta sugerencia.' }) } catch (cause) { showTregoModal({ title: 'No se pudo cargar el mapa', message: cause instanceof Error ? cause.message : 'Volvé a intentarlo.' }) } }
  return <Animated.View style={[styles.routeCardEntrance, { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}><Card style={styles.routeCard}><Pressable style={styles.routeHeader} disabled={route.status === 'OPEN'} onPress={onToggle}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{route.name}</Text><Text style={styles.mutedText}>{formatDate(route.createdAt)}</Text></View><Text style={styles.routeStatus}>{route.status === 'OPEN' ? 'Abierto' : 'Finalizado'}</Text>{route.status === 'OPEN' ? <Pressable accessibilityLabel="Editar recorrido" hitSlop={10} onPress={onEdit}><Text style={styles.routeEditIcon}>✎</Text></Pressable> : null}<Text style={styles.routeChevron}>{expanded ? '⌃' : '⌄'}</Text></Pressable><ServiceTypeTag serviceType={route.serviceType} />{route.serviceType !== 'DELIVERY' ? <RouteBlocks origin={route.origin || 'Origen según paradas'} destination={route.destination || 'Destino según paradas'} /> : null}<Pressable style={styles.routeCounterToggle} onPress={onSummary}><Text style={styles.packageIcon}>▣</Text><Text style={styles.proposalStatus}>{route.cargos.length} cargas</Text><Text style={styles.mutedText}>{summaryOpen ? `${pending} pendientes` : 'Ver resumen'}</Text></Pressable>{expanded ? <><View style={styles.routeTabs}><Text style={[styles.routeTabText, styles.routeTabActive]}>Viajes</Text><Text style={styles.routeTabText}>Paradas ({route.stops.length})</Text></View>{route.cargos.map(item => <RouteCargoRow key={item.id} item={item} saving={saving} stateLabel={state => state} actionLabel={status => status === 'MATCHED' ? 'Ir a buscar' : status === 'IN_PROGRESS' ? 'Marcar retirada' : status === 'ARRIVED' ? 'Marcar entregada' : null} onAdvance={() => undefined} onOpenTrip={tripId => { void AsyncStorage.setItem('trego.activeTripId', tripId); go('trips') }} onOpenChat={(matchId, tripId) => { if (tripId) { void AsyncStorage.multiSet([['trego.activeMatchId', matchId], ['trego.activeTripId', tripId]]); go('chat') } }} onOpenCancellation={() => go('cancellations')} />)}{route.status === 'OPEN' ? <><Button label="Editar recorrido" light onPress={onEdit} /><Button label={saving ? 'Finalizando…' : 'Finalizar recorrido'} onPress={onClose} /><Button label={searching ? 'Buscando cargas…' : 'Encontrar cargas ✦'} onPress={onSearch} />{suggestions.length > 0 ? <><Text style={styles.suggestionIntro}>¡Encontramos estas sugerencias para vos! ✨🚚</Text>{suggestions.map(item => <RouteSuggestionCard key={item.cargo.id} item={item} busy={false} onMap={() => void openMap(item.cargo.id)} onPropose={() => void propose(item.cargo.id)} />)}</> : null}</> : null}</> : null}</Card></Animated.View>
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
  const statusLabel = (status: string) => status === 'MATCHED' ? 'Match confirmado' : status === 'IN_PROGRESS' ? 'En camino al retiro' : status === 'ARRIVED' ? 'Carga retirada · en viaje' : status === 'COMPLETED' ? 'Entregado' : status === 'CANCELLED' ? 'Cancelado · ver detalle' : 'Disponible'
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
  async function openTransporterProfile(transporterId?: string) { if (!transporterId) return; await AsyncStorage.setItem('trego.profileUserId', transporterId); go('transporter-profile') }

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

  return <ScrollView contentContainerStyle={styles.content}><Header title="Mis viajes" onBack={() => go('home')} /><Text style={styles.lead}>Seguimiento de cada traslado, desde el match hasta la entrega.</Text>{error ? <Text style={styles.loginError}>{error}</Text> : null}{loading ? <><SkeletonCard lines={5} /><SkeletonCard lines={4} /></> : trips.length === 0 ? <Card><Text style={styles.mutedText}>Todavía no tenés viajes publicados.</Text></Card> : trips.map(trip => { const step = stepFor(trip.status); const cargo = trip.matches?.[0]?.cargo; const matchId = trip.matches?.[0]?.id; const active = isTransporter && ['AVAILABLE', 'MATCHED', 'IN_PROGRESS', 'ARRIVED'].includes(trip.status); return <Card key={trip.id} variant={active ? 'proposalActive' : 'proposalClosed'}><Text style={styles.label}>{statusLabel(trip.status)}</Text><RouteBlocks origin={cargo?.origin || trip.origin} destination={cargo?.destination || trip.destination} /><Text style={styles.mutedText}>{cargo?.cargoType || 'Viaje'} · {trip.availableCapacity} {trip.capacityUnit === 'TONNES' ? 'tn' : trip.capacityUnit === 'M3' ? 'm³' : 'kg'}{isTransporter ? (trip.matches?.[0]?.shipper?.name ? ` · Cargador: ${trip.matches[0].shipper.name}` : '') : (trip.transporter?.name ? ` · Transportista: ${trip.transporter.name}` : '')}</Text><View style={{ marginTop: 12, gap: 8 }}>{['Match confirmado', 'En camino al retiro', 'Carga retirada', 'Entregado'].map((label, index) => <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: index <= step ? '#18B95D' : '#DDE7EC', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '900' }}>{index <= step ? '✓' : ''}</Text></View><Text style={{ color: index <= step ? '#173B59' : '#8BA0AC', fontWeight: index === step ? '900' : '600' }}>{label}</Text></View>)}</View>{trip.startedAt ? <Text style={styles.mutedText}>Retiro iniciado: {formatDateTime(trip.startedAt)}</Text> : null}{trip.pickedUpAt ? <Text style={styles.mutedText}>Carga retirada: {formatDateTime(trip.pickedUpAt)}</Text> : null}{trip.completedAt ? <Text style={styles.mutedText}>Entregado: {formatDateTime(trip.completedAt)}</Text> : null}<ReviewSummary review={trip.deliveryReview || cargo?.deliveryReview} onOpen={() => void openTripDetail(trip.id)} />{trip.status === 'CANCELLED' ? <Button label="Ver detalle de la cancelación" light onPress={() => go('cancellations')} /> : isTransporter && actionFor(trip.status) ? <Button label={busy === trip.id ? 'Actualizando…' : actionLabel(trip.status)} onPress={() => void advance(trip)} /> : null}{matchId ? <Button label={isTransporter ? "Abrir chat con el cargador" : "Abrir chat con el transportista"} light onPress={() => void openChat(trip)} /> : null}</Card>})}</ScrollView>
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

function TripListWithLocation({ go, token, isTransporter, refreshKey = 0 }: { go: (screen: Screen) => void; token: string; isTransporter: boolean; refreshKey?: number }) {
  const [trips, setTrips] = useState<TripRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [locationError, setLocationError] = useState('')
  const [sharingTripId, setSharingTripId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  const [locationPoints, setLocationPoints] = useState<Record<string, { lat: number; lng: number; accuracy?: number | null; capturedAt: string }>>({})
  const [pendingStatusChange, setPendingStatusChange] = useState<{ trip: TripRecord; action: TripAction } | null>(null)
  const watcher = useRef<Location.LocationSubscription | null>(null)
  const sharingTripRef = useRef<string | null>(null)
  const sharingGeneration = useRef(0)
  const alertedRequests = useRef(new Set<string>())

  const stopSharing = async () => {
    const tripId = sharingTripRef.current
    sharingGeneration.current += 1
    watcher.current?.remove()
    watcher.current = null
    sharingTripRef.current = null
    setSharingTripId(null)
    await AsyncStorage.removeItem('trego.pendingLocationShareTripId')
    if (tripId) {
      await AsyncStorage.setItem(`trego.locationShareStoppedAt:${tripId}`, new Date().toISOString())
      try { await setTripLocationSharing(token, tripId, false) } catch (cause) { setLocationError(cause instanceof Error ? cause.message : 'No pudimos avisar que dejaste de compartir la ubicación.') }
    }
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
    try { await setTripLocationSharing(token, trip.id, true) } catch (cause) {
      setLocationError(cause instanceof Error ? cause.message : 'El cargador ya no está solicitando ubicación o el viaje no está activo.')
      return
    }
    await AsyncStorage.removeItem(`trego.locationShareStoppedAt:${trip.id}`)
    sharingTripRef.current = trip.id
    setSharingTripId(trip.id)
    const currentGeneration = ++sharingGeneration.current
    try {
      watcher.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 25 }, location => {
        if (sharingGeneration.current !== currentGeneration || sharingTripRef.current !== trip.id) return
        const capturedAt = new Date(location.timestamp).toISOString()
        void sendTripLocation(token, trip.id, { lat: location.coords.latitude, lng: location.coords.longitude, accuracy: location.coords.accuracy, heading: location.coords.heading, speed: location.coords.speed, capturedAt }).then(result => {
          if (sharingGeneration.current !== currentGeneration || sharingTripRef.current !== trip.id) return
          setLocationPoints(current => ({ ...current, [trip.id]: { lat: result.location.lat, lng: result.location.lng, accuracy: location.coords.accuracy, capturedAt: result.location.capturedAt } }))
          setTrips(current => current.map(item => item.id === trip.id ? { ...item, lastLocationAt: result.location.capturedAt } : item))
        }).catch(cause => {
          if (sharingGeneration.current !== currentGeneration || sharingTripRef.current !== trip.id) return
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
    const stoppedAt = await AsyncStorage.getItem(`trego.locationShareStoppedAt:${trip.id}`)
    if (stoppedAt && (!trip.locationSharingRequestedAt || new Date(trip.locationSharingRequestedAt).getTime() <= new Date(stoppedAt).getTime())) {
      await AsyncStorage.removeItem('trego.pendingLocationShareTripId')
      return
    }
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
        if (isTransporter) await startPendingLocationShare(result.trips)
        const requestedTripId = await AsyncStorage.getItem('trego.activeTripId')
        if (requestedTripId && result.trips.some(trip => trip.id === requestedTripId)) {
          setSelectedTripId(requestedTripId)
          await AsyncStorage.removeItem('trego.activeTripId')
        }
        const stored = await AsyncStorage.getItem('trego.locationRequestAlerts')
        if (stored) JSON.parse(stored).forEach((key: string) => alertedRequests.current.add(key))
        for (const trip of result.trips) {
          if (!isTransporter || !trip.locationSharingRequested || !['MATCHED', 'IN_PROGRESS', 'ARRIVED'].includes(trip.status)) continue
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
  }, [isTransporter, token, refreshKey])

  useEffect(() => {
    if (!selectedTripId) return
    void getTripLocationState(token, selectedTripId).then(result => {
      if (result.location) setLocationPoints(current => ({ ...current, [selectedTripId]: result.location! }))
    }).catch(() => undefined)
  }, [token, selectedTripId])

  const selectedTrip = selectedTripId ? trips.find(trip => trip.id === selectedTripId) : null
  const confirmationModal = <TregoModal visible={Boolean(pendingStatusChange)} title={confirmationTitle || ''} message={confirmationMessage || ''} actionLabel="Confirmar cambio" onClose={() => setPendingStatusChange(null)} onAction={() => { if (pendingStatusChange) void applyStatusChange(pendingStatusChange.trip, pendingStatusChange.action) }} />
  if (selectedTrip) {
    const cargo = selectedTrip.matches?.[0]?.cargo
    const active = activeStatus(selectedTrip.status)
    const canManage = isTransporter
    const sharing = sharingTripId === selectedTrip.id
    const lastPoint = locationPoints[selectedTrip.id]
    const step = selectedTrip.status === 'MATCHED' ? 0 : selectedTrip.status === 'IN_PROGRESS' ? 1 : selectedTrip.status === 'ARRIVED' ? 2 : selectedTrip.status === 'COMPLETED' ? 3 : -1
    return <><ScrollView contentContainerStyle={styles.content}><Header title="Detalle del viaje" onBack={() => void closeTripDetail()} /><Card><Text style={styles.label}>VIAJE #{selectedTrip.id.slice(-8).toUpperCase()}</Text><Text style={styles.cardTitle}>{tripStatusLabel(selectedTrip.status)}</Text><RouteBlocks origin={cargo?.origin || selectedTrip.origin} destination={cargo?.destination || selectedTrip.destination} />{canManage && active && ['MATCHED', 'IN_PROGRESS'].includes(selectedTrip.status) ? <TripActionTile icon="➤" title="Abrir ruta al retiro" subtitle="Ver el mapa y comenzar la navegación" tone="route" onPress={() => void openPickupRoute(selectedTrip)} /> : null}<Text style={styles.mutedText}>{cargo?.cargoType || 'Viaje'} · {selectedTrip.availableCapacity} {selectedTrip.capacityUnit === 'TONNES' ? 'tn' : selectedTrip.capacityUnit === 'M3' ? 'm³' : 'kg'}</Text>{selectedTrip.matches?.[0]?.shipper?.name ? <Text style={styles.mutedText}>Cargador: {selectedTrip.matches[0].shipper.name}</Text> : null}{!isTransporter && selectedTrip.transporter?.name ? <><Text style={styles.mutedText}>Transportista: {selectedTrip.transporter.name}</Text><Button label="Ver perfil del transportista" light onPress={() => void openTransporterProfile(selectedTrip.transporter!.id)} /></> : null}<Text style={styles.detailSectionTitle}>Seguimiento del traslado</Text><View style={styles.timeline}>{['Match confirmado', 'En camino al retiro', 'Carga retirada', 'Entregado'].map((label, index) => <View key={label} style={styles.timelineRow}><View style={[styles.timelineDot, index <= step && styles.timelineDotActive]}><Text style={styles.timelineCheck}>{index <= step ? '✓' : ''}</Text></View><Text style={[styles.timelineLabel, index <= step && styles.timelineLabelActive]}>{label}</Text></View>)}</View>{selectedTrip.startedAt ? <Text style={styles.mutedText}>Retiro iniciado: {formatDateTime(selectedTrip.startedAt)}</Text> : null}{selectedTrip.pickedUpAt ? <Text style={styles.mutedText}>Carga retirada: {formatDateTime(selectedTrip.pickedUpAt)}</Text> : null}{selectedTrip.completedAt ? <Text style={styles.mutedText}>Entregado: {formatDateTime(selectedTrip.completedAt)}</Text> : null}{selectedTrip.deliveryReview || cargo?.deliveryReview ? <View style={styles.reviewCard}><Text style={styles.detailSectionTitle}>Reseña de la entrega</Text><Text style={styles.score}>{'★'.repeat((selectedTrip.deliveryReview || cargo?.deliveryReview)!.rating)}{'☆'.repeat(Math.max(0, 5 - (selectedTrip.deliveryReview || cargo?.deliveryReview)!.rating))}</Text>{(selectedTrip.deliveryReview || cargo?.deliveryReview)!.comment ? <Text style={styles.reviewComment}>{(selectedTrip.deliveryReview || cargo?.deliveryReview)!.comment}</Text> : null}{(selectedTrip.deliveryReview || cargo?.deliveryReview)!.highlights.length > 0 ? <Text style={styles.mutedText}>Aspectos destacados: {(selectedTrip.deliveryReview || cargo?.deliveryReview)!.highlights.join(', ')}</Text> : null}<Text style={styles.reviewDate}>{formatDate((selectedTrip.deliveryReview || cargo?.deliveryReview)!.createdAt)}</Text></View> : <Text style={styles.mutedText}>Sin calificación</Text>}{canManage && selectedTrip.locationSharingRequested && active ? <View style={styles.locationRequest}><Text style={styles.locationRequestTitle}>Solicitud de ubicación</Text><Text style={styles.mutedText}>El cargador solicita compartir tu ubicación.</Text></View> : null}{canManage && active ? sharing ? <TripActionTile icon="↗" title="Dejar de compartir" subtitle="La ubicación se está enviando al cargador" tone="share" onPress={() => void stopSharing()} /> : <TripActionTile icon="↗" title="Compartir ubicación" subtitle="Compartir mi ubicación actual" tone="share" onPress={() => void startSharing(selectedTrip)} /> : null}{lastPoint ? <View style={styles.locationLastPoint}><Text style={styles.locationLastPointTitle}>{sharing ? 'Ubicación compartida' : 'Se dejó de compartir la ubicación'}</Text><Text style={styles.mutedText}>Último punto: {formatDateTime(lastPoint.capturedAt)} · No es ubicación en vivo.</Text>{lastPoint.accuracy != null ? <Text style={styles.mutedText}>Precisión ±{Math.round(lastPoint.accuracy)} m</Text> : null}</View> : selectedTrip.lastLocationAt ? <Text style={styles.mutedText}>Último punto registrado: {formatDateTime(selectedTrip.lastLocationAt)} · No es ubicación en vivo.</Text> : null}{canManage && actionFor(selectedTrip.status) ? <TripActionTile icon="⌕" title={busy === selectedTrip.id ? 'Actualizando…' : actionLabel(selectedTrip.status)} subtitle="Ver detalle de la carga y del cargador" tone="status" onPress={() => advance(selectedTrip)} confirmation={{ title: selectedTrip.status === 'MATCHED' ? '¿Estás listo para ir a buscarla?' : selectedTrip.status === 'IN_PROGRESS' ? '¿Confirmás que retiraste la carga?' : '¿Confirmás que entregaste la carga?', message: selectedTrip.status === 'MATCHED' ? 'Al confirmar, el cargador recibirá el aviso y el viaje pasará a “En camino al retiro”.' : selectedTrip.status === 'IN_PROGRESS' ? 'Al confirmar, la carga quedará registrada como retirada y continuará el traslado.' : 'Al confirmar, el viaje quedará marcado como entregado y cerrado.' }} /> : null}{selectedTrip.matches?.[0]?.id ? <TripActionTile icon="◯" title={isTransporter ? "Abrir chat con el cargador" : "Abrir chat con el transportista"} subtitle="Coordinar horarios y detalles" tone="chat" onPress={() => void openChat(selectedTrip)} /> : null}</Card></ScrollView>{confirmationModal}</>
  }

  return <><ScrollView contentContainerStyle={styles.content}><Header title="Mis viajes" onBack={() => go('home')} /><Text style={styles.lead}>Seguimiento de cada traslado, desde el match hasta la entrega.</Text>{error ? <Text style={styles.loginError}>{error}</Text> : null}{loading ? <><SkeletonCard lines={5} /><SkeletonCard lines={4} /></> : trips.length === 0 ? <Card style={styles.emptyState}><Text style={styles.emptyStateIcon}>🚚</Text><Text style={styles.emptyStateTitle}>Todavía no tenés viajes</Text><Text style={styles.emptyStateText}>Cuando una carga sea aceptada y asignada a un viaje, vas a poder verla y seguir cada etapa desde acá.</Text>{isTransporter ? <Button label="Volver a recorridos" onPress={() => go('routes')} /> : null}</Card> : trips.map(trip => { const cargo = trip.matches?.[0]?.cargo; const active = isTransporter && activeStatus(trip.status); const sharing = sharingTripId === trip.id; const action = actionFor(trip.status); return <Card key={trip.id} variant={active ? 'proposalActive' : 'proposalClosed'}><Text style={styles.label}>{tripStatusLabel(trip.status)}</Text><RouteBlocks origin={cargo?.origin || trip.origin} destination={cargo?.destination || trip.destination} /><Text style={styles.mutedText}>{cargo?.cargoType || 'Viaje'} · {trip.availableCapacity} {trip.capacityUnit === 'TONNES' ? 'tn' : trip.capacityUnit === 'M3' ? 'm³' : 'kg'}</Text>{trip.startedAt ? <Text style={styles.mutedText}>Retiro iniciado: {formatDateTime(trip.startedAt)}</Text> : null}{trip.pickedUpAt ? <Text style={styles.mutedText}>Carga retirada: {formatDateTime(trip.pickedUpAt)}</Text> : null}{trip.completedAt ? <Text style={styles.mutedText}>Entregado: {formatDateTime(trip.completedAt)}</Text> : null}{active && action ? <Button label={busy === trip.id ? 'Actualizando…' : actionLabel(trip.status)} onPress={() => setPendingStatusChange({ trip, action })} /> : null}{active && trip.locationSharingRequested ? <Button label={sharing ? 'Dejar de compartir ubicación' : 'Compartir ubicación'} light onPress={() => void (sharing ? stopSharing() : startSharing(trip))} /> : null}{trip.matches?.[0]?.id ? <Button label={isTransporter ? 'Abrir chat con el cargador' : 'Abrir chat con el transportista'} light onPress={() => void openChat(trip)} /> : null}</Card>})}</ScrollView>{confirmationModal}</>
Object.assign(styles, { navIcon: { color: '#173B59', fontSize: 26, lineHeight: 29, fontWeight: '900', marginBottom: 2 }, navIconRow: { height: 31, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 4 }, navBadge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: '#E85C53', color: '#fff', fontSize: 11, fontWeight: '900', textAlign: 'center', lineHeight: 18 }, navItem: { minWidth: 58, minHeight: 60, paddingHorizontal: 5, paddingVertical: 5, borderRadius: 15, alignItems: 'center', justifyContent: 'center', gap: 1 }, navItemActive: { minWidth: 72, minHeight: 68, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: '#D8E4E8' }, navText: { fontSize: 13, fontWeight: '900', color: '#173B59' }, navActive: { color: '#087C70', fontWeight: '900' }, proposalStatus: { color: '#087C70', fontSize: 14, fontWeight: '900', marginTop: 4 }, proposalStatusClosed: { color: '#7C8B95', fontSize: 14, fontWeight: '900', marginTop: 4 }, proposalCardActive: { borderColor: '#52C99B', shadowColor: '#087C70', shadowOpacity: 0.12, shadowRadius: 10 }, proposalCardClosed: { borderColor: '#B8C2C8', backgroundColor: '#F0F3F4', opacity: 0.78, shadowOpacity: 0 } })
}

function TransporterReviews({ reviews, reviewsCount, averageRating, loading, error }: { reviews: DeliveryReview[]; reviewsCount: number; averageRating: number | null; loading: boolean; error: string }) {
  if (loading) return <><SkeletonCard lines={3} /><SkeletonCard lines={3} /></>
  if (error) return <Text style={styles.loginError}>{error}</Text>
  if (reviews.length === 0) return <Card><Text style={styles.detailSectionTitle}>Referencias de clientes</Text><Text style={styles.mutedText}>Todavía no hay reseñas de deliveries.</Text></Card>
  return <View style={styles.reviewsSection}><View style={styles.reviewsSummary}><View><Text style={styles.detailSectionTitle}>Referencias de clientes</Text><Text style={styles.reviewAverage}>{averageRating == null ? '—' : averageRating.toFixed(1)} <Text style={styles.reviewStar}>★</Text></Text><Text style={styles.mutedText}>{reviewsCount} {reviewsCount === 1 ? 'reseña' : 'reseñas'} de deliveries entregados</Text></View><Text style={styles.reviewStars}>{'★'.repeat(Math.max(0, Math.min(5, Math.round(averageRating || 0))))}{'☆'.repeat(Math.max(0, 5 - Math.min(5, Math.round(averageRating || 0))))}</Text></View>{reviews.map((review, index) => <Card key={`${review.createdAt}-${index}`} kind="review"><View style={styles.reviewCardHeader}><Text style={styles.reviewStars}>{'★'.repeat(Math.max(0, Math.min(5, Math.round(review.rating))))}{'☆'.repeat(Math.max(0, 5 - Math.min(5, Math.round(review.rating))))}</Text><Text style={styles.reviewDate}>{formatDate(review.createdAt)}</Text></View>{review.comment ? <Text style={styles.reviewComment}>“{review.comment}”</Text> : null}{review.highlights?.length ? <View style={styles.reviewPills}>{review.highlights.map(highlight => <Text key={highlight} style={styles.reviewPill}>{highlight}</Text>)}</View> : null}</Card>)}</View>
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
  const { locale } = useI18n()
  const [screen, setScreen] = useState<Screen>('home')
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<MobileUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [pushRevision, setPushRevision] = useState(0)
  const [globalModal, setGlobalModal] = useState<TregoModalPayload | null>(null)
  const [incomingDelivery, setIncomingDelivery] = useState<NotificationData | null>(null)
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
    const openNotification = async (data?: NotificationData) => { if (!mounted || await markNotificationAsSeen(data)) return; await queueLocationShare(data); if (data?.type === 'delivery_request') { setIncomingDelivery(data); return } go(notificationScreen(data)) }
    const unsubscribeMessage = onMessage(firebaseMessaging, async remoteMessage => { const data = remoteMessage.data as NotificationData | undefined; await queueLocationShare(data); await showForegroundPush(remoteMessage); if (data?.type === 'delivery_request') setIncomingDelivery(data); setPushRevision(current => current + 1); if (data?.type === 'location_request') go('trips') })
    const unsubscribeOpened = onNotificationOpenedApp(firebaseMessaging, remoteMessage => { void openNotification(remoteMessage.data) })
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(response => { void openNotification(response.notification.request.content.data as NotificationData) })
    const unsubscribeToken = onTokenRefresh(firebaseMessaging, pushToken => { if (mounted) void preparePushToken(token, pushToken).catch(error => { if (__DEV__) console.warn('[push] No se pudo actualizar el dispositivo', error) }) })
    void getInitialNotification(firebaseMessaging).then(remoteMessage => { if (remoteMessage) void openNotification(remoteMessage.data) })
    return () => { mounted = false; unsubscribeMessage(); unsubscribeOpened(); responseSubscription.remove(); unsubscribeToken() }
  }, [token, locale])
  const signOut = async () => { await SecureStore.deleteItemAsync('trego.mobileToken'); await SecureStore.deleteItemAsync('trego.mobileUser'); setToken(null); setUser(null); setScreen('home') }
  if (authLoading) return <View style={styles.loading}><Text style={styles.loadingText}>Cargando Trego…</Text></View>
  if (!token || !user) return <Login onAuthenticated={onAuthenticated} />
  const content = screen === 'home' ? <Home go={go} user={user} token={token} refreshKey={pushRevision} /> : screen === 'publish' ? <Publish go={go} token={token} /> : screen === 'matches' ? <Matches go={go} token={token} roles={user.roles} refreshKey={pushRevision} /> : screen === 'proposals' ? <Matches go={go} token={token} roles={user.roles} refreshKey={pushRevision} onlyProposals /> : screen === 'chat' ? <ChatHub go={go} token={token} refreshKey={pushRevision} /> : screen === 'routes' ? <TransporterRoutes go={go} token={token} user={user} refreshKey={pushRevision} /> : screen === 'cargo-routes' ? <Matches go={go} token={token} roles={['shipper']} cargoWorkspace refreshKey={pushRevision} /> : screen === 'cancellations' ? <Cancellations go={go} token={token} refreshKey={pushRevision} /> : screen === 'trips' ? <TripListWithLocation go={go} token={token} isTransporter={user.roles.some(role => ['transporter', 'transportista'].includes(role.toLowerCase()))} refreshKey={pushRevision} /> : screen === 'transporter-profile' ? <TransporterProfile go={go} token={token} /> : <Simple screen={screen} go={go} onSignOut={signOut} refreshKey={pushRevision} />
  const isTransporter = user.roles.some(role => ['transporter', 'transportista'].includes(role.toLowerCase()))
  const isShipper = user.roles.some(role => ['shipper', 'cargador'].includes(role.toLowerCase()))
  const navItems: Array<[Screen, string, string]> = [['home', 'Inicio', '⌂'], ...(isTransporter ? [['routes', 'Recorridos', '⌖'] as [Screen, string, string], ['trips', 'Mis viajes', '🚚'] as [Screen, string, string]] : []), ...(isShipper ? [['cargo-routes', 'Recorrido de mis cargas', '📦'] as [Screen, string, string]] : []), ['chat', 'Chats', '◯']]
  return <SafeAreaView style={styles.safe}>{content}<View style={[styles.nav, { height: 86 + insets.bottom, paddingBottom: insets.bottom }]}>{navItems.map(([key, label, icon]) => <Pressable key={key} onPress={() => go(key)} style={[styles.navItem, key === 'trips' && styles.navTripsItem, screen === key && styles.navItemActive]}><Text style={[styles.navIcon, key === 'trips' && styles.navTripsIcon, screen === key && styles.navActive]}>{icon}</Text><Text style={[styles.navText, screen === key && styles.navActive]}>{label}</Text></Pressable>)}<ProposalNavItem active={screen === 'proposals'} onPress={() => go('proposals')} token={token} refreshKey={pushRevision} /></View><TregoModal visible={Boolean(globalModal)} title={globalModal?.title || ''} message={globalModal?.message || ''} actionLabel={globalModal?.actionLabel} onClose={() => setGlobalModal(null)} onAction={globalModal?.onAction} />{incomingDelivery ? <IncomingDeliveryRequest data={incomingDelivery} token={token} onClose={() => setIncomingDelivery(null)} /> : null}</SafeAreaView>
}
export default function App() { return <SafeAreaProvider><I18nProvider><AppContent /></I18nProvider></SafeAreaProvider> }
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#F5F8FA' }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F8FA' }, loadingText: { color: '#173B59', fontSize: 16, fontWeight: '700' }, loginContent: { flexGrow: 1, justifyContent: 'center', padding: 26, gap: 14, backgroundColor: '#F5F8FA' }, loginLogo: { width: 76, height: 76, borderRadius: 22, alignSelf: 'center', marginBottom: 12 }, loginTitle: { fontSize: 40, fontWeight: '900', letterSpacing: -1.8, color: '#173B59', textAlign: 'center' }, loginError: { color: '#B42318', backgroundColor: '#FEE4E2', borderRadius: 12, padding: 12, fontSize: 14 }, googleButton: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#C9D7DE', paddingVertical: 15, borderRadius: 999, alignItems: 'center', marginTop: 12 }, googleButtonText: { color: '#173B59', fontWeight: '800', fontSize: 15 }, loginDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 8 }, dividerLine: { flex: 1, height: 1, backgroundColor: '#DDE7EC' }, dividerText: { color: '#8BA0AC', fontSize: 12 }, content: { padding: 22, paddingTop: 26, paddingBottom: 122, gap: 16 }, brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }, brandLogo: { width: 34, height: 34, borderRadius: 10 }, brand: { fontSize: 28, fontWeight: '900', letterSpacing: -2.2, color: '#173B59' }, brandDot: { color: '#E86A5B' }, header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, marginBottom: 10 }, headerLogo: { width: 30, height: 30, borderRadius: 9 }, back: { fontSize: 36, lineHeight: 36, color: '#647985' }, title: { fontSize: 34, fontWeight: '900', letterSpacing: -1.4, color: '#173B59', flexShrink: 1 }, eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, color: '#6C7D88', marginTop: 18 }, hero: { fontSize: 44, lineHeight: 47, fontWeight: '900', letterSpacing: -2, marginTop: 16, color: '#173B59' }, lead: { fontSize: 16, lineHeight: 23, color: '#647985', marginBottom: 10 }, muted: { color: '#8BA0AC' }, card: { backgroundColor: '#fff', borderRadius: 18, padding: 18, gap: 8, borderWidth: 2, borderColor: '#B9D8E5', shadowColor: '#173B59', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 }, cardTitle: { fontSize: 18, fontWeight: '800', color: '#173B59' }, mutedText: { color: '#647985', fontSize: 14, lineHeight: 21 }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: 7 }, score: { fontSize: 24, fontWeight: '900', color: '#168F83' }, button: { backgroundColor: '#DCECF0', minHeight: 48, paddingVertical: 14, paddingHorizontal: 18, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginTop: 10 }, buttonLight: { backgroundColor: '#F8FBFC', borderWidth: 1, borderColor: '#C9D7DE' }, buttonText: { color: '#173B59', fontWeight: '800' }, buttonTextLight: { color: '#173B59' }, label: { fontSize: 12, fontWeight: '800', color: '#6C7D88', textTransform: 'uppercase', letterSpacing: 1, marginTop: 6 }, input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#C9D7DE', borderRadius: 12, padding: 14, fontSize: 16, color: '#173B59' }, textarea: { minHeight: 110, textAlignVertical: 'top' }, signOut: { position: 'absolute', top: 20, right: 22, padding: 8 }, signOutText: { color: '#647985', fontWeight: '700' }, chatScreen: { flex: 1, padding: 22, paddingTop: 26, paddingBottom: 100, gap: 12 }, chatMessages: { flexGrow: 1, justifyContent: 'flex-start', gap: 10, paddingVertical: 12 }, chatBubble: { maxWidth: '82%', padding: 13, borderRadius: 16 }, chatBubbleMine: { alignSelf: 'flex-end', backgroundColor: '#173B59', borderBottomRightRadius: 4 }, chatBubbleOther: { alignSelf: 'flex-start', backgroundColor: '#E8F1F3', borderBottomLeftRadius: 4 }, chatText: { color: '#173B59', fontSize: 15, lineHeight: 21 }, chatTextMine: { color: '#fff' }, chatComposer: { flexDirection: 'row', alignItems: 'center', gap: 8 }, chatInput: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#C9D7DE', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: '#173B59' }, chatSend: { backgroundColor: '#E86A5B', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 13 }, chatSendText: { color: '#fff', fontWeight: '800' }, nav: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#DDE7EC', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }, navItem: { minWidth: 62, minHeight: 48, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, navItemActive: { backgroundColor: '#E8F1F3' }, navText: { fontSize: 14, fontWeight: '800', color: '#8BA0AC' }, navActive: { color: '#173B59' }, arrivalButton: { backgroundColor: '#18C968', borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 18 }, arrivalButtonDisabled: { backgroundColor: '#B7CBD8' }, arrivalButtonText: { color: '#fff', fontWeight: '900', fontSize: 15, letterSpacing: 0.5 } })
Object.assign(styles, { arrivalButton: { backgroundColor: '#18C968', borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 18 }, arrivalButtonDisabled: { backgroundColor: '#B7CBD8' }, arrivalButtonText: { color: '#fff', fontWeight: '900', fontSize: 15, letterSpacing: 0.5 }, cargoId: { color: '#087C70', backgroundColor: '#DDF7EC', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, fontWeight: '900' }, routeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#18B95D' }, routeDotDestination: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#173B59' }, routeLine: { width: 2, height: 20, backgroundColor: '#B7CBD8' }, routeLabel: { color: '#8BA0AC', fontSize: 10, fontWeight: '800', letterSpacing: 1 }, routeAddress: { color: '#173B59', fontSize: 17, lineHeight: 22, fontWeight: '800' }, homeTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }, homeTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, homeTitle: { color: '#173B59', fontSize: 34, fontWeight: '900' }, homeActions: { flexDirection: 'row', alignItems: 'center', gap: 10 }, homeBell: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', borderWidth: 1, borderColor: '#DDE7EC', alignItems: 'center', justifyContent: 'center' }, homeBellText: { fontSize: 20 }, homeAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#168F83', alignItems: 'center', justifyContent: 'center' }, homeAvatarText: { color: '#fff', fontSize: 18, fontWeight: '900' } })
Object.assign(styles, { localeButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F1F3', marginLeft: 'auto' }, localeIcon: { color: '#173B59', fontSize: 28, lineHeight: 30, fontWeight: '900' }, localeBackdrop: { flex: 1, backgroundColor: 'rgba(23,59,89,.28)', alignItems: 'flex-end', justifyContent: 'flex-start', paddingTop: 72, paddingHorizontal: 18 }, localeMenu: { width: 220, backgroundColor: '#fff', borderRadius: 18, padding: 10, borderWidth: 1, borderColor: '#B9D8E5', elevation: 8, shadowColor: '#173B59', shadowOpacity: .18, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } }, localeTitle: { color: '#173B59', fontWeight: '900', fontSize: 16, paddingHorizontal: 12, paddingVertical: 8 }, localeOption: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, paddingHorizontal: 12 }, localeOptionText: { color: '#173B59', fontSize: 15, fontWeight: '700' }, localeCheck: { color: '#087C70', fontSize: 20, fontWeight: '900' } })
Object.assign(styles, { locationLastPoint: { marginTop: 12, padding: 14, borderRadius: 14, backgroundColor: '#F1F6F8', borderWidth: 1, borderColor: '#C9D7DE', gap: 4 }, locationLastPointTitle: { color: '#087C70', fontWeight: '900', fontSize: 14 }, skeletonTitle: { width: '62%', height: 18, borderRadius: 9, backgroundColor: '#E3EDF0', marginBottom: 14 }, skeletonLine: { width: '100%', height: 12, borderRadius: 6, backgroundColor: '#EAF1F3', marginBottom: 10 }, skeletonShort: { width: '42%' }, navText: { fontSize: 14, fontWeight: '800', color: '#5F7483' }, navItemActive: { backgroundColor: '#DCECF0' }, navActive: { color: '#173B59', fontWeight: '900' }, locationRequest: { marginTop: 12, padding: 14, borderRadius: 14, backgroundColor: '#EAF9F4', borderWidth: 1, borderColor: '#B9EED7', gap: 4 }, locationRequestTitle: { color: '#087C70', fontWeight: '900', fontSize: 14 }, locationSharingText: { color: '#087C70', fontWeight: '900', marginTop: 12 }, routeBox: { flexDirection: 'row', alignItems: 'stretch', gap: 10, borderWidth: 1, borderColor: '#C9D7DE', borderRadius: 16, padding: 14, marginTop: 8, backgroundColor: '#F8FBFC' }, routePoint: { flex: 1, minWidth: 0 }, routeLabel: { color: '#6C7D88', fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginBottom: 4 }, routeCity: { color: '#173B59', fontSize: 17, lineHeight: 21, fontWeight: '900' }, routeAddress: { color: '#647985', fontSize: 12, lineHeight: 17, marginTop: 3 }, routeArrow: { alignSelf: 'center', color: '#8BA0AC', fontSize: 26, fontWeight: '800' }, appVersion: { color: '#8BA0AC', fontSize: 12, marginTop: 12, letterSpacing: 0.2 }, chatCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, chatReference: { color: '#087C70', backgroundColor: '#DDF7E8', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, fontSize: 12, fontWeight: '900', letterSpacing: 0.4 }, chatSubtitle: { color: '#087C70', fontSize: 16, fontWeight: '900', letterSpacing: 0.2 }, openDetailHint: { color: '#173B59', fontSize: 12, fontWeight: '800', marginTop: 8 }, detailSectionTitle: { color: '#173B59', fontSize: 16, fontWeight: '900', marginTop: 16, marginBottom: 4 }, timeline: { gap: 10, marginVertical: 8 }, timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, timelineDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#DDE7EC', alignItems: 'center', justifyContent: 'center' }, timelineDotActive: { backgroundColor: '#18B95D' }, timelineCheck: { color: '#fff', fontSize: 12, fontWeight: '900' }, timelineLabel: { color: '#8BA0AC', fontSize: 14, fontWeight: '700' }, timelineLabelActive: { color: '#173B59', fontWeight: '900' }, tripCard: { borderWidth: 2, borderColor: '#8AD9BF', shadowOpacity: 0.1, shadowRadius: 10 }, chatCard: { borderWidth: 2, borderColor: '#B9D8E5', shadowOpacity: 0.08, shadowRadius: 8 } })
Object.assign(styles, { buttonContent: { minHeight: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, buttonIcon: { color: '#173B59', fontSize: 16, fontWeight: '900' }, locationButton: { backgroundColor: '#18B95D', borderColor: '#18B95D' }, stopButton: { backgroundColor: '#FDE8E7', borderWidth: 1, borderColor: '#E86A5B' }, coloredButtonText: { color: '#fff' }, stopButtonText: { color: '#B42318' } })
Object.assign(styles, { button: { backgroundColor: '#173B59', minHeight: 48, paddingVertical: 14, paddingHorizontal: 18, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginTop: 10, borderWidth: 1.5, borderColor: '#0D2C45' }, buttonLight: { backgroundColor: '#E8F1F3', borderWidth: 1.5, borderColor: '#8DB8C9' }, buttonText: { color: '#fff', fontWeight: '800' }, buttonTextLight: { color: '#173B59' }, buttonIcon: { color: '#fff', fontSize: 16, fontWeight: '900' } })
Object.assign(styles, { modalBackdrop: { flex: 1, backgroundColor: 'rgba(23, 59, 89, 0.42)', alignItems: 'center', justifyContent: 'center', padding: 24 }, tregoModal: { width: '100%', maxWidth: 360, backgroundColor: '#F8FBFC', borderRadius: 26, padding: 24, borderWidth: 2, borderColor: '#B9D8E5', shadowColor: '#173B59', shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 }, modalIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#DDF7E8', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 12 }, modalIconText: { color: '#118443', fontSize: 26, fontWeight: '900' }, modalTitle: { color: '#173B59', fontSize: 22, lineHeight: 27, fontWeight: '900', textAlign: 'center' }, modalMessage: { color: '#647985', fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10 } })
Object.assign(styles, { incomingBackdrop: { flex: 1, backgroundColor: 'rgba(8, 30, 48, 0.72)', justifyContent: 'flex-end' }, incomingDelivery: { backgroundColor: '#F8FBFC', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 24, paddingBottom: 30, gap: 16, borderTopWidth: 3, borderColor: '#19AA78', elevation: 12 }, incomingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, incomingEyebrow: { color: '#087C70', fontSize: 12, fontWeight: '900', letterSpacing: 1.4 }, incomingTitle: { color: '#173B59', fontSize: 28, lineHeight: 34, fontWeight: '900', marginTop: 4 }, incomingIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#DDF7E8', fontSize: 34, textAlign: 'center', textAlignVertical: 'center' }, incomingRoute: { flexDirection: 'row', alignItems: 'stretch', gap: 10, borderRadius: 18, padding: 16, backgroundColor: '#EAF4F7', borderWidth: 1, borderColor: '#C9D7DE' }, incomingPoint: { flex: 1, minWidth: 0 }, incomingLabel: { color: '#6C7D88', fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginBottom: 5 }, incomingAddress: { color: '#173B59', fontSize: 16, lineHeight: 21, fontWeight: '900' }, incomingArrow: { alignSelf: 'center', color: '#087C70', fontSize: 24, fontWeight: '900' }, incomingShared: { color: '#087C70', backgroundColor: '#E3F6EF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, lineHeight: 21, fontWeight: '900', textAlign: 'center' }, incomingFacts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }, incomingFact: { color: '#647985', fontSize: 14 }, incomingFactStrong: { color: '#173B59', fontWeight: '900' }, incomingPrice: { color: '#087C70', fontSize: 22, fontWeight: '900', marginLeft: 'auto' }, incomingActions: { flexDirection: 'row', gap: 12, marginTop: 4 }, incomingReject: { flex: 1, minHeight: 58, borderRadius: 16, borderWidth: 2, borderColor: '#C9D7DE', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }, incomingRejectText: { color: '#173B59', fontSize: 17, fontWeight: '900' }, incomingAccept: { flex: 1.35, minHeight: 58, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#19AA78' }, incomingAcceptText: { color: '#fff', fontSize: 17, fontWeight: '900' }, incomingDisabled: { opacity: 0.55 } })
Object.assign(styles, { actionButton: { borderWidth: 1.5 }, proposeButton: { backgroundColor: '#168F83', borderColor: '#087C70' }, acceptButton: { backgroundColor: '#18B95D', borderColor: '#118443' }, statusButton: { backgroundColor: '#173B59', borderColor: '#0D2C45' }, chatButton: { backgroundColor: '#6F8FA3', borderColor: '#587687' }, detailButton: { backgroundColor: '#E8F1F3', borderColor: '#8DB8C9' }, detailButtonText: { color: '#173B59' } })
Object.assign(styles, { routeTypeBackdrop: { flex: 1, backgroundColor: 'rgba(23, 59, 89, 0.48)', alignItems: 'center', justifyContent: 'center', padding: 20 }, routeTypeModal: { width: '100%', maxWidth: 430, borderRadius: 28, padding: 22, backgroundColor: '#F8FBFC', borderWidth: 2, borderColor: '#B9D8E5', shadowColor: '#173B59', shadowOpacity: 0.24, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 10 }, routeTypeTitle: { color: '#173B59', fontSize: 24, lineHeight: 29, fontWeight: '900', textAlign: 'center' }, routeTypeSubtitle: { color: '#647985', fontSize: 15, textAlign: 'center', marginTop: 7, marginBottom: 18 }, routeTypeOptions: { flexDirection: 'row', gap: 12 }, routeTypeOption: { flex: 1, minHeight: 190, borderRadius: 22, borderWidth: 2, padding: 16, alignItems: 'center', justifyContent: 'center' }, routeTypeIcon: { fontSize: 42, lineHeight: 48, fontWeight: '900', marginBottom: 12 }, routeTypeOptionText: { fontSize: 20, lineHeight: 24, fontWeight: '900', textAlign: 'center' }, routeTypeOptionHint: { color: '#647985', fontSize: 12, lineHeight: 16, fontWeight: '700', textAlign: 'center', marginTop: 9 } })
Object.assign(styles, { emptyState: { alignItems: 'center', paddingVertical: 28 }, emptyStateIcon: { fontSize: 52, marginBottom: 10 }, emptyStateTitle: { color: '#173B59', fontSize: 22, fontWeight: '900', textAlign: 'center' }, emptyStateText: { color: '#647985', fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 8 } })
Object.assign(styles, { routeCardEntrance: { width: '100%' } })
Object.assign(styles, { routeEditIcon: { color: '#087C70', fontSize: 22, fontWeight: '900', marginHorizontal: 4 } })
Object.assign(styles, { routesTopHeader: { position: 'relative' }, routesFloatingAction: { position: 'absolute', top: 18, right: 0, width: 52, height: 52, borderRadius: 26, backgroundColor: '#173B59', borderWidth: 2, borderColor: '#0D2C45', alignItems: 'center', justifyContent: 'center', shadowColor: '#173B59', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 5 }, routesFloatingIcon: { color: '#fff', fontSize: 30, lineHeight: 32, fontWeight: '700' }, navTripsItem: { minWidth: 78, minHeight: 74, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#D8E4E8', borderRadius: 20, transform: [{ translateY: -6 }] }, navTripsIcon: { fontSize: 38, lineHeight: 41, color: '#0067D8' } })
Object.assign(styles, { routeCargoBlock: { padding: 15, marginTop: 10, borderRadius: 16, backgroundColor: '#F1F6F8', borderWidth: 1.5, borderColor: '#C9DDE5', gap: 6 }, routeCargoCancelled: { backgroundColor: '#FCFAFA', borderColor: '#E8C9C7' }, routeCargoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingBottom: 8, marginBottom: 2, borderBottomWidth: 1, borderBottomColor: '#D5E3E8' }, routeCargoCode: { color: '#173B59', fontSize: 14, fontWeight: '900', letterSpacing: 0.7 }, routeCargoState: { color: '#087C70', fontSize: 12, fontWeight: '900' }, navTripsItem: { backgroundColor: 'transparent' }, navTripsIcon: { color: '#0067D8' } })
Object.assign(styles, { loadingCard: { minHeight: 300, position: 'relative', overflow: 'hidden', justifyContent: 'center' }, loadingBlurredContent: { opacity: 0.42, transform: [{ scale: 1.02 }] }, loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(248, 251, 252, 0.62)' }, loadingLogo: { width: 58, height: 58, borderRadius: 16, marginBottom: 16, opacity: 0.9 }, loadingText: { color: '#087C70', fontSize: 16, fontWeight: '900', marginTop: 14 } })
Object.assign(styles, { fullLoadingBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(231, 240, 244, 0.30)' }, screenLoadingOverlay: { minHeight: 620, marginHorizontal: -8, marginTop: 10, borderRadius: 24, backgroundColor: 'rgba(231, 240, 244, 0.30)', alignItems: 'center', justifyContent: 'center', padding: 24 }, screenLoadingSurface: { width: 280, minHeight: 180, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 24, backgroundColor: 'transparent' }, screenLoadingLogo: { width: 64, height: 64, borderRadius: 14, marginBottom: 18 }, loadingBarTrack: { width: 190, height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: '#D7E8E8' }, loadingBarIndicator: { width: 82, height: 5, borderRadius: 3, backgroundColor: '#087C70' }, screenLoadingText: { color: '#087C70', fontSize: 17, fontWeight: '900', marginTop: 16, textAlign: 'center' } })
Object.assign(styles, { segmentedControl: { flexDirection: 'row', backgroundColor: '#E8F1F3', borderRadius: 16, padding: 4, gap: 4, marginBottom: 4 }, segmentButton: { flex: 1, minHeight: 44, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, segmentButtonActive: { backgroundColor: '#173B59' }, segmentButtonText: { color: '#5F7483', fontSize: 13, fontWeight: '800', textAlign: 'center' }, segmentButtonTextActive: { color: '#fff' } })
Object.assign(styles, { reviewsSection: { gap: 12, marginTop: 4 }, reviewsSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderRadius: 18, backgroundColor: '#EAF9F4', borderWidth: 2, borderColor: '#B9EED7' }, reviewAverage: { color: '#173B59', fontSize: 28, fontWeight: '900', marginTop: 4 }, reviewStar: { color: '#F1A83B', fontSize: 24 }, reviewStars: { color: '#F1A83B', fontSize: 18, fontWeight: '900', letterSpacing: 1 }, reviewCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, reviewDate: { color: '#8BA0AC', fontSize: 12, fontWeight: '700' }, reviewComment: { color: '#173B59', fontSize: 15, lineHeight: 22, fontWeight: '600', marginTop: 4 }, reviewPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 4 }, reviewPill: { color: '#087C70', backgroundColor: '#DDF7E8', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, fontWeight: '800' }, reviewCard: { borderColor: '#C9DDE5', borderRadius: 16 } })
Object.assign(styles, { deliveryInfoGrid: { marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: '#F2F8FA', borderWidth: 1, borderColor: '#C9DDE5', gap: 7 }, strongText: { color: '#173B59', fontWeight: '900' }, priceText: { color: '#087C70', fontWeight: '900', fontSize: 16 } })
Object.assign(styles, { distanceHint: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: '#EAF9F4', borderWidth: 1, borderColor: '#B9EED7' }, distanceHintIcon: { color: '#087C70', fontSize: 20, fontWeight: '900' }, distanceHintText: { flex: 1, color: '#087C70', fontSize: 13, fontWeight: '800' } })
Object.assign(styles, { navIcon: { color: '#173B59', fontSize: 26, lineHeight: 29, fontWeight: '900', marginBottom: 2 }, navIconRow: { height: 31, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 4 }, navBadge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: '#E85C53', color: '#fff', fontSize: 11, fontWeight: '900', textAlign: 'center', lineHeight: 18 }, navItem: { minWidth: 58, minHeight: 60, paddingHorizontal: 5, paddingVertical: 5, borderRadius: 15, alignItems: 'center', justifyContent: 'center', gap: 1 }, navItemActive: { minWidth: 72, minHeight: 68, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: '#D8E4E8' }, navText: { fontSize: 13, fontWeight: '900', color: '#173B59' }, navActive: { color: '#087C70', fontWeight: '900' }, proposalStatus: { color: '#087C70', fontSize: 14, fontWeight: '900', marginTop: 4 }, proposalStatusClosed: { color: '#7C8B95', fontSize: 14, fontWeight: '900', marginTop: 4 }, proposalCardActive: { borderColor: '#52C99B', backgroundColor: '#F0FBF5', shadowColor: '#087C70', shadowOpacity: 0.12, shadowRadius: 10 }, proposalCardClosed: { borderColor: '#B8C2C8', backgroundColor: '#F0F3F4', opacity: 0.78, shadowOpacity: 0 } })
Object.assign(styles, { tripActionTile: { flexDirection: 'row', alignItems: 'center', minHeight: 72, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 28, marginTop: 10, gap: 14 }, tripActionRoute: { backgroundColor: '#08A878', borderWidth: 1, borderColor: '#078E68' }, tripActionShare: { backgroundColor: '#E3F6EF', borderWidth: 1, borderColor: '#B9EED7' }, tripActionStatus: { backgroundColor: '#073C61', borderWidth: 1, borderColor: '#062F4C' }, tripActionChat: { backgroundColor: '#E3EAF0', borderWidth: 1, borderColor: '#C5D3DC' }, tripActionIcon: { width: 34, textAlign: 'center', color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '900' }, tripActionCopy: { flex: 1, gap: 2 }, tripActionTitle: { color: '#fff', fontSize: 16, fontWeight: '900' }, tripActionSubtitle: { color: '#E9F7F2', fontSize: 13, lineHeight: 18 }, tripActionArrow: { color: '#fff', fontSize: 32, lineHeight: 32, fontWeight: '400' }, tripActionLightText: { color: '#087C70' }, tripActionLightSubtitle: { color: '#168F83' } })
Object.assign(styles, { chatHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, chatHeaderAction: { marginTop: 18, minWidth: 72, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14, backgroundColor: '#E3F6EF', borderWidth: 1, borderColor: '#B9EED7' }, chatHeaderActionIcon: { color: '#087C70', fontSize: 22, lineHeight: 22, fontWeight: '900' }, chatHeaderActionText: { color: '#087C70', fontSize: 11, fontWeight: '900', marginTop: 2 } })
Object.assign(styles, { chatSearchInput: { backgroundColor: '#fff', borderWidth: 2, borderColor: '#B9D8E5', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13, color: '#173B59', fontSize: 15, marginBottom: 2 } })
Object.assign(styles, { availabilityWrap: { width: '100%', gap: 5 }, availabilityControl: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, borderRadius: 27, backgroundColor: '#fff', borderWidth: 1, borderColor: '#DDE7EC' }, availabilityDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#C9D7DE' }, availabilityDotOn: { backgroundColor: '#19AA78' }, availabilitySpinner: { marginLeft: 2 }, availabilityText: { flex: 1, color: '#173B59', fontWeight: '900', fontSize: 14 }, availabilitySwitch: { width: 48, height: 28, padding: 4, borderRadius: 14, backgroundColor: '#DDE7EC' }, availabilitySwitchOn: { backgroundColor: '#8AE7BC' }, availabilityDisabled: { opacity: 0.6 }, availabilityThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#173F61' }, availabilityThumbOn: { transform: [{ translateX: 20 }] }, availabilityError: { color: '#B42318', backgroundColor: '#FEE4E2', borderRadius: 10, padding: 8, fontSize: 12 } })
Object.assign(styles, { serviceTypeTag: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }, serviceTypeTagIcon: { fontSize: 16, fontWeight: '900' }, serviceTypeTagText: { fontSize: 13, fontWeight: '900' }, serviceFreightTag: { backgroundColor: '#E2F0FF' }, serviceFreightText: { color: '#0067D8' }, serviceDeliveryTag: { backgroundColor: '#E2F5EB' }, serviceDeliveryText: { color: '#007548' }, routeCreateOptions: { gap: 10, marginTop: 4 }, routeCreateOption: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, padding: 15, borderWidth: 1.5 }, serviceFreightOption: { backgroundColor: '#E2F0FF', borderColor: '#9CCBFF' }, serviceDeliveryOption: { backgroundColor: '#E2F5EB', borderColor: '#9DDEC1' }, routeCreateIcon: { color: '#173B59', fontSize: 25, fontWeight: '900' }, routeCard: { borderColor: '#94B9CC', marginTop: 4 }, routeHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 }, routeStatus: { color: '#087C70', fontSize: 13, fontWeight: '900' }, routeChevron: { color: '#647985', fontSize: 24 }, routeCounterToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 42, borderTopWidth: 1, borderTopColor: '#DDE7EC', marginTop: 7, paddingTop: 8 }, packageIcon: { color: '#087C70', fontSize: 20, fontWeight: '900' }, routeTabs: { flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: '#DDE7EC', marginTop: 8, paddingTop: 10 }, routeTab: { flex: 1, alignItems: 'center', borderRadius: 14, paddingVertical: 11, backgroundColor: '#EEF5F7' }, routeTabActive: { backgroundColor: '#DCECF0' }, routeTabText: { color: '#173B59', fontSize: 13, fontWeight: '900' }, formRow: { flexDirection: 'row', gap: 10 }, formHalf: { flex: 1 }, formActions: { gap: 4 }, nativeSelect: { borderWidth: 1, borderColor: '#C9D7DE', borderRadius: 12, backgroundColor: '#fff' }, nativeSelectText: { padding: 14 }, suggestionCard: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#70A8C5', borderRadius: 18, padding: 15, marginTop: 10, gap: 5, backgroundColor: '#FBFDFF' }, suggestionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, suggestionLabel: { color: '#0067D8', fontSize: 12, fontWeight: '900' }, suggestionSparkle: { color: '#0067D8', fontSize: 20 }, suggestionIntro: { color: '#087C70', fontSize: 16, fontWeight: '900', marginTop: 12 }, suggestionActions: { flexDirection: 'row', gap: 8 }, suggestionActionsButton: { flex: 1 }, warningText: { color: '#9A5B00', backgroundColor: '#FFF3DA', borderRadius: 10, padding: 8, fontSize: 13, fontWeight: '800' } })
Object.assign(styles, { routeFormTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }, addressSuggestions: { marginTop: 4, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#C9DDE5', overflow: 'hidden', shadowColor: '#173B59', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 }, addressSuggestion: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 58, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E8F0F3' }, addressSuggestionIcon: { color: '#0067D8', fontSize: 22, fontWeight: '900' }, addressSuggestionPrimary: { color: '#173B59', fontSize: 15, fontWeight: '800' }, addressSuggestionSecondary: { color: '#647985', fontSize: 12, lineHeight: 17, marginTop: 2 } })
Object.assign(styles, { homeContent: { paddingTop: 20, gap: 14 }, homeBrand: { color: '#173B59', fontSize: 38, fontWeight: '900', letterSpacing: -1.8 }, homeSummaryRow: { flexDirection: 'row', gap: 12 }, homeSummaryCard: { flex: 1, minHeight: 116, borderRadius: 18, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5 }, homeSummaryBlue: { backgroundColor: '#EAF3FF', borderColor: '#B8D8FF' }, homeSummaryGreen: { backgroundColor: '#E6F8EE', borderColor: '#B9E8CE' }, homeSummaryIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.55)', textAlign: 'center', textAlignVertical: 'center', fontSize: 29 }, homeSummaryCopy: { flex: 1, minWidth: 0, gap: 3 }, homeSummaryTitle: { color: '#173B59', fontSize: 17, fontWeight: '900', flexShrink: 0 }, homeSummaryValue: { color: '#173B59', fontSize: 30, lineHeight: 32, fontWeight: '900' }, homeSummaryChevron: { color: '#173B59', fontSize: 34, lineHeight: 34, fontWeight: '400', width: 20, textAlign: 'center' }, homeActionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, homeActionHalf: { flex: 1 }, homeActionFull: { flex: 1 }, marketplaceSearchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 }, marketplaceSearchBox: { flex: 1, minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#D5E3E8' }, marketplaceSearchIcon: { color: '#173B59', fontSize: 28, lineHeight: 30 }, marketplaceSearchInput: { flex: 1, paddingVertical: 8, color: '#173B59', fontSize: 15 }, marketplaceFilter: { width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#D5E3E8' }, marketplaceFilterIcon: { color: '#173B59', fontSize: 29, lineHeight: 30 }, availableHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 } })
Object.assign(styles, { homeActionStack: { width: '100%', gap: 12 } })
Object.assign(styles, { marketplaceSearchReveal: { overflow: 'hidden', width: '100%' } })
Object.assign(styles, { deliveryTakeCard: { padding: 20, borderRadius: 28, borderColor: '#B9D8E5', backgroundColor: '#fff' }, deliveryTakeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, deliveryTakeTitle: { color: '#173B59', fontSize: 28, lineHeight: 32, fontWeight: '900', marginTop: 3 }, deliveryTakeIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#DDF7E8', textAlign: 'center', textAlignVertical: 'center', fontSize: 40 }, deliveryRoutePanel: { flexDirection: 'row', gap: 14, marginTop: 18, padding: 14, borderRadius: 20, backgroundColor: '#EAF3F8' }, deliveryRouteRail: { width: 30, alignItems: 'center', paddingTop: 9 }, deliveryRouteCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 5, borderColor: '#0BAA7B', backgroundColor: '#fff' }, deliveryRoutePin: { backgroundColor: '#0BAA7B', borderColor: '#0BAA7B' }, deliveryRouteLine: { width: 4, height: 50, backgroundColor: '#45A98F' }, deliveryRouteStops: { flex: 1, gap: 18 }, deliveryRouteStop: { gap: 2 }, deliveryRouteLabel: { color: '#647985', fontSize: 12, letterSpacing: 1.5, fontWeight: '900' }, deliveryRouteAddress: { color: '#173B59', fontSize: 22, lineHeight: 27, fontWeight: '900' }, deliveryRoutePlace: { color: '#647985', fontSize: 16, lineHeight: 21 }, deliveryFactsRow: { flexDirection: 'row', gap: 8, marginTop: 16 }, deliveryFact: { flex: 1, minHeight: 74, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 6, borderRadius: 18, backgroundColor: '#EAF3F8' }, deliveryFactIcon: { color: '#087C70', fontSize: 25 }, deliveryFactValue: { color: '#173B59', fontSize: 15, fontWeight: '900', textAlign: 'center' } })
