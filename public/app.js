exigirSesion();

document.getElementById('nombreUsuario').innerText = getUsuario() || '';

const APARTADOS = {
    bebida: { lista: document.getElementById('listaBebidas'), icono: '☕', titulo: 'Bebidas' },
    pincho: { lista: document.getElementById('listaPinchos'), icono: '🥘', titulo: 'Pinchos' },
};

// Lo elegido: una línea por cosa ({ clase, nombre, cantidad, hielo, plancha }),
// por la clave de CATALOGO.claveLinea. La pantalla se pinta siempre a partir
// de aquí, así lo que se ve y lo que se manda al guardar no pueden
// descuadrarse.
const lineas = new Map();

// Las filas en pantalla, por la misma clave. Las de la carta están siempre;
// las escritas a mano en "Otro", solo mientras sigan elegidas.
const filas = new Map();

// Si ya hay un pedido guardado en este turno (el botón dice "Modificar")
let hayPedido = false;
let guardando = false;

function crearBoton(estilo, texto, titulo, alPulsar) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = estilo;
    boton.innerText = texto;
    boton.setAttribute('aria-label', titulo);
    boton.addEventListener('click', alPulsar);
    return boton;
}

// Hielo y plancha: una casilla pegada a la cosa, que solo se ve al marcarla
function crearExtra(contenedor, estilo, texto, titulo, clave, campo) {
    const extra = document.createElement('label');
    extra.className = `extra ${estilo}`;
    extra.title = titulo;

    const casilla = document.createElement('input');
    casilla.type = 'checkbox';
    casilla.setAttribute('aria-label', titulo);
    extra.append(casilla, texto);
    contenedor.append(extra);

    casilla.addEventListener('change', () => {
        const linea = lineas.get(clave);
        if (linea) linea[campo] = casilla.checked;
        pintar();
    });
    return casilla;
}

// Una fila de la carta: la casilla con el nombre y, al marcarla, el hielo o
// la plancha si los admite y el botón de la cantidad (x1, x2...).
function crearFila(clase, nombre, aMano = false) {
    const clave = CATALOGO.claveLinea(clase, nombre);

    const fila = document.createElement('div');
    fila.className = 'opcion';

    const etiqueta = document.createElement('label');
    etiqueta.className = 'opcion-etiqueta';
    const marca = document.createElement('input');
    marca.type = 'checkbox';
    marca.className = 'marca';
    // Va como texto y no como HTML: lo de "Otro" lo escribe la persona. El
    // espacio que no se corta deja el icono pegado al nombre en pantallas
    // estrechas.
    etiqueta.append(marca, `${CATALOGO.icono(nombre, APARTADOS[clase].icono)}\u00A0${CATALOGO.etiqueta(nombre)}`);

    const controles = document.createElement('div');
    controles.className = 'opcion-controles hidden';

    const refs = { fila, marca, controles, aMano };

    if (CATALOGO.admiteHielo(clase, nombre)) {
        refs.hielo = crearExtra(controles, 'extra-hielo', '❄️', 'Con hielo', clave, 'hielo');
    }
    if (CATALOGO.admitePlancha(clase, nombre)) {
        refs.plancha = crearExtra(controles, 'extra-plancha', '🔥 Plancha', 'A la plancha', clave, 'plancha');
    }

    refs.menos = crearBoton('cantidad-menos hidden', '−', 'Quitar uno', () => sumar(clave, -1));
    refs.mas = crearBoton('cantidad', 'x1', 'Sumar uno', () => sumar(clave, 1));
    controles.append(refs.menos, refs.mas);

    marca.addEventListener('change', () => {
        if (marca.checked) elegir(clase, nombre);
        else quitarLinea(clave);
    });

    fila.append(etiqueta, controles);
    APARTADOS[clase].lista.append(fila);
    filas.set(clave, refs);
}

CATALOGO.carta('bebida').forEach(nombre => crearFila('bebida', nombre));
CATALOGO.carta('pincho').forEach(nombre => crearFila('pincho', nombre));

// Marca una cosa, de una. Devuelve si ha quedado elegida (puede que no, si ya
// se ha llegado al tope de cosas distintas).
function elegir(clase, nombre) {
    const clave = CATALOGO.claveLinea(clase, nombre);
    if (!lineas.has(clave)) {
        if (lineas.size >= CATALOGO.maxItems) {
            alert(`Como mucho ${CATALOGO.maxItems} cosas distintas por pedido.`);
        } else {
            lineas.set(clave, { clase, nombre, cantidad: 1, hielo: false, plancha: false });
        }
    }
    pintar();
    return lineas.has(clave);
}

function quitarLinea(clave) {
    lineas.delete(clave);
    const refs = filas.get(clave);
    // Lo escrito a mano no tiene sitio en la carta: si se quita, desaparece
    if (refs && refs.aMano) {
        refs.fila.remove();
        filas.delete(clave);
    }
    pintar();
}

// x1 → x2 → x3... y con el "−", al revés. Nunca baja de 1: para quitarlo del
// todo se desmarca.
function sumar(clave, paso) {
    const linea = lineas.get(clave);
    if (!linea) return;
    linea.cantidad = CATALOGO.cantidad(linea.cantidad + paso);
    pintar();
}

function resaltar(clave) {
    const refs = filas.get(clave);
    if (!refs) return;
    refs.fila.classList.remove('resalta');
    void refs.fila.offsetWidth; // para que la animación vuelva a empezar
    refs.fila.classList.add('resalta');
}

// Lo escrito en "Otro" entra como una fila más, ya marcada. Si es algo que ya
// está en el pedido (de la carta o añadido antes a mano) no sale repetido: se
// le suma uno, x2, x3... Devuelve el mensaje que se enseña debajo.
function anadirOtro(claseEscrita, texto) {
    const { clase, nombre } = CATALOGO.buscar(texto) || { clase: claseEscrita, nombre: texto };
    const clave = CATALOGO.claveLinea(clase, nombre);
    const linea = lineas.get(clave);
    // Si ya estaba, con el nombre de la línea y no con lo que se acaba de teclear
    const queEs = CATALOGO.etiqueta(linea ? linea.nombre : nombre);

    if (linea) {
        if (linea.cantidad >= CATALOGO.maxCantidad) {
            return `${queEs} ya está al máximo (x${CATALOGO.maxCantidad}).`;
        }
        sumar(clave, 1);
        resaltar(clave);
        return `${queEs} ya estaba en tu pedido: ahora x${linea.cantidad}.`;
    }

    if (!filas.has(clave)) crearFila(clase, nombre, true);
    if (!elegir(clase, nombre)) {
        quitarLinea(clave);
        return '';
    }
    resaltar(clave);
    const donde = clase === claseEscrita ? '' : ` (está en ${APARTADOS[clase].titulo})`;
    return `Añadido: ${queEs}${donde}.`;
}

const FORMULARIOS_OTRO = [...document.querySelectorAll('form.otro')];

// Pasa a la lista lo que haya escrito en un "Otro". Devuelve si había algo.
function anadirEscrito(formulario) {
    const campo = formulario.querySelector('input');
    const texto = campo.value.trim();
    if (!texto) return false;

    const aviso = document.querySelector(`.otro-aviso[data-clase="${formulario.dataset.clase}"]`);
    aviso.innerText = anadirOtro(formulario.dataset.clase, texto);
    campo.value = '';

    // El mensaje se va solo: es para confirmar en el momento, no para quedarse
    clearTimeout(aviso.temporizador);
    aviso.temporizador = setTimeout(() => { aviso.innerText = ''; }, 4000);
    return true;
}

FORMULARIOS_OTRO.forEach(formulario => {
    formulario.addEventListener('submit', (evento) => {
        evento.preventDefault();
        if (!anadirEscrito(formulario)) formulario.querySelector('input').focus();
    });
});

// Lo elegido, bebidas primero, tal cual se manda al servidor
function elegidas() {
    return CATALOGO.normalizarPedido([...lineas.values()]);
}

function unidades() {
    return [...lineas.values()].reduce((suma, linea) => suma + linea.cantidad, 0);
}

function describirPedido(items) {
    return CATALOGO.normalizarPedido(items).map(CATALOGO.describir).join(', ');
}

// Repinta la pantalla a partir de lo elegido: casillas, botones de cada fila,
// la lista de "Tu pedido" y el botón de guardar.
function pintar() {
    for (const [clave, refs] of filas) {
        const linea = lineas.get(clave);
        refs.marca.checked = Boolean(linea);
        refs.controles.classList.toggle('hidden', !linea);
        if (refs.hielo) refs.hielo.checked = Boolean(linea && linea.hielo);
        if (refs.plancha) refs.plancha.checked = Boolean(linea && linea.plancha);
        if (!linea) continue;

        refs.mas.innerText = `x${linea.cantidad}`;
        refs.mas.disabled = linea.cantidad >= CATALOGO.maxCantidad;
        refs.mas.setAttribute('aria-label', `Cantidad ${linea.cantidad}, toca para sumar uno`);
        refs.menos.classList.toggle('hidden', linea.cantidad <= 1);
    }

    pintarTuPedido();
    pintarBoton();
}

function pintarTuPedido() {
    const lista = document.getElementById('lineasPedido');
    const todas = elegidas();

    document.getElementById('tuPedido').classList.toggle('hidden', todas.length === 0);
    lista.innerText = '';

    todas.forEach(linea => {
        const fila = document.createElement('li');
        const texto = document.createElement('span');
        texto.innerText = `${CATALOGO.icono(linea.nombre, APARTADOS[linea.clase].icono)}\u00A0${CATALOGO.describir(linea)}`;
        const clave = CATALOGO.claveLinea(linea.clase, linea.nombre);
        fila.append(texto, crearBoton('quitar-linea', '✕', `Quitar ${CATALOGO.etiqueta(linea.nombre)}`,
            () => quitarLinea(clave)));
        lista.append(fila);
    });
}

function pintarBoton() {
    const btn = document.getElementById('btnGuardar');

    if (guardando) {
        btn.disabled = true;
        btn.innerText = 'Guardando...';
        return;
    }

    const total = unidades();
    btn.disabled = total === 0;
    if (total === 0) {
        btn.innerText = hayPedido ? 'Marca algo para cambiar tu pedido' : 'Marca lo que quieras pedir';
    } else {
        btn.innerText = `${hayPedido ? 'Modificar pedido' : 'Guardar Pedido'} (${total})`;
    }
}

// Deja la pantalla elegida tal cual una lista de items (la del pedido
// guardado o la de la última vez). Lo que no está en la carta sale como fila
// escrita a mano.
function cargarItems(items) {
    lineas.clear();
    for (const [clave, refs] of [...filas]) {
        if (refs.aMano) {
            refs.fila.remove();
            filas.delete(clave);
        }
    }

    CATALOGO.normalizarPedido(items).forEach(item => {
        const clave = CATALOGO.claveLinea(item.clase, item.nombre);
        if (!filas.has(clave)) crearFila(item.clase, item.nombre, true);
        lineas.set(clave, item);
    });

    pintar();
}

function horaDentroDe(ms) {
    return new Date(Date.now() + ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// Preferencia: si otro día ya pidió algo, se le ofrece repetirlo en vez de
// tener que buscarlo otra vez en la lista.
let itemsPreferencia = [];

function ocultarAviso() {
    document.getElementById('avisoPreferencia').classList.add('hidden');
}

document.getElementById('btnRepetirSi').addEventListener('click', () => {
    cargarItems(itemsPreferencia);
    ocultarAviso();
});
document.getElementById('btnRepetirNo').addEventListener('click', ocultarAviso);

async function ofrecerPreferencia() {
    let preferencia;
    try {
        const respuesta = await authFetch('/api/preferencia');
        preferencia = await respuesta.json();
    } catch (err) {
        return; // sin conexión no se ofrece nada: el pedido normal sigue igual
    }

    // Si mientras tanto ya ha pedido, no viene a cuento
    if (hayPedido || !preferencia.hay || !preferencia.deOtroDia) return;

    const resumen = describirPedido(preferencia.items);
    if (!resumen) return;
    itemsPreferencia = preferencia.items;

    // El texto de "Otro" lo escribe la persona, así que se pinta como texto y
    // no como HTML.
    const aviso = document.getElementById('textoPreferencia');
    aviso.innerText = '';
    aviso.append('⚠️ La última vez pediste ');
    const queEs = document.createElement('strong');
    queEs.innerText = resumen;
    aviso.append(queEs, '. ¿Quieres lo mismo?');
    document.getElementById('avisoPreferencia').classList.remove('hidden');
}

// Estado de la pantalla: o no has pedido (botón "Guardar Pedido") o tienes un
// pedido vivo, que se puede cambiar tantas veces como quieras o anular.
let finDelTurno = null;
let temporizador = null;

function pintarSinPedido(mensaje = '') {
    hayPedido = false;
    finDelTurno = null;
    clearTimeout(temporizador);

    document.getElementById('avisoPedido').classList.add('hidden');
    document.getElementById('avisoTurno').innerText = mensaje;
    pintarBoton();
}

function pintarConPedido(pedido) {
    hayPedido = true;

    // Lo que hay pedido puede llevar texto escrito a mano, así que se pinta
    // como texto y no como HTML.
    const texto = document.getElementById('textoPedido');
    texto.innerText = '';
    const desde = pedido.creadoEn
        ? ` desde las ${new Date(pedido.creadoEn).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
        : '';
    texto.append(`✅ Tienes pedido${desde}: `);
    const que = document.createElement('strong');
    que.innerText = describirPedido(pedido.items);
    texto.append(que, '. Cambia lo que quieras y dale a "Modificar pedido".');

    document.getElementById('avisoPedido').classList.remove('hidden');
    ocultarAviso(); // si ya has pedido, no viene a cuento ofrecerte repetir
    programarFinDeTurno(pedido.msRestantes);
    pintarBoton();
}

// Sin pedido, se dice hasta cuándo aguantaría uno hecho ahora: en el primer
// turno, todo hasta la misma hora; después, unos minutos cada uno.
function textoSiPides(mio) {
    if (!mio || !mio.msSiPides) return '';
    if (mio.primerTurno) {
        return `☕ Primer turno: los pedidos aguantan hasta las ${horaDentroDe(mio.msSiPides)}.`;
    }
    return `Tu pedido aguantará ${mio.minutosTurno} minutos desde que lo guardes.`;
}

// Cuando el pedido caduca empieza un turno nuevo y se puede volver a pedir sin
// recargar (en el móvil la app se queda abierta en segundo plano).
function revisarTurno() {
    if (!finDelTurno || Date.now() < finDelTurno) return;
    pintarSinPedido('Ha empezado un turno nuevo: ya puedes volver a pedir.');
}

function programarFinDeTurno(msRestantes) {
    clearTimeout(temporizador);
    if (!msRestantes) return;

    finDelTurno = Date.now() + msRestantes;
    document.getElementById('avisoTurno').innerText =
        `Tu pedido cuenta para el turno que acaba a las ${horaDentroDe(msRestantes)}.`;
    temporizador = setTimeout(revisarTurno, msRestantes);
}

// Los temporizadores se frenan con la app en segundo plano, así que al volver
// a ella se comprueba también por si el turno ya se ha acabado.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) revisarTurno();
});

document.getElementById('btnAnular').addEventListener('click', async () => {
    if (!confirm('¿Seguro que quieres anular tu pedido de este turno?')) return;

    const btn = document.getElementById('btnAnular');
    btn.disabled = true;
    try {
        await authFetch('/api/mi-pedido', { method: 'DELETE' });
        // No se desmarca nada: si ha sido sin querer, basta con volver a darle
        // a "Guardar Pedido".
        pintarSinPedido('Pedido anulado. Puedes volver a pedir cuando quieras.');
    } catch (err) {
        alert('No se pudo anular el pedido. Inténtalo otra vez.');
    } finally {
        btn.disabled = false;
    }
});

// Al abrir la pantalla: si ya hay un pedido vivo se enseña marcado y listo
// para cambiar; si no, se ofrece repetir lo del último día.
async function arrancar() {
    let mio;
    try {
        const respuesta = await authFetch('/api/mi-pedido');
        mio = await respuesta.json();
    } catch (err) {
        return; // sin conexión se deja la pantalla como está
    }

    if (mio && mio.hay) {
        cargarItems(mio.items);
        pintarConPedido(mio);
    } else {
        pintarSinPedido(textoSiPides(mio));
        ofrecerPreferencia();
    }
}

pintar();
arrancar();

// Al volver atrás desde el resumen, el navegador puede enseñar la pantalla tal
// cual se dejó (con el botón en "Guardando..."): se pone al día.
window.addEventListener('pageshow', (evento) => {
    if (!evento.persisted) return;
    guardando = false;
    pintarBoton();
    arrancar();
});

document.getElementById('btnGuardar').addEventListener('click', async () => {
    // Lo que se haya quedado escrito en "Otro" sin darle a "Añadir" también va
    FORMULARIOS_OTRO.forEach(anadirEscrito);

    const items = elegidas();
    if (items.length === 0) {
        alert('Elige al menos una bebida o un pincho.');
        return;
    }

    // Se desactiva antes de la petición para que un doble toque no mande dos
    guardando = true;
    pintarBoton();

    try {
        const response = await authFetch('/api/pedidos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });

        if (response.ok) {
            const datos = await response.json();
            // Directo al resumen, a ver el pedido junto al de los demás. El
            // botón se queda en "Guardando..." mientras se va.
            window.location.href = `resumen.html?hecho=${datos.modificado ? 'modificado' : 'guardado'}`;
            return;
        }

        const errorData = await response.json().catch(() => ({}));
        alert(errorData.error || 'No se pudo guardar el pedido. Inténtalo otra vez.');
    } catch (err) {
        // Si la sesión ha caducado authFetch ya se encarga de mandar al login
        if (err.message !== 'Sesión expirada') {
            alert('No se pudo guardar el pedido. Revisa tu conexión.');
        }
    }

    guardando = false;
    pintarBoton();
});

function irAlResumen() {
    window.location.href = 'resumen.html';
}

document.getElementById('btnResumen').addEventListener('click', irAlResumen);
document.getElementById('btnVerResumen').addEventListener('click', irAlResumen);

document.getElementById('btnCompra').addEventListener('click', () => {
    window.location.href = 'compra.html';
});

document.getElementById('btnCerrarSesion').addEventListener('click', cerrarSesion);
