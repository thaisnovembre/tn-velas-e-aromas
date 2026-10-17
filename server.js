const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
// Pastas configuráveis para armazenamento persistente.
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (process.env.NODE_ENV === 'production') {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error('Configure SESSION_SECRET com pelo menos 32 caracteres no ambiente de produção.');
  }
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) {
    throw new Error('Configure ADMIN_PASSWORD com pelo menos 12 caracteres.');
  }
}

const db = new Database(path.join(DATA_DIR, 'tn-velas.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Velas aromáticas',
  price_cents INTEGER NOT NULL DEFAULT 0,
  promo_cents INTEGER,
  fragrance TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0,
  image TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  neighborhood TEXT NOT NULL DEFAULT '',
  fulfillment TEXT NOT NULL DEFAULT 'A combinar',
  notes TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  delivery_cents INTEGER,
  total_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'Novo',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const defaultSettings = {
  brand_name: 'TN Velas e Aromas',
  tagline: 'Pequenos detalhes, grandes sensações.',
  hero_text: 'Fragrâncias e detalhes artesanais para deixar seus ambientes mais acolhedores.',
  whatsapp: '',
  instagram: '',
  delivery_mode: 'combine',
  delivery_fee_cents: '',
  pickup_enabled: '1',
  delivery_enabled: '1',
  payment_methods: 'Pix;Cartão combinado pelo WhatsApp',
  about_text: 'Criamos produtos aromáticos para transformar pequenos momentos em experiências de aconchego. Cada detalhe é pensado com carinho.',
  announcement: ''
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultSettings)) insertSetting.run(key, value);

const adminCount = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
if (adminCount === 0 && process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
  const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(process.env.ADMIN_USER, hash);
  console.log(`Administrador inicial criado para o usuário "${process.env.ADMIN_USER}".`);
}

const productCount = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
if (productCount === 0) {
  const demo = [
    ['Vela Aromática Aconchego', 'Vela artesanal para criar uma atmosfera acolhedora. Edite esta descrição e o preço antes de divulgar.', 'Velas aromáticas', 3490, null, 'Baunilha suave', '90 g • aprox. 17 h', 10, '', 1, 1],
    ['Difusor de Ambiente', 'Perfume seu ambiente de forma delicada e contínua. Escolha a fragrância disponível com a loja.', 'Difusores de ambiente', 4590, null, 'A escolher', '250 ml', 8, '', 1, 1],
    ['Home Spray', 'Uma maneira prática de renovar o aroma do seu espaço.', 'Home sprays', 3290, null, 'A escolher', '200 ml', 8, '', 1, 0],
    ['Kit Presente Especial', 'Uma combinação para presentear com carinho. Personalize os itens e a descrição.', 'Kits para presentear', 7990, null, 'A escolher', 'Kit', 5, '', 1, 1]
  ];
  const ins = db.prepare(`INSERT INTO products (name, description, category, price_cents, promo_cents, fragrance, size, stock, image, active, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const tx = db.transaction(rows => rows.forEach(row => ins.run(...row)));
  tx(demo);
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
function saveSettings(obj) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const tx = db.transaction(entries => entries.forEach(([k, v]) => stmt.run(k, String(v ?? ''))));
  tx(Object.entries(obj));
}
function publicProduct(p) {
  return {
    id: p.id, name: p.name, description: p.description, category: p.category,
    priceCents: p.price_cents, promoCents: p.promo_cents, fragrance: p.fragrance,
    size: p.size, stock: p.stock, image: p.image, featured: !!p.featured,
    active: !!p.active
  };
}
function adminRequired(req, res, next) {
  if (!req.session || !req.session.adminId) return res.status(401).json({ error: 'Faça login para continuar.' });
  next();
}
function cents(v, optional = false) {
  if ((v === '' || v === null || v === undefined) && optional) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100000000) throw new Error('Preço inválido.');
  return Math.round(n * 100);
}
function cleanText(v, max = 2000) { return String(v ?? '').trim().slice(0, max); }

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
const SQLiteStore = SQLiteStoreFactory(session);
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR }),
  secret: process.env.SESSION_SECRET || 'desenvolvimento-apenas-troque-este-segredo-antes-de-publicar',
  resave: false,
  saveUninitialized: false,
  name: 'tn.sid',
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) return cb(new Error('Envie uma imagem JPG, PNG, WEBP ou GIF.'));
    cb(null, true);
  }
});

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1d' }));
app.use(express.static(path.join(ROOT, 'public')));

app.get('/api/store', (_req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE active=1 ORDER BY featured DESC, created_at DESC').all().map(publicProduct);
  const s = getSettings();
  res.json({
    products,
    settings: {
      brandName: s.brand_name, tagline: s.tagline, heroText: s.hero_text,
      instagram: s.instagram, announcement: s.announcement,
      aboutText: s.about_text, deliveryEnabled: s.delivery_enabled === '1',
      pickupEnabled: s.pickup_enabled === '1', paymentMethods: s.payment_methods
    }
  });
});

app.post('/api/orders', async (req, res) => {
  try {
    const body = req.body || {};
    const name = cleanText(body.name, 120);
    const phone = cleanText(body.phone, 40);
    const neighborhood = cleanText(body.neighborhood, 180);
    const fulfillment = cleanText(body.fulfillment, 60);
    const notes = cleanText(body.notes, 1000);
    if (!name) return res.status(400).json({ error: 'Informe seu nome.' });
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) return res.status(400).json({ error: 'Carrinho inválido.' });
    const normalized = [];
    let subtotal = 0;
    for (const item of body.items) {
      const id = Number(item.id);
      const qty = Number(item.quantity);
      if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 99) return res.status(400).json({ error: 'Produto ou quantidade inválida.' });
      const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id);
      if (!p || p.stock < qty) return res.status(400).json({ error: `Estoque insuficiente para ${p ? p.name : 'um produto'}.` });
      const unit = p.promo_cents !== null && p.promo_cents !== undefined ? p.promo_cents : p.price_cents;
      const fragrance = cleanText(item.fragrance || p.fragrance, 120);
      const line = unit * qty;
      subtotal += line;
      normalized.push({ id: p.id, name: p.name, quantity: qty, unitCents: unit, lineCents: line, fragrance, size: p.size });
    }
    const settings = getSettings();
    let deliveryCents = null;
    let totalCents = null;
    if (fulfillment.toLowerCase().includes('retirada')) {
      deliveryCents = 0;
      totalCents = subtotal;
    } else if (settings.delivery_mode === 'fixed' && settings.delivery_fee_cents !== '') {
      deliveryCents = Number(settings.delivery_fee_cents);
      totalCents = subtotal + deliveryCents;
    }
    const result = db.prepare(`INSERT INTO orders (customer_name, customer_phone, neighborhood, fulfillment, notes, items_json, subtotal_cents, delivery_cents, total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(name, phone, neighborhood, fulfillment || 'A combinar', notes, JSON.stringify(normalized), subtotal, deliveryCents, totalCents);
    const order = {
      id: result.lastInsertRowid, name, phone, neighborhood, fulfillment, notes,
      items: normalized, subtotalCents: subtotal, deliveryCents, totalCents,
      whatsapp: settings.whatsapp || ''
    };
    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Não foi possível registrar o pedido.' });
  }
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const username = cleanText(req.body?.username, 80);
  const password = String(req.body?.password || '');
  const admin = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Falha ao iniciar sessão.' });
    req.session.adminId = admin.id;
    req.session.username = admin.username;
    res.json({ ok: true, username: admin.username });
  });
});
app.post('/api/admin/logout', adminRequired, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/admin/me', adminRequired, (req, res) => res.json({ username: req.session.username }));

app.get('/api/admin/products', adminRequired, (_req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all().map(publicProduct));
});
app.post('/api/admin/products', adminRequired, (req, res) => {
  try {
    const b = req.body || {};
    const name = cleanText(b.name, 180);
    if (!name) return res.status(400).json({ error: 'O nome do produto é obrigatório.' });
    const info = db.prepare(`INSERT INTO products (name, description, category, price_cents, promo_cents, fragrance, size, stock, image, active, featured)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      name, cleanText(b.description), cleanText(b.category, 100) || 'Outros',
      cents(b.price), cents(b.promoPrice, true), cleanText(b.fragrance, 150), cleanText(b.size, 100),
      Math.max(0, Math.floor(Number(b.stock) || 0)), cleanText(b.image, 500),
      b.active === false ? 0 : 1, b.featured ? 1 : 0
    );
    res.status(201).json(publicProduct(db.prepare('SELECT * FROM products WHERE id=?').get(info.lastInsertRowid)));
  } catch (err) { res.status(400).json({ error: err.message || 'Não foi possível salvar.' }); }
});
app.put('/api/admin/products/:id', adminRequired, (req, res) => {
  try {
    const id = Number(req.params.id);
    const old = db.prepare('SELECT * FROM products WHERE id=?').get(id);
    if (!old) return res.status(404).json({ error: 'Produto não encontrado.' });
    const b = req.body || {};
    const name = cleanText(b.name, 180);
    if (!name) return res.status(400).json({ error: 'O nome do produto é obrigatório.' });
    db.prepare(`UPDATE products SET name=?, description=?, category=?, price_cents=?, promo_cents=?, fragrance=?, size=?, stock=?, image=?, active=?, featured=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
      name, cleanText(b.description), cleanText(b.category, 100) || 'Outros',
      cents(b.price), cents(b.promoPrice, true), cleanText(b.fragrance, 150), cleanText(b.size, 100),
      Math.max(0, Math.floor(Number(b.stock) || 0)), cleanText(b.image, 500),
      b.active === false ? 0 : 1, b.featured ? 1 : 0, id
    );
    res.json(publicProduct(db.prepare('SELECT * FROM products WHERE id=?').get(id)));
  } catch (err) { res.status(400).json({ error: err.message || 'Não foi possível atualizar.' }); }
});
app.delete('/api/admin/products/:id', adminRequired, (req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE items_json LIKE ?').get(`%"id":${id},%`).n;
  if (used) db.prepare('UPDATE products SET active=0 WHERE id=?').run(id);
  else db.prepare('DELETE FROM products WHERE id=?').run(id);
  res.json({ ok: true, deactivated: !!used });
});

app.post('/api/admin/upload', adminRequired, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecione uma imagem.' });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});
app.get('/api/admin/settings', adminRequired, (_req, res) => res.json(getSettings()));
app.put('/api/admin/settings', adminRequired, (req, res) => {
  const allowed = ['brand_name','tagline','hero_text','whatsapp','instagram','delivery_mode','delivery_fee_cents','delivery_enabled','pickup_enabled','payment_methods','about_text','announcement'];
  const incoming = req.body || {};
  const values = {};
  for (const key of allowed) if (Object.prototype.hasOwnProperty.call(incoming, key)) values[key] = cleanText(incoming[key], 3000);
  if (values.whatsapp && !/^\d{10,15}$/.test(values.whatsapp)) return res.status(400).json({ error: 'WhatsApp deve conter somente números, com código do país e DDD.' });
  saveSettings(values);
  res.json(getSettings());
});
app.get('/api/admin/orders', adminRequired, (_req, res) => {
  const rows = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 300').all();
  res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items_json), items_json: undefined })));
});
app.patch('/api/admin/orders/:id', adminRequired, (req, res) => {
  const allowed = ['Novo', 'Em atendimento', 'Confirmado', 'Concluído', 'Cancelado'];
  const status = cleanText(req.body?.status, 40);
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Status inválido.' });
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, Number(req.params.id));
  res.json({ ok: true });
});

app.get('/admin', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.use((err, _req, res, _next) => {
  console.error(err);
  const message = err.message && err.message.includes('Envie uma imagem') ? err.message : 'Ocorreu um erro ao processar sua solicitação.';
  res.status(400).json({ error: message });
});

app.listen(PORT, () => console.log(`TN Velas e Aromas disponível em http://localhost:${PORT}`));
