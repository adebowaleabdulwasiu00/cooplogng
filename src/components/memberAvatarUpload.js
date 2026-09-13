import { compressImage } from '../utils/imageUtils.js'
import { showToast } from '../services/toastService.js'

const EMPTY = new Set(['', 'n/a', 'null', 'undefined', 'none', '-'])

function hasPhoto(m) {
    if (!m?.image_path) return false
    const s = String(m.image_path).trim()
    return s.length > 0 && !EMPTY.has(s.toLowerCase())
}

/**
 * Makes a member's own avatar self-service:
 * - No photo yet  -> clickable (gallery + camera), one-time upload.
 * - Photo exists   -> read-only, no click handler.
 * Works offline; the save syncs via the normal members queue.
 */
export async function enableMemberAvatarUpload(container, user, opts = {}) {
    if (!container || !user) return false
    if ((user.role || '').toLowerCase() !== 'member' || !user.memberId) return false

    const { loadDoc } = await import('../services/sqliteService.js')
    let member = null
    try {
        member = await loadDoc('members', user.memberId, user.cooperativeId)
    } catch { member = null }
    if (!member) return false

    // Read-only when a photo already exists.
    if (hasPhoto(member)) {
        container.removeAttribute('data-avatar-upload')
        container.style.cursor = ''
        container.title = ''
        container.querySelector('[data-avatar-badge]')?.remove()
        return false
    }

    // Empty state -> clickable affordance (only bind once).
    if (container.dataset.avatarUpload === '1') return true
    container.dataset.avatarUpload = '1'
    container.style.cursor = 'pointer'
    container.style.position = 'relative'
    container.title = 'Tap to add your photo'

    const badge = document.createElement('span')
    badge.dataset.avatarBadge = '1'
    badge.innerHTML = `<svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`
    Object.assign(badge.style, {
        position: 'absolute', right: '-2px', bottom: '-2px',
        width: '20px', height: '20px', borderRadius: '50%',
        background: 'var(--accent-primary)', color: '#fff',
        display: 'grid', placeItems: 'center',
        border: '2px solid var(--bg-card)', pointerEvents: 'none',
    })
    container.appendChild(badge)

    container.addEventListener('click', async () => {
        // Re-check: another device/session may have set it meanwhile.
        try {
            const fresh = await loadDoc('members', user.memberId, user.cooperativeId)
            if (hasPhoto(fresh)) {
                showToast('Photo already set. Contact admin to change it.', 'warning')
                container.dataset.avatarUpload = ''
                container.style.cursor = ''
                badge.remove()
                return
            }
        } catch {}
        openPhotoPicker(user)
    }, { once: false })

    // Optional hook so callers can refresh after save.
    container._onAvatarSaved = opts.onSaved || null
    return true
}

async function openPhotoPicker(user) {
    const { pickImageFile } = await import('../utils/photoPicker.js')
    const file = await pickImageFile({ title: 'Add your photo' })
    if (!file) return
    await previewAndSave(file, user)
}

async function previewAndSave(file, user) {
    let dataUrl = null
    try {
        showToast('Processing photo…', 'warning')
        dataUrl = await compressImage(file)
    } catch {
        showToast('Could not read that image. Try another.', 'error')
        return
    }
    document.getElementById('avatar-preview-modal')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'avatar-preview-modal'
    overlay.className = 'modal-overlay open'
    overlay.innerHTML = `
      <div class="modal-content" style="max-width: 340px; padding: 1.25rem; text-align: center;">
        <h3 style="margin: 0 0 0.75rem 0;">Preview</h3>
        <img src="${dataUrl}" style="width: 160px; height: 160px; border-radius: 50%; object-fit: cover; border: 3px solid var(--border-light);">
        <div style="display: flex; gap: 0.6rem; margin-top: 1rem;">
            <button class="secondary-button" id="av-retake" style="flex: 1;">Retake</button>
            <button class="primary-button" id="av-save" style="flex: 1;">Save photo</button>
        </div>
      </div>`
    document.body.appendChild(overlay)
    overlay.querySelector('#av-retake')?.addEventListener('click', () => {
        overlay.remove()
        openPhotoPicker(user)
    })
    overlay.querySelector('#av-save')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget
        btn.disabled = true
        btn.textContent = 'Saving…'
        try {
            const { updateMember } = await import('../services/dataService.js')
            const { loadDoc } = await import('../services/sqliteService.js')
            // Final guard: never overwrite an existing photo from self-service.
            const fresh = await loadDoc('members', user.memberId, user.cooperativeId)
            if (fresh?.image_path && String(fresh.image_path).trim()) {
                throw new Error('Photo already set. Contact admin to change it.')
            }
            await updateMember(user.memberId, { image_path: dataUrl }, user.username || 'Self')
            showToast('Photo saved.', 'success')
            overlay.remove()
            document.getElementById('avatar-pick-modal')?.remove()
            // Refresh every avatar on screen.
            document.querySelectorAll('#user-avatar-container').forEach(c => {
                c.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;display:block;">`
                c.style.cursor = ''
                c.title = ''
                c.dataset.avatarUpload = ''
                c.querySelector('[data-avatar-badge]')?.remove()
                if (typeof c._onAvatarSaved === 'function') { try { c._onAvatarSaved(dataUrl) } catch {} }
            })
            window.dispatchEvent(new Event('member-avatar-updated'))
        } catch (err) {
            showToast('Save failed: ' + (err.message || err), 'error')
            btn.disabled = false
            btn.textContent = 'Save photo'
        }
    })
}
