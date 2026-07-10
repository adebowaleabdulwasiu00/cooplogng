import { likeToRegex, parseLiteral, parseOrderBy } from './helpers.js'

export function splitByTopLevelOr(str) {
    const parts = []
    let depth = 0
    let current = ''
    const upper = str.toUpperCase()
    for (let i = 0; i < str.length; i++) {
        if (str[i] === '(') depth++
        else if (str[i] === ')') depth--
        if (depth === 0 && str.slice(i).toUpperCase().startsWith(' OR ') && !/^\w/.test(str[i - 1]) && !/\w$/.test(str[i + 3])) {
            const isOr = /^\s+OR\s+/.test(str.slice(i)) || /^ OR /.test(str.slice(i))
            if (!isOr && str.slice(i).toUpperCase().startsWith(' OR ')) {
                parts.push(current.trim())
                current = ''
                i += 3
                continue
            }
        }
        current += str[i]
    }
    if (current.trim()) parts.push(current.trim())
    return parts
}

export function splitByTopLevelAnd(str) {
    const parts = []
    let depth = 0
    let current = ''
    const upper = str.toUpperCase()
    for (let i = 0; i < str.length; i++) {
        if (str[i] === '(') depth++
        else if (str[i] === ')') depth--
        if (depth === 0) {
            const rest = str.slice(i).toUpperCase()
            if (rest.startsWith(' AND ') && !/\w$/.test(str[i - 1] || '') && !/^\w/.test(str[i + 5] || '')) {
                parts.push(current.trim())
                current = ''
                i += 4
                continue
            }
        }
        current += str[i]
    }
    if (current.trim()) parts.push(current.trim())
    return parts
}

export function parseSingleCondition(condStr, bind, bindIdx) {
    condStr = condStr.trim()
    const operators = ['NOT LIKE', 'IS NOT NULL', 'IS NOT', 'IS NULL', 'IS', 'NOT IN', 'IN', 'LIKE', '!=', '>=', '<=', '=', '>', '<']
    for (const op of operators) {
        const idx = condStr.toUpperCase().indexOf(op)
        if (idx < 0) continue
        const col = condStr.slice(0, idx).trim()
        const valStr = condStr.slice(idx + op.length).trim()
        if (!col) continue
        if (/[()]/.test(col) || col.toUpperCase().startsWith('LOWER') || col.toUpperCase().startsWith('DATE') || col.toUpperCase().startsWith('IFNULL') || col.toUpperCase().startsWith('COALESCE') || col.toUpperCase().startsWith('REPLACE') || col.toUpperCase().startsWith('TRIM')) return null

        if (op === 'IS NULL' || op === 'IS NOT NULL') {
            return { condition: { column: col, operator: op, value: null }, bindIdx }
        }
        if (op === 'IS' || op === 'IS NOT') {
            const literal = valStr.toUpperCase()
            if (literal === 'NULL') return { condition: { column: col, operator: op === 'IS' ? 'IS NULL' : 'IS NOT NULL', value: null }, bindIdx }
            return null
        }

        if (valStr === '?') {
            const val = bind[bindIdx]
            bindIdx++
            return { condition: { column: col, operator: op, value: val }, bindIdx }
        }

        if (op === 'IN' || op === 'NOT IN') {
            const inner = valStr.match(/\(([^)]*)\)/)
            if (!inner) return null
            const items = inner[1].split(',').map(s => s.trim())
            const values = []
            for (const item of items) {
                if (item === '?') {
                    values.push(bind[bindIdx])
                    bindIdx++
                } else {
                    values.push(parseLiteral(item))
                }
            }
            return { condition: { column: col, operator: op, value: values }, bindIdx }
        }

        return { condition: { column: col, operator: op, value: parseLiteral(valStr) }, bindIdx }
    }
    return null
}

export function parseWhereConditions(whereClause, bind, startBindIdx) {
    if (!whereClause) return { conditions: [], bindIdx: startBindIdx, isComplex: false }
    let conditions = []
    let bindIdx = startBindIdx
    let isComplex = false

    const orParts = splitByTopLevelOr(whereClause)
    if (orParts.length > 1) {
        return { conditions: [], bindIdx: startBindIdx, isComplex: true }
    }

    const andParts = splitByTopLevelAnd(whereClause)
    for (const part of andParts) {
        const trimmed = part.trim()
        if (!trimmed) continue

        if (/^\(.*\)$/s.test(trimmed)) {
            const inner = trimmed.slice(1, -1).trim()
            if (inner.includes(' OR ') || /^\(.*\)$/.test(inner)) {
                isComplex = true
                continue
            }
            const subAnds = splitByTopLevelAnd(inner)
            for (const sub of subAnds) {
                const subTrimmed = sub.trim()
                if (!subTrimmed) continue
                const parsed = parseSingleCondition(subTrimmed, bind, bindIdx)
                if (!parsed) { isComplex = true; continue }
                conditions.push(parsed.condition)
                bindIdx = parsed.bindIdx
            }
            continue
        }

        if (/[()]/.test(trimmed) || trimmed.toUpperCase().includes(' OR ')) {
            isComplex = true
            continue
        }

        if (/EXISTS\s*\(/i.test(trimmed)) {
            isComplex = true
            continue
        }

        if (/LOWER\s*\(/i.test(trimmed) || /REPLACE\s*\(/i.test(trimmed) || /IFNULL\s*\(/i.test(trimmed) || /COALESCE\s*\(/i.test(trimmed) || /TRIM\s*\(/i.test(trimmed) || /date\s*\(/i.test(trimmed)) {
            isComplex = true
            continue
        }

        const parsed = parseSingleCondition(trimmed, bind, bindIdx)
        if (!parsed) { isComplex = true; continue }
        conditions.push(parsed.condition)
        bindIdx = parsed.bindIdx
    }
    return { conditions, bindIdx, isComplex }
}

export function parseSql(sql, bind) {
    sql = sql.trim().replace(/\s+/g, ' ')
    const upper = sql.toUpperCase()

    // DELETE
    if (upper.startsWith('DELETE')) {
        const fromMatch = sql.match(/^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i)
        if (!fromMatch) return { type: 'unknown', sql }
        const table = fromMatch[1]
        const whereClause = fromMatch[2] || ''
        const { conditions, bindIdx, isComplex } = parseWhereConditions(whereClause, bind, 0)
        return { type: 'delete', table, conditions, isComplex, whereClause, bindIdx: 0, bind }
    }

    // UPDATE
    if (upper.startsWith('UPDATE')) {
        const updateMatch = sql.match(/^UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i)
        if (!updateMatch) return { type: 'unknown', sql }
        const table = updateMatch[1]
        const setClause = updateMatch[2]
        const whereClause = updateMatch[3] || ''
        const setExprs = setClause.split(',').map(s => s.trim()).filter(Boolean)
        let bindIdx = 0
        const setVals = {}
        for (const expr of setExprs) {
            const eqIdx = expr.indexOf('=')
            if (eqIdx < 0) continue
            const col = expr.slice(0, eqIdx).trim()
            const valStr = expr.slice(eqIdx + 1).trim()
            if (valStr === '?') {
                setVals[col] = bind[bindIdx]
                bindIdx++
            } else {
                const m = valStr.match(/^\s*(\w+\s*\+\s*1)\s*$/)
                if (m) {
                    setVals[col] = `__increment__`
                } else {
                    setVals[col] = parseLiteral(valStr)
                }
            }
        }
        const { conditions, isComplex } = parseWhereConditions(whereClause, bind, bindIdx)
        return { type: 'update', table, setVals, conditions, isComplex, whereClause, bindIdx, bind }
    }

    // INSERT
    if (upper.startsWith('INSERT')) {
        const insertMatch = sql.match(/^INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)(?:\s+ON\s+CONFLICT.*)?$/i)
        if (!insertMatch) return { type: 'unknown', sql }
        const table = insertMatch[1]
        const cols = insertMatch[2].split(',').map(s => s.trim())
        const vals = insertMatch[3].split(',').map(s => s.trim())
        let bindIdx = 0
        const data = {}
        for (let i = 0; i < cols.length; i++) {
            if (vals[i] === '?') {
                data[cols[i]] = bind[bindIdx]
                bindIdx++
            } else {
                data[cols[i]] = parseLiteral(vals[i])
            }
        }
        return { type: 'insert', table, data }
    }

    // SELECT
    if (upper.startsWith('SELECT')) {
        return parseSelect(sql, bind)
    }

    return { type: 'unknown', sql }
}

export function parseSelect(sql, bind) {
    let isDistinct = false
    let aggregate = null
    let selectCols = []
    let table = ''
    let joins = []
    let whereClause = ''
    let orderByClause = ''
    let limitVal = null
    let offsetVal = null
    let groupByClause = ''
    let havingClause = ''
    let limitOnlyMatch = null

    let remaining = sql

    // Extract LIMIT
    const limitMatch = remaining.match(/\s+LIMIT\s+(\?|\d+)(?:\s+OFFSET\s+(\?|\d+))?\s*$/i)
    if (limitMatch) {
        limitVal = limitMatch[1] === '?' ? null : parseInt(limitMatch[1])
        if (limitMatch[2]) {
            offsetVal = limitMatch[2] === '?' ? null : parseInt(limitMatch[2])
        }
        remaining = remaining.slice(0, limitMatch.index)
    } else {
        limitOnlyMatch = remaining.match(/\s+LIMIT\s+(\?|\d+)(?!\s*OFFSET)/i)
        if (limitOnlyMatch) {
            limitVal = limitOnlyMatch[1] === '?' ? null : parseInt(limitOnlyMatch[1])
            remaining = remaining.slice(0, limitOnlyMatch.index)
        }
    }

    // Extract ORDER BY
    const orderMatch = remaining.match(/\s+ORDER\s+BY\s+(.+?)$/i)
    if (orderMatch) {
        orderByClause = orderMatch[1]
        remaining = remaining.slice(0, orderMatch.index)
    }

    // Extract GROUP BY
    const groupMatch = remaining.match(/\s+GROUP\s+BY\s+(.+?)$/i)
    if (groupMatch) {
        groupByClause = groupMatch[1]
        remaining = remaining.slice(0, groupMatch.index)
    }

    // Extract HAVING
    const havingMatch = remaining.match(/\s+HAVING\s+(.+?)$/i)
    if (havingMatch) {
        havingClause = havingMatch[1]
        remaining = remaining.slice(0, havingMatch.index)
    }

    // Extract WHERE
    const whereMatch = remaining.match(/\s+WHERE\s+(.+?)$/i)
    if (whereMatch) {
        whereClause = whereMatch[1]
        remaining = remaining.slice(0, whereMatch.index)
    }

    // Extract JOINs and FROM
    const fromMatch = remaining.match(/^SELECT\s+(.+?)\s+FROM\s+(\w+)/i)
    if (!fromMatch) return { type: 'unknown', sql }

    selectCols = fromMatch[1]
    table = fromMatch[2]
    remaining = remaining.slice(fromMatch[0].length)

    // Extract JOINs
    const joinRegex = /\s+(LEFT\s+)?JOIN\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?\s+ON\s+(.+?)(?=\s+(?:LEFT\s+)?JOIN\s+|$)/gi
    let joinMatch
    while ((joinMatch = joinRegex.exec(remaining)) !== null) {
        joins.push({
            type: joinMatch[1] ? 'LEFT' : 'INNER',
            table: joinMatch[2],
            alias: joinMatch[3] || joinMatch[2],
            on: joinMatch[4].trim()
        })
    }

    const hasComplex = joins.length > 0 || groupByClause || havingClause

    // Parse DISTINCT
    if (/^DISTINCT\s+/i.test(selectCols.trim())) {
        isDistinct = true
        selectCols = selectCols.trim().replace(/^DISTINCT\s+/i, '')
    }

    // Parse aggregate
    const aggMatch = selectCols.trim().match(/^(COUNT|SUM|MAX|MIN|AVG)\s*\(\s*(?:\*|(\w+))\s*\)(?:\s+as\s+(\w+))?$/i)
    if (aggMatch) {
        aggregate = {
            func: aggMatch[1].toUpperCase(),
            column: aggMatch[2] || '*',
            alias: aggMatch[3] || aggMatch[1].toLowerCase()
        }
    }

    // Parse WHERE conditions
    const bindCopy = [...bind]
    const { conditions, bindIdx, isComplex } = parseWhereConditions(whereClause, bindCopy, 0)

    // Assign limit/offset from bind params if needed
    let bindLimitOffset = 0
    if (limitVal === null) {
        limitVal = bindCopy[bindIdx + bindLimitOffset]
        bindLimitOffset++
    }
    if (offsetVal === null && limitMatch && limitMatch[2] === '?') {
        offsetVal = bindCopy[bindIdx + bindLimitOffset]
        bindLimitOffset++
    } else if (offsetVal === null && limitOnlyMatch && limitMatch && limitMatch[1] !== '?' && limitMatch[2] === '?') {
        offsetVal = bindCopy[bindIdx + bindLimitOffset]
        bindLimitOffset++
    }

    const isStar = selectCols.trim() === '*'

    if (hasComplex || isComplex) {
        return {
            type: 'complex_select',
            table,
            joins,
            whereClause,
            orderBy: parseOrderBy(orderByClause),
            limit: limitVal,
            offset: offsetVal,
            isDistinct,
            aggregate,
            columns: selectCols,
            groupByClause: groupByClause || '',
            hasGroupBy: !!groupByClause,
            bind
        }
    }

    return {
        type: 'simple_select',
        table,
        columns: isStar ? '*' : selectCols.split(',').map(s => s.trim()),
        conditions,
        whereClause,
        orderBy: parseOrderBy(orderByClause),
        limit: limitVal,
        offset: offsetVal,
        isDistinct,
        aggregate,
        bind
    }
}
