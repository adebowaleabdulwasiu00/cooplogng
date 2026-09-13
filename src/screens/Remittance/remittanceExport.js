import { showToast } from '../../services/toastService.js';
import { formatDateForInput, toExcelDateSerial, shortRef } from '../../utils/formatters.js';

// Day-precision as a REAL Excel date (serial integer, no time fraction) so
// formulas/sorting/filtering work. Built from the calendar day with pure
// arithmetic — no JS Date reaches ExcelJS, so no timezone layer can shift it
// by hours. Falls back to plain YYYY-MM-DD text when unparseable.
function excelDay(val) {
    return toExcelDateSerial(val) ?? formatDateForInput(val) ?? '';
}

// ExcelJS (~900KB) loads lazily on first export so dashboard startup stays light.
let _excelJS = null;
async function loadExcelJS() {
    if (!_excelJS) {
        const mod = await import('exceljs');
        _excelJS = mod.default || mod;
    }
    return _excelJS;
}

export async function exportData(data, isAdmin, getFormattedName) {
    if (data.length === 0) {
        showToast("No records to export.", "warning");
        return;
    }

    try {
        const ExcelJS = await loadExcelJS();
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Remittance History');

        if (isAdmin) {
            // Full Export for Admin
            worksheet.columns = [
                { header: 'ID', key: 'id', width: 30 },
                { header: 'Record ID', key: 'ref', width: 12 },
                { header: 'Member ID', key: 'member_id', width: 15 },
                { header: 'Member Name', key: 'member_name', width: 25 },
                { header: 'Date', key: 'remittance_date', width: 20 },
                { header: 'Amount', key: 'amount', width: 15 },
                { header: 'Bank Name', key: 'bank_name', width: 20 },
                { header: 'Type', key: 'transaction_type', width: 18 },
                { header: 'Description', key: 'description', width: 35 },
                { header: 'Status', key: 'status', width: 12 },
                { header: 'Created At', key: 'created_at', width: 20 },
                { header: 'Created By', key: 'created_by', width: 15 }
            ];

            data.forEach(r => {
                worksheet.addRow({
                    id: r.id,
                    ref: shortRef(r.id),
                    member_id: r.member_id,
                    member_name: getFormattedName(r.member_id, r.transaction_type),
                    // Real Excel date, exact DB day — see excelDay() above.
                    remittance_date: excelDay(r.remittance_date),
                    amount: Number(r.amount),
                    bank_name: r.bank_name || '',
                    transaction_type: r.transaction_type || '',
                    description: r.description || '',
                    status: r.status,
                    created_at: r.created_at?.toDate ? r.created_at.toDate() : new Date(r.created_at),
                    created_by: r.created_by || ''
                });
            });
        } else {
            // Simplified Export for Users
            worksheet.columns = [
                { header: 'Record ID', key: 'ref', width: 12 },
                { header: 'Date', key: 'remittance_date', width: 18 },
                { header: 'Bank / Description', key: 'info', width: 40 },
                { header: 'Amount', key: 'amount', width: 15 },
                { header: 'Status', key: 'status', width: 12 }
            ];

            data.forEach(r => {
                worksheet.addRow({
                    ref: shortRef(r.id),
                    remittance_date: excelDay(r.remittance_date),
                    info: `${r.bank_name || 'Direct'} - ${r.description || ''}`,
                    amount: Number(r.amount),
                    status: r.status
                });
            });
        }

        // Formatting
        worksheet.getRow(1).font = { bold: true };
        worksheet.getColumn('amount').numFmt = '#,##0.00';
        // Date-only display to match preview/PDF (no time component stored).
        worksheet.getColumn('remittance_date').numFmt = 'yyyy-mm-dd';

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `RemittanceHistory_${new Date().toISOString().split('T')[0]}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Export completed successfully!', 'success');
    } catch (err) {
        console.error("Export failed:", err);
        showToast('Failed to generate Excel file: ' + err.message, 'error');
    }
}
