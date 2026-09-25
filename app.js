/* Voz Refrichile — app del telefono (24-09-2026).
   Se habla, la app interpreta la frase aca mismo (sin servicios pagados), muestra lo
   que entendio en una tarjeta y lo guarda en el CRM con un toque o diciendo "si".
   El reconocimiento de voz es el del propio Chrome del telefono. */
'use strict';

var API = 'https://script.google.com/macros/s/AKfycbzVb04pQ1_QjrVcKzHMB5hSeyukZ62_7gMxrXmhZXVfhS6ldZ5COgVM1SiaMtaUBHzZ/exec';
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
function api(accion, datos) {
  var body = Object.assign({ t: lsGet(LS.t, ''), accion: accion }, datos || {});
  // text/plain: Apps Script responde sin preflight de CORS.
  return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json(); })
    .then(function (o) { if (o && o.sinClave) mostrarSetup(); return o; });
}

// Cola sin conexion: lo que se guarda sin senal se manda solo al volver.
function colaAgregar(accion, datos) { var c = lsGet(LS.cola, []); c.push({ a: accion, d: datos, t: Date.now() }); lsSet(LS.cola, c); }
function colaVaciar() {
  var c = lsGet(LS.cola, []); if (!c.length || !navigator.onLine) return;
  var x = c[0];
  api(x.a, x.d).then(function (o) {
    if (o && o.ok) { c.shift(); lsSet(LS.cola, c); histAgregar('Enviado (estaba sin conexión): ' + (x.d.titulo || x.a)); colaVaciar(); }
  }).catch(function () {});
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
function escuchar(confirmacion) {
  if (!SR) { estado('Este navegador no reconoce voz: escribe abajo.', 'err'); return; }
  if (escuchando) { try { rec.stop(); } catch (e) {} return; }
  modoConfirmar = confirmacion || null;
  rec = new SR(); rec.lang = 'es-CL'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
  var final = '';
  rec.onstart = function () { escuchando = true; $('mic').classList.add('on'); estado(modoConfirmar ? 'Te escucho: sí, no, o qué cambio' : 'Te escucho…'); $('vivo').textContent = ''; };
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
function tokensCli(n) { return norm(n).replace(/[.,\-]/g, ' ').split(' ').filter(function (w) { return w.length > 2 && SUF.indexOf(' ' + w + ' ') < 0; }); }
function prepararClientes() {
  var df = {};
  CLI.lista.forEach(function (c) { c._t = tokensCli(c.n); c._t.forEach(function (w) { df[w] = (df[w] || 0) + 1; }); });
  var N = Math.max(1, CLI.lista.length);
  Object.keys(df).forEach(function (w) { IDF[w] = Math.log(1 + N / df[w]); });
}
function parecido(a, b) {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  var i = 0, j = 0, dif = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++dif > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return dif + (a.length - i) + (b.length - j) <= 1;
}
// Clientes de la cartera que calzan con la frase, del mas probable al menos.
function buscarClientes(frase) {
  var ws = norm(frase).replace(/[.,\-]/g, ' ').split(' ').filter(function (w) { return w.length > 1 && SUF.indexOf(' ' + w + ' ') < 0; }), out = [];
  // Chrome a veces parte un nombre de fantasia en dos: "acondi termic" = aconditermic.
  var n0 = ws.length; for (var i = 0; i < n0 - 1; i++) { ws.push(ws[i] + ws[i + 1]); if (i < n0 - 2) ws.push(ws[i] + ws[i + 1] + ws[i + 2]); }
  CLI.lista.forEach(function (c) {
    if (!c._t || !c._t.length) return;
    var sc = 0, tot = 0, hit = 0;
    c._t.forEach(function (w) { var idf = IDF[w] || 1; tot += idf; if (ws.some(function (x) { return parecido(x, w); })) { sc += idf; hit++; } });
    if (!hit) return;
    var cob = sc / tot;
    if (sc >= 2.2 || cob >= .6) { c._cob = cob; out.push({ c: c, sc: sc + cob * 3 }); }
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
  pend: /\b(que tengo|mis (pendientes|tareas|recordatorios)|que me toca|pendientes (de|para) hoy|que hay (para|de) hoy|mi agenda)\b/,
  record: /\b(recuerd\w*|recordatorio|recordar|avisame|acuerdame|no (me )?olvid\w*)\b/,
  contacto: /\b(telefono|fono|celular|numero de (telefono|contacto)|correo|mail|email|direccion|donde queda|ubicacion|contacto de|datos de)\b/,
  cotiz: /\b(cotizaciones?( abiertas| pendientes)? (de|del|a|para)|que (le )?(tengo |he )?cotizad\w*|que le cotice)\b/,
  stock: /\b(stock|hay (stock|disponible|disponibilidad)|cuant[oa]s? (hay|quedan|tenemos)|disponibilidad)\b/,
  precio: /\b(precio|precios|cuanto (cuesta|sale|vale|esta)|a como (esta|sale)|valor (de|del))\b/,
  visita: /\b(visite|visitamos|estuve (con|en|donde)|fui (a|donde)|pase (a|por|donde)|me reuni|reunion con)\b/,
  prosp: /\b(prospect\w*|nuevo (negocio|cliente|proyecto)|oportunidad|posible (cliente|negocio)|potencial cliente)\b/,
  tarea: /\b(tarea|tengo que|hay que|debo|volver a (llamar|consultar|contactar|visitar|escribir|cotizar)|llamar a|consultar a|enviar|mandar|agendar)\b/
};
function intencion(t) {
  var n = ' ' + norm(t) + ' ';
  if (R.record.test(n)) return 'recordatorio';
  if (R.hecha.test(n)) return 'hecha';
  if (R.pend.test(n)) return 'pend';
  // "Tengo que enviar la lista de precios" es una tarea, no una consulta de precio.
  if (/(tengo que|hay que|debo|volver a|no olvidar)/.test(n)) return 'tarea';
  var orden = ['contacto', 'cotiz', 'stock', 'precio', 'visita', 'prosp', 'tarea'];
  for (var i = 0; i < orden.length; i++) if (R[orden[i]].test(n)) return orden[i];
  return leerFecha(t).iso ? 'recordatorio' : 'nota';
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
  s = s.replace(/ (precio|precios|cuanto (cuesta|sale|vale|esta)|a como (esta|sale)|valor (de|del)|stock|hay stock|hay disponible|disponibilidad|cuant[oa]s? (hay|quedan|tenemos)) /g, ' ');
  if (cli) { cli._t.forEach(function (w) { s = s.replace(new RegExp(' ' + w + ' ', 'g'), ' '); }); s = s.replace(/ (para|a|al|del|de) (cliente )?\s*$/, ' '); s = s.replace(/ para (el cliente )?$/, ' '); }
  // Refrigerantes como los dicta Chrome: "erre 410 a", "R 410 A", "r-32" -> r410a, r32
  s = s.replace(/ erre /g, ' r ').replace(/ r ?-? ?(\d{2,3}) ?([a-z])?(?= )/g, function (x, n, l) { return ' r' + n + (l || '') + ' '; });
  return s.replace(/ (de|del|para|el|la|un|una)(?= )/g, ' ').replace(/ (de|del|para|el|la|un|una)(?= )/g, ' ').replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------------ procesar una frase
function procesar(texto) {
  $('vivo').textContent = texto;
  var tipo = intencion(texto), clis = buscarClientes(texto), cli = clis[0] || null;
  if (tipo === 'pend') return verPendientes(true);
  if (tipo === 'hecha') return cerrarPorVoz(texto, cli);
  if (tipo === 'precio' || tipo === 'stock') {
    var q = productoDe(texto, tipo === 'precio' ? cli : null);
    if (!q) { estado('¿De qué producto?'); decir('¿De qué producto?'); return; }
    return consultar(tipo, q, tipo === 'precio' ? cli : null, texto);
  }
  if (tipo === 'contacto' || tipo === 'cotiz') {
    if (!cli) { estado('No reconocí el cliente. Dilo de nuevo con su nombre.', 'err'); decir('No reconocí el cliente'); return; }
    return fichaCliente(cli, tipo, texto);
  }
  tarjetaTarea(tipo, texto, clis);
}

function consultar(tipo, q, cli, texto) {
  estado('Buscando…');
  api(tipo, { q: q, rut: cli ? cli.r : '', texto: texto }).then(function (o) {
    if (!o.ok) { estado(o.error || 'No se pudo.', 'err'); return; }
    estado('Toca y habla');
    var its = o.items || [];
    if (!its.length) { pintar('<div class="card"><h3>' + (tipo === 'precio' ? 'Precio' : 'Stock') + '</h3>No encontré “' + esc(q) + '”. Prueba con otras palabras o el código.</div>'); decir('No encontré ese producto'); return; }
    var cab = tipo === 'precio' ? 'Precio <span class="tag">' + esc(o.listaNom) + (o.cliente ? ' · ' + esc(o.cliente) : '') + '</span>' : 'Stock';
    var filas = its.map(function (x) {
      return '<div class="fila"><div><div class="n">' + esc(x.desc) + '</div><div class="s">' + esc(x.cod) + (tipo === 'stock' && x.bod && x.bod.length ? ' · ' + x.bod.map(function (b) { return esc(b.b) + ' ' + b.s; }).join(' · ') : '') + '</div></div>'
        + '<div class="v">' + (tipo === 'precio' ? pesos(x.precio) + '<small>+ IVA · stock ' + (x.stock || 0) + '</small>' : (x.stock || 0) + '<small>unidades</small>') + '</div></div>';
    }).join('');
    pintar('<div class="card"><h3>' + cab + '</h3>' + filas + '</div>');
    var a = its[0];
    decir(tipo === 'precio'
      ? a.desc + ': ' + (a.precio ? Math.round(a.precio) + ' pesos más IVA, ' : 'sin precio de lista, ') + (o.cliente ? 'para ' + o.cliente : 'en ' + o.listaNom) + '. Stock ' + (a.stock || 0) + '.'
      : a.desc + ': ' + (a.stock || 0) + ' unidades.');
    histAgregar((tipo === 'precio' ? 'Precio: ' : 'Stock: ') + a.desc);
  }).catch(function () { estado('Sin conexión.', 'err'); });
}

function fichaCliente(cli, tipo, texto) {
  estado('Buscando…');
  api('cliente', { rut: cli.r, texto: texto }).then(function (o) {
    if (!o.ok) { estado(o.error || 'No se pudo.', 'err'); return; }
    estado('Toca y habla');
    var c = o.cliente, h = '<div class="card"><h3>Cliente <span class="tag">' + esc(c.lista || '') + '</span>' + (c.bloqueado ? ' <span class="pill crit">Bloqueado</span>' : '') + '</h3>'
      + '<div style="font-weight:700;font-size:17px;margin-bottom:6px">' + esc(c.nombre) + '</div>';
    if (c.fono) h += '<div class="fila"><div class="s">Teléfono</div><div class="v"><a href="tel:' + esc(c.fono.replace(/[^\d+]/g, '')) + '" style="color:var(--acc)">' + esc(c.fono) + '</a></div></div>';
    if (c.mail) h += '<div class="fila"><div class="s">Correo</div><div class="v" style="font-weight:500"><a href="mailto:' + esc(c.mail) + '" style="color:var(--acc)">' + esc(c.mail) + '</a></div></div>';
    if (c.dir || c.comuna) h += '<div class="fila"><div class="s">Dirección</div><div class="v" style="font-weight:500"><a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((c.dir + ' ' + c.comuna).trim()) + '" style="color:var(--acc)">' + esc((c.dir + ', ' + c.comuna).replace(/^, |, $/g, '')) + '</a></div></div>';
    var cs = o.cotizaciones || [];
    h += '<div style="margin-top:12px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--hint)">Cotizaciones abiertas</div>';
    h += cs.length ? cs.map(function (q) {
      var vig = q.dias <= o.reglas.vig, cal = q.dias < o.reglas.cal;
      return '<div class="fila"><div><div class="n">N° ' + esc(q.folio) + '</div><div class="s">' + esc(q.fecha) + ' · ' + q.dias + ' d</div></div><div class="v">' + pesos(q.monto)
        + '<small>' + (cal ? (vig ? '<span class="pill ok">precio vigente</span>' : '<span class="pill warn">actualizar precio</span>') : 'antigua') + '</small></div></div>';
    }).join('') : '<div class="nota">No tiene cotizaciones abiertas.</div>';
    h += '<div class="acciones">' + (c.fono ? '<a class="btn p" href="tel:' + esc(c.fono.replace(/[^\d+]/g, '')) + '">Llamar</a>' : '')
      + '<button class="btn s" type="button" onclick="tarjetaTarea(\'recordatorio\',\'Llamar a ' + esc(c.nombre).replace(/'/g, '') + '\',[CLI_POR_RUT[\'' + esc(cli.r) + '\']])">Recordatorio</button></div></div>';
    pintar(h);
    decir(tipo === 'contacto'
      ? (c.fono ? 'El teléfono de ' + c.nombre + ' es ' + c.fono.split('').join(' ') : c.nombre + ' no tiene teléfono registrado')
      : (cs.length ? c.nombre + ' tiene ' + cs.length + (cs.length === 1 ? ' cotización abierta' : ' cotizaciones abiertas') : c.nombre + ' no tiene cotizaciones abiertas'));
    histAgregar('Cliente: ' + c.nombre);
  }).catch(function () { estado('Sin conexión.', 'err'); });
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
  // 3) No quedo claro: se pregunta una vez mas y despues se deja la tarjeta
  if (++RESP_INTENTOS <= 1) { preguntar('No te entendí. Di sí para guardar, no para descartar, o dime qué cambio.'); return true; }
  estado('Revisa la tarjeta y toca Guardar o Cancelar'); return true;
}
function cancelarBorrador() { BORR = null; RESP_INTENTOS = 0; pintar(''); estado('Toca y habla'); }
function guardarBorrador() {
  leerBorrador(); var b = BORR; if (!b) return;
  if (!b.titulo) { estado('Falta qué hay que hacer.', 'err'); return; }
  var c = CLI_POR_RUT[b.cli];
  var datos = { titulo: b.titulo + (b.cot && b.titulo.indexOf(b.cot) < 0 ? ' (cot. ' + b.cot + ')' : ''), cliente: c ? c.n : '', fecha: b.fecha, hora: b.hora,
    detalle: b.detalle, prioridad: b.tipo === 'recordatorio' ? 'Alta' : 'Media', recordar: b.tipo === 'recordatorio' || !!b.hora, tipo: b.tipo, texto: b.detalle };
  BORR = null; $('bSi').disabled = true; estado('Guardando…');
  var ok = function () {
    var q = 'para ' + fechaTxt(datos.fecha) + (datos.hora ? ' a las ' + datos.hora : '');
    pintar('<div class="card"><h3>Guardado</h3><div class="n" style="font-weight:600">' + esc(datos.titulo) + '</div><div class="nota">' + esc(capital(q)) + (datos.cliente ? ' · ' + esc(datos.cliente) : '') + (datos.recordar ? ' · te llegará un aviso al teléfono' : '') + '</div></div>');
    decir('Listo, ' + q + '.'); estado('Toca y habla'); histAgregar('✓ ' + datos.titulo + ' · ' + q); cargarPendientes();
  };
  if (!navigator.onLine) { colaAgregar('tarea', datos); ok(); estado('Sin conexión: se enviará al volver la señal.'); return; }
  api('tarea', datos).then(function (o) { if (o.ok) ok(); else { estado(o.error || 'No se pudo guardar.', 'err'); BORR = b; pintarBorrador(); } })
    .catch(function () { colaAgregar('tarea', datos); ok(); estado('Sin conexión: se enviará al volver la señal.'); });
}

// ------------------------------------------------------------------ pendientes
var PEND = [];
function cargarPendientes(cb) {
  api('pendientes', {}).then(function (o) {
    if (!o.ok) return; PEND = o.tareas || [];
    var n = PEND.filter(function (t) { return t.dias != null && t.dias <= 0; }).length, b = $('badge');
    b.style.display = n ? 'inline-flex' : 'none'; b.innerHTML = '<b>' + n + '</b> para hoy';
    if (cb) cb();
  }).catch(function () {});
}
function verPendientes(hablar) {
  estado('Buscando…');
  cargarPendientes(function () {
    estado('Toca y habla');
    var hoy = PEND.filter(function (t) { return t.dias != null && t.dias <= 0; }), prox = PEND.filter(function (t) { return t.dias == null || t.dias > 0; }).slice(0, 5);
    function fila(t) {
      var cuando = t.dias == null ? 'sin fecha' : (t.dias < 0 ? '<span class="pill crit">vencida ' + (-t.dias) + ' d</span>' : (t.dias === 0 ? '<span class="pill warn">hoy</span>' : (t.dias === 1 ? 'mañana' : 'en ' + t.dias + ' d')));
      return '<div class="fila"><div><div class="n">' + esc(t.titulo) + '</div><div class="s">' + (t.cliente ? esc(t.cliente) + ' · ' : '') + cuando + '</div></div>'
        + '<div class="v"><button class="btn ok" style="min-height:38px;padding:0 12px;font-size:13px" type="button" onclick="marcarHecha(\'' + esc(t.id) + '\')">Hecha</button></div></div>';
    }
    pintar('<div class="card"><h3>Para hoy · ' + hoy.length + '</h3>' + (hoy.length ? hoy.map(fila).join('') : '<div class="nota">Nada pendiente para hoy.</div>') + '</div>'
      + (prox.length ? '<div class="card"><h3>Próximos</h3>' + prox.map(fila).join('') + '</div>' : ''));
    if (hablar) decir(hoy.length ? 'Tienes ' + hoy.length + ' para hoy: ' + hoy.slice(0, 3).map(function (t) { return t.titulo; }).join('; ') : 'No tienes nada pendiente para hoy.');
  });
}
function marcarHecha(id) {
  HECHA_PEND = null;
  api('hecha', { id: id }).then(function (o) {
    if (o.ok) { var t = PEND.filter(function (x) { return x.id === id; })[0]; histAgregar('✓ Hecha: ' + (t ? t.titulo : id)); decir('Listo.'); verPendientes(false); }
    else estado(o.error || 'No se pudo.', 'err');
  });
}
function cerrarPorVoz(texto, cli) {
  cargarPendientes(function () {
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
  $('formTxt').onsubmit = function (ev) { ev.preventDefault(); var t = $('txt').value.trim(); if (t) { $('txt').value = ''; $('txt').blur(); if (!responder(t)) procesar(t); } };
  pintarHist();
  prepararClientes(); CLI.lista.forEach(function (c) { CLI_POR_RUT[c.r] = c; });
  api('inicio', {}).then(function (o) {
    if (!o.ok) return;
    $('who').textContent = o.nombre;
    CLI = { lista: o.clientes || [], t: Date.now() }; lsSet(LS.cli, CLI); prepararClientes();
    CLI_POR_RUT = {}; CLI.lista.forEach(function (c) { CLI_POR_RUT[c.r] = c; });
    var b = $('badge'); b.style.display = o.pend ? 'inline-flex' : 'none'; b.innerHTML = '<b>' + o.pend + '</b> para hoy';
    colaVaciar();
  }).catch(function () { estado('Sin conexión: puedes dictar igual, se enviará al volver la señal.'); });
  // Abierta desde el icono o un acceso directo: a hablar de inmediato.
  var q = new URLSearchParams(location.search);
  if (q.get('modo') === 'pendientes') verPendientes(true);
  else if (q.get('mic') === '1') setTimeout(function () { escuchar(); }, 350);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
}
iniciar();
