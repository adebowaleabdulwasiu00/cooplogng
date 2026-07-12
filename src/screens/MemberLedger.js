import { buildMemberLedger, fetchAllMembers, fetchRemittances, fetchEnterprises, fetchMemberLoans, approveLoanRequest, declineLoanRequest, deleteRemittance } from '../services/dataService.js'
import { hasPermission } from '../services/permissionService.js'
import { formatCurrency, escapeHtml, formatDate, formatDateForInput } from '../utils/formatters.js'

if (!window.__ledgerFilters) {
  const now = new Date()
  const sixMonthsAgo = new Date(now)
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  window.__ledgerFilters = {
    dateFrom: formatDateForInput(sixMonthsAgo),
    dateTo: formatDateForInput(now),
    memberId: 'All',
    memberName: 'All Members (Global)'
  }
}

if (window.__pendingLedgerMember) {
  window.__ledgerFilters.memberId = window.__pendingLedgerMember
  window.__ledgerFilters.memberName = 'Selected Member'
  window.__pendingLedgerMember = null
}

if (!window.__summaryFilters) {
  window.__summaryFilters = {
    month: 'All',
    year: new Date().getFullYear().toString()
  }
}

if (!window.__pendingLedgerMember) {
  window.__pendingLedgerMember = null
  window.addEventListener('change-tab', (e) => {
    const { tab, memberId } = e.detail
    if (tab === 'ledger' && memberId) {
      window.__pendingLedgerMember = memberId
    }
  })
}

if (!window.__ledgerClickHandler) {
  window.__ledgerClickHandler = (e) => {
    if (!e.target.closest('.member-selector-wrap')) {
      const dd = document.getElementById('ledger-member-dropdown')
      if (dd) dd.classList.remove('open')
    }
  }
  document.addEventListener('click', window.__ledgerClickHandler)
}

function getMemberDisplay(memberId, memberName) {
  if (!memberId || memberId === 'All') return 'All Members (Global)'
  return memberName || 'Selected Member'
}

function roundUpTo100(val) {
  return Math.ceil(val / 100) * 100
}

export async function renderMemberLedger(container, user) {
  const currentYear = new Date().getFullYear().toString()
  const isAdmin = user.isAdmin || hasPermission(user.permissions, 'admin') || user.username?.toLowerCase() === 'admin'
  const isMember = user.role === 'member'

  if (isMember && user.memberId && user.memberId !== '0000000000' && window.__ledgerFilters.memberId === 'All') {
    window.__ledgerFilters.memberId = user.memberId
    window.__ledgerFilters.memberName = user.memberName || 'My Ledger'
  }

  const filters = window.__ledgerFilters

  const monthsList = ['All', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  const isGlobalView = () => filters.memberId === 'All'

  container.innerHTML = `
    <style>
      .lmv { display: none; }
      .lmc { background: var(--bg-card); border-radius: var(--radius-md); padding: 0.6rem; margin-bottom: 0.5rem; border: 1px solid var(--border-light); }
      .lch { font-size: 0.95rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.5rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--border-light); }
      .lcg { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
      .ls { display: flex; flex-direction: column; gap: 0.1rem; }
      .ls .sl { font-size: 0.6rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
      .ls .sv { font-size: 0.85rem; font-weight: 700; color: var(--text-primary); }

      /* Outer layout — contains its own scroll so sticky header truly freezes */
      .ledger-outer {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;  /* critical: allows flex child to shrink below content size */
        overflow: hidden;
      }

      /* Sticky frozen header — no position:sticky needed, just sits at top of flex col */
      .ledger-sticky-header {
        flex-shrink: 0;
        background: var(--bg-main);
        padding: 1.5rem 3rem 0.75rem;
        border-bottom: 1px solid var(--border-light);
        z-index: 50;
      }

      /* Scrollable content — inner scroll container */
      .ledger-scroll-body {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 1rem 3rem 2rem;
      }

      .scards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; margin-bottom: 1rem; }
      .scard { background: var(--bg-card); padding: 0.75rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-light); box-shadow: var(--shadow-sm); }
      .scard .lbl { font-size: 0.6rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 0.25rem; letter-spacing: 0.04em; }
      .scard .val { font-size: 1.1rem; font-weight: 800; color: var(--text-primary); }

      .lhdr { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
      .lhdr h2 { margin: 0; font-size: 1.2rem; font-weight: 800; white-space: nowrap; }
      .lhdr .sub { font-size: 0.75rem; color: var(--text-muted); margin: 0; }
      .lhdr .hdr-right { margin-left: auto; display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }

      .lfil { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
      .lfil .fg { display: flex; align-items: center; gap: 0.25rem; }
      .lfil .fg label { font-size: 0.6rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; white-space: nowrap; min-width: 2rem; }

      /* Dates always-inline container */
      .lfil-dates { display: flex; flex-direction: row; gap: 0.4rem; align-items: flex-end; flex-wrap: nowrap; }
      .lfil-dates .fg { flex-direction: column; align-items: stretch; gap: 0.15rem; }
      .lfil-dates .fg label { min-width: unset; }

      .dwrap { position: relative; display: inline-block; min-width: 120px; }
      .dwrap input[type="date"] { width: 100%; box-sizing: border-box; cursor: pointer; opacity: 0; position: absolute; top: 0; left: 0; height: 100%; padding: 0; }
      .dwrap .ddisp { width: 100%; box-sizing: border-box; cursor: pointer; padding: 0.35rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--border-medium); background: var(--bg-input); color: var(--text-primary); font-size: 0.75rem; font-weight: 600; white-space: nowrap; text-align: center; line-height: 1.5; }

      .mwrap { position: relative; min-width: 180px; max-width: 280px; }
      .mwrap input { width: 100%; box-sizing: border-box; padding: 0.35rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--border-medium); background: var(--bg-input); color: var(--text-primary); font-size: 0.75rem; line-height: 1.5; }
      .mdrop { display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: var(--radius-sm); box-shadow: var(--shadow-lg); z-index: 100; max-height: 200px; overflow-y: auto; margin-top: 2px; }
      .mdrop.open { display: block; }
      .mdrop .di { padding: 0.3rem 0.5rem; cursor: pointer; font-size: 0.75rem; color: var(--text-primary); border-bottom: 1px solid var(--border-light); transition: background 0.1s; }
      .mdrop .di:hover, .mdrop .di.hl { background: var(--bg-hover); }
      .mdrop .di.all { font-weight: 700; color: var(--accent-primary); border-bottom: 2px solid var(--border-medium); }

      .sfils { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; }
      .sfils label { font-size: 0.6rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; display: flex; align-items: center; gap: 0.25rem; }
      .sfils select { padding: 0.35rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--border-medium); background: var(--bg-input); color: var(--text-primary); font-size: 0.75rem; }

      .lmodal-overlay { display: none; position: fixed; inset: 0; z-index: 2000; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; }
      .lmodal-overlay.open { display: flex; }
      .lmodal { background: var(--bg-card); border-radius: var(--radius-lg); max-width: 600px; width: 92%; max-height: 85vh; overflow-y: auto; box-shadow: var(--shadow-xl); }
      .lmodal-hdr { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border-light); position: sticky; top: 0; background: var(--bg-card); z-index: 1; }
      .lmodal-hdr h3 { margin: 0; font-size: 1rem; }
      .lmodal-body { padding: 0.75rem 1rem 1rem; }
      .lmodal-body .section { margin-bottom: 0.75rem; }
      .lmodal-body .section:last-child { margin-bottom: 0; }
      .lmodal-body .s-title { font-size: 0.65rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.35rem; }
      .lmodal-body .s-row { display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.85rem; }
      .lmodal-body .s-row + .s-row { border-top: 1px solid var(--border-light); }
      .lmodal-body .charges-list { max-height: 200px; overflow-y: auto; }
      .lmodal-actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border-light); flex-wrap: wrap; }

      .tc { overflow-x: auto; border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--bg-card); }
      .tc table { width: 100%; font-size: 0.78rem; }
      .tc table th { padding: 0.4rem 0.5rem; font-size: 0.68rem; white-space: nowrap; background: var(--bg-secondary); }
      .tc table td { padding: 0.35rem 0.5rem; }
      .tc table tr { cursor: pointer; transition: background 0.1s; }
      .tc table tbody tr:hover { background: var(--bg-hover); }

      /* Tab styles */
      .ltabs { display: flex; gap: 0.35rem; margin-bottom: 0; background: var(--bg-input, #f1f5f9); padding: 0.3rem; border-radius: var(--radius-md); }
      .ltab { flex: 1; padding: 0.45rem 0.75rem; border: none; background: transparent; color: var(--text-muted); font-weight: 600; font-size: 0.85rem; cursor: pointer; border-radius: var(--radius-sm); white-space: nowrap; transition: all 0.2s ease; text-align: center; }
      .ltab:hover { color: var(--text-primary); background: var(--bg-hover, rgba(0,0,0,0.05)); }
      .ltab.active { background: var(--bg-card, #ffffff); color: var(--accent-primary); box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.1)); }

      @media (max-width: 768px) {
        .ldv { display: none; }
        .lmv { display: block; }
        .ledger-sticky-header {
          padding: 0.6rem 0.75rem 0.5rem;
        }
        .ledger-scroll-body {
          padding: 0.75rem 0.75rem 1.5rem;
        }
        /* Dates on same row */
        .lfil-dates { width: 100%; gap: 0.35rem; }
        .lfil-dates .fg { flex: 1; }
        .lfil-dates .fg label { font-size: 0.55rem; }
        .dwrap { min-width: auto; width: 100%; }
        /* Stats: always 2 columns on mobile — never 3+1 */
        .scards { grid-template-columns: 1fr 1fr !important; }
        /* Hide member selector in header (it's in top bar on mobile) */
        .lhdr-member-desktop { display: none !important; }
        /* Hide page title in sticky header on mobile (shown in top bar) */
        .lhdr > div:first-child { display: none; }
        .lhdr { flex-direction: column; align-items: flex-start; margin-bottom: 0.5rem; }
        .lhdr .hdr-right { margin-left: 0; width: 100%; }
        .lfil { margin-bottom: 0; }
        /* Tab names shortened */
        .ltab .tab-label-full { display: none; }
        .ltab .tab-label-short { display: inline; }
        .ltab { font-size: 0.78rem; padding: 0.4rem 0.4rem; }
      }
      @media (min-width: 769px) {
        .ltab .tab-label-full { display: inline; }
        .ltab .tab-label-short { display: none; }
      }
    </style>

    <div class="ledger-outer">

    <!-- Frozen sticky header -->
    <div class="ledger-sticky-header">
      <div class="lhdr" style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.6rem; margin-bottom: 0.6rem;">
        <div style="flex: 1; min-width: 200px;">
          <h2 style="margin: 0; font-size: 1.3rem; font-weight: 800;">${isGlobalView() ? 'Cooperative Ledger' : 'Member Ledger'}</h2>
          <p class="sub" id="ledger-subtitle" style="margin: 0.25rem 0 0 0; font-size: 0.85rem; color: var(--text-muted);"></p>
        </div>

        <div class="lfil" style="margin-bottom: 0; justify-content: flex-end; flex-wrap: wrap;">
          <!-- Dates row (always inline) -->
          <div class="lfil-dates">
            <div class="fg">
              <label>From</label>
              <div class="dwrap">
                <input type="date" id="ledger-date-from" value="${filters.dateFrom}">
                <input type="text" class="ddisp" readonly value="${filters.dateFrom ? formatDate(filters.dateFrom) : ''}" data-for="ledger-date-from">
              </div>
            </div>
            <div class="fg">
              <label>To</label>
              <div class="dwrap">
                <input type="date" id="ledger-date-to" value="${filters.dateTo}">
                <input type="text" class="ddisp" readonly value="${filters.dateTo ? formatDate(filters.dateTo) : ''}" data-for="ledger-date-to">
              </div>
            </div>
          </div>
          <!-- Member selector: desktop only, hidden on mobile (search is in top bar) -->
          <div class="fg lhdr-member-desktop" style="min-width: 180px; max-width: 240px;">
            <label>Member</label>
            <div class="mwrap" style="width: 100%;">
              <input type="text" id="ledger-member-search" placeholder="All Members (Global)" value="${getMemberDisplay(filters.memberId, filters.memberName) === 'All Members (Global)' ? '' : getMemberDisplay(filters.memberId, filters.memberName)}" autocomplete="off">
              <div class="mdrop" id="ledger-member-dropdown"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab switcher -->
      <div class="ltabs">
        <button class="ltab" data-tab="tab-transactions">
          <span class="tab-label-full">Transaction Ledger</span>
          <span class="tab-label-short">Ledger</span>
        </button>
        <button class="ltab active" data-tab="tab-summary">
          <span class="tab-label-full">Monthly/Yearly Summary</span>
          <span class="tab-label-short">Summary</span>
        </button>
        <button class="ltab" data-tab="tab-loans">
          <span class="tab-label-full">Loan Details</span>
          <span class="tab-label-short">Loan</span>
        </button>
      </div>
    </div><!-- /.ledger-sticky-header -->

    <!-- Scrollable body -->
    <div class="ledger-scroll-body">
      <div id="ledger-content"></div>
    </div>

    </div><!-- /.ledger-outer -->

    <div class="lmodal-overlay" id="loan-detail-overlay">
      <div class="lmodal">
        <div class="lmodal-hdr">
          <h3 id="loan-detail-title">Loan Details</h3>
          <button class="ghost-button" id="loan-detail-close" style="font-size: 1.2rem; padding: 0.2rem 0.5rem;">&times;</button>
        </div>
        <div class="lmodal-body" id="loan-detail-body"></div>
      </div>
    </div>
  `

  const contentContainer = document.getElementById('ledger-content')

  let activeTabFromRoute = 'tab-summary'
  if (user.routeParts && user.routeParts.length > 0) {
    const route = user.routeParts[0]
    if (route === 'transactions') activeTabFromRoute = 'tab-transactions'
    else if (route === 'loans') activeTabFromRoute = 'tab-loans'
    else if (route === 'summary') activeTabFromRoute = 'tab-summary'
  }
  window._activeLedgerTab = activeTabFromRoute

  container.querySelectorAll('.ltab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === window._activeLedgerTab)
  })

  const switchTab = (tabId) => {
    let subRoute = 'summary'
    if (tabId === 'tab-transactions') subRoute = 'transactions'
    else if (tabId === 'tab-loans') subRoute = 'loans'
    window.location.hash = `ledger/${subRoute}`
  }

  container.querySelectorAll('.ltab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  })

  document.getElementById('loan-detail-close').addEventListener('click', () => {
    document.getElementById('loan-detail-overlay').classList.remove('open')
  })

  function setupDatePicker(inputId) {
    const hiddenInput = document.getElementById(inputId)
    const displayInput = container.querySelector(`.ddisp[data-for="${inputId}"]`)
    if (!hiddenInput || !displayInput) return

    const updateDisplay = () => {
      displayInput.value = hiddenInput.value ? formatDate(hiddenInput.value) : ''
    }

    hiddenInput.addEventListener('change', () => {
      updateDisplay()
      window.__ledgerFilters.dateFrom = document.getElementById('ledger-date-from').value
      window.__ledgerFilters.dateTo = document.getElementById('ledger-date-to').value
      renderActiveTab()
    })

    displayInput.addEventListener('click', (e) => {
      e.preventDefault()
      if (typeof hiddenInput.showPicker === 'function') {
        hiddenInput.showPicker()
      } else {
        hiddenInput.click()
      }
    })

    updateDisplay()
  }

  setupDatePicker('ledger-date-from')
  setupDatePicker('ledger-date-to')

  let allMembersCache = null
  let memberSearchTimeout = null

  async function getMembersForSearch() {
    if (allMembersCache) return allMembersCache
    allMembersCache = await fetchAllMembers(user.cooperativeId, user.username, isAdmin)
    return allMembersCache
  }

  const memberSearchInput = document.getElementById('ledger-member-search')
  const memberDropdown = document.getElementById('ledger-member-dropdown')

  function buildMemberDropdownHtml(members, query) {
    const q = (query || '').toLowerCase().trim()
    let filtered = members
    if (q) {
      filtered = members.filter(m => {
        const name = `${m.first_name || ''} ${m.last_name || ''} ${m.middle_name || ''}`.toLowerCase()
        const regNo = String(m.member_registration_no || m.registration_no || '').toLowerCase()
        const mobile = String(m.mobile || '').toLowerCase()
        const specialId = String(m.special_id || '').toLowerCase()
        return name.includes(q) || regNo.includes(q) || mobile.includes(q) || specialId.includes(q)
      })
    }

    const allSelected = filters.memberId === 'All' ? 'hl' : ''
    let html = `<div class="di all ${allSelected}" data-member-id="All">All Members (Global)</div>`

    if (filtered.length === 0 && q) {
      html += `<div class="di" style="color: var(--text-muted); cursor: default;">No members found</div>`
    } else {
      html += filtered.map(m => {
        const name = `${m.first_name || ''} ${m.last_name || ''}`.trim() || 'Unknown'
        const regNo = m.member_registration_no || m.registration_no || ''
        const selected = filters.memberId === m.id ? 'hl' : ''
        return `<div class="di ${selected}" data-member-id="${m.id}" data-member-name="${escapeHtml(name)}">${escapeHtml(name)} ${regNo ? `<span style="color: var(--text-muted); font-size: 0.65rem;">(${escapeHtml(regNo)})</span>` : ''}</div>`
      }).join('')
    }
    return html
  }

  function renderMemberDropdown(members, query) {
    memberDropdown.innerHTML = buildMemberDropdownHtml(members, query)
    memberDropdown.classList.add('open')
  }

  function closeMemberDropdown() {
    memberDropdown.classList.remove('open')
  }

  function selectMember(memberId, memberName) {
    if (memberId === 'All') {
      filters.memberId = 'All'
      filters.memberName = 'All Members (Global)'
      if (memberSearchInput) { memberSearchInput.value = ''; memberSearchInput.placeholder = 'All Members (Global)' }
      // Sync mobile input
      const mobileInput = document.getElementById('ledger-member-search-mobile')
      if (mobileInput) { mobileInput.value = '' }
    } else {
      filters.memberId = memberId
      filters.memberName = memberName
      if (memberSearchInput) { memberSearchInput.value = memberName; memberSearchInput.placeholder = 'Search member...' }
      const mobileInput = document.getElementById('ledger-member-search-mobile')
      if (mobileInput) { mobileInput.value = memberName }
    }
    closeMemberDropdown()
    // Also close mobile dropdown
    const mobileDropdown = document.getElementById('ledger-member-dropdown-mobile')
    if (mobileDropdown) mobileDropdown.style.display = 'none'
    renderActiveTab()
  }

  if (memberSearchInput) {
    memberSearchInput.addEventListener('focus', async () => {
      const members = await getMembersForSearch()
      renderMemberDropdown(members, memberSearchInput.value)
    })

    memberSearchInput.addEventListener('input', async () => {
      if (memberSearchTimeout) clearTimeout(memberSearchTimeout)
      memberSearchTimeout = setTimeout(async () => {
        const members = await getMembersForSearch()
        renderMemberDropdown(members, memberSearchInput.value)
      }, 150)
    })
  }

  memberDropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.di')
    if (!item) return
    selectMember(item.dataset.memberId, item.dataset.memberName || '')
  })

  // --- Mobile top bar member search ---
  // Listen for the event fired by main.js when mobile input changes
  const _mobileLedgerSearchHandler = async (e) => {
    const query = e.detail?.query || ''
    const mobileDropdown = document.getElementById('ledger-member-dropdown-mobile')
    if (!mobileDropdown) return

    const members = await getMembersForSearch()
    const html = buildMemberDropdownHtml(members, query)
    // Style items to look good in the floating dropdown
    mobileDropdown.innerHTML = `<style>
      #ledger-member-dropdown-mobile .di { padding: 0.35rem 0.6rem; cursor: pointer; font-size: 0.75rem; color: var(--text-primary); border-bottom: 1px solid var(--border-light); }
      #ledger-member-dropdown-mobile .di:hover, #ledger-member-dropdown-mobile .di.hl { background: var(--bg-secondary); }
      #ledger-member-dropdown-mobile .di.all { font-weight: 700; color: var(--accent-primary); }
    </style>${html}`
    mobileDropdown.style.display = 'block'

    mobileDropdown.querySelectorAll('.di').forEach(item => {
      item.addEventListener('click', (ev) => {
        ev.stopPropagation()
        const mId = item.dataset.memberId
        const mName = item.dataset.memberName || ''
        selectMember(mId, mName)
        mobileDropdown.style.display = 'none'
      })
    })
  }

  // Remove any stale listener from previous render before adding
  if (window._currentMobileLedgerSearchHandler) {
    window.removeEventListener('mobile-ledger-member-search', window._currentMobileLedgerSearchHandler)
  }
  window._currentMobileLedgerSearchHandler = _mobileLedgerSearchHandler
  window.addEventListener('mobile-ledger-member-search', window._currentMobileLedgerSearchHandler)


  const _ledgerCacheKey = () => `${filters.dateFrom}|${filters.dateTo}|${filters.memberId}`

  async function _getCachedRemittances() {
    const cache = window.__ledgerDataCache
    const key = _ledgerCacheKey()
    if (cache && cache.key === key && cache.remittances) {
      return cache.remittances
    }
    const data = await fetchRemittances(user.cooperativeId, user)
    window.__ledgerDataCache = { remittances: data, key, cooperativeId: user.cooperativeId }
    return data
  }

  // Invalidate ledger cache on remittance sync events
  if (!window.__ledgerCacheListener) {
    window.__ledgerCacheListener = true
    import('../services/syncEventBus.js').then(({ syncBus, SyncEvents }) => {
      syncBus.on(SyncEvents.REMITTANCE_UPDATED, () => { window.__ledgerDataCache = null })
      syncBus.on(SyncEvents.REMITTANCE_ADDED, () => { window.__ledgerDataCache = null })
      syncBus.on(SyncEvents.REMITTANCE_DELETED, () => { window.__ledgerDataCache = null })
    }).catch(() => {})
  }

  async function renderActiveTab() {
    const subtitleEl = document.getElementById('ledger-subtitle')
    if (subtitleEl) {
      const viewLabel = isGlobalView() ? 'Cooperative-wide' : `Member: <strong style="color: var(--accent-primary);">${escapeHtml(filters.memberName)}</strong>`
      subtitleEl.innerHTML = `${viewLabel} | Loading...`
    }

    contentContainer.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">Loading...</div>'

    try {
      if (window._activeLedgerTab === 'tab-transactions') {
        await renderTransactionsTab()
      } else if (window._activeLedgerTab === 'tab-summary') {
        await renderSummaryTab()
      } else if (window._activeLedgerTab === 'tab-loans') {
        await renderLoansTab()
      }
    } catch (err) {
      contentContainer.innerHTML = `<div class="alert">Error: ${escapeHtml(err.message)}</div>`
    }
  }

  function updateSubtitle(networth) {
    const subtitleEl = document.getElementById('ledger-subtitle')
    if (!subtitleEl) return
    const viewLabel = isGlobalView()
      ? `Showing <strong>${isAdmin ? 'Global' : 'Accessible'}</strong> Ledger`
      : `Member: <strong style="color: var(--accent-primary);">${escapeHtml(filters.memberName)}</strong>`
    subtitleEl.innerHTML = `${viewLabel} | Total: <strong>${formatCurrency(networth)}</strong>`
  }

  async function renderTransactionsTab() {
    const allRemittances = await _getCachedRemittances()
    let filtered = allRemittances.filter(r => r.status === 'Approved')

    const fromDate = filters.dateFrom ? new Date(filters.dateFrom + 'T00:00:00') : null
    const toDate = filters.dateTo ? new Date(filters.dateTo + 'T23:59:59') : null

    if (fromDate && toDate) {
      filtered = filtered.filter(r => {
        const d = new Date(r.remittance_date)
        return d >= fromDate && d <= toDate
      })
    }

    if (!isGlobalView()) {
      filtered = filtered.filter(r => String(r.member_id) === String(filters.memberId))
    }

    filtered.sort((a, b) => (a.r_id || 0) - (b.r_id || 0))

    let openingBalance = 0
    allRemittances.filter(r => r.status === 'Approved').forEach(r => {
      const d = new Date(r.remittance_date)
      if (fromDate && d < fromDate) {
        if (isGlobalView() || String(r.member_id) === String(filters.memberId)) {
          openingBalance += (r.amount || 0)
        }
      }
    })

    let runningBalance = openingBalance
    let totalDebit = 0
    let totalCredit = 0

    let desktopRows = ''
    let mobileRows = ''

    filtered.forEach(r => {
      const amt = r.amount || 0
      if (amt < 0) totalDebit += Math.abs(amt)
      else totalCredit += amt

      runningBalance += amt

      desktopRows += `
        <tr>
          <td>${formatDate(r.remittance_date)}</td>
          <td>${String(r.r_id || '').padStart(5, '0')}</td>
          <td class="${amt < 0 ? 'text-red' : 'text-green'}">${escapeHtml(r.transaction_type || '')}</td>
          <td>${escapeHtml(r.description || '')}</td>
          <td>${escapeHtml(r.bank_name || '')}</td>
          <td class="text-right text-red">${amt < 0 ? formatCurrency(Math.abs(amt)) : ''}</td>
          <td class="text-right text-green">${amt >= 0 ? formatCurrency(amt) : ''}</td>
          <td class="text-right ${runningBalance < 0 ? 'text-red' : ''}">${formatCurrency(runningBalance)}</td>
        </tr>
      `

      mobileRows += `
        <div class="lmc"><div class="lch">${formatDate(r.remittance_date)}</div>
        <div class="lcg" style="grid-template-columns:1fr 1fr 1fr">
          <div class="ls"><span class="sl text-red">Debit</span><span class="sv text-red">${amt < 0 ? formatCurrency(Math.abs(amt)) : '-'}</span></div>
          <div class="ls"><span class="sl text-green">Credit</span><span class="sv text-green">${amt > 0 ? formatCurrency(amt) : '-'}</span></div>
          <div class="ls"><span class="sl">Balance</span><span class="sv ${runningBalance < 0 ? 'text-red' : ''}">${formatCurrency(runningBalance)}</span></div>
        </div></div>`
    })

    updateSubtitle(runningBalance)

    contentContainer.innerHTML = `
      <div class="scards">
        <div class="scard"><div class="lbl">Opening Balance</div><div class="val ${openingBalance < 0 ? 'text-red' : ''}">${formatCurrency(openingBalance)}</div></div>
        <div class="scard"><div class="lbl">Total Debit</div><div class="val text-red">${formatCurrency(totalDebit)}</div></div>
        <div class="scard"><div class="lbl">Total Credit</div><div class="val text-green">${formatCurrency(totalCredit)}</div></div>
        <div class="scard"><div class="lbl">Closing Balance</div><div class="val ${runningBalance < 0 ? 'text-red' : ''}">${formatCurrency(runningBalance)}</div></div>
      </div>
      <div class="ldv">
        <div class="tc">
          <table class="styled-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Ref ID</th>
                <th>Type</th>
                <th>Description</th>
                <th>Bank</th>
                <th class="text-right">Debit</th>
                <th class="text-right">Credit</th>
                <th class="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colspan="7" style="background: var(--bg-hover); font-weight: bold; font-size: 0.75rem;">OPENING BALANCE</td>
                <td class="text-right ${openingBalance < 0 ? 'text-red' : ''}" style="background: var(--bg-hover); font-weight: bold;">${formatCurrency(openingBalance)}</td>
              </tr>
              ${desktopRows || '<tr><td colspan="8" style="text-align: center; padding: 1rem; color: var(--text-muted); font-size: 0.85rem;">No transactions found for this period.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <div class="lmv">
        <div class="lmc" style="background: var(--bg-hover);"><div class="lch">OPENING BALANCE</div>
        <div class="lcg">
          <div class="ls"><span class="sl">Balance</span><span class="sv ${openingBalance < 0 ? 'text-red' : ''}">${formatCurrency(openingBalance)}</span></div>
        </div></div>
        ${mobileRows || '<div class="card" style="width: 100%; padding: 1rem; color: var(--text-muted); text-align: center; border: 1px solid var(--border-light); background: var(--bg-card); font-size: 0.85rem;">No transactions found for this period.</div>'}
      </div>
    `
  }

  async function renderSummaryTab() {
    const { month, year } = window.__summaryFilters
    const yearNum = parseInt(year)

    const monthStart = month === 'All'
      ? new Date(yearNum, 0, 1)
      : new Date(yearNum, parseInt(month), 1)
    const monthEnd = month === 'All'
      ? new Date(yearNum, 11, 31, 23, 59, 59)
      : new Date(yearNum, parseInt(month) + 1, 0, 23, 59, 59)

    const allRemittances = await _getCachedRemittances()
    const approved = allRemittances.filter(r => r.status === 'Approved')

    let filteredRemittances = approved
    if (!isGlobalView()) {
      filteredRemittances = filteredRemittances.filter(r => String(r.member_id) === String(filters.memberId))
    }

    let openingBalance = 0
    let totalCredit = 0
    let totalDebit = 0

    const enterpriseOpening = {}
    const enterprisePeriod = {}

    const allEnts = await fetchEnterprises(user.cooperativeId)
    const enterpriseIds = new Set()

    for (const r of filteredRemittances) {
      const d = new Date(r.remittance_date)
      const amt = r.amount || 0
      const details = r.details || []

      if (d < monthStart) {
        openingBalance += amt
        for (const detail of details) {
          const eid = detail.enterprise_id
          if (eid) {
            enterpriseIds.add(eid)
            if (!enterpriseOpening[eid]) enterpriseOpening[eid] = 0
            enterpriseOpening[eid] += parseFloat(detail.amount || 0)
          }
        }
      } else if (d >= monthStart && d <= monthEnd) {
        if (amt > 0) totalCredit += amt
        else totalDebit += Math.abs(amt)

        for (const detail of details) {
          const eid = detail.enterprise_id
          if (eid) {
            enterpriseIds.add(eid)
            if (!enterprisePeriod[eid]) enterprisePeriod[eid] = { cr: 0, dr: 0 }
            const detAmt = parseFloat(detail.amount || 0)
            if (detAmt > 0) enterprisePeriod[eid].cr += detAmt
            else enterprisePeriod[eid].dr += Math.abs(detAmt)
          }
        }
      }
    }

    const closingBalance = openingBalance + totalCredit - totalDebit

    updateSubtitle(closingBalance)

    Object.keys(allEnts).forEach(id => {
      enterpriseIds.add(id)
    })

    let entries = Array.from(enterpriseIds).map(id => {
      const opening = enterpriseOpening[id] || 0
      const cr = enterprisePeriod[id]?.cr || 0
      const dr = enterprisePeriod[id]?.dr || 0
      const closing = opening + cr - dr
      return { id, name: allEnts[id] || 'Unknown', bbf: opening, cr, dr, closing }
    })

    entries.sort((a, b) => a.name.localeCompare(b.name))

    const localShowZeroes = window.__ledgerShowZeroes || false;
    if (!localShowZeroes) {
      entries = entries.filter(e => Math.abs(e.bbf) >= 0.01 || Math.abs(e.closing) >= 0.01 || Math.abs(e.dr) >= 0.01 || Math.abs(e.cr) >= 0.01)
    }

    let allowedEntIds = []
    let allowedEntNames = []
    let hasAllAccess = false

    if (!isAdmin && !isMember) {
      const rightsString = user.enterprise_rights || user.enterprises || ''
      const rights = rightsString.split(',').map(p => p.trim()).filter(p => p.length > 0)
      if (rights.some(r => r.toLowerCase() === 'all')) {
        hasAllAccess = true
      } else {
        rights.forEach(r => {
          const matchId = Object.keys(allEnts).find(id => id.toLowerCase() === r.toLowerCase())
          if (matchId) allowedEntIds.push(matchId)
          else allowedEntNames.push(r.toLowerCase())
        })
      }
    }

    entries = entries.map(e => {
      const hasAccess = isAdmin || isMember || hasAllAccess ||
        allowedEntIds.includes(String(e.id)) ||
        allowedEntNames.includes((e.name || '').toLowerCase())
      if (!hasAccess) {
        return { ...e, bbf: 0, dr: 0, cr: 0, closing: 0, isRestricted: true }
      }
      return e
    })

    if (entries.length === 0) {
      contentContainer.innerHTML = `<div class="card" style="width: 100%; padding: 1rem; color: var(--text-muted); text-align: center; border: 1px solid var(--border-light); background: var(--bg-card); font-size: 0.85rem;">No ledger entries found.</div>`
      return
    }

    let desktopHtml = `<div class="ldv"><div class="tc"><table class="styled-table"><thead><tr><th>Enterprise</th><th class="text-right">Opening (BBF)</th><th class="text-right">Debit (DR)</th><th class="text-right">Credit (CR)</th><th class="text-right">Closing</th></tr></thead><tbody>`
    let mobileHtml = `<div class="lmv">`

    entries.forEach((entry) => {
      desktopHtml += `
        <tr>
          <td>${entry.isRestricted ? '🔒 ' : ''}${escapeHtml(entry.name)}</td>
          <td class="text-right ${entry.bbf < 0 ? 'text-red' : ''}">${entry.isRestricted ? '***' : formatCurrency(entry.bbf)}</td>
          <td class="text-red text-right">${entry.isRestricted ? '***' : formatCurrency(entry.dr)}</td>
          <td class="text-green text-right">${entry.isRestricted ? '***' : formatCurrency(entry.cr)}</td>
          <td class="text-right ${entry.closing < 0 ? 'text-red' : ''}">${entry.isRestricted ? '***' : formatCurrency(entry.closing)}</td>
        </tr>`

      mobileHtml += `
        <div class="lmc"><div class="lch">${entry.isRestricted ? '🔒 ' : ''}${escapeHtml(entry.name)}</div>
        <div class="lcg">
          <div class="ls"><span class="sl">Opening</span><span class="sv ${entry.bbf < 0 ? 'text-red' : ''}">${entry.isRestricted ? '***' : formatCurrency(entry.bbf)}</span></div>
          <div class="ls"><span class="sl">Closing</span><span class="sv ${entry.closing < 0 ? 'text-red' : ''}">${entry.isRestricted ? '***' : formatCurrency(entry.closing)}</span></div>
          <div class="ls"><span class="sl text-red">Debit</span><span class="sv text-red">${entry.isRestricted ? '***' : formatCurrency(entry.dr)}</span></div>
          <div class="ls"><span class="sl text-green">Credit</span><span class="sv text-green">${entry.isRestricted ? '***' : formatCurrency(entry.cr)}</span></div>
        </div></div>`
    })

    desktopHtml += `</tbody></table></div></div>`
    mobileHtml += `</div>`

    const monthOptions = monthsList.map((m, i) => {
      let val = m === 'All' ? 'All' : String(i - 1)
      let sel = val === month ? 'selected' : ''
      return `<option value="${val}" ${sel}>${m}</option>`
    }).join('')

    const yearOptions = [0, -1, -2].map(delta => {
      const y = Number(currentYear) + delta
      const sel = String(y) === year ? 'selected' : ''
      return `<option value="${y}" ${sel}>${y}</option>`
    }).join('')

    contentContainer.innerHTML = `
      <div class="sfils" style="justify-content: space-between; align-items: center; width: 100%;">
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <label>Month <select id="summary-month-select" style="margin-left: 0.25rem;">${monthOptions}</select></label>
          <label>Year <select id="summary-year-select" style="margin-left: 0.25rem;">${yearOptions}</select></label>
        </div>
        <button id="summary-toggle-zeroes-btn" class="ghost-button" style="font-size: 0.7rem; height: 1.7rem; padding: 0 0.5rem; border-radius: var(--radius-sm);">${localShowZeroes ? 'Hide Zeroes' : 'Unhide Zeroes'}</button>
      </div>
      ${desktopHtml}
      ${mobileHtml}
    `

    document.getElementById('summary-toggle-zeroes-btn').addEventListener('click', () => {
      window.__ledgerShowZeroes = !window.__ledgerShowZeroes
      renderActiveTab()
    })

    document.getElementById('summary-month-select').addEventListener('change', (e) => {
      window.__summaryFilters.month = e.target.value
      renderActiveTab()
    })

    document.getElementById('summary-year-select').addEventListener('change', (e) => {
      window.__summaryFilters.year = e.target.value
      renderActiveTab()
    })
  }

  async function openLoanDetailModal(loanId) {
    const overlay = document.getElementById('loan-detail-overlay')
    const body = document.getElementById('loan-detail-body')
    const title = document.getElementById('loan-detail-title')
    if (!overlay || !body) return

    body.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-muted);">Loading loan details...</div>'
    overlay.classList.add('open')

    try {
      const loans = await fetchMemberLoans(user.cooperativeId, null)
      const loan = loans.find(l => l.id === loanId)
      if (!loan) {
        body.innerHTML = '<div class="alert" style="margin: 0.5rem;">Loan record not found.</div>'
        return
      }

      title.textContent = `Loan Details - ${escapeHtml(loan.enterprise_name || 'Unknown')}`

      const allRemits = await fetchRemittances(user.cooperativeId, user)
      const loanRemits = allRemits.filter(r => r.loan_id === loanId && !r.is_deleted)

      const charges = []
      for (const rem of loanRemits) {
        for (const d of (rem.details || [])) {
          const amt = parseFloat(d.amount || 0)
          if (amt < 0) {
            charges.push({
              description: d.auto_description || d.notes || 'Charge',
              amount: Math.abs(amt)
            })
          }
        }
      }
      const totalCharges = charges.reduce((s, c) => s + c.amount, 0)

      const guarantors = loan.guarantors || []
      const principal = parseFloat(loan.principal_amount || 0)
      const duration = parseInt(loan.duration_months) || 1
      const monthlyPayback = roundUpTo100(principal / duration)

      const status = loan.status || 'Unknown'
      const isPending = status === 'Pending'
      const isActive = status === 'Active'

      let html = `
        <div class="section">
          <div class="s-title">Basic Info</div>
          <div class="s-row"><span>Status</span><span><span class="status-badge status-${status.toLowerCase()}">${escapeHtml(status.toUpperCase())}</span></span></div>
          <div class="s-row"><span>Enterprise</span><span style="font-weight:600">${escapeHtml(loan.enterprise_name || '')}</span></div>
          <div class="s-row"><span>Member</span><span>${escapeHtml(loan.member_name || 'Unknown')} (${escapeHtml(loan.member_registration_no || '')})</span></div>
          <div class="s-row"><span>Principal</span><span style="font-weight:700">${formatCurrency(principal)}</span></div>
          <div class="s-row"><span>Duration</span><span>${duration} month${duration > 1 ? 's' : ''}</span></div>
          <div class="s-row"><span>Monthly Payback</span><span style="font-weight:700">${formatCurrency(monthlyPayback)}</span></div>
          <div class="s-row"><span>Issued Date</span><span>${formatDate(loan.issued_date)}</span></div>
          <div class="s-row"><span>Due Date</span><span>${formatDate(loan.due_date)}</span></div>
          <div class="s-row"><span>Outstanding Balance</span><span class="text-red" style="font-weight:700">${formatCurrency(loan.outstanding_balance || 0)}</span></div>
        </div>
      `

      if (charges.length > 0) {
        html += `
          <div class="section">
            <div class="s-title">Charges (${charges.length})</div>
            <div class="charges-list">
              ${charges.map(c => `<div class="s-row"><span>${escapeHtml(c.description)}</span><span class="text-red">${formatCurrency(c.amount)}</span></div>`).join('')}
              <div class="s-row" style="font-weight:700;border-top:2px solid var(--border-medium);margin-top:0.25rem;padding-top:0.35rem;">
                <span>Total Charges</span><span class="text-red">${formatCurrency(totalCharges)}</span>
              </div>
            </div>
          </div>`
      } else {
        html += `<div class="section"><div class="s-title">Charges</div><div style="font-size:0.8rem;color:var(--text-muted);padding:0.25rem 0;">No charges recorded.</div></div>`
      }

      if (guarantors.length > 0) {
        html += `
          <div class="section">
            <div class="s-title">Guarantors (${guarantors.length})</div>
            ${guarantors.map(g => `
              <div class="s-row">
                <span>${escapeHtml(g.member_name || g.member_id || 'Unknown')}</span>
                <span style="font-weight:600">${formatCurrency(parseFloat(g.guarantee_amount || g.amount || 0))}</span>
              </div>
            `).join('')}
          </div>`
      } else {
        html += `<div class="section"><div class="s-title">Guarantors</div><div style="font-size:0.8rem;color:var(--text-muted);padding:0.25rem 0;">No guarantors.</div></div>`
      }

      const canAct = isAdmin && (isPending || isActive)
      html += `<div class="lmodal-actions">`

      if (isPending && isAdmin) {
        html += `
          <button class="primary-button" id="loan-act-approve" style="font-size:0.8rem;padding:0.4rem 0.8rem;">Approve Loan</button>
          <button class="secondary-button" id="loan-act-decline" style="font-size:0.8rem;padding:0.4rem 0.8rem;background:var(--danger-bg,#fee2e2);color:var(--danger,#dc2626);border:1px solid var(--danger,#dc2626);">Decline Loan</button>`
      }

      html += `
        <button class="secondary-button" id="loan-act-delete" style="font-size:0.8rem;padding:0.4rem 0.8rem;background:var(--danger-bg,#fee2e2);color:var(--danger,#dc2626);border:1px solid var(--danger,#dc2626);">Delete Loan</button>
      </div>`

      body.innerHTML = html

      const remittanceId = loan.remittance_id || loan.id

      document.getElementById('loan-act-approve')?.addEventListener('click', async () => {
        if (!confirm('Approve this loan? This will activate the loan and generate payment advice.')) return
        try {
          document.getElementById('loan-act-approve').disabled = true
          await approveLoanRequest(remittanceId, user.username)
          overlay.classList.remove('open')
          renderActiveTab()
        } catch (err) {
          alert('Approval failed: ' + err.message)
        }
      })

      document.getElementById('loan-act-decline')?.addEventListener('click', async () => {
        const reason = prompt('Enter decline reason (optional):')
        if (reason === null) return
        if (!confirm('Decline this loan? This cannot be undone.')) return
        try {
          document.getElementById('loan-act-decline').disabled = true
          await declineLoanRequest(remittanceId, user.username)
          overlay.classList.remove('open')
          renderActiveTab()
        } catch (err) {
          alert('Decline failed: ' + err.message)
        }
      })

      document.getElementById('loan-act-delete')?.addEventListener('click', async () => {
        if (!confirm('Delete this loan permanently? This action cannot be undone.')) return
        if (!confirm('Final confirmation: Are you sure you want to delete this loan and all associated records?')) return
        try {
          document.getElementById('loan-act-delete').disabled = true
          await deleteRemittance(remittanceId, user.username)
          overlay.classList.remove('open')
          renderActiveTab()
        } catch (err) {
          alert('Delete failed: ' + err.message)
        }
      })

    } catch (err) {
      body.innerHTML = `<div class="alert" style="margin:0.5rem;">Error: ${escapeHtml(err.message)}</div>`
    }
  }

  async function renderLoansTab() {
    let loans = await fetchMemberLoans(user.cooperativeId, isGlobalView() ? null : filters.memberId)

    const fromDate = filters.dateFrom ? new Date(filters.dateFrom + 'T00:00:00') : null
    const toDate = filters.dateTo ? new Date(filters.dateTo + 'T23:59:59') : null

    if (fromDate && toDate) {
      loans = loans.filter(l => {
        const d = new Date(l.issued_date)
        return d >= fromDate && d <= toDate
      })
    }

    if (!window._loanStatusFilter) window._loanStatusFilter = 'Active'

    const filterHtml = `
      <div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.5rem;background:var(--bg-card);padding:0.5rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border-light);flex-wrap:wrap;">
        <label style="font-size:0.7rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Status:</label>
        <select id="loan-status-filter" style="padding:0.25rem 0.4rem;border-radius:var(--radius-sm);border:1px solid var(--border-medium);background:var(--bg-input);color:var(--text-primary);font-size:0.75rem;">
          <option value="Active" ${window._loanStatusFilter === 'Active' ? 'selected' : ''}>Active</option>
          <option value="All" ${window._loanStatusFilter === 'All' ? 'selected' : ''}>All</option>
          <option value="Completed" ${window._loanStatusFilter === 'Completed' ? 'selected' : ''}>Completed</option>
          <option value="Overdue" ${window._loanStatusFilter === 'Overdue' ? 'selected' : ''}>Overdue</option>
          <option value="Pending" ${window._loanStatusFilter === 'Pending' ? 'selected' : ''}>Pending</option>
          <option value="Declined" ${window._loanStatusFilter === 'Declined' ? 'selected' : ''}>Declined</option>
        </select>
      </div>
    `

    if (window._loanStatusFilter !== 'All') {
      loans = loans.filter(l => (l.status || 'Active') === window._loanStatusFilter)
    }

    const totalOutstanding = loans.reduce((sum, l) => sum + (l.outstanding_balance || 0), 0)
    updateSubtitle(totalOutstanding)

    if (loans.length === 0) {
      contentContainer.innerHTML = `
        <style>.status-badge{padding:0.2rem 0.4rem;border-radius:3px;font-size:0.65rem;font-weight:700;}.status-green{background:#dcfce7;color:#166534;}.status-red{background:#fee2e2;color:#991b1b;}.status-amber{background:#fef3c7;color:#92400e;}.status-gray{background:#f3f4f6;color:#374151;}</style>
        ${filterHtml}
        <div class="card" style="width:100%;padding:1rem;color:var(--text-muted);text-align:center;border:1px solid var(--border-light);background:var(--bg-card);font-size:0.85rem;">No loan records matching the filters.</div>`
      contentContainer.querySelector('#loan-status-filter').addEventListener('change', (e) => {
        window._loanStatusFilter = e.target.value
        renderLoansTab()
      })
      return
    }

    let desktopRows = ''
    let mobileRows = ''

    loans.forEach(l => {
      const status = l.status || 'Active'
      let statusClass = 'status-badge '
      if (status === 'Active') statusClass += 'status-green'
      else if (status === 'Overdue') statusClass += 'status-red'
      else if (status === 'Pending' || status === 'Declined') statusClass += 'status-amber'
      else statusClass += 'status-gray'

      desktopRows += `
        <tr data-loan-id="${l.id}">
          <td>${formatDate(l.issued_date)}</td>
          <td>
            <div style="font-weight:700;">${escapeHtml(l.enterprise_name || '')}</div>
            <div style="font-size:0.65rem;color:var(--text-muted);font-weight:normal;">${escapeHtml(l.member_registration_no || '')} - ${escapeHtml(l.member_name || 'Unknown')}</div>
          </td>
          <td class="text-right">${formatCurrency(l.principal_amount)}</td>
          <td class="text-right" style="color:var(--text-muted);">${formatCurrency(l.admin_fees || 0)}</td>
          <td class="text-right text-red" style="font-weight:700;">${formatCurrency(l.outstanding_balance)}</td>
          <td>${formatDate(l.issued_date)}</td>
          <td style="text-align:center;">${l.duration_months || 'N/A'}</td>
          <td>${formatDate(l.due_date)}</td>
          <td style="text-align:center;"><span class="${statusClass}">${escapeHtml(status.toUpperCase())}</span></td>
        </tr>`

      mobileRows += `
        <div class="lmc" data-loan-id="${l.id}" style="cursor: pointer;"><div class="lch">${escapeHtml(l.enterprise_name || '')} — ${escapeHtml(l.member_name || 'Unknown')}</div>
        <div class="lcg" style="grid-template-columns:1fr 1fr 1fr">
          <div class="ls"><span class="sl">Date</span><span class="sv">${formatDate(l.issued_date)}</span></div>
          <div class="ls"><span class="sl">Principal</span><span class="sv">${formatCurrency(l.principal_amount)}</span></div>
          <div class="ls"><span class="sl">Status</span><span class="sv"><span class="${statusClass}">${escapeHtml(status.toUpperCase())}</span></span></div>
        </div></div>`
    })

    contentContainer.innerHTML = `
      <style>.status-badge{padding:0.2rem 0.4rem;border-radius:3px;font-size:0.65rem;font-weight:700;}.status-green{background:#dcfce7;color:#166534;}.status-red{background:#fee2e2;color:#991b1b;}.status-amber{background:#fef3c7;color:#92400e;}.status-gray{background:#f3f4f6;color:#374151;}</style>
      ${filterHtml}
      <div class="ldv">
        <div class="tc">
          <table class="styled-table">
            <thead>
              <tr>
                <th>Loan Date</th>
                <th>Type / Enterprise</th>
                <th class="text-right">Principal</th>
                <th class="text-right">Admin Fees</th>
                <th class="text-right">Outstanding</th>
                <th>Start Date</th>
                <th style="text-align:center;">Duration</th>
                <th>End Date</th>
                <th style="text-align:center;">Status</th>
              </tr>
            </thead>
            <tbody>${desktopRows}</tbody>
          </table>
        </div>
      </div>
      <div class="lmv">
        ${mobileRows}
      </div>`

    contentContainer.querySelector('#loan-status-filter').addEventListener('change', (e) => {
      window._loanStatusFilter = e.target.value
      renderLoansTab()
    })
  }

  renderActiveTab()
}
