import { hasPermission } from '../services/permissionService.js'
import { loadSavedSession, restoreSessionFromIndexedDB } from '../services/offlineAuthService.js'
import { loadRememberedIdentity } from '../services/rememberMeService.js'

function getDefaultTab(user) {
  if (!user) return 'dashboard';
  const order = ['dashboard', 'ledger', 'payments', 'members', 'reports', 'reconciliation', 'settings'];
  const isMember = user.role === 'member';
  const can = (tab) => {
    switch (tab) {
      case 'dashboard': return isMember || hasPermission(user.permissions, 'dashboard_view');
      case 'ledger': return isMember || hasPermission(user.permissions, 'read_ledger') || hasPermission(user.permissions, 'read_coop_ledger');
      case 'payments': return hasPermission(user.permissions, 'read_remittance');
      case 'members': return !isMember && hasPermission(user.permissions, 'read_member');
      case 'reports': return !isMember && hasPermission(user.permissions, 'read_member');
      case 'reconciliation': return hasPermission(user.permissions, 'read_reconcile');
      case 'settings': return isMember || hasPermission(user.permissions, 'settings_manage');
      default: return false;
    }
  };
  for (const tab of order) {
    if (can(tab)) return tab;
  }
  return 'dashboard';
}

const savedSession = loadSavedSession();

// Global "Remember me": pre-fill the last remembered username on cold start.
const rememberedIdentity = loadRememberedIdentity();

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
  username: rememberedIdentity?.username || '',
  rememberMe: !!rememberedIdentity,
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
