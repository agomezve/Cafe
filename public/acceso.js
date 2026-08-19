if (getToken()) {
    window.location.href = 'app.html';
}

document.getElementById('btnLogin').addEventListener('click', async () => {
    const btn = document.getElementById('btnLogin');
    const usuario = document.getElementById('usuario').value.trim();
    const password = document.getElementById('password').value.trim();

    if (!usuario || !password) {
        alert('Por favor, rellena todos los campos.');
        return;
    }

    btn.disabled = true;
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, password })
        });

        const data = await response.json();

        if (data.success) {
            guardarSesion(data.nombre, data.token);
            window.location.href = 'app.html';
        } else {
            alert(data.message || 'Usuario o contraseña incorrectos.');
        }
    } catch (err) {
        alert('No se pudo conectar con el servidor. Revisa tu conexión.');
    } finally {
        btn.disabled = false;
    }
});
