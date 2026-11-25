/* Ported from home-assistant/frontend (Apache-2.0):
   - src/data/climate.ts
   - src/data/feature/climate_entity_feature.ts
   - src/common/entity/supports-feature.ts
   - src/common/entity/state_active.ts
   - src/resources/theme/color/color.globals.ts */

import {
  mdiAccountArrowRight,
  mdiArrowAll,
  mdiArrowLeftRight,
  mdiArrowOscillating,
  mdiArrowOscillatingOff,
  mdiArrowUpDown,
  mdiBed,
  mdiCircleMedium,
  mdiFan,
  mdiFanAuto,
  mdiFanOff,
  mdiFanSpeed1,
  mdiFanSpeed2,
  mdiFanSpeed3,
  mdiFire,
  mdiHome,
  mdiLeaf,
  mdiMotionSensor,
  mdiPower,
  mdiRocketLaunch,
  mdiSnowflake,
  mdiSofa,
  mdiSpeedometer,
  mdiSpeedometerMedium,
  mdiSpeedometerSlow,
  mdiSunSnowflakeVariant,
  mdiThermometer,
  mdiThermostat,
  mdiThermostatAuto,
  mdiTuneVariant,
  mdiWaterPercent,
  mdiWeatherWindy,
} from '@mdi/js'
import type { HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'

export const ClimateEntityFeature = {
  TARGET_TEMPERATURE: 1,
  TARGET_TEMPERATURE_RANGE: 2,
  TARGET_HUMIDITY: 4,
  FAN_MODE: 8,
  PRESET_MODE: 16,
  SWING_MODE: 32,
  AUX_HEAT: 64,
  TURN_OFF: 128,
  TURN_ON: 256,
  SWING_HORIZONTAL_MODE: 512,
} as const

export const HVAC_MODES = ['auto', 'heat_cool', 'heat', 'cool', 'dry', 'fan_only', 'off'] as const
export type HvacMode = (typeof HVAC_MODES)[number]

export type HvacAction =
  | 'cooling'
  | 'defrosting'
  | 'drying'
  | 'fan'
  | 'heating'
  | 'idle'
  | 'off'
  | 'preheating'

export const UNAVAILABLE = 'unavailable'
export const UNKNOWN = 'unknown'

export function supportsFeature(stateObj: HassEntity, feature: number): boolean {
  return (Number(stateObj.attributes.supported_features ?? 0) & feature) !== 0
}

export function climateStateActive(state: string): boolean {
  return state !== 'off' && state !== UNAVAILABLE && state !== UNKNOWN
}

const hvacModeOrdering: Record<string, number> = Object.fromEntries(
  HVAC_MODES.map((mode, index) => [mode, index]),
)

export function compareClimateHvacModes(mode1: string, mode2: string): number {
  const o1 = hvacModeOrdering[mode1] ?? HVAC_MODES.length
  const o2 = hvacModeOrdering[mode2] ?? HVAC_MODES.length
  return o1 - o2
}

export const CLIMATE_HVAC_ACTION_TO_MODE: Readonly<Record<string, HvacMode>> = {
  cooling: 'cool',
  defrosting: 'heat',
  drying: 'dry',
  fan: 'fan_only',
  heating: 'heat',
  idle: 'off',
  off: 'off',
  preheating: 'heat',
}

/** Exact Home Assistant climate/humidifier state hex colors from color.globals.ts. */
export const HA_CLIMATE_COLORS = {
  auto: '#4caf50',
  cool: '#2196f3',
  dry: '#ff9800',
  fan_only: '#00bcd4',
  heat: '#ff6f22',
  heat_cool: '#ffc107',
  inactive: '#9e9e9e',
  humidifierOn: '#2196f3',
} as const

export function climateStateColor(state: string): string {
  if (state === UNAVAILABLE) return 'var(--muted-foreground)'
  if (!climateStateActive(state)) return HA_CLIMATE_COLORS.inactive
  switch (state) {
    case 'auto': return HA_CLIMATE_COLORS.auto
    case 'cool': return HA_CLIMATE_COLORS.cool
    case 'dry': return HA_CLIMATE_COLORS.dry
    case 'fan_only': return HA_CLIMATE_COLORS.fan_only
    case 'heat': return HA_CLIMATE_COLORS.heat
    case 'heat_cool': return HA_CLIMATE_COLORS.heat_cool
    default: return HA_CLIMATE_COLORS.heat_cool
  }
}

export function climateActionColor(state: string, action?: string): string | undefined {
  if (!action || action === 'idle' || action === 'off' || !climateStateActive(state)) {
    return undefined
  }
  const mappedMode = CLIMATE_HVAC_ACTION_TO_MODE[action]
  return mappedMode ? climateStateColor(mappedMode) : undefined
}

export function humidifierStateColor(active: boolean): string {
  return active ? HA_CLIMATE_COLORS.humidifierOn : HA_CLIMATE_COLORS.inactive
}

export const CLIMATE_HVAC_MODE_ICONS: Readonly<Record<string, string>> = {
  cool: mdiSnowflake,
  dry: mdiWaterPercent,
  fan_only: mdiFan,
  auto: mdiThermostatAuto,
  heat: mdiFire,
  off: mdiPower,
  heat_cool: mdiSunSnowflakeVariant,
}

export function climateHvacModeIcon(mode: string): string {
  return CLIMATE_HVAC_MODE_ICONS[mode] ?? mdiThermostat
}

/** Static named-import lookup table for `mdi:*` names returned by `frontend/get_icons`. */
const MDI_BY_NAME: Readonly<Record<string, string>> = {
  'mdi:account-arrow-right': mdiAccountArrowRight,
  'mdi:arrow-all': mdiArrowAll,
  'mdi:arrow-left-right': mdiArrowLeftRight,
  'mdi:arrow-oscillating': mdiArrowOscillating,
  'mdi:arrow-oscillating-off': mdiArrowOscillatingOff,
  'mdi:arrow-up-down': mdiArrowUpDown,
  'mdi:bed': mdiBed,
  'mdi:circle-medium': mdiCircleMedium,
  'mdi:fan': mdiFan,
  'mdi:fan-auto': mdiFanAuto,
  'mdi:fan-off': mdiFanOff,
  'mdi:fan-speed-1': mdiFanSpeed1,
  'mdi:fan-speed-2': mdiFanSpeed2,
  'mdi:fan-speed-3': mdiFanSpeed3,
  'mdi:fire': mdiFire,
  'mdi:home': mdiHome,
  'mdi:leaf': mdiLeaf,
  'mdi:motion-sensor': mdiMotionSensor,
  'mdi:power': mdiPower,
  'mdi:rocket-launch': mdiRocketLaunch,
  'mdi:snowflake': mdiSnowflake,
  'mdi:sofa': mdiSofa,
  'mdi:speedometer': mdiSpeedometer,
  'mdi:speedometer-medium': mdiSpeedometerMedium,
  'mdi:speedometer-slow': mdiSpeedometerSlow,
  'mdi:sun-snowflake-variant': mdiSunSnowflakeVariant,
  'mdi:thermometer': mdiThermometer,
  'mdi:thermostat': mdiThermostat,
  'mdi:thermostat-auto': mdiThermostatAuto,
  'mdi:tune-variant': mdiTuneVariant,
  'mdi:water-percent': mdiWaterPercent,
  'mdi:weather-windy': mdiWeatherWindy,
}

/** Offline fallback attribute value icons matching Home Assistant's climate component icons.json. */
const STATIC_CLIMATE_ATTRIBUTE_ICONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  preset_mode: {
    none: mdiCircleMedium,
    eco: mdiLeaf,
    away: mdiAccountArrowRight,
    boost: mdiRocketLaunch,
    comfort: mdiSofa,
    home: mdiHome,
    sleep: mdiBed,
    activity: mdiMotionSensor,
  },
  fan_mode: {
    off: mdiFanOff,
    auto: mdiFanAuto,
    on: mdiFan,
    low: mdiSpeedometerSlow,
    medium: mdiSpeedometerMedium,
    middle: mdiSpeedometerMedium,
    high: mdiSpeedometer,
    top: mdiSpeedometer,
    diffuse: mdiWeatherWindy,
  },
  swing_mode: {
    off: mdiArrowOscillatingOff,
    on: mdiArrowOscillating,
    vertical: mdiArrowUpDown,
    horizontal: mdiArrowLeftRight,
    both: mdiArrowAll,
  },
  swing_horizontal_mode: {
    off: mdiArrowOscillatingOff,
    on: mdiArrowOscillating,
  },
}

/**
 * Resolves a climate attribute value icon: first via Home Assistant's `frontend/get_icons`
 * (`entity` then `entity_component`) mapped through the static named-import table, then via the
 * offline built-in climate map, and finally falling back to the select menu's default icon.
 */
export function resolveClimateAttributeIcon(
  entity: HassEntity,
  attribute: string,
  value: string | undefined,
  formatters: EntityFormatters,
  fallbackPath: string,
): string {
  const iconName = formatters.resolveAttributeIconName(entity, attribute, value)
  if (iconName) {
    const resolved = MDI_BY_NAME[iconName]
    if (resolved) return resolved
  }
  if (value !== undefined) {
    const builtIn = STATIC_CLIMATE_ATTRIBUTE_ICONS[attribute]?.[value]
    if (builtIn) return builtIn
  }
  return fallbackPath
}
