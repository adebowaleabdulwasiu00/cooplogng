import { generateId } from '../../utils/formatters.js'
import { saveDoc } from '../sqliteService.js'

export async function submitFeedback(data) {
    const now = new Date().toISOString()
    const id = generateId(String(data.cooperative_id))
    const doc = {
        id,
        cooperative_id: String(data.cooperative_id),
        member_id: data.member_id || '',
        subject: data.subject || '',
        message: data.message,
        rating: data.rating || 0,
        created_at: now,
        is_deleted: 0,
        is_synced: 0
    }
    await saveDoc('feedback', doc)
    return { id }
}
