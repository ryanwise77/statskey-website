import type { StrengthSession, StrengthSet } from './model.ts'

export function recordedSetStart(
  session: StrengthSession,
  set: StrengthSet,
): number | null {
  const start = set.startedAt
    ? (set.startedAt.getTime() - session.startDate.getTime()) / 1000
    : set.completedAt && set.durationSeconds
      ? (set.completedAt.getTime() - session.startDate.getTime()) / 1000 -
        set.durationSeconds
      : undefined
  return start != null && Number.isFinite(start) ? start : null
}
export function recordedSetRange(
  session: StrengthSession,
  set: StrengthSet,
): [number, number] | null {
  const start = recordedSetStart(session, set)
  const end = set.completedAt
    ? (set.completedAt.getTime() - session.startDate.getTime()) / 1000
    : start != null && set.durationSeconds
      ? start + set.durationSeconds
      : undefined
  return start != null && end != null && Number.isFinite(end) && end > start
    ? [start, end]
    : null
}
export function videoTrimRange(
  start: number,
  end: number,
  offset: number,
  duration: number,
): [number, number] | null {
  if (
    ![start, end, offset, duration].every(Number.isFinite) ||
    end <= start ||
    duration < 1
  )
    return null
  const lower = Math.max(0, start - offset),
    upper = Math.min(duration, end - offset)
  return upper - lower >= 1 ? [lower, upper] : null
}
export function alignStrengthVideo(
  session: StrengthSession,
  set: StrengthSet | undefined,
  position: number,
  duration: number,
  fallbackLength: number,
): { offset?: number; range: [number, number] } | null {
  if (
    ![position, duration].every(Number.isFinite) ||
    position < 0 ||
    duration - position < 1
  )
    return null
  const recorded = set
    ? recordedSetRange(session, set)
    : session.endDate
      ? [0, (session.endDate.getTime() - session.startDate.getTime()) / 1000]
      : null
  const start = set ? recordedSetStart(session, set) : 0
  const length = recorded
    ? recorded[1] - recorded[0]
    : (set?.durationSeconds ?? fallbackLength)
  return {
    offset: start != null ? start - position : undefined,
    range: [
      position,
      Math.min(
        duration,
        position +
          (Number.isFinite(length) && length > 0 ? Math.max(1, length) : 1),
      ),
    ],
  }
}
export function recordingMimeType(
  supported: (type: string) => boolean,
): string | null {
  return (
    [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find(supported) ?? null
  )
}

export function strengthVideoExportProblem(audio: boolean): string | null {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof HTMLCanvasElement === 'undefined' ||
    typeof HTMLCanvasElement.prototype.captureStream !== 'function'
  )
    return 'This browser can preview clips but cannot export them. Try a current Safari, Chrome, Edge, or Firefox browser.'
  if (audio && typeof AudioContext === 'undefined')
    return 'Audio export is unavailable in this browser. Turn off Keep source audio to export a silent clip.'
  try {
    if (!recordingMimeType((type) => MediaRecorder.isTypeSupported(type)))
      return 'This browser has no supported video encoder. You can still preview your selected clip.'
  } catch {
    return 'This browser cannot check video export support. You can still preview your selected clip.'
  }
  return null
}

export async function exportStrengthClip(options: {
  source: string
  start: number
  end: number
  audio: boolean
  signal: AbortSignal
  progress: (value: number) => void
}): Promise<Blob> {
  const { source, start, end, audio, signal, progress } = options
  if (typeof MediaRecorder === 'undefined')
    throw new Error(
      'Video export is not supported in this browser. You can still preview your selection.',
    )
  const mimeType = recordingMimeType((type) =>
    MediaRecorder.isTypeSupported(type),
  )
  if (!mimeType) throw new Error('This browser has no supported video encoder.')
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end - start < 1 ||
    end - start > 300
  )
    throw new Error('Select a clip between 1 second and 5 minutes.')

  const operation = new AbortController()
  const abort = () =>
    operation.abort(new DOMException('Cancelled', 'AbortError'))
  const hidden = () => {
    if (document.hidden)
      operation.abort(
        new Error(
          'Export stopped because the tab became hidden. Keep this tab visible and try again.',
        ),
      )
  }
  signal.addEventListener('abort', abort, { once: true })
  document.addEventListener('visibilitychange', hidden)
  if (signal.aborted) abort()
  hidden()
  const video = document.createElement('video')
  video.src = source
  video.playsInline = true
  video.preload = 'auto'
  video.muted = !audio
  let context: AudioContext | undefined,
    stream: MediaStream | undefined,
    recorder: MediaRecorder | undefined
  let frame = 0,
    timer: ReturnType<typeof setTimeout> | undefined,
    finalizing: ReturnType<typeof setTimeout> | undefined,
    cleanupRecording = () => {}
  function check() {
    if (operation.signal.aborted) throw operation.signal.reason
  }
  function stage<T>(promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const cancelled = () => finish(operation.signal.reason)
      const timeout = setTimeout(
        () =>
          finish(
            new Error('The video took too long to prepare. Try another file.'),
          ),
        15_000,
      )
      function finish(error?: unknown, value?: T) {
        clearTimeout(timeout)
        operation.signal.removeEventListener('abort', cancelled)
        if (error) reject(error)
        else resolve(value as T)
      }
      operation.signal.addEventListener('abort', cancelled, { once: true })
      promise.then((value) => finish(undefined, value), finish)
      if (operation.signal.aborted) cancelled()
    })
  }
  async function mediaEvent(name: string, begin?: () => void): Promise<void> {
    let ok: () => void = () => {},
      fail: () => void = () => {}
    try {
      await stage(
        new Promise<void>((resolve, reject) => {
          ok = resolve
          fail = () =>
            reject(new Error('This video cannot be decoded by your browser.'))
          video.addEventListener(name, ok, { once: true })
          video.addEventListener('error', fail, { once: true })
          begin?.()
        }),
      )
    } finally {
      video.removeEventListener(name, ok)
      video.removeEventListener('error', fail)
    }
  }
  try {
    check()
    let destination: MediaStreamAudioDestinationNode | undefined
    if (audio) {
      if (typeof AudioContext === 'undefined')
        throw new Error('Audio export is unavailable. Turn off Keep source audio and try again.')
      context = new AudioContext()
      destination = context.createMediaStreamDestination()
      context.createMediaElementSource(video).connect(destination)
    }
    // Start both operations during the Export click. Awaiting metadata first
    // loses Safari's user gesture and can prevent videos with audio from playing.
    const audioReady = context ? stage(context.resume()) : Promise.resolve()
    const playbackReady = stage(video.play())
    await Promise.all([audioReady, playbackReady])
    if (video.readyState < 1) await mediaEvent('loadedmetadata')
    if (
      !Number.isFinite(video.duration) ||
      end > video.duration + 0.05 ||
      video.videoWidth <= 0 ||
      video.videoHeight <= 0
    )
      throw new Error('The selected range is outside this video.')
    if (start > 0 || video.currentTime > 0)
      await mediaEvent('seeked', () => {
        video.currentTime = start
      })
    if (video.readyState < 2) await mediaEvent('loadeddata')
    check()
    const canvas = document.createElement('canvas'),
      scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.max(2, Math.floor((video.videoWidth * scale) / 2) * 2)
    canvas.height = Math.max(2, Math.floor((video.videoHeight * scale) / 2) * 2)
    const drawing = canvas.getContext('2d')
    if (!drawing || typeof canvas.captureStream !== 'function')
      throw new Error('Video export is not supported in this browser.')
    drawing.drawImage(video, 0, 0, canvas.width, canvas.height)
    stream = canvas.captureStream(30)
    if (destination) {
      for (const track of destination.stream.getAudioTracks())
        stream.addTrack(track)
    }
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 6_000_000,
    })
    // Playback and seeking are ready before recording, avoiding frozen startup frames.
    check()
    const chunks: Blob[] = []
    let size = 0
    return await new Promise<Blob>((resolve, reject) => {
      let failure: Error | undefined,
        stopping = false,
        settled = false
      function finish() {
        if (settled) return
        settled = true
        cleanupRecording()
        if (failure) {
          reject(failure)
          return
        }
        const blob = new Blob(chunks, {
          type: recorder!.mimeType.split(';')[0],
        })
        if (blob.size) resolve(blob)
        else reject(new Error('No video frames were exported.'))
      }
      function stop(error?: Error) {
        if (settled) return
        // A final data chunk or encoder error can arrive after stop was requested.
        if (error) failure = error
        if (stopping) {
          if (error) finish()
          return
        }
        stopping = true
        video.pause()
        try {
          if (recorder!.state !== 'inactive') recorder!.stop()
          else finish()
          if (error) finish()
          else if (!settled)
            finalizing = setTimeout(() => {
              failure = new Error(
                'The browser could not finish the video file. Try a shorter clip.',
              )
              finish()
            }, 5000)
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error))
          finish()
        }
      }
      const cancelled = () => stop(operation.signal.reason)
      const mediaFailed = () =>
        stop(
          new Error('Video playback failed during export. Try another file.'),
        )
      const stalled = () =>
        stop(
          new Error(
            'Playback stalled during export. Try a shorter clip or another file.',
          ),
        )
      const ended = () =>
        stop(
          video.currentTime < end - 0.05
            ? new Error('Playback ended before the selected clip was complete.')
            : undefined,
        )
      cleanupRecording = () => {
        operation.signal.removeEventListener('abort', cancelled)
        video.removeEventListener('error', mediaFailed)
        video.removeEventListener('ended', ended)
        video.removeEventListener('waiting', stalled)
      }
      recorder!.ondataavailable = (event) => {
        if (event.data.size) {
          size += event.data.size
          if (size > 250 * 1024 * 1024)
            stop(new Error('This clip is too large. Choose a shorter range.'))
          else chunks.push(event.data)
        }
      }
      recorder!.onerror = () =>
        stop(
          new Error(
            'The browser could not encode this clip. Try a shorter video.',
          ),
        )
      recorder!.onstop = finish
      operation.signal.addEventListener('abort', cancelled, { once: true })
      video.addEventListener('error', mediaFailed, { once: true })
      video.addEventListener('ended', ended, { once: true })
      video.addEventListener('waiting', stalled, { once: true })
      timer = setTimeout(
        () => {
          failure = new Error(
            'Export stalled. Keep the video tab visible and try again.',
          )
          stop(failure)
          finish()
        },
        (end - start) * 1500 + 30_000,
      )
      const draw = () => {
        if (stopping || settled) return
        try {
          drawing.drawImage(video, 0, 0, canvas.width, canvas.height)
          progress(
            Math.min(
              1,
              Math.max(0, (video.currentTime - start) / (end - start)),
            ),
          )
          if (video.currentTime >= end - 1 / 60) stop()
          else frame = requestAnimationFrame(draw)
        } catch (error) {
          stop(error instanceof Error ? error : new Error(String(error)))
        }
      }
      check()
      recorder!.start(1000)
      draw()
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'NotAllowedError')
      throw new Error('Your browser blocked video playback. Preview the video, then try Export again, or turn off Keep source audio.')
    throw error
  } finally {
    // Settle any sibling preparation promise if playback or audio setup failed.
    operation.abort(new DOMException('Export finished', 'AbortError'))
    if (timer) clearTimeout(timer)
    if (finalizing) clearTimeout(finalizing)
    cleanupRecording()
    signal.removeEventListener('abort', abort)
    document.removeEventListener('visibilitychange', hidden)
    cancelAnimationFrame(frame)
    video.pause()
    if (recorder) {
      recorder.onstop = null
      recorder.ondataavailable = null
      recorder.onerror = null
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          /* Already stopped by the browser. */
        }
      }
    }
    stream?.getTracks().forEach((track) => track.stop())
    if (context) void context.close().catch(() => {})
    video.removeAttribute('src')
    video.load()
  }
}
