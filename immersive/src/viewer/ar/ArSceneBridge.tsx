import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { WebGPURenderer } from 'three/webgpu'
import { useArStore } from './store'

/**
 * Mounted inside `<Viewer>` to publish the live R3F scene and WebGPURenderer to `useArStore`
 * so AR mode can build directly from the rendered scene without remounting the Canvas.
 */
export function ArSceneBridge({
  glbActive,
  sceneIdentity,
  ready,
}: {
  glbActive: boolean
  sceneIdentity: string
  ready: boolean
}) {
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer

  useEffect(() => {
    useArStore.getState().setSceneHandle({
      scene,
      gl,
      glbActive,
      sceneIdentity,
      sceneReady: ready,
    })
  }, [scene, gl, glbActive, sceneIdentity, ready])

  useEffect(() => () => useArStore.getState().clearSceneHandle(scene), [scene])

  return null
}
