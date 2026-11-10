/* LMS ICM · shared.js — renderer dokumen & sanitizer, disalin otomatis dari Kode.gs agar pratinjau = PDF resmi */
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function sanitizeRich(html) {
  html = String(html == null ? '' : html).replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|svg|math|template|textarea|select|noscript)\b[\s\S]*?<\/\1\s*>/gi, '');
  const ok = { b: 1, strong: 1, i: 1, em: 1, u: 1, ul: 1, ol: 1, li: 1, br: 1, p: 1, div: 1, a: 1, span: 1 };
  const esc = function (t) { return t.replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>/g;
  let out = '', last = 0, m;
  while ((m = re.exec(html))) {
    out += esc(html.slice(last, m.index)); last = re.lastIndex;
    const tag = m[2].toLowerCase();
    if (!ok[tag]) continue;
    if (m[1]) { if (tag !== 'br') out += '</' + tag + '>'; continue; }
    if (tag === 'br') { out += '<br>'; continue; }
    if (tag === 'a') {
      const h = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[3]);
      const href = h ? String(h[2] || h[3] || h[4] || '').trim() : '';
      out += /^(https?:|mailto:)/i.test(href) ? '<a href="' + href.replace(/["<>]/g, '') + '" target="_blank" rel="noopener noreferrer">' : '<a>';
      continue;
    }
    out += '<' + tag + '>';
  }
  return out + esc(html.slice(last));
}

function stripTags(html) {
  return String(html == null ? '' : html).replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|div|li)>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

function fmtTanggal(s, withTime) {
  if (!s) return '—';
  const str = String(s);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(str);
  if (!m) return str;
  const bln = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  let out = Number(m[3]) + ' ' + bln[Number(m[2]) - 1] + ' ' + m[1];
  if (withTime && m[4]) out += ' · ' + m[4] + ':' + m[5];
  return out;
}

function renderLpDoc(d, o) {
  o = o || {};
  const E = escHtml, nl = function (s) { return E(s).replace(/\n/g, '<br>'); };
  const ink = '#2B2A3D', mute = '#6B6A80', line = '#E4E1F2', tint = '#F6F3FF', pri = '#5245bc';
  const W = o.pdf ? '100%' : '794px';
  const sec = function (n, title) { return '<table style="width:100%;border-collapse:collapse;margin:22px 0 10px"><tr><td style="width:26px"><div style="width:22px;height:22px;line-height:22px;border-radius:6px;background:' + pri + ';color:#fff;text-align:center;font-size:12px;font-weight:bold">' + n + '</div></td><td style="font-size:15px;font-weight:bold;color:' + ink + '">' + E(title) + '</td></tr></table>'; };
  const chip = function (t, bg, fg) { return '<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 10px;border-radius:999px;background:' + bg + ';color:' + fg + ';font-size:11px;font-weight:bold">' + E(t) + '</span>'; };
  const statusLbl = { DRAFT: 'Draft Guru', PENDING: 'Salinan Tinjauan Pimpinan', RETURNED: 'Dikembalikan untuk Revisi', APPROVED: 'Dokumen Resmi · Disahkan' }[d.status] || '';
  let h = '<div class="lpdoc" style="width:' + W + ';box-sizing:border-box;background:#fff;color:' + ink + ';font-family:\'Plus Jakarta Sans\',Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.6;padding:' + (o.pdf ? '0' : '48px 56px 56px') + '">';
  if (d.mode === 'draft') h += '<div style="border:1.5px dashed #F2A93B;background:#FEF8EC;color:#8A5A08;text-align:center;font-weight:bold;letter-spacing:.2em;padding:6px;margin-bottom:16px;border-radius:8px">DRAFT — BELUM DISAHKAN</div>';
  h += '<table style="width:100%;border-collapse:collapse"><tr>' +
    '<td style="width:52px;vertical-align:top"><div style="width:44px;height:44px;line-height:44px;border-radius:12px;background:#6B5FD6;color:#fff;text-align:center;font-weight:bold;font-size:15px">ICM</div></td>' +
    '<td style="vertical-align:top;padding-left:10px"><div style="font-size:15px;font-weight:bold;color:' + pri + ';letter-spacing:.02em;text-transform:uppercase">' + E(d.school && d.school.name) + '</div><div style="font-size:11px;color:' + mute + '">' + E(d.school && d.school.sub) + '</div></td>' +
    '<td style="vertical-align:top;text-align:right;font-size:11px;color:' + mute + '">Dokumen No: <b style="color:' + ink + '">' + E(d.kode_dok) + '</b><br><span style="color:#9b6500;font-weight:bold">' + E(statusLbl) + '</span><br>Revisi ke-' + E(d.revisi_ke) + '</td></tr></table>';
  h += '<div style="height:1px;background:' + line + ';margin:16px 0 18px"></div>';
  h += '<span style="display:inline-block;padding:3px 10px;border-radius:6px;background:#EDE9FB;color:' + pri + ';font-size:11px;font-weight:bold;letter-spacing:.08em">MODUL AJAR / LESSON PLAN</span>';
  const ses = d.sessions || [], totP = ses.reduce(function (a, x) { return a + (+x.period || 0); }, 0);
  const dates = ses.map(function (x) { return x.tanggal; }).filter(Boolean).sort();
  h += '<div style="font-size:21px;font-weight:bold;line-height:1.3;margin:8px 0 4px">' + E(d.chapter_nama) + '</div>';
  h += '<div style="color:' + mute + ';font-size:12px">' + E((d.subs || []).join(' · ')) + '</div>';
  h += '<table style="width:100%;border-collapse:collapse;margin-top:14px;background:' + tint + ';border-radius:10px"><tr>' +
    [['Jenjang & Kelas', d.unit_label + ' · ' + d.kelas], ['Mata Pelajaran', d.mapel], ['Alokasi Waktu', totP + ' period · ' + (+d.durasi_total || 0) + ' menit' + (d.chapter_period && d.chapter_period !== totP ? ' (chapter ' + d.chapter_period + ' period)' : '')], ['Pertemuan', ses.length + ' pertemuan' + (dates.length ? ' · ' + fmtTanggal(dates[0]) + (dates.length > 1 ? ' – ' + fmtTanggal(dates[dates.length - 1]) : '') : '')]]
      .map(function (x) { return '<td style="padding:10px 12px;vertical-align:top;width:25%"><div style="font-size:10px;color:' + mute + ';text-transform:uppercase;letter-spacing:.06em">' + E(x[0]) + '</div><div style="font-weight:bold;font-size:12px">' + E(x[1]) + '</div></td>'; }).join('') + '</tr></table>';

  h += sec(1, 'Capaian & Tujuan Pembelajaran');
  h += (d.los || []).map(function (l) { return '<table style="width:100%;border-collapse:collapse;margin-bottom:6px"><tr><td style="width:64px;vertical-align:top"><span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#EDE9FB;color:' + pri + ';font-size:11px;font-weight:bold">' + E(l.kode) + '</span></td><td style="vertical-align:top">' + sanitizeRich(l.teks) + (l.sub ? '<div style="font-size:10.5px;color:' + mute + '">Sub-bab ' + E(l.sub) + '</div>' : '') + '</td></tr></table>'; }).join('') || '<div style="color:' + mute + '">—</div>';

  h += sec(2, 'Pertanyaan Esensial');
  h += '<div style="padding:10px 12px;border-left:3px solid #F2A93B;background:' + tint + ';border-radius:0 8px 8px 0"><div style="font-size:10px;color:' + mute + ';text-transform:uppercase;letter-spacing:.06em">Essential Question (chapter)</div>' + nl(d.eq || '—') + '</div>';

  h += sec(3, 'Rencana Pertemuan (' + ses.length + ' Pertemuan · ' + totP + ' Period)');
  const col = { A: '#5BA4E6', B: '#6B5FD6', C: '#F2A93B' };
  h += ses.map(function (x) {
    return '<table class="lp-ses" style="width:100%;border-collapse:collapse;margin-bottom:12px;border:1px solid ' + line + ';border-radius:10px"><tr><td style="padding:10px 12px;background:' + tint + ';border-radius:10px 10px 0 0">' +
      '<table style="width:100%;border-collapse:collapse"><tr><td style="font-weight:bold;font-size:13px">Pertemuan ' + E(x.no) + (x.tanggal ? ' <span style="font-weight:normal;color:' + mute + ';font-size:11px">· ' + E(fmtTanggal(x.tanggal)) + '</span>' : '') + '</td><td style="text-align:right"><span style="padding:2px 8px;border-radius:999px;background:#EDE9FB;color:' + pri + ';font-size:11px;font-weight:bold">' + E(x.alokasi || (x.menit + ' menit')) + '</span></td></tr></table>' +
      ((x.topik || []).length ? '<div style="font-size:11px;color:' + mute + ';margin-top:2px">Topik: ' + E(x.topik.join(' · ')) + '</div>' : '') +
      ((x.tps || []).length ? '<div style="font-size:11px;color:' + mute + ';margin-top:2px">TP: ' + E(x.tps.join(', ')) + '</div>' : '') +
      (x.indikator ? '<div style="margin-top:8px"><div style="font-size:10px;color:' + mute + ';text-transform:uppercase;letter-spacing:.06em">Learning Indicator (Micro TP)</div><div style="font-size:12px">' + nl(x.indikator) + '</div></div>' : '') +
      (x.terminology ? '<div style="margin-top:6px"><div style="font-size:10px;color:' + mute + ';text-transform:uppercase;letter-spacing:.06em">Terminology & Trigger Question</div><div style="font-size:12px">' + nl(x.terminology) + '</div></div>' : '') +
      ((x.icm || []).length ? '<div style="margin-top:6px"><span style="font-size:10px;color:' + mute + ';text-transform:uppercase;letter-spacing:.06em">ICM Value </span>' + x.icm.map(function (v) { return chip(v, '#EDE9FB', pri); }).join('') + '</div>' : '') +
      ((x.seq || []).length ? '<div style="margin-top:4px"><span style="font-size:10px;color:' + mute + ';text-transform:uppercase;letter-spacing:.06em">Sequence </span>' + x.seq.map(function (v, k) { return chip((k + 1) + '. ' + v, '#E3F0FC', '#00629d'); }).join('') + '</div>' : '') +
      ((x.diff || []).length ? '<div style="margin-top:4px;font-size:11.5px"><span style="font-size:10px;color:' + mute + ';text-transform:uppercase;letter-spacing:.06em">Diferensiasi </span>' + x.diff.map(function (v) { return '<b>' + E(v.a) + ' · ' + E(v.p) + '</b>' + (v.note ? ': ' + E(v.note) : ''); }).join('; ') + '</div>' : '') + '</td></tr>' +
      (x.scen || []).map(function (sc) {
        return '<tr><td style="padding:6px 12px 6px 10px;border-left:3px solid ' + col[sc.key] + '"><table style="width:100%;border-collapse:collapse"><tr><td style="font-weight:bold;font-size:12px">' + E(sc.key + '. ' + sc.label) + '</td><td style="text-align:right;font-size:11px;color:' + mute + '">' + E(sc.menit) + ' menit</td></tr></table><div>' + nl(sc.desc || '—') + '</div></td></tr>';
      }).join('') + '</table>';
  }).join('') || '<div style="color:' + mute + '">—</div>';

  h += sec(4, 'Lampiran Pendukung');
  h += (d.attachments || []).length ? '<ul style="margin:0;padding-left:18px">' + d.attachments.map(function (a) { return '<li>' + E(a) + '</li>'; }).join('') + '</ul>' : '<div style="color:' + mute + '">Tidak ada lampiran.</div>';

  h += '<table style="width:100%;border-collapse:collapse;margin-top:28px;background:' + tint + ';border-radius:12px"><tr>' +
    '<td style="width:50%;padding:14px 16px;vertical-align:top"><div style="font-size:10px;color:' + mute + ';text-transform:uppercase;letter-spacing:.06em">Guru Pengampu</div><div style="height:46px"></div><div style="font-weight:bold">' + E(d.teacher && d.teacher.nama) + '</div><div style="font-size:11px;color:' + mute + '">NIP: ' + E(d.teacher && d.teacher.nip) + '</div></td>' +
    '<td style="width:50%;padding:14px 16px;vertical-align:top">';
  if (d.approval) {
    h += '<div style="font-size:10px;color:#1E6B3A;text-transform:uppercase;letter-spacing:.06em;font-weight:bold">Approved · ' + E(d.approval.jabatan) + '</div>' +
      (d.approval.signature ? '<img src="' + d.approval.signature + '" style="height:46px;max-width:180px;margin:2px 0">' : '<div style="height:46px;font-family:\'Brush Script MT\',cursive;font-size:24px;color:' + pri + ';line-height:46px">' + E(String(d.approval.nama || '').split(',')[0]) + '</div>') +
      '<div style="font-weight:bold">' + E(d.approval.nama) + '</div><div style="font-size:11px;color:' + mute + '">' + E(fmtTanggal(d.approval.waktu, true)) + ' WIB · Kode: ' + E(d.approval.verif_code) + '</div>';
  } else {
    h += '<div style="font-size:10px;color:' + mute + ';text-transform:uppercase;letter-spacing:.06em">Pengesahan Pimpinan</div><div style="height:46px"></div><div style="color:' + mute + '">Menunggu persetujuan</div>';
  }
  h += '</td></tr></table></div>';
  return h;
}
