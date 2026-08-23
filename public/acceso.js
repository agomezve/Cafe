if (getToken()) {
    window.location.href = 'bares.html';
}

const inputUsuario = document.getElementById('usuario');

async function entrar() {
    const btn = document.getElementById('btnLogin');
    const usuario = inputUsuario.value.trim();

    if (!usuario) {
        alert('Escribe tu nombre.');
        return;
    }

    btn.disabled = true;
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario })
        });

        const data = await response.json();

        if (data.success) {
            guardarSesion(data.nombre, data.token);
            window.location.href = 'bares.html';
        } else {
            alert(data.message || 'Ese nombre no está en la lista.');
        }
    } catch (err) {
        alert('No se pudo conectar con el servidor. Revisa tu conexión.');
    } finally {
        btn.disabled = false;
    }
}

document.getElementById('btnLogin').addEventListener('click', entrar);

// En el móvil el teclado enseña "Ir": que sirva para entrar
inputUsuario.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') entrar();
});
