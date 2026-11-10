import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, Branch, decodeRole, MenuItem, money, Order, OrderSummary, Session } from './api';
import { OrderMonitor } from './OrderMonitor';

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
  const [pollError, setPollError] = useState('');
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
    api.branches(token).then((items) => { setBranches(items); setBranchId((current) => decodeRole(token)?.branchId || current || items[0]?.id || ''); }).catch((reason) => setError(String(reason.message ?? reason)));
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
    const orderId = order.id;
    let stopped = false;
    let timer: number;
    const poll = async () => {
      try {
        const latest = await api.order(token, orderId);
        if (!stopped) { setOrder((current) => current?.id === orderId ? latest : current); setPollError(''); }
      } catch (reason: any) {
        if (!stopped) setPollError(reason.message ?? String(reason));
      } finally {
        if (!stopped) timer = window.setTimeout(() => void poll(), 800);
      }
    };
    timer = window.setTimeout(() => void poll(), 800);
    return () => { stopped = true; window.clearTimeout(timer); };
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
    setToken(''); setRefreshToken(''); setUserEmail(''); setOrder(undefined); setCart({}); setNotice(''); setError(''); setPollError('');
  }

  async function submitOrder(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice(''); setLoading(true);
    try { const items = Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([productId, quantity]) => ({ productId, quantity })); if (!items.length) throw new Error('Agrega al menos un producto'); const created = await api.createOrder(token, { branchId, items, paymentToken }, crypto.randomUUID()); setOrder(created); setPollError(''); setOrderIdInput(created.id); setCart({}); await refreshOrders(); }
    catch (reason: any) { setError(reason.message ?? String(reason)); }
    finally { setLoading(false); }
  }

  async function consultOrder(orderId: string) {
    setError(''); setNotice('');
    if (!orderId) { setError('Escribe el ID completo del pedido'); return; }
    try {
      const found = await api.order(token, orderId);
      setOrder(found); setPollError(''); setOrderIdInput(found.id);
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
    <header className="app-header">
      <div className="brand-lockup"><div className="brand-icon" aria-hidden="true">P</div><div><p className="eyebrow">MIS-708 · SISTEMA DISTRIBUIDO</p><h1>Pedidos</h1><p className="header-subtitle">Catálogo, saga y cobro distribuido.</p></div></div>
      <span className="session-pill"><i className="live-dot" />{token ? `Sesión ${role?.role ?? 'usuario'}` : 'Sin sesión'}</span>
    </header>
    <div className="architecture-strip" aria-label="Arquitectura principal"><span>REST: React → ms-pedidos ↔ ms-catalogo</span><b>·</b><span>EVENTOS: ms-pedidos ↔ Kafka ↔ ms-pagos</span><b>·</b><span>HTTP: ms-pagos → pasarela-stub</span></div>
    {!token ? <section className="card auth">
      <div><p className="section-kicker">Acceso</p><h2>{authMode === 'login' ? 'Iniciar sesión' : 'Crear cuenta de cliente'}</h2><p>El JWT identifica el rol. Para demostrar la saga usa después un token opaco de pago.</p><p className="hint">Cliente demo: <code>cliente@demo.local</code> / <code>cliente123</code></p><p className="hint">Sucursal demo: <code>sucursal@demo.local</code> / <code>sucursal123</code></p></div>
      <form onSubmit={submitAuth}><label>Correo electrónico<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Contraseña<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="primary" disabled={loading}>{loading ? 'Procesando…' : authMode === 'login' ? 'Ingresar' : 'Registrarme'}</button><button type="button" className="link-button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setError(''); }}>{authMode === 'login' ? 'Crear una cuenta nueva' : 'Ya tengo una cuenta'}</button></form>
    </section> : <>
      <section className="card session-bar"><span>Sesión iniciada como <strong>{userEmail}</strong></span><button type="button" className="secondary" onClick={() => void logout()}>Cerrar sesión</button></section>
      <section className="grid two">
        <div className="card menu-card"><div className="section-heading"><div><p className="section-kicker">ms-catalogo</p><h2>Menú de la sucursal</h2></div><span className="mini-count">{menu.length} productos</span></div>
          <div className="menu-toolbar"><label>Sucursal<select value={branchId} disabled={role?.role === 'sucursal'} onChange={(event) => { setBranchId(event.target.value); setCart({}); }}>{branches.filter((branch) => role?.role !== 'sucursal' || branch.id === role.branchId).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><button type="button" className="secondary" onClick={() => void refreshMenu()} title="Consulta el stock actual en ms-catalogo">Recargar stock</button></div>
          <p className="hint">Disponible = stock total menos unidades reservadas.</p>
          <div className="menu">{menu.map((item) => <article className="menu-item" key={item.id}><div><strong>{item.name}</strong><p>{item.description}</p><span>{money(item.priceCents, item.currency)} <i>·</i> {item.availableStock} disponibles</span></div>{role?.role === 'cliente' && <div className="quantity"><button type="button" aria-label={`Quitar ${item.name}`} onClick={() => remove(item)}>−</button><b>{cart[item.id] ?? 0}</b><button type="button" aria-label={`Agregar ${item.name}`} disabled={!item.availableStock || (cart[item.id] ?? 0) >= item.availableStock} onClick={() => add(item)}>+</button></div>}</article>)}</div>
        </div>
        {role?.role === 'cliente' ? <div className="card checkout-card"><p className="section-kicker">ms-pedidos → Kafka → ms-pagos</p><h2>Crear pedido</h2><p>Elige un resultado de demostración. Verás la reserva, el cobro y la decisión final en el monitor.</p>
          <div className="demo-options" role="group" aria-label="Escenario de pago"><button type="button" className={paymentToken === 'tok_demo_aprobado' ? 'selected' : ''} onClick={() => setPaymentToken('tok_demo_aprobado')}>Aprobar</button><button type="button" className={paymentToken === 'tok_reject' ? 'selected' : ''} onClick={() => setPaymentToken('tok_reject')}>Rechazar</button><button type="button" className={paymentToken === 'tok_error' ? 'selected' : ''} onClick={() => setPaymentToken('tok_error')}>Error de pasarela</button></div>
          <form onSubmit={submitOrder}><label>Token opaco de pago<input required value={paymentToken} onChange={(event) => setPaymentToken(event.target.value)} /></label><p className="hint">Es un token de prueba de la pasarela, distinto del JWT de sesión.</p><div className="total"><span>Total estimado</span><strong>{money(total)}</strong></div><button className="primary" disabled={loading || !branchId}>{loading ? 'Enviando…' : 'Crear y seguir pedido'}</button></form>
          <p className="checkout-footnote">El total definitivo lo calcula Catálogo al reservar. El pedido aparece primero como pendiente.</p>
        </div> : <div className="card branch-card"><p className="section-kicker">Vista de sucursal</p><h2>Operación de sucursal</h2><p>Consulta los pedidos de tu sucursal y administra precios, productos y existencias.</p><div className="branch-callout">La sucursal no crea pedidos. Puedes abrir cualquiera de los pedidos de esta sucursal desde la lista inferior para ver su historial.</div></div>}
      </section>
      {order && <OrderMonitor order={order} pollError={pollError} onRefresh={() => void consultOrder(order.id)} />}
      <section className="card"><div className="section-heading"><div><p className="section-kicker">ms-pedidos</p><h2>Consultar pedido</h2></div></div><p className="hint">Pega el UUID completo o selecciona un pedido de la lista.</p><form className="inline-form" onSubmit={searchOrder}><input className="order-id-input" value={orderIdInput} onChange={(event) => setOrderIdInput(event.target.value)} placeholder="ID completo del pedido" aria-label="ID completo del pedido" /><button type="submit">Consultar</button></form></section>
      <section className="card"><div className="section-heading"><div><p className="section-kicker">Historial de operaciones</p><h2>Pedidos realizados</h2></div><button type="button" className="secondary" onClick={() => void refreshOrders()}>Actualizar lista</button></div><p className="hint">{role?.role === 'sucursal' ? 'Pedidos asociados a tu sucursal.' : 'Pedidos creados con tu cuenta.'} Selecciona uno para seguir sus etapas.</p>{orders.length ? <div className="orders-list">{orders.map((item) => { const current = order?.id === item.id ? order : item; return <button type="button" className={`order-row ${order?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => void consultOrder(item.id)}><span><strong>{item.id}</strong><small>{new Date(item.createdAt).toLocaleString('es-BO')} · {item.itemCount} ítem(s)</small></span><span><span className={`state-pill ${current.status}`}>{current.status}</span><small>{money(current.totalCents, current.currency)}</small></span></button>; })}</div> : <p className="empty">Todavía no hay pedidos visibles.</p>}</section>
      {role?.role === 'sucursal' && <section className="card"><p className="section-kicker">ms-catalogo</p><h2>Mantenimiento de sucursal</h2><p className="hint">Selecciona un producto para actualizarlo o deja “Nuevo producto”. El stock indica la existencia total, no solo el disponible.</p><form className="inline-form product-form" onSubmit={saveProduct}><select value={selectedProductId} onChange={(event) => selectProduct(event.target.value)} aria-label="Producto a editar"><option value="">Nuevo producto</option>{menu.map((item) => <option key={item.id} value={item.id}>{item.name} · disponible {item.availableStock} / total {item.stockTotal}</option>)}</select><input required value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="Nombre" aria-label="Nombre del producto" /><input required min="1" type="number" value={productPrice} onChange={(event) => setProductPrice(event.target.value)} placeholder="Precio en centavos" aria-label="Precio en centavos" /><input required min="0" type="number" value={productStock} onChange={(event) => setProductStock(event.target.value)} placeholder="Stock total" aria-label="Stock total" /><button type="submit">Guardar producto</button></form></section>}
    </>}
    {notice && <div className="success" role="status">{notice}</div>}
    {error && <div className="alert" role="alert">{error}</div>}
  </main>;
}

export default App;
