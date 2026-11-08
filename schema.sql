CREATE DATABASE IF NOT EXISTS thiranex_store
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE thiranex_store;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sessions_user_id (user_id),
  INDEX idx_sessions_expires_at (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'Everyday',
  image_url VARCHAR(1000) NOT NULL DEFAULT '',
  price DECIMAL(10, 2) NOT NULL,
  stock INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  total DECIMAL(10, 2) NOT NULL,
  status ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled')
    NOT NULL DEFAULT 'pending',
  shipping_name VARCHAR(120) NOT NULL,
  shipping_address VARCHAR(255) NOT NULL,
  shipping_city VARCHAR(120) NOT NULL,
  shipping_postal_code VARCHAR(30) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_orders_user_created (user_id, created_at),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  product_name VARCHAR(180) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price DECIMAL(10, 2) NOT NULL,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id)
    REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id)
    REFERENCES products(id) ON DELETE SET NULL
);

INSERT INTO products (name, description, category, image_url, price, stock)
SELECT 'Everyday Ceramic Mug', 'A thoughtfully shaped stoneware mug for slow mornings and long conversations.', 'Home', 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=900&q=85', 24.00, 32
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Everyday Ceramic Mug');

INSERT INTO products (name, description, category, image_url, price, stock)
SELECT 'Linen Market Tote', 'Roomy, durable linen with comfortable handles for market days and everyday errands.', 'Accessories', 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=85', 38.00, 18
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Linen Market Tote');

INSERT INTO products (name, description, category, image_url, price, stock)
SELECT 'Soft Knit Throw', 'A cozy, breathable layer made for evenings on the sofa and quiet Sunday mornings.', 'Home', 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=900&q=85', 86.00, 12
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Soft Knit Throw');

INSERT INTO products (name, description, category, image_url, price, stock)
SELECT 'Daily Ritual Candle', 'A hand-poured soy candle with warm cedar, soft amber, and a clean cotton wick.', 'Wellness', 'https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=900&q=85', 32.00, 26
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Daily Ritual Candle');

INSERT INTO products (name, description, category, image_url, price, stock)
SELECT 'Sunday Ceramic Vase', 'An organic sculptural silhouette finished by hand in a soft, natural glaze.', 'Home', 'https://images.unsplash.com/photo-1578500494198-246f612d3b3d?auto=format&fit=crop&w=900&q=85', 54.00, 9
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Sunday Ceramic Vase');

INSERT INTO products (name, description, category, image_url, price, stock)
SELECT 'Canvas Weekender', 'A considered carryall with sturdy canvas, an interior pocket, and room for a little more.', 'Accessories', 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=85', 72.00, 14
WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Canvas Weekender');
