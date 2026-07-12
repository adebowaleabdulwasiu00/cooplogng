import {
    getAllItems, getAllByIndex, getItem, deleteItem, putItem, clearStore
} from '../indexedDbService.js'
import { evalCondition, applySort, serializeValue, getLocalDateString } from './helpers.js'
import { parseSql } from './sqlParser.js'
import { TABLE_COLUMNS } from './constants.js'

export async function executeSimpleSelect(parsed) {
    const { table, conditions, orderBy, limit, offset, isDistinct, aggregate, whereClause, bind } = parsed
    let items

    const coopCondition = conditions.find(c => c.column === 'cooperative_id' && c.operator === '=')
    if (coopCondition) {
        try {
            items = await getAllByIndex(table, 'cooperative_id', coopCondition.value)
            if (!items || items.length === 0) {
                const all = await getAllItems(table)
                if (all.length > 0) {
                    items = all
                }
            }
        } catch (e) {
            items = await getAllItems(table)
        }
    } else {
        items = await getAllItems(table)
    }

    if (whereClause) {
        items = items.filter(item => evaluateWhere(item, whereClause, bind))
    }

    if (isDistinct) {
        const seen = new Set()
        items = items.filter(item => {
            const key = JSON.stringify(item)
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
    }

    items = applySort(items, orderBy)

    if (offset > 0) {
        items = items.slice(offset)
    }

    if (limit > 0) {
        items = items.slice(0, limit)
    }

    if (aggregate) {
        if (aggregate.func === 'COUNT') {
            return [{ [aggregate.alias]: items.length }]
        }
        if (aggregate.func === 'SUM') {
            const total = items.reduce((sum, item) => sum + (Number(item[aggregate.column]) || 0), 0)
            return [{ [aggregate.alias]: total }]
        }
        if (aggregate.func === 'MAX') {
            let maxVal = null
            for (const item of items) {
                if (item[aggregate.column] != null && (maxVal === null || item[aggregate.column] > maxVal)) {
                    maxVal = item[aggregate.column]
                }
            }
            return [{ [aggregate.alias]: maxVal }]
        }
        if (aggregate.func === 'MIN') {
            let minVal = null
            for (const item of items) {
                if (item[aggregate.column] != null && (minVal === null || item[aggregate.column] < minVal)) {
                    minVal = item[aggregate.column]
                }
            }
            return [{ [aggregate.alias]: minVal }]
        }
        if (aggregate.func === 'AVG') {
            const total = items.reduce((sum, item) => sum + (Number(item[aggregate.column]) || 0), 0)
            return [{ [aggregate.alias]: items.length > 0 ? total / items.length : 0 }]
        }
    }

    return items
}

export async function executeComplexSelect(parsed) {
    const { table, joins, orderBy, limit, offset, isDistinct, aggregate, columns, bind, whereClause } = parsed

    let primaryItems = await getAllItems(table)

    let joinedItems = primaryItems
    for (const join of joins) {
        if (join.table === 'members') {
            const members = await getAllItems('members')
            const memberMap = {}
            for (const m of members) {
                memberMap[m.id] = m
            }
            const remittanceCols = new Set(TABLE_COLUMNS.remittance)
            joinedItems = joinedItems.map(item => {
                const m = memberMap[item.member_id]
                if (m) {
                    const memberFields = {}
                    for (const key of Object.keys(m)) {
                        if (!remittanceCols.has(key)) {
                            memberFields[key] = m[key]
                        }
                    }
                    return { ...item, ...memberFields }
                }
                if (join.type === 'LEFT') {
                    return { ...item }
                }
                return item
            })
        } else if (join.table === 'enterprise') {
            const enterprises = await getAllItems('enterprise')
            const entMap = {}
            for (const e of enterprises) {
                entMap[e.id] = e
            }
            joinedItems = joinedItems.map(item => {
                const ent = entMap[item.enterprise_id]
                if (ent) {
                    return { ...item, ...ent }
                }
                if (join.type === 'LEFT') {
                    return { ...item }
                }
                return item
            })
        } else if (join.table === 'remittance_detail') {
            const details = await getAllItems('remittance_detail')
            // Parse ON clause to determine the correct key column
            const detKey = parseJoinKey(join.on, join.alias, 'remittance_id')
            const detLookup = parseJoinLookupKey(join.on, join.table, 'id')
            const detMap = {}
            for (const d of details) {
                const key = d[detKey] != null ? String(d[detKey]) : '__none__'
                if (!detMap[key]) detMap[key] = []
                detMap[key].push(d)
            }
            joinedItems = joinedItems.flatMap(item => {
                const lookupVal = item[detLookup] != null ? String(item[detLookup]) : '__none__'
                const itemDetails = detMap[lookupVal] || []
                if (itemDetails.length === 0 && join.type === 'LEFT') {
                    return [{ ...item }]
                }
                return itemDetails.map(d => ({ ...item, ...d }))
            })
        } else if (join.table === 'loan_guarantors') {
            const guarantors = await getAllItems('loan_guarantors')
            const gMap = {}
            for (const g of guarantors) {
                if (!gMap[g.loan_id]) gMap[g.loan_id] = []
                gMap[g.loan_id].push(g)
            }
            joinedItems = joinedItems.map(item => {
                if (join.type === 'LEFT') {
                    item.guarantors = gMap[item.id] || []
                    return item
                }
                return item
            })
        } else if (join.table === 'remittance') {
            const remittances = await getAllItems('remittance')
            const remMap = {}
            for (const r of remittances) {
                remMap[r.id] = r
            }
            const detailCols = new Set(TABLE_COLUMNS.remittance_detail)
            joinedItems = joinedItems.map(item => {
                const r = remMap[item.remittance_id]
                if (r) {
                    const remFields = {}
                    for (const key of Object.keys(r)) {
                        if (!detailCols.has(key)) {
                            remFields[key] = r[key]
                        }
                    }
                    return { ...item, ...remFields }
                }
                if (join.type === 'LEFT') {
                    return { ...item }
                }
                return item
            })
        }
    }

    let items = joinedItems

    if (whereClause) {
        items = items.filter(item => evaluateWhere(item, whereClause, bind))
    }

    // Handle GROUP BY / aggregate column computation
    const colSpecs = parsed.columns !== '*' ? parseColumnSpecList(parsed.columns) : []
    const hasAggCols = colSpecs.some(s => s.type === 'aggregate')
    if (parsed.hasGroupBy && parsed.groupByClause) {
        const groupCols = parsed.groupByClause.split(',').map(s => s.trim().replace(/^[a-z]+\./i, '')).filter(Boolean)
        const groups = {}
        for (const item of items) {
            const key = groupCols.map(c => String(item[c] ?? '')).join('|||')
            if (!groups[key]) groups[key] = []
            groups[key].push(item)
        }
        const groupedResult = []
        for (const groupItems of Object.values(groups)) {
            const row = {}
            for (const spec of colSpecs) {
                if (spec.type === 'column') {
                    row[spec.alias] = groupItems[0][spec.name] ?? null
                } else if (spec.type === 'aggregate') {
                    row[spec.alias] = computeAggregate(spec, groupItems)
                }
            }
            groupedResult.push(row)
        }
        items = groupedResult
    } else if (parsed.aggregate) {
        const val = computeSimpleAggregate(parsed.aggregate, items)
        items = [{ [parsed.aggregate.alias]: val }]
    } else if (hasAggCols) {
        const row = {}
        for (const spec of colSpecs) {
            if (spec.type === 'aggregate') {
                row[spec.alias] = computeAggregate(spec, items)
            }
        }
        if (Object.keys(row).length > 0) items = [row]
    }

    items = applySort(items, orderBy)

    if (offset > 0) {
        items = items.slice(offset)
    }

    if (limit > 0) {
        items = items.slice(0, limit)
    }

    if (columns !== '*' && !parsed.hasGroupBy && !hasAggCols && !parsed.aggregate) {
        const colList = columns.split(',').map(s => s.trim().replace(/^[a-z]+\./i, '').replace(/\s+as\s+\w+$/i, '').trim())
        items = items.map(item => {
            const filtered = {}
            for (const col of colList) {
                if (item[col] !== undefined) filtered[col] = item[col]
            }
            return filtered
        })
    }

    return items
}

/**
 * Parses a SELECT column list into structured specs.
 * Handles: column references, SUM(field) as alias, SUM(CASE WHEN ...) as alias, COALESCE(SUM(...), default) as alias
 */
function parseColumnSpecList(columnsStr) {
    const parts = splitTopLevelCommas(columnsStr)
    return parts.map(p => parseSingleColumnSpec(p.trim()))
}

function parseSingleColumnSpec(str) {
    // COALESCE(SUM(col), default) as alias
    let coalesceMatch = str.match(/^COALESCE\s*\(\s*(SUM|COUNT|AVG|MAX|MIN)\s*\(([^)]+)\)\s*,\s*(\d+(?:\.\d+)?)\s*\)\s+(?:as\s+)?(\w+)$/i)
    if (coalesceMatch) {
        return {
            type: 'aggregate',
            func: coalesceMatch[1].toUpperCase(),
            inner: coalesceMatch[2].trim(),
            alias: coalesceMatch[4],
            coalesceDefault: parseFloat(coalesceMatch[3])
        }
    }

    // With alias: expr as alias
    const asMatch = str.match(/^(.+?)\s+as\s+(\w+)$/i)
    const alias = asMatch ? asMatch[2] : null
    const expr = asMatch ? asMatch[1].trim() : str

    // Aggregate function: SUM(field) or SUM(CASE WHEN ... END)
    const aggMatch = expr.match(/^(SUM|COUNT|AVG|MAX|MIN)\s*\((.+)\)$/i)
    if (aggMatch) {
        return {
            type: 'aggregate',
            func: aggMatch[1].toUpperCase(),
            inner: aggMatch[2].trim(),
            alias: alias || aggMatch[1].toLowerCase()
        }
    }

    // Simple column reference
    const colName = expr.replace(/^[a-z]+\./i, '')
    return { type: 'column', name: colName, alias: alias || colName }
}

/**
 * Splits a comma-separated list respecting nested parentheses.
 */
function splitTopLevelCommas(str) {
    const parts = []
    let depth = 0
    let current = ''
    for (let i = 0; i < str.length; i++) {
        const ch = str[i]
        if (ch === '(') depth++
        else if (ch === ')') depth--
        if (depth === 0 && ch === ',') {
            parts.push(current.trim())
            current = ''
            continue
        }
        current += ch
    }
    if (current.trim()) parts.push(current.trim())
    return parts
}

/**
 * Computes an aggregate function (SUM, COUNT, AVG, MAX, MIN) over a group of items.
 * Supports SUM(CASE WHEN condition THEN value ELSE default END) patterns.
 */
function computeAggregate(spec, items) {
    const func = spec.func
    const isCase = spec.inner.toUpperCase().startsWith('CASE ')
    let values

    if (isCase) {
        // Parse CASE WHEN condition THEN value ELSE default END
        values = items.map(item => evaluateCaseExpression(spec.inner, item))
    } else {
        const fieldName = spec.inner.replace(/^[a-z]+\./i, '')
        values = items.map(item => {
            const v = item[fieldName]
            return (v === null || v === undefined) ? 0 : Number(v)
        })
    }

    let result
    switch (func) {
        case 'SUM':
            result = values.reduce((s, v) => s + (isNaN(v) ? 0 : v), 0)
            break
        case 'COUNT':
            result = values.length
            break
        case 'AVG':
            result = values.length > 0 ? values.reduce((s, v) => s + (isNaN(v) ? 0 : v), 0) / values.length : 0
            break
        case 'MAX':
            result = Math.max(...values.filter(v => !isNaN(v)))
            break
        case 'MIN':
            result = Math.min(...values.filter(v => !isNaN(v)))
            break
        default:
            result = 0
    }

    if (spec.coalesceDefault !== undefined && (result === null || result === undefined || isNaN(result))) {
        return spec.coalesceDefault
    }
    return result
}

/**
 * Evaluates a CASE WHEN expression for a single item.
 * Supports: CASE WHEN col > 0 THEN col ELSE 0 END (with >, <, >=, <=, =, !=)
 */
function evaluateCaseExpression(expr, item) {
    const trimmed = expr.trim()
    const whenMatch = trimmed.match(/^case\s+when\s+(.+?)\s+then\s+(.+?)\s+else\s+(.+?)\s+end$/i)
    if (!whenMatch) return 0
    const conditionStr = whenMatch[1].trim()
    const thenStr = whenMatch[2].trim()
    const elseStr = whenMatch[3].trim()

    // Parse condition: col op val
    const condMatch = conditionStr.match(/^([a-z_]\w*(?:\.[a-z_]\w*)?)\s*(>=|<=|!=|<>|>|<|=)\s*(-?\d+(?:\.\d+)?|[a-z_]\w*(?:\.[a-z_]\w*)?)$/i)
    if (!condMatch) return 0

    const colName = condMatch[1].replace(/^[a-z]+\./i, '')
    const op = condMatch[2]
    const rawVal = condMatch[3]
    const val = isNaN(rawVal) ? (item[rawVal.replace(/^[a-z]+\./i, '')] ?? 0) : parseFloat(rawVal)
    const itemVal = item[colName]

    let passed = false
    switch (op) {
        case '>': passed = Number(itemVal) > Number(val); break
        case '>=': passed = Number(itemVal) >= Number(val); break
        case '<': passed = Number(itemVal) < Number(val); break
        case '<=': passed = Number(itemVal) <= Number(val); break
        case '=': case '==': passed = String(itemVal) == String(val); break
        case '!=': case '<>': passed = String(itemVal) != String(val); break
    }

    if (passed) {
        const thenCol = thenStr.replace(/^[a-z]+\./i, '')
        const thenVal = isNaN(thenStr) ? (item[thenCol] ?? 0) : parseFloat(thenStr)
        const negate = thenStr.startsWith('-') ? -1 : 1
        return negate * (isNaN(thenStr) ? Number(item[thenCol] ?? 0) : Math.abs(parseFloat(thenStr)))
    } else {
        const elseCol = elseStr.replace(/^[a-z]+\./i, '')
        const elseVal = isNaN(elseStr) ? (item[elseCol] ?? 0) : parseFloat(elseStr)
        return Number(elseVal)
    }
}

/**
 * Parses the ON clause to find the column name of the joining table to use as map key.
 * Handles patterns like: "r.id = rd.remittance_id" or "e.id = rd.enterprise_id"
 * @param {string} onClause - The ON clause string
 * @param {string} joinAlias - The alias of the joining table
 * @param {string} defaultCol - Fallback column name
 */
function parseJoinKey(onClause, joinAlias, defaultCol) {
    const eqMatch = onClause.match(/([a-z_]\w+(?:\.[a-z_]\w+)?)\s*=\s*([a-z_]\w+(?:\.[a-z_]\w+)?)/i)
    if (!eqMatch) return defaultCol
    const left = eqMatch[1], right = eqMatch[2]
    if (left.toLowerCase().startsWith(joinAlias.toLowerCase() + '.')) {
        return left.split('.')[1]
    }
    if (right.toLowerCase().startsWith(joinAlias.toLowerCase() + '.')) {
        return right.split('.')[1]
    }
    // Fallback: if no dot, assume the bare column name is the key
    if (!left.includes('.') && !right.includes('.')) {
        return right // assume right side is the join table's column
    }
    return defaultCol
}

/**
 * Parses the ON clause to find the column name from the primary side (the other table)
 * to use for looking up in the join map.
 */
function parseJoinLookupKey(onClause, joinTableName, defaultCol) {
    const eqMatch = onClause.match(/([a-z_]\w+(?:\.[a-z_]\w+)?)\s*=\s*([a-z_]\w+(?:\.[a-z_]\w+)?)/i)
    if (!eqMatch) return defaultCol
    const left = eqMatch[1], right = eqMatch[2]
    // If the left side contains the join table reference, the right side is the lookup
    if (left.toLowerCase().startsWith(joinTableName.toLowerCase() + '.') || left.toLowerCase() === joinTableName.toLowerCase()) {
        return right.includes('.') ? right.split('.')[1] : right
    }
    // If the right side contains the join table reference, the left side is the lookup
    if (right.toLowerCase().startsWith(joinTableName.toLowerCase() + '.') || right.toLowerCase() === joinTableName.toLowerCase()) {
        return left.includes('.') ? left.split('.')[1] : left
    }
    // Cannot determine, the reference is ambiguous (e.g., just "id = remittance_id" without aliases)
    // Try to guess: if left has no dot and right has no dot, assume left is primary, right is join table
    if (!left.includes('.') && !right.includes('.')) {
        return left // assume left is primary table's column, right is join table's column
    }
    return defaultCol
}

/**
 * Computes a simple aggregate (single-row, no GROUP BY) like SUM(amount) as total
 */
function computeSimpleAggregate(agg, items) {
    if (agg.func === 'COUNT') return items.length
    if (agg.func === 'SUM') {
        return items.reduce((sum, item) => sum + (Number(item[agg.column]) || 0), 0)
    }
    if (agg.func === 'AVG') {
        const total = items.reduce((sum, item) => sum + (Number(item[agg.column]) || 0), 0)
        return items.length > 0 ? total / items.length : 0
    }
    if (agg.func === 'MAX') {
        let max = null
        for (const item of items) {
            const v = Number(item[agg.column])
            if (!isNaN(v) && (max === null || v > max)) max = v
        }
        return max
    }
    if (agg.func === 'MIN') {
        let min = null
        for (const item of items) {
            const v = Number(item[agg.column])
            if (!isNaN(v) && (min === null || v < min)) min = v
        }
        return min
    }
    return 0
}

export async function executeDelete(parsed) {
    const { table, conditions, isComplex, whereClause, bindIdx, bind } = parsed
    if (!whereClause) {
        await clearStore(table)
        return
    }
    const items = await getAllItems(table)
    const toDelete = items.filter(item => evaluateWhere(item, whereClause, bind.slice(bindIdx || 0)))
    for (const item of toDelete) {
        await deleteItem(table, item.id !== undefined ? item.id : item.key)
    }
}

export async function executeUpdate(parsed) {
    const { table, setVals, conditions, isComplex, whereClause, bindIdx, bind } = parsed
    const items = await getAllItems(table)
    const toUpdate = !whereClause ? items : items.filter(item => evaluateWhere(item, whereClause, bind.slice(bindIdx || 0)))
    
    let isMemberSession = false
    try {
        const raw = window.sessionStorage.getItem('cooplog-web-session')
        if (raw) {
            const session = JSON.parse(raw)
            if (session && session.role === 'member') {
                isMemberSession = true
            }
        }
    } catch (e) {}

    for (const item of toUpdate) {
        const updated = { ...item }
        for (const [col, val] of Object.entries(setVals)) {
            if (val === '__increment__') {
                updated[col] = (Number(updated[col]) || 0) + 1
            } else {
                updated[col] = serializeValue(val, col)
            }
        }
        if (isMemberSession) {
            if (updated.created_by) updated.created_by = 'Self';
            if (updated.modified_by) updated.modified_by = 'Self';
        }
        await putItem(table, updated)
    }
}

export async function executeInsert(parsed) {
    const { table, data } = parsed
    let docToSave = { ...data }
    try {
        const raw = window.sessionStorage.getItem('cooplog-web-session')
        if (raw) {
            const session = JSON.parse(raw)
            if (session && session.role === 'member') {
                if (docToSave.created_by) docToSave.created_by = 'Self';
                if (docToSave.modified_by) docToSave.modified_by = 'Self';
            }
        }
    } catch (e) {}
    await putItem(table, docToSave)
}

export async function queryRows(sql, bind = []) {
    const parsed = parseSql(sql, bind)
    switch (parsed.type) {
        case 'simple_select':
            return executeSimpleSelect(parsed)
        case 'complex_select':
            return executeComplexSelect(parsed)
        case 'delete':
            await executeDelete(parsed)
            return []
        case 'update':
            await executeUpdate(parsed)
            return []
        case 'insert':
            await executeInsert(parsed)
            return []
        default:
            console.warn('[IDB] Unsupported SQL pattern, falling back to table scan:', sql.slice(0, 80))
            const tableMatch = sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i)
            if (tableMatch) {
                return getAllItems(tableMatch[1])
            }
            return []
    }
}

export async function queryOne(sql, bind = []) {
    const rows = await queryRows(sql, bind)
    return rows.length > 0 ? rows[0] : null
}

export async function runSql(sql, bind = []) {
    const parsed = parseSql(sql, bind)
    switch (parsed.type) {
        case 'delete':
            await executeDelete(parsed)
            break
        case 'update':
            await executeUpdate(parsed)
            break
        case 'insert':
            await executeInsert(parsed)
            break
        default:
            await queryRows(sql, bind)
    }
}

export function evaluateWhere(item, whereStr, bind) {
    if (!whereStr || whereStr.trim() === '') return true;

    let bindIdx = 0;
    let sql = whereStr.replace(/\?/g, () => {
        const placeholder = `__BIND_${bindIdx}__`;
        bindIdx++;
        return placeholder;
    });
    // Strip date() function wrappers — dates are already YYYY-MM-DD strings, so date() is redundant
    sql = sql.replace(/date\s*\(([^)]+)\)/gi, '$1');

    const tokenRegex = /\s*(\(|\)|AND|OR|[<>]=?|!=|<>|=|LIKE|NOT\s+LIKE|IS\s+NULL|IS\s+NOT\s+NULL|IN|NOT\s+IN|'[^']*'|"[^"]*"|__BIND_\d+__|[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*|\d+(?:\.\d+)?)\s*/gi;
    
    let tokens = [];
    let match;
    tokenRegex.lastIndex = 0;
    while ((match = tokenRegex.exec(sql)) !== null) {
        tokens.push(match[1]);
    }
    
    if (tokens.length === 0) return true;
    
    let pos = 0;
    
    function peek() {
        return tokens[pos];
    }
    
    function consume(expected) {
        const token = tokens[pos];
        if (!token) {
            throw new Error(`Unexpected end of tokens, expected ${expected || 'any'}`);
        }
        if (expected && token.toUpperCase() !== expected.toUpperCase()) {
            throw new Error(`Expected ${expected} but got ${token}`);
        }
        pos++;
        return token;
    }
    
    function parseExpression() {
        let node = parseAnd();
        while (peek() && peek().toUpperCase() === 'OR') {
            consume('OR');
            const right = parseAnd();
            node = { type: 'OR', left: node, right };
        }
        return node;
    }
    
    function parseAnd() {
        let node = parsePrimary();
        while (peek() && peek().toUpperCase() === 'AND') {
            consume('AND');
            const right = parsePrimary();
            node = { type: 'AND', left: node, right };
        }
        return node;
    }
    
    function parsePrimary() {
        const t = peek();
        if (t === '(') {
            consume('(');
            const node = parseExpression();
            consume(')');
            return node;
        }
        
        const col = consume();
        const opToken = consume();
        let op = opToken.toUpperCase();
        
        if (op === 'NOT') {
            const next = consume().toUpperCase();
            op = `NOT ${next}`;
        } else if (op === 'IS') {
            const next = consume().toUpperCase();
            if (next === 'NOT') {
                const next2 = consume().toUpperCase();
                op = `IS NOT ${next2}`;
            } else {
                op = `IS ${next}`;
            }
        }
        
        let val = null;
        if (op !== 'IS NULL' && op !== 'IS NOT NULL') {
            const valToken = consume();
            if (valToken.startsWith("'") && valToken.endsWith("'")) {
                val = valToken.slice(1, -1);
            } else if (valToken.startsWith('"') && valToken.endsWith('"')) {
                val = valToken.slice(1, -1);
            } else if (valToken.startsWith('__BIND_')) {
                const idx = parseInt(valToken.match(/\d+/)[0]);
                val = bind[idx];
            } else if (!isNaN(valToken)) {
                val = parseFloat(valToken);
            } else {
                val = valToken;
            }
        }
        
        return { type: 'COMPARE', col, op, val };
    }
    
    function evaluateNode(node) {
        if (node.type === 'OR') {
            return evaluateNode(node.left) || evaluateNode(node.right);
        }
        if (node.type === 'AND') {
            return evaluateNode(node.left) && evaluateNode(node.right);
        }
        if (node.type === 'COMPARE') {
            let colName = node.col;
            const dotIdx = colName.indexOf('.');
            if (dotIdx >= 0) {
                colName = colName.slice(dotIdx + 1);
            }
            return evalCondition(item, colName, node.op, node.val);
        }
        return false;
    }
    
    try {
        const ast = parseExpression();
        return evaluateNode(ast);
    } catch (e) {
        console.error('Failed to parse WHERE clause:', whereStr, e);
        return true; 
    }
}
