/* Voz Refrichile — ANÁLISIS (01-10-2026).
 *
 * Humberto: "un chat bot que tenga toda la información y razones para darme la mejor respuesta,
 * idealmente en tiempo real", y "sin incurrir en gastos". Por eso el análisis se calcula ACÁ, en
 * el teléfono, sobre la copia de datos que ya baja (ventas, cartera, cotizaciones, gestiones,
 * stock): en milisegundos, sin señal y sin ninguna IA pagada. Cada respuesta trae la cifra, el
 * porqué (razones con números comparables) y qué haría.
 *
 * Funciones puras sobre un VozMotor.Datos ya cargado (datos.usar + datos.usarVentas). Cada una
 * devuelve { filas:[…], total, … } y A.vista(r, datos) arma lo que se dice y lo que se pinta con
 * la misma forma que VozMotor.vista: { titulo, etiqueta, nombre, filas:[{n,s,v,vs,rut}], nota, dicho }.
 */
(function (raiz, fabrica) {
  if (typeof module !== 'undefined' && module.exports) module.exports = fabrica(require('./motor.js'));
  else { raiz.VozAnalisis = fabrica(raiz.VozMotor); if (raiz.VozMotor) raiz.VozMotor.analisis = raiz.VozAnalisis; }
}(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';
  var A = { version: '2026-10-01' };
  var P = function (n) { return M.plataTxt(n); };
  function hoy0(opc) { if (opc && opc.hoy) { var d = new Date(opc.hoy); d.setHours(0, 0, 0, 0); return d; } return M.hoy0(); }
  function pct(a, b) { return b ? Math.round((a - b) / Math.abs(b) * 100) : null; }
  function pctTxt(x) { return x == null ? 'sin base' : (x > 0 ? '+' : '') + x + '%'; }
  function dias(iso, hoy) { if (!iso) return null; return Math.round((hoy.getTime() - M.diasFecha(String(iso).slice(0, 10)).getTime()) / 86400000); }
  function habil(d) { var w = d.getDay(); return w >= 1 && w <= 5; }
  function nombreDe(datos, rut) { var c = datos.cliMap[rut]; return c ? c.n : rut; }
  function vendDe(datos, rut) { var c = datos.cliMap[rut]; return c && c.v ? c.v : ''; }
  function primerNombre(s) { return String(s || '').split(' ')[0]; }
  function compras(datos) { var m = datos.compras || {}; return Object.keys(m).map(function (r) { return m[r]; }); }
  function fechaDMY(s) { var p = String(s || '').split('-'); return p.length === 3 && p[2].length === 4 ? new Date(+p[2], +p[1] - 1, +p[0]) : null; }

  // Días hábiles (lunes a viernes) del mes en curso: cuántos pasaron (incluido hoy si es hábil) y cuántos quedan.
  A.diasHabiles = function (hoy) {
    var d = new Date(hoy.getFullYear(), hoy.getMonth(), 1), fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0), t = 0, r = 0, tot = 0;
    for (; d <= fin; d.setDate(d.getDate() + 1)) { if (!habil(d)) continue; tot++; if (d <= hoy) t++; else r++; }
    return { transcurridos: t, restantes: r, total: tot };
  };

  // Última gestión por cliente (la copia trae las más nuevas primero).
  function ultimaGestion(datos) { var u = {}; (datos.gest || []).forEach(function (g) { if (g.rut && !u[g.rut]) u[g.rut] = g; }); return u; }
  // Cotizaciones abiertas por cliente: [{folio, dias, monto, rut}]
  function cotsPorRut(datos) { var m = {}; (datos.cot || []).forEach(function (c) { (m[c[0]] = m[c[0]] || []).push({ rut: c[0], folio: String(c[1]), f: c[2], dias: c[3] || 0, monto: c[4] || 0 }); }); return m; }

  // ---------------------------------------------------------------- meta y ritmo
  A.meta = function (datos, opc) {
    var v = datos.ventas; if (!v) return null;
    var hoy = hoy0(opc), dh = A.diasHabiles(hoy), lista = [];
    var fuentes = v.equipo && v.vendedores && v.vendedores.length ? v.vendedores.slice() : [v];
    if (opc && opc.vendedor) fuentes = fuentes.filter(function (x) { return (x.cod || '') === opc.vendedor; });
    fuentes.forEach(function (x) {
      var meta = x.meta || 0, mes = x.mes || 0, falta = Math.max(0, meta - mes), ritmo = dh.transcurridos ? mes / dh.transcurridos : 0;
      var req = dh.restantes ? falta / dh.restantes : (falta > 0 ? Infinity : 0), proy = ritmo * dh.total;
      var estado = !meta ? 'sin meta' : mes >= meta ? 'cumplida' : proy >= meta ? 'en ritmo' : proy >= meta * .9 ? 'justo' : 'atrasado';
      lista.push({ cod: x.cod || datos.cod || '', nombre: x.nombre || (x.equipo ? 'Equipo' : 'Tú'), meta: meta, mes: mes, falta: falta, avance: meta ? Math.round(mes / meta * 100) : null,
        ritmo: Math.round(ritmo), requerido: req === Infinity ? null : Math.round(req), proyeccion: Math.round(proy), estado: estado, mesP: x.mesP || 0, mesPT: x.mesPT || 0 });
    });
    lista.sort(function (a, b) { return (b.avance || 0) - (a.avance || 0); });
    return { filas: lista, total: lista.length, dh: dh, equipo: v.equipo && !(opc && opc.vendedor) && lista.length > 1 ? { meta: v.meta || 0, mes: v.mes || 0, falta: Math.max(0, (v.meta || 0) - (v.mes || 0)), avance: v.avance || 0 } : null };
  };
  function metaTxt(r) {
    if (!r || !r.filas.length) return 'Todavía no tengo las ventas.';
    var dh = r.dh, s = [];
    var una = function (x, quien) {
      if (!x.meta) return quien + ' no tiene meta cargada; lleva ' + P(x.mes) + ' en el mes.';
      var t = quien + ' lleva ' + P(x.mes) + ', ' + x.avance + ' por ciento de la meta de ' + P(x.meta) + '.';
      if (x.estado === 'cumplida') return t + ' Meta cumplida.';
      t += ' Faltan ' + P(x.falta) + ' con ' + dh.restantes + (dh.restantes === 1 ? ' día hábil' : ' días hábiles') + ' por delante: hay que vender ' + P(x.requerido) + ' por día, y el ritmo actual es ' + P(x.ritmo) + ' por día.';
      t += x.estado === 'en ritmo' ? ' A este ritmo se llega (proyección ' + P(x.proyeccion) + ').' : x.estado === 'justo' ? ' Va justo: la proyección es ' + P(x.proyeccion) + '.' : ' A este ritmo no se llega: la proyección es ' + P(x.proyeccion) + '; hay que subir el ritmo ' + Math.round((x.requerido / (x.ritmo || 1) - 1) * 100) + ' por ciento.';
      return t;
    };
    if (r.equipo) {
      var e = r.equipo, req = dh.restantes ? e.falta / dh.restantes : 0, ritmo = dh.transcurridos ? e.mes / dh.transcurridos : 0;
      s.push('El equipo lleva ' + P(e.mes) + ', ' + e.avance + ' por ciento de la meta de ' + P(e.meta) + (e.falta > 0 ? '; faltan ' + P(e.falta) + ' en ' + dh.restantes + ' días hábiles, ' + P(req) + ' por día contra un ritmo actual de ' + P(ritmo) + '.' : '. Meta cumplida.'));
      s.push('Por vendedor: ' + r.filas.map(function (x) { return primerNombre(x.nombre) + ' ' + (x.avance == null ? P(x.mes) : x.avance + '%') + ' (' + x.estado + ')'; }).join(', ') + '.');
      var atras = r.filas.filter(function (x) { return x.estado === 'atrasado'; });
      if (atras.length) s.push('Lo que explica el atraso: ' + atras.map(function (x) { return primerNombre(x.nombre) + ' necesita ' + P(x.requerido) + ' por día y va a ' + P(x.ritmo); }).join('; ') + '.');
    } else s.push(una(r.filas[0], r.filas[0].cod && r.filas.length === 1 && r.filas[0].nombre !== 'Tú' ? primerNombre(r.filas[0].nombre) : 'Este mes'));
    return s.join(' ');
  }

  // Una frase de ritmo para colgar de "cuanto me falta para la meta" (M.ventasTxt): lo que hay que vender por dia habil
  // contra lo que se viene vendiendo, y si asi se llega.
  A.ritmoCorto = function (v, hoy) {
    if (!v || !v.meta || !(v.falta > 0)) return '';
    var dh = A.diasHabiles(hoy || M.hoy0()), ritmo = dh.transcurridos ? (v.mes || 0) / dh.transcurridos : 0, proy = ritmo * dh.total;
    if (!dh.restantes) return 'Hoy es el último día hábil del mes.';
    var req = v.falta / dh.restantes;
    return 'Quedan ' + dh.restantes + (dh.restantes === 1 ? ' día hábil' : ' días hábiles') + ': hay que vender ' + P(req) + ' por día, y el ritmo actual es ' + P(ritmo) + ' por día. ' + (proy >= v.meta ? 'A este ritmo se llega.' : proy >= v.meta * .9 ? 'Va justo.' : 'A este ritmo no se llega: hay que subir ' + Math.round((req / (ritmo || 1) - 1) * 100) + ' por ciento.');
  };

  // ---------------------------------------------------------------- cartera: caídas, pareto, riesgo, sin gestión, nuevos, reactivar
  A.caida = function (datos, opc) {
    var hoy = hoy0(opc), ug = ultimaGestion(datos), cp = cotsPorRut(datos);
    var lista = compras(datos).filter(function (c) { return c.ytdP > 0; }).map(function (c) {
      var g = ug[c.rut]; return { rut: c.rut, nombre: nombreDe(datos, c.rut), anio: c.anio || 0, ytdP: c.ytdP, delta: (c.anio || 0) - c.ytdP, pct: pct(c.anio || 0, c.ytdP), dias: c.dias, ultGest: g ? dias(g.f, hoy) : null, cot: (cp[c.rut] || []).length, vc: c.vc || vendDe(datos, c.rut) };
    }).filter(function (c) { return c.delta < 0; }).sort(function (a, b) { return a.delta - b.delta; });
    var n = (opc && opc.n) || 8, top = lista.slice(0, n);
    return { filas: top, total: lista.length, sumaCaida: lista.reduce(function (s, c) { return s + c.delta; }, 0), sumaTop: top.reduce(function (s, c) { return s + c.delta; }, 0) };
  };
  function caidaTxt(r, datos) {
    if (!r.total) return 'Ningún cliente viene cayendo respecto al año pasado a esta fecha.';
    var t = r.total + (r.total === 1 ? ' cliente compra' : ' clientes compran') + ' menos que el año pasado a esta fecha; en total ' + P(r.sumaCaida) + '. ';
    t += 'Las mayores caídas: ' + r.filas.slice(0, 5).map(function (c) { return c.nombre + ' ' + P(c.delta) + ' (' + pctTxt(c.pct) + (c.anio === 0 ? ', sin compras este año' : '') + (c.ultGest == null ? ', sin gestión registrada' : c.ultGest > 30 ? ', última gestión hace ' + c.ultGest + ' días' : '') + ')'; }).join('; ') + '.';
    var sinG = r.filas.filter(function (c) { return c.ultGest == null || c.ultGest > 30; });
    if (sinG.length) t += ' Qué haría: contactar primero a ' + sinG.slice(0, 3).map(function (c) { return c.nombre; }).join(', ') + ', que ' + (sinG.length === 1 ? 'no tiene' : 'no tienen') + ' gestión reciente.';
    return t;
  }
  A.pareto = function (datos, opc) {
    var lista = compras(datos).filter(function (c) { return c.anio > 0; }).sort(function (a, b) { return b.anio - a.anio; });
    var total = lista.reduce(function (s, c) { return s + c.anio; }, 0), acum = 0, A_ = [], B = [], C = [];
    lista.forEach(function (c) { acum += c.anio; var f = { rut: c.rut, nombre: nombreDe(datos, c.rut), anio: c.anio, pctAcum: total ? Math.round(acum / total * 100) : 0, pct: total ? Math.round(c.anio / total * 1000) / 10 : 0, ytdP: c.ytdP || 0, vc: c.vc || vendDe(datos, c.rut) }; (acum - c.anio) / (total || 1) < .8 ? A_.push(f) : (acum - c.anio) / (total || 1) < .95 ? B.push(f) : C.push(f); });
    var suma = function (l) { return l.reduce(function (s, c) { return s + c.anio; }, 0); };
    var n = (opc && opc.n) || 10;
    return { filas: A_.slice(0, n), total: lista.length, totalAnio: total, clases: { A: { n: A_.length, monto: suma(A_) }, B: { n: B.length, monto: suma(B) }, C: { n: C.length, monto: suma(C) } },
      cayendoA: A_.filter(function (c) { return c.ytdP > 0 && pct(c.anio, c.ytdP) <= -20; }) };
  };
  function paretoTxt(r) {
    if (!r.total) return 'No tengo compras del año para armar el pareto.';
    var t = r.clases.A.n + ' clientes hacen el 80 por ciento de la venta del año (' + P(r.clases.A.monto) + ' de ' + P(r.totalAnio) + ', entre ' + r.total + ' con compras). ';
    t += 'Clase B: ' + r.clases.B.n + ' clientes, ' + P(r.clases.B.monto) + '; clase C: ' + r.clases.C.n + ', ' + P(r.clases.C.monto) + '. ';
    t += 'Los más grandes: ' + r.filas.slice(0, 5).map(function (c) { return c.nombre + ' ' + P(c.anio) + ' (' + c.pct + '%)'; }).join(', ') + '.';
    if (r.cayendoA.length) t += ' Ojo: ' + r.cayendoA.length + (r.cayendoA.length === 1 ? ' cliente A viene cayendo' : ' clientes A vienen cayendo') + ' 20 por ciento o más: ' + r.cayendoA.slice(0, 3).map(function (c) { return c.nombre + ' ' + pctTxt(pct(c.anio, c.ytdP)); }).join(', ') + '.';
    return t;
  }
  A.riesgo = function (datos, opc) {
    var hoy = hoy0(opc), d = (opc && opc.dias) || 60, min = (opc && opc.minimo) || 0, ug = ultimaGestion(datos), cp = cotsPorRut(datos);
    var lista = compras(datos).filter(function (c) { return c.anio > min && c.dias != null && c.dias >= d; }).sort(function (a, b) { return b.anio - a.anio; }).map(function (c) {
      var g = ug[c.rut], cs = cp[c.rut] || [];
      return { rut: c.rut, nombre: nombreDe(datos, c.rut), anio: c.anio, ytdP: c.ytdP || 0, dias: c.dias, ultGest: g ? dias(g.f, hoy) : null, gestTipo: g ? g.tipo : '', cot: cs.length, cotMonto: cs.reduce(function (s, x) { return s + x.monto; }, 0), vc: c.vc || vendDe(datos, c.rut) };
    });
    var tramo = function (a, b) { return lista.filter(function (c) { return c.dias >= a && (b == null || c.dias < b); }).length; };
    return { filas: lista.slice(0, (opc && opc.n) || 10), total: lista.length, dias: d, suma: lista.reduce(function (s, c) { return s + c.anio; }, 0), tramos: { t60: tramo(60, 90), t90: tramo(90, 180), t180: tramo(180, null) } };
  }
  function riesgoTxt(r) {
    if (!r.total) return 'No hay clientes con compras del año sin comprar hace más de ' + r.dias + ' días.';
    var t = r.total + ' clientes con compras este año llevan ' + r.dias + ' días o más sin comprar; suman ' + P(r.suma) + ' en el año. ';
    if (r.dias <= 60) t += 'Por antigüedad: ' + r.tramos.t60 + ' entre 60 y 90 días, ' + r.tramos.t90 + ' entre 90 y 180, ' + r.tramos.t180 + ' más de 180. ';
    t += 'Los que más pesan: ' + r.filas.slice(0, 5).map(function (c) { return c.nombre + ' (' + P(c.anio) + ', ' + c.dias + ' días' + (c.cot ? ', ' + c.cot + ' cotización' + (c.cot > 1 ? 'es abiertas' : ' abierta') : '') + (c.ultGest == null ? ', sin gestión' : ', gestión hace ' + c.ultGest + ' d') + ')'; }).join('; ') + '.';
    var sinG = r.filas.filter(function (c) { return c.ultGest == null || c.ultGest > 30; }).slice(0, 3);
    if (sinG.length) t += ' Qué haría: llamar hoy a ' + sinG.map(function (c) { return c.nombre; }).join(', ') + (sinG.length === 1 ? ': no tiene' : ': no tienen') + ' gestión en 30 días.';
    return t;
  }
  A.sinGestion = function (datos, opc) {
    var hoy = hoy0(opc), d = (opc && opc.dias) || 30, min = (opc && opc.minimo) || 0, ug = ultimaGestion(datos);
    var lista = compras(datos).filter(function (c) { return c.anio > min; }).map(function (c) { var g = ug[c.rut]; return { rut: c.rut, nombre: nombreDe(datos, c.rut), anio: c.anio, mes: c.mes || 0, dias: c.dias, ultGest: g ? dias(g.f, hoy) : null, vc: c.vc || vendDe(datos, c.rut) }; })
      .filter(function (c) { return c.ultGest == null || c.ultGest > d; }).sort(function (a, b) { return b.anio - a.anio; });
    return { filas: lista.slice(0, (opc && opc.n) || 10), total: lista.length, dias: d, suma: lista.reduce(function (s, c) { return s + c.anio; }, 0), conCompras: compras(datos).filter(function (c) { return c.anio > min; }).length };
  };
  function sinGestionTxt(r) {
    if (!r.total) return 'Todos los clientes con compras tienen alguna gestión en los últimos ' + r.dias + ' días.';
    return r.total + ' de ' + r.conCompras + ' clientes con compras este año no tienen gestión en ' + r.dias + ' días (' + P(r.suma) + ' del año sin atención). Los más grandes: ' + r.filas.slice(0, 5).map(function (c) { return c.nombre + ' ' + P(c.anio) + (c.ultGest == null ? ', nunca' : ', hace ' + c.ultGest + ' d') + (c.dias != null && c.dias > 45 ? ', sin comprar hace ' + c.dias + ' d' : ''); }).join('; ') + '. Qué haría: partir por los que además llevan más de 45 días sin comprar.';
  }
  A.nuevos = function (datos) {
    var lista = compras(datos).filter(function (c) { return !c.ytdP && c.anio > 0; }).sort(function (a, b) { return b.anio - a.anio; }).map(function (c) { return { rut: c.rut, nombre: nombreDe(datos, c.rut), anio: c.anio, mes: c.mes || 0, dias: c.dias, vc: c.vc || vendDe(datos, c.rut) }; });
    return { filas: lista.slice(0, 10), total: lista.length, suma: lista.reduce(function (s, c) { return s + c.anio; }, 0) };
  };
  A.reactivar = function (datos) {
    var lista = compras(datos).filter(function (c) { return c.ytdP > 0 && !c.anio; }).sort(function (a, b) { return b.ytdP - a.ytdP; }).map(function (c) { return { rut: c.rut, nombre: nombreDe(datos, c.rut), ytdP: c.ytdP, dias: c.dias, vc: c.vc || vendDe(datos, c.rut) }; });
    return { filas: lista.slice(0, 10), total: lista.length, suma: lista.reduce(function (s, c) { return s + c.ytdP; }, 0) };
  };

  // ---------------------------------------------------------------- cotizaciones: pipeline, qué empujar, tasa de cierre
  function seguimientos(datos, hoy, d) {
    var porCot = {}, porRut = {};
    (datos.gest || []).forEach(function (g) { var dd = dias(g.f, hoy); if (dd == null || dd > d) return; if (g.cot) porCot[String(g.cot).replace(/\D/g, '')] = 1; if (g.rut) porRut[g.rut] = 1; });
    return { cot: porCot, rut: porRut };
  }
  function lineasPorCot(datos) { var m = {}; (datos.cotLineas || []).forEach(function (l) { (m[String(l[1])] = m[String(l[1])] || []).push({ cod: l[2], desc: l[3], cant: l[4] || 0, total: l[5] || 0 }); }); return m; }
  function stockDe(datos) { var m = {}; (datos.prod || []).forEach(function (p) { m[p.cod] = p.stock || 0; }); return m; }
  A.pipeline = function (datos, opc) {
    var hoy = hoy0(opc), vig = (datos.reglas && datos.reglas.vig) || 5, seg = seguimientos(datos, hoy, 7), porV = {};
    var cots = (datos.cot || []).map(function (c) { var rut = c[0], folio = String(c[1]), d = c[3] || 0, vc = vendDe(datos, rut); return { rut: rut, nombre: nombreDe(datos, rut), folio: folio, dias: d, monto: c[4] || 0, vencida: d > vig, sinSeg: !seg.cot[folio.replace(/\D/g, '')] && !seg.rut[rut], vc: vc }; });
    var tramo = function (a, b) { var l = cots.filter(function (c) { return c.dias >= a && (b == null || c.dias <= b); }); return { n: l.length, monto: l.reduce(function (s, c) { return s + c.monto; }, 0) }; };
    cots.forEach(function (c) { var k = c.vc || '—'; porV[k] = porV[k] || { vc: k, n: 0, monto: 0 }; porV[k].n++; porV[k].monto += c.monto; });
    var suma = function (l) { return l.reduce(function (s, c) { return s + c.monto; }, 0); }, venc = cots.filter(function (c) { return c.vencida; }), sinSeg = cots.filter(function (c) { return c.sinSeg; });
    return { filas: cots.slice().sort(function (a, b) { return b.monto - a.monto; }).slice(0, (opc && opc.n) || 10), total: cots.length, monto: suma(cots), tramos: { t0: tramo(0, 5), t6: tramo(6, 14), t15: tramo(15, 30), t31: tramo(31, null) },
      vencidas: { n: venc.length, monto: suma(venc) }, sinSeguimiento: { n: sinSeg.length, monto: suma(sinSeg) }, porVendedor: Object.keys(porV).map(function (k) { return porV[k]; }).sort(function (a, b) { return b.monto - a.monto; }), vig: vig };
  };
  function pipelineTxt(r, datos) {
    if (!r.total) return 'No hay cotizaciones abiertas en la copia.';
    var t = r.total + ' cotizaciones abiertas por ' + P(r.monto) + '. Por antigüedad: ' + r.tramos.t0.n + ' de hasta 5 días (' + P(r.tramos.t0.monto) + '), ' + r.tramos.t6.n + ' de 6 a 14 (' + P(r.tramos.t6.monto) + '), ' + r.tramos.t15.n + ' de 15 a 30 (' + P(r.tramos.t15.monto) + ') y ' + r.tramos.t31.n + ' de más de 30 (' + P(r.tramos.t31.monto) + '). ';
    t += r.vencidas.n + ' ya pasaron la vigencia de ' + r.vig + ' días (' + P(r.vencidas.monto) + ') y ' + r.sinSeguimiento.n + ' no tienen seguimiento en 7 días (' + P(r.sinSeguimiento.monto) + '). ';
    if (datos.todos && r.porVendedor.length > 1) t += 'Por vendedor: ' + r.porVendedor.map(function (v) { return (datos.vend[v.vc] ? primerNombre(datos.vend[v.vc]) : v.vc) + ' ' + v.n + ' por ' + P(v.monto); }).join(', ') + '. ';
    t += 'Las más grandes: ' + r.filas.slice(0, 3).map(function (c) { return c.nombre + ' ' + P(c.monto) + ' (' + c.dias + ' d)'; }).join(', ') + '.';
    return t;
  }
  A.aEmpujar = function (datos, opc) {
    var hoy = hoy0(opc), vig = (datos.reglas && datos.reglas.vig) || 5, seg = seguimientos(datos, hoy, 7), lin = lineasPorCot(datos), st = stockDe(datos);
    var lista = (datos.cot || []).map(function (c) {
      var rut = c[0], folio = String(c[1]), d = c[3] || 0, monto = c[4] || 0, ls = lin[folio] || [], razones = [], p = monto;
      var conStock = ls.length ? ls.every(function (l) { return (st[l.cod] || 0) >= l.cant; }) : null, sinSeg = !seg.cot[folio.replace(/\D/g, '')] && !seg.rut[rut];
      razones.push(P(monto));
      if (d >= vig - 2 && d <= vig) { p *= 1.5; razones.push(d === vig ? 'vence precio hoy' : 'vence precio en ' + (vig - d) + ' días'); }
      else if (d > vig) { p *= d > 60 ? .4 : .8; razones.push('precio vencido hace ' + (d - vig) + ' días'); }
      if (sinSeg) { p *= 1.3; razones.push('sin seguimiento 7 días'); } else razones.push('con seguimiento');
      if (conStock === true) { p *= 1.2; razones.push('todo con stock'); } else if (conStock === false) { p *= .7; razones.push('falta stock'); }
      return { rut: rut, nombre: nombreDe(datos, rut), folio: folio, dias: d, monto: monto, puntaje: Math.round(p), razones: razones, vc: vendDe(datos, rut) };
    }).sort(function (a, b) { return b.puntaje - a.puntaje; });
    return { filas: lista.slice(0, (opc && opc.n) || 5), total: lista.length };
  };
  function empujarTxt(r) {
    if (!r.total) return 'No hay cotizaciones abiertas que empujar.';
    return 'Empujaría estas ' + r.filas.length + ': ' + r.filas.map(function (c, i) { return (i + 1) + ') la ' + c.folio + ' de ' + c.nombre + ', ' + c.razones.join(', '); }).join('; ') + '. El orden sale del monto, la vigencia del precio, si tiene seguimiento y si hay stock.';
  }
  A.tasaCierre = function (datos, opc) {
    var v = datos.ventas, per = (opc && opc.periodo) === 'anio' ? 'anio' : 'mes', a = v && v.cot && v.cot[per]; if (!a) return null;
    var nP = a[0], mP = a[1], nV = a[2], mV = a[3], nX = a[4], mX = a[5], nN = a[6], mN = a[7], cerr = nV + nX;
    var filas = [{ n: 'Vendidas', v: nV, m: mV }, { n: 'Perdidas', v: nX, m: mX }, { n: 'Pendientes', v: nP, m: mP }, { n: 'Nulas', v: nN, m: mN }];
    var porV = v.vendedores && v.vendedores.length > 1 ? v.vendedores.map(function (x) { var b = x.cot && x.cot[per]; return b ? { nombre: x.nombre, tasa: b[2] + b[4] ? Math.round(b[2] / (b[2] + b[4]) * 100) : null, nV: b[2], nX: b[4] } : null; }).filter(Boolean) : [];
    return { filas: filas, periodo: per, tasa: cerr ? Math.round(nV / cerr * 100) : null, tasaMonto: mV + mX ? Math.round(mV / (mV + mX) * 100) : null, ticket: nV ? Math.round(mV / nV) : 0, porVendedor: porV, total: nP + nV + nX + nN };
  };
  function tasaTxt(r) {
    if (!r) return 'Todavía no tengo las cotizaciones por estado.';
    var per = r.periodo === 'anio' ? 'del año' : 'del mes', f = r.filas;
    var t = 'De las cotizaciones ' + per + ' se cerraron ' + (f[0].v + f[1].v) + ': ' + f[0].v + ' vendidas por ' + P(f[0].m) + ' y ' + f[1].v + ' perdidas por ' + P(f[1].m) + '. Tasa de cierre ' + (r.tasa == null ? 'sin base' : r.tasa + ' por ciento en cantidad y ' + r.tasaMonto + ' en monto') + '; ticket promedio vendido ' + P(r.ticket) + '. Quedan ' + f[2].v + ' pendientes por ' + P(f[2].m) + '.';
    if (r.porVendedor.length) t += ' Por vendedor: ' + r.porVendedor.map(function (x) { return primerNombre(x.nombre) + ' ' + (x.tasa == null ? 'sin cierres' : x.tasa + '% (' + x.nV + ' de ' + (x.nV + x.nX) + ')'); }).join(', ') + '.';
    return t;
  }

  // ---------------------------------------------------------------- stock y productos
  A.stockCritico = function (datos, opc) {
    var st = {}, desc = {}; (datos.prod || []).forEach(function (p) { st[p.cod] = p.stock || 0; desc[p.cod] = p.desc; });
    var porCod = {};
    (datos.cotLineas || []).forEach(function (l) { var c = l[2]; porCod[c] = porCod[c] || { cod: c, desc: desc[c] || l[3], cant: 0, monto: 0, cots: {} }; porCod[c].cant += l[4] || 0; porCod[c].monto += l[5] || 0; porCod[c].cots[String(l[1])] = 1; });
    var lista = Object.keys(porCod).map(function (c) { var x = porCod[c]; x.stock = st[c] || 0; x.falta = Math.max(0, x.cant - x.stock); x.nCot = Object.keys(x.cots).length; delete x.cots; return x; })
      .filter(function (x) { return x.falta > 0; }).sort(function (a, b) { return b.monto - a.monto; });
    var negativos = (datos.prod || []).filter(function (p) { return p.stock < 0; }).map(function (p) { return { cod: p.cod, desc: p.desc, stock: p.stock }; });
    return { filas: lista.slice(0, (opc && opc.n) || 8), total: lista.length, monto: lista.reduce(function (s, x) { return s + x.monto; }, 0), negativos: negativos };
  };
  function stockCriticoTxt(r) {
    if (!r.total) return 'Todo lo cotizado abierto tiene stock.' + (r.negativos.length ? ' Ojo: ' + r.negativos.length + ' productos con stock negativo.' : '');
    return r.total + ' productos están cotizados por más de lo que hay en stock; en juego ' + P(r.monto) + ' de cotizaciones abiertas. Los más críticos: ' + r.filas.slice(0, 5).map(function (x) { return x.desc + ': cotizados ' + x.cant + ', stock ' + x.stock + ', faltan ' + x.falta + ' (' + x.nCot + (x.nCot === 1 ? ' cotización' : ' cotizaciones') + ', ' + P(x.monto) + ')'; }).join('; ') + '. Qué haría: confirmar reposición o fecha antes de empujar esas cotizaciones.' + (r.negativos.length ? ' Además ' + r.negativos.length + ' productos con stock negativo.' : '');
  }
  A.productosTop = function (datos, opc) {
    var m = {};
    compras(datos).forEach(function (c) { (c.prods || []).forEach(function (p) { m[p] = m[p] || { desc: p, clientes: 0 }; m[p].clientes++; }); });
    var lista = Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.clientes - a.clientes; });
    return { filas: lista.slice(0, (opc && opc.n) || 8), total: lista.length, aprox: true };
  };
  function productosTxt(r) {
    if (!r.total) return 'No tengo productos de las últimas compras.';
    return 'Lo que más se repite en las últimas compras de los clientes: ' + r.filas.slice(0, 6).map(function (p) { return p.desc.toLowerCase() + ' (' + p.clientes + ' clientes)'; }).join(', ') + '. Es aproximado: la copia trae hasta tres productos por cliente.';
  }

  // ---------------------------------------------------------------- actividad y ranking del equipo
  A.actividad = function (datos, opc) {
    var hoy = hoy0(opc), per = (opc && opc.periodo) || 'semana', vc = opc && opc.vendedor, d0 = new Date(hoy);
    if (per === 'mes') d0.setDate(1); else d0.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));           // desde el 1 o desde el lunes
    var rg = { desde: M.iso(d0), hasta: M.iso(hoy) };
    var gs = (datos.gest || []).filter(function (g) { return g.f >= rg.desde && g.f <= rg.hasta && (!vc || g.vc === vc); }), tipos = {}, mets = {}, ruts = {}, porV = {};
    gs.forEach(function (g) { tipos[g.tipo] = (tipos[g.tipo] || 0) + 1; mets[g.met] = (mets[g.met] || 0) + 1; if (g.rut) ruts[g.rut] = 1; porV[g.vc] = (porV[g.vc] || 0) + 1; });
    var d0 = M.diasFecha(rg.desde), hab = 0; for (var d = new Date(d0); d <= hoy; d.setDate(d.getDate() + 1)) if (habil(d)) hab++;
    var cc = compras(datos).filter(function (c) { return c.anio > 0 && (!vc || (c.vc || vendDe(datos, c.rut)) === vc); }), tocados = cc.filter(function (c) { return ruts[c.rut]; }).length;
    var pa = A.pareto(datos), ug = ultimaGestion(datos), aSin = pa.filas.concat().filter(function (c) { var g = ug[c.rut]; return (!vc || c.vc === vc) && (!g || dias(g.f, hoy) > 30); });
    var top = function (o) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).slice(0, 3).map(function (k) { return { n: k, v: o[k] }; }); };
    return { filas: top(tipos), total: gs.length, periodo: per, habiles: hab || 1, porDia: Math.round(gs.length / (hab || 1) * 10) / 10, metodos: top(mets), clientes: Object.keys(ruts).length, conCompras: cc.length, tocados: tocados, cobertura: cc.length ? Math.round(tocados / cc.length * 100) : 0,
      porVendedor: Object.keys(porV).map(function (k) { return { vc: k, nombre: datos.vend[k] || k, n: porV[k] }; }).sort(function (a, b) { return b.n - a.n; }), aSinGestion: aSin.slice(0, 5), aSinTotal: aSin.length, vendedor: vc || '' };
  };
  function actividadTxt(r, datos) {
    var quien = r.vendedor ? primerNombre(datos.vend[r.vendedor] || r.vendedor) : (datos.todos ? 'El equipo' : 'Tú'), per = r.periodo === 'mes' ? 'este mes' : 'esta semana';
    if (!r.total) return quien + ' no tiene gestiones registradas ' + per + '.';
    var t = quien + (quien === 'Tú' ? ' llevas ' : ' lleva ') + r.total + ' gestiones ' + per + ', ' + r.porDia + ' por día hábil, con ' + r.clientes + ' clientes distintos' + (r.conCompras ? ' (' + r.cobertura + ' por ciento de los ' + r.conCompras + ' que compran este año)' : '') + '. ';
    t += 'Por tipo: ' + r.filas.map(function (x) { return x.n + ' ' + x.v; }).join(', ') + '; por medio: ' + r.metodos.map(function (x) { return x.n + ' ' + x.v; }).join(', ') + '. ';
    if (datos.todos && !r.vendedor && r.porVendedor.length > 1) t += 'Por vendedor: ' + r.porVendedor.map(function (x) { return primerNombre(x.nombre) + ' ' + x.n; }).join(', ') + '. ';
    if (r.aSinTotal) t += 'Ojo: ' + r.aSinTotal + (r.aSinTotal === 1 ? ' cliente A lleva' : ' clientes A llevan') + ' más de 30 días sin gestión: ' + r.aSinGestion.slice(0, 3).map(function (c) { return c.nombre; }).join(', ') + '.';
    return t;
  }
  A.ranking = function (datos, opc) {
    var v = datos.ventas; if (!v || !v.vendedores || !v.vendedores.length) return null;
    var hoy = hoy0(opc), m = A.meta(datos, opc), pp = A.pipeline(datos, opc), pa = A.pareto(datos), ug = ultimaGestion(datos), g7 = {};
    (datos.gest || []).forEach(function (g) { var d = dias(g.f, hoy); if (d != null && d <= 7) g7[g.vc] = (g7[g.vc] || 0) + 1; });
    var filas = m.filas.map(function (x) {
      var pv = pp.porVendedor.filter(function (p) { return p.vc === x.cod; })[0] || { n: 0, monto: 0 }, ven = (v.vendedores.filter(function (y) { return y.cod === x.cod; })[0] || {}), b = ven.cot && ven.cot.mes;
      return { cod: x.cod, nombre: x.nombre, mes: x.mes, meta: x.meta, avance: x.avance, estado: x.estado, requerido: x.requerido, ritmo: x.ritmo, pipeline: pv.monto, nCot: pv.n, gest7: g7[x.cod] || 0, tasa: b && (b[2] + b[4]) ? Math.round(b[2] / (b[2] + b[4]) * 100) : null,
        aSin: pa.filas.filter(function (c) { var g = ug[c.rut]; return c.vc === x.cod && (!g || dias(g.f, hoy) > 30); }).length };
    });
    return { filas: filas, total: filas.length, dh: m.dh };
  };
  function rankingTxt(r) {
    if (!r) return 'No tengo las ventas por vendedor.';
    var t = 'Por avance de meta: ' + r.filas.map(function (x) { return primerNombre(x.nombre) + ' ' + (x.avance == null ? P(x.mes) : x.avance + '%') + ' (' + x.estado + ')'; }).join(', ') + '. ';
    r.filas.forEach(function (x) {
      var por = [];
      if (x.estado === 'atrasado' || x.estado === 'justo') por.push('necesita ' + P(x.requerido) + ' por día y va a ' + P(x.ritmo));
      por.push(x.nCot + (x.nCot === 1 ? ' cotización abierta por ' : ' cotizaciones abiertas por ') + P(x.pipeline));
      por.push(x.gest7 + (x.gest7 === 1 ? ' gestión' : ' gestiones') + ' en 7 días');
      if (x.tasa != null) por.push('cierra el ' + x.tasa + '%');
      if (x.aSin) por.push(x.aSin + (x.aSin === 1 ? ' cliente A' : ' clientes A') + ' sin gestión en 30 días');
      t += primerNombre(x.nombre) + ': ' + por.join(', ') + '. ';
    });
    return t.trim();
  }

  // ---------------------------------------------------------------- lo que se dice y se pinta
  A.SUBS = ['ritmo', 'caida', 'pareto', 'riesgo', 'singestion', 'nuevos', 'reactivar', 'pipeline', 'empujar', 'tasa', 'stock', 'productos', 'actividad', 'ranking'];
  A.vista = function (r, datos, opc) {
    var o = { titulo: '', etiqueta: datos.hora ? 'datos ' + datos.hora.slice(11, 16) : '', nombre: '', filas: [], nota: '', dicho: '' }, sub = r.sub, x;
    var fila = function (n, s, v, vs, rut) { return { n: n, s: s || '', v: v || '', vs: vs || '', rut: rut || '' }; };
    var vend = function (c) { return datos.todos && c.vc ? (datos.vend[c.vc] ? primerNombre(datos.vend[c.vc]) : c.vc) : ''; };
    if (!datos.ventas && sub !== 'pipeline' && sub !== 'empujar' && sub !== 'stock') { o.dicho = 'Todavía no tengo las ventas en el teléfono; dame unos segundos.'; return o; }
    if (sub === 'ritmo') { x = A.meta(datos, r); o.titulo = 'Meta y ritmo'; o.dicho = metaTxt(x); if (x) o.filas = x.filas.map(function (f) { return fila(f.nombre, f.meta ? 'meta ' + M.pesos(f.meta) + ' · faltan ' + M.pesos(f.falta) + ' · ' + f.estado : 'sin meta', f.avance == null ? M.pesos(f.mes) : f.avance + '%', f.requerido != null ? M.pesos(f.requerido) + '/día (va a ' + M.pesos(f.ritmo) + ')' : ''); }); if (x) o.nota = x.dh.transcurridos + ' días hábiles pasados, ' + x.dh.restantes + ' por delante.'; }
    else if (sub === 'caida') { x = A.caida(datos, r); o.titulo = 'Clientes que caen · ' + x.total; o.dicho = caidaTxt(x, datos); o.filas = x.filas.map(function (c) { return fila(c.nombre, (c.ultGest == null ? 'sin gestión' : 'gestión hace ' + c.ultGest + ' d') + (c.cot ? ' · ' + c.cot + ' cot.' : '') + (vend(c) ? ' · ' + vend(c) : ''), M.pesos(c.delta), pctTxt(c.pct), c.rut); }); }
    else if (sub === 'pareto') { x = A.pareto(datos, r); o.titulo = 'Pareto · ' + x.clases.A.n + ' clientes A'; o.dicho = paretoTxt(x); o.filas = x.filas.map(function (c) { return fila(c.nombre, 'acumula ' + c.pctAcum + '%' + (vend(c) ? ' · ' + vend(c) : ''), M.pesos(c.anio), c.pct + '%', c.rut); }); o.nota = 'A: ' + x.clases.A.n + ' (' + M.pesos(x.clases.A.monto) + ') · B: ' + x.clases.B.n + ' · C: ' + x.clases.C.n + '.'; }
    else if (sub === 'riesgo') { x = A.riesgo(datos, r); o.titulo = 'Cartera en riesgo · ' + x.total; o.dicho = riesgoTxt(x); o.filas = x.filas.map(function (c) { return fila(c.nombre, c.dias + ' d sin comprar · ' + (c.ultGest == null ? 'sin gestión' : 'gestión hace ' + c.ultGest + ' d') + (c.cot ? ' · ' + c.cot + ' cot.' : '') + (vend(c) ? ' · ' + vend(c) : ''), M.pesos(c.anio), 'año', c.rut); }); }
    else if (sub === 'singestion') { x = A.sinGestion(datos, r); o.titulo = 'Sin gestión en ' + x.dias + ' días · ' + x.total; o.dicho = sinGestionTxt(x); o.filas = x.filas.map(function (c) { return fila(c.nombre, (c.ultGest == null ? 'nunca' : 'hace ' + c.ultGest + ' d') + (c.dias != null ? ' · compró hace ' + c.dias + ' d' : '') + (vend(c) ? ' · ' + vend(c) : ''), M.pesos(c.anio), 'año', c.rut); }); }
    else if (sub === 'nuevos') { x = A.nuevos(datos); o.titulo = 'Clientes nuevos · ' + x.total; o.dicho = x.total ? x.total + (x.total === 1 ? ' cliente nuevo este año' : ' clientes nuevos este año') + ' por ' + P(x.suma) + ': ' + x.filas.slice(0, 5).map(function (c) { return c.nombre + ' ' + P(c.anio); }).join(', ') + '.' : 'No hay clientes nuevos este año en la copia.'; o.filas = x.filas.map(function (c) { return fila(c.nombre, (c.dias != null ? 'última compra hace ' + c.dias + ' d' : '') + (vend(c) ? ' · ' + vend(c) : ''), M.pesos(c.anio), 'año', c.rut); }); }
    else if (sub === 'reactivar') { x = A.reactivar(datos); o.titulo = 'Por reactivar · ' + x.total; o.dicho = x.total ? x.total + ' clientes compraron el año pasado a esta fecha (' + P(x.suma) + ') y nada este año. Los más grandes: ' + x.filas.slice(0, 5).map(function (c) { return c.nombre + ' ' + P(c.ytdP); }).join(', ') + '. Qué haría: una llamada de reactivación con la lista de lo que compraban.' : 'Todos los clientes del año pasado compraron algo este año.'; o.filas = x.filas.map(function (c) { return fila(c.nombre, (c.dias != null ? 'última compra hace ' + c.dias + ' d' : '') + (vend(c) ? ' · ' + vend(c) : ''), M.pesos(c.ytdP), 'año pasado', c.rut); }); }
    else if (sub === 'pipeline') { x = A.pipeline(datos, r); o.titulo = 'Cotizaciones abiertas · ' + x.total; o.dicho = pipelineTxt(x, datos); o.filas = x.filas.map(function (c) { return fila(c.nombre, 'cot. ' + c.folio + ' · ' + c.dias + ' d' + (c.vencida ? ' · precio vencido' : '') + (c.sinSeg ? ' · sin seguimiento' : '') + (vend(c) ? ' · ' + vend(c) : ''), M.pesos(c.monto), '', c.rut); }); o.nota = 'Hasta 5 d: ' + x.tramos.t0.n + ' · 6-14: ' + x.tramos.t6.n + ' · 15-30: ' + x.tramos.t15.n + ' · +30: ' + x.tramos.t31.n + '. Vencidas ' + x.vencidas.n + ', sin seguimiento ' + x.sinSeguimiento.n + '.'; }
    else if (sub === 'empujar') { x = A.aEmpujar(datos, r); o.titulo = 'Qué empujar hoy'; o.dicho = empujarTxt(x); o.filas = x.filas.map(function (c) { return fila(c.nombre, 'cot. ' + c.folio + ' · ' + c.razones.slice(1).join(' · ') + (vend(c) ? ' · ' + vend(c) : ''), M.pesos(c.monto), c.dias + ' d', c.rut); }); }
    else if (sub === 'tasa') { x = A.tasaCierre(datos, r); o.titulo = 'Tasa de cierre ' + ((r.periodo === 'anio') ? 'del año' : 'del mes'); o.dicho = tasaTxt(x); if (x) { o.filas = x.filas.map(function (f) { return fila(f.n, '', f.v, M.pesos(f.m)); }); o.nota = x.tasa == null ? '' : 'Cierre ' + x.tasa + '% en cantidad, ' + x.tasaMonto + '% en monto · ticket ' + M.pesos(x.ticket) + '.'; } }
    else if (sub === 'stock') { x = A.stockCritico(datos, r); o.titulo = 'Stock crítico · ' + x.total; o.dicho = stockCriticoTxt(x); o.filas = x.filas.map(function (p) { return fila(p.desc, p.cod + ' · ' + p.nCot + ' cot. · ' + M.pesos(p.monto), 'faltan ' + p.falta, 'cot. ' + p.cant + ' / stock ' + p.stock); }); }
    else if (sub === 'productos') { x = A.productosTop(datos, r); o.titulo = 'Productos que más se repiten'; o.dicho = productosTxt(x); o.filas = x.filas.map(function (p) { return fila(p.desc, '', p.clientes, 'clientes'); }); o.nota = 'Aproximado: hasta 3 productos por cliente en la copia.'; }
    else if (sub === 'actividad') { x = A.actividad(datos, r); o.titulo = 'Actividad ' + (x.periodo === 'mes' ? 'del mes' : 'de la semana') + ' · ' + x.total; o.dicho = actividadTxt(x, datos); o.filas = (datos.todos && !x.vendedor && x.porVendedor.length ? x.porVendedor.map(function (v) { return fila(v.nombre, '', v.n, 'gestiones'); }) : x.filas.map(function (f) { return fila(f.n, '', f.v, 'gestiones'); })); o.nota = x.porDia + ' por día hábil · ' + x.clientes + ' clientes · cobertura ' + x.cobertura + '%' + (x.aSinTotal ? ' · ' + x.aSinTotal + ' clientes A sin gestión' : '') + '.'; }
    else if (sub === 'ranking') { x = A.ranking(datos, r); o.titulo = 'Equipo: cómo va cada uno'; o.dicho = rankingTxt(x); if (x) o.filas = x.filas.map(function (v) { return fila(v.nombre, v.estado + ' · ' + v.nCot + ' cot. ' + M.pesos(v.pipeline) + ' · ' + v.gest7 + ' gest. 7 d' + (v.tasa != null ? ' · cierra ' + v.tasa + '%' : '') + (v.aSin ? ' · ' + v.aSin + ' A sin gestión' : ''), v.avance == null ? M.pesos(v.mes) : v.avance + '%', v.requerido != null ? 'necesita ' + M.pesos(v.requerido) + '/d' : ''); }); }
    else o.dicho = 'No entendí qué análisis quieres.';
    if (o.dicho && o.etiqueta && !/^Todavía/.test(o.dicho)) o.dicho += ' Datos de las ' + datos.hora.slice(11, 16) + '.';
    return o;
  };
  if (M) M.analisis = A;                                   // tambien en Node: M.vista({tipo:'analisis'}) lo encuentra
  return A;
}));
