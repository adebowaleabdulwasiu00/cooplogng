import { escapeHtml, formatDateForInput, generateRandom6Digit, wrapDateInput } from '../../utils/formatters.js'
import { compressImage } from '../../utils/imageUtils.js'
import { checkSignatureImage } from '../../utils/signatureCheck.js'
import { normalizePhone } from '../../utils/normalize.js'
import { addMember, updateMember, fetchCooperativeUsers } from '../../services/dataService.js'
import { getAllMembers, usersList, enterpriseList, loadMembersData } from './membersState.js'
import { getAllForCoop } from '../../services/sqliteService.js'
import { showToast } from '../../services/toastService.js'

export async function renderMembersForm(container, user, member = null) {
    const isEdit = !!member
    let activeFormTab = 'bio'
    // Default managers for new members: admins keep the legacy "all managers"
    // default; non-admin creators default to themselves so the record stays
    // visible to them (fetchAllMembers is manager-scoped) without leaking to
    // every manager. Falls back to all when the username isn't in usersList.
    const creatorIsomnipresent = (() => {
        try {
            const perms = user?.permissions
            const p = String(perms || '').toLowerCase()
            if (p.includes('admin')) return true
        } catch {}
        return String(user?.username || '').toLowerCase() === 'admin'
    })()
    let selectedManagers = isEdit
        ? String(member.account_manager || '').split(',').map(s => s.trim()).filter(Boolean)
        : (() => {
            const all = usersList.map(u => u.username)
            if (creatorIsomnipresent) return all
            const self = String(user?.username || '').trim()
            return self && all.includes(self) ? [self] : all
        })()
    let pendingManagers = [...selectedManagers]
    let selectedPassport = member?.image_path || null
    let selectedSignature = member?.signature_path || null

    // Normalize Special ID - trim only; case-insensitive search uses special_id_lower
    const normalizeSpecialId = (id) => {
        if (!id) return null
        return String(id).trim()
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
        .tab-btn.has-error {
            color: var(--danger);
        }
        .tab-btn.has-error::after {
            content: ' •';
            font-weight: 800;
        }
        @media (max-width: 640px) {
            .form-card { padding: 1.1rem; }
            .nok-bank-grid { grid-template-columns: 1fr !important; }
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
                    <div class="field" style="margin-bottom: 1.25rem; background: var(--bg-secondary); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: 0.6rem 0.9rem;">
                        <span style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Full name preview</span>
                        <div id="full-name-preview" style="font-size: 1rem; font-weight: 700; color: var(--text-primary);">—</div>
                    </div>
                    <label class="field">
                        <span>Date Joined</span>
                        <input name="date_joined" type="date" value="${member ? formatDateForInput(member.date_joined) : formatDateForInput(new Date())}">
                    </label>
                    <label class="field">
                        <span>Date of Birth</span>
                        <input name="dob" type="date" value="${member ? formatDateForInput(member.dob) : ''}">
                    </label>
                    <label class="field">
                        <span>Marital Status</span>
                        <select name="marital_status">
                            ${(() => {
                                const opts = ['Single', 'Married', 'Divorced', 'Widowed']
                                const cur = member?.marital_status || ''
                                const extra = cur && !opts.includes(cur) ? `<option value="${escapeHtml(cur)}" selected>${escapeHtml(cur)}</option>` : ''
                                const none = `<option value="" ${!cur ? 'selected' : ''}>—</option>`
                                return none + extra + opts.map(o => `<option value="${o}" ${cur === o ? 'selected' : ''}>${o}</option>`).join('')
                            })()}
                        </select>
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
                            <button type="button" id="passport-camera" class="ghost-button" title="Take photo with camera" style="font-size: 1rem; padding: 0.25rem 0.5rem;">📷</button>
                            <button type="button" id="passport-remove" class="ghost-button" style="font-size: 0.75rem; color: var(--danger); padding: 0.25rem 0.5rem;">Remove</button>
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
                            <button type="button" id="signature-camera" class="ghost-button" title="Take photo with camera" style="font-size: 1rem; padding: 0.25rem 0.5rem;">📷</button>
                            <button type="button" id="signature-remove" class="ghost-button" style="font-size: 0.75rem; color: var(--danger); padding: 0.25rem 0.5rem;">Remove</button>
                        </div>
                    </label>
                </div>

                <label class="field" style="margin-top: 0.5rem;">
                    <span>Home Address</span>
                    <textarea name="address" rows="2">${escapeHtml(member?.address || '')}</textarea>
                </label>

                <h4 style="margin: 1.25rem 0 1rem 0; font-size: 0.9rem; color: var(--text-primary);">Employment</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem;">
                    <label class="field">
                        <span>Employer</span>
                        <input name="employer" value="${escapeHtml(member?.employer || '')}">
                    </label>
                    <label class="field">
                        <span>Department</span>
                        <input name="department" value="${escapeHtml(member?.department || '')}">
                    </label>
                    <label class="field">
                        <span>Position</span>
                        <input name="position" value="${escapeHtml(member?.position || '')}">
                    </label>
                </div>

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
                <div class="nok-bank-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                    <div>
                        <h4 style="margin: 0 0 1rem 0; font-size: 0.9rem; color: var(--text-primary);">Next of Kin</h4>
                        <label class="field"><span>Full Name</span><input name="nok_name" value="${escapeHtml(member?.nok_name || '')}"></label>
                        <label class="field"><span>Relationship</span><input name="nok_relationship" value="${escapeHtml(member?.nok_relationship || '')}"></label>
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
                <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">Set monthly contribution expectations for this member.</p>
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.75rem; align-items: center;">
                    <input type="text" id="pay-advise-search" placeholder="Filter enterprises…" style="flex: 2; min-width: 160px; padding: 0.5rem 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--border-medium); background: var(--bg-input); color: var(--text-primary); font-size: 0.82rem;">
                    <input type="number" id="pay-advise-bulk" step="0.01" min="0" placeholder="Set all to…" style="flex: 1; min-width: 110px; padding: 0.5rem 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--border-medium); background: var(--bg-input); color: var(--text-primary); font-size: 0.82rem;">
                    <button type="button" id="pay-advise-apply" class="secondary-button" style="padding: 0.5rem 1rem; font-size: 0.78rem;">Apply</button>
                    <span id="pay-advise-total" style="margin-left: auto; font-size: 0.82rem; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums;"></span>
                </div>
                <div style="max-height: 400px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: var(--radius-lg);">
                    <table class="styled-table">
                        <thead><tr><th>Enterprise</th><th style="text-align: right;">Amount</th></tr></thead>
                        <tbody id="pay-advise-body">
                            ${enterpriseList.map(ent => {
                                const advice = member?.payment_advise?.find(a => a.enterprise_id === ent.id)
                                const amount = advice ? advice.amount : '0.00'
                                return `
                                    <tr class="pay-advise-row" data-search="${escapeHtml(String(ent.account_name || '').toLowerCase())}">
                                        <td>${escapeHtml(ent.account_name)}</td>
                                        <td style="text-align: right;"><input type="number" step="0.01" min="0" class="pay-advise-input" data-ent-id="${ent.id}" value="${amount}" style="width: 120px; text-align: right;"></td>
                                    </tr>
                                `
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <div style="margin-top: 3rem; display: flex; justify-content: flex-end; gap: 1rem; border-top: 1px solid var(--border-light); padding-top: 2rem; flex-wrap: wrap;">
                <button type="button" class="secondary-button" id="cancel-btn" style="padding: 0.75rem 2rem; color: var(--text-primary);">Cancel</button>
                ${isEdit ? '' : `<button type="button" class="secondary-button" id="save-add-btn" style="padding: 0.75rem 1.5rem;">Save &amp; Add Another</button>`}
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
                // Warn-only signature sanity check (never blocks saving)
                checkSignatureImage(file).then(r => {
                    if (r && (r.verdict === 'blank' || r.verdict === 'photo') && r.message) {
                        showToast(r.message, 'warning')
                    }
                }).catch(() => {})
            } catch (err) {
                console.error('Signature compression failed:', err)
            }
        }
    })

    // Camera buttons: shared picker (in-app camera -> native camera -> gallery).
    const runCameraFor = async (kind) => {
        const { pickImageFile } = await import('../../utils/photoPicker.js')
        const file = await pickImageFile({ title: kind === 'signature' ? 'Add signature photo' : 'Add passport photo' })
        if (!file) return
        try {
            const dataUrl = await compressImage(file)
            if (kind === 'signature') {
                selectedSignature = dataUrl
                if (signaturePreview) signaturePreview.innerHTML = `<img src="${dataUrl}" style="width: 100%; height: 100%; object-fit: contain;" />`
                checkSignatureImage(file).then(r => {
                    if (r && (r.verdict === 'blank' || r.verdict === 'photo') && r.message) {
                        showToast(r.message, 'warning')
                    }
                }).catch(() => {})
            } else {
                selectedPassport = dataUrl
                if (passportPreview) passportPreview.innerHTML = `<img src="${dataUrl}" style="width: 100%; height: 100%; object-fit: cover;" />`
            }
        } catch (err) {
            console.error('Camera photo compression failed:', err)
        }
    }
    container.querySelector('#passport-camera')?.addEventListener('click', () => runCameraFor('passport'))
    container.querySelector('#signature-camera')?.addEventListener('click', () => runCameraFor('signature'))

    // Remove photo / signature (edit mode: saving persists the removal —
    // updateMember writes null when the key is present with a null value)
    const emptyAvatar = `<span style="color: var(--text-muted); font-size: 2rem;">📷</span>`
    container.querySelector('#passport-remove')?.addEventListener('click', () => {
        selectedPassport = null
        if (passportInput) passportInput.value = ''
        if (passportPreview) passportPreview.innerHTML = emptyAvatar
    })
    container.querySelector('#signature-remove')?.addEventListener('click', () => {
        selectedSignature = null
        if (signatureInput) signatureInput.value = ''
        if (signaturePreview) signaturePreview.innerHTML = ''
    })

    // Payment-advice helpers: filter, bulk-set visible rows, live total
    const updatePayTotal = () => {
        let sum = 0
        container.querySelectorAll('.pay-advise-input').forEach(inp => {
            if (inp.closest('tr')?.style.display === 'none') return
            sum += parseFloat(inp.value || 0) || 0
        })
        const totalEl = container.querySelector('#pay-advise-total')
        if (totalEl) totalEl.textContent = `Total: ₦${sum.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
    container.querySelector('#pay-advise-search')?.addEventListener('input', (e) => {
        const term = String(e.target.value || '').trim().toLowerCase()
        container.querySelectorAll('.pay-advise-row').forEach(row => {
            row.style.display = !term || (row.dataset.search || '').includes(term) ? '' : 'none'
        })
        updatePayTotal()
    })
    container.querySelector('#pay-advise-apply')?.addEventListener('click', () => {
        const raw = container.querySelector('#pay-advise-bulk')?.value
        if (raw === '' || raw === undefined) {
            showToast('Enter an amount to apply to visible enterprises.', 'warning')
            return
        }
        container.querySelectorAll('.pay-advise-row').forEach(row => {
            if (row.style.display === 'none') return
            const inp = row.querySelector('.pay-advise-input')
            if (inp) inp.value = raw
        })
        updatePayTotal()
    })
    container.querySelectorAll('.pay-advise-input').forEach(inp => {
        inp.addEventListener('input', updatePayTotal)
    })
    updatePayTotal()

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

    // Close dropdown on click outside (remove previous form's handler first —
    // renderMembersForm re-runs on every add/edit navigation and would otherwise
    // stack document listeners that reference stale containers).
    if (window._membersFormOutsideClick) {
        document.removeEventListener('click', window._membersFormOutsideClick)
    }
    window._membersFormOutsideClick = (e) => {
        if (!container.isConnected) return
        if (!container.querySelector('#manager-dropdown-trigger')?.parentElement?.contains(e.target)) {
            container.querySelector('#manager-dropdown')?.classList.add('hidden')
        }
    }
    document.addEventListener('click', window._membersFormOutsideClick)

    // Tab switcher
    container.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeFormTab = btn.dataset.tab
            btn.classList.remove('has-error')
            updateFormTabs()
        })
    })

    // Jump to the tab holding the first invalid field so required errors on
    // hidden tabs are visible (native bubbles only show on visible fields).
    // Also flags the tab button until the user edits inside it.
    const memberFormEl = container.querySelector('#member-form')
    memberFormEl?.addEventListener('invalid', (e) => {
        const field = e.target
        const pane = field.closest?.('#tab-bio, #tab-nok, #tab-pay')
        if (pane) {
            const tabId = pane.id.replace('tab-', '')
            if (tabId !== activeFormTab) {
                activeFormTab = tabId
                updateFormTabs()
            }
            container.querySelector(`.tab-btn[data-tab="${tabId}"]`)?.classList.add('has-error')
        }
    }, true)
    memberFormEl?.addEventListener('input', (e) => {
        const pane = e.target.closest?.('#tab-bio, #tab-nok, #tab-pay')
        if (pane) {
            container.querySelector(`.tab-btn[data-tab="${pane.id.replace('tab-', '')}"]`)?.classList.remove('has-error')
        }
    }, true)

    // Live full-name preview (display only; save path re-applies properCase)
    const previewName = () => {
        const g = (n) => container.querySelector(`input[name="${n}"]`)?.value || ''
        const pc = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
        const full = [pc(g('last_name')), pc(g('first_name')), pc(g('middle_name'))].filter(Boolean).join(' ')
        const prev = container.querySelector('#full-name-preview')
        if (prev) prev.textContent = full || '—'
    }
    ;['last_name', 'first_name', 'middle_name'].forEach(n => {
        container.querySelector(`input[name="${n}"]`)?.addEventListener('input', previewName)
    })
    previewName()

    // Back & Cancel
    const goBack = () => window.location.hash = 'members'
    container.querySelector('#back-to-list-btn')?.addEventListener('click', goBack)
    container.querySelector('#cancel-btn')?.addEventListener('click', goBack)

    // Save & Add Another flag (add-mode only button; read by the submit handler)
    let saveAndAdd = false
    container.querySelector('#save-add-btn')?.addEventListener('click', () => {
        saveAndAdd = true
        container.querySelector('#member-form')?.requestSubmit()
    })

    // DUPLICATE CHECK LOGIC — coop-scoped (not manager-filtered) so a member
    // created by another manager / device still warns. Falls back to the
    // in-memory filtered list if the full coop read fails (offline edge).
    let coopMembersCache = null
    try {
        coopMembersCache = await getAllForCoop(String(user.cooperativeId), 'members')
    } catch { coopMembersCache = null }
    const dupScope = () => (Array.isArray(coopMembersCache) && coopMembersCache.length >= 0)
        ? coopMembersCache
        : getAllMembers()
    const mobileInput = container.querySelector('#mobile-input')
    const errorDiv = container.querySelector('#duplicate-error')
    mobileInput?.addEventListener('input', (e) => {
        const val = normalizePhone(e.target.value || '')
        if (val.length >= 7) {
            const isDup = dupScope().some(m => normalizePhone(m.mobile || '') === val && String(m.id) !== String(member?.id))
            if (isDup) errorDiv.classList.remove('hidden')
            else errorDiv.classList.add('hidden')
        } else {
            errorDiv.classList.add('hidden')
        }
    })

    // SPECIAL ID DUPLICATE CHECK LOGIC (trim + case-insensitive; blanks never collide)
    const specialIdInput = container.querySelector('#special-id-input')
    const specialIdErrorDiv = container.querySelector('#special-id-duplicate-error')
    specialIdInput?.addEventListener('input', (e) => {
        const val = normalizeSpecialId(e.target.value)
        if (val) {
            const key = String(val).toLowerCase()
            const isDup = dupScope().some(m => String(m.special_id || '').trim().toLowerCase() === key && String(m.id) !== String(member?.id))
            if (isDup) specialIdErrorDiv.classList.remove('hidden')
            else specialIdErrorDiv.classList.add('hidden')
        } else {
            specialIdErrorDiv.classList.add('hidden')
        }
    })

    // PASSWORD RESET
    container.querySelector('#reset-pwd-btn')?.addEventListener('click', async () => {
        const newPwd = generateRandom6Digit()
        if (confirm(`Reset PIN to ${newPwd}? The member will set a new PIN on next login.`)) {
            try {
                await updateMember(member.id, { ...member, password_hash: newPwd, force_password_change: true }, user.username)
                showToast(`PIN successfully reset to: ${newPwd}`, 'success')
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
        
        // NORMALIZATION: Special ID (trim; search is case-insensitive via special_id_lower)
        const rawSpecialId = fd.get('special_id')
        const normalizedSpecialId = normalizeSpecialId(rawSpecialId)
        
        // PROPER CASE: Names
        const properCase = (str) => (str || '').trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')

        const data = {
            cooperative_id: user.cooperativeId,
            last_name: properCase(fd.get('last_name')),
            first_name: properCase(fd.get('first_name')),
            middle_name: properCase(fd.get('middle_name')),
            email: fd.get('email') ? String(fd.get('email')).trim().toLowerCase() : null,
            mobile: normalizedMobile,
            special_id: normalizedSpecialId,
            status: fd.get('status'),
            sex: fd.get('sex'),
            date_joined: fd.get('date_joined'),
            dob: fd.get('dob') || '',
            marital_status: fd.get('marital_status') ? String(fd.get('marital_status')).trim() : '',
            employer: fd.get('employer')?.trim(),
            department: fd.get('department')?.trim(),
            position: fd.get('position')?.trim(),
            address: fd.get('address')?.trim(),
            nok_name: properCase(fd.get('nok_name')),
            nok_relationship: fd.get('nok_relationship')?.trim(),
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

        // Check for duplicates before submission — fresh coop-scoped read so a
        // member synced/created after the form opened still blocks. The data
        // layer re-checks anyway (defense in depth); this is for instant UX.
        let submitScope = null
        try {
            submitScope = await getAllForCoop(String(user.cooperativeId), 'members')
            coopMembersCache = submitScope
        } catch { submitScope = null }
        const members = Array.isArray(submitScope) ? submitScope : getAllMembers()
        const mobileDup = normalizedMobile
            ? members.some(m => normalizePhone(m.mobile || '') === normalizedMobile && String(m.id) !== String(member?.id))
            : false
        if (mobileDup) {
            showToast('This mobile number is already registered to another member.', 'error')
            errorDiv.classList.remove('hidden')
            return
        }

        if (normalizedSpecialId) {
            const specialIdDup = members.some(m => String(m.special_id || '').trim().toLowerCase() === String(normalizedSpecialId).toLowerCase() && String(m.id) !== String(member?.id))
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
                data.password_hash = generateRandom6Digit()
                const res = await addMember(data, user.username)
                if (res?.generatedPassword) {
                    showToast(`Member created! Initial Password: ${res.generatedPassword}`, 'success')
                }
            }
            await loadMembersData(user)
            window.dispatchEvent(new Event('refresh-members'))
            if (saveAndAdd && !isEdit) {
                // Fresh blank form for the next registration (same module, no nav).
                const { renderMembersForm } = await import('./membersForm.js')
                await renderMembersForm(container, user, null)
                return
            }
            goBack()
        } catch (err) {
            saveAndAdd = false
            submitBtn.disabled = false; submitBtn.innerText = 'Save Member'
            showToast("Save failed: " + err.message, 'error')
        }
    })
}
