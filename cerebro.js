/* Voz Refrichile — CEREBRO conversacional (25-09-2026).
 *
 * Humberto: "que en la ventana solo aparezca una imagen, como ChatGPT voz o Claude voz, y
 * dependiendo de lo que le diga empiece a registrar por detras sin mostrar nada en pantalla.
 * Si le dije que me agregue un recordatorio para llamar a X, luego puedo consultarle cuando
 * tengo que llamarlo y a que hora. Eso es un chatbot util."
 *
 * Esto es la conversacion sin pantalla: recibe lo dicho y devuelve que responder de viva voz
 * (y si hay que seguir escuchando). Actua por detras (guarda, marca hecha) y recuerda el
 * contexto: el ultimo cliente, la ultima tarea, lo que pregunto y esta esperando (para cuando,
 * cual cliente, si o no). Lo que puede, lo resuelve al instante con la copia del telefono
 * (motor.js); lo demas se lo pregunta a la IA con el historial, asi que la IA tambien sabe lo
 * que se hizo aqui. Sin pantalla ni localStorage directos: se prueba en Node.
 *
 * Uso:  var c = new VozCerebro({ datos, cartera, api, cola, alm });  c.usarDatos(copia);
 *       c.atender('recuerdame llamar a Frio Sur').then(r => r.dicho)  // "¿Para cuándo?"
 *       c.atender('manana a las 10')  // "Listo. Te recuerdo llamar a Frío Sur mañana a las 10:00."
 *       c.atender('cuando tengo que llamarlo')  // "Mañana a las 10:00: Llamar a Frío Sur."
 */
(function (raiz) {
  'use strict';
  var M = raiz.VozMotor || (typeof require === 'function' ? require('./motor.js') : null);

  function C(o) {
    this.datos = o.datos; this.cartera = o.cartera; this.api = o.api; this.cola = o.cola; this.alm = o.alm;
    this.ia = o.ia !== false; this.clave = o.clave || function () { return ''; };
    this.enLinea = o.enLinea || function () { return typeof navigator === 'undefined' || navigator.onLine !== false; };
    this.pend = []; this.pendT = 0; this.pregunta = null; this.ult = { cli: null, tarea: null, prod: null }; this.ultimaAccion = null; this.cancelarAlConfirmar = null;
    var ch = this.alm ? this.alm.get('chat', null) : null;
    this.chat = ch && ch.m && Date.now() - (ch.t || 0) < 30 * 60000 ? ch.m : [];   // conversacion nueva tras 30 min
  }

  // ---------------------------------------------------------------- datos y pendientes
  C.prototype.usarDatos = function (o, t) { this.datos.usar(o, t); this.cartera.cargar(this.datos.clientes()); this.pendMezclar(this.datos.tareas); this.pendT = this.datos.t; };
  C.prototype.pendMezclar = function (tareas) {
    var hechas = this.cola ? this.cola.hechasPendientes() : {}, prov = this.pend.filter(function (x) { return /^prov-/.test(x.id); });
    this.pend = (tareas || []).filter(function (x) { return !hechas[x.id]; }).concat(prov); this.pendT = Date.now();
  };
  // Lo que el CRM confirmo por detras: la tarea provisoria toma su id real (y si se pidio deshacer mientras iba en camino, se marca).
  C.prototype.colaListo = function (x, o) {
    var self = this;
    if (x.a === 'tarea') this.pend.forEach(function (t) { if (t.id === 'prov-' + x.d.rid) t.id = o.id || t.id; });
    if (this.cancelarAlConfirmar === x.d.rid && o.id) { this.cancelarAlConfirmar = null; this.pend = this.pend.filter(function (t) { return t.id !== o.id; }); this.cola.agregar('hecha', { id: o.id, rid: M.ridNuevo(), comentario: 'Cancelada por voz' }, x.txt); }
  };
  C.prototype.horaDe = function (t) { if (t.hora) return t.hora; var m = String(t.detalle || '').match(/\b(\d{1,2}:\d{2})\b/); return m ? m[1] : ''; };
  C.prototype.cuandoTxt = function (t) {
    if (t.dias == null) return 'sin fecha';
    var d = new Date(M.hoy0()); d.setDate(d.getDate() + t.dias);
    var f = t.dias < 0 ? 'vencida hace ' + (-t.dias) + (t.dias === -1 ? ' día' : ' días') : M.fechaTxt(M.iso(d)), h = this.horaDe(t);
    return f + (h ? ' a las ' + h : '');
  };
  C.prototype.pendientesDe = function (cli) {
    var n = M.norm(cli.n), ws = cli._t || [];
    return this.pend.filter(function (t) { var tc = M.norm(t.cliente || ''), tt = ' ' + M.norm(t.cliente + ' ' + t.titulo) + ' '; return tc === n || (ws.length && ws.every(function (w) { return tt.indexOf(w) >= 0; })); });
  };
  C.prototype.recordar = function (dicho, respuesta) {
    this.chat.push({ r: 'u', t: dicho }, { r: 'm', t: respuesta }); this.chat = this.chat.slice(-24);
    if (this.alm) this.alm.set('chat', { t: Date.now(), m: this.chat });
  };
  C.prototype.nuevaConversacion = function () { this.chat = []; this.pregunta = null; this.ult = { cli: null, tarea: null, prod: null }; if (this.alm) this.alm.set('chat', { t: 0, m: [] }); };

  // ---------------------------------------------------------------- atender lo dicho
  /* Devuelve una promesa de { dicho, seguir, tel, mapa }: dicho es lo que se lee en voz alta;
     seguir = true cuando se espera una respuesta (se vuelve a escuchar sin tocar nada). */
  C.prototype.atender = function (texto) {
    var self = this; texto = String(texto || '').trim();
    if (!texto) return Promise.resolve({ dicho: '', seguir: false });
    return Promise.resolve().then(function () { return self._atender(texto); }).then(function (r) {
      if (typeof r === 'string') r = { dicho: r };
      r.seguir = !!r.seguir || !!self.pregunta;
      if (r.dicho) self.recordar(texto, r.dicho);
      return r;
    });
  };
  C.prototype._atender = function (texto) {
    var tipo0 = M.intencion(texto);
    if (!this.pregunta && (tipo0 === 'saludo' || tipo0 === 'ayuda')) return this._atenderTipo(tipo0, ' ' + M.norm(texto) + ' ');
    texto = M.limpiarOrden(texto);
    var n = ' ' + M.norm(texto) + ' ', p = this.pregunta, s;
    // 1) Respuesta a lo que se pregunto
    if (p) {
      this.pregunta = null;
      if (p.tipo === 'cuando') {
        var f = M.leerFecha(texto);
        if (f.iso || f.hora) { if (f.iso) p.borrador.fecha = f.iso; if (f.hora) p.borrador.hora = f.hora; return this.confirmar(p.borrador); }
        if (M.siNo(texto) < 0) return 'Bien, no lo guardo.';
      } else if (p.tipo === 'que') {
        // Se pregunto "que te recuerdo": la respuesta trae el que, y a veces la fecha y el cliente.
        var fq = M.leerFecha(texto), tq = M.tituloDe(texto, fq), cq = this.cartera.buscar(texto), bq = p.borrador;
        if (tq && M.intencion(texto) !== 'saludo') {
          bq.titulo = tq; bq.detalle = texto; if (fq.iso) bq.fecha = fq.iso; if (fq.hora) bq.hora = fq.hora;
          if (cq.length && !bq.cli) { bq.clis = cq; bq.cli = cq[0].r; }
          if (bq.tipo === 'recordatorio' && !fq.iso && !fq.hora && !p.fechaDicha) { this.pregunta = { tipo: 'cuando', borrador: bq }; return '¿Para cuándo?'; }
          return this.confirmar(bq);
        }
        if (M.siNo(texto) < 0) return 'Bien, lo dejamos.';
      } else if (p.tipo === 'confirmar') {
        // Humberto (25-09-2026): "antes de una accion, confirmar dando el detalle". Aqui llega el si,
        // el no, una correccion ("mejor el jueves", "a las 4", "sin cliente", "que diga..."), o lo
        // repite completo (se reemplaza el borrador), o pide otra cosa (se atiende).
        var b0 = p.borrador, cambios = [], f0 = M.leerFecha(texto), it = M.intencion(texto), palabras = n.trim().split(' ').length;
        var nueva = /^(pend|precio|stock|contacto|cotiz|llamar|hecha|saludo|ayuda)$/.test(it) || (/^(recordatorio|tarea|nota|visita|prosp)$/.test(it) && palabras >= 3 && M.tituloDe(texto, f0).length > 3);
        if (!nueva) {
          if (f0.iso && f0.iso !== b0.fecha) { b0.fecha = f0.iso; cambios.push('fecha'); }
          if (f0.hora && f0.hora !== b0.hora) { b0.hora = f0.hora; cambios.push('hora'); }
          var mt = n.match(/ (?:es|sea|que sea|como|cambia\w*(?: a)?|hazlo|dejalo) (?:una? |como )?(recordatorio|tarea|visita|nota|prospeccion) /);
          if (mt) { var tp = mt[1] === 'prospeccion' ? 'prosp' : mt[1]; if (tp !== b0.tipo) { b0.tipo = tp; if (tp === 'recordatorio' && !b0.hora) b0.hora = '09:00'; cambios.push('tipo'); } }
          if (/ (sin cliente|ningun cliente) /.test(n) && b0.cli) { b0.cli = ''; cambios.push('cliente'); }
          else if (/ (el cliente|cliente es|es para|es de|para el cliente|a nombre de) /.test(n)) { var cc = this.cartera.buscar(texto)[0]; if (cc) { b0.cli = cc.r; cambios.push('cliente'); } }
          var mq = texto.match(/\b(?:que diga|el t[ií]tulo es|mejor que diga)\s+(.+)$/i); if (mq) { b0.titulo = M.capital(mq[1]); cambios.push('texto'); }
          if (cambios.length) return this.confirmar(b0, true);
          s = M.siNo(texto);
          if (s > 0) return this.guardar(b0);
          if (s < 0) return 'Bien, no lo guardo.';
          if ((p.intentos || 0) >= 1) return 'Lo dejo sin guardar. ¿Qué necesitas?';
          p.intentos = 1; this.pregunta = p;
          return 'No te entendí. ' + (b0.tipo === 'recordatorio' ? 'Te recuerdo ' + b0.titulo.charAt(0).toLowerCase() + b0.titulo.slice(1) + ' ' + M.fechaTxt(b0.fecha) + (b0.hora ? ' a las ' + b0.hora : '') : 'Guardo: ' + b0.titulo) + '. ¿Sí o no?';
        }
      } else if (p.tipo === 'cual') {
        var c = this.elegirDe(texto, p.clis);
        if (c) {
          if (p.para === 'borrador') { p.borrador.cli = c.r; return this.confirmar(p.borrador); }
          if (p.para === 'cotizado') { this.ult.cli = c; return M.cotizadoTxt(c.n, this.datos.cotizado(c.r)); }
          if (p.para === 'compras') { var selfC = this; this.ult.cli = c; return this.conVentas(function () { return M.comprasTxt(c.n, selfC.datos.comprasDe(c.r)); }); }
          return p.para === 'cuando' ? this.cuando(texto, c) : this.conCliente(p.para, c);
        }
        if (M.siNo(texto) < 0) return 'Bien.';
      } else if (p.tipo === 'hecha') {
        s = M.siNo(texto);
        if (s > 0) return this.marcarHecha(p.tarea);
        if (s < 0) return 'Bien, no la marco.';
      } else if (p.tipo === 'ia') {
        if (M.intencion(texto) === 'nose' || M.siNo(texto) !== 0) return this.preguntarIA(texto);   // le contesta a la IA
      }
      // no era una respuesta: sigue como orden nueva
    }
    // 2) Deshacer lo ultimo ("no, borra eso")
    var n2 = ' ' + n.replace(/[.,;:!?]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    if (/^ (no )?(no )?(cancela\w*|borra\w*|deshaz\w*|olvida\w*|elimina\w*|quita\w*|anula\w*)( eso| lo ultimo| ese recordatorio| esa tarea| la tarea| el recordatorio| la nota| esa nota)? $/.test(n2) && this.ultimaAccion && Date.now() - this.ultimaAccion.t < 180000) return this.deshacer();
    // 3) Pronombres: "cuando tengo que llamarlo" es el ultimo cliente del que se hablo
    var t2 = texto;
    if (this.ult.cli && !this.cartera.buscar(texto).length && /\b(lo|la|le|los|les|ese|esa|ellos|ese cliente|esa empresa|con el|con ella|a el|a ella)\b/.test(n)) t2 = texto + ' ' + this.ult.cli.n;
    // 4) "cuando tengo que...", "a que hora": se contesta con los pendientes
    if (/\b(cuando|a que hora|que dia|para cuando|para que dia)\b/.test(n) && !M.R.record.test(n) && !/\b(anota|apunta|agenda)/.test(n) && !M.R.compras.test(n) && !M.R.ventas.test(n)) return this.cuando(t2);
    var r = M.interpretar(t2, { datos: this.datos, cartera: this.cartera });
    if (r.tipo === 'saludo' || r.tipo === 'ayuda') return this._atenderTipo(r.tipo, n);
    if (r.tipo === 'pend') return this.decirPendientes();
    if (r.tipo === 'ventas' || r.tipo === 'meta') return this.decirVentas(r.tipo, r.periodo);
    if (r.tipo === 'riesgo' || r.tipo === 'mejores') { var self0 = this; return this.conVentas(function () { return M.carteraTxt(r.sub, self0.datos.cartera(r.sub)); }); }
    if (r.tipo === 'compras') { var self1 = this; this.ult.cli = r.cli; return this.conVentas(function () { return M.comprasTxt(r.cli.n, self1.datos.comprasDe(r.cli.r)); }); }
    if (r.tipo === 'cotizado') {
      if (r.cli) this.ult.cli = r.cli;
      if (!r.resultado) return 'Todavía no tengo las cotizaciones en el teléfono; dame unos segundos.';
      return M.cotizadoTxt(r.cli ? r.cli.n : (r.folio ? 'La cotización ' + r.folio : ''), r.resultado);
    }
    if (r.tipo === 'precio' || r.tipo === 'stock') {
      if (r.resultado) return this.decirProductos(r.tipo, r.resultado);
      if (this.datos.t && this.ia && this.enLinea() && this.clave()) return this.preguntarIA(texto);
      return 'No encontré ' + r.q + ' en los productos.';
    }
    if (r.tipo === 'ficha') return this.conCliente(r.para, r.cli);
    if (r.tipo === 'elegir') { this.pregunta = { tipo: 'cual', clis: r.clis, para: r.para, texto: texto }; return '¿Cuál? ' + this.listaNombres(r.clis); }
    if (r.tipo === 'hecha') {
      var cand = M.buscarPendiente(t2, r.cli, this.pend);
      if (!cand.length) return this.pend.length ? 'No encontré ese pendiente. Tienes ' + this.pend.length + (this.pend.length === 1 ? ' pendiente' : ' pendientes') + '; dime cuál es.' : 'No tienes pendientes.';
      // Siempre se confirma antes de actuar (Humberto, 25-09-2026).
      this.pregunta = { tipo: 'hecha', tarea: cand[0] }; return '¿Marco como hecha: ' + cand[0].titulo + (cand[0].cliente ? ', de ' + cand[0].cliente : '') + '?';
    }
    if (r.tipo === 'borrador') {
      var b = r.borrador, dicho = M.leerFecha(texto);
      // Falta el que ("puedes guardar un recordatorio"): se pregunta, no se adivina.
      if (b.sinQue) { this.pregunta = { tipo: 'que', borrador: b, fechaDicha: b.fechaDicha }; return b.tipo === 'recordatorio' ? (b.fechaDicha ? '¿Qué te recuerdo?' : '¿Qué te recuerdo, y para cuándo?') : b.tipo === 'nota' ? '¿Qué anoto?' : '¿Qué hay que hacer?'; }
      if (!b.cli && b.clis.length > 1) { this.pregunta = { tipo: 'cual', clis: b.clis, para: 'borrador', borrador: b }; return '¿Con qué cliente? ' + this.listaNombres(b.clis); }
      if (b.tipo === 'recordatorio' && !dicho.iso && !dicho.hora) { this.pregunta = { tipo: 'cuando', borrador: b }; return '¿Para cuándo?'; }
      return this.confirmar(b);
    }
    if (this.ia && this.enLinea() && this.clave()) return this.preguntarIA(texto);
    return { dicho: 'No te entendí. Pregúntame por el precio o el stock de un producto, los datos de un cliente o tus pendientes, o dime "recuérdame" y qué. ¿Qué necesitas?', seguir: true };
  };
  C.prototype._atenderTipo = function (tipo, n) {
    if (tipo === 'saludo') return this.saludo(n);
    return { dicho: 'Puedo decirte el precio y el stock de un producto; el teléfono, la dirección, lo cotizado y lo comprado por un cliente; tus ventas de hoy, la semana y el mes, tu meta y cuánto te falta; qué clientes llevan tiempo sin comprar y cuáles son los mejores; tus pendientes; y guardar recordatorios, tareas y notas. Por ejemplo: precio del R410A para Clima Norte; cuánto me ha comprado Refritec; clientes en riesgo; cómo voy con la meta; o recuérdame llamar a Frío Sur mañana a las 10. ¿Qué necesitas?', seguir: true };
  };
  // Ventas, meta, compras y cartera salen de la accion "ventas" (viene con la copia); si aun no esta, se pide ahora.
  C.prototype.conVentas = function (fn) {
    var self = this;
    if (this.datos.ventas) return fn();
    if (!this.enLinea() || !this.clave()) return 'Todavía no tengo las ventas en el teléfono y no hay señal para traerlas.';
    return this.api.llamar('ventas', {}, { releer: 2, plazo: 120000 }).then(function (v) {
      if (!v.ok) return v.error || 'No pude traer las ventas.';
      self.datos.usarVentas(v); if (self.alVentas) self.alVentas(v);
      return fn();
    }, function (e) { return e.red ? 'Sin señal para traer las ventas.' : 'No me llegaron las ventas; pregúntame de nuevo en unos segundos.'; });
  };
  C.prototype.decirVentas = function (tipo, periodo) { var self = this; return this.conVentas(function () { return M.ventasTxt(self.datos.ventas, tipo, periodo); }); };
  C.prototype.saludo = function (n) {
    if (/gracias/.test(n)) return 'De nada. Aquí estoy.';
    if (/chao|adios|hasta luego|nos vemos/.test(n)) return 'Chao, que te vaya bien.';
    var nom = String(this.nombre || '').split(' ')[0];
    return { dicho: 'Hola' + (nom ? ', ' + nom : '') + '. ¿Qué necesitas? Puedo darte precios, stock, datos de un cliente, tus pendientes, o guardar un recordatorio.', seguir: true };
  };
  C.prototype.listaNombres = function (clis) { var ns = clis.slice(0, 4).map(function (c) { return c.n; }); return ns.length > 1 ? ns.slice(0, -1).join(', ') + ' o ' + ns[ns.length - 1] : ns[0]; };
  // "el primero", "Frio Sur": cual de los candidatos
  C.prototype.elegirDe = function (texto, clis) {
    var n = ' ' + M.norm(texto) + ' ', ORD = [/\b(primer\w*|uno|1)\b/, /\b(segund\w*|dos|2)\b/, /\b(tercer\w*|tres|3)\b/, /\b(cuart\w*|cuatro|4)\b/];
    for (var i = 0; i < ORD.length && i < clis.length; i++) if (ORD[i].test(n)) return clis[i];
    var mejor = null, ms = 0;
    clis.forEach(function (c) { var sc = 0; (c._t || []).forEach(function (w) { if (n.indexOf(' ' + w) >= 0) sc++; }); if (sc > ms) { ms = sc; mejor = c; } });
    return mejor;
  };

  // ---------------------------------------------------------------- respuestas
  C.prototype.decirPendientes = function () {
    var self = this, hoy = this.pend.filter(function (t) { return t.dias != null && t.dias <= 0; }), prox = this.pend.filter(function (t) { return t.dias == null || t.dias > 0; });
    if (!this.pend.length) return 'No tienes nada pendiente.';
    if (hoy.length) this.ult.tarea = hoy[0];
    var lista = hoy.slice(0, 3).map(function (t) { var h = self.horaDe(t); return t.titulo + (h ? ' a las ' + h : '') + (t.dias < 0 ? ' (vencida)' : ''); }).join('; ');
    return (hoy.length ? 'Tienes ' + hoy.length + ' para hoy: ' + lista + (hoy.length > 3 ? '; y ' + (hoy.length - 3) + ' más' : '') + '.' : 'Nada para hoy.')
      + (prox.length ? ' ' + (hoy.length ? 'Además, ' : '') + prox.length + (prox.length === 1 ? ' pendiente próximo: ' : ' próximos: ') + prox.slice(0, 2).map(function (t) { return t.titulo + ' ' + self.cuandoTxt(t); }).join('; ') + '.' : '');
  };
  /* Varios productos parecidos se dicen todos (hasta 3), primero los que tienen stock y nombrando lo que
     los distingue: "R507 bombona 11.3 Kg: 1995 unidades. Sin stock: la de 10 Kg." */
  C.prototype.decirProductos = function (tipo, o) {
    var its = o.items.slice(0, 3), a = its[0], mas = o.items.length - its.length, d = M.distintivos(its); this.ult.prod = a;
    function bod(x) { return x.bod && x.bod.length > 1 ? ' (' + x.bod.map(function (b) { return b.s + ' en ' + b.b; }).join(', ') + ')' : ''; }
    if (tipo === 'stock') {
      var con = [], sin = [];
      its.forEach(function (x, i) { (x.stock > 0 ? con : sin).push({ x: x, d: i === 0 ? x.desc : d[i] }); });
      if (!con.length) return a.desc + ': sin stock' + (its.length > 1 ? ', ni ' + sin.slice(1).map(function (p) { return p.d; }).join(' ni ') : '') + '.';
      return con.map(function (p) { return p.d + ': ' + p.x.stock + ' unidades' + bod(p.x); }).join('. ') + '.'
        + (sin.length ? ' Sin stock: ' + sin.map(function (p) { return p.d; }).join(', ') + '.' : '') + (mas > 0 ? ' Y ' + mas + ' más.' : '');
    }
    var otros = its.slice(1).map(function (x, i) { return d[i + 1] + (x.precio ? ' a ' + Math.round(x.precio) : ' sin precio') + (x.stock ? ', stock ' + x.stock : ', sin stock'); });
    return a.desc + ': ' + (a.precio ? Math.round(a.precio) + ' pesos más IVA, ' : 'sin precio de lista, ') + (o.cliente ? 'para ' + o.cliente : 'en ' + o.listaNom) + '. Stock ' + (a.stock || 0) + '.'
      + (otros.length ? ' También ' + otros.join('; ') + '.' : '') + (mas > 0 ? ' Y ' + mas + ' más.' : '');
  };
  C.prototype.conCliente = function (para, c) {
    this.ult.cli = c;
    var f = this.datos.ficha(c.r); if (!f) return 'Todavía no tengo los datos de ' + c.n + '.';
    // Se dicta sin el +56 y de a un digito; el enlace tel: va completo.
    var cl = f.cliente, fono = cl.fono ? cl.fono.replace(/^\s*\+?56\s*/, '').replace(/\D/g, '').split('').join(' ') : '', tel = cl.fono ? cl.fono.replace(/[^\d+]/g, '') : '';
    if (para === 'llamar') return cl.fono ? { dicho: 'Llamando a ' + cl.nombre + ', ' + fono + '. Toca la pantalla para marcar.', tel: tel } : cl.nombre + ' no tiene teléfono registrado.';
    if (para === 'cotiz') {
      var cs = f.cotizaciones;
      return cs.length ? cl.nombre + ' tiene ' + cs.length + (cs.length === 1 ? ' cotización abierta' : ' cotizaciones abiertas') + ': ' + cs.slice(0, 3).map(function (q) { return 'la ' + q.folio + ' por ' + Math.round(q.monto) + ' pesos, de hace ' + q.dias + ' días'; }).join('; ') + '.' : cl.nombre + ' no tiene cotizaciones abiertas.';
    }
    var dir = [cl.dir, cl.comuna].filter(Boolean).join(', ');
    return { dicho: (cl.fono ? 'El teléfono de ' + cl.nombre + ' es ' + fono + '.' : cl.nombre + ' no tiene teléfono registrado.') + (dir ? ' Está en ' + dir + '.' : '') + (cl.bloqueado ? ' Ojo: está bloqueado.' : ''), tel: tel || undefined };
  };
  C.prototype.cuando = function (texto, cli) {
    var self = this, clis = cli ? [cli] : this.cartera.buscar(texto);
    if (!cli && clis.length > 1 && (clis[0]._cob || 0) < .6) { this.pregunta = { tipo: 'cual', clis: clis, para: 'cuando', texto: texto }; return '¿De cuál? ' + this.listaNombres(clis); }
    cli = cli || clis[0] || this.ult.cli;
    var ts = cli ? this.pendientesDe(cli) : (this.ult.tarea ? [this.ult.tarea] : []);
    if (!ts.length) return cli ? 'No tienes nada pendiente con ' + cli.n + '.' : 'No sé de qué pendiente hablas. Dime el cliente.';
    if (cli) this.ult.cli = cli; this.ult.tarea = ts[0];
    return M.capital(this.cuandoTxt(ts[0])) + ': ' + ts[0].titulo + '.' + (ts.length > 1 ? ' Y ' + (ts.length - 1) + (ts.length === 2 ? ' más: ' : ' más, la próxima: ') + ts[1].titulo + ' ' + self.cuandoTxt(ts[1]) + '.' : '');
  };

  // ---------------------------------------------------------------- confirmar con el detalle, y recien ahi actuar
  /* Humberto (25-09-2026): "toda la informacion por voz y, cuando vaya a hacer una accion, confirmar
     antes dando el detalle de lo que se registrara". Se dice tipo, que, cuando y con que cliente,
     y se espera si, no o una correccion. */
  C.prototype.confirmar = function (b, corregido) {
    this.pregunta = { tipo: 'confirmar', borrador: b };
    var c = this.cartera.porRut[b.cli], cuando = M.fechaTxt(b.fecha) + (b.hora ? ' a las ' + b.hora : ''), que = b.titulo.charAt(0).toLowerCase() + b.titulo.slice(1);
    var pre = corregido ? 'Queda así. ' : '';
    if (b.tipo === 'recordatorio') return pre + 'Recordatorio para ' + que + ', ' + cuando + (c ? ', cliente ' + c.n : '') + '. ¿Lo guardo?';
    if (b.tipo === 'nota') return pre + 'Nota' + (c ? ' de ' + c.n : '') + ': ' + b.titulo + '. ¿La guardo?';
    if (b.tipo === 'visita') return pre + 'Registro de visita' + (c ? ' a ' + c.n : '') + ', ' + M.fechaTxt(b.fecha) + ': ' + b.detalle + '. ¿La guardo?';
    if (b.tipo === 'prosp') return pre + 'Prospección' + (c ? ' de ' + c.n : '') + ': ' + b.detalle + '. ¿La guardo?';
    return pre + 'Tarea: ' + que + ', para ' + cuando + (c ? ', cliente ' + c.n : '') + '. ¿La guardo?';
  };

  // ---------------------------------------------------------------- acciones por detras (ya confirmadas)
  C.prototype.guardar = function (b) {
    var d = M.datosTarea(b, this.cartera), c = this.cartera.porRut[b.cli];
    var prov = { id: 'prov-' + d.rid, titulo: d.titulo, cliente: d.cliente, dias: M.diasHasta(d.fecha), hora: d.hora, prio: d.prioridad, detalle: d.detalle };
    this.pend.push(prov); this.pend.sort(function (x, y) { return (x.dias == null ? 999 : x.dias) - (y.dias == null ? 999 : y.dias); });
    this.cola.agregar('tarea', d, d.titulo);
    this.ultimaAccion = { tipo: 'tarea', rid: d.rid, t: Date.now(), txt: d.titulo }; this.ult.tarea = prov; if (c) this.ult.cli = c;
    var cuando = M.fechaTxt(d.fecha) + (d.hora ? ' a las ' + d.hora : ''), que = d.titulo.charAt(0).toLowerCase() + d.titulo.slice(1);
    if (b.tipo === 'recordatorio') return 'Listo. Te recuerdo ' + que + ' ' + cuando + '.';
    if (b.tipo === 'nota') return 'Listo, guardé la nota' + (c ? ' de ' + c.n : '') + '.';
    if (b.tipo === 'visita') return 'Listo, registré la visita' + (c ? ' a ' + c.n : '') + '.';
    if (b.tipo === 'prosp') return 'Listo, registré la prospección' + (c ? ' de ' + c.n : '') + '.';
    return 'Listo, guardé la tarea: ' + que + ', para ' + cuando + '.';
  };
  C.prototype.marcarHecha = function (t) {
    if (/^prov-/.test(t.id)) return 'Esa tarea todavía va en camino al CRM; espera un momento.';
    this.pend = this.pend.filter(function (x) { return x.id !== t.id; });
    this.cola.agregar('hecha', { id: t.id, rid: M.ridNuevo(), comentario: 'Cerrada por voz' }, t.titulo);
    this.ultimaAccion = null; this.ult.tarea = null;
    return 'Listo, marqué como hecha: ' + t.titulo + '.';
  };
  C.prototype.deshacer = function () {
    var a = this.ultimaAccion; this.ultimaAccion = null; if (!a || a.tipo !== 'tarea') return 'No hay nada que deshacer.';
    var enCola = this.cola.lista().some(function (x) { return x.d && x.d.rid === a.rid; }), self = this;
    var real = this.pend.filter(function (t) { return t.id === 'prov-' + a.rid; }).length ? null : (this.pend.filter(function (t) { return t.titulo === a.txt; })[0] || null);
    if (enCola && !this.cola.enviando) { this.cola.alm.set('cola', this.cola.lista().filter(function (x) { return !(x.d && x.d.rid === a.rid); })); this.pend = this.pend.filter(function (t) { return t.id !== 'prov-' + a.rid; }); return 'Listo, lo borré.'; }
    if (real) { this.pend = this.pend.filter(function (t) { return t.id !== real.id; }); this.cola.agregar('hecha', { id: real.id, rid: M.ridNuevo(), comentario: 'Cancelada por voz' }, a.txt); return 'Ya estaba en el CRM: lo dejé como cancelado.'; }
    this.cancelarAlConfirmar = a.rid; this.pend = this.pend.filter(function (t) { return t.id !== 'prov-' + a.rid; });
    return 'Va en camino al CRM; apenas llegue lo dejo como cancelado.';
  };

  // ---------------------------------------------------------------- IA con el historial
  C.prototype.preguntarIA = function (texto) {
    var self = this;
    return this.api.llamar('chat', { texto: texto, historial: this.chat }, { ms: 30000 }).then(function (o) {
      if (!o.ok) { if (o.sinIA) self.ia = false; return { dicho: o.sinIA ? 'No te entendí, y la inteligencia artificial no está configurada.' : (o.error || 'No se pudo.') }; }
      if (/\?\s*$/.test(o.texto)) self.pregunta = { tipo: 'ia' };
      if ((o.tarjetas || []).some(function (t) { return t.tipo === 'guardado' || t.tipo === 'hecha'; })) self.refrescarPendientes();
      return { dicho: o.texto, ia: true };
    }, function (e) { return { dicho: e.red ? 'Sin conexión: pregúntame de nuevo cuando tengas señal.' : 'No me llegó la respuesta; pregúntame de nuevo en unos segundos.' }; });
  };
  C.prototype.refrescarPendientes = function (cb) {
    var self = this;
    return this.api.llamar('pendientes', {}, { fondo: true }).then(function (o) { if (o.ok) self.pendMezclar(o.tareas); if (cb) cb(); }).catch(function () {});
  };

  raiz.VozCerebro = C;
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
})(typeof window !== 'undefined' ? window : globalThis);
