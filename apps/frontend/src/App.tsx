import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, Branch, decodeRole, MenuItem, money, Order, OrderSummary, Session } from './api';

function App() {
  const [token, setToken] = useState(localStorage.getItem('access-token') ?? '');
  const [refreshToken, setRefreshToken] = useState(localStorage.getItem('refresh-token') ?? '');
  const [userEmail, setUserEmail] = useState(localStorage.getItem('user-email') ?? '');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [paymentToken, setPaymentToken] = useState('tok_demo_aprobado');
  const [order, setOrder] = useState<Order>();
  const [orderIdInput, setOrderIdInput] = useState('');
  const [lookupMessage, setLookupMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('cliente@demo.local');
  const [password, setPassword] = useState('cliente123');
  const [productName, setProductName] = useState('');
  const [productPrice, setProductPrice] = useState('1000');
  const [productStock, setProductStock] = useState('10');
  const [selectedProductId, setSelectedProductId] = useState('');
  const role = decodeRole(token);

  async function refreshMenu() {
    if (!token || !branchId) return;
    setError('');
    try { setMenu(await api.menu(token, branchId)); }
    catch (reason: any) { setError(reason.message ?? String(reason)); }
  }

  async function refreshOrders() {
    if (!token) return;
    try { setOrders(await api.orders(token)); }
    catch (reason: any) { setError(reason.message ?? String(reason)); }
  }

  useEffect(() => {
    if (!token) { setBranches([]); setMenu([]); setOrders([]); return; }
    api.branches(token).then((items) => { setBranches(items); setBranchId((current) => current || items[0]?.id || ''); }).catch((reason) => setError(String(reason.message ?? reason)));
    void refreshOrders();
  }, [token]);

  useEffect(() => {
    if (!token || !branchId) return;
    void refreshMenu();
  }, [token, branchId]);

  useEffect(() => {
    if (!order?.id || !['confirmado', 'rechazado'].includes(order.status)) return;
    void refreshMenu();
    void refreshOrders();
  }, [order?.id, order?.status]);

  useEffect(() => {
    if (!order?.id || !token || ['confirmado', 'rechazado'].includes(order.status)) return;
    const timer = window.setInterval(() => { api.order(token, order.id).then(setOrder).catch(() => undefined); }, 1500);
    return () => window.clearInterval(timer);
  }, [order?.id, order?.status, token]);

  const total = useMemo(() => menu.reduce((sum, item) => sum + (cart[item.id] ?? 0) * item.priceCents, 0), [menu, cart]);
  const add = (item: MenuItem) => setCart((current) => ({ ...current, [item.id]: Math.min(item.availableStock, (current[item.id] ?? 0) + 1) }));
  const remove = (item: MenuItem) => setCart((current) => ({ ...current, [item.id]: Math.max(0, (current[item.id] ?? 0) - 1) }));
  function selectProduct(productId: string) {
    setSelectedProductId(productId);
    setNotice('');
    const product = menu.find((item) => item.id === productId);
    if (product) { setProductName(product.name); setProductPrice(String(product.priceCents)); setProductStock(String(product.stockTotal)); }
    else { setProductName(''); setProductPrice('1000'); setProductStock('10'); }
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice(''); setLoading(true);
    try {
      const session = authMode === 'login' ? await api.login(email, password) : await api.register(email, password);
      saveSession(session);
    } catch (reason: any) { setError(reason.message ?? String(reason)); }
    finally { setLoading(false); }
  }

  function saveSession(session: Session) {
    localStorage.setItem('access-token', session.accessToken);
    localStorage.setItem('refresh-token', session.refreshToken);
    localStorage.setItem('user-email', session.user.email);
    setToken(session.accessToken); setRefreshToken(session.refreshToken); setUserEmail(session.user.email); setError(''); setNotice('');
  }

  async function logout() {
    try { if (refreshToken) await api.logout(refreshToken); } catch { /* La sesión local igualmente se limpia. */ }
    localStorage.removeItem('access-token'); localStorage.removeItem('refresh-token'); localStorage.removeItem('user-email');
    setToken(''); setRefreshToken(''); setUserEmail(''); setOrder(undefined); setCart({}); setNotice(''); setError('');
  }

  async function submitOrder(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice(''); setLoading(true);
    try { const items = Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([productId, quantity]) => ({ productId, quantity })); if (!items.length) throw new Error('Agrega al menos un producto'); const created = await api.createOrder(token, { branchId, items, paymentToken }, crypto.randomUUID()); setOrder(created); setOrderIdInput(created.id); setCart({}); await refreshOrders(); }
    catch (reason: any) { setError(reason.message ?? String(reason)); }
    finally { setLoading(false); }
  }

  async function consultOrder(orderId: string) {
    setError(''); setNotice(''); setLookupMessage('');
    if (!orderId) { setError('Escribe el ID completo del pedido'); return; }
    try {
      const found = await api.order(token, orderId);
      setOrder(found); setOrderIdInput(found.id); setLookupMessage(`Pedido consultado: ${found.status}`);
    } catch (reason: any) { setError(reason.message ?? String(reason)); }
  }
  async function searchOrder(event: FormEvent) { event.preventDefault(); await consultOrder(orderIdInput.trim()); }
  async function saveProduct(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice('');
    try {
      const priceCents = Number(productPrice);
      const stockTotal = Number(productStock);
      if (!productName.trim()) throw new Error('Escribe el nombre del producto');
      if (!Number.isInteger(priceCents) || priceCents <= 0) throw new Error('El precio debe ser un entero mayor que cero en centavos');
      if (!Number.isInteger(stockTotal) || stockTotal < 0) throw new Error('El stock total debe ser un entero mayor o igual a cero');
      const wasUpdate = Boolean(selectedProductId);
      await api.saveProduct(token, branchId, { productId: selectedProductId || undefined, name: productName.trim(), priceCents, stockTotal, description: 'Producto administrado desde la sucursal' });
      setNotice(wasUpdate ? 'Producto actualizado correctamente' : 'Producto creado correctamente');
      setSelectedProductId(''); setProductName('');
      await refreshMenu();
    } catch (reason: any) { setError(reason.message ?? String(reason)); }
  }

  return <main className="container">
    <header><div><p className="eyebrow">TRABAJO DE MICROSERVICIOS</p><h1>Pedidos</h1><p>Catálogo, Saga y cobro distribuido.</p></div><div className="status-dot">{token ? `Sesión: ${role?.role ?? 'usuario'}` : 'Sin sesión'}</div></header>
    {!token ? <section className="card auth"><h2>{authMode === 'login' ? 'Iniciar sesión' : 'Crear cuenta de cliente'}</h2><form onSubmit={submitAuth}><label>Correo electrónico<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Contraseña<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="primary" disabled={loading}>{loading ? 'Procesando…' : authMode === 'login' ? 'Ingresar' : 'Registrarme'}</button></form><p className="hint">Cliente demo: <code>cliente@demo.local</code> / <code>cliente123</code></p><button className="link-button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setError(''); }}>{authMode === 'login' ? 'Crear una cuenta nueva' : 'Ya tengo una cuenta'}</button></section> : <>
      <section className="card session-bar"><span>Sesión iniciada como <strong>{userEmail}</strong></span><button onClick={logout}>Cerrar sesión</button></section>
      <section className="grid two">
        <div className="card"><h2>Menú</h2><div className="menu-toolbar"><label>Sucursal<select value={branchId} onChange={(event) => setBranchId(event.target.value)}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><button type="button" onClick={() => void refreshMenu()} title="Vuelve a consultar el stock actual en ms-catalogo">Recargar stock</button></div><p className="hint">Este botón solo vuelve a consultar el menú. Para modificar stock total, selecciona un producto en Mantenimiento de sucursal.</p><div className="menu">{menu.map((item) => <article className="menu-item" key={item.id}><div><strong>{item.name}</strong><p>{item.description}</p><span>{money(item.priceCents, item.currency)} · stock {item.availableStock}</span></div>{role?.role === 'cliente' && <div className="quantity"><button onClick={() => remove(item)}>-</button><b>{cart[item.id] ?? 0}</b><button disabled={!item.availableStock || (cart[item.id] ?? 0) >= item.availableStock} onClick={() => add(item)}>+</button></div>}</article>)}</div></div>
        {role?.role === 'cliente' ? <div className="card"><h2>Crear pedido</h2><form onSubmit={submitOrder}><label>Token opaco de pago<input value={paymentToken} onChange={(event) => setPaymentToken(event.target.value)} /></label><div className="total"><span>Total</span><strong>{money(total)}</strong></div><button className="primary" disabled={loading}>{loading ? 'Enviando…' : 'Crear pedido'}</button></form>{order && <OrderStatus order={order} />}</div> : <div className="card"><h2>Operación de sucursal</h2><p>La sucursal puede consultar los pedidos de esta sucursal y mantener el catálogo, pero no crear pedidos.</p><p className="hint">Usa la lista de pedidos o pega el UUID completo para ver el historial.</p></div>}
      </section>
      <section className="card"><h2>Consultar pedido</h2><p className="hint">Pega el UUID completo del pedido, por ejemplo: <code>88e28cee-51ff-4d52-a038-4b4e71a65f</code></p><form className="inline-form" onSubmit={searchOrder}><input className="order-id-input" value={orderIdInput} onChange={(event) => { setOrderIdInput(event.target.value); setLookupMessage(''); }} placeholder="ID completo del pedido" aria-label="ID completo del pedido" /><button type="submit">Consultar</button></form>{lookupMessage && <p className="lookup-success">{lookupMessage}</p>}</section>
      <section className="card"><div className="section-heading"><h2>Pedidos realizados</h2><button type="button" onClick={() => void refreshOrders()}>Actualizar lista</button></div><p className="hint">{role?.role === 'sucursal' ? 'Pedidos asociados a tu sucursal.' : 'Pedidos creados con tu cuenta.'} Haz clic en uno para consultar su historial.</p>{orders.length ? <div className="orders-list">{orders.map((item) => <button type="button" className="order-row" key={item.id} onClick={() => void consultOrder(item.id)}><span><strong>{item.id}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.itemCount} ítem(s)</small></span><span><strong>{item.status}</strong><small>{money(item.totalCents, item.currency)}</small></span></button>)}</div> : <p className="empty">Todavía no hay pedidos visibles.</p>}</section>
      {role?.role === 'sucursal' && <section className="card"><h2>Mantenimiento de sucursal</h2><p className="hint">Selecciona un producto para actualizarlo o deja “Nuevo producto”. El stock indica la existencia total, no solo el disponible.</p><form className="inline-form" onSubmit={saveProduct}><select value={selectedProductId} onChange={(event) => selectProduct(event.target.value)} aria-label="Producto a editar"><option value="">Nuevo producto</option>{menu.map((item) => <option key={item.id} value={item.id}>{item.name} · disponible {item.availableStock} / total {item.stockTotal}</option>)}</select><input required value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="Nombre" /><input required min="1" type="number" value={productPrice} onChange={(event) => setProductPrice(event.target.value)} placeholder="Precio en centavos" /><input required min="0" type="number" value={productStock} onChange={(event) => setProductStock(event.target.value)} placeholder="Stock total" /><button type="submit">Guardar producto</button></form></section>}
    </>}
    {notice && <div className="success">{notice}</div>}
    {error && <div className="alert">{error}</div>}
  </main>;
}

function OrderStatus({ order }: { order: Order }) { return <div className={`order-status ${order.status}`}><div className="status-line"><span>Pedido {order.id}</span><strong>{order.status}</strong></div><p>{order.rejectionReason ?? `Paso interno: ${order.internalStatus}`}</p><ol>{order.history.map((entry, index) => <li key={`${entry.createdAt}-${index}`}><strong>{entry.toStatus}</strong> · {entry.reason}<small>{new Date(entry.createdAt).toLocaleString()}</small></li>)}</ol></div>; }

export default App;
