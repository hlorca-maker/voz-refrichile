/* Voz Refrichile — CONSULTA RAPIDA (25-09-2026).
 *
 * Componente para incorporar en el CRM movil (o en cualquier pagina): una barra de busqueda que
 * responde al instante precio, stock, ficha del cliente (telefono, direccion, cotizaciones
 * abiertas), pendientes, "llama a X", "ya llame a X" y guarda recordatorios y tareas, sin salir
 * de la pagina. Humberto (25-09-2026): "algo muy profesional que luego pueda incorporar dentro
 * del CRM movil para poder hacer consultas rapidas, idealmente sin abrir el script".
 *
 * COMO SE INCORPORA (por ejemplo en una pagina de Apps Script / HtmlService):
 *   <div id="consulta"></div>
 *   <script src="https://hlorca-maker.github.io/voz-refrichile/motor.js"></script>
 *   <script src="https://hlorca-maker.github.io/voz-refrichile/consulta.js"></script>
 *   <script>
 *     VozConsulta.montar(document.getElementById('consulta'), {
 *       api: 'https://script.google.com/macros/s/.../exec',   // la API de voz
 *       clave: '<?= claveVozDeLaPersona ?>',                 // su clave personal (la misma del enlace de la app)
 *       alAbrirCliente: function (rut) { irAFichaDelCrm(rut); } // opcional: enganches con el CRM
 *     });
 *   </script>
 *
 * Se apoya en motor.js (interpretacion, busqueda, API). Trae su propio CSS, aislado bajo .vc, y
 * toma los colores de la pagina si define --primary / --bg / --surface / --text (el CRM los tiene).
 * Los datos (productos, cartera, cotizaciones, pendientes) quedan en localStorage y se
 * refrescan por detras; por eso responde en milisegundos y tambien sin senal. Lo que se guarda
 * se manda por detras con reintentos seguros (rid). El microfono funciona donde el navegador lo
 * permita; dentro del marco de Apps Script esta bloqueado, y ahi el boton abre la app de voz.
 */
(function (raiz) {
  'use strict';
  var M = raiz.VozMotor;
  if (!M) throw new Error('VozConsulta: cargar motor.js antes que consulta.js');
  var doc = raiz.document, esc = M.esc, pesos = M.pesos;

  var CSS = [
    '.vc{--vc-acc:var(--primary,#0A6FE8);--vc-acc2:var(--primary-light,#E3EEFF);--vc-bg:var(--surface,#FFFFFF);--vc-bg2:var(--bg,#F3F5F9);--vc-bord:var(--border,#DCE3EE);',
    '--vc-txt:var(--text,#131A26);--vc-mut:var(--text-muted,#5B6576);--vc-hint:var(--text-soft,#8B94A3);--vc-ok:var(--success,#1F8A48);--vc-okbg:var(--success-bg,#DDF5E6);',
    '--vc-warn:var(--warning,#A85D00);--vc-warnbg:var(--warning-bg,#FFF0DB);--vc-crit:var(--danger,#C62828);--vc-critbg:var(--danger-bg,#FDE3E3);--vc-r:14px;',
    'position:relative;color:var(--vc-txt);font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-tap-highlight-color:transparent}',
    '@media (prefers-color-scheme:dark){.vc:not([data-tema="claro"]){--vc-acc:#3B9BFF;--vc-acc2:#13294A;--vc-bg:#141C2A;--vc-bg2:#0B111C;--vc-bord:#263349;--vc-txt:#EEF2F8;--vc-mut:#A3AEC0;--vc-hint:#7C879A;--vc-ok:#5CD97A;--vc-okbg:#153524;--vc-warn:#FFC266;--vc-warnbg:#3A2A10;--vc-crit:#FF7A70;--vc-critbg:#3D1715}}',
    '.vc[data-tema="oscuro"]{--vc-acc:#3B9BFF;--vc-acc2:#13294A;--vc-bg:#141C2A;--vc-bg2:#0B111C;--vc-bord:#263349;--vc-txt:#EEF2F8;--vc-mut:#A3AEC0;--vc-hint:#7C879A;--vc-ok:#5CD97A;--vc-okbg:#153524;--vc-warn:#FFC266;--vc-warnbg:#3A2A10;--vc-crit:#FF7A70;--vc-critbg:#3D1715}',
    '.vc *{box-sizing:border-box}.vc button,.vc input,.vc select,.vc textarea{font:inherit;color:inherit}',
    '.vc-barra{display:flex;align-items:center;gap:6px;min-height:50px;padding:0 6px 0 14px;border:1.5px solid var(--vc-bord);border-radius:999px;background:var(--vc-bg);box-shadow:0 8px 24px -18px rgba(0,0,0,.35);transition:border-color .15s,box-shadow .15s}',
    '.vc-barra:focus-within{border-color:var(--vc-acc);box-shadow:0 0 0 3px var(--vc-acc2)}',
    '.vc-barra svg{width:20px;height:20px;flex:none;fill:var(--vc-hint)}',
    '.vc-barra input{flex:1;min-width:0;border:0;background:transparent;outline:0;font-size:16px;padding:10px 4px}.vc-barra input::-webkit-search-cancel-button{display:none}',
    '.vc-ib{width:40px;height:40px;border:0;border-radius:50%;background:transparent;display:grid;place-items:center;cursor:pointer;color:var(--vc-acc)}.vc-ib svg{fill:currentColor}.vc-ib:hover{background:var(--vc-acc2)}',
    '.vc-ib.mic.on{background:var(--vc-crit);color:#fff;animation:vcp 1.2s ease-out infinite}@keyframes vcp{0%{box-shadow:0 0 0 0 rgba(198,40,40,.45)}100%{box-shadow:0 0 0 12px rgba(198,40,40,0)}}',
    '.vc-ib:focus-visible,.vc-btn:focus-visible,.vc-s:focus-visible,.vc-chip:focus-visible{outline:3px solid var(--vc-acc);outline-offset:2px}',
    '.vc-sug{position:absolute;left:0;right:0;z-index:30;margin-top:6px;background:var(--vc-bg);border:1px solid var(--vc-bord);border-radius:var(--vc-r);box-shadow:0 18px 40px -18px rgba(0,0,0,.45);overflow:hidden}',
    '.vc-sug[hidden]{display:none}.vc-sg{padding:8px 14px 2px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--vc-hint)}',
    '.vc-s{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;padding:10px 14px;border:0;background:transparent;cursor:pointer;border-top:1px solid var(--vc-bord)}',
    '.vc-s:first-child,.vc-sg+.vc-s{border-top:0}.vc-s[aria-selected="true"],.vc-s:hover{background:var(--vc-acc2)}.vc-s .n{font-weight:600;min-width:0;overflow-wrap:anywhere}.vc-s .s{font-size:12.5px;color:var(--vc-mut)}.vc-s .v{flex:none;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}.vc-s .v small{display:block;font-weight:500;font-size:11.5px;color:var(--vc-mut)}',
    '.vc-s.q{color:var(--vc-acc);font-weight:600}.vc-s.q svg{width:16px;height:16px;fill:currentColor;flex:none}',
    '.vc-chips{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.vc-chip{border:1px solid var(--vc-bord);background:var(--vc-bg);border-radius:999px;padding:7px 12px;font-size:13px;color:var(--vc-mut);cursor:pointer}.vc-chip:hover{border-color:var(--vc-acc);color:var(--vc-acc)}',
    '.vc-res{display:flex;flex-direction:column;gap:10px;margin-top:10px}.vc-res:empty{display:none}',
    '.vc-card{background:var(--vc-bg);border:1px solid var(--vc-bord);border-radius:var(--vc-r);padding:12px 14px;box-shadow:0 14px 32px -24px rgba(0,0,0,.45);animation:vcin .18s ease-out}@keyframes vcin{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
    '.vc-h{display:flex;align-items:center;gap:7px;margin:0 0 6px;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--vc-hint);font-weight:700}.vc-h .sp{flex:1}',
    '.vc-tag{letter-spacing:0;text-transform:none;font-size:11.5px;padding:2px 8px;border-radius:999px;background:var(--vc-acc2);color:var(--vc-acc)}',
    '.vc-x{width:30px;height:30px;border:0;border-radius:50%;background:transparent;color:var(--vc-hint);cursor:pointer;font-size:18px;line-height:1}.vc-x:hover{background:var(--vc-bg2)}',
    '.vc-fila{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 0;border-top:1px solid var(--vc-bord)}.vc-fila:first-of-type{border-top:0}.vc-fila.link{cursor:pointer}',
    '.vc-fila .n{font-weight:600;min-width:0;overflow-wrap:anywhere}.vc-fila .s{font-size:12.5px;color:var(--vc-mut)}.vc-fila .v{flex:none;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}.vc-fila .v small{display:block;font-weight:500;font-size:11.5px;color:var(--vc-mut)}',
    '.vc-nom{font-weight:700;font-size:17px;margin-bottom:4px}.vc-pill{display:inline-block;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap}.vc-pill.ok{background:var(--vc-okbg);color:var(--vc-ok)}.vc-pill.warn{background:var(--vc-warnbg);color:var(--vc-warn)}.vc-pill.crit{background:var(--vc-critbg);color:var(--vc-crit)}',
    '.vc-nota{font-size:12.5px;color:var(--vc-mut);margin-top:6px}.vc-nota.err{color:var(--vc-crit)}.vc a{color:var(--vc-acc);text-decoration:none}',
    '.vc-acc{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}.vc-btn{flex:1;min-height:42px;padding:0 12px;border:0;border-radius:11px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none}',
    '.vc-btn.p{background:var(--vc-acc);color:#fff}.vc-btn.s{background:var(--vc-bg2);color:var(--vc-txt);border:1px solid var(--vc-bord)}.vc-btn.ok{background:var(--vc-ok);color:#fff}.vc-btn.mini{flex:none;min-height:34px;padding:0 11px;font-size:13px;border-radius:9px}',
    '.vc-campo{display:flex;flex-direction:column;gap:4px;margin-top:9px}.vc-campo label{font-size:12px;font-weight:600;color:var(--vc-mut)}.vc-campo input,.vc-campo select,.vc-campo textarea{min-height:40px;border:1px solid var(--vc-bord);border-radius:10px;background:var(--vc-bg2);padding:8px 11px;width:100%}.vc-campo textarea{min-height:56px;resize:vertical}',
    '.vc-dos{display:grid;grid-template-columns:1fr 1fr;gap:8px}.vc-tipos{display:flex;flex-wrap:wrap;gap:6px}.vc-tipos button{min-height:32px;padding:0 11px;border-radius:999px;border:1px solid var(--vc-bord);background:var(--vc-bg2);cursor:pointer;font-size:13px}.vc-tipos button.on{background:var(--vc-acc);border-color:var(--vc-acc);color:#fff}',
    '.vc-burb{max-width:92%;padding:9px 12px;border-radius:14px;line-height:1.4;overflow-wrap:anywhere}.vc-burb.u{align-self:flex-end;background:var(--vc-acc);color:#fff;border-bottom-right-radius:4px}.vc-burb.m{align-self:flex-start;background:var(--vc-bg);border:1px solid var(--vc-bord);border-bottom-left-radius:4px}',
    '.vc-pens{display:flex;gap:5px;padding:12px 14px}.vc-pens span{width:7px;height:7px;border-radius:50%;background:var(--vc-hint);animation:vcd 1s infinite}.vc-pens span:nth-child(2){animation-delay:.15s}.vc-pens span:nth-child(3){animation-delay:.3s}@keyframes vcd{0%,80%,100%{opacity:.3}40%{opacity:1}}',
    '.vc-pie{display:flex;justify-content:space-between;gap:8px;margin-top:8px;font-size:11.5px;color:var(--vc-hint)}.vc-pie button{border:0;background:transparent;color:var(--vc-acc);cursor:pointer;padding:0;font-size:inherit}',
    '@media (prefers-reduced-motion:reduce){.vc-card,.vc-ib.mic.on,.vc-pens span{animation:none}}'
  ].join('\n');
  var cssPuesto = false;
  function ponerCss() { if (cssPuesto || !doc) return; cssPuesto = true; var s = doc.createElement('style'); s.id = 'vc-css'; s.textContent = CSS; doc.head.appendChild(s); }
  var ICO = {
    lupa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5Zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Z"/></svg>',
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"/></svg>',
    enter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7v4H5.83l3.58-3.59L8 6l-6 6 6 6 1.41-1.41L5.83 13H21V7h-2Z"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z"/></svg>'
  };
  var TIPOS = [['recordatorio', 'Recordatorio'], ['tarea', 'Tarea'], ['visita', 'Visita'], ['prosp', 'Prospección'], ['nota', 'Nota']];

  function montar(el, opc) {
    opc = opc || {}; ponerCss();
    var alm = M.almacen(opc.prefijo || 'voz_'), datos = new M.Datos(), cartera = new M.Cartera(), PEND = [], PEND_T = 0, IA = opc.ia !== false;
    var clave = function () { return typeof opc.clave === 'function' ? opc.clave() : (opc.clave || alm.get('t', '')); };
    var api = new M.Api({ url: opc.api, clave: clave, alSinClave: function () { pintar(card('Acceso', '<div class="vc-nota err">La clave de acceso no es válida. Pide tu enlace de Voz Refrichile nuevamente.</div>')); } });
    var cola = new M.Cola(api, alm, { alListo: colaListo, alFallo: colaFallo });
    var CHAT = [], BORR = null, HECHA = null, sel = -1, timer = null, pidiendo = false, rec = null, escuchando = false;

    // ---------------------------------------------------------------- armado
    el.classList.add('vc'); if (opc.tema) el.setAttribute('data-tema', opc.tema);
    el.innerHTML = '<form class="vc-barra" role="search">' + ICO.lupa
      + '<input type="search" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Consulta rápida" aria-autocomplete="list" placeholder="' + esc(opc.placeholder || 'Precio, stock, cliente, pendientes…') + '">'
      + '<button type="button" class="vc-ib x" aria-label="Borrar" hidden>' + ICO.x + '</button>'
      + '<button type="button" class="vc-ib mic" aria-label="Hablar" hidden>' + ICO.mic + '</button></form>'
      + '<div class="vc-sug" role="listbox" hidden></div>'
      + (opc.chips === false ? '' : '<div class="vc-chips"><button type="button" class="vc-chip" data-q="qué tengo hoy">Mis pendientes</button><button type="button" class="vc-chip" data-p="precio ">Precio…</button><button type="button" class="vc-chip" data-p="stock ">Stock…</button><button type="button" class="vc-chip" data-p="teléfono de ">Cliente…</button></div>')
      + '<div class="vc-res" aria-live="polite"></div><div class="vc-pie"><span class="vc-pie-t"></span><button type="button" class="vc-act">Actualizar datos</button></div>';
    var $ = function (s) { return el.querySelector(s); }, input = $('input'), sug = $('.vc-sug'), res = $('.vc-res'), bX = $('.vc-ib.x'), bMic = $('.vc-ib.mic'), pieT = $('.vc-pie-t');

    // ---------------------------------------------------------------- datos en el telefono
    function pie() { pieT.textContent = datos.t ? 'Datos de las ' + M.horaTxt(datos.t) + (navigator.onLine === false ? ' · sin señal' : '') : (navigator.onLine === false ? 'Sin señal y sin datos guardados' : 'Cargando datos…'); }
    function usarDatos(o, t) {
      datos.usar(o, t); cartera.cargar(datos.clientes());
      var hechas = cola.hechasPendientes(), prov = PEND.filter(function (x) { return /^prov-/.test(x.id); });
      PEND = datos.tareas.filter(function (x) { return !hechas[x.id]; }).concat(prov); PEND_T = datos.t; pie();
    }
    function cargarGuardados() { var d = alm.get('datos', null); if (d && d.o) usarDatos(d.o, d.t); }
    function pedirDatos(forzar) {
      if (pidiendo || navigator.onLine === false || !clave()) return;
      if (!forzar && Date.now() - datos.t < 20 * 60000) return;
      pidiendo = true; pie();
      api.llamar('datos', {}, { fondo: true, plazo: 150000, releer: 3 }).then(function (o) { pidiendo = false; if (o.ok) { usarDatos(o); alm.set('datos', { t: Date.now(), o: o }); } pie(); }, function () { pidiendo = false; pie(); });
    }
    function cargarPend(cb) {
      api.llamar('pendientes', {}, { fondo: !cb }).then(function (o) {
        if (!o.ok) return;
        var hechas = cola.hechasPendientes(), prov = PEND.filter(function (x) { return /^prov-/.test(x.id); });
        PEND = (o.tareas || []).filter(function (x) { return !hechas[x.id]; }).concat(prov); PEND_T = Date.now(); if (cb) cb();
      }).catch(function () {});
    }

    // ---------------------------------------------------------------- pintar
    function card(titulo, cuerpo, tag, sinCerrar) {
      return '<div class="vc-card"><div class="vc-h"><span>' + titulo + '</span>' + (tag ? '<span class="vc-tag">' + esc(tag) + '</span>' : '') + '<span class="sp"></span>' + (sinCerrar ? '' : '<button type="button" class="vc-x" data-acc="cerrar" aria-label="Cerrar">×</button>') + '</div>' + cuerpo + '</div>';
    }
    function pintar(h) { res.innerHTML = h; }
    function pilaChat(h) { if (!res.querySelector('.vc-burb')) res.innerHTML = ''; res.insertAdjacentHTML('beforeend', h); res.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return res.lastElementChild; }
    function filasProd(tipo, o) {
      return (o.items || []).map(function (x) {
        var bod = x.bod && x.bod.length ? ' · ' + x.bod.map(function (b) { return esc(b.b) + ' ' + b.s; }).join(' · ') : '';
        return '<div class="vc-fila' + (opc.alAbrirProducto ? ' link' : '') + '" data-acc="producto" data-cod="' + esc(x.cod) + '"><div><div class="n">' + esc(x.desc) + '</div><div class="s">' + esc(x.cod) + (tipo === 'stock' ? bod : '') + '</div></div>'
          + '<div class="v">' + (tipo === 'precio' ? pesos(x.precio) + '<small>+ IVA · stock ' + (x.stock || 0) + '</small>' : (x.stock || 0) + '<small>unidades</small>') + '</div></div>';
      }).join('');
    }
    function cardProductos(tipo, o) {
      var h = filasProd(tipo, o) + (o.local && datos.hora ? '<div class="vc-nota">Datos de las ' + esc(datos.hora.slice(11)) + '</div>' : '');
      pintar(card(tipo === 'precio' ? 'Precio' : 'Stock', h, tipo === 'precio' ? (o.listaNom || '') + (o.cliente ? ' · ' + o.cliente : '') : ''));
      var a = o.items[0];
      decir(tipo === 'precio' ? a.desc + ': ' + (a.precio ? Math.round(a.precio) + ' pesos más IVA, ' : 'sin precio de lista, ') + (o.cliente ? 'para ' + o.cliente : 'en ' + o.listaNom) + '. Stock ' + (a.stock || 0) + '.' : a.desc + ': ' + (a.stock || 0) + ' unidades.');
    }
    function cardNoProd(q) { pintar(card('Producto', '<div class="vc-nota">No encontré “' + esc(q) + '”. Prueba con otras palabras o el código.</div>')); decir('No encontré ese producto'); }
    function cardFicha(o, para) {
      var c = o.cliente, tel = c.fono ? c.fono.replace(/[^\d+]/g, '') : '', dir = ((c.dir || '') + ' ' + (c.comuna || '')).trim();
      var h = '<div class="vc-nom">' + esc(c.nombre) + (c.bloqueado ? ' <span class="vc-pill crit">Bloqueado</span>' : '') + '</div>';
      if (c.fono) h += '<div class="vc-fila"><div class="s">Teléfono</div><div class="v"><a href="tel:' + esc(tel) + '">' + esc(c.fono) + '</a></div></div>';
      if (c.mail) h += '<div class="vc-fila"><div class="s">Correo</div><div class="v" style="font-weight:500"><a href="mailto:' + esc(c.mail) + '">' + esc(c.mail) + '</a></div></div>';
      if (dir) h += '<div class="vc-fila"><div class="s">Dirección</div><div class="v" style="font-weight:500;text-align:right"><a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(dir) + '">' + esc(((c.dir || '') + ', ' + (c.comuna || '')).replace(/^, |, $/g, '')) + '</a></div></div>';
      var cs = o.cotizaciones || [], R = o.reglas || { vig: 5, cal: 14 };
      h += '<div class="vc-h" style="margin-top:10px">Cotizaciones abiertas</div>';
      h += cs.length ? cs.map(function (q) {
        var vig = q.dias <= R.vig, cal = q.dias < R.cal;
        return '<div class="vc-fila"><div><div class="n">N° ' + esc(q.folio) + '</div><div class="s">' + esc(q.fecha) + ' · ' + q.dias + ' d</div></div><div class="v">' + pesos(q.monto) + '<small>' + (cal ? (vig ? '<span class="vc-pill ok">precio vigente</span>' : '<span class="vc-pill warn">actualizar precio</span>') : 'antigua') + '</small></div></div>';
      }).join('') : '<div class="vc-nota">No tiene cotizaciones abiertas.</div>';
      h += '<div class="vc-acc">' + (c.fono ? '<a class="vc-btn p" href="tel:' + esc(tel) + '">Llamar</a>' : '') + (dir ? '<a class="vc-btn s" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(dir) + '">Cómo llegar</a>' : '')
        + '<button type="button" class="vc-btn s" data-acc="recordar" data-rut="' + esc(c.rut) + '">Recordatorio</button>' + (opc.alAbrirCliente ? '<button type="button" class="vc-btn s" data-acc="abrirCliente" data-rut="' + esc(c.rut) + '">Ver en CRM</button>' : '') + '</div>';
      pintar(card('Cliente', h, c.lista || ''));
      var fono = c.fono ? c.fono.replace(/\D/g, '').split('').join(' ') : '';
      decir(para === 'llamar' ? (c.fono ? c.nombre + ', ' + fono + '. Toca Llamar.' : c.nombre + ' no tiene teléfono registrado')
        : para === 'cotiz' ? (cs.length ? c.nombre + ' tiene ' + cs.length + (cs.length === 1 ? ' cotización abierta' : ' cotizaciones abiertas') : c.nombre + ' no tiene cotizaciones abiertas')
        : (c.fono ? 'El teléfono de ' + c.nombre + ' es ' + fono : c.nombre + ' no tiene teléfono registrado'));
    }
    function filaPend(t) {
      var cuando = t.dias == null ? 'sin fecha' : (t.dias < 0 ? '<span class="vc-pill crit">vencida ' + (-t.dias) + ' d</span>' : (t.dias === 0 ? '<span class="vc-pill warn">hoy</span>' : (t.dias === 1 ? 'mañana' : 'en ' + t.dias + ' d')));
      return '<div class="vc-fila"><div><div class="n">' + esc(t.titulo) + '</div><div class="s">' + (t.cliente ? esc(t.cliente) + ' · ' : '') + cuando + (/^prov-/.test(t.id) ? ' · <span class="vc-pill warn">enviando al CRM</span>' : '') + '</div></div>'
        + '<div class="v"><button type="button" class="vc-btn ok mini" data-acc="hecha" data-id="' + esc(t.id) + '">Hecha</button></div></div>';
    }
    function cardPend(hablar) {
      var hoy = PEND.filter(function (t) { return t.dias != null && t.dias <= 0; }), prox = PEND.filter(function (t) { return t.dias == null || t.dias > 0; }).slice(0, 5);
      pintar(card('Para hoy · ' + hoy.length, (hoy.length ? hoy.map(filaPend).join('') : '<div class="vc-nota">Nada pendiente para hoy.</div>')
        + (prox.length ? '<div class="vc-h" style="margin-top:10px">Próximos</div>' + prox.map(filaPend).join('') : '') + (PEND_T ? '<div class="vc-nota">Actualizado ' + M.horaTxt(PEND_T) + '</div>' : ''), '', false).replace('<div class="vc-card">', '<div class="vc-card" data-pend="1">'));
      if (hablar) decir(hoy.length ? 'Tienes ' + hoy.length + ' para hoy: ' + hoy.slice(0, 3).map(function (t) { return t.titulo; }).join('; ') : 'No tienes nada pendiente para hoy.');
      cargarPend(function () { if (res.querySelector('[data-pend]')) cardPend(false); });
    }
    function cardElegir(clis, para) {
      pintar(card('¿Cuál cliente?', '<div class="vc-acc">' + clis.map(function (c) { return '<button type="button" class="vc-btn s" data-acc="ficha" data-rut="' + esc(c.r) + '" data-para="' + para + '">' + esc(c.n) + '</button>'; }).join('') + '</div>'));
      decir('¿Cuál de estos? ' + clis.slice(0, 3).map(function (c) { return c.n; }).join(', '));
    }
    /* Confirmar es una linea, como Siri: que, cuando, con quien, y "Si / No / Cambiar". El
       formulario completo solo si se toca "Cambiar" (Humberto, 25-09-2026: "por que aparece un
       formulario?"). */
    function cardBorrador(editar) {
      var b = BORR, c = cartera.porRut[b.cli], nomTipo = { recordatorio: 'Recordatorio', tarea: 'Tarea', visita: 'Visita', prosp: 'Prospección', nota: 'Nota' }[b.tipo];
      if (!editar) {
        pintar(card('¿Lo guardo?', '<div class="vc-nom">' + esc(b.titulo) + '</div><div class="vc-nota">' + nomTipo + ' · ' + esc(M.capital(M.fechaTxt(b.fecha))) + (b.hora && b.tipo === 'recordatorio' ? ' a las ' + esc(b.hora) : '') + (c ? ' · ' + esc(c.n) : '') + '</div>'
          + '<div class="vc-acc"><button type="button" class="vc-btn s" data-acc="cancelar">No</button><button type="button" class="vc-btn s" data-acc="editar">Cambiar</button><button type="button" class="vc-btn p" data-acc="guardar">Sí, guardar</button></div>', b.cot ? 'Cot. ' + b.cot : ''));
        decir(M.fraseBorrador(b, cartera)); return;
      }
      var opts = '<option value="">— Sin cliente —</option>' + b.clis.concat(b.cli && !b.clis.some(function (x) { return x.r === b.cli; }) ? [c] : []).filter(Boolean)
        .map(function (x) { return '<option value="' + esc(x.r) + '"' + (x.r === b.cli ? ' selected' : '') + '>' + esc(x.n) + '</option>'; }).join('');
      pintar(card('Guardar en el CRM', '<div class="vc-tipos">' + TIPOS.map(function (t) { return '<button type="button" data-acc="tipo" data-t="' + t[0] + '" class="' + (t[0] === b.tipo ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>'
        + '<div class="vc-campo"><label>Qué</label><input name="titulo" value="' + esc(b.titulo) + '"></div>'
        + '<div class="vc-campo"><label>Cliente</label><select name="cli">' + opts + '</select></div>'
        + '<div class="vc-dos"><div class="vc-campo"><label>Fecha</label><input name="fecha" type="date" value="' + esc(b.fecha) + '"></div><div class="vc-campo"><label>Hora' + (b.tipo === 'recordatorio' ? ' del aviso' : '') + '</label><input name="hora" type="time" value="' + esc(b.hora) + '"></div></div>'
        + '<div class="vc-campo"><label>Detalle</label><textarea name="detalle">' + esc(b.detalle) + '</textarea></div>'
        + '<div class="vc-acc"><button type="button" class="vc-btn s" data-acc="cancelar">Cancelar</button><button type="button" class="vc-btn p" data-acc="guardar">Guardar</button></div>', b.cot ? 'Cot. ' + b.cot : ''));
    }
    function leerBorrador() {
      var f = res.querySelector('.vc-card'); if (!BORR || !f || !f.querySelector('[name=titulo]')) return;
      BORR.titulo = f.querySelector('[name=titulo]').value.trim(); BORR.cli = f.querySelector('[name=cli]').value; BORR.fecha = f.querySelector('[name=fecha]').value || M.iso(M.hoy0());
      BORR.hora = f.querySelector('[name=hora]').value; BORR.detalle = f.querySelector('[name=detalle]').value.trim();
    }
    function guardarBorrador() {
      leerBorrador(); var b = BORR; if (!b) return;
      if (!b.titulo) { aviso('Falta qué hay que hacer.', true); return; }
      var d = M.datosTarea(b, cartera), q = 'para ' + M.fechaTxt(d.fecha) + (d.hora ? ' a las ' + d.hora : ''); BORR = null;
      pintar(card('Guardado', '<div class="vc-nom">' + esc(d.titulo) + '</div><div class="vc-nota">' + esc(M.capital(q)) + (d.cliente ? ' · ' + esc(d.cliente) : '') + (d.recordar ? ' · te llegará un aviso al teléfono' : '') + '</div>'
        + '<div class="vc-nota" data-env="' + d.rid + '">' + (navigator.onLine === false ? 'Sin señal: se enviará al CRM cuando vuelva.' : 'Enviando al CRM…') + '</div>'));
      decir('Listo, ' + q + '.');
      PEND.push({ id: 'prov-' + d.rid, titulo: d.titulo, cliente: d.cliente, dias: M.diasHasta(d.fecha), prio: d.prioridad, detalle: d.detalle });
      PEND.sort(function (x, y) { return (x.dias == null ? 999 : x.dias) - (y.dias == null ? 999 : y.dias); });
      cola.agregar('tarea', d, d.titulo + ' · ' + q);
    }
    function marcarHecha(id) {
      HECHA = null;
      if (/^prov-/.test(id)) { aviso('Esa tarea todavía está en camino al CRM: espera un momento.', true); return; }
      var t = PEND.filter(function (x) { return x.id === id; })[0], rid = M.ridNuevo();
      PEND = PEND.filter(function (x) { return x.id !== id; }); decir('Listo.');
      if (res.querySelector('[data-pend]')) cardPend(false);
      else pintar(card('Hecha', '<div class="vc-nom">' + esc(t ? t.titulo : id) + '</div><div class="vc-nota" data-env="' + rid + '">' + (navigator.onLine === false ? 'Sin señal: se enviará al CRM cuando vuelva.' : 'Enviando al CRM…') + '</div>'));
      cola.agregar('hecha', { id: id, rid: rid }, t ? t.titulo : id);
    }
    function colaListo(x, o) {
      var e = res.querySelector('[data-env="' + x.d.rid + '"]');
      if (x.a === 'tarea') { PEND.forEach(function (t) { if (t.id === 'prov-' + x.d.rid) t.id = o.id || t.id; }); if (e) e.textContent = '✓ Guardado en el CRM' + (o.aviso === 'ok' ? ' · con aviso en tu teléfono' : ''); }
      else if (e) e.textContent = '✓ Marcada en el CRM';
      if (opc.alGuardado) opc.alGuardado(x, o);
      cargarPend();
    }
    function colaFallo(x, err, quizas) {
      var m = (x.a === 'tarea' ? (quizas ? 'Sin confirmación del CRM para: ' : 'No quedó guardado en el CRM: ') : 'No se marcó como hecha: ') + x.txt + '. ' + err;
      if (x.a === 'tarea' && !quizas) PEND = PEND.filter(function (t) { return t.id !== 'prov-' + x.d.rid; });
      var e = res.querySelector('[data-env="' + x.d.rid + '"]'); if (e) { e.className = 'vc-nota err'; e.textContent = m; } else aviso(m, true);
      decir(m);
    }
    function aviso(m, err) { pintar(card('Aviso', '<div class="vc-nota' + (err ? ' err' : '') + '">' + esc(m) + '</div>')); }
    function cardNoEntendi() { pintar(card('No te entendí', '<div class="vc-nota">Puedo buscar precios, stock, datos de un cliente o tus pendientes, y guardar un recordatorio o una tarea. Por ejemplo: “precio bomba de vacío 5 CFM para Clima Norte”, “teléfono de Refritec”, “recuérdame llamar a Frío Sur mañana a las 10”.</div>')); decir('No te entendí.'); }

    // ---------------------------------------------------------------- IA (lo que la copia no resuelve)
    function tarjetaIA(t) {
      var d = t.datos || {};
      if (t.tipo === 'precio' || t.tipo === 'stock') return d.items && d.items.length ? card(t.tipo === 'precio' ? 'Precio' : 'Stock', filasProd(t.tipo, d), t.tipo === 'precio' ? (d.listaNom || '') + (d.cliente ? ' · ' + d.cliente : '') : '', true) : '';
      if (t.tipo === 'cliente') { var c = d.cliente || {}; return card('Cliente', '<div class="vc-nom">' + esc(c.nombre) + '</div>' + (c.fono ? '<div class="vc-fila"><div class="s">Teléfono</div><div class="v"><a href="tel:' + esc(c.fono.replace(/[^\d+]/g, '')) + '">' + esc(c.fono) + '</a></div></div>' : '') + '<div class="vc-acc"><button type="button" class="vc-btn s mini" data-acc="ficha" data-rut="' + esc(c.rut) + '" data-para="contacto">Ver ficha</button></div>', c.lista || '', true); }
      if (t.tipo === 'pendientes') return card('Pendientes', (d || []).length ? d.slice(0, 8).map(filaPend).join('') : '<div class="vc-nota">Nada pendiente.</div>', '', true);
      if (t.tipo === 'guardado') return card('Guardado en el CRM', '<div class="vc-nom">' + esc(d.titulo) + '</div><div class="vc-nota">' + esc(M.capital(M.fechaTxt(d.fecha))) + (d.hora ? ' a las ' + esc(d.hora) : '') + (d.cliente ? ' · ' + esc(d.cliente) : '') + '</div>', '', true);
      if (t.tipo === 'hecha') return card('Marcada como hecha', '', '', true);
      return '';
    }
    function preguntarIA(texto) {
      pilaChat('<div class="vc-burb u">' + esc(texto) + '</div>');
      var pens = pilaChat('<div class="vc-burb m vc-pens"><span></span><span></span><span></span></div>');
      var avisoVoz = setTimeout(function () { decir('Un momento, estoy revisando.'); }, 6000);
      api.llamar('chat', { texto: texto, historial: CHAT }, { ms: 30000 }).then(function (o) {
        clearTimeout(avisoVoz); pens.remove();
        if (!o.ok) { if (o.sinIA) IA = false; pilaChat('<div class="vc-burb m"><span class="vc-nota err">' + esc(o.error || 'No se pudo.') + '</span></div>'); return; }
        CHAT.push({ r: 'u', t: texto }, { r: 'm', t: o.texto }); CHAT = CHAT.slice(-12);
        pilaChat('<div class="vc-burb m">' + esc(o.texto) + '</div>');
        (o.tarjetas || []).forEach(function (t) { var h = tarjetaIA(t); if (h) pilaChat(h); });
        if ((o.tarjetas || []).some(function (t) { return t.tipo === 'guardado' || t.tipo === 'hecha'; })) cargarPend();
        decir(o.texto);
      }).catch(function (e) {
        clearTimeout(avisoVoz); pens.remove();
        pilaChat('<div class="vc-burb m"><span class="vc-nota err">' + (e.red ? 'Sin conexión: pregúntame de nuevo cuando tengas señal.' : 'No me llegó la respuesta: Google está demorando. Vuelve a preguntar en unos segundos.') + '</span></div>');
      });
    }

    // ---------------------------------------------------------------- procesar lo escrito o dicho
    function procesar(texto) {
      texto = String(texto || '').trim(); if (!texto) return;
      ocultarSug();
      if (HECHA) { var r0 = M.siNo(texto); if (r0 > 0) { marcarHecha(HECHA.id); return; } if (r0 < 0) { HECHA = null; pintar(''); decir('Bien, no la marco.'); return; } HECHA = null; }
      if (BORR) {
        var r1 = M.siNo(texto);
        if (r1 > 0) { guardarBorrador(); return; }
        if (r1 < 0) { BORR = null; pintar(''); decir('Bien, no lo guardo.'); return; }
        BORR = null;                                              // otra cosa: orden nueva
      }
      var r = M.interpretar(texto, { datos: datos, cartera: cartera });
      if (r.tipo === 'saludo' || r.tipo === 'ayuda') { var m0 = r.tipo === 'saludo' ? 'Hola. ¿Qué necesitas? Precios, stock, datos de un cliente, tus pendientes o un recordatorio.' : 'Puedo decirte precio y stock de un producto; teléfono, dirección y cotizaciones abiertas de un cliente; tus pendientes; y guardar recordatorios, tareas y notas. Por ejemplo: “precio del R410A para Clima Norte”, “teléfono de Refritec”, “recuérdame llamar a Frío Sur mañana a las 10”.'; pintar(card(r.tipo === 'saludo' ? 'Hola' : 'Qué puedo hacer', '<div class="vc-nota">' + esc(m0) + '</div>')); decir(m0); return; }
      if (r.tipo === 'pend') return cardPend(true);
      if (r.tipo === 'precio' || r.tipo === 'stock') {
        if (r.resultado) return cardProductos(r.tipo, r.resultado);
        // No esta en la copia: si hay IA, que lo intente ella (quizas no era un producto); si no, se dice.
        if (datos.t && IA && navigator.onLine !== false && clave()) return preguntarIA(texto);
        if (datos.t || navigator.onLine === false) return cardNoProd(r.q);
        pintar(card(r.tipo === 'precio' ? 'Precio' : 'Stock', '<div class="vc-nota">Buscando en el CRM…</div>'));
        return api.llamar(r.consulta.accion, r.consulta).then(function (o) { if (!o.ok) return aviso(o.error || 'No se pudo.', true); if (!(o.items || []).length) return cardNoProd(r.q); cardProductos(r.tipo, o); }).catch(function (e) { aviso(M.errTxt(e), true); });
      }
      if (r.tipo === 'ficha') return verFicha(r.cli.r, r.para);
      if (r.tipo === 'elegir') return cardElegir(r.clis, r.para);
      if (r.tipo === 'hecha') {
        var cand = M.buscarPendiente(texto, r.cli, PEND);
        if (!cand.length) { cardPend(false); decir('¿Cuál de tus pendientes? Toca Hecha en la que corresponde.'); return; }
        HECHA = cand[0];
        pintar(card('Marcar como hecha', '<div class="vc-nom">' + esc(HECHA.titulo) + '</div><div class="vc-nota">' + esc(HECHA.cliente || '') + '</div><div class="vc-acc"><button type="button" class="vc-btn s" data-acc="otra">Otra</button><button type="button" class="vc-btn ok" data-acc="hecha" data-id="' + esc(HECHA.id) + '">Hecha</button></div>'));
        decir('¿Marco como hecha: ' + HECHA.titulo + '?'); return;
      }
      if (r.tipo === 'borrador') { BORR = r.borrador; HECHA = null; return cardBorrador(); }
      if (IA && navigator.onLine !== false && clave()) return preguntarIA(texto);
      cardNoEntendi();
    }
    function verFicha(rut, para) {
      var f = datos.ficha(rut);
      if (f) return cardFicha(f, para);
      pintar(card('Cliente', '<div class="vc-nota">Buscando en el CRM…</div>'));
      api.llamar('cliente', { rut: rut }).then(function (o) { if (o.ok) cardFicha(o, para); else aviso(o.error || 'No se pudo.', true); }).catch(function (e) { aviso(M.errTxt(e), true); });
    }

    // ---------------------------------------------------------------- sugerencias mientras se escribe
    var ORDEN = /\b(telefono|fono|celular|correo|mail|direccion|datos|ficha|contacto|cotizaciones?|llama\w*|precio|stock|cliente|de|del|a|al|para|el|la|los|las|hay|cuanto|cuantos|cuantas|vale|cuesta)\b/g;
    function sugerir() {
      var q = input.value.trim(); bX.hidden = !q; sel = -1;
      if (q.length < 2) return ocultarSug();
      var tipo = M.intencion(q), h = '', n = 0;
      if (tipo !== 'nose') h += '<button type="button" class="vc-s q" role="option" data-q="' + esc(q) + '">' + ICO.enter + '<span class="n" style="flex:1">' + esc(q) + '</span></button>';
      var prods = datos.t && !/^(hecha|pend|recordatorio|tarea|visita|prosp|nota|contacto|cotiz|llamar)$/.test(tipo) ? datos.buscarProd(q, 'ambos', 4) : [];
      if (prods.length) h += '<div class="vc-sg">Productos</div>' + prods.map(function (it) {
        var p = datos.precioDe(it, 'L2A');
        return '<button type="button" class="vc-s" role="option" data-cod="' + esc(it.cod) + '"><span><span class="n">' + esc(it.desc) + '</span><br><span class="s">' + esc(it.cod) + '</span></span><span class="v">' + (p ? pesos(p) : '') + '<small>stock ' + it.stock + '</small></span></button>';
      }).join('');
      var qc = M.norm(q).replace(ORDEN, ' ').replace(/\s+/g, ' ').trim();
      var clis = qc.length >= 2 && !/^(precio|stock|pend)$/.test(tipo) ? cartera.sugerir(qc, 3) : [];
      if (clis.length) h += '<div class="vc-sg">Clientes</div>' + clis.map(function (c) {
        var d = datos.cliMap[c.r] || {};
        return '<button type="button" class="vc-s" role="option" data-rut="' + esc(c.r) + '"><span><span class="n">' + esc(c.n) + '</span><br><span class="s">' + esc(d.f || '') + (d.c ? (d.f ? ' · ' : '') + esc(d.c) : '') + '</span></span><span class="v"><small>' + esc(datos.listas[c.l] || c.l || '') + '</small></span></button>';
      }).join('');
      var ps = qc.length >= 4 ? M.buscarPendiente(q, null, PEND).slice(0, 2) : [];
      if (ps.length) h += '<div class="vc-sg">Pendientes</div>' + ps.map(function (t) { return '<button type="button" class="vc-s" role="option" data-id="' + esc(t.id) + '"><span><span class="n">' + esc(t.titulo) + '</span><br><span class="s">' + esc(t.cliente || '') + '</span></span></button>'; }).join('');
      if (!h) return ocultarSug();
      sug.innerHTML = h; sug.hidden = false;
    }
    function ocultarSug() { sug.hidden = true; sug.innerHTML = ''; sel = -1; }
    function mover(d) {
      var ops = sug.querySelectorAll('.vc-s'); if (sug.hidden || !ops.length) return false;
      sel = (sel + d + ops.length) % ops.length;
      ops.forEach(function (o, i) { o.setAttribute('aria-selected', i === sel ? 'true' : 'false'); });
      ops[sel].scrollIntoView({ block: 'nearest' }); return true;
    }
    function elegir(b) {
      ocultarSug(); input.value = ''; bX.hidden = true;
      if (b.dataset.q) return procesar(b.dataset.q);
      if (b.dataset.cod) { var it = datos.prod.filter(function (p) { return p.cod === b.dataset.cod; })[0]; if (it) cardProductos('precio', datos.precio('', null, [it])); return; }
      if (b.dataset.rut) return verFicha(b.dataset.rut, 'contacto');
      if (b.dataset.id) { var t = PEND.filter(function (x) { return x.id === b.dataset.id; })[0]; if (t) { HECHA = t; pintar(card('Pendiente', '<div class="vc-nom">' + esc(t.titulo) + '</div><div class="vc-nota">' + esc(t.cliente || '') + (t.dias != null ? ' · ' + (t.dias === 0 ? 'hoy' : t.dias < 0 ? 'vencida' : 'en ' + t.dias + ' d') : '') + '</div><div class="vc-acc"><button type="button" class="vc-btn ok" data-acc="hecha" data-id="' + esc(t.id) + '">Marcar hecha</button></div>')); } }
    }

    // ---------------------------------------------------------------- voz
    var SR = raiz.SpeechRecognition || raiz.webkitSpeechRecognition;
    var micPermitido = !!SR && !(doc.permissionsPolicy && doc.permissionsPolicy.allowsFeature && !doc.permissionsPolicy.allowsFeature('microphone'));
    var hablar = opc.hablar != null ? opc.hablar : micPermitido;
    function decir(t) {
      if (!hablar || !raiz.speechSynthesis || !t) return;
      try { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(t.replace(/\$/g, '').replace(/(\d)\.(\d{3})/g, '$1$2')); u.lang = 'es-CL'; u.rate = 1.05; speechSynthesis.speak(u); } catch (e) {}
    }
    function escuchar() {
      if (escuchando) { try { rec.stop(); } catch (e) {} return; }
      rec = new SR(); rec.lang = 'es-CL'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
      var fin = '';
      rec.onstart = function () { escuchando = true; bMic.classList.add('on'); input.placeholder = 'Te escucho…'; };
      rec.onresult = function (ev) { var t = ''; for (var i = ev.resultIndex; i < ev.results.length; i++) { t += ev.results[i][0].transcript; if (ev.results[i].isFinal) fin += ev.results[i][0].transcript; } input.value = fin || t; };
      rec.onerror = function (ev) { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') aviso('Permite el micrófono para usar la voz.', true); };
      rec.onend = function () { escuchando = false; bMic.classList.remove('on'); input.placeholder = opc.placeholder || 'Precio, stock, cliente, pendientes…'; var t = (fin || input.value).trim(); if (t) { input.value = ''; procesar(t); } };
      try { rec.start(); } catch (e) {}
    }
    if (micPermitido) { bMic.hidden = false; bMic.onclick = function () { if (raiz.speechSynthesis) speechSynthesis.cancel(); escuchar(); }; }
    else if (opc.pwa !== false) { bMic.hidden = false; bMic.title = 'Hablar (abre Voz Refrichile)'; bMic.setAttribute('aria-label', 'Hablar (abre Voz Refrichile)'); bMic.onclick = function () { raiz.open((opc.pwa || 'https://hlorca-maker.github.io/voz-refrichile/') + '?mic=1', '_blank', 'noopener'); }; }

    // ---------------------------------------------------------------- eventos
    $('form').onsubmit = function (ev) { ev.preventDefault(); var b = sel >= 0 ? sug.querySelectorAll('.vc-s')[sel] : null; if (b) return elegir(b); var t = input.value.trim(); input.value = ''; bX.hidden = true; input.blur(); procesar(t); };
    input.oninput = function () { clearTimeout(timer); timer = setTimeout(sugerir, 90); };
    input.onfocus = function () { if (input.value.trim().length >= 2) sugerir(); };
    input.onkeydown = function (ev) { if (ev.key === 'ArrowDown') { if (mover(1)) ev.preventDefault(); } else if (ev.key === 'ArrowUp') { if (mover(-1)) ev.preventDefault(); } else if (ev.key === 'Escape') { ocultarSug(); input.blur(); } };
    sug.onmousedown = function (ev) { ev.preventDefault(); };                     // que el input no pierda el foco antes del click
    sug.onclick = function (ev) { var b = ev.target.closest('.vc-s'); if (b) elegir(b); };
    doc.addEventListener('click', function (ev) { if (!el.contains(ev.target)) ocultarSug(); });
    bX.onclick = function () { input.value = ''; bX.hidden = true; ocultarSug(); input.focus(); };
    el.addEventListener('click', function (ev) {
      var chip = ev.target.closest('.vc-chip');
      if (chip) { if (chip.dataset.q) procesar(chip.dataset.q); else { input.value = chip.dataset.p; input.focus(); sugerir(); } return; }
      if (ev.target.closest('.vc-act')) { pedirDatos(true); return; }
      var b = ev.target.closest('[data-acc]'); if (!b) return;
      var acc = b.dataset.acc;
      if (acc === 'cerrar') { BORR = null; HECHA = null; pintar(''); }
      else if (acc === 'ficha') verFicha(b.dataset.rut, b.dataset.para || 'contacto');
      else if (acc === 'hecha') marcarHecha(b.dataset.id);
      else if (acc === 'otra') { HECHA = null; cardPend(false); }
      else if (acc === 'recordar') { var c = cartera.porRut[b.dataset.rut]; BORR = M.borrador('recordatorio', 'Llamar a ' + (c ? c.n : '') + ' mañana', c ? [c] : []); cardBorrador(); }
      else if (acc === 'abrirCliente') { if (opc.alAbrirCliente) opc.alAbrirCliente(b.dataset.rut, datos.cliMap[b.dataset.rut]); }
      else if (acc === 'producto') { if (opc.alAbrirProducto) opc.alAbrirProducto(b.dataset.cod); }
      else if (acc === 'editar') { if (BORR) cardBorrador(true); }
      else if (acc === 'tipo') { leerBorrador(); BORR.tipo = b.dataset.t; if (BORR.tipo === 'recordatorio' && !BORR.hora) BORR.hora = '09:00'; cardBorrador(true); }
      else if (acc === 'cancelar') { BORR = null; pintar(''); }
      else if (acc === 'guardar') guardarBorrador();
    });
    raiz.addEventListener('online', function () { cola.vaciar(); pie(); });
    raiz.addEventListener('offline', pie);
    doc.addEventListener('visibilitychange', function () { if (!doc.hidden) { pedirDatos(); cola.vaciar(); } });
    var reloj = setInterval(function () { pedirDatos(); }, 5 * 60000);

    // ---------------------------------------------------------------- arranque
    cargarGuardados(); pie();
    if (!clave()) pintar(card('Acceso', '<div class="vc-nota">Falta la clave de acceso de Voz Refrichile (la del enlace personal).</div>'));
    else { cola.vaciar(); pedirDatos(true); }

    return {
      consultar: procesar, refrescar: function () { pedirDatos(true); }, enfocar: function () { input.focus(); },
      datos: datos, cartera: cartera,
      destruir: function () { clearInterval(reloj); el.innerHTML = ''; el.classList.remove('vc'); }
    };
  }

  raiz.VozConsulta = { montar: montar, version: M.version };
})(window);
