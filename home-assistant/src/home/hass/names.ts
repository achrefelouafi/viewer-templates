/* Ported from home-assistant/frontend (Apache-2.0):
   - src/common/translations/entity-state.ts
   - src/common/entity/compute_state_display.ts
   - src/common/entity/compute_attribute_display.ts
   - src/common/number/format_number.ts
   - src/common/translations/blank_before_unit.ts & blank_before_percent.ts
   - src/data/entity/entity_attributes.ts
   - src/data/icons.ts (attributeIcon lookup order) */

import { useMemo } from 'react'
import { domainOf, type HassEntity } from '../entities'
import { type EntityRegistryInfo, type HassIcons, type IconTranslationEntry, useHass } from './connection'

/** Bundled English fallback for climate entity_component strings and HA UI strings used by climate controls. */
export const FALLBACK_RESOURCES: Readonly<Record<string, string>> = {
  // Default states
  'state.default.unknown': 'Unknown',
  'state.default.unavailable': 'Unavailable',

  // UI strings from home-assistant/frontend src/translations/en.json
  'ui.card.climate.mode': 'Mode',
  'ui.card.climate.humidity_target': 'Humidity target',
  'ui.dialogs.more_info_control.climate.temperature': 'Temperature',
  'ui.dialogs.more_info_control.climate.humidity': 'Humidity',
  'ui.components.climate-control.temperature_up': 'Increase temperature',
  'ui.components.climate-control.temperature_down': 'Decrease temperature',
  'ui.components.climate-control.lower_temperature_up': 'Increase lower target temperature',
  'ui.components.climate-control.lower_temperature_down': 'Decrease lower target temperature',
  'ui.components.climate-control.upper_temperature_up': 'Increase upper target temperature',
  'ui.components.climate-control.upper_temperature_down': 'Decrease upper target temperature',
  'ui.components.climate-control.humidity_up': 'Increase humidity',
  'ui.components.climate-control.humidity_down': 'Decrease humidity',
  'ui.components.attributes.names.assumed_state': 'Assumed state',
  'ui.components.attributes.names.attribution': 'Attribution',
  'ui.components.attributes.names.device_class': 'Device class',
  'ui.components.attributes.names.entity_picture': 'Entity picture',
  'ui.components.attributes.names.friendly_name': 'Friendly name',
  'ui.components.attributes.names.icon': 'Icon',
  'ui.components.attributes.names.supported_features': 'Supported features',
  'ui.components.attributes.names.unit_of_measurement': 'Unit of measurement',

  // Climate entity_component strings (offline fallback for /lab and missing translations)
  'component.climate.entity_component._.name': 'Thermostat',
  'component.climate.entity_component._.state.auto': 'Auto',
  'component.climate.entity_component._.state.cool': 'Cool',
  'component.climate.entity_component._.state.dry': 'Dry',
  'component.climate.entity_component._.state.fan_only': 'Fan only',
  'component.climate.entity_component._.state.heat': 'Heat',
  'component.climate.entity_component._.state.heat_cool': 'Heat/Cool',
  'component.climate.entity_component._.state.off': 'Off',
  'component.climate.entity_component._.state_attributes.current_humidity.name': 'Current humidity',
  'component.climate.entity_component._.state_attributes.current_temperature.name': 'Current temperature',
  'component.climate.entity_component._.state_attributes.fan_mode.name': 'Fan mode',
  'component.climate.entity_component._.state_attributes.fan_mode.state.auto': 'Auto',
  'component.climate.entity_component._.state_attributes.fan_mode.state.diffuse': 'Diffuse',
  'component.climate.entity_component._.state_attributes.fan_mode.state.focus': 'Focus',
  'component.climate.entity_component._.state_attributes.fan_mode.state.high': 'High',
  'component.climate.entity_component._.state_attributes.fan_mode.state.low': 'Low',
  'component.climate.entity_component._.state_attributes.fan_mode.state.medium': 'Medium',
  'component.climate.entity_component._.state_attributes.fan_mode.state.middle': 'Middle',
  'component.climate.entity_component._.state_attributes.fan_mode.state.off': 'Off',
  'component.climate.entity_component._.state_attributes.fan_mode.state.on': 'On',
  'component.climate.entity_component._.state_attributes.fan_mode.state.top': 'Top',
  'component.climate.entity_component._.state_attributes.humidity.name': 'Target humidity',
  'component.climate.entity_component._.state_attributes.hvac_action.name': 'Current action',
  'component.climate.entity_component._.state_attributes.hvac_action.state.cooling': 'Cooling',
  'component.climate.entity_component._.state_attributes.hvac_action.state.defrosting': 'Defrosting',
  'component.climate.entity_component._.state_attributes.hvac_action.state.drying': 'Drying',
  'component.climate.entity_component._.state_attributes.hvac_action.state.fan': 'Fan',
  'component.climate.entity_component._.state_attributes.hvac_action.state.heating': 'Heating',
  'component.climate.entity_component._.state_attributes.hvac_action.state.idle': 'Idle',
  'component.climate.entity_component._.state_attributes.hvac_action.state.off': 'Off',
  'component.climate.entity_component._.state_attributes.hvac_action.state.preheating': 'Preheating',
  'component.climate.entity_component._.state_attributes.preset_mode.name': 'Preset',
  'component.climate.entity_component._.state_attributes.preset_mode.state.activity': 'Activity',
  'component.climate.entity_component._.state_attributes.preset_mode.state.away': 'Away',
  'component.climate.entity_component._.state_attributes.preset_mode.state.boost': 'Boost',
  'component.climate.entity_component._.state_attributes.preset_mode.state.comfort': 'Comfort',
  'component.climate.entity_component._.state_attributes.preset_mode.state.eco': 'Eco',
  'component.climate.entity_component._.state_attributes.preset_mode.state.home': 'Home',
  'component.climate.entity_component._.state_attributes.preset_mode.state.none': 'None',
  'component.climate.entity_component._.state_attributes.preset_mode.state.sleep': 'Sleep',
  'component.climate.entity_component._.state_attributes.swing_horizontal_mode.name': 'Horizontal swing mode',
  'component.climate.entity_component._.state_attributes.swing_horizontal_mode.state.off': 'Off',
  'component.climate.entity_component._.state_attributes.swing_horizontal_mode.state.on': 'On',
  'component.climate.entity_component._.state_attributes.swing_mode.name': 'Swing mode',
  'component.climate.entity_component._.state_attributes.swing_mode.state.both': 'Both',
  'component.climate.entity_component._.state_attributes.swing_mode.state.horizontal': 'Horizontal',
  'component.climate.entity_component._.state_attributes.swing_mode.state.off': 'Off',
  'component.climate.entity_component._.state_attributes.swing_mode.state.on': 'On',
  'component.climate.entity_component._.state_attributes.swing_mode.state.vertical': 'Vertical',
  'component.climate.entity_component._.state_attributes.target_temp_high.name': 'Upper target temperature',
  'component.climate.entity_component._.state_attributes.target_temp_low.name': 'Lower target temperature',
  'component.climate.entity_component._.state_attributes.temperature.name': 'Target temperature',
}

const TEMPERATURE_ATTRIBUTES = new Set([
  'temperature',
  'current_temperature',
  'target_temperature',
  'target_temp_temp',
  'target_temp_high',
  'target_temp_low',
  'target_temp_step',
  'min_temp',
  'max_temp',
])

const DOMAIN_ATTRIBUTES_UNITS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  climate: {
    humidity: '%',
    current_humidity: '%',
    target_humidity_low: '%',
    target_humidity_high: '%',
    target_humidity_step: '%',
    min_humidity: '%',
    max_humidity: '%',
  },
  humidifier: {
    humidity: '%',
    current_humidity: '%',
    min_humidity: '%',
    max_humidity: '%',
    target_humidity_step: '%',
  },
}

const SPACE_BEFORE_PERCENT_LANGS = new Set(['cs', 'de', 'fi', 'fr', 'sk', 'sv'])

const numberFormatCache = new Map<string, Intl.NumberFormat>()

function getNumberFormatter(language: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify([language, options])
  let formatter = numberFormatCache.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(language, options)
    numberFormatCache.set(key, formatter)
  }
  return formatter
}

export function blankBeforeUnit(unit: string, language: string): string {
  if (unit === '°') return ''
  if (unit === '%') return SPACE_BEFORE_PERCENT_LANGS.has(language.split('-')[0] ?? language) ? '\u00A0' : ''
  return '\u00A0'
}

export function formatNumber(
  num: string | number,
  language = 'en',
  options?: Intl.NumberFormatOptions,
): string {
  const numeric = Number(num)
  if (Number.isNaN(numeric)) return String(num)
  const resolved: Intl.NumberFormatOptions = { maximumFractionDigits: 2, ...options }
  if (
    typeof num === 'string' &&
    (!options || (options.minimumFractionDigits === undefined && options.maximumFractionDigits === undefined))
  ) {
    const digits = Math.min(num.includes('.') ? (num.split('.')[1]?.length ?? 0) : 0, 100)
    resolved.minimumFractionDigits = digits
    resolved.maximumFractionDigits = digits
  }
  return getNumberFormatter(language, resolved).format(numeric)
}

function fallbackAttributeName(attribute: string): string {
  const spaced = attribute
    .replace(/_/g, ' ')
    .replace(/\bid\b/g, 'ID')
    .replace(/\bip\b/g, 'IP')
    .replace(/\bmac\b/g, 'MAC')
    .replace(/\bgps\b/g, 'GPS')
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : spaced
}

function pickIconFromEntry(
  entry: IconTranslationEntry | undefined,
  attribute: string,
  value: string | undefined,
): string | undefined {
  const attrIcons = entry?.state_attributes?.[attribute]
  if (!attrIcons) return undefined
  if (value !== undefined && attrIcons.state?.[value]) return attrIcons.state[value]
  return attrIcons.default
}

export type FormatContext = {
  language: string
  temperatureUnit: string
  translations: Record<string, string>
  registryOf: Record<string, EntityRegistryInfo>
  icons: HassIcons
}

export type EntityFormatters = {
  language: string
  temperatureUnit: string
  localize: (key: string) => string
  formatNumber: (num: string | number, options?: Intl.NumberFormatOptions) => string
  blankBeforeUnit: (unit: string) => string
  formatEntityState: (stateObj: HassEntity, state?: string) => string
  formatEntityAttributeName: (stateObj: HassEntity, attribute: string) => string
  formatEntityAttributeValue: (stateObj: HassEntity, attribute: string, value?: unknown) => string
  /** Returns the raw `mdi:*` icon name from HA's `frontend/get_icons` resources, if present. */
  resolveAttributeIconName: (stateObj: HassEntity, attribute: string, value?: string) => string | undefined
}

export const DEFAULT_FORMAT_CONTEXT: FormatContext = {
  language: 'en',
  temperatureUnit: '°C',
  translations: {},
  registryOf: {},
  icons: { entity_component: {}, entity: {} },
}

export function createFormatters(ctx: FormatContext = DEFAULT_FORMAT_CONTEXT): EntityFormatters {
  const localize = (key: string): string => {
    const live = ctx.translations[key]
    if (live) return live
    return FALLBACK_RESOURCES[key] ?? ''
  }

  const fmtNumber = (num: string | number, options?: Intl.NumberFormatOptions) =>
    formatNumber(num, ctx.language, options)

  const fmtBlankBeforeUnit = (unit: string) => blankBeforeUnit(unit, ctx.language)

  const formatEntityState = (stateObj: HassEntity, state?: string): string => {
    const s = state !== undefined ? state : stateObj.state
    if (s === 'unknown' || s === 'unavailable') {
      return localize(`state.default.${s}`) || s
    }
    const domain = domainOf(stateObj.entity_id)
    const dc = stateObj.attributes.device_class
    const entry = ctx.registryOf[stateObj.entity_id]
    return (
      (entry?.translation_key &&
        localize(`component.${entry.platform}.entity.${domain}.${entry.translation_key}.state.${s}`)) ||
      (dc && localize(`component.${domain}.entity_component.${dc}.state.${s}`)) ||
      localize(`component.${domain}.entity_component._.state.${s}`) ||
      s
    )
  }

  const formatEntityAttributeName = (stateObj: HassEntity, attribute: string): string => {
    const domain = domainOf(stateObj.entity_id)
    const dc = stateObj.attributes.device_class
    const entry = ctx.registryOf[stateObj.entity_id]
    return (
      (entry?.translation_key &&
        localize(
          `component.${entry.platform}.entity.${domain}.${entry.translation_key}.state_attributes.${attribute}.name`,
        )) ||
      (dc && localize(`component.${domain}.entity_component.${dc}.state_attributes.${attribute}.name`)) ||
      localize(`component.${domain}.entity_component._.state_attributes.${attribute}.name`) ||
      localize(`ui.components.attributes.names.${attribute}`) ||
      fallbackAttributeName(attribute)
    )
  }

  const formatEntityAttributeValue = (stateObj: HassEntity, attribute: string, value?: unknown): string => {
    const attrVal = value !== undefined ? value : stateObj.attributes[attribute]
    if (attrVal === null || attrVal === undefined) {
      return localize('state.default.unknown') || 'Unknown'
    }
    const domain = domainOf(stateObj.entity_id)
    if (typeof attrVal === 'number') {
      const formatted = fmtNumber(attrVal)
      const unit = TEMPERATURE_ATTRIBUTES.has(attribute)
        ? ctx.temperatureUnit
        : DOMAIN_ATTRIBUTES_UNITS[domain]?.[attribute]
      if (unit) return `${formatted}${fmtBlankBeforeUnit(unit)}${unit}`
      return formatted
    }
    if (Array.isArray(attrVal)) {
      return attrVal.map((item) => formatEntityAttributeValue(stateObj, attribute, item)).join(', ')
    }
    if (typeof attrVal === 'object') {
      return JSON.stringify(attrVal)
    }
    const strVal = String(attrVal)
    const dc = stateObj.attributes.device_class
    const entry = ctx.registryOf[stateObj.entity_id]
    return (
      (entry?.translation_key &&
        localize(
          `component.${entry.platform}.entity.${domain}.${entry.translation_key}.state_attributes.${attribute}.state.${strVal}`,
        )) ||
      (dc && localize(`component.${domain}.entity_component.${dc}.state_attributes.${attribute}.state.${strVal}`)) ||
      localize(`component.${domain}.entity_component._.state_attributes.${attribute}.state.${strVal}`) ||
      strVal
    )
  }

  const resolveAttributeIconName = (
    stateObj: HassEntity,
    attribute: string,
    value?: string,
  ): string | undefined => {
    const domain = domainOf(stateObj.entity_id)
    const dc = stateObj.attributes.device_class
    const entry = ctx.registryOf[stateObj.entity_id]
    const rawVal = value ?? (stateObj.attributes[attribute] != null ? String(stateObj.attributes[attribute]) : undefined)
    if (entry?.translation_key && entry.platform) {
      const platEntry = ctx.icons.entity[entry.platform]?.[domain]?.[entry.translation_key]
      const icon = pickIconFromEntry(platEntry, attribute, rawVal)
      if (icon) return icon
    }
    const compDomain = ctx.icons.entity_component[domain]
    if (compDomain) {
      const compEntry = (dc ? compDomain[dc] : undefined) ?? compDomain._
      const icon = pickIconFromEntry(compEntry, attribute, rawVal)
      if (icon) return icon
    }
    return undefined
  }

  return {
    language: ctx.language,
    temperatureUnit: ctx.temperatureUnit,
    localize,
    formatNumber: fmtNumber,
    blankBeforeUnit: fmtBlankBeforeUnit,
    formatEntityState,
    formatEntityAttributeName,
    formatEntityAttributeValue,
    resolveAttributeIconName,
  }
}

export const defaultFormatters = createFormatters(DEFAULT_FORMAT_CONTEXT)

/** Subscribes to Home Assistant's live translations, unit system, registry and icons (falls back to English/°C offline). */
export function useEntityFormatters(): EntityFormatters {
  const language = useHass((s) => s.language)
  const temperatureUnit = useHass((s) => s.temperatureUnit)
  const translations = useHass((s) => s.translations)
  const registryOf = useHass((s) => s.registryOf)
  const icons = useHass((s) => s.icons)
  return useMemo(
    () => createFormatters({ language, temperatureUnit, translations, registryOf, icons }),
    [language, temperatureUnit, translations, registryOf, icons],
  )
}
