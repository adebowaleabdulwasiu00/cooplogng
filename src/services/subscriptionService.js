/**
 * subscriptionService.js
 * Service for handling subscription-related operations.
 */

import { getDb, doc, updateDoc, getDoc, Timestamp }
import { getAllForCoop, saveDoc, loadDoc, enqueueWrite }
import { hasPermission }

// Subscription status constants
export const SUBSCRIPTION_STATUS = {
    UNSUBSCRIBED: 0,
    SUBSCRIBED: 1,
    PENDING: 2
};

/**
 * Helper function to get the expiry date from a document (handles both expiry_date and subscriptionExpiry)
 */
function getExpiry(doc) {
    return doc?.expiry_date ?? doc?.subscriptionExpiry ?? null;
}

/**
 * Helper function to check if a user is an admin
 */
function isAdminUser(userDoc) {
    // Check if username is 'admin' OR has 'admin' permission
    if (userDoc?.username?.toLowerCase() ;
    }
    if (hasPermission(userDoc?.permissions, 'admin')) {
        return true;
    }
    return false;
}

/**
 * Helper function to format the expiry date for storage (ISO string)
 */
function formatExpiry(date) {
    if (!date) return null;
    if (date instanceof Date) return date.toISOString();
    if (typeof date ;
    return null;
}

/**
 * Get subscription statistics for a cooperative
 * @param {string} cooperativeId - The cooperative ID
 */
export async function getSubscriptionStatistics(cooperativeId) {
    try {
        const [members, users] ;

        const now = new Date();

        const stats = {
            members: {
                total: 0,
                active: 0,
                inactive: 0,
                expired: 0
            },
            users: {
                total: 0,
                active: 0,
                inactive: 0,
                expired: 0
            }
        };

        members.forEach(m => {
            stats.members.total++;
            const expiry = getExpiry(m);
            if (expiry) {
                const expiryDate = new Date(expiry);
                if (expiryDate > now) {
                    if (m.subscriptionStatus === SUBSCRIPTION_STATUS.SUBSCRIBED) {
                        stats.members.active++;
                    } else {
                        stats.members.inactive++;
                    }
                } else {
                    stats.members.expired++;
                }
            } else {
                if (m.subscriptionStatus === SUBSCRIPTION_STATUS.SUBSCRIBED) {
                    stats.members.active++;
                } else {
                    stats.members.inactive++;
                }
            }
        });

        users.forEach(u => {
            stats.users.total++;
            const expiry = getExpiry(u);
            if (expiry) {
                const expiryDate = new Date(expiry);
                if (expiryDate > now) {
                    if (u.subscriptionStatus === SUBSCRIPTION_STATUS.SUBSCRIBED) {
                        stats.users.active++;
                    } else {
                        stats.users.inactive++;
                    }
                } else {
                    stats.users.expired++;
                }
            } else {
                if (u.subscriptionStatus === SUBSCRIPTION_STATUS.SUBSCRIBED) {
                    stats.users.active++;
                } else {
                    stats.users.inactive++;
                }
            }
        });

        return stats;
    } catch (error) {
        throw error;
    }
}

/**
 * Get all accounts (members + users) for subscription management
 * @param {string} cooperativeId - The cooperative ID
 * @param {string} filter - Filter: 'all', 'members', 'users', 'active', 'inactive', 'expired'
 */
export async function getAllAccounts(cooperativeId, filter ;

        const now = new Date();

        let allAccounts ;

        // Apply filter
        if (filter ;
        } else if (filter ;
        } else if (filter ;
                    }
                    return true;
                }
                return false;
            });
        } else if (filter ;
        } else if (filter ;
                }
                return false;
            });
        }

        return allAccounts;
    } catch (error) {
        throw error;
    }
}

/**
 * Activate a subscription
 * @param {string} collectionName - The collection name ('members' or 'users')
 * @param {string} docId - The document ID
 * @param {string} username - The username of the person performing the action
 * @param {string} cooperativeId - The cooperative ID
 */
export async function activateSubscription(collectionName, docId, username, cooperativeId) {
    try {
        const now = Timestamp.now();
        const nowDate = new Date();
        let newExpiryDate = new Date(nowDate.setFullYear(nowDate.getFullYear() + 1));

        // Get current document first
        const localDoc = await loadDoc(collectionName, docId, cooperativeId);
        if (localDoc) {
            const currentExpiry = getExpiry(localDoc);
            if (currentExpiry) {
                const currentExpiryDate = new Date(currentExpiry);
                if (currentExpiryDate > new Date()) {
                    // If not expired yet, add 1 year to current expiry
                    newExpiryDate = new Date(currentExpiryDate);
                    newExpiryDate.setFullYear(newExpiryDate.getFullYear() + 1);
                }
            }
        }

        const formattedExpiry = formatExpiry(newExpiryDate);
        const updatePayload = {
            subscriptionStatus: SUBSCRIPTION_STATUS.SUBSCRIBED,
            expiry_date: formattedExpiry,
            subscriptionExpiry: formattedExpiry, // For backward compatibility
            sync_at: now,
            modified_at: now,
            modified_by: username
        };

        // Update locally
        try {
            if (localDoc) {
                await saveDoc(collectionName, { ...localDoc, ...updatePayload });
                await enqueueWrite(cooperativeId, collectionName, docId, 'update', updatePayload);
            }
        } catch (localErr) {
        }

        // Also update Firestore directly
        try {
            const db = getDb();
            const docRef = doc(db, collectionName, docId);
            await updateDoc(docRef, updatePayload);
        } catch (firestoreErr) {
        }
        return { success: true, expiry: newExpiryDate };
    } catch (error) {
        throw error;
    }
}

/**
 * Deactivate a subscription
 * @param {string} collectionName - The collection name ('members' or 'users')
 * @param {string} docId - The document ID
 * @param {string} username - The username of the person performing the action
 * @param {string} cooperativeId - The cooperative ID
 */
export async function deactivateSubscription(collectionName, docId, username, cooperativeId) {
    try {
        const now = Timestamp.now();

        const updatePayload = {
            subscriptionStatus: SUBSCRIPTION_STATUS.UNSUBSCRIBED,
            sync_at: now,
            modified_at: now,
            modified_by: username
        };

        // Update locally
        try {
            const localDoc = await loadDoc(collectionName, docId, cooperativeId);
            if (localDoc) {
                await saveDoc(collectionName, { ...localDoc, ...updatePayload });
                await enqueueWrite(cooperativeId, collectionName, docId, 'update', updatePayload);
            }
        } catch (localErr) {
        }

        // Also update Firestore directly
        try {
            const db = getDb();
            const docRef = doc(db, collectionName, docId);
            await updateDoc(docRef, updatePayload);
        } catch (firestoreErr) {
        }
        return { success: true };
    } catch (error) {
        throw error;
    }
}

/**
 * Get subscription status for a member or user.
 * @param {string} collectionName - The collection name ('members' or 'users')
 * @param {string} docId - The document ID of the member/user
 * @param {string} cooperativeId - The cooperative ID
 */
export async function getSubscriptionStatus(collectionName, docId, cooperativeId) {
    try {
        // Try to get from local DB first
        try {
            const localDoc = await loadDoc(collectionName, docId, cooperativeId);
            if (localDoc) {
                return {
                    status: localDoc.subscriptionStatus ?? SUBSCRIPTION_STATUS.UNSUBSCRIBED,
                    expiry: getExpiry(localDoc),
                    syncAt: localDoc.sync_at ?? null
                };
            }
        } catch (localErr) {
        }

        // Fall back to Firestore
        const db = getDb();
        const docRef = doc(db, collectionName, docId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            return {
                status: data.subscriptionStatus ?? SUBSCRIPTION_STATUS.UNSUBSCRIBED,
                expiry: getExpiry(data),
                syncAt: data.sync_at ?? null
            };
        }

        return {
            status: SUBSCRIPTION_STATUS.UNSUBSCRIBED,
            expiry: null,
            syncAt: null
        };
    } catch (error) {
        return {
            status: SUBSCRIPTION_STATUS.UNSUBSCRIBED,
            expiry: null,
            syncAt: null
        };
    }
}

/**
 * Check if a user/member has a valid active subscription
 * @param {Object} userDoc - The user/member document
 * @returns {Object} { isValid: boolean, isRestricted: boolean, reason?: string }
 */
export function validateSubscription(userDoc) {
    // Admin users are always considered subscribed with full access
    if (isAdminUser(userDoc)) {
        return { isValid: true, isRestricted: false };
    }

    const now = new Date();
    const status = userDoc?.subscriptionStatus ?? SUBSCRIPTION_STATUS.UNSUBSCRIBED;
    const expiry = getExpiry(userDoc);

    let isRestricted = true;
    let reason = null;

    if (!expiry) {
        reason ;
    } else {
        const expiryDate = new Date(expiry);
        if (expiryDate <;
        } else if (status !;
        } else {
            isRestricted = false;
        }
    }

    // Always allow login, just indicate if access is restricted
    return { isValid: true, isRestricted, reason };
}
