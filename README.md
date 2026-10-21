# Trego mobile

Cliente Expo/React Native para los flujos principales de Trego: inicio, publicación de carga, matches, alertas, viajes y perfil.

## Desarrollo

```bash
npm install
npm start
```

La app funciona en modo demo mientras no exista un login nativo. Solicita permiso de notificaciones y guarda localmente el token FCM pendiente en `trego.pendingPushToken`; no guarda ni empaqueta ninguna clave del backend.

## Push FCM

El cliente usa `@react-native-firebase/messaging`, compatible con el envío server-side implementado en la web. Para un build real hay que agregar:

- `google-services.json` en la raíz del proyecto, descargado desde Firebase.
- `GoogleService-Info.plist` en la raíz del proyecto, descargado desde Firebase.
- Un App ID Apple para `com.trego.app` con Push Notifications habilitado y una APNs key asociada en Firebase.

Después del login nativo, el token pendiente debe enviarse a `POST /api/mobile/register-device` mediante una sesión/token de usuario. El endpoint exige `MOBILE_API_KEY` y validación de usuario; esa credencial debe permanecer en el servidor y nunca ir en variables `EXPO_PUBLIC_*`.

## Funcionalidad pendiente de integración

Las pantallas y estados ya están preparados, pero las mutaciones reales de carga/viaje requieren completar el login mobile y su sesión API. La web ya expone `POST /api/mobile/cargas`, `POST /api/mobile/viajes` y el registro de dispositivos; el envío de una carga compatible dispara FCM a transportistas con viajes disponibles en el mismo origen.
