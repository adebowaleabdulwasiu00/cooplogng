// uiStateService.js - Global loading, progress, and notification state manager

const listeners = new Set();

const uiState = {
  isLoading: false,
  loadingMessage: '',
  loadingProgress: null,
  loadingSteps: null,
  notifications: [],
  activeButtonIds: new Set()
};

function notifyListeners() {
  listeners.forEach(fn => fn(uiState));
}

function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// --- Loading Functions ---
function startLoading(message, options = {}) {
  uiState.isLoading = true;
  uiState.loadingMessage = message;
  uiState.loadingProgress = options.progress ?? null;
  uiState.loadingSteps = options.steps ?? null;
  notifyListeners();
}

function updateLoading(message, options = {}) {
  uiState.loadingMessage = message;
  if (typeof options.progress !== 'undefined') {
    uiState.loadingProgress = options.progress;
  }
  if (options.steps) {
    uiState.loadingSteps = options.steps;
  }
  notifyListeners();
}

function stopLoading() {
  uiState.isLoading = false;
  uiState.loadingMessage = '';
  uiState.loadingProgress = null;
  uiState.loadingSteps = null;
  notifyListeners();
}

// --- Notification Functions ---
let notificationId = 0;
function showNotification(message, type = 'info', duration = 5000) {
  const id = ++notificationId;
  uiState.notifications.push({
    id,
    message,
    type,
    createdAt: Date.now()
  });
  notifyListeners();
  
  if (duration > 0) {
    setTimeout(() => dismissNotification(id), duration);
  }
  return id;
}

function dismissNotification(id) {
  uiState.notifications = uiState.notifications.filter(n => n.id !== id);
  notifyListeners();
}

function clearAllNotifications() {
  uiState.notifications = [];
  notifyListeners();
}

// --- Button State Functions ---
function lockButton(id) {
  uiState.activeButtonIds.add(id);
  notifyListeners();
}

function unlockButton(id) {
  uiState.activeButtonIds.delete(id);
  notifyListeners();
}

function isButtonLocked(id) {
  return uiState.activeButtonIds.has(id);
}

// --- Wrapper for async operations (auto handles loading and notifications) ---
async function withUiState(fn, options = {}) {
  const {
    loadingMessage = 'Loading...',
    successMessage,
    errorMessage = 'An error occurred',
    buttonId
  } = options;
  
  try {
    if (buttonId) lockButton(buttonId);
    startLoading(loadingMessage, options);
    const result = await fn();
    if (successMessage) {
      showNotification(successMessage, 'success');
    }
    return result;
  } catch (error) {
    showNotification(
      error.message || errorMessage, 
      'error',
      5000
    );
    throw error;
  } finally {
    if (buttonId) unlockButton(buttonId);
    stopLoading();
  }
}

export {
  uiState,
  subscribe,
  startLoading,
  updateLoading,
  stopLoading,
  showNotification,
  dismissNotification,
  clearAllNotifications,
  lockButton,
  unlockButton,
  isButtonLocked,
  withUiState
};
