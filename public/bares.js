exigirSesion();

// La lista sale del catálogo: cuando se añada un bar nuevo aparece aquí solo
const lista = document.getElementById('listaBares');

CATALOGO.bares.forEach(bar => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'boton-bar';
    boton.innerText = bar.nombre;
    boton.addEventListener('click', () => {
        guardarBar(bar.id);
        window.location.href = 'app.html';
    });
    lista.append(boton);
});

document.getElementById('btnCerrarSesion').addEventListener('click', cerrarSesion);
