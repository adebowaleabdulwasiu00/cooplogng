import { escapeHtml, formatDateForInput, generateRandom4Digit, wrapDateInput } from '../../utils/formatters.js'
import { compressImage } from '../../utils/imageUtils.js'
import { addMember, updateMember, fetchCooperativeUsers } from '../../services/dataService.js'
import { getAllMembers, usersList, enterpriseList, loadMembersData } from './membersState.js'
import { showToast } from '../../services/toastService.js'

export async function renderMembersForm(container, user, member = null) {
    const isEdit = !!member
    let activeFormTab = 'bio'
    let selectedManagers = isEdit 
        ? String(member.account_manager || '').split(',').map(s => s.trim()).filter(Boolean)
        : usersList.map(u => u.username) // Default to all managers for new members
    let pendingManagers = [...selectedManagers]
    let selectedPassport = member?.image_path || null
    let selectedSignature = member?.signature_path || null

    // Normalize Special ID - convert to uppercase
    const normalizeSpecialId = (id) => {
        if (!id) return null
        return String(id).trim().toUpperCase()
    }

    const updateFormTabs = () => {
        container.querySelectorAll('.tab-btn').forEach(btn => {
            const tabId = btn.dataset.tab
            const content = container.querySelector(`#tab-${tabId}`)
            if (tabId === activeFormTab) {
                btn.classList.add('active')
                content?.classList.remove('hidden')
            } else {
                btn.classList.remove('active')
                content?.classList.add('hidden')
            }
        })
    }

    const renderManagerDropdown = () => {
        const dropdown = container.querySelector('#manager-dropdown')
        if (!dropdown) return

        const triggerText = container.querySelector('#manager-trigger-text')
        if (triggerText) {
            triggerText.textContent = selectedManagers.length > 0 
                ? `${selectedManagers.length} Managers Selected` 
                : 'Select Managers...';
        }

        dropdown.innerHTML = `
            <div style="font-size: 0.7rem; font-weight: 700; color: var(--text-muted); margin-bottom: 0.75rem; text-transform: uppercase;">
                Select Managers
            </div>
            <div style="margin-bottom: 0.75rem;">
                <input type="text" id="mgr-dropdown-search" placeholder="Search managers..." 
                    style="width: 100%; padding: 0.4rem; border-radius: 4px; border: 1px solid var(--border-medium); font-size: 0.8rem; background: var(--bg-input); color: var(--text-primary);">
            </div>
            <div class="mgr-list" style="max-height: 200px; overflow-y: auto; margin-bottom: 0.75rem;">
                <label class="field-option" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem; cursor: pointer; border-radius: 4px;" data-key="all">
                    <input type="checkbox" id="mgr-chk-all" ${pendingManagers.length === usersList.length ? 'checked' : ''}>
                    <span style="font-weight: 700; font-size: 0.85rem;">All Managers</span>
                </label>
                ${usersList.map(u => {
                    const displayName = u.full_name || u.username;
                    return `
                    <label class="field-option mgr-item" data-key="${u.username}" data-search="${displayName.toLowerCase()}" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem; cursor: pointer; border-radius: 4px;">
                        <input type="checkbox" class="mgr-chk" value="${u.username}" ${pendingManagers.includes(u.username) ? 'checked' : ''}>
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 0.85rem; color: var(--text-primary); font-weight: 500;">${escapeHtml(displayName)}</span>
                            ${u.full_name ? `<span style="font-size: 0.7rem; color: var(--text-muted);">@${escapeHtml(u.username)}</span>` : ''}
                        </div>
                    </label>
                `}).join('')}
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button type="button" class="primary-button" id="apply-mgrs" style="flex: 1; height: 1.85rem; font-size: 0.7rem; border-radius: 999px;">Apply</button>
                <button type="button" class="secondary-button" id="cancel-mgrs" style="flex: 1; height: 1.85rem; font-size: 0.7rem; border-radius: 999px; background: white; color: black;">Cancel</button>
            </div>
        `;

        const searchInput = dropdown.querySelector('#mgr-dropdown-search');
        searchInput?.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase();
            dropdown.querySelectorAll('.mgr-item').forEach(item => {
                const text = item.dataset.search || '';
                item.style.display = text.includes(val) ? 'flex' : 'none';
            });
        });

        dropdown.querySelector('#mgr-chk-all')?.addEventListener('change', (e) => {
            if (e.target.checked) {
                pendingManagers = usersList.map(u => u.username);
            } else {
                pendingManagers = [];
            }
            dropdown.querySelectorAll('.mgr-chk').forEach(cb => {
                cb.checked = e.target.checked;
            });
        });

        dropdown.querySelectorAll('.mgr-chk').forEach(cb => {
            cb.addEventListener('change', () => {
                const key = cb.value;
                if (cb.checked) {
                    if (!pendingManagers.includes(key)) pendingManagers.push(key);
                } else {
                    pendingManagers = pendingManagers.filter(k => k !== key);
                }
                const allChk = dropdown.querySelector('#mgr-chk-all');
                if (allChk) allChk.checked = pendingManagers.length === usersList.length;
            });
        });

        dropdown.querySelector('#apply-mgrs')?.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedManagers = [...pendingManagers];
            dropdown.classList.add('hidden');
            if (triggerText) {
                triggerText.textContent = selectedManagers.length > 0 
                    ? `${selectedManagers.length} Managers Selected` 
                    : 'Select Managers...';
            }
        });

        dropdown.querySelector('#cancel-mgrs')?.addEventListener('click', (e) => {
            e.stopPropagation();
            pendingManagers = [...selectedManagers];
            dropdown.classList.add('hidden');
        });
    }

    container.innerHTML = `
      <style>
        .form-card {
            background: var(--bg-card);
            border-radius: var(--radius-lg);
            padding: 2rem;
            box-shadow: var(--shadow-xl);
            border: 1px solid var(--border-light);
            max-width: 900px;
            margin: 0 auto;
        }
        .field {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            margin-bottom: 1.25rem;
        }
        .field span {
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text-muted);
        }
        .field input, .field select, .field textarea {
            padding: 0.75rem 1rem;
            border-radius: var(--radius-md);
            border: 1px solid var(--border-medium);
            font-size: 0.95rem;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
            background: var(--bg-input);
            color: var(--text-primary);
        }
        .field input:focus {
            border-color: var(--accent-primary);
            box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .tab-btn {
            background: transparent;
            border: none;
            padding: 0.75rem 1.5rem;
            font-weight: 600;
            color: var(--text-muted);
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
        }
        .tab-btn.active {
            color: var(--accent-primary);
            border-bottom-color: var(--accent-primary);
        }
        .duplicate-warning {
            color: #dc2626;
            font-size: 0.75rem;
            font-weight: 600;
            margin-top: 0.25rem;
        }
        .dropdown-btn {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.5rem 0.75rem;
            border-radius: var(--radius-md);
            border: 1px solid var(--border-medium);
            background: var(--bg-input);
            color: var(--text-primary);
            font-size: 0.85rem;
            cursor: pointer;
            width: 100%;
            height: 2.75rem;
        }
        .field-option { 
            display: flex; 
            align-items: center; 
            gap: 0.75rem; 
            padding: 0.5rem 0.75rem; 
            cursor: pointer; 
            border-radius: 6px;
            transition: background 0.2s; 
            font-size: 0.85rem; 
            color: var(--text-primary); 
        }
        .field-option:hover { background: var(--bg-secondary); }
        .field-option input[type="checkbox"] { 
            cursor: pointer; 
            width: 16px !important; 
            height: 16px !important; 
            margin: 0;
            flex-shrink: 0;
        }
        .dropdown-menu {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: var(--bg-card);
            border: 1px solid var(--border-medium);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-xl);
            z-index: 100;
            padding: 1rem;
            min-width: 280px;
        }
      </style>

      <div class="members-page" style="padding-bottom: 4rem; background: var(--bg-main);">
        <div class="page-header" style="margin-bottom: 2rem; display: flex; align-items: center; gap: 1rem;">
          <button type="button" class="ghost-button" id="back-to-list-btn" style="padding: 0.5rem; border-radius: var(--radius-md); width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; background: var(--bg-card); border: 1px solid var(--border-light); box-shadow: var(--shadow-sm); color: var(--text-primary);">
            <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7"></path></svg>
          </button>
          <div>
            <h2 style="font-size: 1.5rem; font-weight: 800; color: var(--text-primary);">${isEdit ? 'Edit Member' : 'Add New Member'}</h2>
            <p style="color: var(--text-muted); font-size: 0.9rem;">${isEdit ? escapeHtml(member.name) : 'Provide registration details below.'}</p>
          </div>
        </div>

        <div class="form-card">
          <div style="display: flex; border-bottom: 1px solid var(--border-light); margin-bottom: 2rem;">
              <button class="tab-btn active" data-tab="bio">Personal Info</button>
              <button class="tab-btn" data-tab="nok">NOK & Bank</button>
              <button class="tab-btn" data-tab="pay">Payment Advice</button>
          </div>

          <form id="member-form">
            <!-- Bio Data Tab -->
            <div id="tab-bio">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem;">
                    <label class="field">
                        <span>Last Name *</span>
                        <input name="last_name" required value="${escapeHtml(member?.last_name || '')}">
                    </label>
                    <label class="field">
                        <span>First Name *</span>
                        <input name="first_name" required value="${escapeHtml(member?.first_name || '')}">
                    </label>
                    <label class="field">
                        <span>Middle Name</span>
                        <input name="middle_name" value="${escapeHtml(member?.middle_name || '')}">
                    </label>
                    <label class="field">
                        <span>Mobile * (Live Duplicate Check)</span>
                        <input name="mobile" id="mobile-input" required value="${escapeHtml(member?.mobile || '')}">
                        <div id="duplicate-error" class="duplicate-warning hidden">This mobile number is already registered to another member.</div>
                    </label>
                    <label class="field">
                        <span>Email</span>
                        <input name="email" type="email" value="${escapeHtml(member?.email || '')}">
                    </label>
                    <label class="field">
                        <span>Special ID (Live Duplicate Check)</span>
                        <input name="special_id" id="special-id-input" value="${escapeHtml(member?.special_id || '')}">
                        <div id="special-id-duplicate-error" class="duplicate-warning hidden">This Special ID is already registered to another member.</div>
                    </label>
                    <label class="field">
                        <span>Registration No</span>
                        <input name="registration_no" readonly value="${member ? String(member.registration_no || "").padStart(4, '0') : '(Auto-generated)'}" style="background: var(--bg-secondary); color: var(--text-muted);">
                    </label>
                    <label class="field">
                        <span>Status</span>
                        <select name="status">
                            <option value="Active" ${member?.status === 'Active' ? 'selected' : ''}>Active</option>
                            <option value="Inactive" ${member?.status === 'Inactive' ? 'selected' : ''}>Inactive</option>
                            <option value="Suspended" ${member?.status === 'Suspended' ? 'selected' : ''}>Suspended</option>
                        </select>
                    </label>
                    <label class="field">
                        <span>Sex</span>
                        <select name="sex">
                            <option value="Male" ${member?.sex === 'Male' ? 'selected' : ''}>Male</option>
                            <option value="Female" ${member?.sex === 'Female' ? 'selected' : ''}>Female</option>
                        </select>
                    </label>
                    <label class="field">
                        <span>Date Joined</span>
                        <input name="date_joined" type="date" value="${member ? formatDateForInput(member.date_joined) : formatDateForInput(new Date())}">
                    </label>
                </div>

                <!-- Passport Photo and Signature -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-top: 0.5rem;">
                    <label class="field">
                        <span>Passport Photo</span>
                        <div style="display: flex; align-items: center; gap: 1rem;">
                            <div id="passport-preview" style="width: 80px; height: 80px; border-radius: 50%; background: var(--bg-secondary); display: flex; align-items: center; justify-content: center; overflow: hidden; border: 2px solid var(--border-light);">
                                ${member?.image_path 
                                    ? `<img src="${escapeHtml(member.image_path)}" style="width: 100%; height: 100%; object-fit: cover;" />`
                                    : `<span style="color: var(--text-muted); font-size: 2rem;">📷</span>`
                                }
                            </div>
                            <input type="file" id="passport-input" accept="image/*" style="flex: 1;" />
                        </div>
                    </label>
                    <label class="field">
                        <span>Signature</span>
                        <div style="display: flex; align-items: center; gap: 1rem;">
                            <div id="signature-preview" style="width: 120px; height: 60px; background: var(--bg-secondary); display: flex; align-items: center; justify-content: center; overflow: hidden; border: 2px solid var(--border-light); border-radius: 4px;">
                                ${member?.signature_path 
                                    ? `<img src="${member.signature_path}" style="width: 100%; height: 100%; object-fit: contain;" />`
                                    : ''
                                }
                            </div>
                            <input type="file" id="signature-input" accept="image/*" style="flex: 1;" />
                        </div>
                    </label>
                </div>

                <label class="field" style="margin-top: 0.5rem;">
                    <span>Home Address</span>
                    <textarea name="address" rows="2">${escapeHtml(member?.address || '')}</textarea>
                </label>

                <!-- Manager Dropdown UI -->
                <div class="field" style="margin-top: 1rem; position: relative;">
                    <span>Account Manager(s)</span>
                    <button type="button" class="dropdown-btn" id="manager-dropdown-trigger">
                        <span id="manager-trigger-text">Select Managers...</span>
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <div id="manager-dropdown" class="dropdown-menu hidden">
                        <!-- Rendered by renderManagerDropdown() -->
                    </div>
                </div>

                ${isEdit ? `
                    <div style="margin-top: 2rem; padding: 1.25rem; background: var(--warning-bg); border: 1px solid var(--warning); border-radius: var(--radius-lg); display: flex; justify-content: space-between; align-items: center;">
                        <div style="font-size: 0.85rem; color: var(--warning);">
                            <strong>Security Notice:</strong> Password reset will be queued for synchronization immediately.
                        </div>
                        <button type="button" id="reset-pwd-btn" class="secondary-button" style="padding: 0.5rem 1rem; font-size: 0.8rem; background: var(--bg-card); color: var(--text-primary);">Reset 4-Digit PIN</button>
                    </div>
                ` : ''}
            </div>

            <!-- NOK & Bank Tab -->
            <div id="tab-nok" class="hidden">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                    <div>
                        <h4 style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--text-primary);">Next of Kin</h4>
                        <label class="field"><span>Full Name</span><input name="nok_name" value="${escapeHtml(member?.nok_name || '')}"></label>
                        <label class="field"><span>Mobile</span><input name="nok_mobile" value="${escapeHtml(member?.nok_mobile || '')}"></label>
                        <label class="field"><span>Address</span><input name="nok_address" value="${escapeHtml(member?.nok_address || '')}"></label>
                    </div>
                    <div>
                        <h4 style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--text-primary);">Bank Details</h4>
                        <label class="field"><span>Bank Name</span><input name="bank_name" value="${escapeHtml(member?.bank_name || '')}"></label>
                        <label class="field"><span>Account Number</span><input name="account_number" value="${escapeHtml(member?.account_number || '')}"></label>
                        <label class="field"><span>Account Name</span><input name="account_name" value="${escapeHtml(member?.account_name || '')}"></label>
                    </div>
                </div>
            </div>

            <!-- Payment Advice Tab -->
            <div id="tab-pay" class="hidden">
                <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.5rem;">Set monthly contribution expectations for this member.</p>
                <div style="max-height: 400px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: var(--radius-lg);">
                    <table class="styled-table">
                        <thead><tr><th>Enterprise</th><th style="text-align: right;">Amount</th></tr></thead>
                        <tbody>
                            ${enterpriseList.map(ent => {
                                const advice = member?.payment_advise?.find(a => a.enterprise_id === ent.id)
                                const amount = advice ? advice.amount : '0.00'
                                return `
                                    <tr>
                                        <td>${escapeHtml(ent.account_name)}</td>
                                        <td style="text-align: right;"><input type="number" step="0.01" class="pay-advise-input" data-ent-id="${ent.id}" value="${amount}" style="width: 120px; text-align: right;"></td>
                                    </tr>
                                `
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <div style="margin-top: 3rem; display: flex; justify-content: flex-end; gap: 1rem; border-top: 1px solid var(--border-light); padding-top: 2rem;">
                <button type="button" class="secondary-button" id="cancel-btn" style="padding: 0.75rem 2rem; color: var(--text-primary);">Cancel</button>
                <button type="submit" class="primary-button" id="save-member-btn" style="padding: 0.75rem 2rem;">Save Member</button>
            </div>
          </form>
        </div>
      </div>
    `

    renderManagerDropdown()
    updateFormTabs()

    // Wrap all date inputs
    container.querySelectorAll('input[type="date"]').forEach(wrapDateInput);
    
    // Passport Handler
    const passportInput = container.querySelector('#passport-input')
    const passportPreview = container.querySelector('#passport-preview')
    passportInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0]
        if (file) {
            try {
                selectedPassport = await compressImage(file)
                passportPreview.innerHTML = `<img src="${selectedPassport}" style="width: 100%; height: 100%; object-fit: cover;" />`
            } catch (err) {
                console.error('Passport compression failed:', err)
            }
        }
    })

    // Signature Handler
    const signatureInput = container.querySelector('#signature-input')
    const signaturePreview = container.querySelector('#signature-preview')
    signatureInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0]
        if (file) {
            try {
                selectedSignature = await compressImage(file)
                signaturePreview.innerHTML = `<img src="${selectedSignature}" style="width: 100%; height: 100%; object-fit: contain;" />`
            } catch (err) {
                console.error('Signature compression failed:', err)
            }
        }
    })

    // Manager Dropdown Trigger
    const trigger = container.querySelector('#manager-dropdown-trigger')
    const menu = container.querySelector('#manager-dropdown')
    trigger?.addEventListener('click', (e) => {
        e.stopPropagation()
        menu?.classList.toggle('hidden')
        if (!menu?.classList.contains('hidden')) {
            renderManagerDropdown()
            menu.querySelector('#mgr-dropdown-search')?.focus()
        }
    })

    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
        if (!container.querySelector('#manager-dropdown-trigger')?.parentElement?.contains(e.target)) {
            menu?.classList.add('hidden')
        }
    })

    // Tab switcher
    container.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeFormTab = btn.dataset.tab
            updateFormTabs()
        })
    })

    // Back & Cancel
    const goBack = () => window.location.hash = 'members'
    container.querySelector('#back-to-list-btn')?.addEventListener('click', goBack)
    container.querySelector('#cancel-btn')?.addEventListener('click', goBack)

    // DUPLICATE CHECK LOGIC
    const mobileInput = container.querySelector('#mobile-input')
    const errorDiv = container.querySelector('#duplicate-error')
    mobileInput?.addEventListener('input', (e) => {
        const val = e.target.value.trim()
        if (val.length >= 7) {
            const isDup = getAllMembers().some(m => m.mobile === val && m.id !== member?.id)
            if (isDup) errorDiv.classList.remove('hidden')
            else errorDiv.classList.add('hidden')
        } else {
            errorDiv.classList.add('hidden')
        }
    })

    // SPECIAL ID DUPLICATE CHECK LOGIC
    const specialIdInput = container.querySelector('#special-id-input')
    const specialIdErrorDiv = container.querySelector('#special-id-duplicate-error')
    specialIdInput?.addEventListener('input', (e) => {
        const val = normalizeSpecialId(e.target.value)
        if (val) {
            const isDup = getAllMembers().some(m => m.special_id?.toUpperCase() === val && m.id !== member?.id)
            if (isDup) specialIdErrorDiv.classList.remove('hidden')
            else specialIdErrorDiv.classList.add('hidden')
        } else {
            specialIdErrorDiv.classList.add('hidden')
        }
    })

    // PASSWORD RESET
    container.querySelector('#reset-pwd-btn')?.addEventListener('click', async () => {
        const newPwd = generateRandom4Digit()
        if (confirm(`Reset password to ${newPwd}? This will sync instantly.`)) {
            try {
                await updateMember(member.id, { ...member, password_hash: newPwd }, user.username)
                showToast(`Password successfully reset to: ${newPwd}`, 'success')
            } catch (err) {
                showToast("Reset failed: " + err.message, 'error')
            }
        }
    })

    // FORM SUBMISSION
    container.querySelector('#member-form').addEventListener('submit', async (e) => {
        e.preventDefault()
        const submitBtn = container.querySelector('#save-member-btn')
        const fd = new FormData(e.target)

        // NORMALIZATION: Mobile Number (Last 10 Digits)
        const normalizePhone = (num) => {
            const cleaned = (num || '').replace(/\D/g, '')
            return cleaned.length > 10 ? cleaned.slice(-10) : cleaned
        }

        const rawMobile = fd.get('mobile')
        const normalizedMobile = normalizePhone(rawMobile)
        
        // NORMALIZATION: Special ID (Uppercase)
        const rawSpecialId = fd.get('special_id')
        const normalizedSpecialId = normalizeSpecialId(rawSpecialId)
        
        // PROPER CASE: Names
        const properCase = (str) => (str || '').trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')

        const data = {
            cooperative_id: user.cooperativeId,
            last_name: properCase(fd.get('last_name')),
            first_name: properCase(fd.get('first_name')),
            middle_name: properCase(fd.get('middle_name')),
            email: fd.get('email')?.trim(),
            mobile: normalizedMobile,
            special_id: normalizedSpecialId,
            status: fd.get('status'),
            sex: fd.get('sex'),
            date_joined: fd.get('date_joined'),
            address: fd.get('address')?.trim(),
            nok_name: properCase(fd.get('nok_name')),
            nok_mobile: normalizePhone(fd.get('nok_mobile')),
            nok_address: fd.get('nok_address')?.trim(),
            bank_name: fd.get('bank_name')?.trim(),
            account_number: fd.get('account_number')?.trim(),
            account_name: properCase(fd.get('account_name')),
            account_manager: selectedManagers.join(','),
            image_path: selectedPassport,
            signature_path: selectedSignature,
            payment_advise: Array.from(container.querySelectorAll('.pay-advise-input')).map(inp => ({
                enterprise_id: inp.dataset.entId,
                amount: parseFloat(inp.value || 0)
            }))
        }

        // Check for duplicates before submission
        const members = getAllMembers()
        const mobileDup = members.some(m => m.mobile === normalizedMobile && m.id !== member?.id)
        if (mobileDup) {
            showToast('This mobile number is already registered to another member.', 'error')
            errorDiv.classList.remove('hidden')
            return
        }

        if (normalizedSpecialId) {
            const specialIdDup = members.some(m => m.special_id?.toUpperCase() === normalizedSpecialId && m.id !== member?.id)
            if (specialIdDup) {
                showToast('This Special ID is already registered to another member.', 'error')
                specialIdErrorDiv.classList.remove('hidden')
                return
            }
        }

        try {
            submitBtn.disabled = true; submitBtn.innerText = 'Saving...'
            if (isEdit) {
                await updateMember(member.id, data, user.username)
            } else {
                data.password_hash = generateRandom4Digit()
                const res = await addMember(data, user.username)
                if (res?.generatedPassword) {
                    showToast(`Member created! Initial Password: ${res.generatedPassword}`, 'success')
                }
            }
            await loadMembersData(user)
            goBack()
            window.dispatchEvent(new Event('refresh-members'))
        } catch (err) {
            submitBtn.disabled = false; submitBtn.innerText = 'Save Member'
            showToast("Save failed: " + err.message, 'error')
        }
    })
}
