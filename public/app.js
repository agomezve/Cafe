exigirSesion();
const bar = exigirBar();

document.getElementById('nombreUsuario').innerText = getUsuario() || '';
document.getElementById('nombreBar').innerText = bar.nombre;

const inputOtro = document.getElementById('otroTexto');
const inputOtroPincho = document.getElementById('otroPinchoTexto');

const APARTADOS = {
    bebida: { lista: document.getElementById('listaBebidas'), input: inputOtro },
    pincho: { lista: document.getElementById('listaPinchos'), input: inputOtroPincho },
};

// La carta se pinta desde el catálogo del bar elegido: cada bar tiene la suya
function pintarCarta(clase) {
    const { lista, input } = APARTADOS[clase];

    // "Otro" va al final, para escribir a mano lo que no esté en la lista
    [...CATALOGO.carta(bar, clase), 'Otro'].forEach(nombre => {
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

        // El hielo solo tiene sentido en las bebidas de la carta (en "Otro" no
        // se sabe qué es), y solo se enseña cuando esa bebida está marcada.
        if (clase === 'bebida' && nombre !== 'Otro') {
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

// Preferencia: si otro día ya pidió algo EN ESTE BAR, se le ofrece repetirlo
// en vez de tener que buscarlo otra vez en la lista.
function describirPedido(items) {
    return items
        .map(item => item.nombre + (item.hielo ? ' con hielo' : ''))
        .join(', ');
}

// Marca lo que se pidió la última vez; lo que no esté en la carta de hoy se
// escribe en "Otro" (así se repiten también los pedidos personalizados).
function aplicarPreferencia(items) {
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

    ocultarAviso();
}

function ocultarAviso() {
    document.getElementById('avisoPreferencia').classList.add('hidden');
}

async function ofrecerPreferencia() {
    let preferencia;
    try {
        const respuesta = await authFetch(`/api/preferencia?bar=${encodeURIComponent(bar.id)}`);
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
    aviso.append(`⚠️ La última vez en ${bar.nombre} pediste `);
    const queEs = document.createElement('strong');
    queEs.innerText = resumen;
    aviso.append(queEs, '. ¿Quieres lo mismo?');
    document.getElementById('avisoPreferencia').classList.remove('hidden');

    document.getElementById('btnRepetirSi')
        .addEventListener('click', () => aplicarPreferencia(preferencia.items));
    document.getElementById('btnRepetirNo').addEventListener('click', ocultarAviso);
}

ofrecerPreferencia();

// Cuando el pedido caduca empieza un turno nuevo y se puede volver a pedir sin
// recargar (en el móvil la app se queda abierta en segundo plano).
let finDelTurno = null;

function revisarTurno() {
    if (!finDelTurno || Date.now() < finDelTurno) return;

    finDelTurno = null;
    const btn = document.getElementById('btnGuardar');
    btn.disabled = false;
    btn.innerText = 'Guardar Pedido';
    btn.classList.remove('bg-gris');
    document.getElementById('avisoTurno').innerText = 'Ha empezado un turno nuevo: ya puedes volver a pedir.';
}

function programarFinDeTurno(msRestantes) {
    if (!msRestantes) return;

    finDelTurno = Date.now() + msRestantes;
    const hora = new Date(finDelTurno).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('avisoTurno').innerText = `Podrás volver a pedir a partir de las ${hora}.`;
    setTimeout(revisarTurno, msRestantes);
}

// Los temporizadores se frenan con la app en segundo plano, así que al volver
// a ella se comprueba también por si el turno ya se ha acabado.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) revisarTurno();
});

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

    // Se desactiva antes de la petición para evitar pedidos duplicados por doble toque
    btn.disabled = true;
    btn.innerText = 'Guardando...';

    try {
        const response = await authFetch('/api/pedidos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bar: bar.id, items })
        });

        if (response.ok) {
            const datos = await response.json();
            alert('¡Pedido guardado correctamente! ☕');
            btn.classList.add('bg-gris');
            btn.innerText = 'Pedido ya enviado';
            ocultarAviso();
            programarFinDeTurno(datos.msRestantes);
        } else {
            const errorData = await response.json();
            alert(errorData.error);
            btn.disabled = false;
            btn.innerText = 'Guardar Pedido';
        }
    } catch (err) {
        btn.disabled = false;
        btn.innerText = 'Guardar Pedido';
    }
});

document.getElementById('btnCambiarBar').addEventListener('click', () => {
    window.location.href = 'bares.html';
});

document.getElementById('btnResumen').addEventListener('click', () => {
    window.location.href = 'resumen.html';
});

document.getElementById('btnCerrarSesion').addEventListener('click', cerrarSesion);
