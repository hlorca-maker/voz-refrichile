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
  var M = { version: '2026-10-01' };

  // ------------------------------------------------------------------ utilidades
  M.norm = function (s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\/:.,]+/g, ' ').replace(/\s+/g, ' ').trim(); };
  // Igual que _vozNorm_ de la API: la busqueda de productos da lo mismo aca que alla.
  M.normP = function (s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\/.,]+/g, ' ').replace(/\s+/g, ' ').trim(); };
  M.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  M.pesos = function (n) { return n == null ? 'sin precio' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('es-CL'); };
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
    var t = ' ' + M.norm(f).replace(/[,;.]+(?= |$)/g, '') + ' ', d = null, hora = '', usado = [];
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
    if (quita(/ (antes de ayer|anteayer|antier) /)) { d = new Date(h0); d.setDate(d.getDate() - 2); }
    else if (quita(/ ayer /)) { d = new Date(h0); d.setDate(d.getDate() - 1); }
    else if ((m = quita(/ (?:el )?(lunes|martes|miercoles|jueves|viernes|sabado|domingo) pasado /))) { d = new Date(h0); d.setDate(d.getDate() - (((d.getDay() - DIAS.indexOf(m[1])) + 7) % 7 || 7)); }
    else if (quita(/ pasado manana /)) { d = new Date(h0); d.setDate(d.getDate() + 2); }
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
    ventas: /\b(mis ventas|cuant[oa]s? (se )?(lleva\w*|llevo|hemos|he|va|van|vamos|voy) (vendid\w*|facturad\w*)|cuanto (vendi|vendimos|vendio|facturamos|facture)\b|cuantas ventas|ventas? (de |del )?(hoy|mes|ano|semana)|como voy\b|como vamos\b|vendido (este|del|en el) (mes|ano)|vendido hoy|facturacion del mes|cuanto (llevo|vamos|voy) (en )?(el )?mes|cuanto (he|hemos) vendido|lo vendido|mi facturacion|ventas? (total(es)?|acumulad\w*)|(total|acumulado) (vendido|de ventas?|facturado)|cuanto (llevamos|vamos|llevo|voy) (acumulad\w*|en el ano|en el mes|de ventas?)|cuanto (he|hemos|se ha) facturado|venta del (mes|ano)|acumulado (del|de este) (mes|ano)|cuanto va la venta)\b/,
    // compras de un cliente, cartera en riesgo y mejores clientes (25-09-2026)
    compras: /\b(cuanto (me |nos |le )?(ha|han|hemos|he) (comprado|vendido)|ultima compra|cuando (me |nos )?compro|que (me |nos )?(ha |han )?comprado|que compro\b|que le (hemos |he )?vendido|compras de|historial de compras|cuanto (me )?compra\b|cuanto (le )?(vendemos|vendo) a)\b/,
    riesgo: /\b(clientes? (en riesgo|sin compras?|que no (me |nos )?(compran?|han comprado)|perdidos?|dormidos?|inactivos?|que dejaron de comprar)|quien(es)? no (me |nos )?(ha |han )?compra\w*|a quien(es)? (tengo que |debo |deberia )?(visitar|llamar|contactar)|que clientes (visito|llamo|debo visitar)|no me han comprado|dejaron de comprar)\b/,
    mejores: /\b(mejores clientes|quien(es)? (me )?(ha |han )?comprado mas|top (de )?clientes|clientes que mas (me )?compran|mayores clientes|clientes mas grandes|quien compra mas)\b/,
    meta: /\b(mi meta|cual es (mi|la) meta|meta del mes|cuanto (me |nos )?falta (para|por) (la meta|vender|cumplir|llegar|facturar)|cuanto (me|nos) falta|como (voy|vamos) con la meta|avance de (la )?meta|(estoy|estamos|vamos a) (cumpliendo|llegando|llegar)|voy a llegar|cumpliendo la meta)\b/,
    // 28-09-2026 (Humberto: "agrega todas, parte por las gestiones"): gestiones, cotizaciones vendidas/perdidas, ano anterior, facturas y notas de credito
    gestion: /\b((registra\w*|anota\w*|agrega\w*|guarda\w*|ingresa\w*|deja\w*|crea\w*|nueva) (una |la |otra |nueva )?gestion|^ gestion (con|de|para) )\b/,
    gestiones: /\b(gestion(es)? (con|de|del|para|a|al|registrad\w*|hech\w*|anterior\w*|ultim\w*|de hoy|de ayer|de esta semana|del mes|de la semana|de este mes|hoy|esta semana|este mes)|(ultima|ultimo) (gestion|contacto|llamado|visita|conversacion|reunion)|(que|cuando|cuantas|cuantos|dime las|dame las|mis|las) gestion\w*|que (hable|hablamos|converse|conversamos|acorde|acordamos|quedamos) con|en que (quede|quedamos|quedo) con|que le dije a|cuando (fue la ultima vez que |fue que )?(hable|contacte|converse|visite|llame|me reuni)\w* (con|a)|a quien(es)? (contacte|llame|visite|he contactado|he llamado|he visitado|contactamos)|(cuantos|que) clientes (contacte|llame|visite|he contactado|contactamos)|historial (de gestiones|de contactos?|de seguimiento)|seguimiento (de|con|del|a)|que paso con|como (voy|vamos|va|quede|quedamos) con)\b/,
    cotvend: /\b(cotizaciones? (vendid\w*|perdid\w*|ganad\w*|cerrad\w*|nulas?|anulad\w*|emitid\w*|del (ano|mes)|de este (ano|mes)|(este|en el) (ano|mes)|historic\w*|anterior\w*|viej\w*|pasad\w*|que (se )?(vendi\w*|perdi\w*|gan\w*|cerr\w*)|que (le |les )?(hice|hicimos|he hecho|hemos hecho))|(cuantas|que) cotizaciones|tasa de (cierre|conversion|exito|efectividad)|efectividad|cuanto (he |hemos |llevo |llevamos |se ha |tengo )?cotiz\w*|historial de cotizaciones|cotizado (este|en el|del) (ano|mes)|(vendidas|perdidas) (este|en el|del) (mes|ano)|cuantas (he |hemos )?(vendido|perdido|ganado|cerrado))\b/,
    comparar: /\b((comparad\w*|comparativ\w*|comparar|compara|versus|vs|respecto|frente|contra) (a |al |el |con el |del |de |con )?(ano|mismo)|ano (pasado|anterior)|(mismo|misma) (periodo|fecha|mes) del ano|como (voy|vamos|estamos|estoy|va|van) (respecto|comparado|versus|frente|contra)|crecimos|crecimiento|crecido|creciendo|caimos|caida de ventas|a esta (fecha|altura) del ano|(mas|menos|mejor|peor) que el ano)\b/,
    docs: /\b(((ultimas?|que|cuantas|las|mis|dame las|dime las) )?(facturas?|notas? de credito|boletas?) (de|del|a|al|para|tiene|hay|hice|emiti|emitimos|se emitieron|hoy|de hoy|de ayer|esta semana|de esta semana|de la semana|le (hice|hicimos|emiti))|notas? de credito|(ultima|que|cuantas) (facturas?|boletas?)|documentos? (de venta|del cliente|de|del|emitidos) |factura (numero |n |nro |no |num )?\d{3,}|que (facture|facturamos|emitimos|hemos facturado|he facturado|se facturo) (hoy|ayer|esta semana)|que le (facture|facturamos|hemos facturado|he facturado))\b/,
    // 30-09-2026 (Humberto): operacion: notas de venta pendientes, productos por despachar
    nv: /\b(notas? de venta|pendientes? de (despacho|entrega|facturar|facturacion)|por (despachar|entregar|facturar)|que (tengo|hay|falta|queda) (por|para) (despachar|entregar|facturar)|despachos? pendientes?|entregas? pendientes?|sin (despachar|entregar|facturar)|(mis|las) (nv|enevés|notas))\b/,
    // 01-10-2026 (Humberto: "chat bot con toda la informacion y razones"): analisis calculado en el telefono (analisis.js)
    analisis: /\b(a que ritmo|ritmo (de venta|actual|diario|necesario|requerido)|proyeccion|(vamos|voy|va) a llegar|(llegamos|alcanzamos|llego|llega|cumplimos|cumple) (a )?la meta|cuanto (hay que|tengo que|tenemos que|debo|debemos) vender por dia|por dia habil|dias habiles|clientes? (que )?(cayeron|bajaron|caen|bajan|vienen cayendo|compran menos|estan comprando menos|vienen bajando)|(mayores|principales) caidas|caida de (clientes|ventas por cliente)|quien(es)? (bajo|bajaron|cayo|cayeron|compra menos|esta comprando menos)|pareto|80 por ciento|80\/20|concentracion de (ventas|la cartera|clientes)|cuantos clientes (hacen|concentran|explican)|clientes? (sin (gestion|gestiones|contacto|contactar)|no gestionados|sin atender|desatendidos)|sin gestionar|(no (hemos|he|han|hay)|nadie ha) (gestionado|contactado|llamado|visitado)|clientes? nuevos?|nuevos clientes|reactivar|compraron el ano pasado|compraban el ano pasado|pipeline|embudo|cotizaciones? abiertas? (por|segun) (antiguedad|tramo|vendedor|edad|dias)|cuanto (hay|tenemos|tengo|llevamos) cotizado|monto cotizado|cotizaciones? (que )?(estan |hay |tengo |tenemos )?(sin seguimiento|vencidas?|con precio vencido|antiguas|viejas)|que (cotizaciones?|cotizacion) (empujar|empujo|priorizar|priorizo|cerrar|cierro|seguir|mover|apurar|atacar)|cotizaciones? (a|para|por|que) (empujar|priorizar|cerrar|seguir|apurar|atacar)|que (debo|deberia|tengo que|hay que|puedo|conviene) (empujar|priorizar|cerrar|apurar|atacar)|que empujo|que cierro|donde esta la plata|oportunidades (abiertas|de cierre)?|tasa de (cierre|conversion|exito)|cuanto cerramos|porcentaje de cierre|efectividad (de|en) (cotizaciones|cierre|ventas)|stock critico|quiebres?( de stock)?|que (nos |me )?falta (en|de) stock|sin stock (y )?cotizado|cotizado sin stock|productos? (sin|con poco|bajo|cortos? de) stock|productos? (mas|que mas) (vendid\w*|se venden|compran|salen|rotan|se repiten)|que (se )?(vende|venden|compran) mas|top (de )?productos|mas vendidos?|actividad (comercial|del equipo|de \w+)|cuantas gestiones (hizo|hicieron|hice|hemos hecho|llevamos|lleva|llevo|van|tiene)|gestiones por (vendedor|dia|tipo|medio)|cobertura (de|de la) cartera|como esta trabajando|que esta haciendo (el equipo|cada uno|\w+)|ranking|como va cada (vendedor|uno)|quien va (atrasado|atras|mejor|peor|mas atrasado|adelante)|vendedor(es)? (atrasad\w*|bajo (la )?meta|sobre (la )?meta)|compara\w* (a los |los )?vendedores|(ventas|avance|meta) por vendedor|como van los vendedores|como va el equipo)\b/,
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
    if (!R.analisis.test(n) && n.split(' ').length <= 7 && /^ (hola|buenos dias|buenas tardes|buenas noches|buenas|que tal|como estas|como esta|gracias|muchas gracias|ok gracias|listo gracias|chao|adios|hasta luego|nos vemos|hola buenos dias|hola buenas|hola que tal)( \w+){0,2} $/.test(n)) return 'saludo';
    if (/\b(que (puedes|sabes|podrias|puedo) (hacer|preguntar\w*|pedir\w*|consultar)|en que (me )?(puedes |podrias )?ayud\w*|necesito ayuda|como funciona\w*|que haces|para que sirves|que cosas (puedes|haces|sabes)|instrucciones|que (me )?ofreces)\b/.test(n)
      || /^ (ayuda|ayudame) $/.test(n)
      || /^ (me )?(puedes|sabes|podrias) (buscar|consultar|ver|revisar|darme|entregar|decir) (los |las )?(datos|informacion|info|precios|stock|cotizaciones|pendientes|clientes|productos)( de (los |las )?(clientes?|productos?))? $/.test(n)) return 'ayuda';
    if (R.record.test(n)) return 'recordatorio';
    if (R.hecha.test(n)) return 'hecha';
    if (R.pend.test(n)) return 'pend';
    if (R.analisis.test(n)) return 'analisis';
    if (R.meta.test(n)) return 'meta';
    if (R.nv.test(n)) return 'nv';
    if (R.gestion.test(n) || M.esPasado(t)) return 'gestion';
    if (R.cotvend.test(n)) return 'cotvend';
    if (R.comparar.test(n)) return 'comparar';
    if (R.docs.test(n)) return 'docs';
    if (R.riesgo.test(n)) return 'riesgo';
    if (R.gestiones.test(n)) return 'gestiones';
    if (R.mejores.test(n)) return 'mejores';
    if (R.compras.test(n)) return 'compras';
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
  // Numeros dictados dentro de un codigo: "cuatro diez a" = 410a, "cinco cero siete" = 507, "cuatrocientos cuatro" = 404,
  // "treinta y dos" = 32. Solo se juntan cuando forman un codigo de refrigerante conocido o vienen tras "erre/refrigerante/gas".
  var CENT = { cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600 };
  var DEC = { diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintidos: 22, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
  var UNI = { cero: 0, uno: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
  M.REFRIG = /^(22|32|134a?|290|404a?|407[cf]?|410a?|417a?|422[ad]?|448a?|449a?|452a?|454[bc]?|507|513a?|600a?|1234yf|744)$/;
  M.numHablado = function (s) {
    var ws = s.split(' '), out = [], i = 0;
    while (i < ws.length) {
      var w = ws[i], n = null, j = i;
      if (CENT[w] != null) { n = CENT[w]; j++; if (DEC[ws[j]] != null) { n += DEC[ws[j]]; j++; if (ws[j] === 'y' && UNI[ws[j + 1]] != null) { n += UNI[ws[j + 1]]; j += 2; } } else if (UNI[ws[j]] != null) { n += UNI[ws[j]]; j++; } }
      else if (DEC[w] != null) { n = DEC[w]; j++; if (ws[j] === 'y' && UNI[ws[j + 1]] != null) { n += UNI[ws[j + 1]]; j += 2; } }
      if (n != null) { out.push(String(n)); i = j; continue; }
      // digitos sueltos seguidos ("cinco cero siete", "cuatro diez") solo si forman un refrigerante
      if (UNI[w] != null) {
        var k = i, d = '';
        while (k < ws.length && (UNI[ws[k]] != null || (DEC[ws[k]] != null && DEC[ws[k]] < 100))) { d += String(UNI[ws[k]] != null ? UNI[ws[k]] : DEC[ws[k]]); k++; if (d.length >= 3) break; }
        var letra = ws[k] === 'a' || ws[k] === 'c' ? ws[k] : '';
        if (d.length >= 2 && M.REFRIG.test(d + letra)) { out.push(d); i = k; continue; }
      }
      out.push(w); i++;
    }
    return out.join(' ');
  };
  // "precio del R507 en lista distribuidor B", "en la lista mesón", "lista agentes": la lista pedida, si se dijo
  M.listaDe = function (t) {
    var n = ' ' + M.norm(t) + ' ';
    if (/ (lista )?(agentes? plus|agente mas|plus) /.test(n)) return 'LAP';
    if (/ (lista (de )?)?agentes? /.test(n)) return 'LAA';
    if (/ (lista |distribuidor(es)? )(a|uno|1) |distribuidor(es)? lista a |lista distribuidor(es)? a /.test(n)) return 'L2A';
    if (/ (lista |distribuidor(es)? )(b|dos|2) |lista distribuidor(es)? b /.test(n)) return 'L2B';
    if (/ (lista |distribuidor(es)? )(c|tres|3) |lista distribuidor(es)? c /.test(n)) return 'L2C';
    if (/ (lista )?(meson|mesón|publico|de meson) /.test(n)) return 'L2M';
    if (/ cosmoplas /.test(n)) return 'LC2';
    return '';
  };
  M.productoDe = function (t, cli) {
    var s = ' ' + M.numHablado(M.norm(t)) + ' ';
    s = s.replace(/ (en |de |para |con |a |al )?(la |el )?(lista( de precios?)?|precio) (de |del )?(distribuidor(es)? )?(a|b|c|uno|dos|tres|1|2|3|meson|mesón|publico|agentes?( plus)?|plus|cosmoplas)(?= )/g, ' ')
      .replace(/ (en |de |para |a )?(la )?lista (de precios? )?(distribuidor(es)? )?(?= )/g, ' ').replace(/ distribuidor(es)? (a|b|c)(?= )/g, ' ');
    s = s.replace(/ (dame|dime|me das|me dices|quiero|necesito|consulta(r)?|cual es|el|la|los|las)( | el | la )/g, ' ');
    s = s.replace(/ (precio|precios|cuanto (le |les )?(cuesta|sale|vale|esta|cobra\w*)|a como (esta|sale)|a cuanto|valor (de|del)|stock|hay stock|hay disponible|disponibilidad|cuant[oa]s? (hay|quedan|tenemos)|tenemos|tienen|tengo) /g, ' ');
    if (cli && cli._t) { cli._t.forEach(function (w) { s = s.replace(new RegExp(' ' + w + ' ', 'g'), ' '); }); s = s.replace(/ (para|a|al|del|de) (cliente )?\s*$/, ' '); s = s.replace(/ para (el cliente )?$/, ' '); }
    s = s.replace(/ erre /g, ' r ').replace(/ r ?-? ?(\d{2,3}) ?([a-z])?(?= )/g, function (x, n, l) { return ' r' + n + (l || '') + ' '; });
    s = s.replace(/ (refrigerante|gas|bombona|freon) (\d{2,3}[a-z]?)(?= )/g, ' $1 r$2 ');       // "refrigerante 507" = r507
    s = s.replace(/ (\d{2,4}) ?([ac])?(?= )/g, function (x, n, l) { return M.REFRIG.test(n + (l || '')) ? ' r' + n + (l || '') + ' ' : x; });   // "el 507", "410 a" solos
    s = s.replace(/ (dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta)(?= )/g, function (x, w) { return ' ' + NUM[w]; });
    s = s.replace(/(\d) (coma|punto) (\d)/g, '$1.$3').replace(/(\d) y medi[oa](?= )/g, '$1.5');
    return s.replace(/ (de|del|para|el|la|un|una)(?= )/g, ' ').replace(/ (de|del|para|el|la|un|una)(?= )/g, ' ').replace(/\s+/g, ' ').trim();
  };

  // ------------------------------------------------------------------ cartera de clientes
  var SUF = ' ltda limitada spa sa s.a eirl e.i.r.l sociedad soc cia y e hijos el la los las de del al en con por para un una ';
  // Palabras de la orden que no son parte de un nombre de cliente ("tengo" casi calzaba con "Rengo").
  var STOP_Q = ' tengo tienes tiene tenemos que cuando como donde quien cual hora dia llamar llamarlo llamarla llamarle llamo llame llama hablar visitar visite enviar mandar precio precios stock telefono fono correo direccion cotizacion cotizaciones recuerdame recordatorio tarea nota anota manana hoy pasado semana mes para por con del las los una uno dos tres cuatro cinco seis siete ocho nueve diez cliente empresa datos ficha contacto marca marcar hecha hecho lista mejor sobre '
    + 'ese esa eso esto este esta estos estas aquel aquella puedes podrias quiero necesito quisiera guardar guardame agregar agregame crear creame registrar poner ponme favor recordar recordarme avisame hola gracias buenas buenos dias tardes noches busca buscar buscame dame dime muestrame aviso alarma pendiente pendientes despachar despacho despachos entregar entrega entregas facturar nota notas venta lista producto productos '
    + 'gestion gestiones registra registrar registrame llame hable converse conversamos hablamos visite estuve fui reuni contacte cotice escribi mande envie quedo quedamos quede acordamos acorde ayer anteayer facturas factura facture facturamos notas credito documentos documento boleta vendidas perdidas ganadas cerradas abiertas comparado comparar versus anterior ultima ultimo ultimas ultimos historial seguimiento hice hicimos paso whatsapp mail tasa cierre cuantas cuantos cuanto cotizado cotizamos emitidas ano respecto ';
  function tokensCli(n) { return M.norm(n).replace(/[.,\-]/g, ' ').split(' ').filter(function (w) { return w.length > 2 && SUF.indexOf(' ' + w + ' ') < 0; }); }
  M.tokensCli = tokensCli;
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
    // Palabras de la frase que parecen nombre (largas, no de relleno): si un cliente no las tiene, resta.
    var nom = ws.slice(0, n0).filter(function (w) { return w.length >= 4; });
    this.lista.forEach(function (c) {
      if (!c._t || !c._t.length) return;
      var sc = 0, tot = 0, hit = 0, maxL = 0, unicos = c._t.filter(function (w, i) { return c._t.indexOf(w) === i; });   // "Cancino y Cancino" cuenta una vez
      unicos.forEach(function (w) { var f = idf[w] || 1; tot += f; if (ws.some(function (x) { return parecido(x, w); })) { sc += f; hit++; if (w.length > maxL) maxL = w.length; } });
      if (!hit) return;
      var cob = sc / tot;
      // Una sola palabra corta o que es solo parte del nombre no reconoce a un cliente ("ese" no es ESE SPA).
      if (!laxo && hit === 1 && cob < 1 && (maxL < 5 || cob < .5)) return;
      var faltan = nom.filter(function (x) { return !unicos.some(function (w) { return parecido(x, w); }); }).length;
      if (laxo || sc >= 2.2 || cob >= .6) { c._cob = cob; out.push({ c: c, sc: sc + cob * 3 - faltan * 1.5 }); }
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
  M.Datos = function () { this.t = 0; this.hora = ''; this.dolar = 0; this.listas = {}; this.cols = ['PrecioBase', 'LAP', 'LAA', 'L2A', 'L2B', 'L2C', 'L2M']; this.reglas = { vig: 5, cal: 14 }; this.prod = []; this.cliMap = {}; this.cli = []; this.cot = []; this.tareas = []; this.gest = []; this.vend = {}; this.cod = ''; this.todos = false; this.nv = []; };
  M.Datos.prototype.usar = function (o, t) {
    this.t = t || Date.now(); this.hora = o.hora || ''; this.dolar = o.dolar || 0; this.listas = o.listas || {}; this.cols = o.listaCols || this.cols; this.reglas = o.reglas || this.reglas;
    this.prod = (o.prod || []).map(function (p) {
      var txt = ' ' + M.normP(p[0] + ' ' + p[1]) + ' ';
      return { cod: p[0], desc: p[1], act: !!(p[2] & 1), conPrecio: !!(p[2] & 2), stock: p[3] || 0, bod: p[4] || [], pr: p[5] || 0, _t: txt, _c: txt.replace(/[\s\-\/.]/g, ''), _cod: M.normP(p[0]) };
    });
    var map = {}; this.cli = [];
    (o.cli || []).forEach(function (c) { if (!map[c[0]]) map[c[0]] = { r: c[0], n: c[1], l: c[2], f: c[3], m: c[4], d: c[5], c: c[6], b: !!c[7], v: c[8] || '' }; });
    this.cliMap = map; this.cli = Object.keys(map).map(function (r) { return map[r]; });
    this.cot = o.cot || []; this.cotLineas = o.cotLineas || []; this.tareas = o.tareas || [];
    // Gestiones del ultimo ano (mas nuevas primero). Las recien dichas por voz que aun van en camino (folio prov-) se conservan.
    var prov = (this.gest || []).filter(function (g) { return /^prov-/.test(g.folio || ''); });
    this.gest = prov.concat((o.gest || []).map(function (g) { return { f: g[0], rut: g[1], n: g[2], tipo: g[3], met: g[4], cot: g[5], contacto: g[6], com: g[7], vc: g[8], folio: g[9] }; }));
    this.vend = o.vend || {}; this.cod = o.cod || ''; this.todos = !!o.todos; this.gestProd = !!o.gestProd;
    // Notas de venta abiertas [numero, fecha, rut, cliente, estado (sinfac|parcial|entregar), dias, neto, por facturar, por entregar, [[producto, por entregar, por facturar]]]
    this.nv = o.nv == null ? null : (o.nv || []).map(function (x) { return { n: x[0], f: x[1], rut: x[2], cli: x[3], est: x[4], d: x[5], neto: x[6], porFac: x[7], porEnt: x[8], lineas: (x[9] || []).map(function (l) { return { desc: l[0], porEnt: l[1], porFac: l[2] }; }) }; });
    return this;
  };
  M.Datos.prototype.usarVentas = function (v, t) {
    this.ventas = v || null; this.ventasT = t || Date.now(); this.compras = {}; this.ventasViejas = !!v && !v.cot;   // copia guardada por una version anterior: se vuelve a pedir
    var self = this, hoy = M.hoy0();
    ((v && v.clientes) || []).forEach(function (c) { self.compras[c[0]] = { rut: c[0], vc: c[1], mes: c[2], anio: c[3], ult: c[4], dias: c[4] ? Math.round((hoy.getTime() - M.diasFecha(c[4]).getTime()) / 86400000) : null, prods: c[5] || [], docs: c[6] || 0, ytdP: c[7] || 0,
      docsL: (c[8] || []).map(function (d) { return { folio: d[0], tipo: d[1], f: d[2], monto: d[3] }; }), cots: (c[9] || []).map(function (q) { return { folio: q[0], f: q[1], e: q[2], monto: q[3] }; }) }; });
  };
  M.diasFecha = function (iso) { var p = String(iso).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  // Un cliente puede tener varias cuentas (ruts) con el mismo nombre en el ERP: si la elegida no tiene compras, se mira otra con el mismo nombre.
  M.Datos.prototype.comprasDe = function (rut) {
    var c = (this.compras || {})[rut]; if (c) return c;
    var cl = this.cliMap[rut], self = this; if (!cl) return null;
    // Se comparan las palabras distintivas ("SOC." / "SOCIEDAD", "LTDA" / "LIMITADA" no cuentan).
    var lim = function (s) { return M.tokensCli(s).join(' '); }, n = lim(cl.n);
    var otro = n && Object.keys(this.compras || {}).filter(function (r) { var o = self.cliMap[r]; return o && lim(o.n) === n; })[0];
    return otro ? this.compras[otro] : null;
  };
  // Cartera con compras: en riesgo (sin compras hace >= dias, ordenados por lo que compran en el ano) o mejores (mes/ano).
  M.Datos.prototype.cartera = function (tipo, dias) {
    var self = this, out = Object.keys(this.compras || {}).map(function (r) { var c = self.compras[r]; c.nombre = (self.cliMap[r] || {}).n || r; return c; });
    if (tipo === 'riesgo') return out.filter(function (c) { return c.anio > 0 && c.dias != null && c.dias >= (dias || 60); }).sort(function (a, b) { return b.anio - a.anio; });
    if (tipo === 'mejores_mes') return out.filter(function (c) { return c.mes > 0; }).sort(function (a, b) { return b.mes - a.mes; });
    return out.filter(function (c) { return c.anio > 0; }).sort(function (a, b) { return b.anio - a.anio; });
  };
  M.comprasTxt = function (nombre, c) {
    if (!c || !c.anio) return nombre + ' no tiene compras este año.';
    var ult = c.ult ? (c.dias === 0 ? 'hoy' : c.dias === 1 ? 'ayer' : 'hace ' + c.dias + ' días') : 'sin fecha';
    return nombre + (c.mes ? ' lleva ' + M.plataTxt(c.mes) + ' este mes' + (c.docs ? ' en ' + c.docs + (c.docs === 1 ? ' documento' : ' documentos') : '') + ' y ' : ' no ha comprado este mes; lleva ') + M.plataTxt(c.anio) + ' en el año. Última compra ' + ult + (c.prods.length ? ': ' + c.prods.map(function (p) { return p.toLowerCase(); }).join(', ') : '') + '.';
  };
  M.carteraTxt = function (tipo, lista, dias) {
    if (tipo === 'riesgo') {
      if (!lista.length) return 'No tienes clientes con compras en el año que lleven más de ' + (dias || 60) + ' días sin comprar.';
      return 'Tienes ' + lista.length + (lista.length === 1 ? ' cliente' : ' clientes') + ' sin compras hace más de ' + (dias || 60) + ' días. ' + (lista.length > 1 ? 'Los más importantes: ' : '') + lista.slice(0, 5).map(function (c) { return c.nombre + ' (hace ' + c.dias + ' días, ' + M.plataTxt(c.anio) + ' en el año)'; }).join('; ') + '.';
    }
    var per = tipo === 'mejores_mes' ? 'mes' : 'año';
    if (!lista.length) return 'Todavía no hay compras este ' + per + '.';
    return 'Tus mejores clientes del ' + per + ': ' + lista.slice(0, 5).map(function (c, i) { return (i + 1) + ', ' + c.nombre + ' con ' + M.plataTxt(per === 'mes' ? c.mes : c.anio); }).join('; ') + '.';
  };
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
  M.ventasTxt = function (v, tipo, periodo) {
    if (!v) return 'Todavía no tengo las ventas.';
    var d = new Date(), quedan = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate();
    if (periodo === 'hoy' || periodo === 'semana') {
      var val = periodo === 'hoy' ? v.hoy : v.semana;
      return (v.equipo ? 'El equipo lleva ' : 'Llevas ') + (val ? M.plataTxt(val) : 'cero') + (periodo === 'hoy' ? ' facturado hoy' : ' esta semana') + '. En el mes, ' + M.plataTxt(v.mes) + (v.meta ? ' de una meta de ' + M.plataTxt(v.meta) + ' (' + v.avance + ' por ciento)' : '') + '.';
    }
    var lleva = (v.equipo ? 'El equipo lleva ' : 'Este mes llevas ') + M.plataTxt(v.mes) + (v.docs ? ' en ' + v.docs + (v.docs === 1 ? ' documento' : ' documentos') : '') + (v.equipo ? ' este mes' : '') + '.';
    var meta = v.meta ? ((v.equipo ? 'La meta del equipo es ' : 'Tu meta es ') + M.plataTxt(v.meta) + ': ' + (v.falta > 0 ? (v.equipo ? 'faltan ' : 'te faltan ') + M.plataTxt(v.falta) + ' (' + v.avance + ' por ciento)' : 'ya está cumplida (' + v.avance + ' por ciento)') + (v.falta > 0 && quedan ? ', con ' + quedan + (quedan === 1 ? ' día' : ' días') + ' por delante' : '') + '.') : (v.equipo ? 'No hay meta cargada este mes.' : 'No tienes meta cargada para este mes.');
    var eq = v.equipo && v.vendedores ? ' ' + v.vendedores.map(function (x) { return x.nombre.split(' ')[0] + ' ' + M.plataTxt(x.mes) + (x.meta ? ' (' + (x.avance || 0) + '%)' : ''); }).join(', ') + '.' : '';
    var anio = ' En el año, ' + M.plataTxt(v.anio) + '.';
    if (tipo === 'meta' && M.analisis && v.meta && v.falta > 0) meta += ' ' + M.analisis.ritmoCorto(v);   // ritmo necesario vs actual (01-10)
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
      if (gas && sc > 0 && /refrigerante|bombona|cilindro/.test(it._t) && !/recuperad|bomba|arbol|manguera|manometro|cortador|detector/.test(it._t)) sc += 3;   // solo si el codigo calzo: un R507 que no existe no es un R32   // el gas en si, no la recuperadora ni el arbol "R410A"
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


  // ------------------------------------------------------------------ gestiones, cotizaciones historicas, ano anterior y documentos (28-09-2026)
  /* Humberto: "agrega todas, parte por las gestiones". Las gestiones vienen con la copia (accion "datos": las del ultimo ano,
     solo las propias); las cotizaciones por estado, el ano anterior y los documentos, con la accion "ventas". */
  M.rango = function (periodo) {
    var d = M.hoy0(), h = M.iso(d);
    if (periodo === 'ayer') { d.setDate(d.getDate() - 1); return { desde: M.iso(d), hasta: M.iso(d) }; }
    if (periodo === 'semana') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); else if (periodo === 'mes') d.setDate(1);
    return { desde: M.iso(d), hasta: h };
  };
  M.periodoDe = function (n) { return / (hoy|de hoy) /.test(n) ? 'hoy' : / ayer /.test(n) ? 'ayer' : / (esta |la |de la |de esta )?semana /.test(n) ? 'semana' : / (este |el |del |de este )?mes /.test(n) ? 'mes' : ''; };
  M.periodoTxt = { hoy: 'hoy', ayer: 'ayer', semana: 'esta semana', mes: 'este mes' };
  M.haceTxt = function (isoS) {
    var d = M.diasHasta(isoS); if (d == null) return '';
    if (d === 0) return 'hoy'; if (d === -1) return 'ayer'; if (d < 0 && d >= -60) return 'hace ' + (-d) + ' días';
    var p = String(isoS).split('-'); return 'el ' + (+p[2]) + ' de ' + MESES[+p[1] - 1];
  };
  // Como se dice una gestion: "llamado", "WhatsApp", "visita", "cotización por correo"
  M.gestTxt = function (tipo, met) {
    var t = M.norm(tipo), m = M.norm(met);
    var via = /telef|llam/.test(m) ? 'por teléfono' : /video/.test(m) ? 'por videollamada' : /whats/.test(m) ? 'por WhatsApp' : /mail|correo/.test(m) ? 'por correo' : /refrichile/.test(m) ? 'en Refrichile' : /presencial/.test(m) ? 'en terreno' : '';
    var que = { contacto: '', contactado: '', llamado: 'llamado', whatsapp: 'WhatsApp', correo: 'correo', cotizacion: 'cotización', cotizado: 'cotización', 'seguimiento cotizacion': 'seguimiento de cotización', 'toma de pedido': 'toma de pedido',
      reunion: 'reunión', visita: 'visita', postventa: 'postventa', cobranza: 'cobranza', prospeccion: 'prospección', facturado: 'facturación' }[t];
    if (que == null) que = tipo ? String(tipo).toLowerCase() : '';
    if (que === 'reunión' && via === 'en terreno') return 'visita';
    if (!que) return via === 'por teléfono' ? 'llamado' : via === 'por WhatsApp' ? 'WhatsApp' : via === 'por correo' ? 'correo' : via === 'en terreno' ? 'visita' : via === 'en Refrichile' ? 'atención en Refrichile' : 'contacto';
    if ((que === 'llamado' && via === 'por teléfono') || (que === 'WhatsApp' && via === 'por WhatsApp') || (que === 'correo' && via === 'por correo') || que === 'visita') via = '';
    return que + (via ? ' ' + via : '');
  };
  M.Datos.prototype.gestionesDe = function (rut) {
    var c = this.cliMap[rut], n = c ? M.tokensCli(c.n).join(' ') : '';
    return (this.gest || []).filter(function (g) { return g.rut === rut || (n && !g.rut && M.tokensCli(g.n).join(' ') === n); });
  };
  M.Datos.prototype.gestionesPeriodo = function (periodo) { var r = M.rango(periodo || 'hoy'); return (this.gest || []).filter(function (g) { return g.f >= r.desde && g.f <= r.hasta; }); };
  // Notas de venta pendientes: sub 'despacho' (facturadas, por entregar), 'facturar' (sin facturar o parcial), o todas. rut: solo de ese cliente.
  M.Datos.prototype.notasVenta = function (sub, rut) {
    return (this.nv || []).filter(function (x) { return (!rut || x.rut === rut) && (sub === 'despacho' ? x.porEnt > 0 : sub === 'facturar' ? x.porFac > 0 : true); }).sort(function (a, b) { return b.d - a.d; });
  };
  M.nvTxt = function (sub, lista, nombre, sinDatos) {
    if (sinDatos) return 'No tengo las notas de venta en el teléfono.';
    var que = sub === 'despacho' ? 'por despachar' : sub === 'facturar' ? 'por facturar' : 'pendientes';
    if (!lista.length) return (nombre ? nombre + ' no tiene' : 'No tienes') + ' notas de venta ' + que + '.';
    function una(x) {
      var ls = x.lineas.filter(function (l) { return sub === 'facturar' ? l.porFac > 0 : l.porEnt > 0 || (sub !== 'despacho' && l.porFac > 0); }).slice(0, 3);
      return 'la ' + x.n + (nombre ? '' : ' de ' + x.cli) + ', de hace ' + x.d + (x.d === 1 ? ' día' : ' días') + (ls.length ? ': ' + ls.map(function (l) { var q = sub === 'facturar' ? l.porFac : (l.porEnt || l.porFac); return q + ' ' + l.desc.toLowerCase(); }).join(', ') + (x.lineas.length > 3 ? ' y más' : '') : '');
    }
    return (nombre ? nombre + ' tiene ' : 'Tienes ') + lista.length + (lista.length === 1 ? ' nota de venta ' : ' notas de venta ') + que + ': ' + lista.slice(0, 3).map(una).join('; ') + (lista.length > 3 ? '; y ' + (lista.length - 3) + ' más' : '') + '.';
  };
  M.Datos.prototype.cotHist = function (rut) { var c = this.comprasDe(rut); return c ? c.cots || [] : []; };
  M.Datos.prototype.docsDe = function (rut) { var c = this.comprasDe(rut); return c ? c.docsL || [] : []; };
  M.Datos.prototype.docsPeriodo = function (periodo) {
    var r = M.rango(periodo === 'hoy' || periodo === 'ayer' ? periodo : 'semana'), self = this;
    return ((this.ventas && this.ventas.docsSem) || []).filter(function (d) { return d[2] >= r.desde && d[2] <= r.hasta; })
      .map(function (d) { return { folio: d[0], tipo: d[1], f: d[2], rut: d[3], nombre: (self.cliMap[d[3]] || {}).n || '', monto: d[4] }; });
  };
  M.Datos.prototype.docPorFolio = function (folio) {
    var self = this, out = null; folio = String(folio);
    Object.keys(this.compras || {}).some(function (r) { var d = (self.compras[r].docsL || []).filter(function (x) { return x.folio === folio; })[0]; if (d) out = { folio: d.folio, tipo: d.tipo, f: d.f, monto: d.monto, rut: r, nombre: (self.cliMap[r] || {}).n || '' }; return !!d; });
    return out;
  };
  M.gestionesTxt = function (nombre, lista) {
    if (!lista.length) return 'No tienes gestiones registradas con ' + nombre + ' en el último año.';
    function una(g) { return M.haceTxt(g.f) + ', ' + M.gestTxt(g.tipo, g.met) + (g.cot ? ' por la cotización ' + g.cot : '') + (g.com ? ': ' + g.com.replace(/[.\s]+$/, '') : ''); }
    return 'Con ' + nombre + ' tienes ' + lista.length + (lista.length === 1 ? ' gestión' : ' gestiones') + ' en el último año. La última, ' + una(lista[0]) + '.' + (lista.length > 1 ? ' Antes, ' + una(lista[1]) + '.' : '');
  };
  M.gestPeriodoTxt = function (periodo, lista, equipo) {
    var per = M.periodoTxt[periodo] || 'hoy';
    if (!lista.length) return M.capital(per) + (equipo ? ' el equipo no tiene' : ' no tienes') + ' gestiones registradas.';
    var porCli = {}, orden = []; lista.forEach(function (g) { var k = g.n || g.rut; if (!porCli[k]) { porCli[k] = g; orden.push(k); } });
    return M.capital(per) + (equipo ? ' el equipo lleva ' : ' llevas ') + lista.length + (lista.length === 1 ? ' gestión' : ' gestiones') + ' con ' + orden.length + (orden.length === 1 ? ' cliente' : ' clientes') + ': '
      + orden.slice(0, 4).map(function (k) { return k + ' (' + M.gestTxt(porCli[k].tipo, porCli[k].met) + ')'; }).join('; ') + (orden.length > 4 ? '; y ' + (orden.length - 4) + ' más' : '') + '.';
  };
  function cuantas(k, s, p) { return k + ' ' + (k === 1 ? s : p); }
  M.cotHistTxt = function (v, periodo) {
    if (!v || !v.cot) return 'Todavía no tengo las cotizaciones.';
    if (periodo !== 'anio' && !v.cot.mes) periodo = 'anio';                                   // la app del CRM solo trae el ano
    var c = v.cot[periodo === 'anio' ? 'anio' : 'mes'] || [], tot = (c[0] || 0) + (c[2] || 0) + (c[4] || 0), cerr = (c[2] || 0) + (c[4] || 0), per = periodo === 'anio' ? 'Este año' : 'Este mes';
    if (!tot) return per + ' no hay cotizaciones emitidas.';
    return per + (v.equipo ? ' el equipo emitió ' : ' emitiste ') + cuantas(tot, 'cotización', 'cotizaciones') + ' por ' + M.plataTxt(c[1] + c[3] + c[5]) + ': ' + cuantas(c[2], 'vendida', 'vendidas') + (c[2] ? ' por ' + M.plataTxt(c[3]) : '') + ', '
      + cuantas(c[4], 'perdida', 'perdidas') + (c[4] ? ' por ' + M.plataTxt(c[5]) : '') + ' y ' + cuantas(c[0], 'abierta', 'abiertas') + (c[0] ? ' por ' + M.plataTxt(c[1]) : '') + '.' + (cerr ? ' De las cerradas, se vendió el ' + Math.round(c[2] / cerr * 100) + ' por ciento.' : '');
  };
  var EST_TXT = { P: 'abierta', V: 'vendida', X: 'perdida', N: 'nula', O: 'en otro estado' };
  M.cotHistCliTxt = function (nombre, cots) {
    if (!cots.length) return nombre + ' no tiene cotizaciones este año.';
    var n = { P: 0, V: 0, X: 0, N: 0, O: 0 }, m = { P: 0, V: 0, X: 0, N: 0, O: 0 }; cots.forEach(function (q) { n[q.e] = (n[q.e] || 0) + 1; m[q.e] = (m[q.e] || 0) + q.monto; });
    var partes = []; if (n.V) partes.push(cuantas(n.V, 'vendida', 'vendidas') + ' por ' + M.plataTxt(m.V)); if (n.X) partes.push(cuantas(n.X, 'perdida', 'perdidas') + ' por ' + M.plataTxt(m.X)); if (n.P) partes.push(cuantas(n.P, 'abierta', 'abiertas') + ' por ' + M.plataTxt(m.P)); if (n.N) partes.push(cuantas(n.N, 'nula', 'nulas'));
    var u = cots[0];
    return nombre + ' tiene ' + (cots.length >= 10 ? 'al menos ' : '') + cuantas(cots.length, 'cotización', 'cotizaciones') + ' este año: ' + partes.join(', ') + '. La última, la ' + u.folio + ' de ' + M.haceTxt(u.f) + ', ' + (EST_TXT[u.e] || '') + ' por ' + M.plataTxt(u.monto) + '.';
  };
  M.variaTxt = function (a, p) {
    if (!p) return a ? 'y el año pasado a esta fecha no había ventas' : '';
    var x = Math.round((a - p) / Math.abs(p) * 100);
    return x === 0 ? 'igual que el año pasado' : Math.abs(x) + ' por ciento ' + (x > 0 ? 'más' : 'menos') + ' que el año pasado';
  };
  M.comparaTxt = function (v) {
    if (!v || v.ytdP == null) return 'Todavía no tengo las ventas del año anterior.';
    return 'A esta fecha ' + (v.equipo ? 'el equipo lleva ' : 'llevas ') + M.plataTxt(v.anio) + ' en el año, ' + M.variaTxt(v.anio, v.ytdP) + (v.ytdP ? ', que iba en ' + M.plataTxt(v.ytdP) : '') + '. En el mes, ' + M.plataTxt(v.mes) + ', '
      + M.variaTxt(v.mes, v.mesP) + (v.mesP ? ' al mismo día, que iba en ' + M.plataTxt(v.mesP) : '') + '.' + (v.anioP ? ' El año pasado completo cerró en ' + M.plataTxt(v.anioP) + '.' : '');
  };
  M.comparaCliTxt = function (nombre, c) {
    if (!c || (!c.anio && !c.ytdP)) return nombre + ' no tiene compras este año ni el anterior a esta fecha.';
    if (!c.anio) return nombre + ' no ha comprado este año; el año pasado a esta fecha iba en ' + M.plataTxt(c.ytdP) + '.';
    return nombre + ' lleva ' + M.plataTxt(c.anio) + ' este año, ' + M.variaTxt(c.anio, c.ytdP) + (c.ytdP ? ', que a esta fecha iba en ' + M.plataTxt(c.ytdP) : '') + '.';
  };
  function docTxt(d) { return (d.tipo === 'N' ? 'nota de crédito ' : 'factura ') + d.folio + ' de ' + M.haceTxt(d.f) + (d.nombre ? ' a ' + d.nombre : '') + ' por ' + M.plataTxt(Math.abs(d.monto)); }
  M.docsTxt = function (nombre, docs) {
    if (!docs.length) return nombre + ' no tiene facturas ni notas de crédito desde el año pasado.';
    var nc = docs.filter(function (d) { return d.tipo === 'N'; }).length;
    return 'Los últimos documentos de ' + nombre + ': ' + docs.slice(0, 3).map(docTxt).join('; ') + '.' + (docs.length > 3 ? ' Y ' + (docs.length - 3) + ' más' + (nc ? ', con ' + cuantas(nc, 'nota de crédito', 'notas de crédito') + ' en total' : '') + '.' : '');
  };
  M.docsPeriodoTxt = function (periodo, docs, equipo) {
    var per = M.periodoTxt[periodo === 'hoy' || periodo === 'ayer' ? periodo : 'semana'];
    if (!docs.length) return M.capital(per) + ' no hay documentos emitidos' + (equipo ? '' : ' a tu cartera') + '.';
    var tot = 0; docs.forEach(function (d) { tot += d.monto; });
    return M.capital(per) + (docs.length === 1 ? ' va ' : ' van ') + cuantas(docs.length, 'documento', 'documentos') + ' por ' + M.plataTxt(tot) + ': ' + docs.slice(0, 3).map(docTxt).join('; ') + (docs.length > 3 ? '; y ' + (docs.length - 3) + ' más' : '') + '.';
  };
  M.docFolioTxt = function (d, folio) { return d ? M.capital(docTxt(d)) + '.' : 'No tengo el documento ' + folio + ' entre los últimos de tu cartera.'; };

  /* Lo que se MUESTRA de una consulta de gestiones, cotizaciones, ano anterior o documentos, sin pantalla: titulo, filas
     {n, s, v, vs, rut} y lo que se dice. Cada pantalla (la app, la consulta del CRM) lo pinta con sus propios estilos. */
  // Los mismos valores que el CRM (CAP_TIPOS_, CAP_METODOS_, CAP_ORIGENES_). Origen = quien inicio el contacto.
  M.GEST_TIPOS = ['Prospección', 'Contacto', 'Reunión', 'Cotización', 'Seguimiento cotización', 'Toma de pedido', 'Cobranza', 'Postventa'];
  M.GEST_METODOS = ['Teléfono', 'WhatsApp', 'Email', 'Videollamada', 'Presencial en cliente', 'Presencial en Refrichile'];
  M.GEST_ORIGENES = ['Saliente', 'Entrante'];
  M.gestPideCot = function (b) { return (b.gtipo === 'Cotización' || b.gtipo === 'Seguimiento cotización') && !String(b.cot || '').trim(); };
  M.vista = function (r, datos) {
    if (r.tipo === 'analisis') return M.analisis ? M.analisis.vista(r, datos) : { titulo: 'Análisis', etiqueta: '', nombre: '', filas: [], nota: '', dicho: 'Falta el módulo de análisis en esta versión de la app.' };
    var v = datos.ventas || {}, P = M.pesos, o = { titulo: '', etiqueta: '', nombre: r.cli ? r.cli.n : '', filas: [], nota: '', dicho: '' };
    function pct(a, p) { if (!p) return '—'; var x = Math.round((a - p) / Math.abs(p) * 100); return (x > 0 ? '+' : '') + x + '%'; }
    if (r.tipo === 'gestiones') {
      var gs = r.cli ? datos.gestionesDe(r.cli.r) : datos.gestionesPeriodo(r.periodo);
      o.titulo = 'Gestiones' + (r.cli ? '' : ' de ' + (M.periodoTxt[r.periodo] || 'hoy')) + ' · ' + gs.length;
      o.filas = gs.slice(0, 8).map(function (g) {
        var que = M.capital(M.gestTxt(g.tipo, g.met)) + (g.cot ? ' · cot. ' + g.cot : '');
        return { n: r.cli ? que : (g.n || g.rut), s: (r.cli ? '' : que + ' · ') + (g.com || 'sin comentario'), v: M.capital(M.haceTxt(g.f)), vs: /^prov-/.test(g.folio || '') ? 'enviando' : (g.contacto || (datos.todos ? g.vc : '')), rut: g.rut };
      });
      if (!gs.length) o.nota = 'Sin gestiones registradas.';
      o.dicho = r.cli ? M.gestionesTxt(r.cli.n, gs) : M.gestPeriodoTxt(r.periodo, gs, datos.todos);
    } else if (r.tipo === 'cotvend') {
      if (r.cli) {
        var cs = datos.cotHist(r.cli.r); o.titulo = 'Cotizaciones del año · ' + cs.length;
        o.filas = cs.map(function (q) { return { n: 'N° ' + q.folio, s: M.capital(M.haceTxt(q.f)), v: P(q.monto), vs: EST_TXT[q.e] || '' }; });
        if (!cs.length) o.nota = 'Sin cotizaciones este año.'; o.dicho = M.cotHistCliTxt(r.cli.n, cs);
      } else {
        if (r.periodo !== 'anio' && v.cot && !v.cot.mes) r.periodo = 'anio';
        var c = (v.cot || {})[r.periodo === 'anio' ? 'anio' : 'mes'] || [0, 0, 0, 0, 0, 0, 0, 0], cerr = c[2] + c[4];
        o.titulo = 'Cotizaciones ' + (r.periodo === 'anio' ? 'del año' : 'del mes'); o.etiqueta = v.equipo ? 'Equipo' : '';
        o.filas = [{ n: 'Vendidas', s: c[2] + ' cotizaciones', v: P(c[3]) }, { n: 'Perdidas', s: c[4] + ' cotizaciones', v: P(c[5]) }, { n: 'Abiertas', s: c[0] + ' cotizaciones', v: P(c[1]) },
          { n: 'Tasa de cierre', s: 'vendidas sobre cerradas', v: cerr ? Math.round(c[2] / cerr * 100) + '%' : '—' }];
        if (c[6]) o.nota = cuantas(c[6], 'nula', 'nulas') + ' por ' + P(c[7]) + '.'; o.dicho = M.cotHistTxt(datos.ventas, r.periodo);
      }
    } else if (r.tipo === 'comparar') {
      if (r.cli) {
        var cc = datos.comprasDe(r.cli.r) || { anio: 0, ytdP: 0 }; o.titulo = 'Contra el año pasado';
        o.filas = [{ n: 'Este año', s: 'a la fecha', v: P(cc.anio) }, { n: 'Año pasado', s: 'a la misma fecha', v: P(cc.ytdP), vs: pct(cc.anio, cc.ytdP) }]; o.dicho = M.comparaCliTxt(r.cli.n, cc);
      } else {
        o.titulo = 'Contra el año pasado'; o.etiqueta = v.equipo ? 'Equipo' : '';
        o.filas = [{ n: 'Año a la fecha', s: 'este año', v: P(v.anio) }, { n: 'Año pasado', s: 'a la misma fecha', v: P(v.ytdP), vs: pct(v.anio, v.ytdP) }, { n: 'Mes al día', s: 'este año', v: P(v.mes) },
          { n: 'Mismo mes, año pasado', s: 'al mismo día', v: P(v.mesP), vs: pct(v.mes, v.mesP) }, { n: 'Año pasado completo', s: '', v: P(v.anioP) }];
        if (v.equipo && v.vendedores) v.vendedores.forEach(function (x) { o.filas.push({ n: x.nombre, s: 'año a la fecha contra el anterior', v: P(x.anio), vs: pct(x.anio, x.ytdP) }); });
        o.dicho = M.comparaTxt(datos.ventas);
      }
    } else if (r.tipo === 'nv') {
      var nvs = r.resultado || [], que = r.sub === 'despacho' ? 'por despachar' : r.sub === 'facturar' ? 'por facturar' : 'pendientes';
      o.titulo = 'Notas de venta ' + que + ' · ' + nvs.length;
      o.filas = nvs.slice(0, 8).map(function (x) { return { n: 'NV ' + x.n + (r.cli ? '' : ' · ' + x.cli), s: x.lineas.slice(0, 3).map(function (l) { return (r.sub === 'facturar' ? l.porFac : (l.porEnt || l.porFac)) + ' ' + l.desc; }).join(' · ') + (x.lineas.length > 3 ? ' · …' : ''), v: P(x.neto), vs: 'hace ' + x.d + ' d', rut: x.rut }; });
      if (!nvs.length) o.nota = datos.nv ? 'Nada pendiente.' : 'No tengo las notas de venta en el teléfono.';
      o.dicho = M.nvTxt(r.sub, nvs, r.cli ? r.cli.n : '', !datos.nv);
    } else if (r.tipo === 'docs') {
      var ds = r.cli ? datos.docsDe(r.cli.r) : r.folio ? [datos.docPorFolio(r.folio)].filter(Boolean) : datos.docsPeriodo(r.periodo);
      o.titulo = (r.cli || r.folio ? 'Documentos' : 'Documentos de ' + M.periodoTxt[r.periodo === 'hoy' || r.periodo === 'ayer' ? r.periodo : 'semana']) + ' · ' + ds.length;
      o.filas = ds.slice(0, 10).map(function (d) { return { n: (d.tipo === 'N' ? 'Nota de crédito ' : 'Factura ') + d.folio, s: (d.nombre ? d.nombre + ' · ' : '') + M.capital(M.haceTxt(d.f)), v: P(d.monto), vs: 'neto', rut: d.rut }; });
      if (!ds.length) o.nota = 'Sin documentos.';
      o.dicho = r.cli ? M.docsTxt(r.cli.n, ds) : r.folio ? M.docFolioTxt(ds[0], r.folio) : M.docsPeriodoTxt(r.periodo, ds, datos.todos);
    }
    return o;
  };

  // ------------------------------------------------------------------ registrar una gestion
  // "llamé a X", "visité a X": contar algo que ya se hizo con un cliente. Chrome escribe la tilde; sin tilde "llame a X" es llamar ahora.
  // "me llamó X", "vino X": el contacto lo inició el cliente (origen Entrante)
  var ENTRA = /^\s*(ayer|anteayer|hoy|reci[eé]n)?[,\s]*(me|nos) (llam[oó]|llamaron|escribi[oó]|escribieron|contact[oó]|contactaron|visit[oó]|visitaron|pidi[oó]|pidieron|consult[oó]|consultaron|mand[oó]|envi[oó])(?![a-záéíóúñ])/i;
  M.esEntrante = function (t) { return ENTRA.test(String(t || '')) || /^\s*(ayer |hoy )?(vino|vinieron)(?![a-z])/i.test(String(t || '')); };
  M.esPasado = function (t) {
    if (M.esEntrante(t)) return true;
    return /^\s*(ayer|anteayer|hoy|reci[eé]n|bueno|listo)?[,\s]*(le|la|lo|les|me)?\s*(llam[eé]|habl[eé]|convers[eé]|contact[eé]|visit[eé]|reun[ií]|escrib[ií]|mand[eé]|envi[eé]|cotic[eé]|pas[eé]|atend[ií]|estuve|fui)(?![a-záéíóúñ])/i.test(String(t || ''))
      && (/[éí]/.test(String(t).split(/\s+/).slice(0, 4).join(' ')) || /^\s*(ayer |hoy )?(estuve|fui) (con|en|donde|a)\b/i.test(String(t)));
  };
  function sinAcentoRx(w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[aeiou]/g, function (c) { return { a: '[aá]', e: '[eé]', i: '[ií]', o: '[oó]', u: '[uúü]' }[c]; }).replace(/n/g, '[nñ]'); }
  // Saca de la frase el nombre del cliente tal como se dijo (con sus "sociedad", "y", "limitada") y la preposicion que lo trae.
  function quitarCliente(s, cli) {
    var toks = cli._t || M.tokensCli(cli.n), todas = M.norm(cli.n).replace(/[.,\-]/g, ' ').split(' ').filter(Boolean), ws = s.trim().split(/\s+/);
    var info = ws.map(function (w) { var k = M.norm(w).replace(/[.,;:]/g, ''); var tk = !!k && toks.some(function (t) { return parecido(k, t); }); return { nom: tk || (!!k && todas.indexOf(k) >= 0), tk: tk }; });
    var mejor = null, i = 0;
    while (i < ws.length) {
      if (!info[i].nom) { i++; continue; }
      var j = i, n = 0; while (j < ws.length && info[j].nom) { if (info[j].tk) n++; j++; if (/[,.;:]$/.test(ws[j - 1])) break; }
      if (n && (!mejor || n > mejor.n)) mejor = { a: i, b: j, n: n };
      i = j;
    }
    if (!mejor) return s;
    var a = mejor.a;
    if (a >= 2 && /^(la|el|los)$/i.test(ws[a - 2]) && /^(empresa|cliente|gente)$/i.test(ws[a - 1])) a -= 2; else if (a >= 1 && /^(cliente|empresa)$/i.test(ws[a - 1])) a -= 1;
    if (a >= 1 && /^(a|al|con|de|del|donde|para|en)$/i.test(ws[a - 1])) a -= 1;
    var cola = /[,.;:]$/.test(ws[mejor.b - 1]) ? ws[mejor.b - 1].slice(-1) : '';
    return ' ' + ws.slice(0, a).join(' ') + cola + ' ' + ws.slice(mejor.b).join(' ') + ' ';
  }
  // El comentario: lo dicho sin la orden, el cliente, el verbo ni la fecha ("llamé a Clima Norte, quedó en enviar la OC" -> "Quedó en enviar la OC")
  M.comentarioGestion = function (texto, f, cli) {
    var s = ' ' + String(texto || '').replace(/\s+/g, ' ').trim() + ' ';
    s = s.replace(/^\s*(registra\w*|anota\w*|agrega\w*|guarda\w*|ingresa\w*|deja\w*|crea\w*)?\s*(una |la |otra |nueva )*gesti[oó]n\s*(con|de|para|a|al|del)?\s+(el cliente |la empresa |cliente )?/i, ' ');
    (f.usado || []).forEach(function (u) { s = s.replace(new RegExp(' ' + u.split(' ').map(sinAcentoRx).join(' ') + '(?=[ ,.;:])', 'i'), ' '); });
    if (cli) s = quitarCliente(s, cli);
    s = s.replace(/^[\s,.;:]*(me |nos )(llam[oó]|llamaron|escribi[oó]|escribieron|contact[oó]|contactaron|visit[oó]|visitaron|pidi[oó]|pidieron|consult[oó]|consultaron|mand[oó]|envi[oó])(?![a-záéíóúñ])\s*/i, ' ').replace(/^[\s,.;:]*(vino|vinieron)(?![a-z])\s*(a la oficina|a refrichile|al local)?/i, ' ');
    s = s.replace(/^[\s,.;:]*(ya )?(le |la |lo |les |me )?(llam[eé]|habl[eé]|convers[eé]|contact[eé]|visit[eé]|me reun[ií]|reun[ií]|escrib[ií]|mand[eé]|envi[eé]|cotic[eé]|pas[eé]|atend[ií]|estuve|fui)(?![a-záéíóúñ])\s*(a |al |con |donde |por donde |en |de )?(?![a-záéíóúñ])/i, ' ');
    s = s.replace(/^[\s,.;:]*(por |v[ií]a |en )(tel[eé]fono|whatsapp|wsp|correo|mail|email)\b/i, ' ');
    s = s.replace(/^[\s,.;:]*(y|que|pero|donde)\s+/i, ' ').replace(/^[\s,.;:]+/, '').replace(/[\s,;:]+$/, '');
    s = s.replace(/\s+/g, ' ').trim();
    return s.length >= 3 ? M.capital(s).slice(0, 300) : '';
  };
  M.gestionDe = function (texto, clis) {
    var raw = String(texto || ''), n = ' ' + M.norm(raw) + ' ', f = M.leerFecha(raw), cot = M.cotizacionDe(raw), cli = (clis || [])[0] || null;
    var metodo = /\b(whatsapp|wasap|wsp|guasap|por mensaje)\b/.test(n) ? 'WhatsApp'
      : /\b(correo|mail|email)\b/.test(n) ? 'Email'
      : /\b(videollamada|video llamada|meet|zoom|teams)\b/.test(n) ? 'Videollamada'
      : /\b(vino|vinieron|paso por (la oficina|refrichile|el local|el meson)|en (la oficina|refrichile|el meson)|retiro en)\b/.test(n) ? 'Presencial en Refrichile'
      : /\b(visit\w*|estuve|fui|reuni\w*|presencial|en terreno|pase (a|por|donde))\b/.test(n) ? 'Presencial en cliente'
      : /\b(llam\w*|telefon\w*)\b/.test(n) ? 'Teléfono' : '';
    var gtipo = /\b(reclamo|garantia|postventa|post venta|falla|devolucion)\b/.test(n) ? 'Postventa'
      : /\b(cobranza|cobre|le cobre|pago pendiente|factura vencida|facturas vencidas|deuda)\b/.test(n) ? 'Cobranza'
      : /\b(tom[eo] (el |un |su )?pedido|(me |nos )?hizo (el |un |su )?pedido|(me |nos )?(mando|envio|paso) la (orden|oc)\b|llego la (orden|oc)\b|cerramos|cerre (la venta|el negocio)|confirmo (el |la |su )?(pedido|compra|orden))\b/.test(n) ? 'Toma de pedido'
      : /\b(cotice|cotizamos|le cotiz\w*|(mande|envie|pase|hice) (la |una |su )?cotizacion)\b/.test(n) ? 'Cotización'
      : (cot || /\b(seguimiento|(por|sobre|de) la cotizacion)\b/.test(n)) ? 'Seguimiento cotización'
      : /\b(prospect\w*|cliente nuevo|nuevo cliente|posible cliente)\b/.test(n) ? 'Prospección'
      : /\b(visit\w*|estuve|fui|reuni\w*|presencial|terreno)\b/.test(n) ? 'Reunión' : 'Contacto';
    // Una fecha futura no es de una gestion hecha (seria lo que quedo de hacerse): se deja hoy.
    var fecha = f.iso && M.diasHasta(f.iso) <= 0 ? f.iso : M.iso(M.hoy0());
    return { tipo: 'gestion', gtipo: gtipo, metodo: metodo, comentario: M.comentarioGestion(raw, f.iso && M.diasHasta(f.iso) <= 0 ? f : { usado: [] }, cli), detalle: raw, fecha: fecha, hora: '', titulo: '', clis: clis || [], cli: cli ? cli.r : '', cot: cot, origen: M.esEntrante(raw) ? 'Entrante' : 'Saliente' };
  };
  // Con una gestion por confirmar, contar OTRA ("llamé a Frío Sur y...") no es una correccion: es una orden nueva.
  M.esOtraGestion = function (b, texto, cartera) {
    if (M.intencion(texto) !== 'gestion') return false;
    var c = cartera ? cartera.buscar(texto)[0] : null;
    return !!c && (c.r !== b.cli || String(texto).trim().split(/\s+/).length >= 5);
  };
  // Correcciones dichas sobre una gestion por confirmar: "fue por WhatsApp", "es una visita", "fue ayer", "agrega que...", "sin comentario"
  M.corregirGestion = function (b, texto, cartera) {
    var n = ' ' + M.norm(texto) + ' ', cambios = [], f = M.leerFecha(texto), m;
    if (f.iso && M.diasHasta(f.iso) <= 0 && f.iso !== b.fecha) { b.fecha = f.iso; cambios.push('fecha'); }
    if ((m = n.match(/ (?:fue|era|es|por|via|como|mejor|ponlo como|ponla como|cambia\w*(?: a)?) (?:una? |por |como |el |la )?(llamad[oa]|telefono|whatsapp|wasap|wsp|correo|mail|email|videollamada|visita|reunion|presencial|en terreno|cotizacion|seguimiento|pedido|toma de pedido|postventa|cobranza|prospeccion|contacto) /))) {
      var k = m[1], antes = b.gtipo + '|' + b.metodo;
      if (/llamad|telefono/.test(k)) b.metodo = 'Teléfono'; else if (/whats|wasap|wsp/.test(k)) b.metodo = 'WhatsApp'; else if (/correo|mail/.test(k)) b.metodo = 'Email'; else if (k === 'videollamada') b.metodo = 'Videollamada';
      else if (/visita|presencial|terreno/.test(k)) { b.gtipo = 'Reunión'; b.metodo = 'Presencial en cliente'; } else if (k === 'reunion') b.gtipo = 'Reunión';
      else if (k === 'cotizacion') b.gtipo = 'Cotización'; else if (k === 'seguimiento') b.gtipo = 'Seguimiento cotización'; else if (/pedido/.test(k)) b.gtipo = 'Toma de pedido';
      else if (k === 'postventa') b.gtipo = 'Postventa'; else if (k === 'cobranza') b.gtipo = 'Cobranza'; else if (k === 'prospeccion') b.gtipo = 'Prospección'; else if (k === 'contacto') b.gtipo = 'Contacto';
      if (antes !== b.gtipo + '|' + b.metodo) cambios.push('tipo');
    }
    if (/ (entrante|me llamo|me llamaron|me escribio|me escribieron|me contacto|llamo el|escribio el|fue el cliente|el cliente (me )?(llamo|escribio|contacto)) /.test(n)) { if (b.origen !== 'Entrante') { b.origen = 'Entrante'; cambios.push('origen'); } }
    else if (/ (saliente|lo llame yo|la llame yo|llame yo|le escribi yo|fui yo|yo (lo |la |los )?(llame|contacte)) /.test(n)) { if (b.origen !== 'Saliente') { b.origen = 'Saliente'; cambios.push('origen'); } }
    if (/ (sin comentario|sin detalle|sin nada|borra el comentario) /.test(n)) { if (b.comentario) { b.comentario = ''; cambios.push('comentario'); } }
    else if ((m = texto.match(/\b(?:que diga|el comentario es|mejor que diga|comentario:?)\s+(.+)$/i))) { b.comentario = M.capital(m[1]); cambios.push('comentario'); }
    else if ((m = texto.match(/\b(?:agr[eé]ga(?:le)?|a[nñ][aá]de(?:le)?|an[oó]ta(?:le)?|p[oó]n(?:le)?|suma(?:le)?)\s+(?:tambi[eé]n\s+)?(?:que\s+)?(.+)$/i))) { b.comentario = (b.comentario ? b.comentario.replace(/[.\s]+$/, '') + '. ' : '') + M.capital(m[1]); cambios.push('comentario'); }
    if (/ (el cliente|cliente es|es con|fue con|es para|es de|a nombre de) /.test(n) && cartera) { var c = cartera.buscar(texto)[0]; if (c && c.r !== b.cli) { b.cli = c.r; cambios.push('cliente'); } }
    var mc = M.cotizacionDe(texto); if (mc && mc !== b.cot) { b.cot = mc; cambios.push('cotización'); }
    return cambios;
  };
  // Lo que se confirma de viva voz antes de registrar. quien: nombre del vendedor cuando la registra la jefatura a su nombre.
  M.fraseGestion = function (b, cartera, quien) {
    var c = cartera && cartera.porRut[b.cli];
    return 'Gestión con ' + (c ? c.n : 'el cliente') + ': ' + M.gestTxt(b.gtipo, b.metodo) + (b.origen === 'Entrante' ? ', iniciado por el cliente' : '') + (b.cot ? ', cotización ' + b.cot : '') + (b.fecha !== M.iso(M.hoy0()) ? ', ' + M.haceTxt(b.fecha) : '')
      + (b.comentario ? '. Comentario: ' + b.comentario.replace(/[.\s]+$/, '') : ', sin comentario') + (quien ? '. Queda a nombre de ' + quien : '') + '. ¿La registro?';
  };
  M.datosGestion = function (b, cartera) {
    var c = cartera && cartera.porRut[b.cli];
    return { rid: M.ridNuevo(), rut: b.cli, cliente: c ? c.n : '', tipo: b.gtipo, metodo: b.metodo, origen: b.origen === 'Entrante' ? 'Entrante' : 'Saliente', comentario: b.comentario || '', fecha: b.fecha, cot: b.cot || '', texto: b.detalle };
  };
  // La gestion que corresponde a un pendiente recien cerrado ("Llamar a X por la cotización 41022" -> seguimiento por teléfono)
  M.gestionDeTarea = function (t, dicho, cli) {
    var b = M.gestionDe(t.titulo + ' ' + (t.cliente || ''), cli ? [cli] : []), n = ' ' + M.norm(t.titulo) + ' ';
    if (!b.metodo) b.metodo = / llamar /.test(n) ? 'Teléfono' : / visitar /.test(n) ? 'Presencial en cliente' : / (escribir|enviar|mandar) /.test(n) ? 'Email' : '';
    if (/ visitar /.test(n)) b.gtipo = 'Reunión';
    var f0 = M.leerFecha(dicho || ''), com = M.comentarioGestion(String(dicho || '').replace(/^\s*ya\s+/i, ''), { usado: f0.iso && M.diasHasta(f0.iso) <= 0 ? f0.usado : [] }, cli);
    b.comentario = com || t.titulo; b.detalle = dicho || t.titulo; b.fecha = M.iso(M.hoy0()); b.cli = cli ? cli.r : ''; b.clis = cli ? [cli] : [];
    return b;
  };

  // ------------------------------------------------------------------ interpretar una frase
  /* Devuelve que hacer, sin hacerlo:
       { tipo:'pend' } | { tipo:'precio'|'stock', q, cli, resultado, consulta }  (resultado null = no esta en la copia)
       { tipo:'ficha', para:'contacto'|'cotiz'|'llamar', cli, resultado } | { tipo:'elegir', clis, para }
       { tipo:'hecha', cli } | { tipo:'borrador', borrador } | { tipo:'ia', motivo }  */
  // Que analisis se pide (analisis.js): el sub y sus parametros (vendedor, periodo, dias, cuantos).
  M.analisisDe = function (n, datos) {
    var sub = /\b(pareto|80 por ciento|80\/20|concentracion|cuantos clientes (hacen|concentran|explican))\b/.test(n) ? 'pareto'
      : /\b(ca(yeron|en|ida|idas|yo)|bajaron|bajan|bajo|vienen (cayendo|bajando)|compra(n)? menos|comprando menos)\b/.test(n) ? 'caida'
      : /\b(reactivar|compra(ron|ban) el ano pasado)\b/.test(n) ? 'reactivar'
      : /\b(nuevos?|nuevas)\b/.test(n) && /\bclientes?\b/.test(n) ? 'nuevos'
      : /\b(sin (gestion|gestiones|contacto|contactar|atender|gestionar)|no gestionados|desatendidos|(no (hemos|he|han|hay)|nadie ha) (gestionado|contactado|llamado|visitado))\b/.test(n) ? 'singestion'
      : /\b(empuj\w*|prioriz\w*|cerrar|cierro|apurar|atacar|mover|donde esta la plata|oportunidades)\b/.test(n) && !/\btasa\b/.test(n) ? 'empujar'
      : /\b(tasa|cuanto cerramos|cuantas cotizaciones|porcentaje de cierre|efectividad)\b/.test(n) ? 'tasa'
      : /\b(stock|quiebres?)\b/.test(n) ? 'stock'
      : /\b(pipeline|embudo|cotizado|cotizaciones?)\b/.test(n) ? 'pipeline'
      : /\b(productos?|vendidos?|se vende|venden mas|rotan)\b/.test(n) ? 'productos'
      : /\b(ranking|cada (vendedor|uno)|quien va|vendedor(es)?|equipo)\b/.test(n) && !/\b(actividad|gestiones)\b/.test(n) ? 'ranking'
      : /\b(actividad|gestiones|cobertura|trabajando|haciendo)\b/.test(n) ? 'actividad'
      : 'ritmo';
    if (sub === 'ranking' && datos && !datos.todos) sub = 'ritmo';                  // un vendedor no ve al equipo: su propio ritmo
    var r = { sub: sub, periodo: / (mes|mensual|este mes|del mes) /.test(n) ? 'mes' : / (ano|anual|este ano|del ano) /.test(n) ? 'anio' : (sub === 'actividad' ? 'semana' : ''), vendedor: '' };
    var md = n.match(/ (\d{2,3}) dias /); if (md) r.dias = +md[1];
    var mn = n.match(/ (top |los |las |primer[oa]s )?(\d{1,2}) (clientes|cotizaciones|productos|mayores|mejores|primer[oa]s) /); if (mn) r.n = +mn[2];
    if (datos && datos.todos) Object.keys(datos.vend || {}).forEach(function (c) { var nom = M.norm(datos.vend[c]).split(' ')[0]; if (nom && new RegExp(' ' + nom + '(?![a-z])').test(n)) r.vendedor = c; });
    return r;
  };
  M.interpretar = function (texto, ctx) {
    var tipo0 = M.intencion(texto);                                  // saludo y "que puedes hacer" se miran antes de limpiar
    if (tipo0 === 'saludo' || tipo0 === 'ayuda') return { tipo: tipo0 };
    texto = M.limpiarOrden(texto);
    var datos = ctx.datos, cartera = ctx.cartera, tipo = M.intencion(texto), n = ' ' + M.norm(texto) + ' ';
    if (tipo === 'saludo' || tipo === 'ayuda') return { tipo: tipo };
    var clis = cartera.buscar(texto), cli = clis[0] || null;
    var claro = !!cli && ((cli._cob || 0) >= .6 || clis.length === 1), nombrado = / (para|del cliente|de la empresa|a nombre de|donde) /.test(n);
    if (tipo === 'pend') return { tipo: 'pend' };
    if (tipo === 'analisis') { var ra = M.analisisDe(n, datos); ra.tipo = 'analisis'; ra.resultado = datos.ventas ? true : null; return ra; }
    if (tipo === 'riesgo' && M.analisis) { var rr = M.analisisDe(n, datos); rr.sub = 'riesgo'; rr.tipo = 'analisis'; rr.resultado = datos.ventas ? true : null; return rr; }   // con razones (01-10)
    if (tipo === 'ventas' || tipo === 'meta') return { tipo: tipo, resultado: datos.ventas || null, periodo: / hoy /.test(n) ? 'hoy' : / (esta |la )?semana /.test(n) ? 'semana' : '' };
    if (tipo === 'nv') {
      var subNv = / (despach\w*|entreg\w*) /.test(n) ? 'despacho' : / factur\w* /.test(n) ? 'facturar' : '';
      var cliNv = cli && claro && (nombrado || / (de|del) /.test(n)) ? cli : null;                   // "notas de venta de X"; sin cliente dicho, todas
      if (cli && !claro && nombrado) return { tipo: 'elegir', clis: clis, para: 'nv' };
      return { tipo: 'nv', sub: subNv, cli: cliNv, resultado: datos.nv ? datos.notasVenta(subNv, cliNv ? cliNv.r : '') : null };
    }
    if (tipo === 'gestion' || tipo === 'visita') {
      if (!cli) { clis = cartera.buscar(texto, true); cli = clis[0] || null; claro = !!cli && clis.length === 1; }
      var bg = M.gestionDe(texto, clis); if (cli && !claro) bg.cli = '';
      return { tipo: 'borrador', borrador: bg };
    }
    if (tipo === 'gestiones' || tipo === 'cotvend' || tipo === 'docs' || tipo === 'comparar') {
      var per = M.periodoDe(n), folioD = tipo === 'docs' ? ((n.match(/ (?:factura|boleta|documento|nota de credito)(?: numero| n| nro| no| num)? (\d{3,8}) /) || [])[1] || '') : '';
      if (tipo === 'cotvend') per = / (ano|anual) /.test(n) ? 'anio' : 'mes';
      // Sin periodo ni folio, la pregunta es por un cliente: se acepta un calce mas suelto y, si hay varios, se pregunta cual.
      if (!cli && !per && !folioD && tipo !== 'comparar') { clis = cartera.buscar(texto, true); cli = clis[0] || null; claro = !!cli && clis.length === 1; }
      if (cli && !claro && (tipo === 'gestiones' || tipo === 'docs') && !per && !folioD) return { tipo: 'elegir', clis: clis, para: tipo };
      if (cli && !claro) cli = null;
      if (tipo === 'gestiones') {
        if (!cli && !per) return { tipo: 'ia', motivo: 'sin cliente' };
        return { tipo: 'gestiones', cli: cli, periodo: cli ? '' : per, resultado: datos.t ? (cli ? datos.gestionesDe(cli.r) : datos.gestionesPeriodo(per)) : null };
      }
      if (tipo === 'cotvend') return { tipo: 'cotvend', cli: cli, periodo: per, resultado: datos.ventas ? (cli ? datos.cotHist(cli.r) : datos.ventas) : null };
      if (tipo === 'comparar') return { tipo: 'comparar', cli: cli, resultado: datos.ventas ? (cli ? datos.comprasDe(cli.r) : datos.ventas) : null };
      return { tipo: 'docs', cli: cli, periodo: cli || folioD ? '' : (per || 'semana'), folio: cli ? '' : folioD, resultado: datos.ventas ? (cli ? datos.docsDe(cli.r) : folioD ? datos.docPorFolio(folioD) : datos.docsPeriodo(per || 'semana')) : null };
    }
    if (tipo === 'riesgo' || tipo === 'mejores') return { tipo: tipo, sub: tipo === 'mejores' ? (/ (ano|anual|este ano) /.test(n) ? 'mejores_anio' : 'mejores_mes') : 'riesgo', resultado: datos.ventas ? datos.cartera(tipo === 'mejores' ? (/ (ano|anual|este ano) /.test(n) ? 'mejores_anio' : 'mejores_mes') : 'riesgo') : null };
    if (tipo === 'compras') {
      if (!cli) { clis = cartera.buscar(texto, true); cli = clis[0] || null; claro = !!cli && clis.length === 1; }
      if (!cli) return { tipo: 'ia', motivo: 'sin cliente' };
      if (!claro) return { tipo: 'elegir', clis: clis, para: 'compras' };
      return { tipo: 'compras', cli: cli, resultado: datos.ventas ? (datos.comprasDe(cli.r) || { anio: 0 }) : null };
    }
    if (tipo === 'cotizado') {
      var folio = M.cotizacionDe(texto);
      if (!cli && !folio) { clis = cartera.buscar(texto, true); cli = clis[0] || null; claro = !!cli && clis.length === 1; }
      if (!cli && !folio) return { tipo: 'ia', motivo: 'sin cliente' };
      if (cli && !claro && !folio) return { tipo: 'elegir', clis: clis, para: 'cotizado' };
      return { tipo: 'cotizado', cli: cli, folio: folio, resultado: datos.t ? datos.cotizado(cli ? cli.r : '', folio) : null };
    }
    if (tipo === 'precio' || tipo === 'stock') {
      if (cli && !claro && nombrado) return { tipo: 'ia', motivo: 'cliente ambiguo', clis: clis };
      var lista = tipo === 'precio' ? M.listaDe(texto) : '';
      if (lista) { cli = null; claro = false; }                                                   // "en lista B": la lista manda, no el cliente
      var q = M.productoDe(texto, tipo === 'precio' && claro ? cli : null);
      if (!q) return { tipo: 'ia', motivo: 'sin producto' };
      var c1 = claro ? cli : (lista ? { r: '', n: '', l: lista } : null), o = datos.t ? (tipo === 'precio' ? datos.precio(q, c1) : datos.stock(q)) : null;
      if (o && lista) o.cliente = '';
      return { tipo: tipo, q: q, cli: claro ? cli : null, lista: lista, resultado: o, consulta: { accion: tipo, q: q, rut: claro ? cli.r : '', lista: lista, texto: texto } };
    }
    if (tipo === 'contacto' || tipo === 'cotiz' || tipo === 'llamar') {
      if (!cli) { clis = cartera.buscar(texto, true); cli = clis[0] || null; claro = !!cli && clis.length === 1; }
      if (!cli) return { tipo: 'ia', motivo: 'sin cliente' };
      if (!claro) return { tipo: 'elegir', clis: clis, para: tipo };
      return { tipo: 'ficha', para: tipo, cli: cli, resultado: datos.ficha(cli.r) };
    }
    if (tipo === 'hecha') return { tipo: 'hecha', cli: cli };
    if (/^(recordatorio|tarea|prosp|nota)$/.test(tipo)) return { tipo: 'borrador', borrador: M.borrador(tipo, texto, clis) };
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
    // puente (30-09-2026): dentro de la app del CRM no se llama a esta API; cada accion la resuelve la app con su sesion.
    if (opc.puente) this.una = function (accion, datos) { return Promise.resolve().then(function () { return opc.puente(accion, datos); }); };
    this.cola = []; this.vuelo = { u: 0, e: 0, f: 0 };
  };
  M.Api.RELEER = { inicio: 1, calentar: 1, pendientes: 1, configIA: 1, datos: 1, ventas: 1, gestiones: 1 };
  M.Api.RID = { chat: 1, tarea: 1, hecha: 1, gestion: 1, gestionBorrar: 1 };
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
