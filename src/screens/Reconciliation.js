import { getReconciliationTotals, saveReconciliationSummary, fetchBanks, getReconciliationSummary, unsealReconciliation } from '../services/dataService.js'
import { hasPermission } from '../services/permissionService.js'
import { formatCurrency, escapeHtml } from '../utils/formatters.js'
import { showToast } from '../services/toastService.js'
import { showWorkspaceSpinner } from '../components/workspaceSpinner.js'
import { save as persistState, load as loadPersisted, clear as clearPersisted } from '../services/statePersistence.js'

export async function renderReconciliation(state, container) {
  const user = state.welcomeUser
  const permissions = user.permissions || ''
  
  const canRead = hasPermission(user.permissions, 'read_reconcile')
  const canCreate = hasPermission(user.permissions, 'create_reconcile')
  const isAdmin = hasPermission(user.permissions, 'admin') || user.username?.toLowerCase() === 'admin'

  if (!canRead) {
    container.innerHTML = `
      <div class="page-container">
        <div class="alert">
          <strong>Access Restricted:</strong> Your account does not have sufficient permissions to access the Reconciliation module.
        </div>
      </div>`
    return
  }

  // Generate last 12 months
  const months = []
  const d = new Date()
  for (let i = 0; i < 12; i++) {
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    months.push({ label: `${d.toLocaleString('default', { month: 'long' })} ${yyyy}`, value: `${yyyy}-${mm}` })
    d.setMonth(d.getMonth() - 1)
  }

  // Fetch Banks (spinner first — same workspace loader as other pages)
  showWorkspaceSpinner(container);
  let banks = []
  try {
    banks = await fetchBanks(state.welcomeUser.cooperativeId)
    banks = banks.filter(b => (b.bank_name || '').toLowerCase() !== 'internal transfer')
  } catch (err) {
    console.error("Failed to fetch banks", err)
  }

  container.innerHTML = `
    <div class="page-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
      <div>
        <h2 style="margin: 0; color: var(--text-primary);">Bank Reconciliation</h2>
        <p class="subtitle" style="margin: 0.25rem 0 0 0; color: var(--text-muted);">Verify and seal monthly bank ledger totals.</p>
      </div>
      <button type="button" class="ghost-button" id="clear-recon-form-btn" style="color: var(--danger); border: 1px solid var(--danger-bg);">🗑 Clear Form</button>
    </div>

    <div class="page-container">
      <!-- 3-Card Control Row -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
        
        <!-- Selection Sidebar -->
        <div class="card" style="background: var(--bg-card); border: 1px solid var(--border-light); height: 100%;">
          <h3 style="margin-top: 0; font-size: 1.1rem; border-bottom: 1px solid var(--border-light); padding-bottom: 0.75rem; margin-bottom: 1rem; color: var(--text-primary);">Parameters</h3>
          <div class="form" style="margin-top: 0.5rem;">
            <label class="field">
              <span>Period</span>
              <select id="recon-month">
                <option value="">Select Month</option>
                ${months.map(m => `<option value="${m.value}">${m.label}</option>`).join('')}
              </select>
            </label>
            <label class="field">
              <span>Bank Account</span>
              <select id="recon-bank">
                <option value="">Select Bank</option>
                ${banks.map(b => `<option value="${b.bank_name}">${b.bank_name}</option>`).join('')}
              </select>
            </label>
          </div>
        </div>

        <!-- Statement Totals -->
        <div class="card" style="background: var(--bg-card); border: 1px solid var(--border-light); height: 100%;">
          <h3 style="margin-top: 0; font-size: 1.1rem; border-bottom: 1px solid var(--border-light); padding-bottom: 0.75rem; margin-bottom: 1rem; color: var(--text-primary);">Statement Totals</h3>
          <div class="form" style="margin-top: 0.5rem;">
            <label class="field">
              <span>Total Credits (+)</span>
              <input type="number" id="bank-cr" step="0.01" placeholder="0.00">
            </label>
            <label class="field">
              <span>Total Debits (-)</span>
              <input type="number" id="bank-dr" step="0.01" placeholder="0.00">
            </label>
          </div>
        </div>

        <!-- System Records -->
        <div class="card" style="background: var(--bg-secondary); border: 1px solid var(--border-light); height: 100%;">
          <h3 style="margin-top: 0; font-size: 1.1rem; border-bottom: 1px solid var(--border-light); padding-bottom: 0.75rem; margin-bottom: 1rem; color: var(--text-primary);">System Records</h3>
          <div style="margin-top: 0.5rem; display: flex; flex-direction: column; gap: 1rem;">
            <div>
              <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">CALCULATED CREDITS</div>
              <div id="sys-cr" style="font-size: 1.5rem; font-weight: 800; color: var(--text-primary);">₦0.00</div>
            </div>
            <div>
              <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">CALCULATED DEBITS</div>
              <div id="sys-dr" style="font-size: 1.5rem; font-weight: 800; color: var(--text-primary);">₦0.00</div>
            </div>
          </div>
        </div>

      </div>

      <p style="font-size: 0.8rem; color: var(--text-muted); margin: -1rem 0 2rem 0.5rem;">
        <strong style="color: var(--text-primary);">Note:</strong> Internal transfers are automatically excluded from system calculations.
      </p>

      <!-- Status and Action Bar -->
      <div id="recon-status-box" class="card" style="width: 100%; text-align: center; border: 2px dashed var(--border-medium); background: transparent; padding: 2rem;">
         <div id="recon-status-text" style="color: var(--text-muted);">
           Select parameters and enter statement totals to begin verification.
         </div>
         
         <div class="actions" style="justify-content: center; margin-top: 1.5rem; flex-wrap: wrap;">
            <button id="btn-check" class="primary-button" style="width: 100%; max-width: 250px;">
              Check Balance
            </button>
            ${canCreate ? `
              <button id="btn-lock" class="secondary-button hidden" style="background: var(--text-primary); color: var(--bg-card); width: 100%; max-width: 250px;">
                Seal Period
              </button>
            ` : ''}
            ${isAdmin ? `
              <button id="btn-unseal" class="secondary-button hidden" style="background: var(--danger); color: white; width: 100%; max-width: 250px;">
                Unseal Period
              </button>
            ` : ''}
         </div>
      </div>
    </div>


  `

  const btnCheck = document.getElementById('btn-check')
  const btnLock = document.getElementById('btn-lock')
  const btnUnseal = document.getElementById('btn-unseal')
  const statusBox = document.getElementById('recon-status-box')
  const statusText = document.getElementById('recon-status-text')
  
  let currentRelevantIds = []
  let currentSummaryId = null

  // Persistence logic — uses centralized statePersistence module
  const DRAFT_KEY = `recon-draft-${state.welcomeUser.cooperativeId}`
  const inputs = ['recon-month', 'recon-bank', 'bank-cr', 'bank-dr']
  
  const saveDraft = () => {
    const draft = {}
    inputs.forEach(id => {
        const el = document.getElementById(id)
        if (el) draft[id] = el.value
    })
    persistState(DRAFT_KEY, draft)
  }

  const loadDraft = () => {
    const draft = loadPersisted(DRAFT_KEY)
    if (!draft) return
    inputs.forEach(id => {
        const el = document.getElementById(id)
        if (el && draft[id] !== undefined) el.value = draft[id]
    })
  }

  const clearDraft = () => clearPersisted(DRAFT_KEY)

  loadDraft()

  inputs.forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => {
          saveDraft()
          if (id === 'recon-month' || id === 'recon-bank') {
              checkForExistingRecon()
          }
      })
  })

  document.getElementById('clear-recon-form-btn')?.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all inputs?')) {
          clearDraft()
          renderReconciliation(state, container)
      }
  })

  btnCheck.addEventListener('click', async () => {
    const month = document.getElementById('recon-month').value
    const bank = document.getElementById('recon-bank').value
    
    if (!month || !bank) {
      showToast("Select Month and Bank Account", "warning")
      return
    }

    const bankCrStr = document.getElementById('bank-cr').value
    const bankDrStr = document.getElementById('bank-dr').value

    if (!bankCrStr || !bankDrStr) {
      showToast("Enter statement totals", "warning")
      return
    }

    const bankCr = parseFloat(bankCrStr)
    const bankDr = parseFloat(bankDrStr)

    try {
      btnCheck.disabled = true
      btnCheck.innerText = 'Verifying...'

      const { systemCr, systemDr, relevantIds } = await getReconciliationTotals(bank, month, state.welcomeUser.cooperativeId)
      
      document.getElementById('sys-cr').innerText = formatCurrency(systemCr)
      document.getElementById('sys-dr').innerText = formatCurrency(systemDr)
      
      currentRelevantIds = relevantIds

      const diffCr = bankCr - systemCr
      const diffDr = bankDr - systemDr

      statusBox.style.borderStyle = 'solid'
      statusBox.style.background = 'var(--bg-card)'

      if (Math.abs(diffCr) < 0.01 && Math.abs(diffDr) < 0.01) {
        statusBox.style.borderColor = 'var(--success)'
        statusText.innerHTML = `
          <div style="color: var(--success); font-weight: 700; font-size: 1.1rem;">✓ Ledger Balanced</div>
          <p style="margin: 0.5rem 0 0; color: var(--success); font-size: 0.9rem;">System records match bank statement perfectly.</p>
        `
        if (btnLock) btnLock.classList.remove('hidden')
      } else {
        statusBox.style.borderColor = 'var(--danger)'
        statusText.innerHTML = `
          <div style="color: var(--danger); font-weight: 700; font-size: 1.1rem;">⚠ Discrepancy Found</div>
          <div style="display: flex; justify-content: center; gap: 2rem; margin-top: 0.5rem;">
            <div style="font-size: 0.85rem; color: var(--text-primary);">Credit Diff: <strong>${formatCurrency(diffCr)}</strong></div>
            <div style="font-size: 0.85rem; color: var(--text-primary);">Debit Diff: <strong>${formatCurrency(diffDr)}</strong></div>
          </div>
        `
        if (btnLock) btnLock.classList.add('hidden')
      }

    } catch (err) {
      showToast("Error verifying data", "error")
      console.error(err)
    } finally {
      btnCheck.disabled = false
      btnCheck.innerText = 'Check Balance'
    }
  })

  async function checkForExistingRecon() {
      const month = document.getElementById('recon-month').value
      const bank = document.getElementById('recon-bank').value
      if (!month || !bank) return

      try {
          const summary = await getReconciliationSummary(bank, month, state.welcomeUser.cooperativeId)
          if (summary) {
              currentSummaryId = summary.id
              // Repopulate
              document.getElementById('bank-cr').value = summary.bank_total_cr
              document.getElementById('bank-dr').value = summary.bank_total_dr
              document.getElementById('bank-cr').readOnly = true
              document.getElementById('bank-dr').readOnly = true
              document.getElementById('sys-cr').innerText = formatCurrency(summary.system_total_cr)
              document.getElementById('sys-dr').innerText = formatCurrency(summary.system_total_dr)
              
              statusBox.style.borderStyle = 'solid'
              statusBox.style.borderColor = 'var(--text-primary)'
              statusBox.style.background = 'var(--bg-secondary)'
              statusText.innerHTML = `<div style="color: var(--text-primary); font-weight: 700; font-size: 1.1rem;">🔒 Period Sealed</div>
                                      <p style="margin: 0.5rem 0 0; color: var(--text-muted); font-size: 0.85rem;">This data is currently read-only.</p>`
              
              btnCheck.classList.add('hidden')
              if (btnLock) btnLock.classList.add('hidden')
              if (btnUnseal) btnUnseal.classList.remove('hidden')
          } else {
              currentSummaryId = null
              btnCheck.classList.remove('hidden')
              if (btnUnseal) btnUnseal.classList.add('hidden')
              document.getElementById('bank-cr').readOnly = false
              document.getElementById('bank-dr').readOnly = false
              // Note: We don't clear inputs here to allow "Check Balance" flow if it was a draft
          }
      } catch (err) {
          console.error("Error checking for existing recon", err)
      }
  }

  // Initial check on load
  checkForExistingRecon()

  if (btnLock) {
    btnLock.addEventListener('click', async () => {
      const month = document.getElementById('recon-month').value
      const bank = document.getElementById('recon-bank').value
      const bankCr = parseFloat(document.getElementById('bank-cr').value)
      const bankDr = parseFloat(document.getElementById('bank-dr').value)
      const sysCr = parseFloat(document.getElementById('sys-cr').innerText.replace(/[^\d.-]/g, ''))
      const sysDr = parseFloat(document.getElementById('sys-dr').innerText.replace(/[^\d.-]/g, ''))

      if (!confirm(`Are you sure you want to seal ${month} for ${bank}?\nThis action is permanent.`)) return

      const summaryData = {
        cooperative_id: state.welcomeUser.cooperativeId,
        bank_name: bank,
        period_month: month,
        bank_total_cr: bankCr,
        bank_total_dr: bankDr,
        system_total_cr: sysCr,
        system_total_dr: sysDr,
        status: "Balanced"
      }

      try {
        btnLock.disabled = true
        btnLock.innerText = 'Sealing...'
        await saveReconciliationSummary(summaryData, currentRelevantIds, user.username)
        showToast("Period sealed successfully", "success")
        clearDraft()
        btnLock.classList.add('hidden')
        statusText.innerHTML = `<div style="color: var(--text-primary); font-weight: 700;">🔒 Period Sealed & Archived</div>`
      } catch (err) {
        showToast("Failed to seal period", "error")
        btnLock.disabled = false
        btnLock.innerText = 'Seal Period'
      }
    })
  }

  if (btnUnseal) {
      btnUnseal.addEventListener('click', async () => {
          if (!currentSummaryId) return
          if (!confirm("Are you sure you want to UNSEAL this period?\nThis will allow modifications to remittances in this month.")) return
          
          try {
              btnUnseal.disabled = true
              btnUnseal.innerText = 'Unsealing...'
              await unsealReconciliation(currentSummaryId, user.username)
              showToast("Period unsealed", "success")
              currentSummaryId = null
              btnUnseal.classList.add('hidden')
              btnCheck.classList.remove('hidden')
              document.getElementById('bank-cr').readOnly = false
              document.getElementById('bank-dr').readOnly = false
              statusBox.style.borderStyle = 'dashed'
              statusBox.style.borderColor = 'var(--border-medium)'
              statusBox.style.background = 'transparent'
              statusText.innerText = "Select parameters and enter statement totals to begin."
          } catch (err) {
              showToast("Failed to unseal", "error")
              btnUnseal.disabled = false
              btnUnseal.innerText = 'Unseal Period'
          }
      })
  }

}
