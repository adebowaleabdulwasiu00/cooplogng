import { renderMembersPage } from './membersPage.js'
import { renderMembersForm } from './membersForm.js'
import { loadMembersData } from './membersState.js'

/**
 * Main entry point for the Members module.
 * Replaces the old renderMembers function in src/screens/Members.js
 */
export async function renderMembers(container, user) {
  // Members page is not visible to ordinary members
  const isMember = user.role === 'member'
  if (isMember) {
    container.innerHTML = `<div class="alert">You do not have permission to view this page.</div>`
    return
  }

  try {
    // 1. Initial Data Fetch (Members, Users, Enterprises)
    await loadMembersData(user)

    // 2. Routing logic based on user.routeParts
    if (user.routeParts && user.routeParts[0] === 'add') {
      await renderMembersForm(container, user, null)
    } else if (user.routeParts && user.routeParts[0] === 'edit' && user.routeParts[1]) {
      const { getAllMembers } = await import('./membersState.js')
      const m = getAllMembers().find(m => m.id === user.routeParts[1])
      if (m) {
        await renderMembersForm(container, user, m)
      } else {
        await renderMembersPage(container, user)
      }
    } else {
      await renderMembersPage(container, user)
    }
  } catch (error) {
    console.error('[Members Module] Initialization Error:', error)
    container.innerHTML = `<div class="alert" style="margin: 2rem;">Failed to load members: ${error.message}</div>`
  }
}
