/**
 * backgroundAuditorService.js
 * Background Financial Auditor.
 * Runs independently of the UI to detect and correct financial discrepancies.
 * 
 * Current jobs:
 * 1. Penalty/Revenue Reversal — creates internal-transfer remittances to move
 *    penalty/revenue amounts out of member ledger balances, ensuring these
 *    income items are not reflected as member savings/liabilities.
 */

import { getAllItems, getAllByIndex } from './indexedDbService.js'
import { saveDoc, getDocById_Global, getMaxRid } from './sqliteService.js'
import { generateId } from '../utils/formatters.js'

let _auditTimer = null
let _isAuditing = false
let _session = null

export function setAuditSession(session) {
    _session = session
}

export function clearAuditSession() {
    _session = null
}

export function initializeBackgroundAuditor(session) {
    _session = session
    _startAuditLoop()
}

function _startAuditLoop() {
    if (_auditTimer) clearInterval(_auditTimer)

    const runAudit = async () => {
        if (_isAuditing || !_session) return
        _isAuditing = true
        try {
            const cooperativeId = _session.cooperative_id || _session.cooperativeId
            await _auditPenaltyRevenueReversals(cooperativeId)
        } catch (e) {
            console.error('[BgAuditor] Audit error:', e)
        } finally {
            _isAuditing = false
        }
    }

    _auditTimer = setInterval(runAudit, 30000)
    runAudit()
}

export function stopAuditor() {
    if (_auditTimer) {
        clearInterval(_auditTimer)
        _auditTimer = null
    }
    _isAuditing = false
}

// ─── Job: Penalty/Revenue Reversal ─────────────────────────────────────────

async function _auditPenaltyRevenueReversals(cooperativeId) {
    const targetEnts = await _getPenaltyRevenueEnterprises(cooperativeId)
    if (targetEnts.length === 0) return

    const targetEntIds = new Set(targetEnts.map(e => e.id))
    const entMap = {}
    for (const e of targetEnts) entMap[e.id] = e

    let allDetails
    try {
        allDetails = await getAllByIndex('remittance_detail', 'cooperative_id', String(cooperativeId))
    } catch (e) {
        const all = await getAllItems('remittance_detail')
        allDetails = all.filter(d => d.cooperative_id === String(cooperativeId))
    }
    allDetails = allDetails.filter(d => !d.is_deleted)

    let allRemittances
    try {
        allRemittances = await getAllByIndex('remittance', 'cooperative_id', String(cooperativeId))
    } catch (e) {
        const all = await getAllItems('remittance')
        allRemittances = all.filter(r => r.cooperative_id === String(cooperativeId))
    }
    const remMap = {}
    for (const r of allRemittances) {
        if (!r.is_deleted) remMap[r.id] = r
    }

    // Group positive-amount penalty/revenue detail rows by original remittance_id
    const groups = {}
    for (const detail of allDetails) {
        if (!targetEntIds.has(detail.enterprise_id)) continue
        const amt = parseFloat(detail.amount || 0)
        if (amt <= 0) continue

        const rem = remMap[detail.remittance_id]
        if (!rem) continue

        const key = detail.remittance_id
        if (!groups[key]) groups[key] = { rem, details: [] }
        groups[key].details.push(detail)
    }

    if (Object.keys(groups).length === 0) return

    const maxRid = await getMaxRid(cooperativeId)
    let nextRid = (maxRid || 0) + 1

    for (const [remittanceId, group] of Object.entries(groups)) {
        const { rem, details } = group
        const reversalId = `${remittanceId}_01`

        const existing = await getDocById_Global('remittance', reversalId)
        if (existing && !existing.is_deleted) continue

        const now = new Date().toISOString()
        let totalNegAmount = 0
        const entNames = []
        const reversalDetails = details.map(d => {
            const negAmt = -Math.abs(parseFloat(d.amount || 0))
            totalNegAmount += negAmt
            const ent = entMap[d.enterprise_id]
            const name = ent ? ent.account_name : 'Unknown'
            if (!entNames.includes(name)) entNames.push(name)
            const isPenalty = ent && (ent.is_penalty == 1 || ent.is_penalty === '1' || ent.is_penalty === 'true' || ent.is_penalty === true)
            const label = isPenalty ? 'Penalty' : 'Revenue'
            return {
                id: generateId(cooperativeId),
                remittance_id: reversalId,
                cooperative_id: String(cooperativeId),
                enterprise_id: d.enterprise_id,
                amount: negAmt,
                notes: '',
                auto_description: `Audit reversal of ${label} entry`,
                created_at: now,
                created_by: 'system',
                modified_at: now,
                modified_by: 'system',
                is_deleted: 0,
                is_synced: 0
            }
        })

        const hasPenalty = details.some(d => {
            const ent = entMap[d.enterprise_id]
            return ent && (ent.is_penalty == 1 || ent.is_penalty === '1' || ent.is_penalty === 'true' || ent.is_penalty === true)
        })
        const primaryLabel = hasPenalty ? 'Penalty/Revenue' : 'Revenue'

        const reversalRemittance = {
            id: reversalId,
            cooperative_id: String(cooperativeId),
            member_id: rem.member_id,
            amount: totalNegAmount,
            remittance_date: rem.remittance_date,
            bank_name: 'Internal Transfer',
            transaction_type: 'Internal Transfer',
            category: 'Transfer',
            description: `Audit Reversal: Internal transfer reconciling ${primaryLabel} entries (${entNames.join(', ')}) from remittance ${remittanceId}.`,
            cheque_number: '',
            recipient_id: '',
            loan_id: null,
            autogen: 1,
            r_id: nextRid++,
            status: 'Approved',
            created_at: now,
            created_by: 'system',
            modified_at: now,
            modified_by: 'system',
            is_deleted: 0,
            is_synced: 0,
            details: reversalDetails
        }

        try {
            await saveDoc('remittance', reversalRemittance)
        } catch (e) {
            console.error(`[BgAuditor] Failed to create reversal for ${remittanceId}:`, e)
        }
    }
}

async function _getPenaltyRevenueEnterprises(cooperativeId) {
    let enterprises
    try {
        enterprises = await getAllByIndex('enterprise', 'cooperative_id', String(cooperativeId))
    } catch (e) {
        const all = await getAllItems('enterprise')
        enterprises = all.filter(e => e.cooperative_id === String(cooperativeId))
    }
    enterprises = enterprises.filter(e => !e.is_deleted)

    return enterprises.filter(e =>
        (e.is_penalty == 1 || e.is_penalty === '1' || e.is_penalty === 'true' || e.is_penalty === true) ||
        (e.revenue == 1 || e.revenue === '1' || e.revenue === 'true' || e.revenue === true || (e.account_type || '').toLowerCase() === 'revenue')
    )
}
