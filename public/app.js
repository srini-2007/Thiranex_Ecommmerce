const state = {
  products: [],
  user: null,
  cart: loadCart(),
  category: 'All',
  search: '',
  authMode: 'login',
};

const productGrid = document.querySelector('#product-grid');
const categoryList = document.querySelector('#category-list');
const cartPanel = document.querySelector('#cart-panel');
const pageScrim = document.querySelector('#page-scrim');
const authDialog = document.querySelector('#auth-dialog');
const productDialog = document.querySelector('#product-dialog');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function money(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));
}

function loadCart() {
  try {
    const saved = JSON.parse(localStorage.getItem('thiranex-cart') || '[]');
    return Array.isArray(saved) ? saved.filter((item) =>
      Number.isSafeInteger(Number(item.id)) && Number.isInteger(Number(item.quantity)) &&
      Number(item.quantity) > 0) : [];
  } catch (error) {
    console.warn('Saved cart could not be read.', error);
    return [];
  }
}

function saveCart() {
  localStorage.setItem('thiranex-cart', JSON.stringify(state.cart));
  renderCart();
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'The request could not be completed.');
  }
  return data;
}

function showMessage(element, message, isError = true) {
  element.textContent = message;
  element.hidden = false;
  element.classList.toggle('success-message', !isError);
}

function hideMessage(element) {
  element.hidden = true;
  element.textContent = '';
  element.classList.remove('success-message');
}

async function loadProducts() {
  const { products } = await api('/api/products');
  state.products = products;
  renderCategories();
  renderProducts();
  renderCart();
}

async function loadUser() {
  const { user } = await api('/api/me');
  state.user = user;
  updateAccountButton();
}

function updateAccountButton() {
  const button = document.querySelector('#account-button');
  button.textContent = state.user ? `Hi, ${state.user.name.split(' ')[0]}` : 'Sign in';
  button.title = state.user ? 'Open your account options' : 'Sign in or create an account';
  button.onclick = () => {
    if (state.user) {
      showAccountMenu();
    } else {
      openAuthDialog('login');
    }
  };
  document.querySelector('#orders-title').textContent =
    state.user?.role === 'admin' ? 'All orders' : 'Your orders';
}

function showAccountMenu() {
  const shouldSignOut = window.confirm('Choose OK to sign out, or Cancel to view your orders.');
  if (shouldSignOut) {
    signOut();
    return;
  }
  showOrders();
}

async function signOut() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null;
    updateAccountButton();
    document.querySelector('#admin-section').hidden = true;
    document.querySelector('#orders-section').hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    window.alert(error.message);
  }
}

function renderCategories() {
  const categories = ['All', ...new Set(state.products.map((product) => product.category))];
  categoryList.innerHTML = categories.map((category) => `
    <button class="category-button${state.category === category ? ' active' : ''}"
      type="button" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>
  `).join('');
}

function visibleProducts() {
  return state.products.filter((product) => {
    const matchesCategory = state.category === 'All' || product.category === state.category;
    const searchable = `${product.name} ${product.description} ${product.category}`.toLowerCase();
    return matchesCategory && searchable.includes(state.search.toLowerCase());
  });
}

function renderProducts() {
  const products = visibleProducts();
  document.querySelector('#store-message').hidden = true;
  document.querySelector('#admin-section').hidden = state.user?.role !== 'admin';
  if (!products.length) {
    productGrid.innerHTML = '<p class="empty-products">Nothing here just yet. Try another search or category.</p>';
    return;
  }
  productGrid.innerHTML = products.map((product) => {
    const image = product.imageUrl || '';
    const stockText = Number(product.stock) > 0
      ? `${escapeHtml(product.category)} · ${Number(product.stock)} in stock`
      : 'Currently out of stock';
    const adminActions = state.user?.role === 'admin' ? `
      <div class="admin-product-actions">
        <button type="button" data-edit-product="${product.id}">Edit</button>
        <button type="button" data-delete-product="${product.id}">Remove</button>
      </div>` : '';
    return `
      <article class="product-card">
        <div class="product-photo">
          ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy">` : ''}
          <span class="stock-badge">${stockText}</span>
          <button class="quick-add" type="button" data-add-product="${product.id}"
            aria-label="Add ${escapeHtml(product.name)} to bag" ${Number(product.stock) < 1 ? 'disabled' : ''}>+</button>
        </div>
        <div class="product-info">
          <div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description)}</p></div>
          <span class="product-price">${money(product.price)}</span>
        </div>
        ${adminActions}
      </article>`;
  }).join('');
}

function cartProduct(item) {
  return state.products.find((product) => Number(product.id) === Number(item.id));
}

function renderCart() {
  const items = state.cart.map((item) => ({ item, product: cartProduct(item) }))
    .filter(({ product }) => product);
  state.cart = items.map(({ item }) => item);
  const quantity = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = items.reduce((sum, { item, product }) => sum + Number(product.price) * item.quantity, 0);
  document.querySelector('#cart-count').textContent = quantity;
  document.querySelector('#cart-heading-count').textContent = `(${quantity})`;
  document.querySelector('#cart-total').textContent = money(total);
  document.querySelector('#cart-empty').hidden = items.length > 0;
  document.querySelector('#checkout-form').hidden = items.length === 0;
  document.querySelector('#cart-items').innerHTML = items.map(({ item, product }) => `
    <article class="cart-row">
      ${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" alt="" loading="lazy">` : '<div></div>'}
      <div><h3>${escapeHtml(product.name)}</h3><p>${money(product.price)}</p>
        <div class="quantity-control">
          <button type="button" data-cart-change="${product.id}" data-change="-1" aria-label="Remove one">−</button>
          <span>${item.quantity}</span>
          <button type="button" data-cart-change="${product.id}" data-change="1" aria-label="Add one"
            ${item.quantity >= Number(product.stock) || item.quantity >= 99 ? 'disabled' : ''}>+</button>
        </div>
      </div>
      <span class="cart-row-price">${money(Number(product.price) * item.quantity)}</span>
    </article>
  `).join('');
}

function addToCart(productId) {
  const product = state.products.find((entry) => Number(entry.id) === Number(productId));
  if (!product || Number(product.stock) < 1) return;
  const current = state.cart.find((item) => Number(item.id) === Number(productId));
  if (current) {
    if (current.quantity >= Number(product.stock) || current.quantity >= 99) return;
    current.quantity += 1;
  } else {
    state.cart.push({ id: Number(productId), quantity: 1 });
  }
  saveCart();
}

function changeCart(productId, change) {
  const item = state.cart.find((entry) => Number(entry.id) === Number(productId));
  const product = state.products.find((entry) => Number(entry.id) === Number(productId));
  if (!item) return;
  item.quantity += change;
  if (item.quantity <= 0) {
    state.cart = state.cart.filter((entry) => Number(entry.id) !== Number(productId));
  } else if (item.quantity > Number(product?.stock) || item.quantity > 99) {
    item.quantity = Math.min(Number(product?.stock) || 0, 99);
  }
  saveCart();
}

function openCart() {
  cartPanel.classList.add('open');
  pageScrim.classList.add('visible');
}

function closeCart() {
  cartPanel.classList.remove('open');
  pageScrim.classList.remove('visible');
}

function openAuthDialog(mode) {
  setAuthMode(mode);
  hideMessage(document.querySelector('#auth-message'));
  authDialog.showModal();
}

function setAuthMode(mode) {
  state.authMode = mode;
  const isRegister = mode === 'register';
  document.querySelector('#auth-name-field').hidden = !isRegister;
  document.querySelector('#auth-name').required = isRegister;
  document.querySelector('#auth-password').autocomplete = isRegister ? 'new-password' : 'current-password';
  document.querySelector('#auth-title').textContent = isRegister ? 'Your own little corner.' : 'A little more you.';
  document.querySelector('#auth-intro').textContent = isRegister
    ? 'Create an account to keep your orders and little finds together.'
    : 'Sign in to find your orders and keep your favorites close.';
  document.querySelector('#auth-submit').innerHTML = `${isRegister ? 'Create account' : 'Sign in'} <span aria-hidden="true">↗</span>`;
  document.querySelectorAll('.auth-tab').forEach((tab) =>
    tab.classList.toggle('active', tab.dataset.authMode === mode));
}

async function showOrders() {
  try {
    const { orders } = await api('/api/orders');
    const isAdmin = state.user?.role === 'admin';
    document.querySelector('#admin-section').hidden = !isAdmin;
    document.querySelector('#orders-section').hidden = isAdmin;
    if (isAdmin) {
      renderOrders(orders, document.querySelector('#admin-orders'), true);
    } else {
      renderOrders(orders, document.querySelector('#orders-list'), false);
    }
    (isAdmin ? document.querySelector('#admin-section') : document.querySelector('#orders-section'))
      .scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    window.alert(error.message);
  }
}

function renderOrders(orders, container, isAdmin) {
  if (!orders.length) {
    container.innerHTML = '<p class="empty-products">No orders yet. Your next favorite might be just around the corner.</p>';
    return;
  }
  const statuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
  container.innerHTML = orders.map((order) => `
    <article class="order-card">
      <div>
        <h3>Order #${escapeHtml(order.id)}${isAdmin ? ` · ${escapeHtml(order.customer)}` : ''}</h3>
        <p>Placed ${new Date(order.createdAt).toLocaleDateString()} · Delivering to
          ${escapeHtml(order.shippingName)}, ${escapeHtml(order.shippingAddress)}, ${escapeHtml(order.shippingCity)}
          ${escapeHtml(order.shippingPostalCode)}</p>
        <p class="order-items">${order.items.map((item) =>
          `${escapeHtml(item.name)} × ${Number(item.quantity)}`).join(' · ')}</p>
        ${isAdmin ? `<label class="sr-only" for="order-status-${escapeHtml(order.id)}">Order status</label>
          <select id="order-status-${escapeHtml(order.id)}" data-order-status="${escapeHtml(order.id)}">
            ${statuses.map((status) => `<option value="${status}" ${status === order.status ? 'selected' : ''}>${status}</option>`).join('')}
          </select>` : ''}
      </div>
      <div class="order-total"><span class="order-status">${escapeHtml(order.status)}</span><p>${money(order.total)}</p></div>
    </article>
  `).join('');
}

function openProductEditor(product = null) {
  const form = document.querySelector('#product-form');
  form.reset();
  form.elements.id.value = product?.id || '';
  form.elements.name.value = product?.name || '';
  form.elements.description.value = product?.description || '';
  form.elements.category.value = product?.category || '';
  form.elements.price.value = product?.price || '';
  form.elements.stock.value = product?.stock ?? 0;
  form.elements.imageUrl.value = product?.imageUrl || '';
  document.querySelector('#product-dialog-title').textContent = product ? 'A little update.' : 'Add a product';
  hideMessage(document.querySelector('#product-message'));
  productDialog.showModal();
}

async function handleCheckout(event) {
  event.preventDefault();
  const message = document.querySelector('#checkout-message');
  hideMessage(message);
  if (!state.user) {
    closeCart();
    openAuthDialog('login');
    showMessage(document.querySelector('#auth-message'), 'Sign in or create an account, then come back to your bag.');
    return;
  }
  const button = document.querySelector('#checkout-button');
  button.disabled = true;
  try {
    const formData = new FormData(event.currentTarget);
    const { order } = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        items: state.cart.map((item) => ({ productId: item.id, quantity: item.quantity })),
        shipping: Object.fromEntries(formData.entries()),
      }),
    });
    state.cart = [];
    saveCart();
    await loadProducts();
    showMessage(message, `Order #${order.id} is in. We'll take good care of it.`, false);
    event.currentTarget.reset();
  } catch (error) {
    showMessage(message, error.message);
  } finally {
    button.disabled = false;
  }
}

document.querySelector('#cart-jump').addEventListener('click', openCart);
document.querySelector('#close-cart').addEventListener('click', closeCart);
pageScrim.addEventListener('click', closeCart);
categoryList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  state.category = button.dataset.category;
  renderCategories();
  renderProducts();
});
document.querySelector('#search-input').addEventListener('input', (event) => {
  state.search = event.target.value;
  renderProducts();
});
productGrid.addEventListener('click', async (event) => {
  const addButton = event.target.closest('[data-add-product]');
  if (addButton) addToCart(addButton.dataset.addProduct);
  const editButton = event.target.closest('[data-edit-product]');
  if (editButton) {
    const product = state.products.find((entry) => Number(entry.id) === Number(editButton.dataset.editProduct));
    if (product) openProductEditor(product);
  }
  const deleteButton = event.target.closest('[data-delete-product]');
  if (deleteButton && window.confirm('Remove this product from the shop?')) {
    try {
      await api(`/api/admin/products/${deleteButton.dataset.deleteProduct}`, { method: 'DELETE' });
      state.cart = state.cart.filter((item) => Number(item.id) !== Number(deleteButton.dataset.deleteProduct));
      await loadProducts();
    } catch (error) {
      window.alert(error.message);
    }
  }
});
document.querySelector('#cart-items').addEventListener('click', (event) => {
  const button = event.target.closest('[data-cart-change]');
  if (button) changeCart(Number(button.dataset.cartChange), Number(button.dataset.change));
});
document.querySelector('#checkout-form').addEventListener('submit', handleCheckout);
document.querySelectorAll('.auth-tab').forEach((tab) => tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode)));
document.querySelector('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const message = document.querySelector('#auth-message');
  hideMessage(message);
  try {
    const { user } = await api(`/api/auth/${state.authMode}`, {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(formData.entries())),
    });
    state.user = user;
    updateAccountButton();
    authDialog.close();
    event.currentTarget.reset();
    renderProducts();
    if (user.role === 'admin') {
      await showOrders();
    }
    if (state.cart.length) openCart();
  } catch (error) {
    showMessage(message, error.message);
  }
});
document.querySelectorAll('[data-close-dialog]').forEach((button) =>
  button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelector('#add-product-button').addEventListener('click', () => openProductEditor());
document.querySelector('#product-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const values = Object.fromEntries(formData.entries());
  const id = values.id;
  delete values.id;
  values.price = Number(values.price);
  values.stock = Number(values.stock);
  const message = document.querySelector('#product-message');
  hideMessage(message);
  try {
    await api(id ? `/api/admin/products/${id}` : '/api/admin/products', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(values),
    });
    productDialog.close();
    await loadProducts();
  } catch (error) {
    showMessage(message, error.message);
  }
});
document.querySelector('#admin-orders').addEventListener('change', async (event) => {
  const select = event.target.closest('[data-order-status]');
  if (!select) return;
  try {
    await api(`/api/admin/orders/${select.dataset.orderStatus}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: select.value }),
    });
    await showOrders();
  } catch (error) {
    window.alert(error.message);
  }
});
document.querySelector('#close-orders').addEventListener('click', () => {
  document.querySelector('#orders-section').hidden = true;
  document.querySelector('#admin-section').hidden = state.user?.role !== 'admin';
  document.querySelector('#shop').scrollIntoView({ behavior: 'smooth' });
});
document.querySelectorAll('[data-category-link]').forEach((link) => link.addEventListener('click', () => {
  state.category = link.dataset.categoryLink;
  renderCategories();
  renderProducts();
}));

Promise.all([loadProducts(), loadUser()])
  .then(() => {
    renderProducts();
    renderCart();
  })
  .catch((error) => {
    console.error('The store could not be loaded.', error);
    const message = document.querySelector('#store-message');
    showMessage(message, 'We could not load the store. Please refresh the page in a moment.');
    message.hidden = false;
  });
