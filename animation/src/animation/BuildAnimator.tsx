import { emitter, sceneRegistry } from '@pascal-app/core'
import { showInScene } from '@pascal-app/viewer'
import type { ViewerSource } from '@pascal-app/viewer/ui'
import type { CameraControlsImpl } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { BlueprintLines, DustPool, GroundWaves } from './effects'
import { type BuildElement, type BuildSet, collectBuild } from './elements'
import { arrivalOf, createPose, poseAt, poseMatrix } from './poses'
import { useAnimationStore } from './store'
import { type Timeline, templateById } from './templates'

type Controls = InstanceType<typeof CameraControlsImpl>

/**
 * Plays the chosen template over the live scene. A run measures the build at rest, plans the
 * template's timeline and then, every frame before the render, poses each piece for the moment
 * (any moment can be shown at once, so scrubbing is free). When the run ends or stops, every
 * piece gets its own transform back and Pascal's batching takes over again.
 *
 * Pascal draws a floor's walls and repeated furniture as merged batches once the scene settles;
 * a batch would hold a piece at rest while its own mesh moves. During a run the batch meshes are
 * hidden and each piece draws itself; afterwards the batches re-sew from scratch (the same
 * hand-back Pascal does around a thumbnail capture).
 */

type Run = {
  set: BuildSet
  timeline: Timeline
  elements: Array<{
    element: BuildElement
    /** The parent's world matrix at rest, inverted, and the piece's own at rest. */
    parentRestInverse: THREE.Matrix4
    restWorld: THREE.Matrix4
    meshes: THREE.Mesh[]
    arrival: number
  }>
  hiddenBatches: Set<THREE.Object3D>
  dust: DustPool
  lines: BlueprintLines | null
  waves: GroundWaves | null
  time: number
  clock: number
  /** The person took the camera: the cinematic orbit leaves it to them for this run. */
  cameraTaken: boolean
}

const _motion = new THREE.Matrix4()
const _local = new THREE.Matrix4()
const _pose = createPose()

function levelRoots(): THREE.Object3D[] {
  const roots: THREE.Object3D[] = []
  for (const id of sceneRegistry.byType.level ?? []) {
    const root = sceneRegistry.nodes.get(id)
    if (root) roots.push(root)
  }
  return roots
}

/** Pieces draw themselves for the run: merged batch meshes hidden, originals back on the scene layer. */
function handBackBatches(run: Run) {
  for (const root of levelRoots()) {
    root.traverse((child) => {
      if ((child.name === 'wall-batch' || child.name === 'item-batch') && child.visible) {
        child.visible = false
        run.hiddenBatches.add(child)
      }
    })
  }
  for (const entry of run.elements) {
    for (const mesh of entry.meshes) {
      if (mesh.layers.isEnabled(0)) continue
      showInScene(mesh, 'wall-batched')
      showInScene(mesh, 'batched')
    }
  }
}

function restore(run: Run) {
  for (const { element } of run.elements) {
    const { object, rest } = element
    object.position.copy(rest.position)
    object.quaternion.copy(rest.quaternion)
    object.scale.copy(rest.scale)
    object.visible = rest.visible
  }
  for (const batch of run.hiddenBatches) batch.visible = true
  run.hiddenBatches.clear()
  run.dust.dispose()
  run.lines?.dispose()
  run.waves?.dispose()
  // Let the batching systems re-sew from a clean slate: the same hand-back and re-hold Pascal
  // runs around a thumbnail capture. Originals the batches still draw go back under them.
  emitter.emit('thumbnail:before-capture', undefined as never)
  emitter.emit('thumbnail:after-capture', undefined as never)
}

function startRun(source: ViewerSource, scene: THREE.Scene): Run | null {
  const set = collectBuild(source)
  if (!set) return null
  const template = templateById(useAnimationStore.getState().template)
  const timeline = template.build(set)
  const elements: Run['elements'] = []
  for (const element of set.elements) {
    const object = element.object
    object.updateWorldMatrix(true, false)
    const parentRestInverse = new THREE.Matrix4()
    if (object.parent) parentRestInverse.copy(object.parent.matrixWorld).invert()
    const meshes: THREE.Mesh[] = []
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh)
    })
    const track = timeline.tracks.get(element.id)
    elements.push({
      element,
      parentRestInverse,
      restWorld: object.matrixWorld.clone(),
      meshes,
      arrival: track ? track.start + track.duration * arrivalOf(track.motion) : Infinity,
    })
  }
  const dust = new DustPool()
  scene.add(dust.mesh)
  const lines = timeline.lines ? new BlueprintLines(set.elements, timeline.lines, template.accent) : null
  if (lines) scene.add(lines.group)
  const waves = timeline.waves ? new GroundWaves(timeline.waves) : null
  if (waves) scene.add(waves.group)
  return {
    set, timeline, elements, hiddenBatches: new Set(), dust, lines, waves,
    time: 0, clock: 0, cameraTaken: false,
  }
}

function applyPoses(run: Run, time: number) {
  const tracks = run.timeline.tracks
  for (const entry of run.elements) {
    const { element } = entry
    const object = element.object
    const pose = poseAt(element, tracks.get(element.id), time, run.clock, _pose)
    if (!pose.visible) {
      object.visible = false
      continue
    }
    object.visible = element.rest.visible
    if (pose.rest) {
      object.position.copy(element.rest.position)
      object.quaternion.copy(element.rest.quaternion)
      object.scale.copy(element.rest.scale)
      continue
    }
    // local = parentRest⁻¹ · M · restWorld: the motion in world space, carried into the parent's
    // frame as it stood at rest, so anything the parent does on top still carries the piece.
    poseMatrix(pose, _motion)
    _local.multiplyMatrices(entry.parentRestInverse, _motion).multiply(entry.restWorld)
    _local.decompose(object.position, object.quaternion, object.scale)
  }
}

/** Frames the build and gives the orbit a good starting height. */
function frameBuild(controls: Controls, set: BuildSet, spread: number) {
  const box = set.box.clone().expandByScalar(set.radius * spread)
  controls.fitToBox(box, true, { paddingTop: 0.4, paddingBottom: 0.8, paddingLeft: 0.4, paddingRight: 0.4 })
  controls.rotatePolarTo(Math.PI * 0.32, true)
}

export function BuildAnimator({ source, ready }: { source: ViewerSource; ready: boolean }) {
  const scene = useThree((state) => state.scene)
  const controls = useThree((state) => state.controls) as Controls | null
  const invalidate = useThree((state) => state.invalidate)
  const runRef = useRef<Run | null>(null)
  const runId = useAnimationStore((state) => state.runId)
  const status = useAnimationStore((state) => state.status)
  const sourceRef = useRef(source)
  sourceRef.current = source

  // A new run: put the last one back, measure at rest, plan, and go.
  useEffect(() => {
    if (!ready || runId === 0) return
    const previous = runRef.current
    if (previous) {
      restore(previous)
      runRef.current = null
    }
    const run = startRun(sourceRef.current, scene)
    if (!run) {
      useAnimationStore.setState({ status: 'idle', pieceCount: 0, duration: 0 })
      return
    }
    runRef.current = run
    const store = useAnimationStore.getState()
    useAnimationStore.setState({ duration: run.timeline.duration, pieceCount: run.elements.length })
    if (store.seekTo !== null) run.time = store.seekTo
    applyPoses(run, run.time)
    handBackBatches(run)
    if (store.cinematic && controls) {
      frameBuild(controls, run.set, useAnimationStore.getState().template === 'magnetic' ? 0.6 : 0.15)
    }
    invalidate()
  }, [runId, ready, scene, controls, invalidate])

  // Stopping puts everything back where it was.
  useEffect(() => {
    if (status !== 'idle' && status !== 'finished') return
    const run = runRef.current
    if (!run) return
    restore(run)
    runRef.current = null
    invalidate()
  }, [status, invalidate])

  // The person grabbing the camera ends the cinematic orbit for this run.
  useEffect(() => {
    if (!controls) return
    const take = () => {
      if (runRef.current) runRef.current.cameraTaken = true
    }
    controls.addEventListener('controlstart', take)
    return () => controls.removeEventListener('controlstart', take)
  }, [controls])

  // Unmounting (a new project, a crash fallback) must never leave the house half built.
  useEffect(() => () => {
    if (runRef.current) restore(runRef.current)
    runRef.current = null
  }, [])

  // Priority 0 runs before Pascal's render (priority 1), so every frame draws the pose it set.
  const lastFrameRef = useRef(0)
  useFrame(() => {
    const run = runRef.current
    const now = performance.now()
    // Wall-clock time, so a frame limiter or a slow GPU slows the picture, never the timeline.
    const dt = lastFrameRef.current ? Math.min((now - lastFrameRef.current) / 1000, 0.25) : 1 / 60
    lastFrameRef.current = now
    if (!run) return
    const state = useAnimationStore.getState()
    const previous = run.time
    let jumped = false
    if (state.seekTo !== null) {
      run.time = THREE.MathUtils.clamp(state.seekTo, 0, run.timeline.duration)
      useAnimationStore.setState({ seekTo: null })
      jumped = true
    } else if (state.status === 'playing') {
      run.time += dt * state.speed
    }
    run.clock += dt

    applyPoses(run, run.time)
    handBackBatches(run)

    // Dust where pieces arrive, only while playing forward (a scrub shows no dust storm).
    if (!jumped && state.status === 'playing' && run.time > previous) {
      for (const entry of run.elements) {
        if (entry.arrival > previous && entry.arrival <= run.time) {
          const track = run.timeline.tracks.get(entry.element.id)
          if (track?.dust) run.dust.puff(entry.element.box, track.dust, run.clock)
        }
      }
    }
    run.dust.update(run.clock, dt)
    run.lines?.update(run.time)
    run.waves?.update(run.time)

    if (state.status === 'playing' && state.cinematic && !run.cameraTaken && controls) {
      controls.rotate((run.timeline.orbit / run.timeline.duration) * dt * state.speed, 0, false)
    }

    if (Math.abs(state.time - run.time) > 1 / 30) useAnimationStore.setState({ time: run.time })
    if (state.status === 'playing' && run.time >= run.timeline.duration) {
      useAnimationStore.setState({ time: run.timeline.duration, status: 'finished' })
    }
    invalidate()
  })

  return null
}
