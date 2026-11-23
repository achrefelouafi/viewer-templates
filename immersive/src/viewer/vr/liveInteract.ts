import {
  type AnyNode,
  type AnyNodeId,
  DOOR_SWING_OPEN_ANGLE,
  type DoorNode,
  type ElevatorNode,
  emitter,
  getDisplayedDoorValue,
  getDisplayedWindowValue,
  getElevatorCabCenterZ,
  getElevatorCabDepth,
  getElevatorCabWidth,
  type InteractionSound,
  isOperableWindowType,
  isOperationDoorType,
  isScriptedNode,
  itemPrompt,
  nodeMechanism,
  nodeRegistry,
  openElevatorDoor,
  operateItem,
  requestElevatorLevel,
  resolveElevatorDispatchTarget,
  sceneRegistry,
  toggleDoorOpenState,
  toggleNodeMechanism,
  toggleWindowOpenState,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { operablePartFor, operableParts, type ProceduralItemNode } from '@pascal-app/core/procedural-items'
import { openingSettled, proceduralSettled, setSurfaceRaycastLayers } from '@pascal-app/viewer'
import { Box3, Matrix4, type Object3D, Ray, Raycaster, Vector3 } from 'three'

const INTERACT_DISTANCE = 2.5
const DOOR_LEAF_DEPTH = 0.08
const ELEVATOR_RIDE_PADDING = 0.18

const surfaceRaycaster = new Raycaster()
setSurfaceRaycastLayers(surfaceRaycaster.layers)
surfaceRaycaster.far = INTERACT_DISTANCE

const elevatorRaycaster = new Raycaster()
elevatorRaycaster.far = INTERACT_DISTANCE

const leafBox = new Box3()
const leafMatrix = new Matrix4()
const leafInverse = new Matrix4()
const leafLocalRay = new Ray()
const leafLocalHit = new Vector3()
const leafWorldHit = new Vector3()
const tempTranslate = new Matrix4()
const tempRotate = new Matrix4()
const tempTranslate2 = new Matrix4()
const localEye = new Vector3()
const worldEye = new Vector3()

export type LiveVrTarget =
  | { type: 'door'; id: AnyNodeId; distance: number }
  | { type: 'window'; id: AnyNodeId; distance: number }
  | { type: 'item'; id: AnyNodeId; distance: number }
  | { type: 'procedural'; id: AnyNodeId; partId?: string; kind?: string; distance: number }
  | { type: 'mechanism'; id: AnyNodeId; distance: number }
  | {
      type: 'elevator'
      id: AnyNodeId
      action: 'open-door' | 'request-level'
      buttonKind: 'cab' | 'landing'
      levelId?: AnyNodeId
      distance: number
    }

export interface VrInteractPrompt {
  label: string
  verb: string
}

interface ElevatorButtonData {
  elevatorId?: string
  kind?: 'cab' | 'landing'
  action?: 'open-door' | 'request-level'
  levelId?: string
  disabled?: boolean
}

function hasNativeLeaf(node: AnyNode | undefined): boolean {
  return Boolean(node && !isScriptedNode(node))
}

function isInsideElevatorCab(elevator: ElevatorNode, carY: number, eye: Vector3): boolean {
  const halfW = getElevatorCabWidth(elevator) / 2 - ELEVATOR_RIDE_PADDING
  const halfD = getElevatorCabDepth(elevator) / 2 - ELEVATOR_RIDE_PADDING
  const centerZ = getElevatorCabCenterZ(elevator)
  const cabH = Math.max(elevator.cabHeight, 1.4)
  return (
    Math.abs(eye.x) <= Math.max(halfW, 0.24) &&
    Math.abs(eye.z - centerZ) <= Math.max(halfD, 0.24) &&
    eye.y >= carY + 0.35 &&
    eye.y <= carY + cabH + 0.7
  )
}

function resolveElevatorButton(object: Object3D): {
  action: 'open-door' | 'request-level'
  buttonKind: 'cab' | 'landing'
  elevatorId: AnyNodeId
  levelId?: AnyNodeId
} | null {
  let current: Object3D | null = object
  while (current) {
    const candidate = current.userData.elevatorButton as ElevatorButtonData | undefined
    if (candidate?.disabled === true) return null
    if (typeof candidate?.elevatorId === 'string' && candidate.kind === 'cab' && candidate.action === 'open-door') {
      return {
        action: 'open-door',
        buttonKind: 'cab',
        elevatorId: candidate.elevatorId as AnyNodeId,
      }
    }
    if (
      typeof candidate?.elevatorId === 'string' &&
      typeof candidate.levelId === 'string' &&
      (candidate.kind === 'cab' || candidate.kind === 'landing')
    ) {
      return {
        action: 'request-level',
        buttonKind: candidate.kind,
        elevatorId: candidate.elevatorId as AnyNodeId,
        levelId: candidate.levelId as AnyNodeId,
      }
    }
    current = current.parent
  }
  return null
}

function resolveDoorTarget(ray: Ray, nodes: Record<string, AnyNode>): LiveVrTarget | null {
  surfaceRaycaster.ray.copy(ray)
  let closestId: AnyNodeId | null = null
  let closestDistance = INTERACT_DISTANCE

  for (const rawId of sceneRegistry.byType.door ?? []) {
    const doorId = rawId as AnyNodeId
    const node = nodes[doorId]
    if (node?.type !== 'door' || node.openingKind === 'opening' || !hasNativeLeaf(node)) continue
    if (node.segments.every((segment) => segment.type === 'empty')) continue
    const object = sceneRegistry.nodes.get(doorId)
    if (!object) continue
    object.updateWorldMatrix(true, true)

    const hit = surfaceRaycaster.intersectObject(object, true).find((i) => i.distance <= INTERACT_DISTANCE)
    if (hit && hit.distance < closestDistance) {
      closestId = doorId
      closestDistance = hit.distance
    }

    const door = node as DoorNode
    const leafW = door.width - 2 * door.frameThickness
    const leafH = door.height - door.frameThickness
    if (leafW <= 0 || leafH <= 0) continue
    const leafCenterY = -door.frameThickness / 2

    if (isOperationDoorType(door.doorType)) {
      leafMatrix.copy(object.matrixWorld).multiply(tempTranslate.makeTranslation(0, leafCenterY, 0))
    } else {
      const hingeX = door.hingesSide === 'right' ? leafW / 2 : -leafW / 2
      const swingSign = door.swingDirection === 'inward' ? 1 : -1
      const hingeSign = door.hingesSide === 'right' ? 1 : -1
      const currentSwing = useInteractive.getState().doors[doorId]?.swingAngle ?? door.swingAngle ?? 0
      const clampedSwing = Math.max(0, Math.min(DOOR_SWING_OPEN_ANGLE, currentSwing))
      leafMatrix
        .copy(object.matrixWorld)
        .multiply(tempTranslate.makeTranslation(hingeX, 0, 0))
        .multiply(tempRotate.makeRotationY(clampedSwing * swingSign * hingeSign))
        .multiply(tempTranslate2.makeTranslation(-hingeX, leafCenterY, 0))
    }

    leafInverse.copy(leafMatrix).invert()
    leafBox.min.set(-leafW / 2, -leafH / 2, -DOOR_LEAF_DEPTH / 2)
    leafBox.max.set(leafW / 2, leafH / 2, DOOR_LEAF_DEPTH / 2)
    leafLocalRay.copy(surfaceRaycaster.ray).applyMatrix4(leafInverse)
    const localHit = leafLocalRay.intersectBox(leafBox, leafLocalHit)
    if (!localHit) continue
    leafWorldHit.copy(localHit).applyMatrix4(leafMatrix)
    const dist = leafWorldHit.distanceTo(surfaceRaycaster.ray.origin)
    if (dist <= INTERACT_DISTANCE && dist < closestDistance) {
      closestId = doorId
      closestDistance = dist
    }
  }

  return closestId ? { type: 'door', id: closestId, distance: closestDistance } : null
}

function resolveWindowTarget(ray: Ray, nodes: Record<string, AnyNode>): LiveVrTarget | null {
  surfaceRaycaster.ray.copy(ray)
  let closestId: AnyNodeId | null = null
  let closestDistance = INTERACT_DISTANCE

  for (const rawId of sceneRegistry.byType.window ?? []) {
    const windowId = rawId as AnyNodeId
    const node = nodes[windowId]
    if (node?.type !== 'window' || node.openingKind === 'opening' || !hasNativeLeaf(node)) continue
    if (!isOperableWindowType(node.windowType)) continue
    const object = sceneRegistry.nodes.get(windowId)
    if (!object) continue
    const hit = surfaceRaycaster.intersectObject(object, true).find((i) => i.distance <= INTERACT_DISTANCE)
    if (hit && hit.distance < closestDistance) {
      closestId = windowId
      closestDistance = hit.distance
    }
  }

  return closestId ? { type: 'window', id: closestId, distance: closestDistance } : null
}

function resolveElevatorTarget(ray: Ray, eye: Vector3, nodes: Record<string, AnyNode>): LiveVrTarget | null {
  elevatorRaycaster.ray.copy(ray)
  worldEye.copy(eye)
  let closest: LiveVrTarget | null = null
  let closestDistance = INTERACT_DISTANCE

  for (const rawId of sceneRegistry.byType.elevator ?? []) {
    const elevatorId = rawId as AnyNodeId
    const node = nodes[elevatorId]
    if (node?.type !== 'elevator') continue
    const object = sceneRegistry.nodes.get(elevatorId)
    if (!object) continue
    const runtime = useInteractive.getState().elevators[elevatorId]
    object.updateWorldMatrix(true, true)
    let canUseCab = false
    if (runtime) {
      localEye.copy(worldEye)
      object.worldToLocal(localEye)
      canUseCab = isInsideElevatorCab(node, runtime.carY, localEye)
    }

    for (const hit of elevatorRaycaster.intersectObject(object, true)) {
      if (hit.distance > closestDistance) continue
      const target = resolveElevatorButton(hit.object)
      if (!target || target.elevatorId !== elevatorId) continue
      if (target.action === 'request-level' && (!target.levelId || nodes[target.levelId]?.type !== 'level')) continue
      if (target.buttonKind === 'cab' && !canUseCab) continue
      closest = {
        type: 'elevator',
        id: target.elevatorId,
        action: target.action,
        buttonKind: target.buttonKind,
        levelId: target.levelId,
        distance: hit.distance,
      }
      closestDistance = hit.distance
    }
  }

  return closest
}

/**
 * The nearest interactable on the live scene along `ray` (a controller's pointer, or the head's
 * forward ray): elevators, doors, windows, procedural items, catalog items, and mechanisms.
 * `eye` is the head, which decides whether the elevator cab's buttons are in reach.
 */
export function resolveLiveVrTarget(ray: Ray, eye: Vector3): LiveVrTarget | null {
  const nodes = useScene.getState().nodes

  const elevator = resolveElevatorTarget(ray, eye, nodes)
  if (elevator) return elevator
  const door = resolveDoorTarget(ray, nodes)
  if (door) return door
  const win = resolveWindowTarget(ray, nodes)
  if (win) return win

  surfaceRaycaster.ray.copy(ray)
  let closest: LiveVrTarget | null = null
  let closestDistance = INTERACT_DISTANCE
  const covered = new Set<string>()

  for (const rawId of sceneRegistry.byType['procedural-item'] ?? []) {
    covered.add(rawId)
    const id = rawId as AnyNodeId
    const node = nodes[id] as ProceduralItemNode | undefined
    if (node?.type !== 'procedural-item') continue
    if (!operableParts(node.recipe).length && !node.recipe.parts.some((part) => part.light)) continue
    const object = sceneRegistry.nodes.get(id)
    if (!object) continue

    for (const hit of surfaceRaycaster.intersectObject(object, true)) {
      if (hit.distance >= closestDistance) break
      let drawn = true
      for (let at: Object3D | null = hit.object; at && at !== object; at = at.parent) {
        if (!at.visible) {
          drawn = false
          break
        }
      }
      if (!drawn) continue

      let ancestor: Object3D | null = hit.object
      while (ancestor && ancestor !== object && !ancestor.userData.proceduralMotion) {
        ancestor = ancestor.parent
      }
      let motion = ancestor?.userData.proceduralMotion as { nodeId?: string; partId?: string; kind?: string } | undefined
      const ranges = hit.object.userData.proceduralRanges as Array<{ end: number; partId: string }> | undefined
      if (!motion && ranges && hit.faceIndex != null) {
        const face = hit.faceIndex
        const partId = ranges.find((range) => face < range.end)?.partId
        const part = partId ? operablePartFor(node.recipe, partId) : undefined
        if (part) motion = { nodeId: id, partId: part.id, kind: part.kind }
      }
      closest =
        motion?.nodeId === id && motion.partId
          ? { type: 'procedural', id, partId: motion.partId, kind: motion.kind, distance: hit.distance }
          : { type: 'procedural', id, distance: hit.distance }
      closestDistance = hit.distance
      break
    }
  }

  for (const rawId of sceneRegistry.byType.item ?? []) {
    covered.add(rawId)
    const id = rawId as AnyNodeId
    const node = nodes[id]
    if (node?.type !== 'item' || !node.asset.interactive?.controls.some((c) => c.kind === 'toggle')) continue
    const object = sceneRegistry.nodes.get(id)
    if (!object) continue
    const hit = surfaceRaycaster.intersectObject(object, true)[0]
    if (hit && hit.distance < closestDistance) {
      closest = { type: 'item', id, distance: hit.distance }
      closestDistance = hit.distance
    }
  }

  for (const kind of ['door', 'window'] as const) {
    for (const id of sceneRegistry.byType[kind] ?? []) {
      if (hasNativeLeaf(nodes[id as AnyNodeId])) covered.add(id)
    }
  }

  for (const [kind, kindIds] of Object.entries(sceneRegistry.byType)) {
    if (!nodeRegistry.get(kind)?.capabilities.mechanism) continue
    for (const rawId of kindIds) {
      if (covered.has(rawId)) continue
      const id = rawId as AnyNodeId
      if (!nodeMechanism(nodes[id])) continue
      const object = sceneRegistry.nodes.get(id)
      const hit = object && surfaceRaycaster.intersectObject(object, true)[0]
      if (hit && hit.distance < closestDistance) {
        closest = { type: 'mechanism', id, distance: hit.distance }
        closestDistance = hit.distance
      }
    }
  }

  return closest
}

export function resolveLiveHudInteract(target: LiveVrTarget | null): VrInteractPrompt | null {
  if (!target) return null
  if (target.type === 'elevator') {
    return {
      label: target.action === 'open-door' ? 'door button' : 'elevator button',
      verb: 'press',
    }
  }
  const node = useScene.getState().nodes[target.id]
  if (target.type === 'mechanism') {
    const mechanism = nodeMechanism(node)
    if (!node || !mechanism) return null
    const on = mechanism.isOn(node, useInteractive.getState())
    const verb = mechanism.verb === 'open' ? (on ? 'close' : 'open') : on ? 'turn off' : 'turn on'
    return { label: node.name ?? 'item', verb }
  }
  if (target.type === 'item') {
    if (node?.type !== 'item' || !node.asset.interactive) return null
    const { label, verb } = itemPrompt(target.id, node.name ?? node.asset.name, node.asset.interactive)
    return { label, verb }
  }
  if (target.type === 'procedural') {
    const procedural = node as ProceduralItemNode | undefined
    if (procedural?.type !== 'procedural-item') return null
    const parts = operableParts(procedural.recipe)
    if (parts.length === 0 && procedural.recipe.parts.some((part) => part.light)) {
      const state = useInteractive.getState()
      const isOn = state.procedural[target.id]?.lightsOn ?? state.lampDefault
      return { label: procedural.name ?? 'lights', verb: isOn ? 'turn off' : 'turn on' }
    }
    const part = target.partId ? parts.find((entry) => entry.id === target.partId) : undefined
    const active = useInteractive.getState().procedural[target.id]?.parts
    const isOn = part ? Boolean(active?.[part.id]) : parts.some((entry) => active?.[entry.id])
    const kind = part?.kind ?? (parts.every((entry) => entry.kind === 'spin') ? 'spin' : 'hinge')
    return {
      label: part?.label ?? procedural.name ?? 'item',
      verb: kind === 'spin' ? (isOn ? 'turn off' : 'turn on') : isOn ? 'close' : 'open',
    }
  }
  if (target.type === 'window') {
    if (node?.type !== 'window') return null
    const isOpen = getDisplayedWindowValue(target.id, node.operationState) > 0
    return { label: node.name || 'window', verb: isOpen ? 'close' : 'open' }
  }
  if (node?.type !== 'door') return null
  const isOpen = isOperationDoorType(node.doorType)
    ? getDisplayedDoorValue(target.id, 'operationState', node.operationState) > 0
    : getDisplayedDoorValue(target.id, 'swingAngle', node.swingAngle) > 0
  return { label: node.name || 'door', verb: isOpen ? 'close' : 'open' }
}

function playTargetSound(target: LiveVrTarget) {
  const verb = resolveLiveHudInteract(target)?.verb
  if (!verb || verb === 'press') return
  const node = useScene.getState().nodes[target.id]

  if (target.type === 'procedural' && (verb === 'open' || verb === 'close')) {
    if (verb === 'open') {
      emitter.emit('interaction:sound', 'panel-open')
      return
    }
    if (target.kind !== 'slide') emitter.emit('interaction:sound', 'panel-swing')
    void proceduralSettled(target.id).then(() => emitter.emit('interaction:sound', 'panel-close'))
    return
  }

  let sound: InteractionSound
  if (verb !== 'open' && verb !== 'close') {
    sound = verb === 'turn on' || verb === 'play' ? 'switch-on' : 'switch-off'
  } else if (node?.type === 'door' && node.doorType?.startsWith('garage-')) {
    sound = 'garage'
  } else if (node?.type === 'window') {
    sound = verb === 'open' ? 'window-open' : 'window-close'
  } else {
    sound = verb === 'open' ? 'door-open' : 'door-close'
  }

  if ((sound === 'door-close' || sound === 'window-close') && (target.type === 'door' || target.type === 'window') && node) {
    emitter.emit('interaction:sound', sound === 'door-close' ? 'door-swing' : 'window-swing')
    void openingSettled(node).then(() => emitter.emit('interaction:sound', sound))
    return
  }

  emitter.emit('interaction:sound', sound)
}

export function operateLiveVrTarget(target: LiveVrTarget | null) {
  if (!target) return
  playTargetSound(target)

  if (target.type === 'mechanism') {
    const node = useScene.getState().nodes[target.id]
    if (node) toggleNodeMechanism(node)
    return
  }
  if (target.type === 'item') {
    const node = useScene.getState().nodes[target.id]
    if (node?.type === 'item' && node.asset.interactive) operateItem(target.id, node.asset.interactive)
    return
  }
  if (target.type === 'procedural') {
    const node = useScene.getState().nodes[target.id] as ProceduralItemNode | undefined
    if (node?.type !== 'procedural-item') return
    const parts = operableParts(node.recipe).map((part) => part.id)
    const state = useInteractive.getState()
    if (parts.length === 0) {
      state.toggleProceduralLights(target.id)
      return
    }
    if (target.partId) state.toggleProceduralPart(target.id, target.partId)
    else state.setProceduralParts(target.id, parts, !parts.some((id) => state.procedural[target.id]?.parts[id]))
    return
  }
  if (target.type === 'elevator') {
    if (target.action === 'open-door') {
      openElevatorDoor(target.id)
      return
    }
    if (target.levelId) {
      const targetElevatorId =
        target.buttonKind === 'landing'
          ? resolveElevatorDispatchTarget({
              elevators: useInteractive.getState().elevators,
              levelId: target.levelId,
              nodes: useScene.getState().nodes,
              requestedElevatorId: target.id,
            })
          : target.id
      requestElevatorLevel(targetElevatorId, target.levelId)
    }
    return
  }
  if (target.type === 'window') {
    const node = useScene.getState().nodes[target.id]
    if (node?.type !== 'window' || node.openingKind === 'opening' || !isOperableWindowType(node.windowType)) return
    toggleWindowOpenState(target.id, { persist: false })
    return
  }
  const node = useScene.getState().nodes[target.id]
  if (node?.type !== 'door' || node.openingKind === 'opening') return
  toggleDoorOpenState(target.id, { persist: false })
}

export function objectForLiveVrTarget(target: LiveVrTarget | null): Object3D | null {
  if (!target) return null
  return sceneRegistry.nodes.get(target.id) ?? null
}
