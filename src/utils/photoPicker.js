import { showToast } from '../services/toastService.js'

/**
 * Shared image picker: in-app camera first, gallery always.
 * - "Take photo" uses getUserMedia when available (browser HTTPS, Electron,
 *   Android WebView with camera permission). Unavailable/denied -> falls back
 *   to a capture file input that fires the native camera intent on mobile.
 * - "Choose from gallery" uses a plain file input (no capture attribute), so
 *   the OS file/gallery chooser always appears.
 * Everything resolves to a File, so existing compressImage(file) flows work
 * unchanged on every platform (web, APK, EXE).
 */

export function isInAppCameraSupported() {
    try {
        if (!navigator.mediaDevices?.getUserMedia) return false
        // getUserMedia needs a secure context (https, localhost, file://,
        // Capacitor http://localhost). Plain-LAN http testing is excluded.
        if (typeof window !== 'undefined' && window.isSecureContext === false) return false
        return true
    } catch {
        return false
    }
}

function _pickFromGallery() {
    return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.style.display = 'none'
        document.body.appendChild(input)
        let settled = false
        const done = (file) => {
            if (settled) return
            settled = true
            input.remove()
            resolve(file || null)
        }
        input.addEventListener('change', () => done(input.files?.[0] || null))
        // Cancellable pickers don't always fire change/cancel reliably; if the
        // user backs out, resolve null shortly after focus returns.
        const onFocus = () => {
            window.removeEventListener('focus', onFocus)
            setTimeout(() => done(input.files?.[0] || null), 300)
        }
        window.addEventListener('focus', onFocus)
        input.click()
    })
}

function _pickFromCameraApp() {
    return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.setAttribute('capture', 'environment')
        input.style.display = 'none'
        document.body.appendChild(input)
        let settled = false
        const done = (file) => {
            if (settled) return
            settled = true
            input.remove()
            resolve(file || null)
        }
        input.addEventListener('change', () => done(input.files?.[0] || null))
        const onFocus = () => {
            window.removeEventListener('focus', onFocus)
            setTimeout(() => done(input.files?.[0] || null), 300)
        }
        window.addEventListener('focus', onFocus)
        input.click()
    })
}

function _stopStream(stream) {
    try {
        stream?.getTracks()?.forEach(t => { try { t.stop() } catch {} })
    } catch {}
}

/**
 * In-app camera: live preview -> Capture -> preview -> Use/Retake.
 * Resolves a JPEG File on "Use photo", null on cancel/close.
 * THROWS on camera startup failure (permission denied, no device) so the
 * caller can fall back to the native camera intent.
 */
export function capturePhoto() {
    return new Promise((resolve, reject) => {
        let settled = false
        let stream = null
        let facing = 'environment'
        let videoDevices = []

        const overlay = document.createElement('div')
        overlay.className = 'modal-overlay open'
        overlay.innerHTML = `
          <div class="modal-content" style="max-width: 420px; padding: 1rem; text-align: center;">
            <h3 style="margin: 0 0 0.75rem 0;">Take photo</h3>
            <div id="pp-view" style="position: relative; background: #000; border-radius: 0.75rem; overflow: hidden;">
              <video id="pp-video" playsinline autoplay muted
                style="width: 100%; max-height: 55vh; display: block; object-fit: cover; background: #000;"></video>
              <img id="pp-still" style="display: none; width: 100%; max-height: 55vh; object-fit: contain; background: #000;" />
              <div id="pp-status" style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 0.85rem;">Starting camera…</div>
            </div>
            <div style="display: flex; gap: 0.6rem; margin-top: 1rem;">
              <button class="ghost-button" id="pp-close" style="flex: 1;">Cancel</button>
              <button class="secondary-button" id="pp-flip" style="flex: 1; display: none;">🔄 Flip</button>
              <button class="primary-button" id="pp-shoot" style="flex: 1;" disabled>Capture</button>
            </div>
            <div style="display: none; gap: 0.6rem; margin-top: 1rem;" id="pp-confirm-row">
              <button class="secondary-button" id="pp-retake" style="flex: 1;">Retake</button>
              <button class="primary-button" id="pp-use" style="flex: 1;">Use photo</button>
            </div>
          </div>`

        const finish = (file) => {
            if (settled) return
            settled = true
            _stopStream(stream)
            overlay.remove()
            resolve(file || null)
        }
        const fail = (err) => {
            if (settled) return
            settled = true
            _stopStream(stream)
            overlay.remove()
            reject(err)
        }

        const video = overlay.querySelector('#pp-video')
        const still = overlay.querySelector('#pp-still')
        const status = overlay.querySelector('#pp-status')
        const shootBtn = overlay.querySelector('#pp-shoot')
        const flipBtn = overlay.querySelector('#pp-flip')
        const confirmRow = overlay.querySelector('#pp-confirm-row')
        const actionRow = shootBtn.parentElement

        const showLive = () => {
            still.style.display = 'none'
            video.style.display = 'block'
            confirmRow.style.display = 'none'
            actionRow.style.display = 'flex'
        }

        const start = async () => {
            _stopStream(stream)
            status.style.display = 'flex'
            status.textContent = 'Starting camera…'
            shootBtn.disabled = true
            try {
                const constraints = facing === 'environment'
                    ? { video: { facingMode: { ideal: 'environment' } }, audio: false }
                    : { video: { deviceId: { exact: facing } }, audio: false }
                stream = await navigator.mediaDevices.getUserMedia(constraints)
            } catch (err) {
                fail(err)
                return
            }
            video.srcObject = stream
            try { await video.play() } catch {}
            status.style.display = 'none'
            shootBtn.disabled = false
            try {
                const devices = await navigator.mediaDevices.enumerateDevices()
                videoDevices = devices.filter(d => d.kind === 'videoinput')
                flipBtn.style.display = videoDevices.length > 1 ? '' : 'none'
            } catch {
                flipBtn.style.display = 'none'
            }
        }

        flipBtn.addEventListener('click', async () => {
            if (videoDevices.length < 2 || !stream) return
            const currentId = stream.getVideoTracks()[0]?.getSettings?.().deviceId
            const next = videoDevices.find(d => d.deviceId && d.deviceId !== currentId) || videoDevices[0]
            facing = next.deviceId || 'environment'
            await start()
        })

        shootBtn.addEventListener('click', () => {
            if (!video.videoWidth) return
            const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight))
            const canvas = document.createElement('canvas')
            canvas.width = Math.round(video.videoWidth * scale)
            canvas.height = Math.round(video.videoHeight * scale)
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
            canvas.toBlob((blob) => {
                if (!blob) {
                    showToast('Could not capture. Try again.', 'error')
                    return
                }
                still.src = URL.createObjectURL(blob)
                still.style.display = 'block'
                video.style.display = 'none'
                actionRow.style.display = 'none'
                confirmRow.style.display = 'flex'
                overlay.querySelector('#pp-use').onclick = () => {
                    const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
                    finish(file)
                }
            }, 'image/jpeg', 0.92)
        })

        overlay.querySelector('#pp-retake').addEventListener('click', showLive)
        overlay.querySelector('#pp-close').addEventListener('click', () => finish(null))
        overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null) })

        document.body.appendChild(overlay)
        start()
    })
}

/**
 * Source picker modal: "Take photo" + "Choose from gallery" + Cancel.
 * Resolves a File, or null when cancelled.
 */
export async function pickImageFile({ title = 'Add photo' } = {}) {
    const inApp = isInAppCameraSupported()
    return new Promise((resolve) => {
        let settled = false
        const done = (file) => {
            if (settled) return
            settled = true
            resolve(file || null)
        }
        const overlay = document.createElement('div')
        overlay.className = 'modal-overlay open'
        overlay.innerHTML = `
          <div class="modal-content" style="max-width: 340px; padding: 1.25rem; text-align: center;">
            <h3 style="margin: 0 0 0.25rem 0;">${title}</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0 0 1rem 0;">Camera or gallery — your choice.</p>
            <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                <button class="primary-button" id="pp-camera">📷 Take photo</button>
                <button class="secondary-button" id="pp-gallery">🖼️ Choose from gallery</button>
                <button class="ghost-button" id="pp-cancel" style="color: var(--text-muted);">Cancel</button>
            </div>
          </div>`
        const close = () => overlay.remove()
        overlay.addEventListener('click', (e) => { if (e.target === overlay) { close(); done(null) } })
        overlay.querySelector('#pp-cancel')?.addEventListener('click', () => { close(); done(null) })
        overlay.querySelector('#pp-gallery')?.addEventListener('click', async () => {
            close()
            done(await _pickFromGallery())
        })
        overlay.querySelector('#pp-camera')?.addEventListener('click', async () => {
            close()
            if (inApp) {
                try {
                    done(await capturePhoto())
                    return
                } catch (err) {
                    console.warn('[PhotoPicker] In-app camera failed, trying camera app:', err?.name || err?.message)
                    showToast('Camera unavailable — opening camera app…', 'warning')
                }
            }
            // Fallback (or non-secure contexts): native camera intent.
            done(await _pickFromCameraApp())
        })
        document.body.appendChild(overlay)
    })
}
