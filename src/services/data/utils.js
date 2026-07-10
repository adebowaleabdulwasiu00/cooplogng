let _memberCache = null

export function clearMemberCache() {
    _memberCache = null
}

export function isNotDeleted(item) {
    return !(item && (item.is_deleted === 1 || item.is_deleted === true))
}
