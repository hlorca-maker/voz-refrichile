/* Voz Refrichile — app del telefono (24-09-2026).
   Se habla, la app interpreta la frase aca mismo (sin servicios pagados), muestra lo
   que entendio en una tarjeta y lo guarda en el CRM con un toque o diciendo "si".
   El reconocimiento de voz es el del propio Chrome del telefono. */
'use strict';

var API = 'https://script.google.com/macros/s/AKfycbw4Ax55jS8OKCvICEFsbYSiOWvlbgcuboILiwc4VYq92y_IcrgbMBnAK1LEUKvaVa_Omg/exec';
var LS = { t: 'voz_t', cli: 'voz_cli', hist: 'voz_hist', cola: 'voz_cola', conf: 'voz_conf' };

// ------------------------------------------------------------------ utilidades
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function norm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\/:.,]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function pesos(n) { return n == null ? 'sin precio' : '$' + Math.round(n).toLocaleString('es-CL'); }
function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function hoy0() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
var DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
var DIAS_TXT = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function fechaTxt(isoS) {
  var p = isoS.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]), dif = Math.round((d - hoy0()) / 864e5);
  if (dif === 0) return 'hoy';
  if (dif === 1) return 'mañana';
  if (dif > 1 && dif < 7) return 'el ' + DIAS_TXT[d.getDay()];
  return 'el ' + DIAS_TXT[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()];
}
var NUM = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30 };
function numero(w) { return /^\d+$/.test(w) ? +w : (NUM[w] || null); }

// ------------------------------------------------------------------ API
/* Dos filas de llamadas (25-09-2026). Medido ese dia: la API trabaja menos de 2 s por llamada
   (panel de ejecuciones de Apps Script), pero Google tarda de 1 a 45 s en ENTREGAR la respuesta
   y a veces la pierde (404), aunque se llame de a una. No es la concurrencia: un proyecto de
   prueba de la misma cuenta aguanta 4 llamadas simultaneas en 1 s. Por eso lo que pide la
   persona (opc.fondo falso) sale de inmediato, de a una, sin esperar lo de segundo plano; y lo
   de segundo plano (calentar, refrescar el contador) va de a una y solo cuando no hay nada de
   la persona en curso, para no leer dos veces en frio las mismas planillas. Cada llamada tiene
   tope, para que una que se cuelgue no trabe su fila.
   Cuando falla, el error dice que paso: e.red = no salio (sin senal); e.tope = no volvio a
   tiempo; e.perdida = volvio 404 o ilegible (se perdio la respuesta, aunque la llamada SI se
   ejecuto). Las lecturas se reintentan una vez si se perdio la respuesta. El chat, las tareas
   y las "hecha" se reintentan (perdida o tope) con el MISMO rid mientras quede plazo: la API
   reconoce el rid y devuelve lo que ya hizo, sin guardarlo dos veces ni volver a preguntarle a
   la IA.
   Tres filas (25-09-2026 tarde): "u" lo que pide la persona, "e" las escrituras que van por
   detras (tarea, hecha: la persona ya oyo "listo"), "f" el segundo plano (la copia de datos,
   el contador). "e" y "f" esperan a que no haya nada de la persona en curso. */
var API_COLA = [], API_VUELO = { u: 0, e: 0, f: 0 }, API_TOPE = 35000, API_PLAZO = 75000, API_PAUSA = { corta: 800, larga: 15000 };
var API_RELEER = { inicio: 1, calentar: 1, pendientes: 1, configIA: 1, datos: 1, ventas: 1, gestiones: 1 }, API_RID = { chat: 1, tarea: 1, hecha: 1, gestion: 1, gestionBorrar: 1 };
function ridNuevo() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
function api(accion, datos, opc) {
  opc = opc || {}; datos = Object.assign({}, datos || {});
  if (API_RID[accion] && !datos.rid) datos.rid = ridNuevo();
  return new Promise(function (ok, mal) {
    API_COLA.push({ accion: accion, datos: datos, ms: opc.ms || API_TOPE, fila: opc.fila || (opc.fondo ? 'f' : 'u'), plazo: opc.plazo, releer: opc.releer, alReintentar: opc.alReintentar, ok: ok, mal: mal });
    apiSiguiente();
  });
}
function apiSiguiente() {
  ['u', 'e', 'f'].forEach(function (fila) {
    var x = API_COLA.filter(function (y) { return y.fila === fila; })[0];
    if (x && !API_VUELO[fila] && (fila === 'u' || !API_VUELO.u)) apiLanzar(x);
  });
}
function apiLanzar(x) {
  API_COLA.splice(API_COLA.indexOf(x), 1); API_VUELO[x.fila]++;
  // configIA con clave la guarda y la prueba: eso no se repite.
  var releer = API_RELEER[x.accion] && !(x.accion === 'configIA' && 'clave' in x.datos);
  function fin() { API_VUELO[x.fila]--; apiSiguiente(); }
  // Con rid se insiste mientras quede plazo (medido: Google llego a perder 5 respuestas seguidas);
  // cada intento extra solo recoge lo ya hecho. Las lecturas, una vez (opc.releer: mas veces,
  // para la copia de datos, que en frio puede pasar de los 30 s que Google aguanta).
  var t0 = Date.now(), plazo = x.plazo || API_PLAZO, extra = 0;
  function intento() { return apiUna(x.accion, x.datos, Math.min(x.ms, plazo - (Date.now() - t0))); }
  function otra(e) {
    var queda = plazo - (Date.now() - t0), lectura = releer && e.perdida && extra < (x.releer || 1), escritura = x.datos.rid && (e.perdida || e.tope);
    if (!lectura && !escritura) throw e;
    var pausa = lectura && extra ? API_PAUSA.larga : API_PAUSA.corta;   // 2a lectura fallida: la API sigue leyendo en frio, darle tiempo
    if (queda - pausa < 4200) throw e;                    // tras la pausa tienen que quedar al menos ~4 s de plazo
    extra++; if (x.alReintentar) x.alReintentar(e);
    return new Promise(function (r) { setTimeout(r, pausa); }).then(intento).catch(otra);
  }
  Promise.resolve().then(intento)   // ni un error inesperado traba la fila
    .catch(otra)
    .then(function (o) { fin(); x.ok(o); }, function (e) { fin(); x.mal(e); });
}
function apiUna(accion, datos, ms) {
  var body = Object.assign({ t: lsGet(LS.t, ''), accion: accion }, datos);
  var ctl = window.AbortController ? new AbortController() : null, reloj = ctl ? setTimeout(function () { ctl.abort(); }, ms) : 0;
  function falla(tipo, txt) { var e = new Error(txt); e[tipo] = true; return e; }
  // text/plain: Apps Script responde sin preflight de CORS.
  return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
    .then(function (r) {
      return r.text().then(function (tx) {
        var o = null; try { o = JSON.parse(tx); } catch (e) {}
        if (!r.ok || !o || typeof o !== 'object') throw falla('perdida', 'Respuesta ' + r.status);
        return o;
      });
    }, function (e) { throw e && e.name === 'AbortError' ? falla('tope', 'Sin respuesta a tiempo') : falla('red', 'Sin conexión'); })
    .then(function (o) { clearTimeout(reloj); if (o.sinClave) mostrarSetup(); return o; },
      function (e) { clearTimeout(reloj); if (e && e.name === 'AbortError') e = falla('tope', 'Sin respuesta a tiempo'); throw e; });
}
function errTxt(e) { return e && e.red ? 'Sin conexión.' : 'El CRM no respondió a tiempo. Intenta de nuevo.'; }

/* Cola sin conexion: lo que se guarda sin senal se manda solo al volver. Si al mandarlo
   vuelve sin respuesta (tope o 404), lo mas probable es que haya quedado guardado: se saca
   de la cola y se avisa, en vez de mandarlo de nuevo y dejarlo dos veces. */
/* ===== ESCRITURAS POR DETRAS (25-09-2026 tarde) =====
   Humberto: "que sea como Siri: le pido algo y lo hace". Cuando la persona confirma, la app dice
   "listo" al instante y manda la tarea (o la marca como hecha) por detras, en la fila "e". Cada
   envio lleva un rid fijo desde que se encola: si Google pierde la respuesta se insiste con el
   mismo rid hasta 8 minutos (la API lo recuerda 10) y la API devuelve lo ya hecho, sin duplicar.
   Pasado ese plazo sin confirmacion se avisa y se pide revisar los pendientes. Sin senal se
   espera a que vuelva. La cola vive en localStorage: sobrevive a cerrar la app. */
var COLA_ENVIANDO = false, COLA_TIMER = null, COLA_ESPERA = { red: 30000, insistir: 10000, plazo: 8 * 60000, api: 90000 };
function colaAgregar(accion, datos, txt) { var c = lsGet(LS.cola, []); c.push({ a: accion, d: datos, t: Date.now(), txt: txt || datos.titulo || accion }); lsSet(LS.cola, c); colaVaciar(); }
function colaLuego(ms) { clearTimeout(COLA_TIMER); COLA_TIMER = setTimeout(colaVaciar, ms); }
function colaVaciar() {
  var c = lsGet(LS.cola, []); if (COLA_ENVIANDO || !c.length) return;
  if (!navigator.onLine) { colaLuego(COLA_ESPERA.red); return; }
  var x = c[0]; COLA_ENVIANDO = true;
  if (!x.d.rid) { x.d.rid = ridNuevo(); lsSet(LS.cola, c); }
  function sacar() { var c2 = lsGet(LS.cola, []); if (c2.length && c2[0].d && c2[0].d.rid === x.d.rid) c2.shift(); lsSet(LS.cola, c2); }
  api(x.a, x.d, { fila: 'e', plazo: COLA_ESPERA.api }).then(function (o) {
    COLA_ENVIANDO = false; sacar();
    if (o && o.ok) colaListo(x, o); else colaFallo(x, (o && o.error) || 'No se pudo.', false);
    colaVaciar();
  }, function (e) {
    COLA_ENVIANDO = false;
    if (e.red || !navigator.onLine) { colaLuego(COLA_ESPERA.red); return; }
    if (Date.now() - (x.t || 0) < COLA_ESPERA.plazo) { colaLuego(COLA_ESPERA.insistir); return; }   // Google no entrego: insistir, mismo rid
    sacar(); colaFallo(x, 'Sin confirmación del CRM: puede que haya quedado guardado, revisa tus pendientes antes de repetirlo.', true); colaVaciar();
  });
}
window.addEventListener('online', colaVaciar);

// ------------------------------------------------------------------ voz de salida
var VOZ_ES = null;
function elegirVoz() {
  var vs = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  VOZ_ES = vs.filter(function (v) { return /^es[-_]CL/i.test(v.lang); })[0] || vs.filter(function (v) { return /^es[-_](US|419|MX)/i.test(v.lang); })[0] || vs.filter(function (v) { return /^es/i.test(v.lang); })[0] || null;
}
if (window.speechSynthesis) { elegirVoz(); speechSynthesis.onvoiceschanged = elegirVoz; }
function decir(texto, luego) {
  if (!window.speechSynthesis || !texto) { if (luego) luego(); return; }
  try {
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(texto.replace(/\$/g, '').replace(/(\d)\.(\d{3})/g, '$1$2'));
    u.lang = 'es-CL'; if (VOZ_ES) u.voice = VOZ_ES; u.rate = 1.05;
    u.onend = function () { if (luego) luego(); };
    u.onerror = function () { if (luego) luego(); };
    speechSynthesis.speak(u);
  } catch (e) { if (luego) luego(); }
}

// ------------------------------------------------------------------ microfono
var SR = window.SpeechRecognition || window.webkitSpeechRecognition, rec = null, escuchando = false, modoConfirmar = null;
function estado(t, cls) { var e = $('estado'); e.textContent = t; e.className = cls || ''; }
function escuchar(confirmacion, esChat) {
  if (!SR) { estado('Este navegador no reconoce voz: escribe abajo.', 'err'); return; }
  if (escuchando) { try { rec.stop(); } catch (e) {} return; }
  modoConfirmar = confirmacion || null;
  rec = new SR(); rec.lang = 'es-CL'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
  var final = '';
  rec.onstart = function () { escuchando = true; $('mic').classList.add('on'); estado(modoConfirmar && !esChat ? 'Te escucho: sí, no, o qué cambio' : 'Te escucho…'); $('vivo').textContent = ''; };
  rec.onresult = function (ev) {
    var t = '';
    for (var i = ev.resultIndex; i < ev.results.length; i++) { t += ev.results[i][0].transcript; if (ev.results[i].isFinal) final += ev.results[i][0].transcript; }
    $('vivo').textContent = final || t;
  };
  rec.onerror = function (ev) {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') estado('Permite el micrófono para usar la voz.', 'err');
    else if (ev.error === 'no-speech') estado('No te escuché. Toca y vuelve a intentarlo.');
    else if (ev.error === 'network') estado('Sin conexión para reconocer la voz: escribe abajo.', 'err');
  };
  rec.onend = function () {
    escuchando = false; $('mic').classList.remove('on');
    var t = (final || $('vivo').textContent || '').trim();
    if (modoConfirmar) { var cb = modoConfirmar; modoConfirmar = null; cb(t); return; }
    if (t) procesar(t); else if ($('estado').textContent === 'Te escucho…') estado('Toca y habla');
  };
  try { rec.start(); } catch (e) { estado('Toca el micrófono para hablar.'); }
}

// ------------------------------------------------------------------ clientes
var CLI = lsGet(LS.cli, { lista: [], t: 0 }), IDF = {};
var SUF = ' ltda limitada spa sa s.a eirl e.i.r.l sociedad soc cia y e hijos el la los las de del al en con por para un una ';
// Palabras de la orden que no son parte de un nombre de cliente ("tengo" casi calzaba con "Rengo").
var STOP_Q = ' tengo tienes tiene tenemos que cuando como donde quien cual hora dia llamar llamarlo llamarla llamarle llamo llame llama hablar visitar visite enviar mandar precio precios stock telefono fono correo direccion cotizacion cotizaciones recuerdame recordatorio tarea nota anota manana hoy pasado semana mes para por con del las los una uno dos tres cuatro cinco seis siete ocho nueve diez cliente empresa datos ficha contacto marca marcar hecha hecho lista mejor sobre '
  + 'ese esa eso esto este esta estos estas aquel aquella puedes podrias quiero necesito quisiera guardar guardame agregar agregame crear creame registrar poner ponme favor recordar recordarme avisame hola gracias buenas buenos dias tardes noches busca buscar buscame dame dime muestrame aviso alarma pendiente pendientes ';
function tokensCli(n) { return norm(n).replace(/[.,\-]/g, ' ').split(' ').filter(function (w) { return w.length > 2 && SUF.indexOf(' ' + w + ' ') < 0; }); }
function prepararClientes() {
  var df = {};
  CLI.lista.forEach(function (c) { c._t = tokensCli(c.n); c._t.forEach(function (w) { df[w] = (df[w] || 0) + 1; }); });
  var N = Math.max(1, CLI.lista.length);
  Object.keys(df).forEach(function (w) { IDF[w] = Math.log(1 + N / df[w]); });
}
function parecido(a, b) {
  if (a === b) return true;
  if (a.length < 6 || b.length < 6 || Math.abs(a.length - b.length) > 1) return false;
  var i = 0, j = 0, dif = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++dif > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return dif + (a.length - i) + (b.length - j) <= 1;
}
// Clientes de la cartera que calzan con la frase, del mas probable al menos. laxo: cualquier
// calce sirve (para "llama a Frio", donde la frase es casi solo el nombre y se elige tocando).
function buscarClientes(frase, laxo) {
  var ws = norm(frase).replace(/[.,\-]/g, ' ').split(' ').filter(function (w) { return w.length > 1 && SUF.indexOf(' ' + w + ' ') < 0 && STOP_Q.indexOf(' ' + w + ' ') < 0; }), out = [];
  // Chrome a veces parte un nombre de fantasia en dos: "acondi termic" = aconditermic.
  var n0 = ws.length; for (var i = 0; i < n0 - 1; i++) { ws.push(ws[i] + ws[i + 1]); if (i < n0 - 2) ws.push(ws[i] + ws[i + 1] + ws[i + 2]); }
  // Palabras de la frase que parecen nombre (largas, no de relleno): si un cliente no las tiene, resta.
  var nom = ws.slice(0, n0).filter(function (w) { return w.length >= 4; });
  CLI.lista.forEach(function (c) {
    if (!c._t || !c._t.length) return;
    var sc = 0, tot = 0, hit = 0, maxL = 0, unicos = c._t.filter(function (w, i) { return c._t.indexOf(w) === i; });   // "Cancino y Cancino" cuenta una vez
    unicos.forEach(function (w) { var idf = IDF[w] || 1; tot += idf; if (ws.some(function (x) { return parecido(x, w); })) { sc += idf; hit++; if (w.length > maxL) maxL = w.length; } });
    if (!hit) return;
    var cob = sc / tot;
    // Una sola palabra corta o que es solo parte del nombre no reconoce a un cliente ("ese" no es ESE SPA).
    if (!laxo && hit === 1 && cob < 1 && (maxL < 5 || cob < .5)) return;
    var faltan = nom.filter(function (x) { return !unicos.some(function (w) { return parecido(x, w); }); }).length;
    if (laxo || sc >= 2.2 || cob >= .6) { c._cob = cob; out.push({ c: c, sc: sc + cob * 3 - faltan * 1.5 }); }
  });
  out.sort(function (a, b) { return b.sc - a.sc; });
  return out.slice(0, 4).map(function (x) { return x.c; });
}

// ------------------------------------------------------------------ entender la frase
/* 29-09-2026: las reglas (fechas, que se quiere hacer, titulo, producto) viven en motor.js, el mismo que usan el modo voz y la
   consulta del CRM. Antes estaban copiadas aqui; con las gestiones y lo demas del 28-09 se dejo una sola copia. */
var M = window.VozMotor, R = M.R;
function leerFecha(f) { return M.leerFecha(f); }
function limpiarOrden(t) { return M.limpiarOrden(t); }
function intencion(t) { return M.intencion(t); }
function capital(s) { return M.capital(s); }
function tituloDe(t, fecha) { return M.tituloDe(t, fecha); }
function cotizacionDe(t) { return M.cotizacionDe(t); }
function productoDe(t, cli) { return M.productoDe(t, cli); }
// La copia de datos tambien en la forma del motor, para lo que el motor sabe responder (gestiones, cotizaciones por estado, ano anterior, documentos).
var DM = new M.Datos(), CM = new M.Cartera();
function ventasUsar(v, t) { DAT.ventas = v; DM.usarVentas(v, t); }

// ------------------------------------------------------------------ copia de datos en el telefono (25-09-2026 tarde)
/* Humberto: "quisiera que fuera la experiencia como con Siri: que yo le pida algo y lo haga o me
   responda, lo mas rapido posible". Google demora 10-40 s en entregar cada respuesta de la API,
   asi que la app se trae de una vez (accion "datos", en segundo plano al abrir y cada 20 min)
   lo que mas se pregunta: productos con precio por lista y stock, la cartera con contacto, las
   cotizaciones abiertas y los pendientes. Con eso responde aqui mismo, al instante. Queda en
   localStorage para que al abrir la app ya haya con que responder. */
var DAT = { t: 0, hora: '', dolar: 0, listas: {}, cols: ['PrecioBase', 'LAP', 'LAA', 'L2A', 'L2B', 'L2C', 'L2M'], reglas: { vig: 5, cal: 14 }, prod: [], cliMap: {}, cot: [] }, DAT_PIDIENDO = false;
// Igual que _vozNorm_ de la API: la busqueda de productos tiene que dar lo mismo aca que alla.
function normP(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\/.,]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function datosUsar(o, t) {
  DAT.t = t || Date.now(); DAT.hora = o.hora || ''; DAT.dolar = o.dolar || 0; DAT.listas = o.listas || {}; DAT.cols = o.listaCols || DAT.cols; DAT.reglas = o.reglas || DAT.reglas;
  DAT.prod = (o.prod || []).map(function (p) {
    var txt = ' ' + normP(p[0] + ' ' + p[1]) + ' ';
    return { cod: p[0], desc: p[1], act: !!(p[2] & 1), conPrecio: !!(p[2] & 2), stock: p[3] || 0, bod: p[4] || [], pr: p[5] || 0, _t: txt, _c: txt.replace(/[\s\-\/.]/g, ''), _cod: normP(p[0]) };
  });
  DAT.cliMap = {}; (o.cli || []).forEach(function (c) { DAT.cliMap[c[0]] = { r: c[0], n: c[1], l: c[2], f: c[3], m: c[4], d: c[5], c: c[6], b: !!c[7] }; });
  DAT.cot = o.cot || []; DAT.cotLineas = o.cotLineas || [];
  DM.usar(o, DAT.t); CM.cargar(DM.clientes());
  if (o.tareas) { PEND = pendMezclar(o.tareas); PEND_T = DAT.t; pintarBadge(); }
  if (o.cli && o.cli.length) {
    CLI = { lista: o.cli.map(function (c) { return { r: c[0], n: c[1], l: c[2] }; }), t: DAT.t }; lsSet(LS.cli, CLI); prepararClientes();
    CLI_POR_RUT = {}; CLI.lista.forEach(function (c) { CLI_POR_RUT[c.r] = c; });
  }
}
function datosGuardar(o) { try { localStorage.setItem('voz_datos', JSON.stringify({ t: Date.now(), o: o })); } catch (e) {} }
function datosCargar() { var d = lsGet('voz_datos', null); if (d && d.o) datosUsar(d.o, d.t); var v = lsGet('voz_ventas', null); if (v && v.v && Date.now() - v.t < 3 * 3600000) ventasUsar(v.v, v.t); }
function datosPedir(forzar) {
  if (DAT_PIDIENDO || !navigator.onLine) return;
  if (!forzar && Date.now() - DAT.t < 20 * 60000) return;
  DAT_PIDIENDO = true;
  api('datos', {}, { fondo: true, plazo: 150000, releer: 3 }).then(function (o) { DAT_PIDIENDO = false; if (o.ok) { datosUsar(o); datosGuardar(o); ventasPedir(); } }, function () { DAT_PIDIENDO = false; });
}
function horaTxt(t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

// Busqueda de productos, calcada de _vozBuscar_ de la API (mismos puntajes) mas plurales.
var STOP_P = ' de del la el los las un una para por con y a al en que precio precios cuanto cuesta sale vale valor stock hay tenemos quedan dame dime el la me ';
function buscarProd(q, tipo, max) {
  var tks = normP(String(q || '').replace(/(\d),(\d)/g, '$1.$2')).split(' ').filter(function (w) { return w && STOP_P.indexOf(' ' + w + ' ') < 0; });
  if (!tks.length) return [];
  var gas = tks.some(function (w) { return /^r\d{2,3}[a-z]?$/.test(w); }), qn = normP(q), res = [];
  var formas = tks.map(function (w) { return w.length > 4 && /s$/.test(w) ? [w, w.replace(/es$/, ''), w.replace(/s$/, '')] : [w]; });
  DAT.prod.forEach(function (it) {
    // Precio: tambien lo que no tiene precio de lista (se dice "sin precio"), antes que contestar con otro producto.
    if (!it.act && !it.conPrecio) return;
    var sc = 0, todas = true;
    formas.forEach(function (fs) {
      if (fs.some(function (w) { return it._t.indexOf(' ' + w + ' ') >= 0; })) sc += 2;
      else if (fs.some(function (w) { return it._t.indexOf(w) >= 0 || it._c.indexOf(w) >= 0; })) sc += 1.5;
      else todas = false;
    });
    if (gas && sc > 0 && /refrigerante|bombona|cilindro/.test(it._t) && !/recuperad|bomba|arbol|manguera|manometro|cortador|detector/.test(it._t)) sc += 3;   // solo si el codigo calzo: un R507 que no existe no es un R32   // el gas en si, no la recuperadora ni el arbol "R410A"
    if (it._cod === qn) sc += 10;
    if (todas) sc += 3;
    if (sc >= Math.max(2, tks.length)) res.push({ it: it, sc: sc });
  });
  res.sort(function (a, b) { return b.sc - a.sc || a.it.desc.length - b.it.desc.length; });
  if (res.length) { var top = res[0].sc; res = res.filter(function (x) { return x.sc >= top - 1.5; }); }
  // Entre los que calzan igual de bien, primero los que tienen stock (Humberto, 25-09-2026).
  res.sort(function (a, b) { return ((b.it.stock > 0) - (a.it.stock > 0)) || b.sc - a.sc || a.it.desc.length - b.it.desc.length; });
  return res.slice(0, max || 5).map(function (x) { return x.it; });
}
function distintivos(items) {
  var ws = items.map(function (x) { return String(x.desc).split(/\s+/); });
  if (ws.length < 2) return items.map(function (x) { return x.desc; });
  var comunes = ws[0].filter(function (w) { return ws.every(function (l) { return l.indexOf(w) >= 0; }); });
  // Un numero se queda con su unidad ("10 Kg", "5 CFM"), aunque la unidad sea comun a todos.
  return ws.map(function (l, i) { var d = l.filter(function (w, j) { return comunes.indexOf(w) < 0 || (j > 0 && /^\d/.test(l[j - 1]) && comunes.indexOf(l[j - 1]) < 0 && w.length <= 4); }).join(' '); return d || items[i].desc; });
}
// Respuestas con la forma que devuelve la API, para pintarlas con las mismas funciones.
function precioLocal(q, cli) {
  var hits = buscarProd(q, 'precio', 5); if (!hits.length) return null;
  var lista = cli && cli.l ? cli.l : 'L2A', li = DAT.cols.indexOf(lista), base = DAT.cols.indexOf('PrecioBase');
  return { ok: true, local: true, lista: lista, listaNom: DAT.listas[lista] || lista, cliente: cli ? cli.n : '', items: hits.map(function (x) {
    var usd = (li >= 0 && x.pr && x.pr[li]) || (x.pr && x.pr[base]) || 0;
    return { cod: x.cod, desc: x.desc, precio: usd > 0 && DAT.dolar ? Math.round(usd * DAT.dolar) : null, stock: x.stock };
  }) };
}
function stockLocal(q) {
  var hits = buscarProd(q, 'stock', 5); if (!hits.length) return null;
  return { ok: true, local: true, items: hits.map(function (x) { return { cod: x.cod, desc: x.desc, stock: x.stock, bod: x.bod.map(function (b) { return { b: b[0], s: b[1] }; }) }; }) };
}
function fichaLocal(rut) {
  var c = DAT.cliMap[rut]; if (!c) return null;
  var cots = DAT.cot.filter(function (x) { return x[0] === rut; }).map(function (x) { return { folio: x[1], fecha: x[2], dias: x[3], monto: x[4] }; })
    .sort(function (a, b) { return a.dias - b.dias; }).slice(0, 8);
  return { ok: true, local: true, cliente: { rut: rut, nombre: c.n, lista: DAT.listas[c.l] || c.l, fono: c.f, mail: c.m, dir: c.d, comuna: c.c, bloqueado: c.b }, cotizaciones: cots, reglas: DAT.reglas };
}

// ------------------------------------------------------------------ procesar una frase
/* ===== RESPUESTA AL INSTANTE (25-09-2026 tarde) =====
   Primero se intenta responder con la copia del telefono (rapido): precio, stock, telefono,
   direccion o cotizaciones de un cliente, pendientes, llamar, marcar hecha, y guardar un
   recordatorio o tarea cuando la orden es clara. Solo lo que no queda claro (la orden, el
   producto o el cliente) va a la IA, que tarda lo que tarde Google. Sin IA, el motor por reglas
   de siempre. */
function procesar(texto) {
  if (rapido(texto)) return;
  if (IA && navigator.onLine) return chatear(texto);
  return procesarLocal(limpiarOrden(texto));
}
function rapido(texto) {
  var tipo = intencion(texto), n = ' ' + norm(texto) + ' ';                    // saludo y ayuda se miran antes de limpiar
  if (tipo !== 'saludo' && tipo !== 'ayuda') { texto = limpiarOrden(texto); tipo = intencion(texto); n = ' ' + norm(texto) + ' '; }
  if (tipo === 'saludo' || tipo === 'ayuda') {
    var m0 = tipo === 'saludo' ? (/gracias/.test(n) ? 'De nada.' : /chao|adios|hasta luego/.test(n) ? 'Chao, que te vaya bien.' : 'Hola. ¿Qué necesitas? Precios, stock, datos de un cliente, tus pendientes o un recordatorio.')
      : 'Puedo decirte precio y stock de un producto; teléfono, dirección, cotizaciones, compras, facturas y gestiones de un cliente; tus ventas, tu meta y cómo vas contra el año pasado; tus pendientes; y registrar gestiones, recordatorios, tareas y notas. Por ejemplo: "llamé a Clima Norte y quedó en enviar la orden", "qué hablé con Refritec", "últimas facturas de Frío Sur".';
    $('vivo').textContent = texto; estado(m0); decir(m0); return true;
  }
  if (!DAT.t) return false;
  var clis = buscarClientes(texto), cli = clis[0] || null;
  var claro = !!cli && ((cli._cob || 0) >= .6 || clis.length === 1), nombrado = / (para|del cliente|de la empresa|a nombre de|donde) /.test(n);
  if (tipo === 'pend') { $('vivo').textContent = texto; verPendientes(true); return true; }
  // Gestiones, cotizaciones por estado, ano anterior y documentos (28-09-2026): lo resuelve el motor.
  if (/^(gestion|visita|gestiones|cotvend|comparar|docs|nv)$/.test(tipo)) {
    var rm = M.interpretar(texto, { datos: DM, cartera: CM });
    if (rm.tipo === 'ia') return false;
    $('vivo').textContent = texto;
    if (rm.tipo === 'elegir') elegirCliente(rm.clis, rm.para);
    else if (rm.tipo === 'borrador') tarjetaGestion(rm.borrador);
    else if (rm.tipo === 'gestiones' || rm.tipo === 'nv') verVista(rm);
    else conVentas(function () { verVista(rm); }, true);
    return true;
  }
  if (tipo === 'ventas' || tipo === 'meta') { $('vivo').textContent = texto; verVentas(tipo, / hoy /.test(n) ? 'hoy' : / semana /.test(n) ? 'semana' : ''); return true; }
  if (tipo === 'riesgo' || tipo === 'mejores') { $('vivo').textContent = texto; verCartera(tipo === 'mejores' ? (/ (ano|anual|este ano) /.test(n) ? 'mejores_anio' : 'mejores_mes') : 'riesgo'); return true; }
  if (tipo === 'compras') {
    if (!cli) { clis = buscarClientes(texto, true); cli = clis[0] || null; claro = !!cli && clis.length === 1; }
    if (!cli) return false;
    $('vivo').textContent = texto;
    if (!claro) { elegirCliente(clis, 'compras'); return true; }
    verCompras(cli); return true;
  }
  if (tipo === 'cotizado') {
    var folioC = cotizacionDe(texto);
    if (!cli && !folioC) { clis = buscarClientes(texto, true); cli = clis[0] || null; claro = !!cli && clis.length === 1; }
    if (!cli && !folioC) return false;
    $('vivo').textContent = texto;
    if (cli && !claro && !folioC) { elegirCliente(clis, 'cotizado'); return true; }
    verCotizado(cli, folioC); return true;
  }
  if (tipo === 'precio' || tipo === 'stock') {
    if (cli && !claro && nombrado) return false;                       // "para Frío..." y hay varios: que pregunte la IA
    var q = productoDe(texto, tipo === 'precio' && claro ? cli : null); if (!q) return false;
    var o = tipo === 'precio' ? precioLocal(q, claro ? cli : null) : stockLocal(q);
    if (!o) return false;
    $('vivo').textContent = texto; pintarProductos(tipo, o); estado('Toca y habla'); return true;
  }
  if (tipo === 'contacto' || tipo === 'cotiz' || tipo === 'llamar') {
    if (!cli) { clis = buscarClientes(texto, true); cli = clis[0] || null; claro = !!cli && clis.length === 1; }
    if (!cli) return false;
    $('vivo').textContent = texto;
    if (!claro) { elegirCliente(clis, tipo); return true; }
    var f = fichaLocal(cli.r); if (!f) return false;
    pintarFicha(f, tipo); estado('Toca y habla'); return true;
  }
  if (tipo === 'hecha') { if (!PEND_T) return false; $('vivo').textContent = texto; cerrarPorVoz(texto, cli); return true; }
  if (/^(recordatorio|tarea|visita|prosp|nota)$/.test(tipo)) { $('vivo').textContent = texto; tarjetaTarea(tipo, texto, clis); return true; }
  return false;
}
// Varios clientes calzan: se eligen tocando (mas rapido que preguntarle a la IA).
function elegirCliente(clis, tipo) {
  pintar('<div class="card"><h3>¿Cuál cliente?</h3><div class="acciones" style="flex-wrap:wrap">' + clis.map(function (c) {
    return '<button class="btn s" type="button" onclick="verFicha(\'' + esc(c.r) + '\',\'' + tipo + '\')">' + esc(c.n) + '</button>';
  }).join('') + '</div></div>');
  estado('¿Cuál de estos?'); decir('¿Cuál de estos? ' + clis.slice(0, 3).map(function (c) { return c.n; }).join(', '));
}
function verFicha(rut, tipo) {
  if (tipo === 'gestion') { if (BORR && BORR.tipo === 'gestion') { BORR.cli = rut; tarjetaGestion(BORR); } return; }
  if (tipo === 'gestiones' || tipo === 'docs') { var rv = { tipo: tipo, cli: CM.porRut[rut], periodo: '' }; if (tipo === 'docs') conVentas(function () { verVista(rv); }, true); else verVista(rv); return; }
  if (tipo === 'cotizado') return verCotizado(CLI_POR_RUT[rut], ''); if (tipo === 'compras') return verCompras(CLI_POR_RUT[rut]); var f = fichaLocal(rut); if (f) { pintarFicha(f, tipo); estado('Toca y habla'); } else if (CLI_POR_RUT[rut]) fichaCliente(CLI_POR_RUT[rut], tipo, ''); }
// Lo que arma el motor (titulo, filas y lo que se dice), pintado con los estilos de esta pantalla.
function verVista(r) {
  var v = M.vista(r, DM);
  pintar('<div class="card"><h3>' + esc(v.titulo) + (v.etiqueta ? ' <span class="tag">' + esc(v.etiqueta) + '</span>' : '') + '</h3>' + (v.nombre ? '<div style="font-weight:700;font-size:17px;margin-bottom:6px">' + esc(v.nombre) + '</div>' : '')
    + v.filas.map(function (f) { return '<div class="fila"' + (f.rut && !r.cli ? ' style="cursor:pointer" onclick="verFicha(\'' + esc(f.rut) + '\',\'contacto\')"' : '') + '><div><div class="n">' + esc(f.n) + '</div><div class="s">' + esc(f.s) + '</div></div><div class="v">' + esc(f.v) + (f.vs ? '<small>' + esc(f.vs) + '</small>' : '') + '</div></div>'; }).join('')
    + (v.nota ? '<div class="nota">' + esc(v.nota) + '</div>' : '') + '</div>');
  estado('Toca y habla'); decir(v.dicho); histAgregar(v.titulo + (v.nombre ? ': ' + v.nombre : ''));
}
/* Registrar una gestion (28-09-2026): "llamé a X y quedó en...". Se confirma con el detalle; se puede corregir hablando
   ("fue por WhatsApp", "fue ayer", "agrega que...") o en la tarjeta. La jefatura la deja a nombre del vendedor del cliente. */
function aNombreDe(b) { if (!DM.todos || DM.cod) return ''; var v = (DM.cliMap[b.cli] || {}).v; return v && DM.vend[v] ? String(DM.vend[v]).split(' ')[0] : ''; }
function tarjetaGestion(b) {
  BORR = b; HECHA_PEND = null; RESP_INTENTOS = 0;
  if (!b.cli) {
    if (b.clis.length) { elegirCliente(b.clis, 'gestion'); return; }
    BORR = null; var m0 = '¿Con qué cliente fue? Dilo con su nombre: por ejemplo, llamé a Clima Norte y quedó en enviar la orden.'; estado(m0); decir(m0); return;
  }
  var c = CM.porRut[b.cli];
  if (DM.todos && !DM.cod && !aNombreDe(b)) { BORR = null; var m1 = (c ? c.n : 'Ese cliente') + ' no tiene asignado un vendedor del equipo: no se puede registrar la gestión.'; estado(m1, 'err'); decir(m1); return; }
  pintarGestion(); preguntar(M.gestPideCot(b) ? '¿Cuál es el número de la cotización?' : M.fraseGestion(b, CM, aNombreDe(b)));
}
function pintarGestion() {
  var b = BORR, c = CM.porRut[b.cli], quien = aNombreDe(b);
  function opc(lista, val, vacio) { return (vacio ? '<option value="">' + vacio + '</option>' : '') + lista.map(function (x) { return '<option' + (x === val ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join(''); }
  pintar('<div class="card" id="gest"><h3>Registrar gestión' + (b.cot ? ' <span class="tag">Cot. ' + esc(b.cot) + '</span>' : '') + (quien ? ' <span class="tag">A nombre de ' + esc(quien) + '</span>' : '') + '</h3>'
    + '<div style="font-weight:700;font-size:17px;margin-bottom:6px">' + esc(c ? c.n : '') + '</div>'
    + '<div class="dos"><div class="campo"><label for="gTipo">Tipo</label><select id="gTipo">' + opc(M.GEST_TIPOS, b.gtipo) + '</select></div><div class="campo"><label for="gMet">Medio</label><select id="gMet">' + opc(M.GEST_METODOS, b.metodo, '—') + '</select></div></div>'
    + '<div class="dos"><div class="campo"><label for="gFec">Fecha</label><input id="gFec" type="date" max="' + iso(hoy0()) + '" value="' + esc(b.fecha) + '"></div><div class="campo"><label for="gCot">N° cotización</label><input id="gCot" inputmode="numeric" value="' + esc(b.cot || '') + '"></div></div>'
    + '<div class="campo"><label for="gOri">Quién inició el contacto</label><select id="gOri">' + opc(M.GEST_ORIGENES, b.origen || 'Saliente') + '</select></div>'
    + '<div class="campo"><label for="gCom">Comentario</label><textarea id="gCom">' + esc(b.comentario || '') + '</textarea></div>'
    + '<div class="acciones"><button type="button" class="btn s" id="bNo">Cancelar</button><button type="button" class="btn p" id="bSi">Registrar</button></div></div>');
  $('bSi').onclick = guardarGestion; $('bNo').onclick = cancelarBorrador;
}
function leerGestion() {
  if (!BORR || BORR.tipo !== 'gestion' || !$('gTipo') || !$('gTipo').value) return;
  BORR.gtipo = $('gTipo').value; BORR.metodo = $('gMet').value; BORR.fecha = $('gFec').value || iso(hoy0()); BORR.cot = String($('gCot').value || '').trim(); BORR.comentario = String($('gCom').value || '').trim(); if ($('gOri') && $('gOri').value) BORR.origen = $('gOri').value;
}
function guardarGestion() {
  leerGestion(); var b = BORR; if (!b) return;
  if (M.gestPideCot(b)) { var mf = 'Falta el número de la cotización.'; estado(mf, 'err'); decir(mf); return; }
  var d = M.datosGestion(b, CM); BORR = null;
  DM.gest.unshift({ f: d.fecha, rut: d.rut, n: d.cliente, tipo: d.tipo, met: d.metodo, cot: d.cot, contacto: '', com: d.comentario, vc: DM.cod || (DM.cliMap[d.rut] || {}).v || '', folio: 'prov-' + d.rid, rid: d.rid });
  pintar('<div class="card"><h3>Gestión registrada</h3><div class="n" style="font-weight:600">' + esc(d.cliente) + '</div><div class="nota">' + esc(capital(M.gestTxt(d.tipo, d.metodo))) + ' · ' + esc(capital(M.haceTxt(d.fecha))) + (d.comentario ? ' · ' + esc(d.comentario) : '') + '</div>'
    + '<div class="nota" id="env_' + d.rid + '">' + (navigator.onLine ? 'Enviando al CRM…' : 'Sin señal: se enviará al CRM cuando vuelva.') + '</div></div>');
  decir('Listo, registré la gestión con ' + d.cliente + '.'); estado('Toca y habla');
  colaAgregar('gestion', d, 'Gestión con ' + d.cliente);
}
// Compras por cliente y cartera (riesgo / mejores): salen de DAT.ventas.clientes [rut, vendedor, mes, ano, ultima, productos, docs]
function comprasDe(rut) {
  var c = ((DAT.ventas && DAT.ventas.clientes) || []).filter(function (x) { return x[0] === rut; })[0]; if (!c) return null;
  var p = c[4] ? c[4].split('-') : null, dias = p ? Math.round((hoy0().getTime() - new Date(+p[0], +p[1] - 1, +p[2]).getTime()) / 86400000) : null;
  return { rut: rut, mes: c[2], anio: c[3], ult: c[4], dias: dias, prods: c[5] || [], docs: c[6] || 0 };
}
function carteraLocal(tipo) {
  var out = ((DAT.ventas && DAT.ventas.clientes) || []).map(function (x) { var c = comprasDe(x[0]); c.nombre = (CLI_POR_RUT[x[0]] || {}).n || x[0]; return c; });
  if (tipo === 'riesgo') return out.filter(function (c) { return c.anio > 0 && c.dias != null && c.dias >= 60; }).sort(function (a, b) { return b.anio - a.anio; });
  if (tipo === 'mejores_mes') return out.filter(function (c) { return c.mes > 0; }).sort(function (a, b) { return b.mes - a.mes; });
  return out.filter(function (c) { return c.anio > 0; }).sort(function (a, b) { return b.anio - a.anio; });
}
function conVentas(fn, nuevo) {
  if (DAT.ventas && !(nuevo && DM.ventasViejas)) return fn();
  estado('Trayendo tus ventas…');
  api('ventas', {}, { releer: 2, plazo: 120000 }).then(function (v) { if (!v.ok) { estado(v.error || 'No se pudo.', 'err'); return; } ventasUsar(v); lsSet('voz_ventas', { t: Date.now(), v: v }); fn(); }).catch(function (e) { estado(errTxt(e), 'err'); });
}
function verCompras(cli) {
  conVentas(function () {
    var c = comprasDe(cli.r) || { mes: 0, anio: 0, prods: [], docs: 0 };
    pintar('<div class="card"><h3>Compras</h3><div style="font-weight:700;font-size:17px;margin-bottom:6px">' + esc(cli.n) + '</div><div class="fila"><div class="s">Este mes</div><div class="v">' + pesos(c.mes) + (c.docs ? '<small>' + c.docs + ' documentos</small>' : '') + '</div></div><div class="fila"><div class="s">En el año</div><div class="v">' + pesos(c.anio) + '</div></div><div class="fila"><div class="s">Última compra</div><div class="v">' + (c.ult ? esc(c.ult) + '<small>hace ' + c.dias + ' días</small>' : '—') + '</div></div>' + (c.prods.length ? '<div class="nota">Últimos productos: ' + esc(c.prods.join(' · ')) + '</div>' : '') + '</div>');
    estado('Toca y habla');
    var ult = c.ult ? (c.dias === 0 ? 'hoy' : c.dias === 1 ? 'ayer' : 'hace ' + c.dias + ' días') : 'sin fecha';
    decir(!c.anio ? cli.n + ' no tiene compras este año.' : cli.n + (c.mes ? ' lleva ' + plataTxt(c.mes) + ' este mes y ' : ' no ha comprado este mes; lleva ') + plataTxt(c.anio) + ' en el año. Última compra ' + ult + (c.prods.length ? ': ' + c.prods.join(', ').toLowerCase() : '') + '.');
    histAgregar('Compras: ' + cli.n);
  });
}
function verCartera(sub) {
  conVentas(function () {
    var lista = carteraLocal(sub), per = sub === 'mejores_mes' ? 'mes' : 'anio', tit = sub === 'riesgo' ? 'Clientes en riesgo · ' + lista.length : sub === 'mejores_mes' ? 'Mejores clientes del mes' : 'Mejores clientes del año';
    pintar('<div class="card"><h3>' + tit + '</h3>' + (lista.length ? lista.slice(0, 8).map(function (c) { return '<div class="fila" style="cursor:pointer" onclick="verFicha(\'' + esc(c.rut) + '\',\'contacto\')"><div><div class="n">' + esc(c.nombre) + '</div><div class="s">' + (c.ult ? 'última compra hace ' + c.dias + ' d' : 'sin compras') + '</div></div><div class="v">' + pesos(sub === 'riesgo' ? c.anio : c[per]) + '<small>' + (per === 'mes' && sub !== 'riesgo' ? 'este mes' : 'en el año') + '</small></div></div>'; }).join('') : '<div class="nota">Nada que mostrar.</div>') + '</div>');
    estado('Toca y habla');
    decir(sub === 'riesgo' ? (lista.length ? 'Tienes ' + lista.length + ' clientes sin compras hace más de 60 días. Los más importantes: ' + lista.slice(0, 5).map(function (c) { return c.nombre + ' (hace ' + c.dias + ' días, ' + plataTxt(c.anio) + ' en el año)'; }).join('; ') + '.' : 'No tienes clientes con compras en el año que lleven más de 60 días sin comprar.')
      : (lista.length ? 'Tus mejores clientes del ' + (per === 'mes' ? 'mes' : 'año') + ': ' + lista.slice(0, 5).map(function (c, i) { return (i + 1) + ', ' + c.nombre + ' con ' + plataTxt(per === 'mes' ? c.mes : c.anio); }).join('; ') + '.' : 'Todavía no hay compras.'));
    histAgregar(tit);
  });
}
/* Productos cotizados, ventas y meta (25-09-2026, Humberto: "saber sobre productos cotizados a algun cliente,
   mis ventas, mi meta, cuanto me falta por vender"). Las lineas vienen con la copia; las ventas con la accion
   "ventas" (se piden despues de la copia y quedan en voz_ventas). Los textos hablados son los mismos del motor. */
function plataTxt(n) { n = Math.round(n || 0); var s = n < 0 ? 'menos ' : '', a = Math.abs(n); if (a >= 1e6) { var m = Math.round(a / 1e5) / 10; return s + String(m).replace('.', ',') + (m === 1 ? ' millón' : ' millones'); } if (a >= 1e3) return s + Math.round(a / 1e3) + ' mil'; return s + a + ' pesos'; }
function cotizadoLocal(rut, folio) {
  var porK = {};
  (DAT.cotLineas || []).forEach(function (l) { if ((rut && l[0] !== rut) || (folio && l[1] !== String(folio))) return; (porK[l[0] + '|' + l[1]] = porK[l[0] + '|' + l[1]] || []).push({ cod: l[2], desc: l[3], cant: l[4], monto: l[5] }); });
  return DAT.cot.filter(function (c) { return (!rut || c[0] === rut) && (!folio || c[1] === String(folio)); }).sort(function (a, b) { return a[3] - b[3]; })
    .map(function (c) { return { folio: c[1], fecha: c[2], dias: c[3], monto: c[4], lineas: (porK[c[0] + '|' + c[1]] || []).sort(function (a, b) { return b.monto - a.monto; }) }; });
}
function verCotizado(cli, folio) {
  var cots = cotizadoLocal(cli ? cli.r : '', folio), nom = cli ? cli.n : (folio ? 'Cotización ' + folio : '');
  pintar('<div class="card"><h3>Cotizado</h3><div style="font-weight:700;font-size:17px;margin-bottom:6px">' + esc(nom) + '</div>' + (cots.length ? cots.slice(0, 4).map(function (c) {
    return '<div style="margin-top:10px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--hint)">N° ' + esc(c.folio) + ' · ' + esc(c.fecha) + ' · ' + c.dias + ' d · ' + pesos(c.monto) + '</div>' + c.lineas.slice(0, 8).map(function (l) { return '<div class="fila"><div><div class="n">' + esc(l.desc) + '</div><div class="s">' + esc(l.cod) + (l.cant ? ' · ' + l.cant + ' un.' : '') + '</div></div><div class="v">' + pesos(l.monto) + '</div></div>'; }).join('');
  }).join('') : '<div class="nota">No tiene cotizaciones abiertas.</div>') + '</div>');
  estado('Toca y habla');
  var frases = cots.slice(0, 2).map(function (c) { var ls = c.lineas.slice(0, 4).map(function (l) { return l.desc.toLowerCase() + (l.cant ? ', ' + l.cant + (l.cant === 1 ? ' unidad' : ' unidades') : ''); }); return 'La ' + c.folio + ', de hace ' + c.dias + ' días por ' + plataTxt(c.monto) + (ls.length ? ': ' + ls.join('; ') : '') + '.'; });
  decir(cots.length ? nom + ' tiene ' + cots.length + (cots.length === 1 ? ' cotización abierta. ' : ' cotizaciones abiertas. ') + frases.join(' ') : nom + ' no tiene cotizaciones abiertas.');
  histAgregar('Cotizado: ' + nom);
}
function ventasTxt(v, tipo, periodo) {
  var d = new Date(), quedan = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate();
  if (periodo === 'hoy' || periodo === 'semana') { var val = periodo === 'hoy' ? v.hoy : v.semana; return (v.equipo ? 'El equipo lleva ' : 'Llevas ') + (val ? plataTxt(val) : 'cero') + (periodo === 'hoy' ? ' facturado hoy' : ' esta semana') + '. En el mes, ' + plataTxt(v.mes) + (v.meta ? ' de una meta de ' + plataTxt(v.meta) + ' (' + v.avance + ' por ciento)' : '') + '.'; }
  var lleva = (v.equipo ? 'El equipo lleva ' : 'Este mes llevas ') + plataTxt(v.mes) + (v.docs ? ' en ' + v.docs + ' documentos' : '') + '.';
  var meta = v.meta ? ((v.equipo ? 'La meta del equipo es ' : 'Tu meta es ') + plataTxt(v.meta) + ': ' + (v.falta > 0 ? 'faltan ' + plataTxt(v.falta) + ' (' + v.avance + ' por ciento)' + (quedan ? ', con ' + quedan + ' días por delante' : '') : 'ya está cumplida') + '.') : 'No hay meta cargada este mes.';
  return (tipo === 'meta' ? meta + ' ' + lleva : lleva + ' ' + meta) + ' En el año, ' + plataTxt(v.anio) + '.';
}
function pintarVentas(v, tipo, periodo) {
  var f = function (t, val) { return '<div class="fila"><div class="s">' + t + '</div><div class="v">' + val + '</div></div>'; };
  var h = (v.hoy != null ? f('Hoy', pesos(v.hoy)) + f('Esta semana', pesos(v.semana)) : '') + f('Vendido este mes', pesos(v.mes) + (v.docs ? '<small>' + v.docs + ' documentos</small>' : '')) + (v.meta ? f('Meta del mes', pesos(v.meta)) + f('Falta', pesos(v.falta) + '<small>' + (v.avance || 0) + '% de avance</small>') : f('Meta', '<small>sin meta cargada</small>')) + f('Vendido en el año', pesos(v.anio));
  if (v.equipo && v.vendedores) h += '<div style="margin-top:10px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--hint)">Por vendedor</div>' + v.vendedores.map(function (x) { return f(esc(x.nombre), pesos(x.mes) + (x.meta ? '<small>' + (x.avance || 0) + '% de ' + pesos(x.meta) + '</small>' : '')); }).join('');
  pintar('<div class="card"><h3>' + (v.equipo ? 'Ventas del equipo' : 'Mis ventas') + ' <span class="tag">' + esc(v.periodo || '') + '</span></h3>' + h + (v.hora ? '<div class="nota">Datos de las ' + esc(String(v.hora).slice(11)) + '</div>' : '') + '</div>');
  estado('Toca y habla'); decir(ventasTxt(v, tipo, periodo)); histAgregar('Ventas del mes');
}
function verVentas(tipo, periodo) { conVentas(function () { pintarVentas(DAT.ventas, tipo, periodo); }); }
function ventasPedir() { api('ventas', {}, { fondo: true, plazo: 150000, releer: 2 }).then(function (v) { if (v.ok) { ventasUsar(v); lsSet('voz_ventas', { t: Date.now(), v: v }); } }).catch(function () {}); }
function procesarLocal(texto) {
  $('vivo').textContent = texto;
  var tipo = intencion(texto), clis = buscarClientes(texto), cli = clis[0] || null;
  if (tipo === 'nose') { var m = 'No te entendí. Puedo buscar precios, stock, datos de un cliente o tus pendientes, y guardar un recordatorio o una tarea.'; estado(m); decir(m); return; }
  if (tipo === 'pend') return verPendientes(true);
  if (tipo === 'hecha') return cerrarPorVoz(texto, cli);
  if (tipo === 'precio' || tipo === 'stock') {
    var q = productoDe(texto, tipo === 'precio' ? cli : null);
    if (!q) { estado('¿De qué producto?'); decir('¿De qué producto?'); return; }
    if (DAT.t) { pintar('<div class="card"><h3>' + (tipo === 'precio' ? 'Precio' : 'Stock') + '</h3>No encontré “' + esc(q) + '”. Prueba con otras palabras o el código.</div>'); decir('No encontré ese producto'); estado('Toca y habla'); return; }
    return consultar(tipo, q, tipo === 'precio' ? cli : null, texto);
  }
  if (tipo === 'contacto' || tipo === 'cotiz' || tipo === 'llamar') {
    if (!cli) { estado('No reconocí el cliente. Dilo de nuevo con su nombre.', 'err'); decir('No reconocí el cliente'); return; }
    return fichaCliente(cli, tipo, texto);
  }
  tarjetaTarea(tipo, texto, clis);
}

function pintarProductos(tipo, o) {
  var its = o.items || [], cab = tipo === 'precio' ? 'Precio <span class="tag">' + esc(o.listaNom) + (o.cliente ? ' · ' + esc(o.cliente) : '') + '</span>' : 'Stock';
  var filas = its.map(function (x) {
    return '<div class="fila"><div><div class="n">' + esc(x.desc) + '</div><div class="s">' + esc(x.cod) + (tipo === 'stock' && x.bod && x.bod.length ? ' · ' + x.bod.map(function (b) { return esc(b.b) + ' ' + b.s; }).join(' · ') : '') + '</div></div>'
      + '<div class="v">' + (tipo === 'precio' ? pesos(x.precio) + '<small>+ IVA · stock ' + (x.stock || 0) + '</small>' : (x.stock || 0) + '<small>unidades</small>') + '</div></div>';
  }).join('');
  pintar('<div class="card"><h3>' + cab + '</h3>' + filas + (o.local && DAT.hora ? '<div class="nota">Datos de las ' + esc(DAT.hora.slice(11)) + '</div>' : '') + '</div>');
  var a = its[0], top = its.slice(0, 3), d = distintivos(top);
  if (tipo === 'precio') decir(a.desc + ': ' + (a.precio ? Math.round(a.precio) + ' pesos más IVA, ' : 'sin precio de lista, ') + (o.cliente ? 'para ' + o.cliente : 'en ' + o.listaNom) + '. Stock ' + (a.stock || 0) + '.');
  else {
    // Varios parecidos: se dicen los que tienen stock y cuales no ("R507 11.3 Kg: 1995. Sin stock: 10 Kg").
    var con = [], sin = [];
    top.forEach(function (x, i) { (x.stock > 0 ? con : sin).push({ x: x, d: i === 0 ? x.desc : d[i] }); });
    decir(con.length ? con.map(function (p) { return p.d + ': ' + p.x.stock + ' unidades'; }).join('. ') + '.' + (sin.length ? ' Sin stock: ' + sin.map(function (p) { return p.d; }).join(', ') + '.' : '') : a.desc + ': sin stock.');
  }
  histAgregar((tipo === 'precio' ? 'Precio: ' : 'Stock: ') + a.desc);
}
function consultar(tipo, q, cli, texto) {
  estado('Buscando…');
  api(tipo, { q: q, rut: cli ? cli.r : '', texto: texto }).then(function (o) {
    if (!o.ok) { estado(o.error || 'No se pudo.', 'err'); return; }
    estado('Toca y habla');
    if (!(o.items || []).length) { pintar('<div class="card"><h3>' + (tipo === 'precio' ? 'Precio' : 'Stock') + '</h3>No encontré “' + esc(q) + '”. Prueba con otras palabras o el código.</div>'); decir('No encontré ese producto'); return; }
    pintarProductos(tipo, o);
  }).catch(function (e) { estado(errTxt(e), 'err'); });
}

function pintarFicha(o, tipo) {
  var c = o.cliente, tel = c.fono ? c.fono.replace(/[^\d+]/g, '') : '';
  var h = '<div class="card"><h3>Cliente <span class="tag">' + esc(c.lista || '') + '</span>' + (c.bloqueado ? ' <span class="pill crit">Bloqueado</span>' : '') + '</h3>'
    + '<div style="font-weight:700;font-size:17px;margin-bottom:6px">' + esc(c.nombre) + '</div>';
  if (c.fono) h += '<div class="fila"><div class="s">Teléfono</div><div class="v"><a href="tel:' + esc(tel) + '" style="color:var(--acc)">' + esc(c.fono) + '</a></div></div>';
  if (c.mail) h += '<div class="fila"><div class="s">Correo</div><div class="v" style="font-weight:500"><a href="mailto:' + esc(c.mail) + '" style="color:var(--acc)">' + esc(c.mail) + '</a></div></div>';
  if (c.dir || c.comuna) h += '<div class="fila"><div class="s">Dirección</div><div class="v" style="font-weight:500"><a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(((c.dir || '') + ' ' + (c.comuna || '')).trim()) + '" style="color:var(--acc)">' + esc(((c.dir || '') + ', ' + (c.comuna || '')).replace(/^, |, $/g, '')) + '</a></div></div>';
  var cs = o.cotizaciones || [];
  h += '<div style="margin-top:12px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--hint)">Cotizaciones abiertas</div>';
  h += cs.length ? cs.map(function (q) {
    var vig = q.dias <= o.reglas.vig, cal = q.dias < o.reglas.cal;
    return '<div class="fila"><div><div class="n">N° ' + esc(q.folio) + '</div><div class="s">' + esc(q.fecha) + ' · ' + q.dias + ' d</div></div><div class="v">' + pesos(q.monto)
      + '<small>' + (cal ? (vig ? '<span class="pill ok">precio vigente</span>' : '<span class="pill warn">actualizar precio</span>') : 'antigua') + '</small></div></div>';
  }).join('') : '<div class="nota">No tiene cotizaciones abiertas.</div>';
  h += '<div class="acciones">' + (c.fono ? '<a class="btn p" href="tel:' + esc(tel) + '">Llamar</a>' : '')
    + '<button class="btn s" type="button" onclick="tarjetaTarea(\'recordatorio\',\'Llamar a ' + esc(c.nombre).replace(/'/g, '') + '\',[CLI_POR_RUT[\'' + esc(c.rut) + '\']])">Recordatorio</button></div></div>';
  pintar(h);
  var fonoDicho = c.fono ? c.fono.replace(/\D/g, '').split('').join(' ') : '';
  decir(tipo === 'llamar'
    ? (c.fono ? c.nombre + ', ' + fonoDicho + '. Toca Llamar.' : c.nombre + ' no tiene teléfono registrado')
    : tipo === 'contacto'
      ? (c.fono ? 'El teléfono de ' + c.nombre + ' es ' + fonoDicho : c.nombre + ' no tiene teléfono registrado')
      : (cs.length ? c.nombre + ' tiene ' + cs.length + (cs.length === 1 ? ' cotización abierta' : ' cotizaciones abiertas') + (cs.length === 1 ? ', por ' + Math.round(cs[0].monto) + ' pesos' : '') : c.nombre + ' no tiene cotizaciones abiertas'));
  histAgregar('Cliente: ' + c.nombre);
}
function fichaCliente(cli, tipo, texto) {
  estado('Buscando…');
  api('cliente', { rut: cli.r, texto: texto }).then(function (o) {
    if (!o.ok) { estado(o.error || 'No se pudo.', 'err'); return; }
    estado('Toca y habla'); pintarFicha(o, tipo);
  }).catch(function (e) { estado(errTxt(e), 'err'); });
}
var CLI_POR_RUT = {};

// ------------------------------------------------------------------ tarjeta para guardar
var TIPOS = [['recordatorio', 'Recordatorio'], ['tarea', 'Tarea'], ['visita', 'Visita'], ['prosp', 'Prospección'], ['nota', 'Nota']];
var BORR = null;
function tarjetaTarea(tipo, texto, clis) {
  clis = clis || [];
  if (tipo === 'cotiz' || tipo === 'contacto' || tipo === 'precio' || tipo === 'stock') tipo = 'tarea';
  var f = leerFecha(texto), cot = cotizacionDe(texto), cli = clis[0] || null;
  // Una prospeccion suele ser alguien que aun no es cliente: solo se sugiere si calza claro.
  if (tipo === 'prosp' && cli && (cli._cob || 0) < .6) cli = null;
  var titulo = tituloDe(texto, f);
  if (tipo === 'visita') titulo = 'Registrar visita' + (cli ? ' a ' + cli.n : '');
  if (tipo === 'prosp') titulo = 'Prospección' + (cli ? ': ' + cli.n : '') ;
  if (!f.iso) f.iso = iso(hoy0());
  BORR = { tipo: tipo, titulo: titulo, detalle: texto, fecha: f.iso, hora: f.hora || (tipo === 'recordatorio' ? '09:00' : ''), clis: clis, cli: cli ? cli.r : '', cot: cot };
  HECHA_PEND = null; RESP_INTENTOS = 0;
  pintarBorrador();
  var lo = { recordatorio: 'el recordatorio', tarea: 'la tarea', visita: 'la visita', prosp: 'la prospección', nota: 'la nota' }[tipo];
  var frase = 'Guardo ' + lo + ' para ' + fechaTxt(BORR.fecha) + (BORR.hora && tipo === 'recordatorio' ? ' a las ' + BORR.hora : '') + (cli ? ', ' + cli.n : '') + '. ¿Lo guardo?';
  preguntar(frase);
}
function pintarBorrador() {
  var b = BORR, opts = '<option value="">— Sin cliente —</option>' + b.clis.concat(b.cli && !b.clis.some(function (c) { return c.r === b.cli; }) ? [CLI_POR_RUT[b.cli]] : []).filter(Boolean)
    .map(function (c) { return '<option value="' + esc(c.r) + '"' + (c.r === b.cli ? ' selected' : '') + '>' + esc(c.n) + '</option>'; }).join('')
    + '<option value="*">Buscar otro…</option>';
  pintar('<div class="card" id="borr"><h3>Guardar en el CRM' + (b.cot ? ' <span class="tag">Cot. ' + esc(b.cot) + '</span>' : '') + '</h3>'
    + '<div class="tipos" role="group" aria-label="Tipo">' + TIPOS.map(function (t) { return '<button type="button" data-t="' + t[0] + '" class="' + (t[0] === b.tipo ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>'
    + '<div class="campo"><label for="bTit">Qué</label><input id="bTit" value="' + esc(b.titulo) + '"></div>'
    + '<div class="campo"><label for="bCli">Cliente</label><select id="bCli">' + opts + '</select></div>'
    + '<div class="dos"><div class="campo"><label for="bFec">Fecha</label><input id="bFec" type="date" value="' + esc(b.fecha) + '"></div>'
    + '<div class="campo"><label for="bHor">Hora' + (b.tipo === 'recordatorio' ? ' del aviso' : '') + '</label><input id="bHor" type="time" value="' + esc(b.hora) + '"></div></div>'
    + '<div class="campo"><label for="bDet">Detalle</label><textarea id="bDet">' + esc(b.detalle) + '</textarea></div>'
    + '<div class="acciones"><button type="button" class="btn s" id="bNo">Cancelar</button><button type="button" class="btn p" id="bSi">Guardar</button></div></div>');
  document.querySelectorAll('#borr .tipos button').forEach(function (x) { x.onclick = function () { leerBorrador(); BORR.tipo = x.getAttribute('data-t'); if (BORR.tipo === 'recordatorio' && !BORR.hora) BORR.hora = '09:00'; pintarBorrador(); }; });
  $('bCli').onchange = function () {
    if (this.value !== '*') return;
    var q = prompt('Nombre del cliente'); var r = q ? buscarClientes(q) : [];
    leerBorrador(); if (r.length) { BORR.clis = r; BORR.cli = r[0].r; } else { BORR.cli = ''; } pintarBorrador();
  };
  $('bSi').onclick = guardarBorrador; $('bNo').onclick = cancelarBorrador;
}
function leerBorrador() {
  if (!BORR || !$('bTit')) return;
  BORR.titulo = $('bTit').value.trim(); BORR.cli = $('bCli').value === '*' ? '' : $('bCli').value;
  BORR.fecha = $('bFec').value || iso(hoy0()); BORR.hora = $('bHor').value; BORR.detalle = $('bDet').value.trim();
}
/* ===== CONVERSACION (25-09-2026) =====
   Humberto: "no interpreta si le digo 'no lo guardes', solo el 'no' exacto". Con una tarjeta
   abierta, lo que se diga (o se escriba) es una RESPUESTA a esa tarjeta, no una orden nueva:
   si o no en sus formas naturales, y correcciones: "no, para el jueves a las 4", "mejor
   manana", "es una visita", "el cliente es Refrimas", "agrega que piden 20 bombas",
   "que diga llamar por el precio". Todo aca mismo en el telefono: sin servicios pagados. */
var SI_RX = /\b(si|sip|dale|guard\w*|anot\w*|registr\w*|agend\w*|ok|okey|okay|confirm\w*|ya|listo|correcto|perfecto|de acuerdo|claro|hazlo|bueno|exacto|esta bien|asi esta bien|por favor)\b/;
var NO_RX = /\b(no|nop|cancel\w*|borr\w*|olvid\w*|descart\w*|elimin\w*|nada|dejalo|deja eso|mejor no|equivoqu\w*)\b/;
var HECHA_PEND = null, RESP_INTENTOS = 0;
function hayPregunta() { return !!(BORR || HECHA_PEND); }
function preguntar(frase) {
  estado(frase);
  if (lsGet(LS.conf, true)) decir(frase, function () { setTimeout(function () { if (hayPregunta()) escuchar(respuestaVoz); }, 150); });
}
function respuestaVoz(t) {
  t = String(t || '').trim();
  if (!t) { estado(BORR ? 'Toca Guardar, o el micrófono para responder' : 'Toca y habla'); return; }
  if (!responder(t)) procesar(t);
}
// Que dijo sobre guardar: +1 si, -1 no, 0 no queda claro. Gana lo que dijo primero
// ("si, no hay problema" es un si).
function siNo(n) {
  if (/\bno (me |te |se )?olvid/.test(n)) return 1;                        // "no te olvides" = si
  if (/\bno (lo |la |le )?(guard|anot|registr|agend|grab)\w*/.test(n)) return -1;
  if (/\bno hay problema\b/.test(n)) return 1;
  var a = n.search(SI_RX), b = n.search(NO_RX);
  if (a < 0 && b < 0) return 0;
  if (a < 0) return -1;
  if (b < 0) return 1;
  return a < b ? 1 : -1;
}
function responder(texto) {
  var n = ' ' + norm(texto) + ' ';
  if (HECHA_PEND) {
    var r0 = siNo(n), t = HECHA_PEND;
    if (r0 > 0) { HECHA_PEND = null; marcarHecha(t.id); return true; }
    if (r0 < 0) { HECHA_PEND = null; pintar(''); estado('Toca y habla'); decir('Bien, no la marco.'); return true; }
    return false;                                                            // otra cosa: orden nueva
  }
  if (!BORR) return false;
  if (BORR.tipo === 'gestion') {
    leerGestion();
    if (M.esOtraGestion(BORR, texto, CM)) { BORR = null; RESP_INTENTOS = 0; return false; }
    if (M.gestPideCot(BORR)) {
      var nc = (texto.replace(/[.\s]/g, '').match(/\d{3,8}/) || [])[0];
      if (nc) { BORR.cot = nc; pintarGestion(); preguntar(M.fraseGestion(BORR, CM, aNombreDe(BORR))); return true; }
      if (/ (no se|no lo se|no me acuerdo|no lo tengo|no tengo|sin numero) /.test(n)) { BORR.gtipo = 'Contacto'; pintarGestion(); preguntar(M.fraseGestion(BORR, CM, aNombreDe(BORR))); return true; }
    }
    if (M.corregirGestion(BORR, texto, CM).length) { RESP_INTENTOS = 0; pintarGestion(); preguntar('Queda así. ' + M.fraseGestion(BORR, CM, aNombreDe(BORR))); return true; }
    var rg = siNo(n);
    if (rg > 0) { guardarGestion(); return true; }
    if (rg < 0) { cancelarBorrador(); decir('Bien, no la registro.'); return true; }
    if (/^(precio|stock|contacto|cotiz|pend|llamar|hecha|ventas|meta|gestiones|cotvend|comparar|docs|compras|riesgo|mejores|cotizado)$/.test(intencion(texto))) { BORR = null; RESP_INTENTOS = 0; return false; }
    if (++RESP_INTENTOS <= 1) { preguntar('No te entendí. Di sí para registrarla, no para descartarla, o dime qué cambio.'); return true; }
    estado('Revisa la tarjeta y toca Registrar o Cancelar'); return true;
  }
  leerBorrador(); var b = BORR, cambios = [];
  // 1) Correcciones (tienen prioridad: "no, para el jueves" corrige, no descarta)
  var f = leerFecha(texto);
  if (f.iso && f.iso !== b.fecha) { b.fecha = f.iso; cambios.push('para ' + fechaTxt(f.iso)); }
  if (f.hora && f.hora !== b.hora) { b.hora = f.hora; cambios.push('a las ' + f.hora); }
  var mt = n.match(/ (?:es|sea|que sea|sera|como|cambia\w*(?: a)?|pasa\w*(?: a)?|hazlo|dejalo) (?:una? |como )?(recordatorio|tarea|visita|nota|prospeccion) /);
  if (mt) {
    var tp = mt[1] === 'prospeccion' ? 'prosp' : mt[1];
    if (tp !== b.tipo) { b.tipo = tp; if (tp === 'recordatorio' && !b.hora) b.hora = '09:00'; cambios.push('como ' + mt[1]); }
  }
  if (/ (sin cliente|ningun cliente) /.test(n)) { if (b.cli) { b.cli = ''; cambios.push('sin cliente'); } }
  else if (/ (el cliente|cliente es|es para|es de|para el cliente|con el cliente|a nombre de) /.test(n)) {
    var cs = buscarClientes(texto).filter(function (c) { return c.r !== b.cli; });
    if (cs.length) { b.clis = cs.concat(b.clis.filter(function (c) { return cs.indexOf(c) < 0; })).slice(0, 5); b.cli = cs[0].r; cambios.push('cliente ' + cs[0].n); }
  }
  var ma = texto.match(/\b(?:agr[eé]ga(?:le)?|a[nñ]ade(?:le)?|an[oó]ta(?:le)?|p[oó]nle)\s+(?:que\s+|como\s+detalle\s+)?(.+)$/i);
  if (ma && !f.iso && !f.hora && !mt) { b.detalle = (b.detalle ? b.detalle.replace(/[.\s]+$/, '') + '. ' : '') + capital(ma[1]); cambios.push('agregué el detalle'); }
  var mq = texto.match(/\b(?:que diga|el t[ií]tulo es|en vez de eso|mejor que diga)\s+(.+)$/i);
  if (mq) { b.titulo = capital(mq[1]); cambios.push('cambié el texto'); }
  if (cambios.length) { RESP_INTENTOS = 0; pintarBorrador(); preguntar('Listo, ' + cambios.join(', ') + '. ¿Lo guardo?'); return true; }
  // 2) Si o no
  var r = siNo(n);
  if (r > 0) { guardarBorrador(); return true; }
  if (r < 0) { cancelarBorrador(); decir('Bien, no lo guardo.'); return true; }
  // 2b) Una consulta clara ("precio del R32", "qué tengo hoy") no es una respuesta: se deja la tarjeta y se atiende
  if (/^(precio|stock|contacto|cotiz|pend|llamar|hecha)$/.test(intencion(texto))) { BORR = null; RESP_INTENTOS = 0; return false; }
  // 3) No quedo claro: se pregunta una vez mas y despues se deja la tarjeta
  if (++RESP_INTENTOS <= 1) { preguntar('No te entendí. Di sí para guardar, no para descartar, o dime qué cambio.'); return true; }
  estado('Revisa la tarjeta y toca Guardar o Cancelar'); return true;
}
function cancelarBorrador() { BORR = null; RESP_INTENTOS = 0; pintar(''); estado('Toca y habla'); }
/* Guardar es instantaneo para la persona (25-09-2026 tarde): se dice "listo", la tarea aparece
   en sus pendientes y se manda al CRM por detras (ver ESCRITURAS POR DETRAS). En terreno, sin
   senal, queda igual: se envia sola cuando vuelve. */
function guardarBorrador() {
  leerBorrador(); var b = BORR; if (!b) return;
  if (!b.titulo) { estado('Falta qué hay que hacer.', 'err'); return; }
  var c = CLI_POR_RUT[b.cli];
  var datos = { rid: ridNuevo(), titulo: b.titulo + (b.cot && b.titulo.indexOf(b.cot) < 0 ? ' (cot. ' + b.cot + ')' : ''), cliente: c ? c.n : '', fecha: b.fecha, hora: b.hora,
    detalle: b.detalle, prioridad: b.tipo === 'recordatorio' ? 'Alta' : 'Media', recordar: b.tipo === 'recordatorio' || !!b.hora, tipo: b.tipo, texto: b.detalle };
  BORR = null;
  var q = 'para ' + fechaTxt(datos.fecha) + (datos.hora ? ' a las ' + datos.hora : '');
  pintar('<div class="card"><h3>Guardado</h3><div class="n" style="font-weight:600">' + esc(datos.titulo) + '</div><div class="nota">' + esc(capital(q)) + (datos.cliente ? ' · ' + esc(datos.cliente) : '') + (datos.recordar ? ' · te llegará un aviso al teléfono' : '') + '</div>'
    + '<div class="nota" id="env_' + datos.rid + '">' + (navigator.onLine ? 'Enviando al CRM…' : 'Sin señal: se enviará al CRM cuando vuelva.') + '</div></div>');
  decir('Listo, ' + q + '.'); estado('Toca y habla');
  var f = datos.fecha.split('-'), dias = Math.round((new Date(+f[0], +f[1] - 1, +f[2]).getTime() - hoy0().getTime()) / 86400000);
  PEND.push({ id: 'prov-' + datos.rid, titulo: datos.titulo, cliente: datos.cliente, dias: dias, prio: datos.prioridad, detalle: datos.detalle });
  PEND.sort(function (x, y) { return (x.dias == null ? 999 : x.dias) - (y.dias == null ? 999 : y.dias); }); pintarBadge();
  colaAgregar('tarea', datos, datos.titulo + ' · ' + q);
}
// El CRM confirmo (o no) algo mandado por detras: se actualiza la tarjeta si sigue a la vista.
function colaListo(x, o) {
  var el = $('env_' + x.d.rid);
  if (x.a === 'tarea') {
    PEND.forEach(function (t) { if (t.id === 'prov-' + x.d.rid) t.id = o.id || t.id; });
    if (el) { el.className = 'nota'; el.textContent = '✓ Guardado en el CRM' + (o.aviso === 'ok' ? ' · con aviso en tu teléfono' : ''); }
    histAgregar('✓ ' + x.txt);
  } else if (x.a === 'hecha') { if (el) { el.className = 'nota'; el.textContent = '✓ Marcada en el CRM'; } histAgregar('✓ Hecha: ' + x.txt); }
  else if (x.a === 'gestion') { DM.gest.forEach(function (g) { if (g.rid === x.d.rid) g.folio = o.folio || g.folio; }); if (el) { el.className = 'nota'; el.textContent = o.prueba ? '✓ Registrada en modo prueba (todavía no va al CRM)' : '✓ Registrada en el CRM'; } histAgregar('✓ ' + x.txt); return; }
  cargarPendientes(null, true);
}
function colaFallo(x, err, quizas) {
  var m = (x.a === 'tarea' || x.a === 'gestion' ? (quizas ? 'Sin confirmación del CRM para: ' : 'No quedó guardado en el CRM: ') : 'No se marcó como hecha: ') + x.txt + '. ' + err;
  if (x.a === 'tarea' && !quizas) PEND = PEND.filter(function (t) { return t.id !== 'prov-' + x.d.rid; });
  if (x.a === 'gestion' && !quizas) DM.gest = DM.gest.filter(function (g) { return g.rid !== x.d.rid; });
  if (x.a === 'hecha' && !quizas) cargarPendientes(null, true);
  pintarBadge();
  var el = $('env_' + x.d.rid); if (el) { el.className = 'nota err'; el.textContent = m; }
  histAgregar('✗ ' + m); estado(m, 'err'); decir(m);
}

// ------------------------------------------------------------------ pendientes
/* Los pendientes viven en el telefono (vienen con la copia de datos y se refrescan por detras):
   "que tengo hoy" responde al instante, tambien sin senal. Lo recien guardado aparece de inmediato
   (id prov-...) y lo marcado como hecha desaparece de inmediato, aunque el CRM confirme despues. */
var PEND = [], PEND_T = 0;
function pintarBadge() {
  var n = PEND.filter(function (t) { return t.dias != null && t.dias <= 0; }).length, b = $('badge');
  if (!b) return; b.style.display = n ? 'inline-flex' : 'none'; b.innerHTML = '<b>' + n + '</b> para hoy';
}
function pendMezclar(tareas) {
  var cola = lsGet(LS.cola, []), hechas = {}, prov = PEND.filter(function (t) { return /^prov-/.test(t.id); });
  cola.forEach(function (x) { if (x.a === 'hecha') hechas[x.d.id] = 1; });
  return (tareas || []).filter(function (t) { return !hechas[t.id]; }).concat(prov);
}
function cargarPendientes(cb, fondo) {
  api('pendientes', {}, { fondo: fondo || !cb }).then(function (o) {
    if (!o.ok) return; PEND = pendMezclar(o.tareas); PEND_T = Date.now(); pintarBadge();
    if (cb) cb();
  }).catch(function () {});
}
function pintarPendientes() {
  var hoy = PEND.filter(function (t) { return t.dias != null && t.dias <= 0; }), prox = PEND.filter(function (t) { return t.dias == null || t.dias > 0; }).slice(0, 5);
  function fila(t) {
    var cuando = t.dias == null ? 'sin fecha' : (t.dias < 0 ? '<span class="pill crit">vencida ' + (-t.dias) + ' d</span>' : (t.dias === 0 ? '<span class="pill warn">hoy</span>' : (t.dias === 1 ? 'mañana' : 'en ' + t.dias + ' d')));
    return '<div class="fila"><div><div class="n">' + esc(t.titulo) + '</div><div class="s">' + (t.cliente ? esc(t.cliente) + ' · ' : '') + cuando + (/^prov-/.test(t.id) ? ' · <span class="pill warn">enviando al CRM</span>' : '') + '</div></div>'
      + '<div class="v"><button class="btn ok" style="min-height:38px;padding:0 12px;font-size:13px" type="button" onclick="marcarHecha(\'' + esc(t.id) + '\')">Hecha</button></div></div>';
  }
  pintar('<div class="card" id="pendCard"><h3>Para hoy · ' + hoy.length + '</h3>' + (hoy.length ? hoy.map(fila).join('') : '<div class="nota">Nada pendiente para hoy.</div>') + '</div>'
    + (prox.length ? '<div class="card"><h3>Próximos</h3>' + prox.map(fila).join('') + '</div>' : '')
    + (PEND_T ? '<div class="nota">Actualizado ' + horaTxt(PEND_T) + '</div>' : ''));
}
function verPendientes(hablar) {
  function decirlo() {
    if (!hablar) return;
    var hoy = PEND.filter(function (t) { return t.dias != null && t.dias <= 0; });
    decir(hoy.length ? 'Tienes ' + hoy.length + ' para hoy: ' + hoy.slice(0, 3).map(function (t) { return t.titulo; }).join('; ') : 'No tienes nada pendiente para hoy.');
  }
  if (PEND_T) { pintarPendientes(); estado('Toca y habla'); decirlo(); cargarPendientes(function () { if ($('pendCard')) pintarPendientes(); }, true); return; }
  estado('Buscando…');
  cargarPendientes(function () { estado('Toca y habla'); pintarPendientes(); decirlo(); });
}
function marcarHecha(id) {
  HECHA_PEND = null;
  if (/^prov-/.test(id)) { var m = 'Esa tarea todavía está en camino al CRM: espera un momento.'; estado(m, 'err'); decir(m); return; }
  var t = PEND.filter(function (x) { return x.id === id; })[0], rid = ridNuevo();
  PEND = PEND.filter(function (x) { return x.id !== id; }); pintarBadge();
  decir('Listo.'); estado('Toca y habla');
  if ($('pendCard')) pintarPendientes();
  else pintar('<div class="card"><h3>Hecha</h3><div class="n" style="font-weight:600">' + esc(t ? t.titulo : id) + '</div><div class="nota" id="env_' + rid + '">' + (navigator.onLine ? 'Enviando al CRM…' : 'Sin señal: se enviará al CRM cuando vuelva.') + '</div></div>');
  colaAgregar('hecha', { id: id, rid: rid }, t ? t.titulo : id);
}
function cerrarPorVoz(texto, cli) {
  (PEND_T ? function (cb) { cb(); } : cargarPendientes)(function () {
    var ws = norm(texto).split(' '), cand = PEND.map(function (t) {
      var tt = norm(t.titulo + ' ' + t.cliente).split(' '), sc = 0;
      tt.forEach(function (w) { if (w.length > 3 && ws.indexOf(w) >= 0) sc++; });
      if (cli && t.cliente && norm(t.cliente) === norm(cli.n)) sc += 3;
      return { t: t, sc: sc };
    }).filter(function (x) { return x.sc > 0; }).sort(function (a, b) { return b.sc - a.sc; });
    if (!cand.length) { verPendientes(false); decir('¿Cuál de tus pendientes? Toca Hecha en la que corresponde.'); return; }
    var t = cand[0].t;
    pintar('<div class="card"><h3>Marcar como hecha</h3><div class="n" style="font-weight:600">' + esc(t.titulo) + '</div><div class="nota">' + esc(t.cliente || '') + '</div>'
      + '<div class="acciones"><button class="btn s" type="button" onclick="verPendientes(false)">Otra</button><button class="btn ok" type="button" onclick="marcarHecha(\'' + esc(t.id) + '\')">Hecha</button></div></div>');
    BORR = null; HECHA_PEND = t; preguntar('¿Marco como hecha: ' + t.titulo + '?');
  });
}


// ------------------------------------------------------------------ CHAT con IA (25-09-2026)
/* Humberto: "es muy tonto el sistema, la idea es que sea tipo chat bot". Con la IA
   configurada, todo lo dicho va a la conversacion: el modelo consulta precios, stock,
   clientes y pendientes, y guarda tareas preguntando antes. Si la IA no esta (sin clave,
   sin cuota o sin senal), responde el motor por reglas de siempre. */
/* IA se recuerda de la ultima vez (voz_ia): si Google demora o pierde la respuesta de "inicio",
   la app igual conversa con la IA en vez de caer al motor por reglas (25-09-2026). */
var IA = lsGet('voz_ia', true), ADMIN = false, CHAT = lsGet('voz_chat', { t: 0, m: [] });
function fijarIA(v) { IA = !!v; lsSet('voz_ia', IA); if ($('nueva')) $('nueva').style.display = IA ? 'inline-flex' : 'none'; }
if (Date.now() - (CHAT.t || 0) > 30 * 60000) CHAT = { t: 0, m: [] };      // conversacion nueva tras 30 min
function chatGuardar() { CHAT.t = Date.now(); CHAT.m = CHAT.m.slice(-24); lsSet('voz_chat', CHAT); }
function burbuja(quien, html) {
  var d = document.createElement('div'); d.className = 'burb ' + quien; d.innerHTML = html;
  $('res').appendChild(d); $('ayuda').classList.add('oculto');
  setTimeout(function () { d.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, 30);
  return d;
}
function chatear(texto) {
  $('vivo').textContent = '';
  if (!$('res').querySelector('.burb')) $('res').innerHTML = '';
  burbuja('u', esc(texto));
  var pensando = burbuja('m pens', '<span></span><span></span><span></span>');
  estado('Pensando…');
  // En terreno, sin mirar la pantalla: si Google se demora, se avisa de viva voz una vez.
  var aviso = setTimeout(function () { decir('Un momento, estoy revisando.'); }, 6000);
  api('chat', { texto: texto, historial: CHAT.m }, { ms: 30000, alReintentar: function () { estado('Google está lento: sigo esperando la respuesta…'); } }).then(function (o) {
    clearTimeout(aviso); pensando.remove();
    if (!o.ok) {
      if (o.sinIA || o.cuota) { if (o.sinIA) fijarIA(false); burbuja('m', '<span class="nota">' + esc(o.error) + ' Uso el modo básico.</span>'); procesarLocal(texto); return; }
      burbuja('m', '<span class="err">' + esc(o.error || 'No se pudo.') + '</span>'); estado('Toca y habla'); return;
    }
    CHAT.m.push({ r: 'u', t: texto }, { r: 'm', t: o.texto }); chatGuardar();
    burbuja('m', esc(o.texto));
    (o.tarjetas || []).forEach(function (t) { var h = tarjetaChat(t); if (h) burbuja('m tarj', h); });
    if ((o.tarjetas || []).some(function (t) { return t.tipo === 'guardado' || t.tipo === 'hecha'; })) { histAgregar('✓ ' + o.texto.slice(0, 80)); cargarPendientes(); }
    estado('Toca y habla');
    // Si la IA pregunta algo, se escucha la respuesta sin tener que tocar nada.
    decir(o.texto, function () { if (/\?\s*$/.test(o.texto) && lsGet(LS.conf, true)) setTimeout(function () { escuchar(function (r) { if (r) chatear(r); else estado('Toca y habla'); }, true); }, 150); });
  }).catch(function (e) {
    clearTimeout(aviso); pensando.remove();
    // Sin senal solo se puede dejar anotado lo que se pidio guardar (se manda al volver la senal).
    if (e.red || !navigator.onLine) {
      burbuja('m', '<span class="nota">Sin conexión.</span>');
      if (/^(recordatorio|tarea|visita|prosp|nota)$/.test(intencion(texto))) procesarLocal(texto); else estado('Sin conexión: pregúntame de nuevo cuando tengas señal.', 'err');
      return;
    }
    // Ya se reintento con el mismo rid. Si era un "si, guardalo", puede haber quedado guardado.
    var conf = /^\s*(s[ií]\b|dale|ok|okey|gu[aá]rd|confirm|listo|claro)/i.test(texto);
    burbuja('m', '<span class="nota">No me llegó la respuesta: Google está demorando. '
      + (conf ? 'Revisa en tus pendientes si quedó guardado antes de repetirlo.' : 'Vuelve a preguntarme en unos segundos.') + '</span>');
    estado('Toca y habla');
  });
}
function tarjetaChat(t) {
  var d = t.datos || {};
  if (t.tipo === 'precio' || t.tipo === 'stock') {
    var its = d.items || []; if (!its.length) return '';
    return '<div class="tt">' + (t.tipo === 'precio' ? 'Precio · ' + esc(d.listaNom || '') + (d.cliente ? ' · ' + esc(d.cliente) : '') : 'Stock') + '</div>' + its.map(function (x) {
      return '<div class="fila"><div><div class="n">' + esc(x.desc) + '</div><div class="s">' + esc(x.cod) + (t.tipo === 'stock' && x.bod && x.bod.length ? ' · ' + x.bod.map(function (b) { return esc(b.b) + ' ' + b.s; }).join(' · ') : '') + '</div></div>'
        + '<div class="v">' + (t.tipo === 'precio' ? pesos(x.precio) + '<small>+ IVA · stock ' + (x.stock || 0) + '</small>' : (x.stock || 0) + '<small>unidades</small>') + '</div></div>';
    }).join('');
  }
  if (t.tipo === 'cliente') {
    var c = d.cliente || {}, cs = d.cotizaciones || [], h = '<div class="tt">Cliente · ' + esc(c.lista || '') + (c.bloqueado ? ' · <span class="pill crit">Bloqueado</span>' : '') + '</div><div class="n" style="font-weight:700">' + esc(c.nombre) + '</div>';
    if (c.fono) h += '<div class="fila"><div class="s">Teléfono</div><div class="v"><a href="tel:' + esc(c.fono.replace(/[^\d+]/g, '')) + '">' + esc(c.fono) + '</a></div></div>';
    if (c.mail) h += '<div class="fila"><div class="s">Correo</div><div class="v" style="font-weight:500"><a href="mailto:' + esc(c.mail) + '">' + esc(c.mail) + '</a></div></div>';
    if (c.dir || c.comuna) h += '<div class="fila"><div class="s">Dirección</div><div class="v" style="font-weight:500"><a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(((c.dir || '') + ' ' + (c.comuna || '')).trim()) + '">' + esc(((c.dir || '') + ', ' + (c.comuna || '')).replace(/^, |, $/g, '')) + '</a></div></div>';
    if (cs.length) h += cs.map(function (q) {
      var R = d.reglas || { vig: 5, cal: 14 }, vig = q.dias <= R.vig, cal = q.dias < R.cal;
      return '<div class="fila"><div><div class="n">Cot. ' + esc(q.folio) + '</div><div class="s">' + esc(q.fecha) + ' · ' + q.dias + ' d</div></div><div class="v">' + pesos(q.monto) + '<small>' + (cal ? (vig ? '<span class="pill ok">precio vigente</span>' : '<span class="pill warn">actualizar precio</span>') : 'antigua') + '</small></div></div>';
    }).join('');
    return h;
  }
  if (t.tipo === 'pendientes') {
    var ps = d || []; if (!ps.length) return '<div class="tt">Pendientes</div><div class="nota">Nada pendiente.</div>';
    return '<div class="tt">Pendientes</div>' + ps.slice(0, 8).map(function (x) {
      var cuando = x.dias == null ? 'sin fecha' : (x.dias < 0 ? '<span class="pill crit">vencida ' + (-x.dias) + ' d</span>' : (x.dias === 0 ? '<span class="pill warn">hoy</span>' : (x.dias === 1 ? 'mañana' : 'en ' + x.dias + ' d')));
      return '<div class="fila"><div><div class="n">' + esc(x.titulo) + '</div><div class="s">' + (x.cliente ? esc(x.cliente) + ' · ' : '') + cuando + '</div></div></div>';
    }).join('');
  }
  if (t.tipo === 'guardado') return '<div class="tt">Guardado en el CRM</div><div class="n" style="font-weight:600">' + esc(d.titulo) + '</div><div class="nota">' + esc(capital(fechaTxt(d.fecha))) + (d.hora ? ' a las ' + esc(d.hora) : '') + (d.cliente ? ' · ' + esc(d.cliente) : '') + (d.aviso === 'ok' ? ' · con aviso en tu teléfono' : '') + '</div>';
  if (t.tipo === 'hecha') return '<div class="tt">Marcada como hecha</div>';
  if (t.tipo === 'gestion') return '<div class="tt">' + (d.prueba ? 'Gestión registrada (modo prueba)' : 'Gestión registrada en el CRM') + '</div><div class="n" style="font-weight:600">' + esc(d.cliente) + '</div><div class="nota">' + esc(capital(M.gestTxt(d.tipo, d.metodo))) + (d.comentario ? ' · ' + esc(d.comentario) : '') + '</div>';
  return '';
}
function nuevaConversacion() { CHAT = { t: 0, m: [] }; lsSet('voz_chat', CHAT); pintar(''); estado('Toca y habla'); }
// Configuracion de la IA: solo cuentas admin. La clave la pega la persona y va directo a la API.
function abrirConfig() {
  pintar('<div class="card"><h3>Inteligencia artificial</h3><div class="nota" id="cfgEst">Consultando…</div>'
    + '<div class="campo"><label for="cfgProv">Proveedor</label><select id="cfgProv"><option value="claude">Claude (Anthropic)</option><option value="gemini">Gemini (Google AI Studio)</option></select></div>'
    + '<div class="campo"><label for="cfgKey">Clave</label><input id="cfgKey" type="password" autocomplete="off" placeholder="Pega aquí la clave"></div>'
    + '<div class="acciones"><button class="btn s" type="button" id="cfgQuitar">Quitar clave</button><button class="btn p" type="button" id="cfgGuardar">Guardar y probar</button></div></div>');
  function mostrar(o) {
    if (!o.ok) { $('cfgEst').textContent = o.error || 'No se pudo.'; return; }
    $('cfgEst').textContent = (o.configurada ? 'En uso: ' + o.enUso + ' · Claude ' + (o.claude ? 'con clave' : 'sin clave') + ' · Gemini ' + (o.gemini ? 'con clave' : 'sin clave') : 'Sin clave: se usa el modo básico.') + (o.prueba ? ' · Prueba: ' + o.prueba : '');
    fijarIA(o.configurada);
  }
  function falla(e) { $('cfgEst').textContent = errTxt(e); }
  api('configIA', {}).then(mostrar, falla);
  $('cfgGuardar').onclick = function () { var k = $('cfgKey').value.trim(); if (!k) return; $('cfgEst').textContent = 'Guardando y probando…'; api('configIA', { clave: k, proveedor: $('cfgProv').value, probar: true }).then(function (o) { $('cfgKey').value = ''; mostrar(o); }, falla); };
  $('cfgQuitar').onclick = function () { api('configIA', { clave: '', proveedor: $('cfgProv').value }).then(mostrar, falla); };
}

// ------------------------------------------------------------------ pantalla
function pintar(h) { $('res').innerHTML = h; if (h) $('ayuda').classList.add('oculto'); else $('ayuda').classList.remove('oculto'); }
function histAgregar(t) { var h = lsGet(LS.hist, []); h.unshift({ t: t, f: Date.now() }); lsSet(LS.hist, h.slice(0, 8)); pintarHist(); }
function pintarHist() {
  var h = lsGet(LS.hist, []);
  $('hist').classList.toggle('oculto', !h.length);
  $('histList').innerHTML = h.map(function (x) { var d = new Date(x.f); return '<div class="fila"><div class="n">' + esc(x.t) + '</div><div class="s">' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + '</div></div>'; }).join('');
}
var EJEMPLOS = ['Recuérdame llamar a Clima Norte el martes a las 10 por la cotización 41022', 'Precio bomba de vacío 5 CFM para Frío Sur',
  'Stock de R410A', 'Teléfono de Refritec', 'Llamé a Clima Norte y quedó en enviar la orden', 'Qué hablé con Refritec', 'Últimas facturas de Frío Sur', 'Cómo voy respecto al año pasado',
  'Cuántas cotizaciones he vendido este mes', 'Qué tengo hoy', 'Ya llamé a Clima Norte'];
function mostrarSetup() { $('setup').style.display = 'block'; $('app').classList.add('oculto'); }

function iniciar() {
  // El enlace de acceso trae la clave despues de #t=: se guarda y se borra de la barra.
  var m = location.hash.match(/[#&]t=([A-Za-z0-9_\-]{20,})/);
  if (m) { lsSet(LS.t, m[1]); history.replaceState(null, '', location.pathname + location.search); }
  if (!lsGet(LS.t, '')) { mostrarSetup(); return; }
  $('app').classList.remove('oculto');
  $('ejemplos').innerHTML = EJEMPLOS.map(function (e) { return '<button type="button">' + esc(e) + '</button>'; }).join('');
  $('ejemplos').onclick = function (ev) { var b = ev.target.closest('button'); if (b) { $('txt').value = b.textContent; $('txt').focus(); } };
  $('mic').onclick = function () { if (window.speechSynthesis) speechSynthesis.cancel(); escuchar(hayPregunta() ? respuestaVoz : null); };
  $('badge').onclick = function () { verPendientes(false); };
  $('cfg').onclick = abrirConfig;
  $('nueva').onclick = nuevaConversacion;
  $('formTxt').onsubmit = function (ev) { ev.preventDefault(); var t = $('txt').value.trim(); if (t) { $('txt').value = ''; $('txt').blur(); if (!responder(t)) procesar(t); } };
  pintarHist(); fijarIA(IA);
  prepararClientes(); CLI.lista.forEach(function (c) { CLI_POR_RUT[c.r] = c; });
  datosCargar();                       // lo del telefono: hay con que responder desde el primer segundo, con o sin senal
  colaVaciar();                        // lo que quedo por mandar la ultima vez
  api('inicio', {}).then(function (o) {
    if (!o.ok) return;
    $('who').textContent = o.nombre;
    fijarIA(o.ia); ADMIN = !!o.admin;
    $('cfg').style.display = ADMIN ? 'inline-flex' : 'none';
    if (!DAT.t || (o.clientes || []).length > CLI.lista.length) {
      CLI = { lista: o.clientes || [], t: Date.now() }; lsSet(LS.cli, CLI); prepararClientes();
      CLI_POR_RUT = {}; CLI.lista.forEach(function (c) { CLI_POR_RUT[c.r] = c; });
    }
    if (!PEND_T) { var b = $('badge'); b.style.display = o.pend ? 'inline-flex' : 'none'; b.innerHTML = '<b>' + o.pend + '</b> para hoy'; }
    // ?modo=config abre directo la pantalla de la clave de la IA (solo admin).
    if (new URLSearchParams(location.search).get('modo') === 'config') { if (ADMIN) abrirConfig(); else estado('La configuración de la IA es solo para administradores.', 'err'); }
  }).catch(function (e) { estado(e.red ? 'Sin conexión: respondo con los datos del teléfono; lo que guardes se enviará al volver la señal.' : 'El CRM tardó en responder: puedes dictar igual.'); });
  // La copia de datos, en segundo plano (la fila "f" espera a que "inicio" vuelva) y cada 20 min.
  datosPedir(true);
  setInterval(function () { datosPedir(); }, 5 * 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { datosPedir(); colaVaciar(); } });
  // Abierta desde el icono o un acceso directo: a hablar de inmediato.
  var q = new URLSearchParams(location.search);
  if (q.get('modo') === 'pendientes') verPendientes(true);
  else if (q.get('mic') === '1') setTimeout(function () { escuchar(); }, 350);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
}
iniciar();
