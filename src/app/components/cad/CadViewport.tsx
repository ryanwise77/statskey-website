import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { CadBuildResult } from '../../lib/cad/types'

export interface CadMeasurement {
  start: [number, number, number]
  end: [number, number, number]
  distance: number
}

export interface CadViewportHandle {
  fitView: () => void
  clearMeasurement: () => void
}

interface CadViewportProps {
  result: CadBuildResult | null
  preview: boolean
  selected: boolean
  measureMode: boolean
  snapEnabled: boolean
  snapSize: number
  onSelectModel: () => void
  onMeasure: (measurement: CadMeasurement | null) => void
}

interface ViewportScene {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  modelGroup: THREE.Group
  measurementGroup: THREE.Group
  raycaster: THREE.Raycaster
  pointer: THREE.Vector2
  resizeObserver: ResizeObserver
  frameId: number
  fitView: () => void
  clearMeasurement: () => void
}

function snapPoint(
  point: THREE.Vector3,
  enabled: boolean,
  size: number
): THREE.Vector3 {
  if (!enabled || size <= 0) return point
  return point.set(
    Math.round(point.x / size) * size,
    Math.round(point.y / size) * size,
    Math.round(point.z / size) * size
  )
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose()
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material]
      for (const material of materials) material.dispose()
    }
  })
}

export const CadViewport = forwardRef<
  CadViewportHandle,
  CadViewportProps
>(function CadViewport(
  {
    result,
    preview,
    selected,
    measureMode,
    snapEnabled,
    snapSize,
    onSelectModel,
    onMeasure,
  },
  forwardedRef
) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<ViewportScene | null>(null)
  const measureModeRef = useRef(measureMode)
  const snapEnabledRef = useRef(snapEnabled)
  const snapSizeRef = useRef(snapSize)
  const onMeasureRef = useRef(onMeasure)
  const onSelectModelRef = useRef(onSelectModel)

  measureModeRef.current = measureMode
  snapEnabledRef.current = snapEnabled
  snapSizeRef.current = snapSize
  onMeasureRef.current = onMeasure
  onSelectModelRef.current = onSelectModel

  useImperativeHandle(
    forwardedRef,
    () => ({
      fitView: () => sceneRef.current?.fitView(),
      clearMeasurement: () => sceneRef.current?.clearMeasurement(),
    }),
    []
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x0a111b, 0.0018)

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10_000)
    camera.up.set(0, 0, 1)
    camera.position.set(130, -130, 105)

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.screenSpacePanning = true
    controls.target.set(0, 0, 0)
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN
    controls.update()

    const grid = new THREE.GridHelper(240, 48, 0x42607d, 0x24364a)
    grid.rotation.x = Math.PI / 2
    grid.position.z = -0.02
    const gridMaterial = grid.material as THREE.Material
    gridMaterial.transparent = true
    gridMaterial.opacity = 0.46
    scene.add(grid)

    const axes = new THREE.AxesHelper(32)
    axes.renderOrder = 2
    scene.add(axes)

    const hemisphere = new THREE.HemisphereLight(0xcce7ff, 0x172334, 2.3)
    scene.add(hemisphere)
    const key = new THREE.DirectionalLight(0xffffff, 3.2)
    key.position.set(80, -50, 130)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x7db7ff, 1.4)
    fill.position.set(-90, 80, 50)
    scene.add(fill)

    const modelGroup = new THREE.Group()
    modelGroup.name = 'cad-model'
    scene.add(modelGroup)
    const measurementGroup = new THREE.Group()
    measurementGroup.name = 'cad-measurement'
    scene.add(measurementGroup)
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let measurementStart: THREE.Vector3 | null = null
    let pointerDown: { x: number; y: number } | null = null

    const clearMeasurement = () => {
      measurementStart = null
      disposeObject(measurementGroup)
      measurementGroup.clear()
      onMeasureRef.current(null)
    }

    const fitView = () => {
      const box = new THREE.Box3().setFromObject(modelGroup)
      if (box.isEmpty()) {
        camera.position.set(130, -130, 105)
        controls.target.set(0, 0, 0)
        controls.update()
        return
      }
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const maximum = Math.max(size.x, size.y, size.z, 10)
      const distance =
        maximum /
        (2 * Math.tan((camera.fov * Math.PI) / 360)) *
        1.55
      const direction = new THREE.Vector3(1, -1, 0.78).normalize()
      camera.position.copy(center).addScaledVector(direction, distance)
      camera.near = Math.max(distance / 1_000, 0.01)
      camera.far = distance * 20
      camera.updateProjectionMatrix()
      controls.target.copy(center)
      controls.update()
    }

    const pickPoint = (event: PointerEvent): THREE.Vector3 | null => {
      const bounds = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const intersections = raycaster.intersectObjects(
        modelGroup.children,
        true
      )
      const hit = intersections.find(
        (intersection) => intersection.object instanceof THREE.Mesh
      )
      return hit
        ? snapPoint(
            hit.point.clone(),
            snapEnabledRef.current,
            snapSizeRef.current
          )
        : null
    }

    const addMeasurePoint = (point: THREE.Vector3) => {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(1.2, 20, 12),
        new THREE.MeshBasicMaterial({
          color: 0xffc45b,
          depthTest: false,
        })
      )
      marker.position.copy(point)
      marker.renderOrder = 5
      measurementGroup.add(marker)
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button === 0) {
        pointerDown = { x: event.clientX, y: event.clientY }
      }
    }
    const handlePointerUp = (event: PointerEvent) => {
      const movement = pointerDown
        ? Math.hypot(
            event.clientX - pointerDown.x,
            event.clientY - pointerDown.y
          )
        : Number.POSITIVE_INFINITY
      pointerDown = null
      if (event.button !== 0 || movement > 4) return
      const point = pickPoint(event)
      if (!point) return
      if (!measureModeRef.current) {
        onSelectModelRef.current()
        return
      }
      if (!measurementStart) {
        clearMeasurement()
        measurementStart = point
        addMeasurePoint(point)
        return
      }
      addMeasurePoint(point)
      const geometry = new THREE.BufferGeometry().setFromPoints([
        measurementStart,
        point,
      ])
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: 0xffc45b,
          depthTest: false,
        })
      )
      line.renderOrder = 5
      measurementGroup.add(line)
      onMeasureRef.current({
        start: measurementStart.toArray() as [number, number, number],
        end: point.toArray() as [number, number, number],
        distance: measurementStart.distanceTo(point),
      })
      measurementStart = null
    }
    renderer.domElement.addEventListener('pointerdown', handlePointerDown)
    renderer.domElement.addEventListener('pointerup', handlePointerUp)

    const resizeObserver = new ResizeObserver(() => {
      const width = Math.max(host.clientWidth, 1)
      const height = Math.max(host.clientHeight, 1)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    })
    resizeObserver.observe(host)

    let frameId = 0
    const render = () => {
      controls.update()
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(render)
      if (sceneRef.current) sceneRef.current.frameId = frameId
    }
    frameId = requestAnimationFrame(render)
    sceneRef.current = {
      renderer,
      scene,
      camera,
      controls,
      modelGroup,
      measurementGroup,
      raycaster,
      pointer,
      resizeObserver,
      frameId,
      fitView,
      clearMeasurement,
    }

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      renderer.domElement.removeEventListener('pointerup', handlePointerUp)
      controls.dispose()
      disposeObject(modelGroup)
      disposeObject(measurementGroup)
      renderer.dispose()
      renderer.domElement.remove()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    const viewport = sceneRef.current
    if (!viewport) return
    disposeObject(viewport.modelGroup)
    viewport.modelGroup.clear()
    const meshData = result?.mesh
    if (!meshData) return

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(meshData.positions, 3)
    )
    geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1))
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()

    const material = new THREE.MeshStandardMaterial({
      color: preview ? 0x7ab8ff : selected ? 0x6da9ec : 0x9aabc0,
      metalness: 0.18,
      roughness: 0.38,
      flatShading: true,
      transparent: preview,
      opacity: preview ? 0.78 : 1,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'solid-body'
    viewport.modelGroup.add(mesh)

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 24),
      new THREE.LineBasicMaterial({
        color: preview ? 0xcce4ff : selected ? 0xe2f2ff : 0x293b50,
        transparent: true,
        opacity: preview ? 0.8 : 0.72,
      })
    )
    edges.name = 'solid-edges'
    viewport.modelGroup.add(edges)
    viewport.clearMeasurement()
    viewport.fitView()
  }, [preview, result?.documentRevision, result?.mesh, selected])

  return (
    <div
      ref={hostRef}
      className={`cad-viewport-canvas${measureMode ? ' is-measuring' : ''}`}
      aria-label="Interactive 3D CAD viewport"
    />
  )
})
