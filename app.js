/* Agente intérprete de Prolog
   - Ejecuta el código con Tau Prolog (motor real en el navegador).
   - Genera una explicación local por reglas y, opcionalmente, una explicación con Claude. */

const EJEMPLOS = {
  principal: `miembro(X, [X|_]).
miembro(X, [_|T]) :- miembro(X, T).
?- miembro(b, [a,b,c]).`,
  aritmetica: `doble(X, Y) :- Y is X * 2.
resto(A, B, R) :- R is A mod B.
?- doble(7, R).
?- resto(17, 5, R).`,
  listas: `longitud([], 0).
longitud([_|T], N) :- longitud(T, M), N is M + 1.
?- longitud([a,b,c,d], N).`,
  negacion: `ave(tweety).
ave(pingu).
no_vuela(pingu).
vuela(X) :- ave(X), \\+ no_vuela(X).
?- vuela(tweety).
?- vuela(pingu).`,
  disyuncion: `fin_de_semana(D) :- D = sabado ; D = domingo.
?- fin_de_semana(sabado).
?- fin_de_semana(lunes).`,
  corte: `max(X, Y, X) :- X >= Y, !.
max(_, Y, Y).
?- max(3, 8, M).`,
  hechos: `padre(juan, pedro).
padre(pedro, luis).
abuelo(X, Z) :- padre(X, Y), padre(Y, Z).
?- abuelo(juan, Z).`
};

const $ = (id) => document.getElementById(id);
const MAX_SOLUCIONES = 10;

/* ---------- Separar programa y consultas ---------- */
function separar(texto) {
  const programa = [];
  const consultas = [];
  // Se procesa por "cláusulas" terminadas en punto, respetando que las consultas empiezan con ?-
  const limpio = texto.replace(/%[^\n]*/g, ""); // quita comentarios de línea
  const partes = limpio.match(/(?:[^.]|\.(?!\s|$))*\./g) || [];
  for (const p of partes) {
    const t = p.trim();
    if (!t) continue;
    if (t.startsWith("?-")) consultas.push(t.slice(2).trim().replace(/\.$/, ""));
    else programa.push(t);
  }
  return { programa: programa.join("\n"), consultas };
}

/* ---------- Ejecución con Tau Prolog ---------- */
function consultar(sesion, programa) {
  return new Promise((resolve, reject) => {
    sesion.consult(programa, {
      success: resolve,
      error: (e) => reject(e)
    });
  });
}

function preguntar(sesion, meta) {
  return new Promise((resolve, reject) => {
    sesion.query(meta, { success: resolve, error: (e) => reject(e) });
  });
}

function siguiente(sesion) {
  return new Promise((resolve) => {
    sesion.answer({
      success: (a) => resolve({ tipo: "ok", a }),
      fail: () => resolve({ tipo: "fail" }),
      error: (e) => resolve({ tipo: "error", e }),
      limit: () => resolve({ tipo: "limit" })
    });
  });
}

async function ejecutarConsulta(programa, meta) {
  const sesion = pl.create(100000);
  const base = ":- use_module(library(lists)).\n" + programa + "\n";
  try {
    await consultar(sesion, base);
  } catch (e) {
    return { estado: "error", texto: "Error en el programa: " + String(e) };
  }
  try {
    await preguntar(sesion, meta + ".");
  } catch (e) {
    return { estado: "error", texto: "Error en la consulta: " + String(e) };
  }

  const soluciones = [];
  for (let i = 0; i < MAX_SOLUCIONES; i++) {
    const r = await siguiente(sesion);
    if (r.tipo === "ok") {
      soluciones.push(pl.format_answer(r.a).replace(/[\s;.]+$/, ""));
    } else if (r.tipo === "fail") {
      break;
    } else if (r.tipo === "error") {
      return { estado: "error", texto: "Error de ejecución: " + String(r.e) };
    } else {
      return { estado: "error", texto: "Se superó el límite de inferencias (posible recursión infinita)." };
    }
  }

  if (soluciones.length === 0) return { estado: "false", texto: "false." };
  return { estado: "true", texto: soluciones.join(" ;\n") + ".", soluciones };
}

/* ---------- Explicación local (por reglas) ---------- */
function explicarLocal(programa, meta, resultado) {
  const puntos = [];
  const clausulas = programa.split(/\.\s*(?:\n|$)/).filter((c) => c.trim());

  puntos.push(`Hechos y reglas: el programa tiene ${clausulas.length} cláusula(s). Los hechos afirman algo sin condición; las reglas (:-) se cumplen si todas las metas del cuerpo se cumplen.`);
  puntos.push(`Consulta evaluada: ?- ${meta}.`);

  if (/\bis\b|=:=|=\\=|>=|=<|[<>]|\bmod\b|\*|\+|-|\//.test(programa + " " + meta)) {
    puntos.push("Aritmética: 'is' evalúa la expresión del lado derecho y unifica el resultado con la variable de la izquierda; los comparadores (>=, <, =:= …) requieren que ambos lados ya estén evaluables.");
  }
  if (/\[[^\]]*\|[^\]]*\]|\[\s*\]|\[[^\]]+\]/.test(programa + " " + meta)) {
    puntos.push("Listas: [H|T] separa la cabeza (primer elemento) de la cola. Las reglas recursivas recorren la lista quitando un elemento por paso hasta llegar al caso base [].");
  }
  if (/\\\+|\bnot\(/.test(programa)) {
    puntos.push("Negación como fallo: \\+ Meta tiene éxito cuando Prolog NO logra demostrar Meta con la información disponible (suposición de mundo cerrado).");
  }
  if (/;/.test(programa)) {
    puntos.push("Disyunción: A ; B se cumple si A o B se cumplen. Prolog prueba A primero y, al retroceder, intenta B.");
  }
  if (/!/.test(programa)) {
    puntos.push("Corte (!): una vez alcanzado, Prolog descarta las alternativas pendientes de esa cláusula y de las cláusulas siguientes del mismo predicado, haciendo la ejecución determinista.");
  }

  if (resultado.estado === "true") {
    puntos.push("Resultado: Prolog encontró al menos una forma de demostrar la consulta, por eso responde true (con los valores de las variables si las hay).");
  } else if (resultado.estado === "false") {
    puntos.push("Resultado: Prolog agotó todas las cláusulas y alternativas sin lograr demostrar la consulta, por eso responde false.");
  }
  return puntos;
}

/* ---------- Explicación con Claude (opcional) ---------- */
async function explicarConIA(apiKey, programa, meta, resultado) {
  const prompt = `Eres un intérprete de Prolog para estudiantes. Dado este programa y consulta, explica en español, de forma breve y paso a paso, cómo se resuelve (unificación, cláusulas probadas, retroceso, corte si aplica). El resultado real del motor fue: ${resultado.texto}

Programa:
${programa}

Consulta: ?- ${meta}.`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const data = await resp.json();
  return data.content.map((b) => b.text || "").join("");
}

/* ---------- Interfaz ---------- */
function escapar(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

async function enviar() {
  const texto = $("codigo").value;
  const resp = $("respuesta");
  const expl = $("explicacion");
  const boton = $("btnEnviar");

  const { programa, consultas } = separar(texto);
  if (!consultas.length) {
    resp.className = "respuesta error";
    resp.textContent = "Escribe al menos una consulta que empiece con ?-";
    expl.textContent = "—";
    return;
  }

  boton.disabled = true;
  resp.className = "respuesta";
  resp.textContent = "Evaluando...";
  expl.textContent = "—";

  const salidas = [];
  const bloquesExpl = [];
  let estadoGlobal = "true";

  for (const meta of consultas) {
    const r = await ejecutarConsulta(programa, meta);
    if (r.estado !== "true") estadoGlobal = r.estado;
    salidas.push(consultas.length > 1 ? `?- ${meta}.\n${r.texto}` : r.texto);
    bloquesExpl.push({ meta, r });
  }

  resp.className = "respuesta " + estadoGlobal;
  resp.textContent = "Esta es la respuesta: " + salidas.join("\n\n");

  let html = "";
  for (const { meta, r } of bloquesExpl) {
    let traza = null;
    try { traza = window.trazarProlog(programa, meta); } catch (e) { traza = null; }
    // Solo se muestra la traza si coincide con el veredicto del motor (true/false)
    const coincide = traza && traza.ok && traza.encontrada === (r.estado === "true");
    if (consultas.length > 1) html += `<h4>?- ${escapar(meta)}.</h4>`;
    if (coincide) {
      html += `<p class="sub">Así razona el agente, paso a paso:</p><pre class="traza">${escapar(traza.lineas.join("\n"))}</pre>`;
    }
    const puntos = explicarLocal(programa, meta, r);
    html += `<p class="sub">Conceptos usados:</p><ul>${puntos.map((p) => `<li>${escapar(p)}</li>`).join("")}</ul>`;
  }
  expl.innerHTML = html;

  const apiKey = $("apiKey").value.trim();
  if ($("usarIA").checked && apiKey) {
    expl.insertAdjacentHTML("beforeend", "<p>Consultando a Claude...</p>");
    try {
      const textoIA = await explicarConIA(apiKey, programa, bloquesExpl[0].meta, bloquesExpl[0].r);
      expl.innerHTML = `<div>${escapar(textoIA)}</div><hr>` + html;
    } catch (e) {
      expl.insertAdjacentHTML("beforeend", `<p>No se pudo usar la IA (${escapar(String(e.message))}). Se muestra la explicación local.</p>`);
    }
  }

  boton.disabled = false;
}

$("btnEnviar").addEventListener("click", enviar);
$("btnEjemplo").addEventListener("click", () => { $("codigo").value = EJEMPLOS.principal; });
$("selEjemplos").addEventListener("change", (e) => {
  if (e.target.value) $("codigo").value = EJEMPLOS[e.target.value];
  e.target.value = "";
});
