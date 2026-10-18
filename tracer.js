/* Trazador de Prolog: mini intérprete en JavaScript que NO calcula la respuesta
   (eso lo hace Tau Prolog), sino que narra paso a paso cómo se resuelve la
   consulta: cláusulas probadas, unificaciones, retrocesos, corte, negación, etc. */
(function (root) {
  'use strict';

  const INFIX = {
    ':-': [1200, 'xfx'], ';': [1100, 'xfy'], '->': [1050, 'xfy'], ',': [1000, 'xfy'],
    '=': [700, 'xfx'], '\\=': [700, 'xfx'], '==': [700, 'xfx'], '\\==': [700, 'xfx'],
    'is': [700, 'xfx'], '=:=': [700, 'xfx'], '=\\=': [700, 'xfx'],
    '<': [700, 'xfx'], '>': [700, 'xfx'], '=<': [700, 'xfx'], '>=': [700, 'xfx'],
    '+': [500, 'yfx'], '-': [500, 'yfx'], '*': [400, 'yfx'], '/': [400, 'yfx'],
    '//': [400, 'yfx'], 'mod': [400, 'yfx'], 'rem': [400, 'yfx'], '^': [200, 'xfy']
  };
  const PREFIX = { '\\+': [900, 'fy'], '-': [200, 'fy'], '+': [200, 'fy'], ':-': [1200, 'fx'] };

  const MAX_LINEAS = 90;
  const MAX_PASOS = 20000;

  /* ---------- Términos ---------- */
  let contadorVars = 0;
  const mkVar = (name) => ({ t: 'v', name, orig: name, id: ++contadorVars });
  const mkAtom = (name) => ({ t: 'a', name });
  const mkNum = (v) => ({ t: 'n', v });
  const mkCmp = (name, args) => ({ t: 'c', name, args });
  const NIL = mkAtom('[]');
  const mkList = (items, tail) => items.reduceRight((acc, x) => mkCmp('[|]', [x, acc]), tail || NIL);

  /* ---------- Tokenizador ---------- */
  function tokenizar(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
      if (c === '%') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '.' && (i + 1 >= src.length || /[\s%]/.test(src[i + 1]))) { toks.push({ k: 'end' }); i++; continue; }
      const resto = src.slice(i);
      let m;
      if ((m = /^\d+(\.\d+)?/.exec(resto))) { toks.push({ k: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
      if ((m = /^[A-Z_][A-Za-z0-9_]*/.exec(resto))) { toks.push({ k: 'var', v: m[0] }); i += m[0].length; continue; }
      if ((m = /^[a-z][A-Za-z0-9_]*/.exec(resto))) { toks.push({ k: 'atom', v: m[0] }); i += m[0].length; continue; }
      if (c === "'" || c === '"') {
        let j = i + 1, s = '';
        while (j < src.length && src[j] !== c) { s += src[j]; j++; }
        toks.push({ k: 'atom', v: s, q: true }); i = j + 1; continue;
      }
      if ('()[]{},|!;'.includes(c)) { toks.push({ k: 'p', v: c }); i++; continue; }
      if ((m = /^[+\-*\/\\^<>=~:.?@#&$]+/.exec(resto))) { toks.push({ k: 'sym', v: m[0] }); i += m[0].length; continue; }
      throw new Error('Carácter no reconocido: ' + c);
    }
    return toks;
  }

  /* ---------- Parser (precedencia de operadores) ---------- */
  function crearParser(toks, varMap) {
    let p = 0;
    const peek = () => toks[p] || { k: 'eof' };
    const esP = (t, v) => t.k === 'p' && t.v === v;
    function esperar(v) {
      if (!esP(peek(), v)) throw new Error("Se esperaba '" + v + "'");
      p++;
    }
    function nombreInfijo(t) {
      if ((t.k === 'atom' || t.k === 'sym') && !t.q && INFIX[t.v]) return t.v;
      if (t.k === 'p' && (t.v === ',' || t.v === ';')) return t.v;
      return null;
    }
    function parse(max) {
      let left = primario(max);
      for (;;) {
        const nombre = nombreInfijo(peek());
        if (nombre == null) break;
        const [pr, ty] = INFIX[nombre];
        if (pr > max) break;
        const lmax = ty === 'yfx' ? pr : pr - 1;
        const rmax = ty === 'xfy' ? pr : pr - 1;
        if (left.prec > lmax) break;
        p++;
        const right = parse(rmax);
        left = { t: mkCmp(nombre, [left.t, right.t]), prec: pr };
      }
      return left;
    }
    function argumentos() {
      const args = [parse(999).t];
      while (esP(peek(), ',')) { p++; args.push(parse(999).t); }
      esperar(')');
      return args;
    }
    function primario(max) {
      const t = peek();
      p++;
      if (t.k === 'num') return { t: mkNum(t.v), prec: 0 };
      if (t.k === 'var') {
        if (t.v === '_') return { t: mkVar('_'), prec: 0 };
        if (!varMap.has(t.v)) varMap.set(t.v, mkVar(t.v));
        return { t: varMap.get(t.v), prec: 0 };
      }
      if (t.k === 'atom' || t.k === 'sym') {
        if (esP(peek(), '(')) { p++; return { t: mkCmp(t.v, argumentos()), prec: 0 }; }
        if (!t.q && PREFIX[t.v]) {
          const [pr, ty] = PREFIX[t.v];
          const sig = peek();
          const terminador = sig.k === 'end' || sig.k === 'eof' || esP(sig, ')') || esP(sig, ',') || esP(sig, ']') || esP(sig, '|') || nombreInfijo(sig);
          if (!terminador && pr <= max) {
            const arg = parse(ty === 'fy' ? pr : pr - 1).t;
            if ((t.v === '-' || t.v === '+') && arg.t === 'n') return { t: mkNum(t.v === '-' ? -arg.v : arg.v), prec: 0 };
            return { t: mkCmp(t.v, [arg]), prec: pr };
          }
        }
        return { t: mkAtom(t.v), prec: 0 };
      }
      if (t.k === 'p') {
        if (t.v === '!') return { t: mkAtom('!'), prec: 0 };
        if (t.v === '(') { const r = parse(1200); esperar(')'); return { t: r.t, prec: 0 }; }
        if (t.v === '[') {
          if (esP(peek(), ']')) { p++; return { t: NIL, prec: 0 }; }
          const items = [parse(999).t];
          let tail = NIL;
          while (esP(peek(), ',')) { p++; items.push(parse(999).t); }
          if (esP(peek(), '|')) { p++; tail = parse(999).t; }
          esperar(']');
          return { t: mkList(items, tail), prec: 0 };
        }
      }
      throw new Error('Sintaxis no reconocida');
    }
    return {
      parse, peek,
      avanzar: () => { p++; },
      fin: () => p >= toks.length
    };
  }

  /* ---------- Bindings y unificación ---------- */
  let B = new Map();
  let trail = [];
  const deref = (t) => { while (t.t === 'v' && B.has(t.id)) t = B.get(t.id); return t; };
  const ligar = (v, t) => { B.set(v.id, t); trail.push(v.id); };
  const deshacer = (marca) => { while (trail.length > marca) B.delete(trail.pop()); };

  function unificar(a, b) {
    a = deref(a); b = deref(b);
    if (a === b) return null;
    if (b.t === 'v') { ligar(b, a); return null; }
    if (a.t === 'v') { ligar(a, b); return null; }
    if (a.t === 'n' && b.t === 'n') return a.v === b.v ? null : [a, b];
    if (a.t === 'a' && b.t === 'a') return a.name === b.name ? null : [a, b];
    if (a.t === 'c' && b.t === 'c' && a.name === b.name && a.args.length === b.args.length) {
      for (let i = 0; i < a.args.length; i++) {
        const r = unificar(a.args[i], b.args[i]);
        if (r) return r;
      }
      return null;
    }
    return [a, b];
  }

  function iguales(a, b) {
    a = deref(a); b = deref(b);
    if (a === b) return true;
    if (a.t !== b.t) return false;
    if (a.t === 'n') return a.v === b.v;
    if (a.t === 'a') return a.name === b.name;
    if (a.t === 'c') return a.name === b.name && a.args.length === b.args.length && a.args.every((x, i) => iguales(x, b.args[i]));
    return false;
  }

  function renombrar(t, mapa) {
    if (t.t === 'v') {
      let v = mapa.get(t.id);
      if (!v) { v = mkVar(t.name); mapa.set(t.id, v); }
      return v;
    }
    if (t.t === 'c') return mkCmp(t.name, t.args.map((x) => renombrar(x, mapa)));
    return t;
  }

  /* ---------- Impresión de términos ---------- */
  function fmt(t, max) {
    if (max === undefined) max = 1200;
    t = deref(t);
    switch (t.t) {
      case 'v': return t.name.startsWith('_') ? '_' : t.name;
      case 'n': return String(t.v);
      case 'a': return t.name;
      default: break;
    }
    if (t.name === '[|]' && t.args.length === 2) {
      const items = [];
      let cur = t;
      while (cur.t === 'c' && cur.name === '[|]' && cur.args.length === 2) { items.push(fmt(cur.args[0], 999)); cur = deref(cur.args[1]); }
      if (cur.t === 'a' && cur.name === '[]') return '[' + items.join(',') + ']';
      return '[' + items.join(',') + '|' + fmt(cur, 999) + ']';
    }
    if (t.args.length === 2 && INFIX[t.name]) {
      const [pr, ty] = INFIX[t.name];
      const l = fmt(t.args[0], ty === 'yfx' ? pr : pr - 1);
      const r = fmt(t.args[1], ty === 'xfy' ? pr : pr - 1);
      let s;
      if (t.name === ',') s = l + ', ' + r;
      else if (t.name === ';') s = l + ' ; ' + r;
      else if (t.name === ':-' || t.name === '->' || /^[a-z]/.test(t.name)) s = l + ' ' + t.name + ' ' + r;
      else s = l + t.name + r;
      return pr > max ? '(' + s + ')' : s;
    }
    if (t.args.length === 1 && PREFIX[t.name]) {
      const s = t.name + (/^[a-z]/.test(t.name) || t.name === '\\+' ? ' ' : '') + fmt(t.args[0], PREFIX[t.name][0]);
      return PREFIX[t.name][0] > max ? '(' + s + ')' : s;
    }
    return t.name + '(' + t.args.map((x) => fmt(x, 999)).join(',') + ')';
  }

  /* ---------- Aritmética ---------- */
  function evaluar(t) {
    t = deref(t);
    if (t.t === 'n') return t.v;
    if (t.t === 'v') throw new Error('Argumentos insuficientemente instanciados (variable sin valor en una operación aritmética)');
    if (t.t === 'c' && t.args.length === 2) {
      const a = evaluar(t.args[0]);
      const b = evaluar(t.args[1]);
      switch (t.name) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': if (b === 0) throw new Error('División entre cero'); return a / b;
        case '//': if (b === 0) throw new Error('División entre cero'); return Math.trunc(a / b);
        case 'mod': if (b === 0) throw new Error('División entre cero'); return ((a % b) + b) % b;
        case 'rem': if (b === 0) throw new Error('División entre cero'); return a % b;
        case '^': return Math.pow(a, b);
        case 'min': return Math.min(a, b);
        case 'max': return Math.max(a, b);
        default: break;
      }
    }
    if (t.t === 'c' && t.args.length === 1) {
      const a = evaluar(t.args[0]);
      if (t.name === '-') return -a;
      if (t.name === '+') return a;
      if (t.name === 'abs') return Math.abs(a);
      if (t.name === 'sqrt') return Math.sqrt(a);
    }
    throw new Error('Expresión aritmética no válida: ' + fmt(t));
  }

  /* ---------- Base de cláusulas ---------- */
  const PRELUDIO = `
member(X,[X|_]).
member(X,[_|T]) :- member(X,T).
append([],L,L).
append([H|T],L,[H|R]) :- append(T,L,R).
length([],0).
length([_|T],N) :- length(T,M), N is M+1.
reverse(L,R) :- rev_acc(L,[],R).
rev_acc([],A,A).
rev_acc([H|T],A,R) :- rev_acc(T,[H|A],R).
sum_list([],0).
sum_list([H|T],S) :- sum_list(T,S0), S is S0+H.
`;

  function agregarClausulas(db, texto, lib, soloNuevas) {
    const toks = tokenizar(texto);
    let inicio = 0;
    const nuevas = new Map();
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].k !== 'end') continue;
      const trozo = toks.slice(inicio, i);
      inicio = i + 1;
      if (!trozo.length) continue;
      const ps = crearParser(trozo, new Map());
      const t = ps.parse(1200).t;
      if (!ps.fin()) throw new Error('Sintaxis no reconocida');
      if (t.t === 'c' && t.name === ':-' && t.args.length === 1) continue; // directiva
      let head = t, body = null;
      if (t.t === 'c' && t.name === ':-' && t.args.length === 2) { head = t.args[0]; body = t.args[1]; }
      const h = deref(head);
      if (h.t === 'v' || h.t === 'n') throw new Error('Cabeza de cláusula no válida');
      const key = h.name + '/' + (h.t === 'c' ? h.args.length : 0);
      const entrada = { head: h, body, lib, text: fmt(h) + (body ? ' :- ' + fmt(body) : '') };
      if (soloNuevas) { if (db.has(key)) continue; }
      const lista = (soloNuevas ? nuevas : db);
      if (!lista.has(key)) lista.set(key, []);
      lista.get(key).push(entrada);
    }
    if (soloNuevas) for (const [k, v] of nuevas) db.set(k, v);
  }

  /* ---------- Resolución con traza ---------- */
  let lineas, truncada, pasos, db, llamadas;
  const T = (d, msg, forzar) => {
    if (lineas.length < MAX_LINEAS || forzar) lineas.push('  '.repeat(Math.min(d, 10)) + msg);
    else truncada = true;
  };

  function solve(nodo, k) {
    if (nodo === null) return k();
    if (++pasos > MAX_PASOS) throw { parada: true };
    const d = nodo.d, cf = nodo.cf, next = nodo.next;
    const g = deref(nodo.g);
    if (g.t === 'v') throw new Error('Argumentos insuficientemente instanciados (meta sin valor)');
    let args;
    if (g.t === 'a') args = [];
    else if (g.t === 'c') args = g.args;
    else throw new Error('Meta no invocable: ' + fmt(g));
    const key = g.name + '/' + args.length;

    switch (key) {
      case ',/2':
        return solve({ g: args[0], cf, d, next: { g: args[1], cf, d, next } }, k);
      case 'true/0':
        return solve(next, k);
      case '!/0': {
        T(d, 'Corte (!): se descartan las demás alternativas de ' + cf.pred + '.');
        const r = solve(next, k);
        cf.cut = true;
        return r;
      }
      case ';/2': {
        const L = deref(args[0]);
        const marca = trail.length;
        if (L.t === 'c' && L.name === '->' && L.args.length === 2) {
          T(d, 'Condicional: se evalúa la condición ' + fmt(L.args[0]) + '.');
          let ok = false;
          solve({ g: L.args[0], cf: { cut: false, pred: cf.pred }, d: d + 1, next: null }, () => { ok = true; return true; });
          if (ok) { T(d, 'La condición se cumple: se sigue por la rama "entonces".'); return solve({ g: L.args[1], cf, d, next }, k); }
          deshacer(marca);
          T(d, 'La condición falla: se sigue por la rama "si no".');
          return solve({ g: args[1], cf, d, next }, k);
        }
        T(d, 'Disyunción: se prueba la primera alternativa: ' + fmt(L) + '.');
        if (solve({ g: L, cf, d: d + 1, next }, k)) return true;
        deshacer(marca);
        if (cf.cut) return false;
        T(d, 'Retroceso: la primera alternativa falló; se prueba la segunda: ' + fmt(args[1]) + '.');
        return solve({ g: args[1], cf, d: d + 1, next }, k);
      }
      case '\\+/1': {
        const marca = trail.length;
        let ok = false;
        const txt = fmt(args[0]);
        T(d, 'Negación por fallo: se intenta demostrar ' + txt + '; si no se logra, \\+ tiene éxito.');
        solve({ g: args[0], cf: { cut: false, pred: cf.pred }, d: d + 1, next: null }, () => { ok = true; return true; });
        deshacer(marca);
        if (ok) { T(d, txt + ' sí se cumple, así que \\+ ' + txt + ' falla.'); return false; }
        T(d, txt + ' falla, así que \\+ ' + txt + ' tiene éxito.');
        return solve(next, k);
      }
      case '=/2': {
        const txt = fmt(args[0]) + ' = ' + fmt(args[1]);
        const r = unificar(args[0], args[1]);
        T(d, 'Unificación: ' + txt + (r ? ' → falla (' + fmt(r[0]) + ' ≠ ' + fmt(r[1]) + ').' : ' → éxito.'));
        return r ? false : solve(next, k);
      }
      case '\\=/2': {
        const marca = trail.length;
        const r = unificar(args[0], args[1]);
        deshacer(marca);
        T(d, 'No unificable: ' + fmt(args[0]) + ' \\= ' + fmt(args[1]) + (r ? ' → verdadero (no unifican).' : ' → falso (sí unifican).'));
        return r ? solve(next, k) : false;
      }
      case '==/2':
      case '\\==/2': {
        const eq = iguales(args[0], args[1]);
        const ok = key === '==/2' ? eq : !eq;
        T(d, 'Comparación estructural: ' + fmt(args[0]) + ' ' + g.name + ' ' + fmt(args[1]) + (ok ? ' → verdadero.' : ' → falso.'));
        return ok ? solve(next, k) : false;
      }
      case 'is/2': {
        const expr = fmt(args[1]);
        const val = evaluar(args[1]);
        const izq = fmt(args[0]);
        const r = unificar(args[0], mkNum(val));
        T(d, 'Aritmética: ' + izq + ' is ' + expr + ' → ' + val + (r ? ' (no unifica con ' + fmt(r[0]) + ').' : '.'));
        return r ? false : solve(next, k);
      }
      case '</2': case '>/2': case '=</2': case '>=/2': case '=:=/2': case '=\\=/2': {
        const txt = fmt(args[0]) + g.name + fmt(args[1]);
        const a = evaluar(args[0]), b = evaluar(args[1]);
        let ok;
        switch (g.name) {
          case '<': ok = a < b; break;
          case '>': ok = a > b; break;
          case '=<': ok = a <= b; break;
          case '>=': ok = a >= b; break;
          case '=:=': ok = a === b; break;
          default: ok = a !== b;
        }
        const nums = deref(args[0]).t === 'n' && deref(args[1]).t === 'n';
        T(d, 'Comparación: ' + txt + (nums ? '' : ' (' + a + ' ' + g.name + ' ' + b + ')') + ' → ' + (ok ? 'verdadero.' : 'falso, la meta falla.'));
        return ok ? solve(next, k) : false;
      }
      case 'fail/0':
      case 'false/0':
        T(d, 'fail: esta meta siempre falla.');
        return false;
      case 'write/1': case 'writeln/1': case 'print/1': case 'nl/0': case 'halt/0':
        return solve(next, k);
      default: break;
    }

    const clausulas = db.get(key);
    if (!clausulas) {
      T(d, fmt(g) + ': no existe el predicado ' + key + ' (Prolog responde con error o falla).');
      return false;
    }
    T(d, 'Meta: ' + fmt(g));
    const marco = { cut: false, pred: key };
    let hubo = false;
    for (let i = 0; i < clausulas.length; i++) {
      const c = clausulas[i];
      const mapa = new Map();
      const cab = renombrar(c.head, mapa);
      const cuerpo = c.body ? renombrar(c.body, mapa) : null;
      const marca = trail.length;
      const etiqueta = 'Cláusula ' + (i + 1) + (c.lib ? ' (biblioteca)' : '') + ': ' + c.text;
      const fallo = unificar(g, cab);
      if (fallo) {
        T(d + 1, etiqueta + ' → no unifica (' + fmt(fallo[0]) + ' ≠ ' + fmt(fallo[1]) + ').');
        deshacer(marca);
        continue;
      }
      hubo = true;
      const n = ++llamadas;
      const vistos = new Set();
      const binds = [];
      for (const v of mapa.values()) {
        if (v.orig.startsWith('_')) continue;
        v.name = v.orig + n; // evita confundir las variables de la cláusula con las de la meta
        const val = deref(v);
        if (val.t === 'v' || vistos.has(v.orig)) continue;
        vistos.add(v.orig);
        binds.push(v.orig + '=' + fmt(val));
      }
      let msg = etiqueta + ' → unifica' + (binds.length ? ' con ' + binds.join(', ') : '') + '.';
      msg += cuerpo ? ' Nueva meta: ' + fmt(cuerpo) : ' Es un hecho: la meta se cumple.';
      T(d + 1, msg);
      const sig = cuerpo ? { g: cuerpo, cf: marco, d: d + 2, next } : next;
      if (solve(sig, k)) return true;
      deshacer(marca);
      if (marco.cut) return false;
      if (i < clausulas.length - 1) T(d + 1, 'Retroceso: la cláusula ' + (i + 1) + ' no llevó a una solución; se prueba la siguiente.');
    }
    if (hubo) T(d, 'Retroceso: no quedan más cláusulas de ' + key + ' para ' + fmt(g) + '.');
    else T(d, fmt(g) + ' falla: ninguna cláusula de ' + key + ' la demuestra.');
    return false;
  }

  /* ---------- API ---------- */
  function trazarProlog(programa, consulta) {
    contadorVars = 0; llamadas = 0; B = new Map(); trail = []; lineas = []; truncada = false; pasos = 0;
    const qvars = new Map();
    let consultaTerm;
    try {
      db = new Map();
      agregarClausulas(db, programa, false, false);
      agregarClausulas(db, PRELUDIO, true, true);
      const toks = tokenizar(consulta).filter((t) => t.k !== 'end');
      const ps = crearParser(toks, qvars);
      consultaTerm = ps.parse(1200).t;
      if (!ps.fin()) throw new Error('Sintaxis no reconocida en la consulta');
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }

    let encontrada = false, detenida = false;
    const resp = [];
    try {
      solve({ g: consultaTerm, cf: { cut: false, pred: 'la consulta' }, d: 0, next: null }, () => {
        encontrada = true;
        for (const [n, v] of qvars) {
          if (n.startsWith('_')) continue;
          const val = deref(v);
          if (val.t !== 'v') resp.push(n + ' = ' + fmt(val));
        }
        return true;
      });
    } catch (e) {
      if ((e && e.parada) || e instanceof RangeError) detenida = true;
      else return { ok: false, error: String((e && e.message) || e) };
    }
    if (detenida) T(0, 'Se detuvo la traza: demasiados pasos (posible recursión infinita).', true);
    else if (encontrada) T(0, 'Éxito: ' + (resp.length ? resp.join(', ') : 'la consulta se cumple (true)') + '.', true);
    else T(0, 'Fin: no se pudo demostrar la consulta (false).', true);
    if (truncada) lineas.splice(MAX_LINEAS, 0, '… (traza abreviada: se muestran los primeros ' + MAX_LINEAS + ' pasos)');
    return { ok: true, encontrada, detenida, lineas };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { trazarProlog };
  else root.trazarProlog = trazarProlog;
})(typeof window !== 'undefined' ? window : globalThis);
