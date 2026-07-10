import { registerCooperative } from '../services/dataService.js'
import { escapeHtml, wrapDateInput } from '../utils/formatters.js'
import { compressImage } from '../utils/imageUtils.js'

export async function renderRegistration(container, onBack, onSuccess) {
    let selectedLogo = null

    container.innerHTML = `
        <div class="shell" style="animation: fadeIn 0.4s ease-out;">
            <div class="card wide-card">
                <div class="brand">COOPERATIVE LOG APP</div>
                <div style="display: flex; flex-direction: column; align-items: center; text-align: center;">
                    <div style="width: 100%;">
                        <h1 style="font-weight: 800; color: var(--text-primary); margin-top: 0; margin-bottom: 0.25rem;">Create Profile</h1>
                        <p style="color: var(--text-muted); margin-bottom: 2.5rem; font-size: 0.95rem;">Setup your cooperative and initial admin account</p>
                    </div>
                    <button type="button" class="ghost-button" id="clear-reg-form-btn" style="color: var(--danger); border: 1px solid var(--danger-bg); margin-bottom: 2rem;">🗑 Clear Form</button>
                </div>
                
                <form id="registration-form" class="form">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.5rem;">
                        <label class="field">
                            <span>Cooperative Full Name</span>
                            <input name="full_name" type="text" placeholder="e.g. Apex Cooperative Society" required style="border-color: var(--border-medium); background: var(--bg-input); color: var(--text-primary);" />
                        </label>
                        
                        <label class="field">
                            <span>Short Name / Acronym</span>
                            <input name="short_name" type="text" placeholder="e.g. ACS" required style="border-color: var(--border-medium); background: var(--bg-input); color: var(--text-primary);" />
                        </label>
                        
                        <label class="field">
                            <span>Contact Phone</span>
                            <input name="contact_number" type="tel" placeholder="e.g. 08012345678" required style="border-color: var(--border-medium); background: var(--bg-input); color: var(--text-primary);" />
                        </label>
                        
                        <label class="field">
                            <span>Cooperative Email</span>
                            <input name="email" type="email" placeholder="e.g. contact@apex.coop" required style="border-color: var(--border-medium); background: var(--bg-input); color: var(--text-primary);" />
                        </label>
                    </div>

                    <div style="margin-top: 1.5rem;">
                        <label class="field">
                            <span>Cooperative Logo</span>
                            <div style="display: flex; align-items: center; gap: 1rem; margin-top: 0.5rem;">
                                <div id="logo-preview" style="width: 80px; height: 80px; border-radius: 50%; background: var(--bg-secondary); display: flex; align-items: center; justify-content: center; overflow: hidden; border: 2px solid var(--border-light);">
                                    <span style="color: var(--text-muted); font-size: 2rem;">📷</span>
                                </div>
                                <input type="file" id="logo-input" accept="image/*" style="flex: 1;" />
                            </div>
                        </label>
                    </div>

                    <div style="margin-top: 1.5rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.5rem;">
                        <label class="field">
                            <span>Admin Username</span>
                            <input name="admin_username" type="text" value="admin" disabled style="background: var(--bg-secondary); cursor: not-allowed; color: var(--text-muted); border-color: var(--border-light);" />
                        </label>
                        <div style="background: var(--accent-soft); padding: 1rem; border-radius: var(--radius-md); color: var(--accent-primary); font-size: 0.85rem; border: 1px solid var(--accent-soft); display: flex; align-items: center; gap: 0.75rem;">
                            <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                            <span>For security, a random 4-digit admin password will be generated for your initial login.</span>
                        </div>
                    </div>

                    <div style="margin-top: 1.5rem;">
                        <label class="field">
                            <span>Physical Address</span>
                            <textarea name="address" style="width: 100%; height: 80px; padding: 0.75rem; border: 1px solid var(--border-medium); border-radius: var(--radius-md); font-family: inherit; resize: none; background: var(--bg-input); color: var(--text-primary);" placeholder="Enter physical location..."></textarea>
                        </label>
                    </div>

                    <div style="margin-top: 1rem;">
                        <label class="field">
                            <span>Cooperative Year Start (First Month)</span>
                            <input name="first_month" type="date" required style="border-color: var(--border-medium); background: var(--bg-input); color: var(--text-primary);" />
                        </label>
                    </div>

                    <div id="reg-error" class="alert hidden" style="margin-top: 1.5rem;"></div>

                    <div class="actions" style="margin-top: 3rem; pt-1.5; border-top: 1px solid var(--border-light); padding-top: 2rem;">
                        <button type="button" class="secondary-button" id="reg-back-btn" style="flex: 1;">Back to Login</button>
                        <button type="submit" class="primary-button" id="reg-submit-btn" style="flex: 2;">Register Cooperative</button>
                    </div>
                </form>
            </div>
        </div>
    `

    const form = container.querySelector('#registration-form')
    const errorDiv = container.querySelector('#reg-error')

    // Wrap date input to show DD MMM, YYYY
    container.querySelectorAll('input[type="date"]').forEach(wrapDateInput);
    const backBtn = container.querySelector('#reg-back-btn')
    const submitBtn = container.querySelector('#reg-submit-btn')
    const logoInput = container.querySelector('#logo-input')
    const logoPreview = container.querySelector('#logo-preview')

    // Logo upload handler
    logoInput.addEventListener('change', async (e) => {
        const file = e.target.files[0]
        if (file) {
            try {
                selectedLogo = await compressImage(file)
                logoPreview.innerHTML = `<img src="${selectedLogo}" style="width: 100%; height: 100%; object-fit: cover;" />`
            } catch (err) {
                console.error('Logo compression failed:', err)
            }
        }
    })

    // Persistence logic
    const DRAFT_KEY = 'cooplog-reg-draft'
    const saveDraft = () => {
        const fd = new FormData(form)
        const draft = Object.fromEntries(fd.entries())
        delete draft.password
        delete draft.confirm_password
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    }
    const loadDraft = () => {
        try {
            const raw = sessionStorage.getItem(DRAFT_KEY)
            if (!raw) return
            const draft = JSON.parse(raw)
            Object.keys(draft).forEach(key => {
                if (form[key]) form[key].value = draft[key]
            })
        } catch(e) {}
    }
    const clearDraft = () => sessionStorage.removeItem(DRAFT_KEY)

    // Set default date to today's first day
    const today = new Date()
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]
    form.first_month.value = firstDay

    loadDraft()

    backBtn.addEventListener('click', onBack)
    
    container.querySelector('#clear-reg-form-btn')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all inputs?')) {
            clearDraft()
            renderRegistration(container, onBack, onSuccess)
        }
    })

    form.addEventListener('input', saveDraft)



    form.addEventListener('submit', async (e) => {
        e.preventDefault()
        
        const formData = new FormData(form)

        const coopData = {
            full_name: formData.get('full_name').trim(),
            short_name: formData.get('short_name').trim(),
            contact_number: formData.get('contact_number').trim(),
            email: formData.get('email').trim(),
            address: formData.get('address').trim(),
            coop_first_month: formData.get('first_month'),
            logo_path: selectedLogo
        }

        try {
            submitBtn.disabled = true
            const originalBtnText = submitBtn.innerText
            submitBtn.innerText = "Registering..."
            errorDiv.classList.add('hidden')
            errorDiv.style.background = "var(--danger-bg)"
            errorDiv.style.color = "var(--danger)"

            const result = await registerCooperative(coopData)
            
            clearDraft()
            // Show success message before moving back
            errorDiv.innerHTML = `
                <div style="text-align: center;">
                    <div style="font-size: 1.2rem; margin-bottom: 0.5rem; color: var(--success);">✅ COOPERATIVE REGISTERED!</div>
                    <div style="font-size: 1rem; margin-bottom: 0.5rem; color: var(--text-primary);">Admin Password: <strong style="font-size: 1.5rem; color: var(--accent-primary);">${result.generatedPassword}</strong></div>
                    <p style="font-size: 0.8rem; margin: 0; color: var(--text-muted);">Please save this password securely. You will be required to change it on login.</p>
                </div>
            `
            errorDiv.style.background = "var(--success-bg)"
            errorDiv.style.color = "var(--success)"
            errorDiv.style.border = "2px solid var(--success)"
            errorDiv.classList.remove('hidden')
            
            setTimeout(() => onSuccess(result), 2500)
        } catch (err) {
            console.error("Registration Error:", err)
            errorDiv.innerText = "REGISTRATION FAILED: " + err.message.toUpperCase()
            errorDiv.style.background = "var(--danger-bg)"
            errorDiv.style.color = "var(--danger)"
            errorDiv.style.border = "2px solid var(--danger)"
            errorDiv.style.fontWeight = "bold"
            errorDiv.classList.remove('hidden')
            submitBtn.disabled = false
            submitBtn.innerText = "Register Cooperative"
        }
    })
}
