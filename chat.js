/* Voz Refrichile — CHAT (02-10-2026). Humberto: "un chat bot que tenga toda la informacion y razones", y "sin incurrir
   en gastos": la misma cabeza que la esfera (cerebro.js + motor.js + analisis.js), pero en una pantalla de conversacion
   con historial, tarjetas y preguntas sugeridas. Todo se calcula en el telefono; no hay IA pagada. Comparte el enlace,
   la copia de datos y la cola de escrituras con la esfera (almacen 'voz_'). */
(function () {
  'use strict';
  var API = 'https://script.google.com/macros/s/AKfycbw4Ax55jS8OKCvICEFsbYSiOWvlbgcuboILiwc4VYq92y_IcrgbMBnAK1LEUKvaVa_Omg/exec', M = window.VozMotor, $ = function (id) { return document.getElementById(id); }, esc = M.esc;
  var alm = M.almacen('voz_'), datos = new M.Datos(), cartera = new M.Cartera();
  var mh = location.hash.match(/[#&]t=([A-Za-z0-9_\-]{20,})/);
  if (mh) { alm.set('t', mh[1]); history.replaceState(null, '', location.pathname + location.search); }
  var api = new M.Api({ url: API, clave: function () { return alm.get('t', ''); }, alSinClave: function () { aviso('La clave de acceso no es válida. Abre tu enlace personal de nuevo.'); } });
  var cola = new M.Cola(api, alm, { alListo: function (x, o) { cerebro.colaListo(x, o); pie(); }, alFallo: function (x) { aviso((x.a === 'tarea' ? 'No quedó guardada la tarea' : x.a === 'gestion' ? 'No quedó registrada la gestión' : 'No se pudo guardar') + ': ' + (x.txt || '') + '. Revísalo en el CRM.'); } });
  var cerebro = new window.VozCerebro({ datos: datos, cartera: cartera, api: api, cola: cola, alm: alm, clave: function () { return alm.get('t', ''); } });
  var hilo = $('hilo'), txt = $('txt'), TTS = alm.get('chat_tts', false), VOZ = null, ocupado = false, LOG = alm.get('chatlog', []);

  // ---------------------------------------------------------------- pintar
  function abajo() { hilo.scrollTop = hilo.scrollHeight; }
  function hora(ts) { return M.horaTxt(ts || Date.now()); }
  function burbuja(rol, texto, ts) {
    var d = document.createElement('div'); d.className = 'm ' + rol; d.innerHTML = esc(texto) + '<span class="hora">' + hora(ts) + '</span>'; hilo.appendChild(d); abajo(); return d;
  }
  function aviso(t) { var d = document.createElement('div'); d.className = 'aviso'; d.textContent = t; hilo.appendChild(d); abajo(); }
  function tarjeta(v, tel) {
    if (!v || (!v.filas.length && !v.nombre && !tel)) return null;
    var d = document.createElement('div'); d.className = 'card';
    d.innerHTML = '<h3><span>' + esc(v.titulo || '') + '</span>' + (v.etiqueta ? '<span class="tag">' + esc(v.etiqueta) + '</span>' : '') + '</h3>'
      + (v.nombre ? '<div class="nom">' + esc(v.nombre) + '</div>' : '')
      + (v.filas || []).map(function (f) { return '<div class="fila' + (f.rut ? ' link" data-rut="' + esc(f.rut) + '" data-n="' + esc(f.n) : '') + '"><div><div class="n">' + esc(f.n) + '</div>' + (f.s ? '<div class="s">' + esc(f.s) + '</div>' : '') + '</div><div><div class="v">' + esc(f.v) + '</div>' + (f.vs ? '<div class="vs">' + esc(f.vs) + '</div>' : '') + '</div></div>'; }).join('')
      + (v.nota ? '<div class="nota">' + esc(v.nota) + '</div>' : '') + (tel ? '<a class="tel" href="tel:' + esc(tel) + '">Llamar</a>' : '');
    d.onclick = function (ev) { var f = ev.target.closest('.fila.link'); if (f && !ocupado) atender('datos de ' + f.dataset.n); };
    hilo.appendChild(d); abajo(); return d;
  }
  function guardar(rol, texto, v, tel) {
    LOG.push({ r: rol, t: texto, ts: Date.now(), v: v ? { titulo: v.titulo, etiqueta: v.etiqueta, nombre: v.nombre, filas: v.filas.slice(0, 12), nota: v.nota } : null, tel: tel || '' });
    LOG = LOG.slice(-60); alm.set('chatlog', LOG);
  }
  function repintar() { hilo.innerHTML = ''; LOG.forEach(function (x) { burbuja(x.r, x.t, x.ts); if (x.v || x.tel) tarjeta(x.v || { titulo: '', filas: [] }, x.tel); }); }

  // ---------------------------------------------------------------- preguntas sugeridas segun quien y la hora
  function chips() {
    var h = new Date().getHours(), dia = new Date().getDay(), l = [];
    if (h < 13) l.push('cuánto me falta para la meta', 'qué tengo hoy', 'qué cotizaciones empujo hoy'); else l.push('qué cotizaciones empujo hoy', 'cuánto llevo vendido', 'qué tengo pendiente');
    if (dia === 1) l.push('clientes en riesgo'); if (dia === 5) l.push('actividad de la semana');
    if (datos.todos) l.push('cómo va cada vendedor', 'pipeline por vendedor'); else l.push('a qué ritmo voy', 'cómo está mi pipeline');
    l.push('clientes sin gestión', 'qué clientes cayeron', 'stock crítico', 'pareto de clientes', 'tasa de cierre del mes');
    $('chips').innerHTML = l.slice(0, 9).map(function (q) { return '<button type="button">' + esc(q) + '</button>'; }).join('');
  }
  $('chips').onclick = function (ev) { if (ev.target.tagName === 'BUTTON' && !ocupado) atender(ev.target.textContent); };

  // ---------------------------------------------------------------- voz
  function elegirVoz() { var vs = (window.speechSynthesis && speechSynthesis.getVoices()) || []; VOZ = vs.filter(function (v) { return /^es[-_]CL/i.test(v.lang); })[0] || vs.filter(function (v) { return /^es/i.test(v.lang); })[0] || null; }
  if (window.speechSynthesis) { elegirVoz(); speechSynthesis.onvoiceschanged = elegirVoz; }
  function decir(t) {
    if (!TTS || !window.speechSynthesis || !t) return;
    try { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(t.replace(/\$/g, '').replace(/(\d)\.(\d{3})/g, '$1$2')); u.lang = 'es-CL'; if (VOZ) u.voice = VOZ; u.rate = 1.05; speechSynthesis.speak(u); } catch (e) {}
  }
  $('tts').className = TTS ? 'on' : ''; $('tts').onclick = function () { TTS = !TTS; alm.set('chat_tts', TTS); this.className = TTS ? 'on' : ''; if (!TTS && window.speechSynthesis) speechSynthesis.cancel(); };
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, rec = null, mic = $('mic');
  if (!SR) mic.style.display = 'none';
  function escuchar() {
    if (rec) { try { rec.stop(); } catch (e) {} return; }
    if (window.speechSynthesis) speechSynthesis.cancel();
    var r = rec = new SR(); r.lang = 'es-CL'; r.interimResults = true; r.maxAlternatives = 1; r.continuous = false;
    var fin = '', parcial = '', silencio = 0, terminado = false;
    function cortar() { try { r.stop(); } catch (e) {} setTimeout(function () { if (!terminado) r.onend(); }, 1000); }
    function porSilencio() { clearTimeout(silencio); silencio = setTimeout(cortar, 1800); }
    r.onstart = function () { mic.classList.add('on'); txt.placeholder = 'Te escucho…'; porSilencio(); };
    r.onresult = function (ev) { var t = ''; for (var i = ev.resultIndex; i < ev.results.length; i++) { t += ev.results[i][0].transcript; if (ev.results[i].isFinal) fin += ev.results[i][0].transcript; } parcial = (fin || t).trim(); txt.value = parcial; porSilencio(); };
    r.onerror = function (ev) { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') aviso('Permite el micrófono para dictar.'); };
    r.onend = function () { if (terminado) return; terminado = true; clearTimeout(silencio); rec = null; mic.classList.remove('on'); txt.placeholder = 'Pregunta o dicta…'; var t = (fin || parcial || txt.value).trim(); if (t) { txt.value = ''; atender(t, true); } };
    mic.classList.add('on'); try { r.start(); } catch (e) { rec = null; mic.classList.remove('on'); }
  }
  mic.onclick = escuchar;

  // ---------------------------------------------------------------- pensar y responder
  function atender(texto, porVoz) {
    texto = String(texto || '').trim(); if (!texto || ocupado) return;
    ocupado = true; burbuja('u', texto); guardar('u', texto);
    var p = burbuja('a pensando', 'Pensando…');
    cerebro.atender(texto).then(function (r) {
      ocupado = false; p.remove();
      if (!r.dicho) return;
      burbuja('a', r.dicho); var v = r.tarjeta || null; if (v || r.tel) tarjeta(v || { titulo: '', filas: [] }, r.tel); guardar('a', r.dicho, v, r.tel);
      if (TTS || porVoz) decir(r.dicho);
      if (r.seguir) txt.focus();
    }, function (e) { ocupado = false; p.remove(); aviso('Algo falló: ' + (e && e.message || e)); });
  }
  $('f').onsubmit = function (ev) { ev.preventDefault(); var t = txt.value; txt.value = ''; atender(t); };
  $('nueva').onclick = function () { cerebro.nuevaConversacion(); LOG = []; alm.set('chatlog', LOG); hilo.innerHTML = ''; aviso('Conversación nueva'); chips(); };

  // ---------------------------------------------------------------- datos en el telefono (igual que la esfera)
  function pie() {
    var e = $('pie'), edad = datos.t ? Math.round((Date.now() - datos.t) / 60000) : null;
    if (navigator.onLine === false) { e.textContent = datos.t ? 'Sin señal · datos de las ' + M.horaTxt(datos.t) : 'Sin señal y sin datos'; e.className = 'pie warn'; return; }
    if (!datos.t) { e.textContent = 'Cargando datos…'; e.className = 'pie'; return; }
    e.textContent = 'Datos de las ' + M.horaTxt(datos.t) + (datos.ventas ? ' · ventas ' + M.horaTxt(datos.ventasT) : ' · sin ventas aún') + (cola.lista().length ? ' · ' + cola.lista().length + ' por enviar' : '');
    e.className = 'pie ' + (edad > 180 ? 'err' : edad > 40 ? 'warn' : 'ok');
  }
  var pidiendo = false;
  function cargarGuardados() { var d = alm.get('datos', null); if (d && d.o) cerebro.usarDatos(d.o, d.t); var v = alm.get('ventas', null); if (v && v.v && Date.now() - v.t < 3 * 3600000) datos.usarVentas(v.v, v.t); pie(); }
  cerebro.alVentas = function (v) { alm.set('ventas', { t: Date.now(), v: v }); pie(); };
  function pedirVentas() { api.llamar('ventas', {}, { fondo: true, plazo: 150000, releer: 2 }).then(function (v) { if (v.ok) { datos.usarVentas(v); alm.set('ventas', { t: Date.now(), v: v }); pie(); } }).catch(function () {}); }
  function pedirDatos(forzar) {
    if (pidiendo || navigator.onLine === false || !alm.get('t', '')) return;
    if (!forzar && Date.now() - datos.t < 20 * 60000) return;
    pidiendo = true;
    api.llamar('datos', {}, { fondo: true, plazo: 150000, releer: 3 }).then(function (o) { pidiendo = false; if (o.ok) { cerebro.usarDatos(o); alm.set('datos', { t: Date.now(), o: o }); pedirVentas(); chips(); } pie(); }, function () { pidiendo = false; pie(); });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { pedirDatos(); cola.vaciar(); pie(); } });
  window.addEventListener('online', function () { cola.vaciar(); pie(); }); window.addEventListener('offline', pie);
  setInterval(function () { pedirDatos(); pie(); }, 5 * 60000);

  // ---------------------------------------------------------------- arranque
  cargarGuardados(); repintar(); chips();
  if (!alm.get('t', '')) { aviso('Falta tu enlace de acceso: ábrelo una vez en este teléfono.'); return; }
  if (!LOG.length) aviso('Pregunta lo que quieras: precios, stock, clientes, ventas, meta, cotizaciones, gestiones. Todo se responde con los datos del teléfono.');
  cola.vaciar(); pedirDatos(true);
  api.llamar('inicio', {}, { fondo: true }).then(function (o) { if (o.ok) { cerebro.nombre = o.nombre; alm.set('nombre', o.nombre); } }).catch(function () {});
  cerebro.nombre = alm.get('nombre', ''); cerebro.refrescarPendientes();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  window.vozAtender = atender;
})();
