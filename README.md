# LMS ICM — Academic Preparation & Governance

Frontend statis (GitHub Pages) untuk LMS ICM: Analisis Chapter → Lesson Plan Builder → Approval Pimpinan → Monitoring QA.
Backend: Google Apps Script (`Kode.gs`, tidak disimpan di repo ini) + Google Sheets & Drive.

## Mulai cepat
1. Deploy `Kode.gs` sebagai Web App (Execute as: **Me**, Who has access: **Anyone**), salin URL `/exec`.
2. Isi URL itu di **`js/config.js`** → `GAS_URL`.
3. Push folder ini ke GitHub → Settings → Pages → Branch `main` / `(root)`.

Panduan lengkap langkah demi langkah: **[PANDUAN-INSTALASI-GAS-GITHUB.md](PANDUAN-INSTALASI-GAS-GITHUB.md)**

## Struktur
```
index.html        kerangka aplikasi (SPA)
css/style.css     desain (ungu muda + krem, mode gelap, responsif)
js/config.js      ← satu-satunya berkas yang perlu diubah (GAS_URL)
js/shared.js      renderer dokumen (sama dengan PDF resmi di server)
js/app.js         logika aplikasi
```

Repo ini publik dan **tidak** berisi kata sandi, token, atau data. Semua data tersimpan di Google Sheets/Drive milik sekolah.
