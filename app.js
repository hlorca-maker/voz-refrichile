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
var API_RELEER = { inicio: 1, calentar: 1, pendientes: 1, configIA: 1, datos: 1 }, API_RID = { chat: 1, tarea: 1, hecha: 1 };
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
var STOP_Q = ' tengo tienes tiene tenemos que cuando como donde quien cual hora dia llamar llamarlo llamarla llamarle llamo llame llama hablar visitar visite enviar mandar precio precios stock telefono fono correo direccion cotizacion cotizaciones recuerdame recordatorio tarea nota anota manana hoy pasado semana mes para por con del las los una uno dos tres cuatro cinco seis siete ocho nueve diez cliente empresa datos ficha contacto marca marcar hecha hecho lista mejor sobre ';
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
  CLI.lista.forEach(function (c) {
    if (!c._t || !c._t.length) return;
    var sc = 0, tot = 0, hit = 0;
    c._t.forEach(function (w) { var idf = IDF[w] || 1; tot += idf; if (ws.some(function (x) { return parecido(x, w); })) { sc += idf; hit++; } });
    if (!hit) return;
    var cob = sc / tot;
    if (laxo || sc >= 2.2 || cob >= .6) { c._cob = cob; out.push({ c: c, sc: sc + cob * 3 }); }
  });
  out.sort(function (a, b) { return b.sc - a.sc; });
  return out.slice(0, 4).map(function (x) { return x.c; });
}

// ------------------------------------------------------------------ fechas y horas
function leerFecha(f) {
  var t = ' ' + norm(f) + ' ', d = null, hora = '', usado = [];
  function quita(rx) { var m = t.match(rx); if (m) { usado.push(m[0].trim()); t = t.replace(rx, ' '); } return m; }
  var h0 = hoy0(), m;
  // Momento del dia
  if (quita(/ (en|por|de) la manana /)) hora = '09:00';
  if (quita(/ (en|por|de) la tarde /)) hora = hora || '15:00';
  if (quita(/ al mediodia /)) hora = '12:00';
  if ((m = quita(/ a las? (\d{1,2})(?:[:.](\d{2})| y (media|cuarto))?(?: (de la (manana|tarde|noche)|am|pm|hrs|horas))? /))) {
    var hh = +m[1], mm = m[2] ? +m[2] : (m[3] === 'media' ? 30 : (m[3] === 'cuarto' ? 15 : 0));
    var q = m[5] || m[4] || '';
    if ((q === 'tarde' || q === 'noche' || q === 'pm') && hh < 12) hh += 12;
    else if (!q && hh >= 1 && hh <= 7) hh += 12;          // "a las 3" en horario de oficina es la tarde
    hora = ('0' + hh).slice(-2) + ':' + ('0' + mm).slice(-2);
  } else if ((m = quita(/ (\d{1,2}):(\d{2}) /))) hora = ('0' + m[1]).slice(-2) + ':' + m[2];
  // Dia
  if (quita(/ pasado manana /)) { d = new Date(h0); d.setDate(d.getDate() + 2); }
  else if (quita(/ manana /)) { d = new Date(h0); d.setDate(d.getDate() + 1); }
  else if (quita(/ hoy /)) d = new Date(h0);
  else if ((m = quita(/ en (\w+) (dia|dias|semana|semanas|mes|meses) /))) {
    var n = numero(m[1]); if (n) { d = new Date(h0); if (/^dia/.test(m[2])) d.setDate(d.getDate() + n); else if (/^semana/.test(m[2])) d.setDate(d.getDate() + 7 * n); else d.setMonth(d.getMonth() + n); }
  } else if (quita(/ (la |para la )?(proxima|siguiente) semana /)) { d = new Date(h0); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); }
  else if (quita(/ (a |para )?fin de mes /)) { d = new Date(h0.getFullYear(), h0.getMonth() + 1, 0); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1); }
  else if ((m = quita(/ (?:el |este |para el |el proximo |proximo )?(lunes|martes|miercoles|jueves|viernes|sabado|domingo) /))) {
    var obj = DIAS.indexOf(m[1]); d = new Date(h0); var dd = (obj - d.getDay() + 7) % 7;
    if (dd === 0 && !/este/.test(m[0])) dd = 7; d.setDate(d.getDate() + dd);
  } else if ((m = quita(/ (?:el |para el )?(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre) /))) {
    var mes = MESES.indexOf(m[2] === 'setiembre' ? 'septiembre' : m[2]); d = new Date(h0.getFullYear(), mes, +m[1]); if (d < h0) d.setFullYear(d.getFullYear() + 1);
  } else if ((m = quita(/ (\d{1,2})\/(\d{1,2}) /))) {
    d = new Date(h0.getFullYear(), +m[2] - 1, +m[1]); if (d < h0) d.setFullYear(d.getFullYear() + 1);
  } else if ((m = quita(/ (?:el|para el) (\d{1,2}) /))) {
    d = new Date(h0.getFullYear(), h0.getMonth(), +m[1]); if (d < h0) d.setMonth(d.getMonth() + 1);
  }
  return { iso: d ? iso(d) : '', hora: hora, usado: usado };
}

// ------------------------------------------------------------------ que se quiere hacer
var R = {
  hecha: /\b(marca(r|la|lo)? (como )?(hecha|hecho|lista|listo|terminada)|ya (llame|hable|visite|hice|envie|mande|cotice)|termine (la tarea|de)|completar tarea)\b/,
  // "que tengo hoy" si; "que tengo cotizado a X" no (25-09-2026: eso es una consulta del cliente)
  pend: /\b(que tengo( pendiente\w*| que hacer)?( para| de)? (hoy|manana|esta semana)|que tengo pendiente\w*|(mis|los|las) (pendientes|tareas|recordatorios)|que me toca|pendientes (de|para) (hoy|manana)|que hay (para|de) hoy|mi agenda|agenda de hoy)\b|^ que tengo $/,
  record: /\b(recuerd\w*|recordatorio|recordar|avisame|acuerdame|no (me )?olvid\w*)\b/,
  llamar: /^ (quiero |necesito |voy a |hay que )?(llama\w*|marca\w*) (a |al |la |el |con )?/,
  contacto: /\b(telefono|fono|celular|numero de (telefono|contacto)|correo|mail|email|direccion|donde queda|ubicacion|contacto de|datos de)\b/,
  cotiz: /\b(cotizaciones?( abiertas| pendientes)? (de|del|a|para)|que (le )?(tengo |he )?cotizad\w*|que le cotice)\b/,
  stock: /\b(stock|hay (stock|disponible|disponibilidad)|cuant[oa]s? (?!se |le |les |nos )(\w+ ){0,3}(hay|quedan|tenemos)\b(?! vendid| factur| cobrad)|disponibilidad)\b/,
  precio: /\b(precio|precios|cuanto (le |les )?(cuesta|sale|vale|esta|cobra\w*)|a como (esta|sale)|valor (de|del)|a cuanto)\b/,
  visita: /\b(visite|visitamos|estuve (con|en|donde)|fui (a|donde)|pase (a|por|donde)|me reuni|reunion con)\b/,
  prosp: /\b(prospect\w*|nuevo (negocio|cliente|proyecto)|oportunidad|posible (cliente|negocio)|potencial cliente)\b/,
  tarea: /\b(tarea|tengo que|hay que|debo|volver a (llamar|consultar|contactar|visitar|escribir|cotizar)|llamar a|consultar a|enviar|mandar|agendar)\b/
};
function intencion(t) {
  var n = ' ' + norm(t) + ' ';
  if (R.record.test(n)) return 'recordatorio';
  if (R.hecha.test(n)) return 'hecha';
  if (R.pend.test(n)) return 'pend';
  // "Llama a Clima Norte" es llamar ahora; con fecha ("llamar a Clima Norte el martes") es una tarea.
  if (R.llamar.test(n) && !leerFecha(t).iso) return 'llamar';
  // "Tengo que enviar la lista de precios" es una tarea, no una consulta de precio.
  if (/\b(tengo que|hay que|debo|volver a|no olvidar)\b/.test(n)) return 'tarea';
  // Ventas, facturacion o cobranza no son ni stock ni precio ("cuantas ventas hay hoy"): eso no lo sabe la copia.
  var ventas = /\b(ventas?|vendid\w*|vendimos|vendio|vendi|factur\w*|cobranza|cobrad\w*)\b/.test(n);
  var orden = ['contacto', 'cotiz', 'stock', 'precio', 'visita', 'prosp', 'tarea'];
  for (var i = 0; i < orden.length; i++) if (R[orden[i]].test(n) && !(ventas && (orden[i] === 'stock' || orden[i] === 'precio'))) return orden[i];
  // Humberto (25-09-2026): "siempre cree que estoy creando una nota". Una nota solo si se pide;
  // una fecha sola es recordatorio solo si no es una pregunta; lo demas no se adivina.
  if (/ (anota\w*|apunta\w*|nota|registra que|deja (una )?nota) /.test(n)) return 'nota';
  // Humberto (25-09-2026, dos veces): "pregunte algo y se anoto como recordatorio". Una fecha sola
  // ("hoy", "manana") es recordatorio SOLO si la frase no tiene forma de pregunta ni de pedido de
  // informacion en ninguna parte; lo demas no se adivina (va a la IA o se dice que no se entendio).
  var pregunta = /\?/.test(t) || /^ (que|cual|cuales|cuanto|cuanta|cuantos|cuantas|como|donde|quien|quienes|cuando|dame|dime|busca\w*|muestrame) /.test(n)
    || /\b(cuanto|cuanta|cuantos|cuantas|cual|cuales|donde|quien|quienes|dame|dime|busca\w*|muestrame|puedes|podrias|quiero saber|necesito saber|sabes|cuentame|me dices|informame|vendido|vendimos|ventas|facturado|cobrado)\b/.test(n);
  return !pregunta && leerFecha(t).iso ? 'recordatorio' : 'nose';
}
function capital(s) { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
// Lo que queda de la frase para usar como titulo: sin la orden ni la fecha.
function tituloDe(t, fecha) {
  var s = ' ' + String(t) + ' ';
  fecha.usado.forEach(function (u) {
    var rx = new RegExp(' ' + u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(' ').map(function (w) { return w.replace(/[aeiou]/g, '[aeiouáéíóú]').replace(/n/g, '[nñ]'); }).join(' ') + ' ', 'i');
    s = s.replace(rx, ' ');
  });
  s = s.replace(/^\s*(recu[eé]rdame|recordarme|recordatorio( de| para)?|recordar|av[ií]same|acu[eé]rdame|anota( que)?|tengo que|hay que|debo|tarea( de| para)?)\s+/i, ' ');
  s = s.replace(/^\s*(que|de)\s+/i, ' ');
  return capital(s.replace(/\s+/g, ' ').trim()).slice(0, 150);
}
function cotizacionDe(t) { var m = norm(t).match(/cotizacion(?:es)?(?: (?:numero|nro|n|no))? ?(\d{3,7})/); return m ? m[1] : ''; }
function productoDe(t, cli) {
  var s = ' ' + norm(t) + ' ';
  s = s.replace(/ (dame|dime|me das|me dices|quiero|necesito|consulta(r)?|cual es|el|la|los|las)( | el | la )/g, ' ');
  s = s.replace(/ (precio|precios|cuanto (le |les )?(cuesta|sale|vale|esta|cobra\w*)|a como (esta|sale)|a cuanto|valor (de|del)|stock|hay stock|hay disponible|disponibilidad|cuant[oa]s? (hay|quedan|tenemos)|tenemos|tienen|tengo) /g, ' ');
  if (cli) { cli._t.forEach(function (w) { s = s.replace(new RegExp(' ' + w + ' ', 'g'), ' '); }); s = s.replace(/ (para|a|al|del|de) (cliente )?\s*$/, ' '); s = s.replace(/ para (el cliente )?$/, ' '); }
  // Refrigerantes como los dicta Chrome: "erre 410 a", "R 410 A", "r-32" -> r410a, r32
  s = s.replace(/ erre /g, ' r ').replace(/ r ?-? ?(\d{2,3}) ?([a-z])?(?= )/g, function (x, n, l) { return ' r' + n + (l || '') + ' '; });
  // Numeros dictados: "cinco cfm" = "5 cfm", "cuatro coma cinco" = "4.5" (un/una son articulos, no se tocan)
  s = s.replace(/ (dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta)(?= )/g, function (x, w) { return ' ' + NUM[w]; });
  s = s.replace(/(\d) (coma|punto) (\d)/g, '$1.$3').replace(/(\d) y medi[oa](?= )/g, '$1.5');
  return s.replace(/ (de|del|para|el|la|un|una)(?= )/g, ' ').replace(/ (de|del|para|el|la|un|una)(?= )/g, ' ').replace(/\s+/g, ' ').trim();
}

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
  DAT.cot = o.cot || [];
  if (o.tareas) { PEND = pendMezclar(o.tareas); PEND_T = DAT.t; pintarBadge(); }
  if (o.cli && o.cli.length) {
    CLI = { lista: o.cli.map(function (c) { return { r: c[0], n: c[1], l: c[2] }; }), t: DAT.t }; lsSet(LS.cli, CLI); prepararClientes();
    CLI_POR_RUT = {}; CLI.lista.forEach(function (c) { CLI_POR_RUT[c.r] = c; });
  }
}
function datosGuardar(o) { try { localStorage.setItem('voz_datos', JSON.stringify({ t: Date.now(), o: o })); } catch (e) {} }
function datosCargar() { var d = lsGet('voz_datos', null); if (d && d.o) datosUsar(d.o, d.t); }
function datosPedir(forzar) {
  if (DAT_PIDIENDO || !navigator.onLine) return;
  if (!forzar && Date.now() - DAT.t < 20 * 60000) return;
  DAT_PIDIENDO = true;
  api('datos', {}, { fondo: true, plazo: 150000, releer: 3 }).then(function (o) { DAT_PIDIENDO = false; if (o.ok) { datosUsar(o); datosGuardar(o); } }, function () { DAT_PIDIENDO = false; });
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
    if (gas && /refrigerante|\bgas\b|bombona|\bkg\b|cilindro/.test(it._t)) sc += 3;
    if (it._cod === qn) sc += 10;
    if (todas) sc += 3;
    if (sc >= Math.max(2, tks.length)) res.push({ it: it, sc: sc });
  });
  res.sort(function (a, b) { return b.sc - a.sc || a.it.desc.length - b.it.desc.length; });
  if (res.length) { var top = res[0].sc; res = res.filter(function (x) { return x.sc >= top - 1.5; }); }
  return res.slice(0, max || 5).map(function (x) { return x.it; });
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
  return procesarLocal(texto);
}
function rapido(texto) {
  if (!DAT.t) return false;
  var tipo = intencion(texto), clis = buscarClientes(texto), cli = clis[0] || null, n = ' ' + norm(texto) + ' ';
  var claro = !!cli && ((cli._cob || 0) >= .6 || clis.length === 1), nombrado = / (para|del cliente|de la empresa|a nombre de|donde) /.test(n);
  if (tipo === 'pend') { $('vivo').textContent = texto; verPendientes(true); return true; }
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
function verFicha(rut, tipo) { var f = fichaLocal(rut); if (f) { pintarFicha(f, tipo); estado('Toca y habla'); } else if (CLI_POR_RUT[rut]) fichaCliente(CLI_POR_RUT[rut], tipo, ''); }
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
  var a = its[0];
  decir(tipo === 'precio'
    ? a.desc + ': ' + (a.precio ? Math.round(a.precio) + ' pesos más IVA, ' : 'sin precio de lista, ') + (o.cliente ? 'para ' + o.cliente : 'en ' + o.listaNom) + '. Stock ' + (a.stock || 0) + '.'
    : a.desc + ': ' + (a.stock || 0) + ' unidades.');
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
  cargarPendientes(null, true);
}
function colaFallo(x, err, quizas) {
  var m = (x.a === 'tarea' ? (quizas ? 'Sin confirmación del CRM para: ' : 'No quedó guardado en el CRM: ') : 'No se marcó como hecha: ') + x.txt + '. ' + err;
  if (x.a === 'tarea' && !quizas) PEND = PEND.filter(function (t) { return t.id !== 'prov-' + x.d.rid; });
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
  'Stock de R410A', 'Teléfono de Refritec', 'Cotizaciones de Aire Total', 'Visité a Termoandes, quieren 20 bombas para octubre', 'Qué tengo hoy',
  'Ya llamé a Clima Norte'];
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
