import { fetchAllMembers, fetchCooperativeUsers, fetchEnterprises } from '../../services/dataService.js'

// Global state for the members module instance
let _allMembers = []
let _filteredMembers = []
export let usersList = []
export let enterpriseList = []

export const getAllMembers = () => _allMembers
export const getFilteredMembers = () => _filteredMembers

// Pagination state
export let visibleLimit = 50

// Filter state
export let searchTerm = ""
export let statusFilter = "All Status"
export let managerFilter = "All Managers"

// Selection state
export let isSelectionMode = false
export let selectedIds = new Set()

export function setSelectionMode(val) {
    isSelectionMode = val
    if (!val) selectedIds.clear()
}

export function toggleSelection(id) {
    if (selectedIds.has(id)) selectedIds.delete(id)
    else selectedIds.add(id)
}

export function selectAllFiltered() {
    _filteredMembers.forEach(m => selectedIds.add(m.id))
}

export function deselectAll() {
    selectedIds.clear()
}

/**
 * Loads all required initial data from Firebase/SQLite.
 */
export async function loadMembersData(user) {
    const isAdmin = user.isAdmin || user.role === 'admin' || user.username?.toLowerCase() === 'admin'
    
    // Run all fetches in parallel for speed
    const [members, users, enterprises] = await Promise.all([
        fetchAllMembers(user.cooperativeId, user.username, isAdmin),
        fetchCooperativeUsers(user.cooperativeId),
        fetchEnterprises(user.cooperativeId, true)
    ])

    _allMembers = members || []
    usersList = users || []
    enterpriseList = enterprises || []
    
    // Sort members safely (e.g. by name or date)
    _allMembers.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    
    applyFilters()
}

/**
 * Applies the current search, status, and quick filters to compute filteredMembers.
 */
export function applyFilters() {
    const s = searchTerm.toLowerCase()
    
    _filteredMembers = _allMembers.filter(m => {
        // 1. Status Dropdown Filter
        const matchesStatus = statusFilter === "All Status" || m.status === statusFilter
        if (!matchesStatus) return false

        // 2. Manager Dropdown Filter
        let matchesManager = managerFilter === "All Managers"
        if (!matchesManager) {
            const currentManagers = String(m.account_manager || "").split(',').map(s => s.trim().toLowerCase())
            matchesManager = currentManagers.includes(managerFilter.toLowerCase())
        }
        if (!matchesManager) return false

        // 3. Search Term — token-based LIKE search.
        // Each space-separated word must appear somewhere in the member's data (AND logic).
        // e.g. typing "John Lagos" returns members named John who live in Lagos.
        if (s) {
            const SKIP_FIELDS = new Set([
                'id', 'cooperative_id', 'image_path', 'signature_path',
                'password_hash', 'is_synced', 'is_deleted', 'sync_at',
                'deleted_at', 'device_id', 'latitude', 'longitude',
                'account_balance', 'account_balance_total'
            ])
            const searchable = Object.entries(m)
                .filter(([k, v]) =>
                    !SKIP_FIELDS.has(k) &&
                    v !== null && v !== undefined &&
                    typeof v !== 'object'
                )
                .map(([, v]) => String(v).toLowerCase())
                .join(' ')

            // Split input into individual tokens and require ALL to match
            const tokens = s.trim().split(/\s+/).filter(Boolean)
            const allMatch = tokens.every(token => searchable.includes(token))
            if (!allMatch) return false
        }

        return true
    })
    
    // Reset pagination to first batch when filters change
    visibleLimit = 50
}

export function setSearchTerm(term) { searchTerm = term }
export function setStatusFilter(status) { statusFilter = status }
export function setManagerFilter(manager) { managerFilter = manager }
export function increaseVisibleLimit(amount = 50) { visibleLimit += amount }
