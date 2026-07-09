const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const multer = require('multer'); // Tambahan pustaka upload berkas
const path = require('path');
const fs = require('fs');

dotenv.config();

const app = express();


app.use(cors());
app.use(express.json());

// Membuka akses folder uploads agar aset gambar & musik bisa diakses dari browser frontend
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Pastikan folder uploads fisik tersedia
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// ==========================================
// 1. SETUP DATABASE SQLITE (PENYEMPURNAAN CMS)
// ==========================================
const db = new sqlite3.Database('./undangan.db', (err) => {
    if (err) {
        console.error('Gagal terhubung ke database:', err.message);
    } else {
        console.log('Terkoneksi ke database SQLite.');

        // Tabel Tamu & RSVP
        db.run(`CREATE TABLE IF NOT EXISTS guests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kode TEXT UNIQUE NOT NULL,
            nama TEXT NOT NULL,
            kategori TEXT,
            no_wa TEXT,
            status_hadir TEXT DEFAULT 'pending',
            jumlah_buka INTEGER DEFAULT 0,
            last_opened DATETIME,
            jumlah_tamu INTEGER DEFAULT 0,
            ucapan TEXT
        )`);

        // Tabel Opsi/Konfigurasi Umum (Profil, Acara, Hero, Tema, Pengaturan)
        db.run(`CREATE TABLE IF NOT EXISTS options (
            key TEXT UNIQUE NOT NULL,
            value TEXT
        )`);

        // Tabel Cerita Cinta
        db.run(`CREATE TABLE IF NOT EXISTS timeline (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            date TEXT NOT NULL,
            content TEXT NOT NULL,
            image TEXT,
            sort_order INTEGER DEFAULT 0
        )`);

        // Tabel Galeri Foto
        db.run(`CREATE TABLE IF NOT EXISTS gallery (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0
        )`);

        // Tabel Musik Backsound
        db.run(`CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            file_path TEXT NOT NULL,
            is_active INTEGER DEFAULT 0
        )`);
    }
});

// ==========================================
// 2. KONFIGURASI MULTER (PENYIMPANAN BERKAS)
// ==========================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './uploads/');
    },
    filename: (req, file, cb) => {
        // Membuat nama file unik: TANGGAL-ACAK.EKSTENSI
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// ==========================================
// HELPER: HAPUS FILE FISIK DARI STORAGE
// ==========================================
const deleteFileFromUrl = (fileUrl) => {
    if (!fileUrl) return;
    try {
        const filename = fileUrl.split('/uploads/')[1];
        if (filename) {
            const filePath = path.join(__dirname, 'uploads', filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath); // Hapus file fisik dari harddisk server
            }
        }
    } catch (err) {
        console.error("Gagal menghapus file fisik:", err);
    }
};

// ==========================================
// 3. MIDDLEWARE SECURITY (JWT)
// ==========================================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.status(401).json({ error: "Akses Ditolak." });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Sesi login kedaluwarsa." });
        req.user = user;
        next();
    });
};

// ==========================================
// 4. API ENDPOINTS TAMU & LOGIN
// ==========================================
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
        const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token: token });
    } else {
        res.status(401).json({ success: false, error: "Password salah!" });
    }
});

app.get('/api/guests', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM guests ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/guests', authenticateToken, (req, res) => {
    const { nama, kategori, no_wa } = req.body;
    const kodeUnik = crypto.randomBytes(4).toString('hex').toUpperCase();
    const sql = `INSERT INTO guests (kode, nama, kategori, no_wa) VALUES (?, ?, ?, ?)`;
    db.run(sql, [kodeUnik, nama, kategori, no_wa], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, data: { id: this.lastID, kode: kodeUnik, nama, kategori, no_wa } });
    });
});

app.get('/api/guests/verify/:kode', (req, res) => {
    const { kode } = req.params;
    db.get(`SELECT * FROM guests WHERE kode = ?`, [kode.toUpperCase()], (err, row) => {
        if (err) return res.status(500).json({ error: "Server error" });
        if (!row) return res.status(404).json({ success: false });
        res.json({ success: true, data: row });
    });
});

app.post('/api/guests/track/:kode', (req, res) => {
    const { kode } = req.params;
    db.run(`UPDATE guests SET jumlah_buka = jumlah_buka + 1, last_opened = CURRENT_TIMESTAMP WHERE kode = ?`, [kode.toUpperCase()], function (err) {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

app.post('/api/guests/rsvp/:kode', (req, res) => {
    const { kode } = req.params;
    const { statusHadir, jumlahTamu, ucapan } = req.body;
    const sql = `UPDATE guests SET status_hadir = ?, jumlah_tamu = ?, ucapan = ? WHERE kode = ?`;
    db.run(sql, [statusHadir, jumlahTamu, ucapan, kode.toUpperCase()], function (err) {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

app.get('/api/wishes', (req, res) => {
    const sql = `SELECT nama, kategori, status_hadir, ucapan, last_opened FROM guests WHERE ucapan IS NOT NULL AND TRIM(ucapan) != '' ORDER BY last_opened DESC LIMIT 20`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, data: rows });
    });
});

// Endpoint untuk menghapus tamu (mendukung hapus satuan maupun dipanggil berulang untuk bulk)
app.delete('/api/guests/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM guests WHERE id = ?`, [id], function (err) {
        if (err) return res.status(500).json({ success: false, error: err.message });

        // this.changes berisi jumlah baris yang berhasil dihapus
        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: "Tamu tidak ditemukan" });
        }

        res.json({ success: true, message: "Tamu berhasil dihapus" });
    });
});

// Endpoint untuk mengedit data tamu
app.put('/api/guests/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { nama, kategori, no_wa } = req.body;

    const sql = `UPDATE guests SET nama = ?, kategori = ?, no_wa = ? WHERE id = ?`;
    db.run(sql, [nama, kategori, no_wa, id], function (err) {
        if (err) return res.status(500).json({ success: false, error: err.message });

        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: "Tamu tidak ditemukan" });
        }
        res.json({ success: true, message: "Data tamu berhasil diperbarui" });
    });
});

// ==========================================
// 5. API ENDPOINTS CMS (BARU)
// ==========================================

// --- MENU 1, 2, 6, 7, 8: OPTIONS KEY-VALUE ---
app.get('/api/cms/options', (req, res) => {
    db.all(`SELECT * FROM options`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false });
        // Mengubah format array baris menjadi satu objek utuh tunggal
        const optionsObj = {};
        rows.forEach(row => { optionsObj[row.key] = row.value; });
        res.json({ success: true, data: optionsObj });
    });
});

app.post('/api/cms/options', authenticateToken, (req, res) => {
    const { configs } = req.body; // Objek berisi pasangan { key: value }
    const stmt = db.prepare(`INSERT OR REPLACE INTO options (key, value) VALUES (?, ?)`);

    db.serialize(() => {
        Object.entries(configs).forEach(([key, value]) => {
            stmt.run(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
        });
        stmt.finalize((err) => {
            if (err) return res.status(500).json({ success: false });
            res.json({ success: true, message: "Konfigurasi CMS berhasil disimpan" });
        });
    });
});

// Endpoint Khusus Unggah Gambar Tunggal (Profil Mempelai / Hero Background)
app.post('/api/cms/upload-single', authenticateToken, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: "Berkas tidak terunggah" });

    // HAPUS FILE LAMA JIKA ADA (Mencegah storage bengkak saat replace foto profil)
    if (req.body.oldImageUrl) {
        deleteFileFromUrl(req.body.oldImageUrl);
    }

    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ success: true, url: fileUrl });
});

// --- MENU 3: CERITA CINTA (TIMELINE) ---
app.get('/api/cms/timeline', (req, res) => {
    db.all(`SELECT * FROM timeline ORDER BY sort_order ASC, id ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, data: rows });
    });
});

app.post('/api/cms/timeline', authenticateToken, upload.single('image'), (req, res) => {
    const { title, date, content, sort_order } = req.body;
    const imageUrl = req.file ? `http://localhost:5000/uploads/${req.file.filename}` : '';
    const sql = `INSERT INTO timeline (title, date, content, image, sort_order) VALUES (?, ?, ?, ?, ?)`;
    db.run(sql, [title, date, content, imageUrl, sort_order || 0], function (err) {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, id: this.lastID });
    });
});

app.delete('/api/cms/timeline/:id', authenticateToken, (req, res) => {
    db.get(`SELECT image FROM timeline WHERE id = ?`, [req.params.id], (err, row) => {
        if (row && row.image) deleteFileFromUrl(row.image); // Hapus foto fisik
        db.run(`DELETE FROM timeline WHERE id = ?`, [req.params.id], function (err) {
            if (err) return res.status(500).json({ success: false });
            res.json({ success: true });
        });
    });
});
app.put('/api/cms/timeline/:id', authenticateToken, upload.single('image'), (req, res) => {
    const { title, date, content, sort_order } = req.body;
    const id = req.params.id;

    if (req.file) {
        const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        // AMBIL URL LAMA DARI DB LALU HAPUS FISIKNYA
        db.get(`SELECT image FROM timeline WHERE id = ?`, [id], (err, row) => {
            if (row && row.image) deleteFileFromUrl(row.image);

            const sql = `UPDATE timeline SET title = ?, date = ?, content = ?, image = ?, sort_order = ? WHERE id = ?`;
            db.run(sql, [title, date, content, imageUrl, sort_order || 0, id], function (err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true });
            });
        });
    } else {
        const sql = `UPDATE timeline SET title = ?, date = ?, content = ?, sort_order = ? WHERE id = ?`;
        db.run(sql, [title, date, content, sort_order || 0, id], function (err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true });
        });
    }
});

// --- MENU 4: GALERI FOTO ---
app.get('/api/cms/gallery', (req, res) => {
    db.all(`SELECT * FROM gallery ORDER BY sort_order ASC, id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, data: rows });
    });
});

app.post('/api/cms/gallery', authenticateToken, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: "Tidak ada berkas" });
    const imageUrl = `http://localhost:5000/uploads/${req.file.filename}`;
    db.run(`INSERT INTO gallery (file_path) VALUES (?)`, [imageUrl], function (err) {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, data: { id: this.lastID, file_path: imageUrl, sort_order: 0 } });
    });
});

app.delete('/api/cms/gallery/:id', authenticateToken, (req, res) => {
    db.get(`SELECT file_path FROM gallery WHERE id = ?`, [req.params.id], (err, row) => {
        if (row && row.file_path) deleteFileFromUrl(row.file_path); // Hapus foto fisik
        db.run(`DELETE FROM gallery WHERE id = ?`, [req.params.id], function (err) {
            if (err) return res.status(500).json({ success: false });
            res.json({ success: true });
        });
    });
});

// --- MENU 5: MUSIK BACKSOUND ---
app.get('/api/cms/music', (req, res) => {
    db.all(`SELECT * FROM tracks ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, data: rows });
    });
});

app.post('/api/cms/music', authenticateToken, upload.single('audio'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: "Tidak ada berkas audio" });
    const { title } = req.body;
    const audioUrl = `http://localhost:5000/uploads/${req.file.filename}`;
    db.run(`INSERT INTO tracks (title, file_path) VALUES (?, ?)`, [title || req.file.originalname, audioUrl], function (err) {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, data: { id: this.lastID, title: title || req.file.originalname, file_path: audioUrl, is_active: 0 } });
    });
});

app.put('/api/cms/music/active/:id', authenticateToken, (req, res) => {
    const trackId = req.params.id;
    db.serialize(() => {
        // Matikan semua musik terlebih dahulu
        db.run(`UPDATE tracks SET is_active = 0`);
        // Aktifkan satu musik terpilih
        db.run(`UPDATE tracks SET is_active = 1 WHERE id = ?`, [trackId], function (err) {
            if (err) return res.status(500).json({ success: false });
            res.json({ success: true });
        });
    });
});

app.delete('/api/cms/music/:id', authenticateToken, (req, res) => {
    db.get(`SELECT file_path FROM tracks WHERE id = ?`, [req.params.id], (err, row) => {
        if (row && row.file_path) deleteFileFromUrl(row.file_path); // Hapus file mp3 fisik
        db.run(`DELETE FROM tracks WHERE id = ?`, [req.params.id], function (err) {
            if (err) return res.status(500).json({ success: false });
            res.json({ success: true });
        });
    });
});

app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server berjalan di port ${PORT}`);
});
