import { sceneRegistry } from '@pascal-app/core'
import { setSurfaceRaycastLayers, useViewer } from '@pascal-app/viewer'
import { useFirstPersonHud } from '@pascal-app/viewer/ui'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { type Object3D, Raycaster, Vector2 } from 'three'

/**
 * Walking on foot, the interactable in reach under the crosshair (a door, a window, a lamp,
 * anything with an E prompt) wears the selection outline, the same white edge a selected roof
 * gets, so you can see what E will act on.
 *
 * Both walk paths already decide the target; this only draws it. The live scene's controller
 * puts it in `hoveredId` (pulsing blue hover outline), which moves into the selection pass.
 * The bake keeps its target to itself and empties the outliner every frame while walking, so
 * while its HUD shows a prompt the same reticle ray is cast again here to find the object.
 *
 * Runs after every priority-0 frame callback (the bake's outliner reset among them) and before
 * the post-processing render at priority 1.
 */
const OUTLINE_FRAME_PRIORITY = 0.5
/** The bake's reticle reach, metres (`WALK_REACH` in the viewer's GLB scene). */
const GLB_WALK_REACH = 3

const centre = new Vector2(0, 0)
const raycaster = new Raycaster()
setSurfaceRaycastLayers(raycaster.layers)
raycaster.far = GLB_WALK_REACH

function identityAncestor(object: Object3D | null): Object3D | null {
  for (let current = object; current; current = current.parent) {
    if (current.userData.pascalId) return current
  }
  return null
}

function removeFrom(list: Object3D[], object: Object3D) {
  const index = list.indexOf(object)
  if (index !== -1) list.splice(index, 1)
}

type Props = {
  /** Baked objects by pascalId; omit on the live scene. */
  glbObjects?: ReadonlyMap<string, Object3D>
  /** The bake's HUD shows an interaction prompt: something in reach is under the crosshair. */
  glbTargeting?: boolean
}

export function WalkInteractOutline({ glbObjects, glbTargeting = false }: Props) {
  // The bake's root: the topmost ancestor of its objects under the scene.
  const glbRoot = useMemo(() => {
    const first = glbObjects?.values().next().value
    let root = first ?? null
    while (root?.parent && root.parent.type !== 'Scene') root = root.parent
    return root
  }, [glbObjects])
  const added = useRef<Object3D | null>(null)

  useFrame(({ camera }) => {
    const { outliner, hoveredId } = useViewer.getState()
    let target: Object3D | null = null
    if (glbObjects) {
      if (glbTargeting && glbRoot) {
        raycaster.setFromCamera(centre, camera)
        target = identityAncestor(raycaster.intersectObject(glbRoot, true)[0]?.object ?? null)
      }
    } else if (hoveredId && useFirstPersonHud.getState().interact) {
      target = sceneRegistry.nodes.get(hoveredId) ?? null
    }

    const previous = added.current
    if (previous && previous !== target) {
      removeFrom(outliner.selectedObjects, previous)
      added.current = null
    }
    if (!target) return
    removeFrom(outliner.hoveredObjects, target)
    if (!outliner.selectedObjects.includes(target)) {
      outliner.selectedObjects.push(target)
      added.current = target
    }
  }, OUTLINE_FRAME_PRIORITY)

  // Leaving the walk takes the outline with it.
  useEffect(() => () => {
    if (added.current) removeFrom(useViewer.getState().outliner.selectedObjects, added.current)
    added.current = null
  }, [])

  return null
}
