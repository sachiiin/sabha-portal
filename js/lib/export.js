// CSV export. Builds the file in the browser — no server round trip.

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows, headers) {
  const keys = headers.map((h) => h.key);
  const head = headers.map((h) => csvCell(h.label)).join(',');
  const body = rows.map((r) => keys.map((k) => csvCell(r[k])).join(',')).join('\n');
  return `${head}\n${body}`;
}

export function download(filename, content, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportAttendance(rows, filename) {
  const csv = toCSV(rows, [
    { key: 'date', label: 'Date' },
    { key: 'type', label: 'Sabha' },
    { key: 'member', label: 'Member' },
    { key: 'status', label: 'Status' },
    { key: 'reason', label: 'Reason' }
  ]);
  download(filename, csv);
}

export function exportSummary(rows, filename) {
  const csv = toCSV(rows, [
    { key: 'full_name', label: 'Member' },
    { key: 'attended', label: 'Attended' },
    { key: 'total', label: 'Total sabhas' },
    { key: 'pct', label: 'Percent' },
    { key: 'missed', label: 'Missed' },
    { key: 'late_count', label: 'Late' },
    { key: 'excused_count', label: 'Excused' }
  ]);
  download(filename, csv);
}
