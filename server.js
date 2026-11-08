const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
const port = Number(process.env.PORT) || 3000;
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const sessionCookie = 'thiranex_session';
const allowedOrderStatuses = new Set([
  'pending',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
]);

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'thiranex_store',
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: false,
});

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((req, _res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    req.body = {};
  }
  next();
});
app.use((req, _res, next) => {
  req.cookies = Object.fromEntries((req.headers.cookie || '').split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf('=');
      return separator < 0
        ? [part, '']
        : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
    }));
  next();
});

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function derivePasswordKey(password, salt) {
  return new Promise((resolve, reject) => {
    const pepper = Buffer.from(process.env.PASSWORD_PEPPER || '');
    crypto.scrypt(password, Buffer.concat([salt, pepper]), 64, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}

async function makePasswordHash(password) {
  const salt = crypto.randomBytes(16);
  const key = await derivePasswordKey(password, salt);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

async function passwordMatches(password, savedHash) {
  const [saltHex, keyHex] = savedHash.split(':');
  if (!/^[a-f0-9]{32}$/.test(saltHex) || !/^[a-f0-9]{128}$/.test(keyHex)) {
    return false;
  }
  const expected = Buffer.from(keyHex, 'hex');
  const candidate = await derivePasswordKey(password, Buffer.from(saltHex, 'hex'));
  return crypto.timingSafeEqual(expected, candidate);
}

function setSessionCookie(res, token) {
  res.cookie(sessionCookie, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: sessionLifetimeMs,
    path: '/',
  });
}

async function issueSession(userId, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);
  await pool.execute(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    [hash(token), userId, expiresAt],
  );
  setSessionCookie(res, token);
}

app.use(async (req, res, next) => {
  const token = req.cookies?.[sessionCookie];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    next();
    return;
  }

  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.role, s.token_hash
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > NOW()
       LIMIT 1`,
      [hash(token)],
    );
    if (rows.length) {
      req.user = rows[0];
      req.sessionTokenHash = rows[0].token_hash;
    }
    next();
  } catch (error) {
    next(error);
  }
});

function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: 'Please sign in to continue.' });
    return;
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access is required.' });
    return;
  }
  next();
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function validateProduct(body) {
  const name = cleanText(body.name, 180);
  const description = cleanText(body.description, 5000);
  const category = cleanText(body.category, 80) || 'Everyday';
  const imageUrl = cleanText(body.imageUrl, 1000);
  const price = Number(body.price);
  const stock = Number(body.stock);
  if (!name || !description || !Number.isFinite(price) || price <= 0 || price > 99999999.99 ||
      !Number.isInteger(stock) || stock < 0 || stock > 1000000) {
    return null;
  }
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
    return null;
  }
  return { name, description, category, imageUrl, price: price.toFixed(2), stock };
}

app.get('/api/me', (req, res) => {
  res.json({ user: req.user ? {
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
  } : null });
});

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name, 120);
  const email = cleanText(req.body.email, 255).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 8 || password.length > 128) {
    res.status(400).json({ error: 'Enter your name, a valid email, and a password of at least 8 characters.' });
    return;
  }

  try {
    const passwordHash = await makePasswordHash(password);
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name, email, passwordHash],
    );
    await issueSession(result.insertId, res);
    res.status(201).json({ user: { id: result.insertId, name, email, role: 'user' } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'An account with that email already exists.' });
      return;
    }
    throw error;
  }
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = cleanText(req.body.email, 255).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const [users] = await pool.execute(
    'SELECT id, name, email, password_hash, role FROM users WHERE email = ? LIMIT 1',
    [email],
  );
  if (!users.length || !(await passwordMatches(password, users[0].password_hash))) {
    res.status(401).json({ error: 'Email or password is incorrect.' });
    return;
  }

  if (req.sessionTokenHash) {
    await pool.execute('DELETE FROM sessions WHERE token_hash = ?', [req.sessionTokenHash]);
  }
  const user = users[0];
  await issueSession(user.id, res);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  if (req.sessionTokenHash) {
    await pool.execute('DELETE FROM sessions WHERE token_hash = ?', [req.sessionTokenHash]);
  }
  res.clearCookie(sessionCookie, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  res.json({ ok: true });
}));

app.get('/api/products', asyncRoute(async (_req, res) => {
  const [products] = await pool.execute(
    `SELECT id, name, description, category, image_url AS imageUrl, price, stock
     FROM products ORDER BY created_at DESC, id DESC`,
  );
  res.json({ products });
}));

app.post('/api/admin/products', requireAdmin, asyncRoute(async (req, res) => {
  const product = validateProduct(req.body);
  if (!product) {
    res.status(400).json({ error: 'Provide a name, description, positive price, valid stock, and an http(s) image URL.' });
    return;
  }
  const [result] = await pool.execute(
    `INSERT INTO products (name, description, category, image_url, price, stock)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [product.name, product.description, product.category, product.imageUrl, product.price, product.stock],
  );
  res.status(201).json({ product: { id: result.insertId, ...product, imageUrl: product.imageUrl } });
}));

app.patch('/api/admin/products/:id', requireAdmin, asyncRoute(async (req, res) => {
  const product = validateProduct(req.body);
  if (!product) {
    res.status(400).json({ error: 'Provide a name, description, positive price, valid stock, and an http(s) image URL.' });
    return;
  }
  const [result] = await pool.execute(
    `UPDATE products
     SET name = ?, description = ?, category = ?, image_url = ?, price = ?, stock = ?
     WHERE id = ?`,
    [product.name, product.description, product.category, product.imageUrl, product.price, product.stock, req.params.id],
  );
  if (!result.affectedRows) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  res.json({ product: { id: Number(req.params.id), ...product } });
}));

app.delete('/api/admin/products/:id', requireAdmin, asyncRoute(async (req, res) => {
  const [result] = await pool.execute('DELETE FROM products WHERE id = ?', [req.params.id]);
  if (!result.affectedRows) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  res.json({ ok: true });
}));

app.post('/api/orders', requireAuth, asyncRoute(async (req, res) => {
  const shipping = req.body.shipping || {};
  const shippingName = cleanText(shipping.name, 120);
  const shippingAddress = cleanText(shipping.address, 255);
  const shippingCity = cleanText(shipping.city, 120);
  const shippingPostalCode = cleanText(shipping.postalCode, 30);
  const rawItems = req.body.items;
  if (!shippingName || !shippingAddress || !shippingCity || !shippingPostalCode ||
      !Array.isArray(rawItems) || !rawItems.length || rawItems.length > 30) {
    res.status(400).json({ error: 'Add items and complete all shipping fields before checkout.' });
    return;
  }

  const quantities = new Map();
  for (const item of rawItems) {
    const productId = Number(item.productId);
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(productId) || productId <= 0 ||
        !Number.isInteger(quantity) || quantity <= 0 || quantity > 99) {
      res.status(400).json({ error: 'One or more cart items are invalid.' });
      return;
    }
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }
  if ([...quantities.values()].some((quantity) => quantity > 99)) {
    res.status(400).json({ error: 'You can order up to 99 of each item.' });
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const ids = [...quantities.keys()];
    const [products] = await connection.query(
      'SELECT id, name, price, stock FROM products WHERE id IN (?) FOR UPDATE',
      [ids],
    );
    if (products.length !== ids.length) {
      await connection.rollback();
      res.status(400).json({ error: 'A product in your cart is no longer available.' });
      return;
    }

    let totalCents = 0;
    const orderItems = products.map((product) => {
      const quantity = quantities.get(Number(product.id));
      if (quantity > product.stock) {
        throw Object.assign(new Error(`${product.name} has only ${product.stock} left in stock.`), {
          status: 409,
        });
      }
      const unitPriceCents = Math.round(Number(product.price) * 100);
      totalCents += unitPriceCents * quantity;
      return {
        productId: product.id,
        name: product.name,
        quantity,
        unitPrice: product.price,
      };
    });

    const [orderResult] = await connection.execute(
      `INSERT INTO orders
       (user_id, total, shipping_name, shipping_address, shipping_city, shipping_postal_code)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, (totalCents / 100).toFixed(2), shippingName, shippingAddress, shippingCity, shippingPostalCode],
    );
    for (const item of orderItems) {
      await connection.execute(
        'INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)',
        [orderResult.insertId, item.productId, item.name, item.quantity, item.unitPrice],
      );
      await connection.execute(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [item.quantity, item.productId],
      );
    }
    await connection.commit();
    res.status(201).json({ order: { id: orderResult.insertId, total: (totalCents / 100).toFixed(2), status: 'pending' } });
  } catch (error) {
    await connection.rollback();
    if (error.status) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  } finally {
    connection.release();
  }
}));

app.get('/api/orders', requireAuth, asyncRoute(async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const [orders] = isAdmin
    ? await pool.execute(
      `SELECT o.id, o.user_id AS userId, u.name AS customer, o.total, o.status,
              o.shipping_name AS shippingName, o.shipping_address AS shippingAddress,
              o.shipping_city AS shippingCity, o.shipping_postal_code AS shippingPostalCode,
              o.created_at AS createdAt
       FROM orders o JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC LIMIT 100`,
    )
    : await pool.execute(
      `SELECT id, total, status, shipping_name AS shippingName,
              shipping_address AS shippingAddress, shipping_city AS shippingCity,
              shipping_postal_code AS shippingPostalCode, created_at AS createdAt
       FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.user.id],
    );
  if (orders.length) {
    const [items] = await pool.query(
      `SELECT order_id AS orderId, product_name AS name, quantity, unit_price AS unitPrice
       FROM order_items WHERE order_id IN (?) ORDER BY id`,
      [orders.map((order) => order.id)],
    );
    const byOrderId = new Map(orders.map((order) => [String(order.id), []]));
    for (const item of items) {
      byOrderId.get(String(item.orderId)).push(item);
    }
    for (const order of orders) {
      order.items = byOrderId.get(String(order.id));
    }
  }
  res.json({ orders });
}));

app.patch('/api/admin/orders/:id', requireAdmin, asyncRoute(async (req, res) => {
  const status = req.body.status;
  if (!allowedOrderStatuses.has(status)) {
    res.status(400).json({ error: 'Choose a valid order status.' });
    return;
  }
  const [result] = await pool.execute('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
  if (!result.affectedRows) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  res.json({ ok: true });
}));

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

app.use(express.static(path.join(__dirname, 'public')));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) {
    return;
  }
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

async function prepareAdminAccount() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email && !password) {
    return;
  }
  if (!email || !password || password.length < 12) {
    throw new Error('Set both ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters.');
  }
  const [existing] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing.length) {
    await pool.execute('UPDATE users SET role = ? WHERE id = ?', ['admin', existing[0].id]);
    return;
  }
  await pool.execute(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    ['Store Admin', email, await makePasswordHash(password), 'admin'],
  );
}

async function start() {
  await pool.query('SELECT 1');
  await prepareAdminAccount();
  app.listen(port, () => {
    console.log(`Thiranex Store is running at http://localhost:${port}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Unable to start the store:', error);
    process.exitCode = 1;
  });
}

module.exports = { app, pool };
