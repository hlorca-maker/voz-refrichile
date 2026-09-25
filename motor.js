/* Voz Refrichile — MOTOR (25-09-2026).
 *
 * El nucleo de la app de voz SIN pantalla: entender la frase (que se quiere, de que producto o
 * cliente, para cuando), buscar en la copia de datos que vive en el telefono, armar el borrador
 * de una tarea, y hablar con la API (colas, reintentos, rid). Lo usan la app de voz y la
 * "consulta rapida" que se incorpora al CRM movil (consulta.js). Nada aqui toca el DOM ni
 * localStorage directamente (el almacen se inyecta), asi que se prueba en Node tal cual.
 *
 * Humberto (25-09-2026): "que sea como Siri: le pido algo y lo hace o me responda, lo mas rapido
 * posible" y "util para los vendedores en terreno". Por eso todo lo que se pueda contestar con
 * la copia del telefono se contesta aqui, en milisegundos y sin senal; a la IA va solo lo que no
 * queda claro.
 *
 * Uso:  var m = VozMotor;  var datos = new m.Datos(), cartera = new m.Cartera();
 *       datos.usar(respuestaDeLaAccionDatos);  cartera.cargar(datos.clientes());
 *       m.interpretar('precio r410a para clima norte', { datos: datos, cartera: cartera })
 *       -> { tipo: 'precio', resultado: { listaNom, cliente, items:[{cod, desc, precio, stock}] } }
 */
(function (raiz) {
  'use strict';
  var M = { version: '2026-09-25' };

  // ------------------------------------------------------------------ utilidades
  M.norm = function (s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\/:.,]+/g, ' ').replace(/\s+/g, ' ').trim(); };
  // Igual que _vozNorm_ de la API: la busqueda de productos da lo mismo aca que alla.
  M.normP = function (s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\/.,]+/g, ' ').replace(/\s+/g, ' ').trim(); };
  M.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  M.pesos = function (n) { return n == null ? 'sin precio' : '$' + Math.round(n).toLocaleString('es-CL'); };
  M.iso = function (d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  M.hoy0 = function () { var d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  M.capital = function (s) { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };
  M.ridNuevo = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); };
  M.horaTxt = function (t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
  var DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  var DIAS_TXT = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var NUM = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30 };
  M.numero = function (w) { return /^\d+$/.test(w) ? +w : (NUM[w] || null); };
  M.fechaTxt = function (isoS) {
    var p = String(isoS || '').split('-'); if (p.length < 3) return isoS || '';
    var d = new Date(+p[0], +p[1] - 1, +p[2]), h = M.hoy0(), dif = Math.round((d - h) / 86400000);
    if (dif === 0) return 'hoy'; if (dif === 1) return 'mañana';
    if (dif > 1 && dif < 7) return 'el ' + DIAS_TXT[d.getDay()];
    return 'el ' + d.getDate() + ' de ' + MESES[d.getMonth()];
  };

  // ------------------------------------------------------------------ fechas y horas dichas
  M.leerFecha = function (f) {
    var t = ' ' + M.norm(f) + ' ', d = null, hora = '', usado = [];
    function quita(rx) { var m = t.match(rx); if (m) { usado.push(m[0].trim()); t = t.replace(rx, ' '); } return m; }
    var h0 = M.hoy0(), m;
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
    if (quita(/ pasado manana /)) { d = new Date(h0); d.setDate(d.getDate() + 2); }
    else if (quita(/ manana /)) { d = new Date(h0); d.setDate(d.getDate() + 1); }
    else if (quita(/ hoy /)) d = new Date(h0);
    else if ((m = quita(/ en (\w+) (dia|dias|semana|semanas|mes|meses) /))) {
      var n = M.numero(m[1]); if (n) { d = new Date(h0); if (/^dia/.test(m[2])) d.setDate(d.getDate() + n); else if (/^semana/.test(m[2])) d.setDate(d.getDate() + 7 * n); else d.setMonth(d.getMonth() + n); }
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
    return { iso: d ? M.iso(d) : '', hora: hora, usado: usado };
  };

  // ------------------------------------------------------------------ que se quiere hacer
  M.R = {
    hecha: /\b(marca(r|la|lo)? (como )?(hecha|hecho|lista|listo|terminada)|ya (llame|hable|visite|hice|envie|mande|cotice)|termine (la tarea|de)|completar tarea)\b/,
    pend: /\b(que tengo( pendiente\w*| que hacer)?( para| de)? (hoy|manana|esta semana)|que tengo pendiente\w*|(mis|los|las) (pendientes|tareas|recordatorios)|que me toca|pendientes (de|para) (hoy|manana)|que hay (para|de) hoy|mi agenda|agenda de hoy)\b|^ que tengo $|^ pendientes $/,
    record: /\b(recuerd\w*|recordatorio|recordar|avisame|acuerdame|no (me )?olvid\w*)\b/,
    llamar: /^ (quiero |necesito |voy a |hay que )?(llama\w*|marca\w*) (a |al |la |el |con )?/,
    contacto: /\b(telefono|fono|celular|numero de (telefono|contacto)|correo|mail|email|direccion|donde queda|ubicacion|contacto de|datos (de|del)|ficha (de|del)|que sabes de|informacion (de|del))\b/,
    cotiz: /\b(cotizaciones?( abiertas| pendientes)? (de|del|a|para)|que (le )?(tengo |he )?cotizad\w*|que le cotice)\b/,
    // 25-09-2026 (Humberto): productos cotizados a un cliente, mis ventas, mi meta y cuanto me falta
    cotizado: /\b(que (le |les )?(hemos |he |tengo |tiene |tenemos |les |le )?cotiz(ado|amos|aste|e)\b|productos?( \w+){0,2} cotizad\w*|tiene\w* cotizad\w*|que (hay|va|viene|tiene|trae) (en )?la cotizacion|detalle de (la )?cotizacion|que (le )?cotice|cotizado a|que le (estamos|estoy) cotizando)\b/,
    ventas: /\b(mis ventas|cuant[oa]s? (se )?(lleva\w*|llevo|hemos|he|va|van|vamos|voy) (vendid\w*|facturad\w*)|cuanto (vendi|vendimos|vendio|facturamos|facture)\b|cuantas ventas|ventas? (de |del )?(hoy|mes|ano|semana)|como voy\b|como vamos\b|vendido (este|del|en el) (mes|ano)|vendido hoy|facturacion del mes|cuanto (llevo|vamos|voy) (en )?(el )?mes|cuanto (he|hemos) vendido|lo vendido|mi facturacion)\b/,
    meta: /\b(mi meta|cual es (mi|la) meta|meta del mes|cuanto (me |nos )?falta (para|por) (la meta|vender|cumplir|llegar|facturar)|cuanto (me|nos) falta|como (voy|vamos) con la meta|avance de (la )?meta|(estoy|estamos|vamos a) (cumpliendo|llegando|llegar)|voy a llegar|cumpliendo la meta)\b/,
    stock: /\b(stock|hay (stock|disponible|disponibilidad)|cuant[oa]s? (?!se |le |les |nos )(\w+ ){0,3}(hay|quedan|tenemos)\b(?! vendid| factur| cobrad)|disponibilidad)\b/,
    precio: /\b(precio|precios|cuanto (le |les )?(cuesta|sale|vale|esta|cobra\w*)|a como (esta|sale)|valor (de|del)|a cuanto)\b/,
    visita: /\b(visite|visitamos|estuve (con|en|donde)|fui (a|donde)|pase (a|por|donde)|me reuni|reunion con)\b/,
    prosp: /\b(prospect\w*|nuevo (negocio|cliente|proyecto)|oportunidad|posible (cliente|negocio)|potencial cliente)\b/,
    tarea: /\b(tarea|tengo que|hay que|debo|volver a (llamar|consultar|contactar|visitar|escribir|cotizar)|llamar a|consultar a|enviar|mandar|agendar)\b/
  };
  // Cortesias y rodeos al inicio ("hola, me puedes guardar un recordatorio para...") -> la orden pelada
  // ("recuerdame ..."), para que la intencion y el titulo salgan limpios.
  M.limpiarOrden = function (t) {
    var s = ' ' + String(t == null ? '' : t).trim() + ' ';
    s = s.replace(/^\s*(hola|oye|oiga|por favor|porfa|mira|a ver|ok|bueno|entonces)[,.]?\s+(?=\S)/i, ' ');   // solo si sigue algo ("ok" solo es un si)
    s = s.replace(/^\s*(me )?(puedes|podr[ií]as|quiero que|necesito que|quisiera que|quiero|necesito|quisiera|me gustar[ií]a que|me gustar[ií]a|ay[uú]dame a|te pido que|por favor)\s+/i, ' ');
    s = s.replace(/^\s*(guarda(r|rme|me)?|agrega(r|rme|me)?|crea(r|rme|me)?|pon(er|erme|me)?|registra(r|rme|me)?|agenda(r|rme|me)?|anota(r|rme|me)?|hacer|haz(me)?)\s+(un |una |el |la )?(recordatorio|aviso|alarma)\s*(para que|para|de que|de|que|:)?\s*/i, ' recuérdame ');
    s = s.replace(/^\s*(un |una )?(recordatorio|aviso)\s+(para que|para|de que|de|que)\s+/i, ' recuérdame ');
    s = s.replace(/^\s*(guarda(r|rme|me)?|agrega(r|rme|me)?|crea(r|rme|me)?|pon(er|erme|me)?|registra(r|rme|me)?|anota(r|rme|me)?)\s+(una |la )?tarea\s*(para que|para|de que|de|que|:)?\s*/i, ' tengo que ');
    s = s.replace(/^\s*(guarda(r|rme|me)?|agrega(r|rme|me)?|crea(r|rme|me)?|pon(er|erme|me)?|registra(r|rme|me)?|deja(r|rme|me)?|toma(r)?)\s+(una |la )?nota\s*(de que|de|que|:)?\s*/i, ' anota que ');
    s = s.replace(/^\s*(recordarme|que me recuerdes|recu[eé]rdame que|recu[eé]rdame de|recu[eé]rdame)\s+/i, ' recuérdame ');
    s = s.replace(/^\s*(buscar|busca|buscame|b[uú]scame|consultar|consulta|ver|revisar|revisa)\s+(los |las |el |la )?(datos|informaci[oó]n|info|ficha)\s+(de |del |de la )?(cliente |empresa )?/i, ' datos de ');
    return s.replace(/\s+/g, ' ').trim();
  };
  M.intencion = function (t) {
    var R = M.R, n = ' ' + M.norm(t) + ' ';
    // Saludos y despedidas cortos, y "que puedes hacer": se contestan, no se adivinan.
    if (n.split(' ').length <= 7 && /^ (hola|buenos dias|buenas tardes|buenas noches|buenas|que tal|como estas|como esta|gracias|muchas gracias|ok gracias|listo gracias|chao|adios|hasta luego|nos vemos|hola buenos dias|hola buenas|hola que tal)( \w+){0,2} $/.test(n)) return 'saludo';
    if (/\b(que (puedes|sabes|podrias|puedo) (hacer|preguntar\w*|pedir\w*|consultar)|en que (me )?(puedes |podrias )?ayud\w*|necesito ayuda|como funciona\w*|que haces|para que sirves|que cosas (puedes|haces|sabes)|instrucciones|que (me )?ofreces)\b/.test(n)
      || /^ (ayuda|ayudame) $/.test(n)
      || /^ (me )?(puedes|sabes|podrias) (buscar|consultar|ver|revisar|darme|entregar|decir) (los |las )?(datos|informacion|info|precios|stock|cotizaciones|pendientes|clientes|productos)( de (los |las )?(clientes?|productos?))? $/.test(n)) return 'ayuda';
    if (R.record.test(n)) return 'recordatorio';
    if (R.hecha.test(n)) return 'hecha';
    if (R.pend.test(n)) return 'pend';
    if (R.meta.test(n)) return 'meta';
    if (R.ventas.test(n)) return 'ventas';
    if (R.cotizado.test(n)) return 'cotizado';
    if (R.llamar.test(n) && !M.leerFecha(t).iso) return 'llamar';           // con fecha es una tarea
    if (/\b(tengo que|hay que|debo|volver a|no olvidar)\b/.test(n)) return 'tarea';
    // Ventas, facturacion o cobranza no son ni stock ni precio ("cuantas ventas hay hoy"): eso no lo sabe la copia.
    var ventas = /\b(ventas?|vendid\w*|vendimos|vendio|vendi|factur\w*|cobranza|cobrad\w*)\b/.test(n);
    var orden = ['contacto', 'cotiz', 'stock', 'precio', 'visita', 'prosp', 'tarea'];
    for (var i = 0; i < orden.length; i++) if (R[orden[i]].test(n) && !(ventas && (orden[i] === 'stock' || orden[i] === 'precio'))) return orden[i];
    if (/ (anota\w*|apunta\w*|nota|registra que|deja (una )?nota) /.test(n)) return 'nota';
    // Humberto (25-09-2026, dos veces): "pregunte algo y se anoto como recordatorio". Una fecha sola
    // ("hoy", "manana") es recordatorio SOLO si la frase no tiene forma de pregunta ni de pedido de
    // informacion en ninguna parte; lo demas no se adivina (va a la IA o se dice que no se entendio).
    var pregunta = /\?/.test(t) || /^ (que|cual|cuales|cuanto|cuanta|cuantos|cuantas|como|donde|quien|quienes|cuando|dame|dime|busca\w*|muestrame) /.test(n)
      || /\b(cuanto|cuanta|cuantos|cuantas|cual|cuales|donde|quien|quienes|dame|dime|busca\w*|muestrame|puedes|podrias|quiero saber|necesito saber|sabes|cuentame|me dices|informame|vendido|vendimos|ventas|facturado|cobrado)\b/.test(n);
    return !pregunta && M.leerFecha(t).iso ? 'recordatorio' : 'nose';
  };
  // Lo que queda de la frase para usar como titulo: sin la orden ni la fecha.
  M.tituloDe = function (t, fecha) {
    var s = ' ' + String(t) + ' ';
    fecha.usado.forEach(function (u) {
      var rx = new RegExp(' ' + u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(' ').map(function (w) { return w.replace(/[aeiou]/g, '[aeiouáéíóú]').replace(/n/g, '[nñ]'); }).join(' ') + ' ', 'i');
      s = s.replace(rx, ' ');
    });
    s = s.replace(/^\s*(recu[eé]rdame|recordarme|recordatorio( de| para)?|recordar|av[ií]same|acu[eé]rdame|anota( que)?|tengo que|hay que|debo|tarea( de| para)?)\s+/i, ' ');
    s = s.replace(/^\s*(que|de)\s+/i, ' ');
    return M.capital(s.replace(/\s+/g, ' ').trim()).slice(0, 150);
  };
  M.cotizacionDe = function (t) { var m = M.norm(t).match(/cotizacion(?:es)?(?: (?:numero|nro|n|no))? ?(\d{3,7})/); return m ? m[1] : ''; };
  M.productoDe = function (t, cli) {
    var s = ' ' + M.norm(t) + ' ';
    s = s.replace(/ (dame|dime|me das|me dices|quiero|necesito|consulta(r)?|cual es|el|la|los|las)( | el | la )/g, ' ');
    s = s.replace(/ (precio|precios|cuanto (le |les )?(cuesta|sale|vale|esta|cobra\w*)|a como (esta|sale)|a cuanto|valor (de|del)|stock|hay stock|hay disponible|disponibilidad|cuant[oa]s? (hay|quedan|tenemos)|tenemos|tienen|tengo) /g, ' ');
    if (cli && cli._t) { cli._t.forEach(function (w) { s = s.replace(new RegExp(' ' + w + ' ', 'g'), ' '); }); s = s.replace(/ (para|a|al|del|de) (cliente )?\s*$/, ' '); s = s.replace(/ para (el cliente )?$/, ' '); }
    s = s.replace(/ erre /g, ' r ').replace(/ r ?-? ?(\d{2,3}) ?([a-z])?(?= )/g, function (x, n, l) { return ' r' + n + (l || '') + ' '; });
    s = s.replace(/ (refrigerante|gas|bombona|freon) (\d{2,3}[a-z]?)(?= )/g, ' $1 r$2 ');       // "refrigerante 507" = r507
    s = s.replace(/ (dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta)(?= )/g, function (x, w) { return ' ' + NUM[w]; });
    s = s.replace(/(\d) (coma|punto) (\d)/g, '$1.$3').replace(/(\d) y medi[oa](?= )/g, '$1.5');
    return s.replace(/ (de|del|para|el|la|un|una)(?= )/g, ' ').replace(/ (de|del|para|el|la|un|una)(?= )/g, ' ').replace(/\s+/g, ' ').trim();
  };

  // ------------------------------------------------------------------ cartera de clientes
  var SUF = ' ltda limitada spa sa s.a eirl e.i.r.l sociedad soc cia y e hijos el la los las de del al en con por para un una ';
  // Palabras de la orden que no son parte de un nombre de cliente ("tengo" casi calzaba con "Rengo").
  var STOP_Q = ' tengo tienes tiene tenemos que cuando como donde quien cual hora dia llamar llamarlo llamarla llamarle llamo llame llama hablar visitar visite enviar mandar precio precios stock telefono fono correo direccion cotizacion cotizaciones recuerdame recordatorio tarea nota anota manana hoy pasado semana mes para por con del las los una uno dos tres cuatro cinco seis siete ocho nueve diez cliente empresa datos ficha contacto marca marcar hecha hecho lista mejor sobre '
    + 'ese esa eso esto este esta estos estas aquel aquella puedes podrias quiero necesito quisiera guardar guardame agregar agregame crear creame registrar poner ponme favor recordar recordarme avisame hola gracias buenas buenos dias tardes noches busca buscar buscame dame dime muestrame aviso alarma pendiente pendientes ';
  function tokensCli(n) { return M.norm(n).replace(/[.,\-]/g, ' ').split(' ').filter(function (w) { return w.length > 2 && SUF.indexOf(' ' + w + ' ') < 0; }); }
  function parecido(a, b) {
    if (a === b) return true;
    if (a.length < 6 || b.length < 6 || Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, dif = 0;
    while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++dif > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
    return dif + (a.length - i) + (b.length - j) <= 1;
  }
  M.Cartera = function () { this.lista = []; this.idf = {}; this.porRut = {}; };
  M.Cartera.prototype.cargar = function (lista) {
    var df = {}, self = this;
    this.lista = (lista || []).map(function (c) { return { r: c.r, n: c.n, l: c.l || '' }; });
    this.porRut = {};
    this.lista.forEach(function (c) { self.porRut[c.r] = c; c._t = tokensCli(c.n); c._t.forEach(function (w) { df[w] = (df[w] || 0) + 1; }); });
    var N = Math.max(1, this.lista.length); this.idf = {};
    Object.keys(df).forEach(function (w) { self.idf[w] = Math.log(1 + N / df[w]); });
    return this;
  };
  // Clientes que calzan con la frase, del mas probable al menos. laxo: cualquier calce sirve
  // (para "llama a Frio", donde la frase es casi solo el nombre y se elige tocando).
  M.Cartera.prototype.buscar = function (frase, laxo) {
    var idf = this.idf, ws = M.norm(frase).replace(/[.,\-]/g, ' ').split(' ').filter(function (w) { return w.length > 1 && SUF.indexOf(' ' + w + ' ') < 0 && STOP_Q.indexOf(' ' + w + ' ') < 0; }), out = [];
    var n0 = ws.length; for (var i = 0; i < n0 - 1; i++) { ws.push(ws[i] + ws[i + 1]); if (i < n0 - 2) ws.push(ws[i] + ws[i + 1] + ws[i + 2]); }
    this.lista.forEach(function (c) {
      if (!c._t || !c._t.length) return;
      var sc = 0, tot = 0, hit = 0, maxL = 0;
      c._t.forEach(function (w) { var f = idf[w] || 1; tot += f; if (ws.some(function (x) { return parecido(x, w); })) { sc += f; hit++; if (w.length > maxL) maxL = w.length; } });
      if (!hit) return;
      var cob = sc / tot;
      // Una sola palabra corta o que es solo parte del nombre no reconoce a un cliente ("ese" no es ESE SPA).
      if (!laxo && hit === 1 && cob < 1 && (maxL < 5 || cob < .5)) return;
      if (laxo || sc >= 2.2 || cob >= .6) { c._cob = cob; out.push({ c: c, sc: sc + cob * 3 }); }
    });
    out.sort(function (a, b) { return b.sc - a.sc; });
    return out.slice(0, 4).map(function (x) { return x.c; });
  };
  // Para el buscador mientras se escribe: por prefijo de palabra, rapido y sin umbral.
  M.Cartera.prototype.sugerir = function (texto, max) {
    var q = M.norm(texto).split(' ').filter(Boolean); if (!q.length) return [];
    var out = [];
    for (var i = 0; i < this.lista.length && out.length < (max || 5) * 4; i++) {
      var c = this.lista[i], n = ' ' + M.norm(c.n) + ' ', ok = q.every(function (w) { return n.indexOf(' ' + w) >= 0 || n.indexOf(w) >= 0; });
      if (ok) out.push({ c: c, sc: q.every(function (w) { return n.indexOf(' ' + w) >= 0; }) ? 2 : 1 });
    }
    out.sort(function (a, b) { return b.sc - a.sc || a.c.n.length - b.c.n.length; });
    return out.slice(0, max || 5).map(function (x) { return x.c; });
  };

  // ------------------------------------------------------------------ copia de datos (accion "datos" de la API)
  var STOP_P = ' de del la el los las un una para por con y a al en que precio precios cuanto cuesta sale vale valor stock hay tenemos quedan dame dime el la me ';
  M.Datos = function () { this.t = 0; this.hora = ''; this.dolar = 0; this.listas = {}; this.cols = ['PrecioBase', 'LAP', 'LAA', 'L2A', 'L2B', 'L2C', 'L2M']; this.reglas = { vig: 5, cal: 14 }; this.prod = []; this.cliMap = {}; this.cli = []; this.cot = []; this.tareas = []; };
  M.Datos.prototype.usar = function (o, t) {
    this.t = t || Date.now(); this.hora = o.hora || ''; this.dolar = o.dolar || 0; this.listas = o.listas || {}; this.cols = o.listaCols || this.cols; this.reglas = o.reglas || this.reglas;
    this.prod = (o.prod || []).map(function (p) {
      var txt = ' ' + M.normP(p[0] + ' ' + p[1]) + ' ';
      return { cod: p[0], desc: p[1], act: !!(p[2] & 1), conPrecio: !!(p[2] & 2), stock: p[3] || 0, bod: p[4] || [], pr: p[5] || 0, _t: txt, _c: txt.replace(/[\s\-\/.]/g, ''), _cod: M.normP(p[0]) };
    });
    var map = {}; this.cli = [];
    (o.cli || []).forEach(function (c) { if (!map[c[0]]) map[c[0]] = { r: c[0], n: c[1], l: c[2], f: c[3], m: c[4], d: c[5], c: c[6], b: !!c[7] }; });
    this.cliMap = map; this.cli = Object.keys(map).map(function (r) { return map[r]; });
    this.cot = o.cot || []; this.cotLineas = o.cotLineas || []; this.tareas = o.tareas || [];
    return this;
  };
  M.Datos.prototype.usarVentas = function (v, t) { this.ventas = v || null; this.ventasT = t || Date.now(); };
  // Cotizaciones abiertas de un cliente (o una por folio) con sus productos.
  M.Datos.prototype.cotizado = function (rut, folio) {
    var porK = {};
    this.cotLineas.forEach(function (l) { if ((rut && l[0] !== rut) || (folio && l[1] !== String(folio))) return; (porK[l[0] + '|' + l[1]] = porK[l[0] + '|' + l[1]] || []).push({ cod: l[2], desc: l[3], cant: l[4], monto: l[5] }); });
    return this.cot.filter(function (c) { return (!rut || c[0] === rut) && (!folio || c[1] === String(folio)); }).sort(function (a, b) { return a[3] - b[3]; })
      .map(function (c) { return { rut: c[0], folio: c[1], fecha: c[2], dias: c[3], monto: c[4], lineas: (porK[c[0] + '|' + c[1]] || []).sort(function (a, b) { return b.monto - a.monto; }) }; });
  };
  // Montos para decirlos: 26.500.000 -> "26,5 millones"; 380.000 -> "380 mil"
  M.plataTxt = function (n) {
    n = Math.round(n || 0); var s = n < 0 ? 'menos ' : '', a = Math.abs(n);
    if (a >= 1e6) { var m = Math.round(a / 1e5) / 10; return s + String(m).replace('.', ',') + (m === 1 ? ' millón' : ' millones'); }
    if (a >= 1e3) return s + Math.round(a / 1e3) + ' mil';
    return s + a + ' pesos';
  };
  // Que decir de las ventas (vendedor o equipo). tipo 'meta' pone el foco en lo que falta.
  M.ventasTxt = function (v, tipo) {
    if (!v) return 'Todavía no tengo las ventas.';
    var d = new Date(), quedan = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate();
    var lleva = (v.equipo ? 'El equipo lleva ' : 'Este mes llevas ') + M.plataTxt(v.mes) + (v.docs ? ' en ' + v.docs + (v.docs === 1 ? ' documento' : ' documentos') : '') + (v.equipo ? ' este mes' : '') + '.';
    var meta = v.meta ? ((v.equipo ? 'La meta del equipo es ' : 'Tu meta es ') + M.plataTxt(v.meta) + ': ' + (v.falta > 0 ? (v.equipo ? 'faltan ' : 'te faltan ') + M.plataTxt(v.falta) + ' (' + v.avance + ' por ciento)' : 'ya está cumplida (' + v.avance + ' por ciento)') + (v.falta > 0 && quedan ? ', con ' + quedan + (quedan === 1 ? ' día' : ' días') + ' por delante' : '') + '.') : (v.equipo ? 'No hay meta cargada este mes.' : 'No tienes meta cargada para este mes.');
    var eq = v.equipo && v.vendedores ? ' ' + v.vendedores.map(function (x) { return x.nombre.split(' ')[0] + ' ' + M.plataTxt(x.mes) + (x.meta ? ' (' + (x.avance || 0) + '%)' : ''); }).join(', ') + '.' : '';
    var anio = ' En el año, ' + M.plataTxt(v.anio) + '.';
    return tipo === 'meta' ? meta + ' ' + lleva + eq + anio : lleva + ' ' + meta + eq + anio;
  };
  // Que decir de lo cotizado a un cliente.
  M.cotizadoTxt = function (nombre, cots) {
    if (!cots.length) return (nombre || 'Ese cliente') + ' no tiene cotizaciones abiertas.';
    var frases = cots.slice(0, 2).map(function (c) {
      var ls = c.lineas.slice(0, 4).map(function (l) { return l.desc.toLowerCase() + (l.cant ? ', ' + l.cant + (l.cant === 1 ? ' unidad' : ' unidades') : ''); });
      return 'La ' + c.folio + ', de hace ' + c.dias + (c.dias === 1 ? ' día' : ' días') + ' por ' + M.plataTxt(c.monto) + (ls.length ? ': ' + ls.join('; ') + (c.lineas.length > 4 ? '; y ' + (c.lineas.length - 4) + ' más' : '') : '') + '.';
    });
    return (nombre ? nombre + ' tiene ' : 'Hay ') + cots.length + (cots.length === 1 ? ' cotización abierta. ' : ' cotizaciones abiertas. ') + frases.join(' ') + (cots.length > 2 ? ' Y ' + (cots.length - 2) + ' más.' : '');
  };
  M.Datos.prototype.clientes = function () { return this.cli.map(function (c) { return { r: c.r, n: c.n, l: c.l }; }); };
  // Busqueda de productos, calcada de _vozBuscar_ de la API (mismos puntajes) mas plurales.
  M.Datos.prototype.buscarProd = function (q, tipo, max) {
    var tks = M.normP(String(q || '').replace(/(\d),(\d)/g, '$1.$2')).split(' ').filter(function (w) { return w && STOP_P.indexOf(' ' + w + ' ') < 0; });
    if (!tks.length) return [];
    var gas = tks.some(function (w) { return /^r\d{2,3}[a-z]?$/.test(w); }), qn = M.normP(q), res = [];
    var formas = tks.map(function (w) { return w.length > 4 && /s$/.test(w) ? [w, w.replace(/es$/, ''), w.replace(/s$/, '')] : [w]; });
    this.prod.forEach(function (it) {
      if (!it.act && !it.conPrecio) return;
      if (tipo === 'stock' && !it.act) return;
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
    // Entre los que calzan igual de bien, primero los que tienen stock (Humberto, 25-09-2026: "me responde
    // justo con el que no hay, siendo que hay uno con mucho stock").
    res.sort(function (a, b) { return ((b.it.stock > 0) - (a.it.stock > 0)) || b.sc - a.sc || a.it.desc.length - b.it.desc.length; });
    return res.slice(0, max || 5).map(function (x) { return x.it; });
  };
  // Lo que distingue a cada producto entre varios parecidos: las palabras que no comparten todos
  // ("GENERICO R507 GAS REFRIGERANTE BOMBONA 11.3 Kg" y "... 10 Kg" -> "11.3 Kg" y "10 Kg").
  M.distintivos = function (items) {
    var ws = items.map(function (x) { return String(x.desc).split(/\s+/); });
    if (ws.length < 2) return items.map(function (x) { return x.desc; });
    var comunes = ws[0].filter(function (w) { return ws.every(function (l) { return l.indexOf(w) >= 0; }); });
    // Un numero se queda con su unidad ("10 Kg", "5 CFM"), aunque la unidad sea comun a todos.
    return ws.map(function (l, i) { var d = l.filter(function (w, j) { return comunes.indexOf(w) < 0 || (j > 0 && /^\d/.test(l[j - 1]) && comunes.indexOf(l[j - 1]) < 0 && w.length <= 4); }).join(' '); return d || items[i].desc; });
  };
  M.Datos.prototype.precioDe = function (it, lista) {
    var li = this.cols.indexOf(lista), base = this.cols.indexOf('PrecioBase');
    var usd = (li >= 0 && it.pr && it.pr[li]) || (it.pr && it.pr[base]) || 0;
    return usd > 0 && this.dolar ? Math.round(usd * this.dolar) : null;
  };
  // Respuestas con la MISMA forma que devuelve la API: se pintan igual vengan de donde vengan.
  M.Datos.prototype.precio = function (q, cli, hits) {
    hits = hits || this.buscarProd(q, 'precio', 5); if (!hits.length) return null;
    var self = this, lista = cli && cli.l ? cli.l : 'L2A';
    return { ok: true, local: true, lista: lista, listaNom: this.listas[lista] || lista, cliente: cli ? cli.n : '', hora: this.hora,
      items: hits.map(function (x) { return { cod: x.cod, desc: x.desc, precio: self.precioDe(x, lista), stock: x.stock, bod: x.bod.map(function (b) { return { b: b[0], s: b[1] }; }) }; }) };
  };
  M.Datos.prototype.stock = function (q, hits) {
    hits = hits || this.buscarProd(q, 'stock', 5); if (!hits.length) return null;
    return { ok: true, local: true, hora: this.hora, items: hits.map(function (x) { return { cod: x.cod, desc: x.desc, stock: x.stock, bod: x.bod.map(function (b) { return { b: b[0], s: b[1] }; }) }; }) };
  };
  M.Datos.prototype.ficha = function (rut) {
    var c = this.cliMap[rut]; if (!c) return null;
    var cots = this.cot.filter(function (x) { return x[0] === rut; }).map(function (x) { return { folio: x[1], fecha: x[2], dias: x[3], monto: x[4] }; })
      .sort(function (a, b) { return a.dias - b.dias; }).slice(0, 8);
    return { ok: true, local: true, cliente: { rut: rut, nombre: c.n, lista: this.listas[c.l] || c.l, listaCod: c.l, fono: c.f, mail: c.m, dir: c.d, comuna: c.c, bloqueado: c.b }, cotizaciones: cots, reglas: this.reglas };
  };

  // ------------------------------------------------------------------ interpretar una frase
  /* Devuelve que hacer, sin hacerlo:
       { tipo:'pend' } | { tipo:'precio'|'stock', q, cli, resultado, consulta }  (resultado null = no esta en la copia)
       { tipo:'ficha', para:'contacto'|'cotiz'|'llamar', cli, resultado } | { tipo:'elegir', clis, para }
       { tipo:'hecha', cli } | { tipo:'borrador', borrador } | { tipo:'ia', motivo }  */
  M.interpretar = function (texto, ctx) {
    var tipo0 = M.intencion(texto);                                  // saludo y "que puedes hacer" se miran antes de limpiar
    if (tipo0 === 'saludo' || tipo0 === 'ayuda') return { tipo: tipo0 };
    texto = M.limpiarOrden(texto);
    var datos = ctx.datos, cartera = ctx.cartera, tipo = M.intencion(texto), n = ' ' + M.norm(texto) + ' ';
    if (tipo === 'saludo' || tipo === 'ayuda') return { tipo: tipo };
    var clis = cartera.buscar(texto), cli = clis[0] || null;
    var claro = !!cli && ((cli._cob || 0) >= .6 || clis.length === 1), nombrado = / (para|del cliente|de la empresa|a nombre de|donde) /.test(n);
    if (tipo === 'pend') return { tipo: 'pend' };
    if (tipo === 'ventas' || tipo === 'meta') return { tipo: tipo, resultado: datos.ventas || null };
    if (tipo === 'cotizado') {
      var folio = M.cotizacionDe(texto);
      if (!cli && !folio) { clis = cartera.buscar(texto, true); cli = clis[0] || null; claro = !!cli && clis.length === 1; }
      if (!cli && !folio) return { tipo: 'ia', motivo: 'sin cliente' };
      if (cli && !claro && !folio) return { tipo: 'elegir', clis: clis, para: 'cotizado' };
      return { tipo: 'cotizado', cli: cli, folio: folio, resultado: datos.t ? datos.cotizado(cli ? cli.r : '', folio) : null };
    }
    if (tipo === 'precio' || tipo === 'stock') {
      if (cli && !claro && nombrado) return { tipo: 'ia', motivo: 'cliente ambiguo', clis: clis };
      var q = M.productoDe(texto, tipo === 'precio' && claro ? cli : null);
      if (!q) return { tipo: 'ia', motivo: 'sin producto' };
      var c1 = claro ? cli : null, o = datos.t ? (tipo === 'precio' ? datos.precio(q, c1) : datos.stock(q)) : null;
      return { tipo: tipo, q: q, cli: c1, resultado: o, consulta: { accion: tipo, q: q, rut: c1 ? c1.r : '', texto: texto } };
    }
    if (tipo === 'contacto' || tipo === 'cotiz' || tipo === 'llamar') {
      if (!cli) { clis = cartera.buscar(texto, true); cli = clis[0] || null; claro = !!cli && clis.length === 1; }
      if (!cli) return { tipo: 'ia', motivo: 'sin cliente' };
      if (!claro) return { tipo: 'elegir', clis: clis, para: tipo };
      return { tipo: 'ficha', para: tipo, cli: cli, resultado: datos.ficha(cli.r) };
    }
    if (tipo === 'hecha') return { tipo: 'hecha', cli: cli };
    if (/^(recordatorio|tarea|visita|prosp|nota)$/.test(tipo)) return { tipo: 'borrador', borrador: M.borrador(tipo, texto, clis) };
    return { tipo: 'ia', motivo: 'no se entendio' };
  };

  // ------------------------------------------------------------------ borrador de tarea y respuestas si/no
  M.borrador = function (tipo, texto, clis) {
    clis = clis || [];
    if (tipo === 'cotiz' || tipo === 'contacto' || tipo === 'precio' || tipo === 'stock' || tipo === 'llamar') tipo = 'tarea';
    var f = M.leerFecha(texto), cot = M.cotizacionDe(texto), cli = clis[0] || null;
    if (tipo === 'prosp' && cli && (cli._cob || 0) < .6) cli = null;   // una prospeccion suele ser alguien que aun no es cliente
    var titulo = M.tituloDe(texto, f);
    // "puedes guardar un recordatorio" sin decir de que: falta el "que" (se pregunta).
    var sinQue = !titulo.replace(/^(un |una |el |la |otro |otra )?(recordatorio|aviso|alarma|tarea|nota|pendiente|algo|una cosa)s?\.?$/i, '').trim();
    if (tipo === 'visita') { titulo = 'Registrar visita' + (cli ? ' a ' + cli.n : ''); sinQue = false; }
    if (tipo === 'prosp') { titulo = 'Prospección' + (cli ? ': ' + cli.n : ''); sinQue = false; }
    return { tipo: tipo, titulo: titulo, detalle: texto, fecha: f.iso || M.iso(M.hoy0()), hora: f.hora || (tipo === 'recordatorio' ? '09:00' : ''), clis: clis, cli: cli ? cli.r : '', cot: cot, sinQue: sinQue, fechaDicha: !!(f.iso || f.hora) };
  };
  M.fraseBorrador = function (b, cartera) {
    var lo = { recordatorio: 'el recordatorio', tarea: 'la tarea', visita: 'la visita', prosp: 'la prospección', nota: 'la nota' }[b.tipo], c = cartera && cartera.porRut[b.cli];
    return 'Guardo ' + lo + ' para ' + M.fechaTxt(b.fecha) + (b.hora && b.tipo === 'recordatorio' ? ' a las ' + b.hora : '') + (c ? ', ' + c.n : '') + '. ¿Lo guardo?';
  };
  // Lo que se manda a la accion "tarea" (con rid fijo: si se repite, la API devuelve lo ya hecho).
  M.datosTarea = function (b, cartera) {
    var c = cartera && cartera.porRut[b.cli];
    return { rid: M.ridNuevo(), titulo: b.titulo + (b.cot && b.titulo.indexOf(b.cot) < 0 ? ' (cot. ' + b.cot + ')' : ''), cliente: c ? c.n : '', fecha: b.fecha, hora: b.hora,
      detalle: b.detalle, prioridad: b.tipo === 'recordatorio' ? 'Alta' : 'Media', recordar: b.tipo === 'recordatorio' || !!b.hora, tipo: b.tipo, texto: b.detalle };
  };
  var SI_RX = /\b(si|sip|dale|guard\w*|anot\w*|registr\w*|agend\w*|ok|okey|okay|confirm\w*|ya|listo|correcto|perfecto|de acuerdo|claro|hazlo|bueno|exacto|esta bien|asi esta bien|por favor)\b/;
  var NO_RX = /\b(no|nop|cancel\w*|borr\w*|olvid\w*|descart\w*|elimin\w*|nada|dejalo|deja eso|mejor no|equivoqu\w*)\b/;
  // +1 si, -1 no, 0 no queda claro. Gana lo que se dijo primero ("si, no hay problema" es un si).
  M.siNo = function (texto) {
    var n = ' ' + M.norm(texto) + ' ';
    if (/\bno (lo )?se\b/.test(n)) return 0;                                 // "no se" no es un no
    if (/\bno (me |te |se )?olvid/.test(n)) return 1;
    if (/\bno (lo |la |le )?(guard|anot|registr|agend|grab)\w*/.test(n)) return -1;
    if (/\bno hay problema\b/.test(n)) return 1;
    var a = n.search(SI_RX), b = n.search(NO_RX);
    if (a < 0 && b < 0) return 0;
    if (a < 0) return -1;
    if (b < 0) return 1;
    return a < b ? 1 : -1;
  };
  // Que pendiente se quiso cerrar ("ya llame a Clima Norte"): el que mas palabras comparte.
  M.buscarPendiente = function (texto, cli, pend) {
    var ws = M.norm(texto).split(' '), raices = ws.filter(function (w) { return w.length >= 5; }).map(function (w) { return w.slice(0, 4); });
    return (pend || []).map(function (t) {
      var tt = M.norm(t.titulo + ' ' + t.cliente).split(' '), sc = 0;
      tt.forEach(function (w) { if (w.length > 3 && ws.indexOf(w) >= 0) sc++; else if (w.length >= 5 && raices.indexOf(w.slice(0, 4)) >= 0) sc += .5; });   // "llame" ~ "llamar"
      if (cli && t.cliente && M.norm(t.cliente) === M.norm(cli.n)) sc += 3;
      return { t: t, sc: sc };
    }).filter(function (x) { return x.sc > 0; }).sort(function (a, b) { return b.sc - a.sc; }).map(function (x) { return x.t; });
  };
  M.diasHasta = function (isoS) { var f = String(isoS || '').split('-'); return f.length === 3 ? Math.round((new Date(+f[0], +f[1] - 1, +f[2]).getTime() - M.hoy0().getTime()) / 86400000) : null; };

  // ------------------------------------------------------------------ API (tres filas, tope, reintentos, rid)
  /* Medido el 25-09-2026: la API trabaja menos de 2 s por llamada pero Google puede tardar
     hasta 45 s en entregar la respuesta o perderla (404). Filas: "u" lo que pide la persona,
     "e" las escrituras que van por detras, "f" el segundo plano; "e" y "f" esperan a que no haya
     nada de la persona en curso. Errores: e.red (no salio), e.tope (no volvio a tiempo),
     e.perdida (404 o ilegible: la llamada SI se ejecuto). Las lecturas se reintentan (opc.releer
     veces, 1 por defecto); chat/tarea/hecha llevan rid y se reintentan mientras quede plazo: la
     API devuelve lo ya hecho sin repetirlo. */
  M.Api = function (opc) {
    this.url = opc.url; this.clave = typeof opc.clave === 'function' ? opc.clave : function () { return opc.clave || ''; };
    this.tope = opc.tope || 35000; this.plazo = opc.plazo || 75000; this.pausa = { corta: 800, larga: 15000 };
    this.alSinClave = opc.alSinClave || function () {};
    this.fetch = opc.fetch || (typeof fetch === 'function' ? fetch.bind(raiz) : null);
    this.cola = []; this.vuelo = { u: 0, e: 0, f: 0 };
  };
  M.Api.RELEER = { inicio: 1, calentar: 1, pendientes: 1, configIA: 1, datos: 1, ventas: 1 };
  M.Api.RID = { chat: 1, tarea: 1, hecha: 1 };
  M.Api.prototype.llamar = function (accion, datos, opc) {
    opc = opc || {}; datos = Object.assign({}, datos || {}); var self = this;
    if (M.Api.RID[accion] && !datos.rid) datos.rid = M.ridNuevo();
    return new Promise(function (ok, mal) {
      self.cola.push({ accion: accion, datos: datos, ms: opc.ms || self.tope, fila: opc.fila || (opc.fondo ? 'f' : 'u'), plazo: opc.plazo, releer: opc.releer, alReintentar: opc.alReintentar, ok: ok, mal: mal });
      self.siguiente();
    });
  };
  M.Api.prototype.siguiente = function () {
    var self = this;
    ['u', 'e', 'f'].forEach(function (fila) {
      var x = self.cola.filter(function (y) { return y.fila === fila; })[0];
      if (x && !self.vuelo[fila] && (fila === 'u' || !self.vuelo.u)) self.lanzar(x);
    });
  };
  M.Api.prototype.lanzar = function (x) {
    var self = this;
    this.cola.splice(this.cola.indexOf(x), 1); this.vuelo[x.fila]++;
    var releer = M.Api.RELEER[x.accion] && !(x.accion === 'configIA' && 'clave' in x.datos);
    function fin() { self.vuelo[x.fila]--; self.siguiente(); }
    var t0 = Date.now(), plazo = x.plazo || self.plazo, extra = 0;
    function intento() { return self.una(x.accion, x.datos, Math.min(x.ms, plazo - (Date.now() - t0))); }
    function otra(e) {
      var queda = plazo - (Date.now() - t0), lectura = releer && e.perdida && extra < (x.releer || 1), escritura = x.datos.rid && (e.perdida || e.tope);
      if (!lectura && !escritura) throw e;
      var pausa = lectura && extra ? self.pausa.larga : self.pausa.corta;
      if (queda - pausa < 4200) throw e;
      extra++; if (x.alReintentar) x.alReintentar(e);
      return new Promise(function (r) { setTimeout(r, pausa); }).then(intento).catch(otra);
    }
    Promise.resolve().then(intento).catch(otra).then(function (o) { fin(); x.ok(o); }, function (e) { fin(); x.mal(e); });
  };
  M.Api.prototype.una = function (accion, datos, ms) {
    var self = this, body = Object.assign({ t: this.clave(), accion: accion }, datos);
    var ctl = typeof AbortController === 'function' ? new AbortController() : null, reloj = ctl ? setTimeout(function () { ctl.abort(); }, ms) : 0;
    function falla(tipo, txt) { var e = new Error(txt); e[tipo] = true; return e; }
    return this.fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        return r.text().then(function (tx) {
          var o = null; try { o = JSON.parse(tx); } catch (e) {}
          if (!r.ok || !o || typeof o !== 'object') throw falla('perdida', 'Respuesta ' + r.status);
          return o;
        });
      }, function (e) { throw e && e.name === 'AbortError' ? falla('tope', 'Sin respuesta a tiempo') : falla('red', 'Sin conexión'); })
      .then(function (o) { clearTimeout(reloj); if (o.sinClave) self.alSinClave(o); return o; },
        function (e) { clearTimeout(reloj); if (e && e.name === 'AbortError') e = falla('tope', 'Sin respuesta a tiempo'); throw e; });
  };
  M.errTxt = function (e) { return e && e.red ? 'Sin conexión.' : 'El CRM no respondió a tiempo. Intenta de nuevo.'; };

  // ------------------------------------------------------------------ escrituras por detras
  /* Cuando la persona confirma, se le dice "listo" al instante y la tarea (o el "hecha") se manda
     por detras con un rid fijo: si Google pierde la respuesta se insiste hasta 8 minutos (la API
     recuerda el rid 10) sin duplicar; pasado eso se avisa "puede que haya quedado guardado". Sin
     senal se espera. La cola vive en el almacen que se inyecte (localStorage): sobrevive a cerrar. */
  M.Cola = function (api, almacen, cb) {
    this.api = api; this.alm = almacen; this.cb = cb || {}; this.enviando = false; this.timer = null;
    this.espera = { red: 30000, insistir: 10000, plazo: 8 * 60000, api: 90000 };
    this.enLinea = function () { return typeof navigator === 'undefined' || navigator.onLine !== false; };
  };
  M.Cola.prototype.lista = function () { return this.alm.get('cola', []); };
  M.Cola.prototype.agregar = function (accion, datos, txt) {
    var c = this.lista(); if (!datos.rid) datos.rid = M.ridNuevo();
    c.push({ a: accion, d: datos, t: Date.now(), txt: txt || datos.titulo || accion }); this.alm.set('cola', c); this.vaciar();
  };
  M.Cola.prototype.luego = function (ms) { var self = this; clearTimeout(this.timer); this.timer = setTimeout(function () { self.vaciar(); }, ms); };
  M.Cola.prototype.vaciar = function () {
    var self = this, c = this.lista(); if (this.enviando || !c.length) return;
    if (!this.enLinea()) { this.luego(this.espera.red); return; }
    var x = c[0]; this.enviando = true;
    function sacar() { var c2 = self.lista(); if (c2.length && c2[0].d && c2[0].d.rid === x.d.rid) c2.shift(); self.alm.set('cola', c2); }
    this.api.llamar(x.a, x.d, { fila: 'e', plazo: this.espera.api }).then(function (o) {
      self.enviando = false; sacar();
      if (o && o.ok) { if (self.cb.alListo) self.cb.alListo(x, o); } else if (self.cb.alFallo) self.cb.alFallo(x, (o && o.error) || 'No se pudo.', false);
      self.vaciar();
    }, function (e) {
      self.enviando = false;
      if (e.red || !self.enLinea()) { self.luego(self.espera.red); return; }
      if (Date.now() - (x.t || 0) < self.espera.plazo) { self.luego(self.espera.insistir); return; }
      sacar(); if (self.cb.alFallo) self.cb.alFallo(x, 'Sin confirmación del CRM: puede que haya quedado guardado, revisa tus pendientes antes de repetirlo.', true); self.vaciar();
    });
  };
  M.Cola.prototype.hechasPendientes = function () { var h = {}; this.lista().forEach(function (x) { if (x.a === 'hecha') h[x.d.id] = 1; }); return h; };

  // Almacen sobre localStorage (con nombre para no chocar con otras cosas de la pagina).
  M.almacen = function (prefijo, ls) {
    ls = ls || (typeof localStorage !== 'undefined' ? localStorage : null);
    return {
      get: function (k, d) { try { var v = ls && ls.getItem(prefijo + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
      set: function (k, v) { try { if (ls) ls.setItem(prefijo + k, JSON.stringify(v)); } catch (e) {} },
      quitar: function (k) { try { if (ls) ls.removeItem(prefijo + k); } catch (e) {} }
    };
  };

  raiz.VozMotor = M;
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
