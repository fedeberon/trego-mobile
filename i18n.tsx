import AsyncStorage from '@react-native-async-storage/async-storage'
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import esCatalog from './messages/es.json'
import ptCatalog from './messages/pt-BR.json'
import enCatalog from './messages/en.json'
import sourceIndex from './messages/source-index.json'

export type Locale = 'es' | 'pt-BR' | 'en'
export const supportedLocales: Locale[] = ['es', 'pt-BR', 'en']
export const localeLabels: Record<Locale, string> = { es: 'Español', 'pt-BR': 'Português', en: 'English' }
const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://trego-eta.vercel.app').replace(/\/$/, '')
type Catalog = Record<string, string>
type CatalogResponse = { locale: Locale; version?: string; fallbackLocale?: 'es'; format?: string; messages: Catalog }

const catalogs: Record<Locale, Catalog> = { es: esCatalog as Catalog, 'pt-BR': ptCatalog as Catalog, en: enCatalog as Catalog }
const sourceToKey = sourceIndex as Record<string, string>
const sourceEntries = Object.entries(sourceToKey)
  .map(([source, key]) => ({ source, key }))
  .sort((a, b) => b.source.length - a.source.length)
const translationCache = new Map<string, string>()
let currentLocale: Locale = 'es'

function resolveLocale(value?: string | null): Locale {
  if (value === 'pt-BR' || value?.toLowerCase() === 'pt-br') return 'pt-BR'
  if (value === 'en' || value?.toLowerCase().startsWith('en')) return 'en'
  return 'es'
}

function replaceValues(value: string, values?: Record<string, string | number>) {
  if (!values) return value
  return value.replace(/\{(value\d+)\}/g, (_, key) => String(values[key] ?? `{${key}}`))
}

function templateRegex(template: string) {
  const parts = template.split(/(\{value\d+\})/g)
  return new RegExp(`^${parts.map(part => /^\{value\d+\}$/.test(part) ? '(.+?)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')}$`)
}

export function translateText(text: string, locale: Locale = currentLocale, values?: Record<string, string | number>) {
  const directKey = catalogs.es[text] ? text : sourceToKey[text]
  const direct = directKey ? catalogs[locale][directKey] || catalogs.es[directKey] : undefined
  if (direct) return replaceValues(direct, values)
  const cacheKey = `${locale}|${text}`
  const cached = translationCache.get(cacheKey)
  if (cached) return replaceValues(cached, values)
  for (const entry of sourceEntries) {
    if (!entry.source.includes('{value')) continue
    const match = text.match(templateRegex(entry.source))
    if (!match) continue
    const translated = catalogs[locale][entry.key] || catalogs.es[entry.key]
    if (!translated) continue
    const names = [...entry.source.matchAll(/\{(value\d+)\}/g)].map(item => item[1])
    const resolved = translated.replace(/\{(value\d+)\}/g, (_, name) => String(match[names.indexOf(name) + 1] ?? `{${name}}`))
    translationCache.set(cacheKey, resolved)
    return resolved
  }
  return text
}

export function t(keyOrText: string, values?: Record<string, string | number>) {
  return translateText(keyOrText, currentLocale, values)
}

export function getLocale(): Locale { return currentLocale }
export function intlLocale(locale: Locale = currentLocale) { return locale === 'pt-BR' ? 'pt-BR' : locale === 'en' ? 'en-US' : 'es-AR' }
export function formatNumber(value: number, options?: Intl.NumberFormatOptions) { return new Intl.NumberFormat(intlLocale(), options).format(value) }
export function formatDate(value: string | number | Date, options?: Intl.DateTimeFormatOptions) { return new Intl.DateTimeFormat(intlLocale(), options).format(new Date(value)) }
export function formatDateTime(value: string | number | Date, options?: Intl.DateTimeFormatOptions) { return new Intl.DateTimeFormat(intlLocale(), options || { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }

async function refreshCatalog(locale: Locale) {
  const etagKey = `trego.i18n.${locale}.etag`
  const versionKey = `trego.i18n.${locale}.version`
  const cached = await AsyncStorage.getItem(`trego.i18n.${locale}.messages`)
  if (cached) { try { catalogs[locale] = { ...catalogs.es, ...JSON.parse(cached) } } catch {} }
  const headers: Record<string, string> = { 'Accept-Language': locale }
  const etag = await AsyncStorage.getItem(etagKey)
  if (etag) headers['If-None-Match'] = etag
  try {
    const response = await fetch(`${API_URL}/api/i18n/${locale}`, { headers })
    if (response.status === 304) return
    if (!response.ok) return
    const body = await response.json() as CatalogResponse
    if (body.messages && body.format === 'trego-params-v1') {
      catalogs[locale] = { ...catalogs.es, ...body.messages }
      await AsyncStorage.multiSet([[`trego.i18n.${locale}.messages`, JSON.stringify(body.messages)], [versionKey, body.version || '']])
      const receivedEtag = response.headers.get('etag')
      if (receivedEtag) await AsyncStorage.setItem(etagKey, receivedEtag)
    }
  } catch {}
}

type I18nContextValue = { locale: Locale; setLocale: (locale: Locale) => Promise<void>; t: typeof t }
const I18nContext = createContext<I18nContextValue>({ locale: 'es', setLocale: async () => {}, t })
export function useI18n() { return useContext(I18nContext) }
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('es')
  useEffect(() => { AsyncStorage.getItem('trego.locale').then(value => { const next = resolveLocale(value); currentLocale = next; setLocaleState(next); return refreshCatalog(next) }).catch(() => undefined) }, [])
  useEffect(() => { currentLocale = locale; void refreshCatalog(locale) }, [locale])
  const setLocale = async (next: Locale) => { currentLocale = next; setLocaleState(next); await AsyncStorage.setItem('trego.locale', next); await refreshCatalog(next) }
  const value = useMemo(() => ({ locale, setLocale, t }), [locale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

