import { TABLE_COLUMNS } from './constants.js'
import { ensureDateWithTime } from '../indexedDbService.js'

export function filterColumns(tableName, data) {
    const cols = TABLE_COLUMNS[tableName]
    if (!cols) return { ...data }
    const filtered = {}
    for (const col of cols) {
        if (data[col] !== undefined) {
            filtered[col] = data[col]
        }
    }
    return filtered
}

export function getLocalDateString(val) {
    if (!val) return ''
    const str = String(val).trim()
    if (!str) return ''
    const d = new Date(str)
    if (isNaN(d.getTime())) return str
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

export function serializeValue(val, key = null) {
    if (val === null || val === undefined) return null
    
    const DATE_FIELDS = [
        'created_at', 'modified_at', 'deleted_at', 'sync_at', 'expiry_date',
        'issued_date', 'due_date', 'date_joined', 'remittance_date',
        'last_attempt_at', 'coop_first_month', 'dob'
    ];
    if (key && DATE_FIELDS.includes(key)) {
        return ensureDateWithTime(val);
    }
    
    if (val instanceof Date) return val.toISOString()
    if (typeof val === 'object') {
        if (typeof val.toDate === 'function') {
            return val.toDate().toISOString()
        } else if (val.seconds !== undefined) {
            return new Date(val.seconds * 1000).toISOString()
        } else if (val.type === 'firestore/timestamp/1.0') {
            return new Date(val.seconds * 1000).toISOString()
        }
        if (Array.isArray(val) && (key === 'account_manager' || key === 'recipient_id' || key === 'viewed')) {
            return val.map(s => String(s || '').trim()).filter(Boolean).join(',')
        }
        return JSON.stringify(val)
    }
    return val
}

export function deserializeValue(val) {
    if (typeof val === 'string') {
        try { return JSON.parse(val) } catch (e) { return val }
    }
    return val
}

export function likeToRegex(pattern) {
    let regexStr = ''
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i]
        if (ch === '%') regexStr += '.*'
        else if (ch === '_') regexStr += '.'
        else regexStr += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    return new RegExp('^' + regexStr + '$', 'i')
}

export function evalCondition(item, col, op, val) {
    const itemVal = item[col]
    if (val === null || val === undefined) {
        if (op === 'IS NULL' || op === 'IS') return itemVal === null || itemVal === undefined
        if (op === 'IS NOT NULL' || op === 'IS NOT') return itemVal !== null && itemVal !== undefined
    }
    switch (op) {
        case '=': return String(itemVal) == String(val)
        case '!=': case '<>': return String(itemVal) != String(val)
        case '>': {
            const n1 = Number(itemVal), n2 = Number(val);
            return isNaN(n1) || isNaN(n2) ? String(itemVal) > String(val) : n1 > n2;
        }
        case '>=': {
            const n1 = Number(itemVal), n2 = Number(val);
            return isNaN(n1) || isNaN(n2) ? String(itemVal) >= String(val) : n1 >= n2;
        }
        case '<': {
            const n1 = Number(itemVal), n2 = Number(val);
            return isNaN(n1) || isNaN(n2) ? String(itemVal) < String(val) : n1 < n2;
        }
        case '<=': {
            const n1 = Number(itemVal), n2 = Number(val);
            return isNaN(n1) || isNaN(n2) ? String(itemVal) <= String(val) : n1 <= n2;
        }
        case 'LIKE': return itemVal != null && likeToRegex(String(val)).test(String(itemVal))
        case 'NOT LIKE': return itemVal == null || !likeToRegex(String(val)).test(String(itemVal))
        case 'IN': return Array.isArray(val) && val.some(v => String(itemVal) == String(v))
        default: return true
    }
}

export function parseLiteral(str) {
    str = str.trim()
    if (str === 'NULL' || str === 'null') return null
    if (str === 'TRUE' || str === 'true') return 1
    if (str === 'FALSE' || str === 'false') return 0
    if (/^'.*'$/.test(str)) return str.slice(1, -1)
    const num = Number(str)
    if (!isNaN(num) && str !== '') return num
    return str
}

export function parseOrderBy(orderByClause) {
    if (!orderByClause) return []
    return orderByClause.split(',').map(s => {
        const trimmed = s.trim()
        const parts = trimmed.split(/\s+/)
        const col = parts[0].replace(/^[ra]\./, '')
        const dir = parts.slice(1).join(' ').toUpperCase()
        return { column: col, direction: dir === 'DESC' ? 'desc' : 'asc' }
    })
}

export function applySort(items, orderBy) {
    if (!orderBy || orderBy.length === 0) return items
    return [...items].sort((a, b) => {
        for (const ob of orderBy) {
            const col = ob.column.replace(/^IFNULL\s*\(([^,]+).*\)$/i, '$1').trim()
            let aVal = a[col], bVal = b[col]
            if (ob.column.toUpperCase().includes('IFNULL(')) {
                aVal = a[col] !== null && a[col] !== undefined ? a[col] : 0
                bVal = b[col] !== null && b[col] !== undefined ? b[col] : 0
            }
            if (aVal == null && bVal == null) continue
            if (aVal == null) return ob.direction === 'asc' ? -1 : 1
            if (bVal == null) return ob.direction === 'asc' ? 1 : -1
            let cmp = 0
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                cmp = aVal - bVal
            } else {
                cmp = String(aVal).localeCompare(String(bVal))
            }
            if (cmp !== 0) return ob.direction === 'desc' ? -cmp : cmp
        }
        return 0
    })
}

export function colType(val) {
    if (val === null || val === undefined) return 'TEXT';
    if (typeof val === 'number') return Number.isInteger(val) ? 'INTEGER' : 'REAL';
    return 'TEXT';
}

export function safeVal(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'object') return JSON.stringify(val);
    return val;
}
