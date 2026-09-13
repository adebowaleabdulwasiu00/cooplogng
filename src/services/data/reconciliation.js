import { generateId } from '../../utils/formatters.js'
import { queryRows, queryOne, saveDoc, enqueueWrite, loadDoc } from '../sqliteService.js'

export async function getReconciliationTotals(bankName, periodMonth, cooperativeId) {
    const rows = await queryRows(`
        SELECT id, amount 
        FROM remittance 
        WHERE cooperative_id = ? 
          AND bank_name = ? 
          AND is_deleted = 0 
          AND status = 'Approved'
          AND (remittance_date LIKE ? OR remittance_date LIKE ?)
    `, [String(cooperativeId), bankName, `${periodMonth}%`, `${periodMonth}-%`])
    let systemCr = 0, systemDr = 0
    const relevantIds = []
    for (const row of rows) {
        const amt = parseFloat(row.amount || 0)
        if (amt > 0) systemCr += amt
        else systemDr += Math.abs(amt)
        relevantIds.push(row.id)
    }
    return { systemCr, systemDr, relevantIds }
}

export async function getReconciliationSummary(bankName, periodMonth, cooperativeId) {
    const rows = await queryRows(`
        SELECT * FROM bank_reconciliation_summary 
        WHERE cooperative_id = ? AND bank_name = ? AND period_month = ? AND is_deleted = 0
    `, [String(cooperativeId), bankName, periodMonth])
    return rows.length > 0 ? rows[0] : null
}

export async function saveReconciliationSummary(data, remittanceIds, createdBy) {
    const cooperativeId = String(data.cooperative_id)
    const now = new Date().toISOString()
    const existing = await queryOne(`
        SELECT id FROM bank_reconciliation_summary 
        WHERE cooperative_id = ? AND bank_name = ? AND period_month = ? AND is_deleted = 0
    `, [cooperativeId, data.bank_name, data.period_month])
    if (existing) throw new Error('This period and bank combination has already been reconciled.')
    const id = generateId(cooperativeId)
    const doc = {
        ...data,
        id,
        created_at: now,
        created_by: createdBy,
        modified_at: now,
        modified_by: createdBy,
        is_deleted: 0,
        is_synced: 0
    }
    await saveDoc('bank_reconciliation_summary', doc)
    await enqueueWrite(cooperativeId, 'bank_reconciliation_summary', id, 'set', doc)
    for (const remId of remittanceIds) {
        const rem = await loadDoc('remittance', remId, cooperativeId)
        if (rem) {
            await saveDoc('remittance', {
                ...rem,
                reconciliation_summary_id: id,
                modified_at: now,
                modified_by: createdBy,
                is_synced: 0
            })
            await enqueueWrite(cooperativeId, 'remittance', remId, 'update', {
                reconciliation_summary_id: id,
                modified_at: now,
                modified_by: createdBy
            })
        }
    }
    return id
}

export async function unsealReconciliation(summaryId, modifiedBy) {
    const summary = await queryOne('SELECT * FROM bank_reconciliation_summary WHERE id = ?', [summaryId])
    if (!summary) throw new Error('Reconciliation summary not found')
    const cooperativeId = summary.cooperative_id
    const now = new Date().toISOString()
    await saveDoc('bank_reconciliation_summary', {
        ...summary,
        is_deleted: 1,
        modified_at: now,
        modified_by: modifiedBy,
        is_synced: 0
    })
    await enqueueWrite(cooperativeId, 'bank_reconciliation_summary', summaryId, 'delete', { id: summaryId })
    const remittances = await queryRows(
        'SELECT id FROM remittance WHERE reconciliation_summary_id = ? AND cooperative_id = ?',
        [summaryId, cooperativeId]
    )
    for (const r of remittances) {
        const rem = await loadDoc('remittance', r.id, cooperativeId)
        if (rem) {
            await saveDoc('remittance', {
                ...rem,
                reconciliation_summary_id: null,
                modified_at: now,
                modified_by: modifiedBy,
                is_synced: 0
            })
            await enqueueWrite(cooperativeId, 'remittance', r.id, 'update', {
                reconciliation_summary_id: null,
                modified_at: now,
                modified_by: modifiedBy
            })
        }
    }
    return true
}
