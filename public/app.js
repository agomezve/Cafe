exigirSesion();

let quiereHielo = false;
document.getElementById('nombreUsuario').innerText = getUsuario() || '';

const inputOtro = document.getElementById('otroTexto');
const inputOtroPincho = document.getElementById('otroPinchoTexto');

function radioMarcado(nombre) {
    return document.querySelector(`input[name="${nombre}"]:checked`);
}

// Lo elegido en un apartado: el valor del radio o, si es "Otro", lo escrito a mano
function eleccion(nombre, input) {
    const marcado = radioMarcado(nombre);
    if (!marcado) return '';
    if (marcado.value !== 'Otro') return marcado.value;
    return input.value.trim();
}

document.querySelectorAll('input[name="cafe"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const esOtro = e.target.value === 'Otro';
        inputOtro.classList.toggle('hidden', !esOtro);

        // Ni en "Otro" ni en "Sin café" se pregunta por el hielo
        if (esOtro || e.target.value === '') {
            if (esOtro) inputOtro.focus();
            quiereHielo = false;
            document.getElementById('hieloStatus').innerText = '';
            return;
        }

        quiereHielo = confirm(`Has elegido ${e.target.value}. ¿Quieres que lleve hielo?`);
        document.getElementById('hieloStatus').innerText = quiereHielo ? "❄️ Llevará hielo" : "☕ Caliente (sin hielo)";
    });
});

document.querySelectorAll('input[name="pincho"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const esOtro = e.target.value === 'Otro';
        inputOtroPincho.classList.toggle('hidden', !esOtro);
        if (esOtro) inputOtroPincho.focus();
    });
});

// Preferencia: si otro día ya pidió algo, se le ofrece repetirlo en vez de
// tener que buscarlo otra vez en la lista.
function describirPedido(preferencia) {
    const partes = [];
    if (preferencia.tipoCafe) {
        partes.push(preferencia.tipoCafe + (preferencia.hielo ? ' con hielo' : ''));
    }
    if (preferencia.pincho) partes.push(preferencia.pincho);
    return partes.join(' y ');
}

// Marca una opción del catálogo; si no está en la lista, usa "Otro" y escribe
// el texto (así se repiten también los pedidos personalizados).
function marcarOpcion(nombre, valor, input) {
    const opciones = [...document.querySelectorAll(`input[name="${nombre}"]`)];
    const exacta = opciones.find(o => o.value === valor);

    if (exacta) {
        exacta.checked = true;
        input.classList.add('hidden');
        return;
    }

    const otro = opciones.find(o => o.value === 'Otro');
    if (!otro) return;
    otro.checked = true;
    input.value = valor;
    input.classList.remove('hidden');
}

function aplicarPreferencia(preferencia) {
    marcarOpcion('cafe', preferencia.tipoCafe || '', inputOtro);
    marcarOpcion('pincho', preferencia.pincho || '', inputOtroPincho);

    quiereHielo = Boolean(preferencia.hielo);
    document.getElementById('hieloStatus').innerText = quiereHielo ? "❄️ Llevará hielo" : '';
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

    const resumen = describirPedido(preferencia);
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
    document.getElementById('btnRepetir').addEventListener('click', () => aplicarPreferencia(preferencia));
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

    if (!radioMarcado('cafe')) {
        alert("Elige un café (o marca 'Sin café' si solo quieres pincho).");
        return;
    }

    const tipoCafe = eleccion('cafe', inputOtro);
    const pincho = eleccion('pincho', inputOtroPincho);

    if (radioMarcado('cafe').value === 'Otro' && !tipoCafe) {
        alert("Escribe qué quieres tomar.");
        inputOtro.focus();
        return;
    }

    if (radioMarcado('pincho').value === 'Otro' && !pincho) {
        alert("Escribe qué pincho quieres.");
        inputOtroPincho.focus();
        return;
    }

    if (!tipoCafe && !pincho) {
        alert("Elige un café, un pincho o las dos cosas.");
        return;
    }

    // Se desactiva antes de la petición para evitar pedidos duplicados por doble toque
    btn.disabled = true;
    btn.innerText = 'Guardando...';

    try {
        const response = await authFetch('/api/pedidos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipoCafe, hielo: quiereHielo, pincho })
        });

        if (response.ok) {
            const datos = await response.json();
            alert("¡Pedido guardado correctamente! ☕");
            btn.classList.add('bg-gris');
            btn.innerText = "Pedido ya enviado";
            document.getElementById('avisoPreferencia').classList.add('hidden');
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

document.getElementById('btnResumen').addEventListener('click', () => {
    window.location.href = 'resumen.html';
});

document.getElementById('btnCerrarSesion').addEventListener('click', cerrarSesion);
