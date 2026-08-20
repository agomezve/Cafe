exigirSesion();

let quiereHielo = false;
document.getElementById('nombreUsuario').innerText = getUsuario() || '';

const inputOtro = document.getElementById('otroTexto');

document.querySelectorAll('input[name="cafe"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const esOtro = e.target.value === 'Otro';
        inputOtro.classList.toggle('hidden', !esOtro);

        if (esOtro) {
            inputOtro.focus();
            quiereHielo = false;
            document.getElementById('hieloStatus').innerText = '';
            return;
        }

        quiereHielo = confirm(`Has elegido ${e.target.value}. ¿Quieres que lleve hielo?`);
        document.getElementById('hieloStatus').innerText = quiereHielo ? "❄️ Llevará hielo" : "☕ Caliente (sin hielo)";
    });
});

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
    const cafeSeleccionado = document.querySelector('input[name="cafe"]:checked');

    if (!cafeSeleccionado) {
        alert("Por favor, selecciona una opción.");
        return;
    }

    let tipoCafe = cafeSeleccionado.value;
    if (tipoCafe === 'Otro') {
        tipoCafe = inputOtro.value.trim();
        if (!tipoCafe) {
            alert("Escribe qué quieres tomar.");
            inputOtro.focus();
            return;
        }
    }

    // Se desactiva antes de la petición para evitar pedidos duplicados por doble toque
    btn.disabled = true;
    btn.innerText = 'Guardando...';

    try {
        const response = await authFetch('/api/pedidos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipoCafe, hielo: quiereHielo })
        });

        if (response.ok) {
            const datos = await response.json();
            alert("¡Pedido guardado correctamente! ☕");
            btn.classList.add('bg-gris');
            btn.innerText = "Pedido ya enviado";
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
