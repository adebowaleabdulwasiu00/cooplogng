import { hasPermission } from '../services/permissionService.js'
import { loadSavedSession, restoreSessionFromIndexedDB } from '../services/offlineAuthService.js'

function getDefaultTab(user) {
  if (!user) return 'dashboard';
  if (user.role === 'member' || hasPermission(user.permissions, 'dashboard_view')) return 'dashboard';
  if (user.role !== 'member' && hasPermission(user.permissions, 'read_member')) return 'members';
  if (user.role === 'member' || hasPermission(user.permissions, 'read_remittance')) return 'payments';
  if (user.role === 'member' || hasPermission(user.permissions, 'read_ledger') || hasPermission(user.permissions, 'read_coop_ledger')) return 'ledger';
  if (hasPermission(user.permissions, 'read_reconcile')) return 'reconciliation';
  if (user.role === 'member' || hasPermission(user.permissions, 'settings_manage')) return 'settings';
  return 'dashboard';
}

const savedSession = loadSavedSession();

// If sessionStorage was cleared (e.g. after Chrome crash), try IndexedDB async
if (!savedSession) {
  restoreSessionFromIndexedDB().then(session => {
    if (session) {
      // Session restored from IndexedDB into sessionStorage; reload to pick it up
      window.location.reload()
    }
  }).catch(() => {})
}

const state = {
  isOnline: navigator.onLine,
  stage: 1,
  username: '',
  password: '',
  selectedCooperativeId: '',
  cooperatives: [],
  isSubmitting: false,
  isSyncing: false,
  showPassword: false,
  errorMessage: '',
  welcomeUser: savedSession,
  activeTab: savedSession?.activeTab || getDefaultTab(savedSession),
  selectedMemberId: null,
  editingRemittance: null,
  editingRemittanceId: null,
  members: [],
  isRegistering: false,
  coopSearchQuery: '',
  showActivationKeyPrompt: false,
  activationKeyInput: '',
  activationKeyError: '',
  modal: {
    isOpen: false,
    title: '',
    content: '',
    type: null,
    data: null
  },
  loanRequest: {
    step: 1,
    enterpriseId: '',
    amount: 0,
    duration: 1,
    guarantors: [],
    bankDetails: {
      bankName: '',
      accountName: '',
      accountNumber: ''
    }
  },
  reports: {
    type: '',
    filters: {},
    selectedFields: ['full_name', 'registration_no', 'mobile', 'sex', 'status'],
    currentReportData: null
  },
}

export { state, savedSession, getDefaultTab }
