'use strict'

// Preload for the hidden Fleet remote-session capture window. It owns the
// whole capture loop — getUserMedia on the desktop source, canvas downscale,
// JPEG encode — and streams frames to the main process. The page itself
// carries no logic; configuration arrives via the loadFile query string.
//
// Why not webContents.capturePage: on a hidden window capturePage does not
// get reliable paint events without offscreen rendering, and offscreen mode
// changes rendering semantics. getUserMedia with chromeMediaSource 'desktop'
// is the supported streaming path and works in a hidden, non-offscreen
// window with backgroundThrottling disabled.

const { ipcRenderer } = require('electron')

const params = new URLSearchParams(globalThis.location?.search || '')
const sourceId = String(params.get('sourceId') || '')
const fps = Math.max(1, Math.min(15, Number(params.get('fps')) || 8))
const maxDimension = Math.max(
  320,
  Math.min(3840, Number(params.get('maxDimension')) || 1600)
)
const quality = Math.max(0.3, Math.min(0.95, (Number(params.get('quality')) || 70) / 100))

function reportError(message) {
  ipcRenderer.send(
    'statskey-desktop:remote-capture-error',
    String(message || 'Capture failed.').slice(0, 300)
  )
}

async function startCapture() {
  if (!sourceId) {
    reportError('No screen source was provided to the capture window.')
    return
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxFrameRate: fps,
      },
    },
  })
  const track = stream.getVideoTracks()[0]
  if (!track) {
    reportError('The screen capture track is unavailable.')
    return
  }
  track.addEventListener('ended', () => reportError('The screen capture track ended.'))

  const video = document.createElement('video')
  video.muted = true
  video.srcObject = stream
  await video.play()

  const settings = track.getSettings()
  const sourceWidth = Number(settings.width) || video.videoWidth || 0
  const sourceHeight = Number(settings.height) || video.videoHeight || 0
  if (sourceWidth < 1 || sourceHeight < 1) {
    reportError('The screen capture dimensions are unavailable.')
    return
  }
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: false })
  ipcRenderer.send('statskey-desktop:remote-capture-ready', {
    width,
    height,
    scale,
  })

  let encoding = false
  const timer = setInterval(() => {
    if (encoding || video.readyState < 2) return
    encoding = true
    context.drawImage(video, 0, 0, width, height)
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          encoding = false
          return
        }
        blob
          .arrayBuffer()
          .then((bytes) => {
            ipcRenderer.send('statskey-desktop:remote-capture-frame', bytes)
          })
          .catch(() => {})
          .finally(() => {
            encoding = false
          })
      },
      'image/jpeg',
      quality
    )
  }, Math.round(1000 / fps))

  ipcRenderer.on('statskey-desktop:remote-capture-stop', () => {
    clearInterval(timer)
    for (const current of stream.getTracks()) current.stop()
  })
}

window.addEventListener('DOMContentLoaded', () => {
  startCapture().catch((error) => reportError(error?.message))
})
