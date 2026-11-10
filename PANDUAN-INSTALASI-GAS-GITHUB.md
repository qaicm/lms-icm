# LMS ICM — Panduan Instalasi Lengkap
## Backend Google Apps Script + Frontend GitHub Pages

Panduan ini ditulis untuk pemula: tidak perlu pengalaman Git, GitHub, atau pemrograman. Ikuti urutannya dari atas ke bawah. Perkiraan waktu: **45–60 menit** untuk pertama kali.

---

## Daftar isi

1. [Gambaran: bagaimana aplikasi ini bekerja](#1-gambaran-bagaimana-aplikasi-ini-bekerja)
2. [Yang perlu disiapkan](#2-yang-perlu-disiapkan)
3. [BAGIAN A — Memasang backend di Google Apps Script](#bagian-a--memasang-backend-di-google-apps-script)
4. [BAGIAN B — Menyiapkan frontend di komputer](#bagian-b--menyiapkan-frontend-di-komputer)
5. [BAGIAN C — Mengunggah frontend ke GitHub Pages](#bagian-c--mengunggah-frontend-ke-github-pages)
6. [BAGIAN D — Uji coba pertama](#bagian-d--uji-coba-pertama)
7. [BAGIAN E — Persiapan sebelum dipakai resmi](#bagian-e--persiapan-sebelum-dipakai-resmi) (termasuk menghapus contoh kerja guru)
8. [BAGIAN F — Cara memperbarui aplikasi](#bagian-f--cara-memperbarui-aplikasi)
9. [BAGIAN G — Opsional: Login Google, embed Blogger, domain sendiri](#bagian-g--opsional)
10. [Pemecahan masalah](#pemecahan-masalah)
11. [Keamanan: apa yang publik, apa yang rahasia](#keamanan-apa-yang-publik-apa-yang-rahasia)
12. [Glosarium](#glosarium)

---

## 1. Gambaran: bagaimana aplikasi ini bekerja

```
  Guru / Pimpinan / QA (browser HP atau laptop)
              │
              ▼
  ┌────────────────────────────────────────┐
  │  FRONTEND  — GitHub Pages (gratis)      │   https://USERNAME.github.io/lms-icm/
  │  index.html · css/ · js/                │   tampilan, menu, grafik, form
  └────────────────────────────────────────┘
              │  fetch() — kirim & terima data (JSON)
              ▼
  ┌────────────────────────────────────────┐
  │  BACKEND  — Google Apps Script          │   https://script.google.com/macros/s/…/exec
  │  Kode.gs                                │   login, hak akses, simpan data, PDF, email
  └────────────────────────────────────────┘
              │
              ▼
     Google Sheets (database) + Google Drive (lampiran, PDF, tanda tangan)
```

- **Frontend** = semua yang dilihat pengguna. Disimpan di GitHub dan tampil di alamat `github.io`.
- **Backend** = "otak" di Google. Frontend hanya tahu **satu alamat** backend, yang ditulis di berkas `js/config.js`.
- Data tidak pernah disimpan di GitHub. Semuanya tersimpan di Google Sheets & Drive milik akun sekolah Anda.

---

## 2. Yang perlu disiapkan

| Kebutuhan | Keterangan |
|---|---|
| Akun Google | Sebaiknya akun Google Workspace sekolah milik Tim IT (bukan akun pribadi), karena database dan folder akan dimiliki akun ini |
| Akun GitHub | Gratis, dibuat di Bagian C |
| Komputer Windows / Mac | Untuk menjalankan Git (panduan ini memakai contoh Windows + PowerShell; perintah Mac ditulis bila berbeda) |
| Berkas dari Claude | **`Kode.gs`** (backend) dan **`lms-icm-frontend.zip`** (frontend) |

Isi `lms-icm-frontend.zip` setelah diekstrak:

```
lms-icm\                         ← INI folder yang nanti di-git init (Bagian C)
├── index.html
├── README.md
├── PANDUAN-INSTALASI-GAS-GITHUB.md
├── css\
│   └── style.css
└── js\
    ├── config.js                ← SATU-SATUNYA berkas yang perlu Anda ubah
    ├── shared.js
    └── app.js
```

> `Kode.gs` sengaja **tidak** ada di dalam ZIP. Berkas itu hanya ditempel di Google Apps Script dan tidak boleh ikut ke GitHub.

---

## BAGIAN A — Memasang backend di Google Apps Script

### A1. Buat proyek Apps Script

1. Buka **https://script.google.com** (masuk dengan akun Google sekolah).
2. Klik **Proyek baru** (New project).
3. Klik judul **"Proyek tanpa judul"** di kiri atas → ganti menjadi **`LMS ICM API`** → **Ganti nama**.

### A2. Tempel kode backend

1. Di panel kiri ada berkas **`Kode.gs`** (atau `Code.gs`). Klik berkas itu.
2. Hapus seluruh isi bawaan (`function myFunction() {…}`): tekan **Ctrl+A** lalu **Delete**.
3. Buka berkas **`Kode.gs`** dari Claude dengan Notepad (klik kanan → *Open with* → *Notepad*), tekan **Ctrl+A**, **Ctrl+C**.
4. Kembali ke editor Apps Script, tekan **Ctrl+V**.
5. Tekan **Ctrl+S** (ikon disket) untuk menyimpan. Pastikan tidak muncul pesan error merah.

> Cukup satu berkas ini. Versi GitHub **tidak** memakai `Index.html`, `Stylesheet.html`, atau `JavaScript.html` — semuanya sudah dipindah ke frontend.

### A3. Atur zona waktu proyek

1. Klik ikon **⚙️ Setelan proyek** (Project Settings) di sidebar kiri.
2. **Zona waktu** → pilih **(GMT+07:00) Jakarta**.
3. Kembali ke editor dengan ikon **< >** (Editor).

### A4. Jalankan auto-setup (sekali saja)

1. Di bilah atas editor ada dropdown nama fungsi. Pilih **`setupAppEnvironment`**.
2. Klik **▶ Jalankan** (Run).
3. Muncul jendela **"Otorisasi diperlukan"** → **Tinjau izin** → pilih akun Google Anda.
4. Jika muncul **"Google belum memverifikasi aplikasi ini"**: klik **Lanjutan** (Advanced) → **Buka LMS ICM API (tidak aman)**.
   *Ini normal untuk skrip buatan sendiri — "tidak aman" artinya belum diaudit Google, bukan berbahaya. Kodenya milik Anda sendiri.*
5. Klik **Izinkan** (Allow). Izin yang diminta: Google Sheets, Drive, mengirim email, menjalankan trigger, dan menghubungi layanan eksternal (untuk verifikasi login Google).
6. Tunggu sampai **Log eksekusi** di bawah menampilkan:

```
✅ Setup selesai.
📁 Folder  : https://drive.google.com/drive/folders/…
📊 Database: https://docs.google.com/spreadsheets/d/…
👤 Akun demo (kata sandi sama untuk semua): ICM2026!
⏰ Trigger terpasang: processEmailQueue, warmup, dailyDigest, weeklyTeacherReminder
```

Yang dibuat otomatis:
- Folder Drive **LMS ICM** dan spreadsheet database berisi 16 sheet bertajuk.
- Kunci rahasia `SESSION_SECRET` dan `PW_PEPPER` di **Script Properties** (aman, tidak terlihat di kode/sheet).
- Master data (unit, mapel, kelas, ICM Value, sequence, diferensiasi, durasi), term, 14 akun demo, serta contoh chapter & lesson plan.
- Empat trigger otomatis (lihat [Bagian F](#f5-trigger-otomatis)).

> Fungsi ini aman dijalankan ulang — data yang sudah ada tidak digandakan.

### A5. Deploy sebagai Web App (ini yang menjadi "alamat API")

1. Klik tombol biru **Terapkan** (Deploy) di kanan atas → **Deployment baru** (New deployment).
2. Klik ikon **⚙️** di samping "Pilih jenis" → centang **Aplikasi web** (Web app).
3. Isi persis seperti ini:

| Kolom | Nilai | Kenapa |
|---|---|---|
| Deskripsi | `API v1` | Bebas, hanya catatan |
| Jalankan sebagai (Execute as) | **Saya** (email Anda) | Backend membaca Sheets/Drive memakai akun Anda; pengguna tidak perlu akses ke spreadsheet |
| Yang memiliki akses (Who has access) | **Siapa saja** (Anyone) | **WAJIB.** Kalau memilih "Siapa saja yang memiliki Akun Google", frontend di GitHub tidak bisa terhubung sama sekali |

4. Klik **Terapkan** → salin **URL aplikasi web** yang berakhiran **`/exec`**. Simpan di Notepad.

```
Contoh: https://script.google.com/macros/s/AKfycbx1a2B3c4D5…xyz/exec
```

### A6. Tes alamat API

Tempel URL `/exec` di tab browser baru dan tekan Enter. Harus muncul teks seperti:

```json
{"success":true,"data":{"app":"LMS ICM","version":"…","time":"…"},"message":"LMS ICM API aktif."}
```

✅ Kalau muncul seperti itu, backend siap. Lanjut ke Bagian B.
❌ Kalau muncul halaman login Google atau "Sorry, unable to open the file", ulangi A5 dan pastikan akses = **Siapa saja**.

---

## BAGIAN B — Menyiapkan frontend di komputer

### B1. Ekstrak ZIP ke folder yang mudah ditemukan

1. Pindahkan `lms-icm-frontend.zip` ke folder **Documents**.
2. Klik kanan → **Extract All…** (Ekstrak Semua) → **Extract**.
3. Hasilnya folder `Documents\lms-icm-frontend\lms-icm\`. Buka sampai Anda melihat **`index.html`, `css`, `js`** dalam satu folder.
4. **Pindahkan folder `lms-icm` itu** langsung ke `Documents` supaya jalurnya pendek: `C:\Users\NAMA-ANDA\Documents\lms-icm`.

> Jalur akhir yang dipakai di seluruh panduan ini: **`Documents\lms-icm`** — folder yang **langsung berisi `index.html`**.

### B2. Isi alamat backend di `js/config.js`

1. Buka folder `lms-icm\js\`, klik kanan **`config.js`** → *Open with* → **Notepad**.
2. Cari baris ini:

```js
GAS_URL: 'https://script.google.com/macros/s/GANTI_DENGAN_ID_DEPLOYMENT/exec'
```

3. Ganti seluruh isi di antara tanda kutip dengan URL `/exec` dari langkah A5:

```js
GAS_URL: 'https://script.google.com/macros/s/AKfycbx1a2B3c4D5…xyz/exec'
```

4. Pastikan: tetap diapit **tanda kutip tunggal** `'…'`, berakhiran `/exec`, tidak ada spasi.
5. **Ctrl+S** untuk menyimpan, tutup Notepad.

> Kalau langkah ini terlewat, situs tetap terbuka tetapi menampilkan layar **"Alamat backend belum diisi"**. Tidak berbahaya — cukup isi lalu unggah ulang (Bagian F2).

### B3. (Opsional) Cek cepat di komputer

Klik dua kali `index.html`. Jika halaman login ungu-krem muncul dan bisa masuk memakai akun demo, frontend dan backend sudah tersambung. Jika browser menolak membuka (beberapa browser membatasi berkas lokal), lewati saja — pengujian sebenarnya dilakukan di Bagian D.

---

## BAGIAN C — Mengunggah frontend ke GitHub Pages

Istilah yang akan muncul:
**Repository (repo)** = folder proyek di GitHub · **Commit** = "simpan" dengan catatan · **Push** = kirim ke GitHub · **Branch** = jalur versi (kita pakai `main`).

### C1. Pasang Git

- **Windows:** unduh dari **https://git-scm.com/download/win** → jalankan installer → klik **Next** terus dengan pengaturan bawaan → **Install**.
- **Mac:** buka *Terminal*, ketik `git --version`. Jika belum ada, macOS menawarkan pemasangan otomatis — setujui.

Cek pemasangan. Buka **PowerShell** (Start → ketik *PowerShell*) lalu ketik:

```powershell
git --version
```

Hasil yang benar: `git version 2.xx.x…`

### C2. Buat akun GitHub

Daftar di **https://github.com** → *Sign up*. **Username** akan menjadi bagian alamat situs: `https://USERNAME.github.io/lms-icm/`. Pilih yang mudah dibaca, misalnya nama sekolah (`icm-academic`).

### C3. Kenalkan diri ke Git (sekali seumur komputer)

```powershell
git config --global user.name "Nama Lengkap Anda"
git config --global user.email "email-akun-github@contoh.com"
```

`user.name` bebas (hanya label di riwayat). `user.email` sebaiknya sama dengan email akun GitHub. Tidak ada output = berhasil.

### C4. Buat repository kosong di GitHub

1. Di github.com klik **＋** (kanan atas) → **New repository**.
2. **Repository name:** `lms-icm`
3. Pilih **Public** (GitHub Pages gratis hanya untuk repo publik — aman, karena frontend tidak berisi rahasia apa pun).
4. **JANGAN** centang *Add a README file*, *.gitignore*, atau *license*.
5. Klik **Create repository**. Biarkan halaman yang muncul tetap terbuka.

### C5. Buka PowerShell **di folder yang benar** ⚠️ (langkah paling penting)

1. Buka File Explorer → masuk ke **`Documents\lms-icm`** (folder yang berisi `index.html`).
2. Klik address bar (kotak alamat di atas), ketik **`powershell`**, tekan **Enter**. PowerShell langsung terbuka di folder itu.
3. Ketik:

```powershell
dir
```

Hasil yang **BENAR** — terlihat langsung `index.html`, folder `css` dan `js`:

```
Mode     LastWriteTime   Length Name
----     -------------   ------ ----
d-----   …                      css
d-----   …                      js
-a----   …                 3xxx index.html
-a----   …                 xxxx PANDUAN-INSTALASI-GAS-GITHUB.md
-a----   …                 xxxx README.md
```

Hasil yang **SALAH** — kalau yang terlihat justru folder `lms-icm` (tanpa `index.html`), Anda satu level terlalu tinggi. Ketik `cd lms-icm`, lalu `dir` lagi. **Jangan lanjut sebelum `index.html` terlihat.** Git tidak akan memperingatkan bila foldernya salah — situs hanya akan menampilkan 404.

Pastikan juga **tidak ada `Kode.gs`** di folder ini.

> Mac: buka Terminal, ketik `cd ~/Documents/lms-icm` lalu `ls`.

### C6. Kirim ke GitHub — jalankan satu per satu

**1) Jadikan folder ini repository Git**
```powershell
git init
```
Hasil: `Initialized empty Git repository in C:/Users/…/Documents/lms-icm/.git/`

**2) Tandai semua berkas** (perhatikan **titik** di akhir)
```powershell
git add .
```
Hasil: diam (tidak ada output) = berhasil. Peringatan `LF will be replaced by CRLF` boleh diabaikan.

**3) Simpan sebagai versi pertama**
```powershell
git commit -m "Upload pertama LMS ICM"
```
Hasil: daftar berkas, misalnya `create mode 100644 index.html`, `create mode 100644 js/app.js`.

**4) Namai jalurnya `main`**
```powershell
git branch -M main
```

**5) Sambungkan ke repo GitHub** (ganti `USERNAME`)
```powershell
git remote add origin https://github.com/USERNAME/lms-icm.git
```

**6) Kirim**
```powershell
git push -u origin main
```

Biasanya muncul jendela **"Connect to GitHub"** → klik **Sign in with your browser** → **Authorize**. Selesai.

Jika yang diminta adalah *Username* dan *Password* di terminal:
- **Username:** username GitHub Anda.
- **Password:** **bukan** kata sandi akun, melainkan **Personal Access Token** (langkah C7).
- Saat menempel token, **layar tetap kosong** — tidak ada bintang atau karakter. Ini normal. Klik kanan untuk menempel, lalu Enter.

Tanda berhasil:
```
Writing objects: 100% (…), done.
 * [new branch]      main -> main
```

### C7. (Hanya jika diminta) Membuat Personal Access Token

1. Buka **https://github.com/settings/tokens** → **Generate new token** → **Generate new token (classic)**.
2. **Note:** `push-lms-icm` · **Expiration:** `90 days` · centang **✅ repo**.
3. **Generate token** → salin kode `ghp_…` (hanya tampil sekali, simpan di Notepad).
4. Jalankan lagi `git push -u origin main`, tempel token sebagai password.

> Alternatif tanpa terminal: **GitHub Desktop** (https://desktop.github.com) → *File → Add local repository* → pilih `Documents\lms-icm` → **Publish repository** (hilangkan centang *Keep this code private*).
> ⛔ Jangan memakai tombol **"Upload files"** di situs GitHub — struktur folder `css/` dan `js/` akan rusak.

### C8. Periksa repo, lalu aktifkan GitHub Pages

1. Buka `https://github.com/USERNAME/lms-icm`. Pastikan di daftar teratas terlihat **`css`, `js`, `index.html`** — bukan folder `lms-icm`.
2. Klik tab **Settings** → di sidebar kiri klik **Pages**.
3. Atur:

| Kolom | Nilai |
|---|---|
| Source | **Deploy from a branch** |
| Branch | **main** · **/ (root)** → **Save** |
| Enforce HTTPS | ✅ centang (muncul setelah situs aktif) |

4. Tunggu 1–2 menit, muat ulang halaman Settings → Pages. Muncul:
   **"Your site is live at `https://USERNAME.github.io/lms-icm/`"**

---

## BAGIAN D — Uji coba pertama

1. Buka `https://USERNAME.github.io/lms-icm/`.
2. Halaman login muncul dengan kotak **Akun demo**. Kata sandi semua akun demo: **`ICM2026!`**

| Peran | Email |
|---|---|
| Super Admin | admin@icm.sch.id |
| QA Admin | qa@icm.sch.id |
| Pimpinan SMA | hendra.wijaya@icm.sch.id |
| Pimpinan SMP | syarif.h@icm.sch.id |
| Pimpinan SD & KB-TK | ratna.sari@icm.sch.id |
| Guru Biologi SMA | siti.rahma@icm.sch.id |
| Guru lain | bambang.p@ · ahmad.fauzi@ · nurul.h@ · dewi.m@ · rizky.r@ · intan.p@ · hasanah@ · laila.k@ (…@icm.sch.id) |

3. Alur uji 10 menit:
   - Masuk sebagai **guru** (`siti.rahma@…`) → **Lesson Plan → Buat Lesson Plan** → isi 5 langkah → **Kirim ke Pimpinan**.
   - Keluar, masuk sebagai **pimpinan SMA** (`hendra.wijaya@…`) → **Persetujuan** → buka berkas → coba alat anotasi → **Setujui** (atau *Kembalikan* dengan catatan ≥ 20 karakter).
   - Masuk sebagai **guru** lagi → status berubah; unduh **PDF resmi** dari lesson plan yang disetujui.
   - Buka spreadsheet database (link di log A4) → sheet `LessonPlans` dan `Approvals` sudah terisi.

**Kecepatan yang wajar:** login pertama 2–4 detik (panggilan ke Google). Setelah itu pindah menu terasa instan karena semua halaman dirender di perangkat; simpan dan ajukan tampil seketika lalu disinkronkan di latar (lihat indikator *Tersimpan / Menyinkron…* di bilah atas).

---

## BAGIAN E — Persiapan sebelum dipakai resmi

Masuk sebagai **Super Admin** (`admin@icm.sch.id`), lalu:

1. **Pengguna & Sistem → Identitas Aplikasi** — ubah nama sekolah, sub-judul kop dokumen, URL logo → *Tampilkan akun demo di login* = **Tidak** → **Simpan Pengaturan**.
2. **Tambah Pengguna Baru** untuk setiap guru/pimpinan asli. Kata sandi sementara tampil sekali — bagikan, lalu pengguna menggantinya di *Profil & Akun*.
3. **Nonaktifkan** akun demo yang tidak dipakai (centang → *Nonaktifkan*), atau **Reset Password** jika akunnya diteruskan.
4. Ganti kata sandi akun **admin** sendiri di *Profil & Akun*.
5. **Tanda tangan pimpinan:** pimpinan mengunggah spesimen (PNG/JPG) di *Profil & TTD*, atau Super Admin di kartu *Tanda Tangan Digital*. Berkas TTD disimpan di folder Drive terbatas dan **tidak pernah** dikirim ke browser.
6. Masuk sebagai **QA** → **Master Data** → periksa *Tahun & Term* (aktifkan term berjalan), Mata Pelajaran, Tingkat Kelas, ICM Value, Sequence of Teaching, **Period per Mapel** (period/minggu tiap mapel × kelas), **minggu efektif** term, Alokasi Sesi (Period), Pilihan Durasi.
7. **Hapus contoh kerja guru** (chapter, lesson plan, persetujuan, lampiran contoh) sebelum guru mulai mengisi — lihat **[E1](#e1-menghapus-contoh-kerja-guru)**. Jangan menghapus baris langsung di spreadsheet.
8. Bagikan alamat `https://USERNAME.github.io/lms-icm/` ke guru. Di HP, pengguna bisa memilih **Tambahkan ke Layar Utama** agar terbuka seperti aplikasi.

### E1. Menghapus contoh kerja guru

Lakukan di editor Apps Script (bukan di spreadsheet). Menghapus baris langsung di Sheets bisa membuat cache server menunjuk ke baris yang salah.

1. Pastikan `Kode.gs` versi terbaru sudah ditempel (fungsi di bawah ada di dalamnya) → **Ctrl+S**.
2. **Lihat dulu:** pilih fungsi **`cekDataKerjaGuru`** → ▶ **Jalankan**. Log menampilkan jumlah chapter & lesson plan per guru. Belum ada yang dihapus.
3. **Hapus**, pilih salah satu:

| Fungsi | Yang dihapus |
|---|---|
| **`hapusSemuaDataKerjaGuru`** | Semua chapter, sub-bab, TP, lesson plan, skenario, lampiran, riwayat persetujuan & antrean email yang belum terkirim — **dari semua guru** |
| **`hapusDataKerjaGuruTertentu`** | Hanya milik guru yang emailnya Anda tulis di daftar `EMAIL_GURU` di dalam fungsi itu (ubah dulu daftarnya, **Ctrl+S**, baru jalankan) |

4. Log menampilkan `🧹 Selesai` beserta jumlah baris yang dihapus dan jumlah berkas Drive yang dipindah ke **Sampah** (masih bisa dipulihkan dari Sampah Google Drive selama 30 hari).
5. Minta pengguna yang sedang membuka aplikasi menekan **F5**.

**Tidak ikut terhapus:** akun pengguna, master data (termasuk Period), term, pengaturan aplikasi, tanda tangan pimpinan, dan log audit. Akun demo dihapus/diganti terpisah lewat menu **Pengguna & Sistem** (nonaktifkan atau ubah email & nama).

⚠️ Penghapusan tidak bisa dibatalkan untuk isi spreadsheet. Bila ragu, buat salinan dulu: buka spreadsheet database → **File → Buat salinan**.

---

## BAGIAN F — Cara memperbarui aplikasi

### F1. Memperbarui backend (Kode.gs) — URL tetap sama

1. Tempel kode baru di editor Apps Script → **Ctrl+S**.
2. **Terapkan → Kelola deployment** (Manage deployments) → pilih deployment aktif → ikon **✏️ Edit**.
3. **Versi:** pilih **Versi baru** (New version) → **Terapkan**.

✅ URL `/exec` **tidak berubah**, jadi `js/config.js` dan GitHub **tidak perlu disentuh**.
⚠️ Jangan memilih *Deployment baru* untuk pembaruan rutin — itu menghasilkan URL baru, sehingga `config.js` harus diubah dan di-push ulang.

### F2. Memperbarui frontend (berkas di `Documents\lms-icm`)

Ganti/edit berkasnya, lalu dari PowerShell **di folder `Documents\lms-icm`**:

```powershell
git add .
git commit -m "Perbarui tampilan"
git push
```

Situs diperbarui otomatis dalam 1–2 menit. Jika masih tampil versi lama, tekan **Ctrl+Shift+R** (muat ulang paksa) atau buka di jendela Incognito.

### F3. Period, minggu efektif, chapter, dan lesson plan (model terbaru)

Alur perhitungan mengikuti **term**:

```
Minggu efektif term  ×  period per minggu (mapel × kelas)  =  anggaran period term
        9            ×            5                        =        45
```

**1. Admin/QA mengatur dasar perhitungan** (menu **Master Data**):

| Yang diatur | Di mana | Keterangan |
|---|---|---|
| **Minggu efektif** | *Tahun & Term* → ✏️ pada term | Dikosongkan = **otomatis** dari tanggal mulai–selesai term (hari ÷ 7, dibulatkan). Isi angka (1–30) bila ada minggu libur/ujian yang harus dikurangi. |
| **Period per minggu** | *Period per Mapel* | Tabel mapel × kelas per unit. Isi lalu **Simpan**. Nilai 0 = belum diatur (anggaran tidak dihitung). |
| **Panjang 1P / 2P** | *Alokasi Sesi (Period)* | Bawaan 1 Period = 40 menit, 2 Period = 80 menit; bisa diubah per unit. |
| **Aturan matriks diferensiasi** | *Pengguna & Sistem → Pengaturan* | **Bawaan: hanya satu dari 9 kotak** (3×3). Opsi lain: satu pilihan per baris Content/Process/Product. Instalasi lama yang sudah menyimpan pengaturan ini perlu mengubahnya sendiri. |

**2. Guru mengisi Analisis Chapter** (per chapter/bab):
- Isi **sub-bab/topik** (bisa ditambah kapan saja) dan **jumlah period** chapter.
- Period tiap chapter **boleh berbeda-beda**. Panel anggaran menunjukkan anggaran term, period chapter lain, dan sisa.
- **Total period semua chapter satu mapel di satu term harus tepat sama dengan anggaran term** (mis. 45). Chapter disimpan bertahap dan tidak boleh melewati anggaran; selama total belum pas, **lesson plan belum bisa dikirim ke pimpinan** (draft tetap bisa disimpan).
- Tulis **semua TP** chapter, lalu pilih **sub-bab** untuk tiap TP. Satu sub-bab boleh punya beberapa TP; sub-bab tanpa TP diberi tanda peringatan.

**3. Guru membuat Lesson Plan — satu LP per chapter** (4 chapter = 4 LP per term):
- Langkah 1 memilih chapter (chapter yang sudah punya LP tidak bisa dipilih lagi).
- Langkah 2 menampilkan TP chapter (hanya baca, dikelompokkan per sub-bab).
- Langkah 3 berisi **Essential Question saja** — hanya **satu per chapter** (wajib).
- Langkah 4 **Pertemuan**: tiap pertemuan berdurasi **1 Period (40 menit)** atau **2 Period (80 menit)** dan berisi:
  1. **TP yang diajarkan** — guru mencentang TP (dikelompokkan per sub-bab); **sub-bab terisi otomatis**. Satu TP boleh dicentang di beberapa pertemuan.
  2. **Learning Indicator (Micro TP)** — **terisi otomatis dari TP yang dicentang** di pertemuan itu. Guru bisa menambah indikator sendiri lewat tombol *Tambah indikator manual* (di luar TP yang sudah dibuat di Analisis Chapter) dan menghapusnya kembali.
  3. **ICM Value** (minimal satu), **Sequence of Teaching** (minimal satu) dan **Terminology & Trigger Question** — **wajib** di setiap pertemuan, walaupun hanya satu isian.
  4. **Diferensiasi** (matriks 3×3) — **satu-satunya yang boleh dikosongkan**; bila diisi, hanya **satu dari 9 kotak** (aturan bawaan).
  5. Skenario **Pendahuluan–Inti–Penutup** beserta durasinya.
  Tombol *Susun otomatis* membagi TP ke pertemuan sesuai period chapter.
- **Setiap TP chapter harus masuk ke minimal satu pertemuan.** Bila masih ada TP yang belum terpetakan, ringkasan menampilkan daftarnya dan lesson plan **tidak bisa dikirim**.
- **Total period semua pertemuan harus sama dengan period chapter** dan durasi skenario tiap pertemuan tidak boleh melebihi alokasinya, kalau tidak LP tidak bisa dikirim.
- PDF resmi memuat bagian *Rencana Pertemuan* lengkap dengan alokasi, topik, TP, Learning Indicator (Micro TP), ICM, Sequence, Terminology & Trigger Question, dan Diferensiasi tiap pertemuan.

### F4. Memasang pembaruan ini di instalasi yang sudah berjalan

Model ini mengubah struktur data (chapter berperiod, TP bersub-bab, satu LP berisi banyak pertemuan), sehingga **data kerja guru lama tidak kompatibel** dan harus dikosongkan.

1. **Cadangkan:** buka spreadsheet database → **File → Buat salinan**.
2. **Backend:** tempel `Kode.gs` versi baru → **Ctrl+S** → **Terapkan → Kelola deployment → ✏️ → Versi baru → Terapkan** (URL `/exec` tetap sama).
3. Jalankan **`setupAppEnvironment`** → ▶. Fungsi ini menambahkan kolom/master baru (`minggu_efektif`, `jumlah_period`, `sub_id`, `sesi_no`, Period per Mapel) tanpa menghapus data lain.
4. Jalankan **`hapusSemuaDataKerjaGuru`** (lihat [E1](#e1-menghapus-contoh-kerja-guru)) agar chapter & lesson plan lama tidak bentrok. Akun, master data, dan term tidak ikut terhapus.
5. Masuk sebagai **QA** → **Master Data → Period per Mapel**: isi period/minggu tiap mapel × kelas (instalasi lama tidak otomatis mendapat angka ini) → **Simpan**. Periksa juga **minggu efektif** term aktif.
6. **Frontend:** ekstrak ZIP baru → salin isi folder `lms-icm` (kecuali `js/config.js` — **pertahankan `config.js` lama** yang berisi URL `/exec`) ke `Documents\lms-icm` → lalu:

```powershell
git add .
git commit -m "Period per term, chapter berperiod, LP per chapter"
git push
```

7. Tunggu 1–2 menit, buka situs, tekan **Ctrl+Shift+R**. Minta guru mengisi ulang Analisis Chapter dengan format baru.

**Memastikan pembaruan benar-benar tampil.** Setelah login, lihat bagian bawah menu kiri: ada tulisan **"Versi LP3-…"** di bawah tombol *Keluar*. Bila tulisan itu tidak ada, yang tampil masih versi lama.

Bila di halaman repo GitHub ada tanda **❌ merah** di samping commit terakhir (atau *Deployments → github-pages* merah), situs belum berhasil diperbarui:
1. Klik tanda ❌ → **Details** untuk melihat penyebabnya, atau buka tab **Actions** → pilih proses yang gagal → **Re-run all jobs** (kegagalan sementara dari GitHub sering selesai setelah diulang).
2. Pastikan di repo ada `index.html`, folder `css`, dan folder `js` (berisi `app.js`, `shared.js`, `config.js`), dan tanggal commit-nya sudah yang terbaru.
3. Setelah tanda ✅ hijau muncul, buka situs lalu tekan **Ctrl+Shift+R**.

### F5. Trigger otomatis

Dipasang oleh `setupAppEnvironment`. Untuk memasang ulang: pilih fungsi **`installTriggers`** → ▶ Jalankan (aman diulang). Lihat daftarnya di ikon **⏰ Pemicu** (Triggers).

| Trigger | Jadwal | Fungsi |
|---|---|---|
| `processEmailQueue` | tiap 5 menit | Mengirim antrean email (diajukan, dikembalikan, disetujui) |
| `warmup` | tiap 10 menit | Menjaga cache server tetap hangat supaya login & sinkron cepat |
| `dailyDigest` | setiap hari ±06.00 | Ringkasan berkas yang melewati SLA ke pimpinan |
| `weeklyTeacherReminder` | Senin ±06.00 | Pengingat sesi yang belum punya lesson plan (bisa dimatikan di Pengaturan) |

Kuota email Apps Script: ±100 penerima/hari (akun Gmail biasa), ±1.500/hari (Google Workspace). Antrean otomatis menunggu kuota hari berikutnya bila habis.

---

## BAGIAN G — Opsional

### G1. Login dengan akun Google

Login email + kata sandi LMS selalu tersedia. Tombol **"Masuk dengan Google"** baru muncul setelah langkah ini:

1. Buka **https://console.cloud.google.com** → buat/pilih proyek → **APIs & Services → OAuth consent screen** → isi nama aplikasi & email (pilih *Internal* bila memakai Google Workspace sekolah).
2. **Credentials → Create credentials → OAuth client ID** → *Application type*: **Web application**.
3. **Authorized JavaScript origins** → **Add URI** → `https://USERNAME.github.io` (tanpa `/lms-icm`, tanpa garis miring di akhir). Bila memakai domain sendiri, tambahkan juga domain itu.
4. **Create** → salin **Client ID** (`1234…-abcd….apps.googleusercontent.com`).
5. Di aplikasi, masuk sebagai **Super Admin** → **Pengguna & Sistem → Login Google (opsional)** → tempel di kolom **OAuth Client ID** → **Simpan**.

Client ID disimpan di Script Properties dan memang bersifat publik (bukan rahasia). Pengguna hanya bisa masuk bila emailnya sudah terdaftar & aktif di menu Pengguna.

### G2. Menampilkan di Blogger (opsional)

Blogger → **Halaman → Halaman baru → Tampilan HTML**, tempel:

```html
<style>.post-title,.entry-title,.post-header,.post-footer{display:none!important}</style>
<div style="position:relative;width:100%;height:100vh;height:100dvh;min-height:640px">
  <iframe src="https://USERNAME.github.io/lms-icm/" title="LMS ICM"
          style="position:absolute;inset:0;width:100%;height:100%;border:0"
          allow="clipboard-write; fullscreen"></iframe>
</div>
<a href="https://USERNAME.github.io/lms-icm/" target="_blank" rel="noopener">Buka LMS ICM di tab baru ↗</a>
```

Tombol "Masuk dengan Google" kadang terblokir di dalam iframe (pembatasan cookie pihak ketiga); login email + kata sandi tetap berfungsi.

### G3. Domain sendiri (mis. `lms.icm.sch.id`)

1. Di pengelola DNS domain sekolah, buat **CNAME** `lms` → `USERNAME.github.io`.
2. GitHub repo → **Settings → Pages → Custom domain** → isi `lms.icm.sch.id` → **Save** → tunggu centang hijau → aktifkan **Enforce HTTPS**.
3. Bila memakai Login Google, tambahkan `https://lms.icm.sch.id` di *Authorized JavaScript origins* (G1 langkah 3).

---

## Pemecahan masalah

| Yang terlihat | Penyebab | Solusi |
|---|---|---|
| Layar **"Alamat backend belum diisi"** | `GAS_URL` di `js/config.js` masih contoh | Isi URL `/exec` (B2), lalu F2 |
| Login: *"Server membalas bukan JSON"* / *"Tidak dapat terhubung ke server"* | Akses Web App bukan **Siapa saja**, atau URL bukan `/exec` | A5 ulang: Kelola deployment → ✏️ → akses **Siapa saja** → Versi baru. Cek URL di `config.js` |
| Membuka URL `/exec` minta login Google | Akses Web App salah | Sama seperti baris di atas |
| Situs **404 — File not found** | `index.html` tidak di root repo, atau Pages belum aktif | Buka repo di GitHub: harus terlihat `index.html` di daftar teratas. Kalau yang terlihat folder `lms-icm`, lihat *Perbaikan salah folder* di bawah. Cek Settings → Pages = main / (root) |
| Halaman tampil tanpa warna/tata letak | Folder `css/` atau `js/` rusak (biasanya karena "Upload files" di web) | Push ulang dari terminal (C5–C6) |
| Perubahan kode backend tidak berlaku | Belum membuat **Versi baru** | F1 |
| Situs tampil versi lama | Cache browser | **Ctrl+Shift+R** atau Incognito |
| *"Terlalu banyak percobaan masuk"* | Pengaman setelah 8× salah sandi | Tunggu 15 menit, atau Super Admin melakukan Reset Password |
| *"Sesi berakhir"* | Token kedaluwarsa / dicabut | Masuk lagi; centang *Ingat perangkat ini* untuk sesi lebih panjang |
| Indikator **"Belum tersinkron"** | Koneksi terputus | Data tetap aman di perangkat dan terkirim otomatis saat online; klik indikator untuk sinkron manual |
| Email tidak terkirim | Kuota habis / trigger belum terpasang | Cek sheet `EmailQueue`, jalankan `installTriggers` |
| Tombol Google tidak muncul / *"origin not allowed"* | Client ID belum diisi atau origin GitHub belum didaftarkan | G1 langkah 3 dan 5 |
| `Password authentication is not supported` | GitHub menolak sandi akun di terminal | Pakai Personal Access Token (C7) |
| `remote origin already exists` | `git remote add` pernah dijalankan | Lewati; bila URL salah: `git remote set-url origin https://github.com/USERNAME/lms-icm.git` |
| `error: src refspec main does not match any` | Belum ada commit | Jalankan `git add .` lalu `git commit -m "Upload pertama"` |
| `Updates were rejected because the remote contains work` | Repo dibuat dengan README | `git pull --rebase origin main` lalu `git push` |
| Peringatan *"Lebih … menit dari alokasi"* / tidak bisa kirim | Total skenario melebihi period yang dipilih | Klik **Sesuaikan ke … menit**, atau pilih period lain di langkah 4 |
| Pilihan 1 Period / 2 Period tidak muncul | Master Period belum ditambahkan | Jalankan `setupAppEnvironment` sekali (F4 langkah 2) |
| Tampilan aneh setelah pembaruan besar | Cache data lama di perangkat | *Profil & Akun → Kosongkan cache perangkat*, muat ulang |

### Perbaikan salah folder (situs 404, repo berisi folder `lms-icm`)

Jangan hapus repo. Push ulang dari folder yang benar:

```powershell
cd "$HOME\Documents\lms-icm"
dir                      # wajib terlihat index.html, css, js
git init
git add .
git commit -m "Perbaikan: push dari folder yang benar"
git branch -M main
git remote add origin https://github.com/USERNAME/lms-icm.git
git push -u origin main --force
```

`--force` menimpa isi repo dengan isi folder ini — aman di sini karena isi lama memang salah susunan.

---

## Keamanan: apa yang publik, apa yang rahasia

| Lokasi | Isi | Status |
|---|---|---|
| Repo GitHub (publik) | Tampilan, kode tampilan, URL `/exec` | Boleh dilihat siapa pun — tidak ada kata sandi, token, atau data siswa/guru |
| Script Properties (Apps Script) | `SPREADSHEET_ID`, `ROOT_FOLDER_ID`, `SESSION_SECRET`, `PW_PEPPER`, `GOOGLE_CLIENT_ID`, `TTD_<id>` | Rahasia, hanya pemilik skrip — jangan salin ke kode/sheet/GitHub |
| Google Sheets & Drive | Semua data, lampiran, PDF, TTD | Hanya pemilik akun; jangan bagikan akses edit selain Tim IT |

Pengaman yang sudah aktif:
- Setiap permintaan dicek **token sesi** (HMAC, bisa dicabut saat logout/nonaktif/reset sandi) dan **hak akses per peran & unit** di server — mengetahui URL `/exec` tidak memberi akses ke data apa pun.
- Hanya 7 fungsi yang bisa dipanggil dari internet (`boot`, `login`, `loginGoogle`, `resume`, `logout`, `api`, `apiBatch`); fungsi setup & trigger tidak terbuka.
- Kata sandi disimpan sebagai hash (salt per pengguna + pepper), percobaan login dibatasi.
- Teks kaya disanitasi; isian yang diawali `= + - @` dinetralkan agar tidak dieksekusi sebagai rumus di Sheets.
- Token tidak pernah ditaruh di URL.

---

## Glosarium

| Istilah | Arti singkat |
|---|---|
| **Backend / API** | Program di Google (Kode.gs) yang menyimpan & mengambil data |
| **Frontend** | Tampilan aplikasi di browser (index.html, css, js) |
| **URL `/exec`** | Alamat backend hasil Deploy Web App |
| **Deployment / Versi** | "Rilis" kode Apps Script. *Versi baru* = memperbarui tanpa ganti alamat |
| **Script Properties** | Brankas pengaturan rahasia di proyek Apps Script |
| **Trigger** | Jadwal otomatis yang menjalankan fungsi (mis. kirim email tiap 5 menit) |
| **Repository (repo)** | Folder proyek di GitHub |
| **Commit** | Menyimpan perubahan dengan catatan |
| **Push** | Mengirim commit dari komputer ke GitHub |
| **Branch `main`** | Jalur versi utama yang ditayangkan GitHub Pages |
| **Personal Access Token** | "Kata sandi khusus" GitHub untuk terminal |
| **GitHub Pages** | Layanan gratis GitHub untuk menayangkan situs statis |
