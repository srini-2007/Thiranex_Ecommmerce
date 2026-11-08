# Thiranex Store

A responsive e-commerce storefront with product management, customer accounts, order tracking, and a MySQL-backed API.

## Requirements

- Node.js 18 or newer
- MySQL 8 or newer

## Run locally

1. Install the project dependencies:

   ```sh
   npm install
   ```

2. Create the database, tables, and sample products:

   ```sh
   mysql -u root -p < schema.sql
   ```

3. Configure the database and optional admin account in your shell:

   ```powershell
   $env:DB_HOST = "127.0.0.1"
   $env:DB_PORT = "3306"
   $env:DB_USER = "root"
   $env:DB_PASSWORD = "your-mysql-password"
   $env:DB_NAME = "thiranex_store"
   $env:ADMIN_EMAIL = "admin@example.com"
   $env:ADMIN_PASSWORD = "use-a-unique-password-of-at-least-12-characters"
   npm start
   ```

   `DB_HOST`, `DB_PORT`, `DB_USER`, and `DB_NAME` have local defaults. Set `DB_PASSWORD` for your MySQL installation. `ADMIN_EMAIL` and `ADMIN_PASSWORD` must be set together; on startup, the configured account is created if needed and granted the admin role.

4. Open [http://localhost:3000](http://localhost:3000). Customers can create an account from the sign-in dialog. Admins can add/edit/remove products and update order statuses from the store interface.

For production, set `NODE_ENV=production` so session cookies are marked secure, use HTTPS, use a unique `PASSWORD_PEPPER` secret, and provide database/admin credentials via the deployment environment rather than committing them. Password hashes use scrypt with a per-account random salt; keep the pepper unchanged after accounts have been created.

## API overview

- `GET /api/products` — list products
- `GET /api/me` — current signed-in user
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- `POST /api/orders` — place an order (signed-in customers; stock checked and decremented transactionally)
- `GET /api/orders` — customer order history or admin order list
- `POST /api/admin/products`, `PATCH /api/admin/products/:id`, `DELETE /api/admin/products/:id`
- `PATCH /api/admin/orders/:id` — update an order status

Admin endpoints require a signed-in user whose role is `admin`. Opaque session tokens are random, HttpOnly cookies and only their SHA-256 hashes are stored in MySQL.
