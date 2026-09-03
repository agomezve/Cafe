exigirSesion();

document.getElementById('nombreUsuario').innerText = getUsuario() || '';

const inputOtro = document.getElementById('otroTexto');
const inputOtroPincho = document.getElementById('otroPinchoTexto');

const APARTADOS = {
    bebida: { lista: document.getElementById('listaBebidas'), input: inputOtro },
    pincho: { lista: document.getElementById('listaPinchos'), input: inputOtroPincho },
};

// La carta se pinta desde el catálogo
function pintarCarta(clase) {
    const { lista, input } = APARTADOS[clase];

    // "Otro" va al final, para escribir a mano lo que no esté en la lista
    [...CATALOGO.carta(clase), 'Otro'].forEach(nombre => {
        const fila = document.createElement('div');
        fila.className = 'opcion';

        const etiqueta = document.createElement('label');
        etiqueta.className = 'opcion-etiqueta';

        const marca = document.createElement('input');
        marca.type = 'checkbox';
        marca.className = 'marca';
        marca.dataset.clase = clase;
        marca.value = nombre;
        etiqueta.append(marca, ` ${CATALOGO.etiqueta(nombre)}`);
        fila.append(etiqueta);

        // El hielo solo tiene sentido en los cafés, y solo se enseña cuando
        // ese café está marcado.
        if (CATALOGO.admiteHielo(clase, nombre)) {
            const hielo = document.createElement('label');
            hielo.className = 'hielo-toggle hidden';
            const casilla = document.createElement('input');
            casilla.type = 'checkbox';
            casilla.className = 'hielo';
            hielo.append(casilla, '❄️');
            fila.append(hielo);

            marca.addEventListener('change', () => {
                hielo.classList.toggle('hidden', !marca.checked);
                if (!marca.checked) casilla.checked = false;
            });
        }

        if (nombre === 'Otro') {
            marca.addEventListener('change', () => {
                input.classList.toggle('hidden', !marca.checked);
                if (marca.checked) input.focus();
            });
        }

        lista.append(fila);
    });
}

pintarCarta('bebida');
pintarCarta('pincho');

function marcasDe(clase) {
    return [...document.querySelectorAll(`.marca[data-clase="${clase}"]`)];
}

function marcaDe(clase, nombre) {
    return marcasDe(clase).find(marca => marca.value === nombre) || null;
}

// Lo marcado en un apartado. "Otro" se cambia por lo escrito a mano.
function eleccion(clase) {
    const { input } = APARTADOS[clase];

    return marcasDe(clase)
        .filter(marca => marca.checked)
        .map(marca => {
            const nombre = marca.value === 'Otro' ? input.value.trim() : marca.value;
            const casilla = marca.closest('.opcion').querySelector('.hielo');
            return { clase, nombre, hielo: Boolean(casilla && casilla.checked) };
        })
        .filter(item => item.nombre);
}

// Preferencia: si otro día ya pidió algo, se le ofrece repetirlo en vez de
// tener que buscarlo otra vez en la lista.
function describirPedido(items) {
    return items
        .map(item => item.nombre + (item.hielo ? ' con hielo' : ''))
        .join(', ');
}

// Deja la pantalla marcada tal cual una lista de items; lo que no esté en la
// carta se escribe en "Otro" (así se recuperan también los pedidos a mano).
function marcarItems(items) {
    ['bebida', 'pincho'].forEach(clase => {
        const { input } = APARTADOS[clase];
        const sueltos = [];

        items.filter(item => item.clase === clase).forEach(item => {
            const marca = marcaDe(clase, item.nombre);
            if (!marca) {
                sueltos.push(item.nombre);
                return;
            }
            marca.checked = true;
            marca.dispatchEvent(new Event('change'));
            const casilla = marca.closest('.opcion').querySelector('.hielo');
            if (casilla) casilla.checked = Boolean(item.hielo);
        });

        // De lo que no está en la carta solo cabe uno: el campo de texto es uno
        const otro = marcaDe(clase, 'Otro');
        if (sueltos.length > 0 && otro) {
            otro.checked = true;
            otro.dispatchEvent(new Event('change'));
            input.value = sueltos.join(', ').slice(0, 40);
        }
    });
}

function aplicarPreferencia(items) {
    marcarItems(items);
    ocultarAviso();
}

function ocultarAviso() {
    document.getElementById('avisoPreferencia').classList.add('hidden');
}

async function ofrecerPreferencia() {
    let preferencia;
    try {
        const respuesta = await authFetch('/api/preferencia');
        preferencia = await respuesta.json();
    } catch (err) {
        return; // sin conexión no se ofrece nada: el pedido normal sigue igual
    }

    if (!preferencia.hay || !preferencia.deOtroDia) return;

    const resumen = describirPedido(preferencia.items || []);
    if (!resumen) return;

    // El texto de "Otro" lo escribe la persona, así que se pinta como texto y
    // no como HTML.
    const aviso = document.getElementById('textoPreferencia');
    aviso.innerText = '';
    aviso.append('⚠️ La última vez pediste ');
    const queEs = document.createElement('strong');
    queEs.innerText = resumen;
    aviso.append(queEs, '. ¿Quieres lo mismo?');
    document.getElementById('avisoPreferencia').classList.remove('hidden');

    document.getElementById('btnRepetirSi')
        .addEventListener('click', () => aplicarPreferencia(preferencia.items));
    document.getElementById('btnRepetirNo').addEventListener('click', ocultarAviso);
}

// Estado de la pantalla: o no has pedido (botón "Guardar Pedido") o tienes un
// pedido vivo, que se puede cambiar tantas veces como quieras o anular.
let finDelTurno = null;
let temporizador = null;

function pintarSinPedido(mensaje = '') {
    finDelTurno = null;
    clearTimeout(temporizador);

    const btn = document.getElementById('btnGuardar');
    btn.disabled = false;
    btn.classList.remove('bg-gris');
    btn.innerText = 'Guardar Pedido';

    document.getElementById('avisoPedido').classList.add('hidden');
    document.getElementById('avisoTurno').innerText = mensaje;
}

function pintarConPedido(pedido) {
    const btn = document.getElementById('btnGuardar');
    btn.disabled = false;
    btn.classList.remove('bg-gris');
    btn.innerText = 'Modificar pedido';

    // Lo que hay pedido puede llevar texto escrito a mano, así que se pinta
    // como texto y no como HTML.
    const texto = document.getElementById('textoPedido');
    texto.innerText = '';
    texto.append('✅ Tienes pedido: ');
    const que = document.createElement('strong');
    que.innerText = describirPedido(pedido.items);
    texto.append(que, '. Cambia lo que quieras y dale a "Modificar pedido".');

    document.getElementById('avisoPedido').classList.remove('hidden');
    ocultarAviso(); // si ya has pedido, no viene a cuento ofrecerte repetir
    programarFinDeTurno(pedido.msRestantes);
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
    const hora = new Date(finDelTurno).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('avisoTurno').innerText =
        `Tu pedido cuenta para el turno que acaba a las ${hora}.`;
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
        marcarItems(mio.items);
        pintarConPedido(mio);
    } else {
        ofrecerPreferencia();
    }
}

arrancar();

document.getElementById('btnGuardar').addEventListener('click', async () => {
    const btn = document.getElementById('btnGuardar');

    const marcaOtroBebida = marcaDe('bebida', 'Otro');
    if (marcaOtroBebida.checked && !inputOtro.value.trim()) {
        alert('Escribe qué quieres tomar.');
        inputOtro.focus();
        return;
    }

    const marcaOtroPincho = marcaDe('pincho', 'Otro');
    if (marcaOtroPincho.checked && !inputOtroPincho.value.trim()) {
        alert('Escribe qué pincho quieres.');
        inputOtroPincho.focus();
        return;
    }

    const items = [...eleccion('bebida'), ...eleccion('pincho')];

    if (items.length === 0) {
        alert('Elige al menos una bebida o un pincho.');
        return;
    }

    // Se desactiva antes de la petición para que un doble toque no mande dos
    const textoPrevio = btn.innerText;
    btn.disabled = true;
    btn.innerText = 'Guardando...';

    try {
        const response = await authFetch('/api/pedidos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });

        if (response.ok) {
            const datos = await response.json();
            alert(datos.modificado ? '¡Pedido modificado! ☕' : '¡Pedido guardado correctamente! ☕');
            pintarConPedido(datos);
        } else {
            const errorData = await response.json();
            alert(errorData.error);
            btn.disabled = false;
            btn.innerText = textoPrevio;
        }
    } catch (err) {
        btn.disabled = false;
        btn.innerText = textoPrevio;
    }
});

document.getElementById('btnResumen').addEventListener('click', () => {
    window.location.href = 'resumen.html';
});

document.getElementById('btnCompra').addEventListener('click', () => {
    window.location.href = 'compra.html';
});

document.getElementById('btnCerrarSesion').addEventListener('click', cerrarSesion);
