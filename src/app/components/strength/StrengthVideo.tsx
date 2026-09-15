import { useEffect, useRef, useState } from 'react'
import {
  completedExercises,
  setDescription,
  type StrengthSession,
} from '../../lib/strength/model'
import {
  alignStrengthVideo,
  exportStrengthClip,
  recordedSetRange,
  videoTrimRange,
} from '../../lib/strength/video'
export function StrengthVideo({
  session,
  imperial,
}: {
  session: StrengthSession
  imperial: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="btn btn-secondary" onClick={() => setOpen(true)}>
        Clip a workout video
      </button>
      {open && (
        <VideoDialog
          session={session}
          imperial={imperial}
          close={() => setOpen(false)}
        />
      )}
    </>
  )
}
function VideoDialog({
  session,
  imperial,
  close,
}: {
  session: StrengthSession
  imperial: boolean
  close: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    video = useRef<HTMLVideoElement>(null),
    job = useRef<AbortController | null>(null)
  const [source, setSource] = useState<string | null>(null),
    [duration, setDuration] = useState(0),
    [start, setStart] = useState(0),
    [end, setEnd] = useState(0)
  const [target, setTarget] = useState('workout'),
    [offset, setOffset] = useState(0),
    [audio, setAudio] = useState(true),
    [exporting, setExporting] = useState(false),
    [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{
      url: string
      extension: string
      label: string
    } | null>(null),
    [error, setError] = useState('')
  const alive = useRef(true)
  const choices = completedExercises(session).flatMap((entry) =>
    entry.sets.map((set) => ({ entry, set })),
  )
  const choice = choices.find((c) => `${c.entry.id}/${c.set.id}` === target)
  const range = choice
    ? recordedSetRange(session, choice.set)
    : session.endDate
      ? [0, (session.endDate.getTime() - session.startDate.getTime()) / 1000]
      : null
  const mapped = range
    ? videoTrimRange(range[0], range[1], offset, duration)
    : null
  useEffect(() => {
    dialog.current?.showModal()
    alive.current = true
    return () => {
      alive.current = false
      job.current?.abort()
    }
  }, [])
  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source)
    },
    [source],
  )
  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url)
    },
    [result],
  )
  function resetResult() {
    setResult(null)
    setError('')
  }
  function applyTrim(range: [number, number]) {
    video.current?.pause()
    setStart(range[0])
    setEnd(range[1])
    if (video.current) video.current.currentTime = range[0]
    resetResult()
  }
  function align() {
    if (!video.current) return
    video.current.pause()
    const selection = alignStrengthVideo(
      session,
      choice?.set,
      video.current.currentTime,
      duration,
      end - start,
    )
    if (!selection) {
      setError('Choose a start with at least one second of footage remaining.')
      return
    }
    if (selection.offset != null) setOffset(selection.offset)
    applyTrim(selection.range)
  }
  async function render() {
    if (!source || exporting) return
    const controller = new AbortController()
    job.current = controller
    setExporting(true)
    setProgress(0)
    setError('')
    setResult(null)
    video.current?.pause()
    try {
      const blob = await exportStrengthClip({
        source,
        start,
        end,
        audio,
        signal: controller.signal,
        progress: (p) => {
          if (alive.current) setProgress(p)
        },
      })
      if (!alive.current || controller.signal.aborted) return
      const extension = blob.type.includes('mp4') ? 'mp4' : 'webm'
      const label = choice
        ? `${choice.entry.name}-Set-${choice.set.number}`
        : session.title
      setResult({
        url: URL.createObjectURL(blob),
        extension,
        label: label.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 100),
      })
    } catch (e) {
      if (
        alive.current &&
        !(e instanceof DOMException && e.name === 'AbortError')
      )
        setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (alive.current) setExporting(false)
      job.current = null
    }
  }
  return (
    <dialog
      className="strength-share-dialog strength-video-dialog"
      ref={dialog}
      aria-labelledby="strength-video-title"
      onCancel={close}
      onClose={close}
    >
      <header>
        <h2 id="strength-video-title">Clip workout video</h2>
        <button className="btn btn-ghost" onClick={close} autoFocus>
          Close
        </button>
      </header>
      <p>{session.title}</p>
      <fieldset disabled={exporting}>
        <label>
          Video from your device
          <input
            type="file"
            accept="video/*"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              resetResult()
              setSource(URL.createObjectURL(file))
              setDuration(0)
              setStart(0)
              setEnd(0)
              setOffset(0)
            }}
          />
        </label>
        <label>
          Clip for
          <select
            className="input"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value)
              resetResult()
            }}
          >
            <option value="workout">Whole workout</option>
            {choices.map((c) => (
              <option key={c.set.id} value={`${c.entry.id}/${c.set.id}`}>
                {c.entry.name} · Set {c.set.number}
              </option>
            ))}
          </select>
        </label>
        {choice && <p>{setDescription(choice.set, choice.entry, imperial)}</p>}
        {source && (
          <>
            <video
              ref={video}
              src={source}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration
                if (!Number.isFinite(d) || d < 1) {
                  setError('Choose a playable video at least one second long.')
                  return
                }
                setDuration(d)
                setEnd(d)
              }}
              onError={() =>
                setError(
                  'This file cannot be played in your browser. Try an MP4 video.',
                )
              }
              onTimeUpdate={(e) => {
                if (
                  !e.currentTarget.paused &&
                  e.currentTarget.currentTime >= end &&
                  end > start
                )
                  e.currentTarget.pause()
              }}
            />
            {duration > 0 && (
              <>
                <p>
                  Pause at the first frame of the {choice ? 'set' : 'workout'},
                  then mark its start. Adjust Start and End to choose exactly
                  what to keep.
                </p>
                <div className="strength-video-actions">
                  <button className="btn btn-secondary" onClick={align}>
                    {choice ? 'Set starts here' : 'Workout starts here'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    disabled={!mapped}
                    onClick={() => {
                      if (mapped) applyTrim(mapped)
                    }}
                  >
                    {choice ? 'Trim to recorded set' : 'Trim to workout'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => applyTrim([0, duration])}
                  >
                    Use full video
                  </button>
                </div>
                {choice && !range && (
                  <p>
                    This set has no recorded timestamps. Mark its start in the
                    video and choose the end manually.
                  </p>
                )}
                <div className="strength-fields">
                  <label>
                    Start · {videoTime(start)}
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, end - 1)}
                      step="0.1"
                      value={start}
                      onChange={(e) => {
                        setStart(Number(e.target.value))
                        resetResult()
                      }}
                    />
                    <input
                      aria-label="Clip start in seconds"
                      className="input"
                      type="number"
                      min={0}
                      max={end - 1}
                      step="0.1"
                      value={start}
                      onChange={(e) => {
                        const n = e.target.valueAsNumber
                        if (Number.isFinite(n))
                          setStart(Math.max(0, Math.min(end - 1, n)))
                        resetResult()
                      }}
                    />
                  </label>
                  <label>
                    End · {videoTime(end)}
                    <input
                      type="range"
                      min={start + 1}
                      max={duration}
                      step="0.1"
                      value={end}
                      onChange={(e) => {
                        setEnd(Number(e.target.value))
                        resetResult()
                      }}
                    />
                    <input
                      aria-label="Clip end in seconds"
                      className="input"
                      type="number"
                      min={start + 1}
                      max={duration}
                      step="0.1"
                      value={end}
                      onChange={(e) => {
                        const n = e.target.valueAsNumber
                        if (Number.isFinite(n))
                          setEnd(Math.min(duration, Math.max(start + 1, n)))
                        resetResult()
                      }}
                    />
                  </label>
                </div>
                <label className="strength-done">
                  <input
                    type="checkbox"
                    checked={audio}
                    onChange={(e) => {
                      setAudio(e.target.checked)
                      resetResult()
                    }}
                  />{' '}
                  Keep source audio
                </label>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    if (video.current) {
                      video.current.currentTime = start
                      video.current
                        .play()
                        .catch(() =>
                          setError('Use the video’s play button to preview.'),
                        )
                    }
                  }}
                >
                  Preview selected clip
                </button>
                <p>
                  Export creates a new video on this device and takes about the
                  clip’s playback time. Keep this tab visible. Maximum clip
                  length: 5 minutes.
                </p>
                <button
                  className="btn strength-primary"
                  disabled={end - start < 1 || end - start > 300}
                  onClick={render}
                >
                  Export {videoTime(end - start)} clip
                </button>
              </>
            )}
          </>
        )}
      </fieldset>
      {exporting && (
        <div role="status">
          <progress max={1} value={progress} />
          <span> Exporting {Math.round(progress * 100)}%</span>
          <button
            className="btn btn-secondary"
            onClick={() => job.current?.abort()}
          >
            Cancel export
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {result && (
        <div className="strength-video-result">
          <video controls playsInline src={result.url} />
          <a
            className="btn strength-primary"
            href={result.url}
            download={`${result.label}.${result.extension}`}
          >
            Download clip
          </a>
          <p>
            This copy stays on your device. Original workout and video files are
            unchanged.
          </p>
        </div>
      )}
    </dialog>
  )
}
function videoTime(seconds: number) {
  const n = Math.max(0, seconds)
  return `${Math.floor(n / 60)}:${(n % 60).toFixed(1).padStart(4, '0')}`
}
