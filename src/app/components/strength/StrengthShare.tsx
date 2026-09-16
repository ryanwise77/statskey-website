import { useEffect, useRef, useState } from 'react'
import {
  canShareStrengthFiles,
  renderStrengthImages,
  strengthShareFile,
} from '../../lib/strength/share'
import type { StrengthSession } from '../../lib/strength/model'
export function StrengthShare({
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
        Share compact image
      </button>
      {open && (
        <ShareDialog
          session={session}
          imperial={imperial}
          close={() => setOpen(false)}
        />
      )}
    </>
  )
}
function ShareDialog({
  session,
  imperial,
  close,
}: {
  session: StrengthSession
  imperial: boolean
  close: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [images, setImages] = useState<Array<{ file: File | null; url: string }>>([])
  const [sharing, setSharing] = useState(false)
  const [page, setPage] = useState(0),
    [error, setError] = useState('')
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal()
    setImages([])
    setPage(0)
    setError('')
    let current = true
    const urls: string[] = []
    renderStrengthImages(session, imperial)
      .then((blobs) => {
        if (!current) return
        setImages(
          blobs.map((blob) => {
            const url = URL.createObjectURL(blob)
            urls.push(url)
            return { file: strengthShareFile(blob, `Strength-${urls.length}.png`), url }
          }),
        )
      })
      .catch((e) => {
        if (current) setError(String(e.message ?? e))
      })
    return () => {
      current = false
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [session, imperial])
  const visiblePage = Math.min(page, Math.max(0, images.length - 1))
  const allFiles = images.flatMap((image) => image.file ? [image.file] : [])
  const pageFile = images[visiblePage]?.file
  const canShareAll = allFiles.length === images.length && canShareStrengthFiles(allFiles)
  const files = canShareAll ? allFiles : pageFile ? [pageFile] : []
  const canShare = canShareAll || canShareStrengthFiles(files)
  async function share() {
    if (!canShare || sharing) return
    setSharing(true)
    setError('')
    try {
      await navigator.share({ title: session.title, files })
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError'))
        setError('Couldn’t share the image. Download it below instead.')
    } finally {
      setSharing(false)
    }
  }
  return (
    <dialog
      className="strength-share-dialog"
      ref={dialog}
      onCancel={close}
      onClose={close}
      aria-labelledby="strength-image-title"
    >
      <header>
        <h2 id="strength-image-title">Compact workout image</h2>
        <button className="btn btn-ghost" onClick={close} autoFocus>
          Close
        </button>
      </header>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {images.length ? (
        <>
          <img
            src={images[visiblePage].url}
            alt={`Compact strength log for ${session.title}, page ${visiblePage + 1} of ${images.length}`}
          />
          {images.length > 1 && (
            <nav aria-label="Image pages">
              <button
                className="btn btn-secondary"
                disabled={visiblePage === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span>
                {visiblePage + 1} / {images.length}
              </span>
              <button
                className="btn btn-secondary"
                disabled={visiblePage === images.length - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </nav>
          )}
          <footer>
            <a
              className="btn strength-primary"
              href={images[visiblePage].url}
              download={`Strength-${visiblePage + 1}.png`}
            >
              Download image{images.length > 1 ? ` ${visiblePage + 1}` : ''}
            </a>
            {canShare && (
              <button className="btn btn-secondary" onClick={share} disabled={sharing}>
                {sharing ? 'Sharing…' : `Share${canShareAll && images.length > 1 ? ' all images' : ' image'}`}
              </button>
            )}
            <a className="btn btn-ghost" href={images[visiblePage].url} target="_blank" rel="noopener noreferrer">
              Open image
            </a>
          </footer>
          <p>If Download opens a preview, use your device’s share or save menu, or press and hold the image to save it.</p>
        </>
      ) : (
        !error && <p role="status">Preparing your image…</p>
      )}
    </dialog>
  )
}
