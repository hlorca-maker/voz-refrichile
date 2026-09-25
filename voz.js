/* Voz Refrichile — MODO VOZ (25-09-2026): la esfera. Escucha, piensa (cerebro.js), habla y vuelve
   a escuchar; todo lo demas pasa por detras. Solo aparece un boton "Llamar" cuando se pidio
   llamar a alguien (marcar requiere tocar). */
(function () {
  'use strict';
  var API = 'https://script.google.com/macros/s/AKfycbw4Ax55jS8OKCvICEFsbYSiOWvlbgcuboILiwc4VYq92y_IcrgbMBnAK1LEUKvaVa_Omg/exec', M = window.VozMotor, $ = function (id) { return document.getElementById(id); };
  var alm = M.almacen('voz_'), datos = new M.Datos(), cartera = new M.Cartera();
  var m = location.hash.match(/[#&]t=([A-Za-z0-9_\-]{20,})/);
  if (m) { alm.set('t', m[1]); history.replaceState(null, '', location.pathname + location.search); }
  var api = new M.Api({ url: API, clave: function () { return alm.get('t', ''); }, alSinClave: function () { estado('La clave de acceso no es válida. Pide tu enlace nuevamente.', 'error'); } });
  var cola = new M.Cola(api, alm, { alListo: function (x, o) { cerebro.colaListo(x, o); }, alFallo: function (x, err) { decir((x.a === 'tarea' ? 'Ojo: no quedó guardado en el CRM: ' : 'Ojo: no se marcó como hecha: ') + x.txt + '. ' + err); } });
  var cerebro = new window.VozCerebro({ datos: datos, cartera: cartera, api: api, cola: cola, alm: alm, clave: function () { return alm.get('t', ''); } });
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, rec = null, escuchando = false, VOZ = null, ocupado = false, SEGUIR = alm.get('seguir', true);

  // ---------------------------------------------------------------- pantalla
  function fase(f) { document.body.className = f || ''; }
  function estado(t, f) { $('est').textContent = t; if (f) fase(f); }
  function caption(t, tenue) { $('cap').textContent = t || ''; $('cap').className = tenue ? 'tenue' : ''; }
  function chipTel(tel) { var a = $('tel'); if (tel) { a.href = 'tel:' + tel; a.classList.add('ver'); } else a.classList.remove('ver'); }
  function pie() { $('pie').textContent = datos.t ? 'Datos de las ' + M.horaTxt(datos.t) + (navigator.onLine === false ? ' · sin señal' : '') : (navigator.onLine === false ? 'Sin señal y sin datos guardados' : 'Cargando datos…'); }

  // ---------------------------------------------------------------- voz de salida
  function elegirVoz() {
    var vs = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
    VOZ = vs.filter(function (v) { return /^es[-_]CL/i.test(v.lang); })[0] || vs.filter(function (v) { return /^es[-_](US|419|MX)/i.test(v.lang); })[0] || vs.filter(function (v) { return /^es/i.test(v.lang); })[0] || null;
  }
  if (window.speechSynthesis) { elegirVoz(); speechSynthesis.onvoiceschanged = elegirVoz; }
  function decir(texto, luego) {
    if (!window.speechSynthesis || !texto) { if (luego) luego(); return; }
    try {
      speechSynthesis.cancel(); fase('hablando');
      var u = new SpeechSynthesisUtterance(texto.replace(/\$/g, '').replace(/(\d)\.(\d{3})/g, '$1$2'));
      u.lang = 'es-CL'; if (VOZ) u.voice = VOZ; u.rate = 1.05;
      var hecho = false; function fin() { if (hecho) return; hecho = true; if (document.body.className === 'hablando') fase(''); if (luego) luego(); }
      u.onend = fin; u.onerror = fin; setTimeout(fin, Math.min(60000, 2500 + texto.length * 90));   // por si el navegador no avisa
      speechSynthesis.speak(u);
    } catch (e) { if (luego) luego(); }
  }

  // ---------------------------------------------------------------- microfono
  function escuchar(seguimiento) {
    if (!SR) { estado('Este navegador no reconoce voz.', 'error'); return; }
    if (escuchando || ocupado) return;
    if (window.speechSynthesis) speechSynthesis.cancel();
    rec = new SR(); rec.lang = 'es-CL'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
    var fin = '', parcial = '';
    rec.onstart = function () { escuchando = true; fase('escuchando'); estado(seguimiento ? 'Te sigo escuchando…' : 'Te escucho…'); chipTel(null); };
    rec.onresult = function (ev) { var t = ''; for (var i = ev.resultIndex; i < ev.results.length; i++) { t += ev.results[i][0].transcript; if (ev.results[i].isFinal) fin += ev.results[i][0].transcript; } parcial = fin || t; caption(parcial); };
    rec.onerror = function (ev) {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') estado('Permite el micrófono para usar la voz.', 'error');
      else if (ev.error === 'network') estado('Sin conexión para reconocer la voz.', 'error');
      else if (ev.error !== 'no-speech' && ev.error !== 'aborted') estado('No te escuché bien. Toca y repite.', '');
    };
    rec.onend = function () {
      escuchando = false; if (document.body.className === 'escuchando') fase('');
      var t = (fin || parcial || '').trim();
      if (t) atender(t); else if (!ocupado) estado('Toca la esfera y habla');     // la ultima respuesta sigue a la vista
    };
    try { rec.start(); } catch (e) { estado('Toca la esfera para hablar.'); }
  }
  function parar() { if (window.speechSynthesis) speechSynthesis.cancel(); if (escuchando) { try { rec.abort(); } catch (e) {} } ocupado = false; fase(''); estado('Toca la esfera y habla'); }

  // ---------------------------------------------------------------- pensar y responder
  function atender(texto) {
    ocupado = true; caption(texto); estado('Pensando…', 'pensando');
    var aviso = setTimeout(function () { if (ocupado) decir('Un momento, estoy revisando.'); }, 6000);
    cerebro.atender(texto).then(function (r) {
      clearTimeout(aviso); ocupado = false;
      if (!r.dicho) { estado('Toca la esfera y habla', ''); return; }
      estado(r.seguir ? 'Responde cuando quieras' : ''); caption(r.dicho, true); chipTel(r.tel);
      decir(r.dicho, function () {
        if (r.seguir || SEGUIR) { setTimeout(function () { if (!ocupado && !escuchando) escuchar(true); }, 250); }
        else estado('Toca la esfera y habla');
      });
    }, function (e) { clearTimeout(aviso); ocupado = false; estado('Algo falló: ' + (e && e.message || e), 'error'); });
  }

  // ---------------------------------------------------------------- datos en el telefono
  var pidiendo = false;
  function cargarGuardados() { var d = alm.get('datos', null); if (d && d.o) cerebro.usarDatos(d.o, d.t); pie(); }
  function pedirDatos(forzar) {
    if (pidiendo || navigator.onLine === false || !alm.get('t', '')) return;
    if (!forzar && Date.now() - datos.t < 20 * 60000) return;
    pidiendo = true;
    api.llamar('datos', {}, { fondo: true, plazo: 150000, releer: 3 }).then(function (o) { pidiendo = false; if (o.ok) { cerebro.usarDatos(o); alm.set('datos', { t: Date.now(), o: o }); } pie(); }, function () { pidiendo = false; pie(); });
  }

  // ---------------------------------------------------------------- arranque
  $('orb').onclick = function () { if (escuchando) { try { rec.stop(); } catch (e) {} return; } if (ocupado) return; escuchar(false); };
  $('parar').onclick = parar;
  $('nueva').onclick = function () { cerebro.nuevaConversacion(); parar(); caption('Conversación nueva', true); };
  document.addEventListener('visibilitychange', function () { if (document.hidden) { if (window.speechSynthesis) speechSynthesis.cancel(); } else { pedirDatos(); cola.vaciar(); } });
  window.addEventListener('online', function () { cola.vaciar(); pie(); }); window.addEventListener('offline', pie);
  setInterval(function () { pedirDatos(); }, 5 * 60000);
  cargarGuardados();
  if (!alm.get('t', '')) { estado('Falta tu enlace de acceso: ábrelo una vez en este teléfono.', 'error'); return; }
  cola.vaciar(); pedirDatos(true);
  api.llamar('inicio', {}, { fondo: true }).then(function (o) { if (o.ok) { $('who').textContent = o.nombre; if (!datos.t && o.clientes) cartera.cargar(o.clientes); } }).catch(function () {});
  cerebro.refrescarPendientes();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  if (new URLSearchParams(location.search).get('mic') === '1') setTimeout(function () { escuchar(false); }, 400);
  window.vozAtender = atender;                                   // para probar sin microfono (consola)
})();
